# POGRANICHNK 运行时验链审计

> 审计时间: 2026-04-03
> 目标: 确认碎甲 variant 能否从前端排轴进入 runtime 并产生可观察信号
> 方法: 静态代码追踪 + 数据流验证

---

## A. 前端能否选择并放置碎甲 variant

### 结论：能 [已从代码确认]

**入口文件**：`stores/timelineStore.js:2299-2319` (`createVariantSkill`)

POGRANICHNK 在 gamedata.json 中定义了 7 个 variant：
- 4 个 skill variant：战技碎甲一/二/三/四
- 3 个 link variant：连携破防一/二/三

这些 variant 通过 `createVariantSkill()` 函数变成 ActionLibrary 中的可选技能。用户在 ActionLibrary 面板中可以看到这些 variant 并拖拽放置到排轴。

**variant 放置后的数据保留**：`createActionFromSkill()` (L2903-2940) 通过 `cloneEffectsForAction()` 深拷贝 physicalAnomaly + damageTicks，并重新分配 effect ID。**所有字段完整保留** [已从代码确认]。

**不存在"看起来选了 variant 但落地是基础 action"的风险**：variant 的 `id` 和基础 action 的 `id` 不同（variant id 包含 `_variant_` 前缀），放置后的 action 对象直接引用 variant 数据。

---

## B. 从前端 action 到 ResolvedTimeline，关键字段是否被保留

### 完整数据流 [已从代码确认]

```
gamedata.json variant
  → createVariantSkill() [timelineStore.js:2299]
    physicalAnomaly ✅ 直接赋值
    damageTicks ✅ 深拷贝
  → createActionFromSkill() [timelineStore.js:2903]
    physicalAnomaly ✅ 深拷贝 + effect ID 重映射
    damageTicks ✅ 深拷贝 + boundEffects ID 重映射
  → normalizeScenario() [compileScenario.ts:46]
    action.node = 完整 action 对象 ✅
  → resolveAction() [compileTimeline.ts:84]
    physicalAnomaly[][] → effects[] (flat 1D) ✅
    damageTicks[] → resolvedDamageTicks[] ✅ (含 tick.sp)
```

### 各字段保留状态

| 字段 | 保留？ | 变换 |
|------|--------|------|
| physicalAnomaly[].type ("armor_break") | ✅ | 2D → 1D effects[]，type 在 effect.node.type |
| physicalAnomaly[].stacks (1-4) | ✅ | 在 effect.node.stacks |
| physicalAnomaly[].duration (12-30) | ✅ | 在 effect.node.duration |
| damageTicks[].sp (5/10/20/30) | ✅ | 在 resolvedDamageTick.sp |
| damageTicks[].stagger | ✅ | 在 resolvedDamageTick.stagger |
| damageTicks[].boundEffects | ✅ | ID 被重映射但引用保持一致 |

---

## C. Runtime 入队阶段，这些字段是否变成了正确的事件

### 碎甲效果路由 [已从代码确认]

**文件**：`simulator.ts:340-372`

```
action.effects.forEach((resolvedEffect) => {
  effectType = resolvedEffect.node.type   // "armor_break"
  physicalType = PHYSICAL_ANOMALY_MAP["armor_break"]  // → "armorBreak" ✅
  → enqueue APPLY_PHYSICAL_ANOMALY
})
```

`armor_break` 在 `PHYSICAL_ANOMALY_MAP` 中 [已从代码确认，simulator.ts:31]：
```typescript
const PHYSICAL_ANOMALY_MAP = { armor_break: "armorBreak", ... }
```

**入队的事件 payload**:
```typescript
{
  type: "APPLY_PHYSICAL_ANOMALY",
  time: resolvedEffect.realStartTime,
  payload: {
    physicalType: "armorBreak",
    sourceActorId: action.trackId,       // "POGRANICHNK"
    targetId: "boss",
    sourceSkillId: action.node.id,
  }
}
```

**注意**：payload 中**没有 stacks 字段**。variant 定义的 stacks:1-4 在此处丢失。

### stacks 丢失的影响 [已从代码确认]

`PhysicalReactionResolver.resolvePhysicalAnomaly()` 处理 armorBreak 时：
- 如果 boss 无 break → **只加 1 层 break stack**（L51-58）
- 如果 boss 有 break → 读 `status.getBreakStacks()` 计算碎甲伤害和脆弱值（L62），然后清空 break

**实际含义**：POGRANICHNK 的碎甲 variant 标记 stacks:1-4 是"消耗几层破防"的语义，但 runtime 只处理为一次标准 armorBreak 物理异常。**这是一个语义简化，不是 bug**——在当前简化模型中，碎甲产生的效果基于 boss 实际的 break stack 数而非 variant 标注的 stacks 数。

### tick SP 回复路由 [已从代码确认]

**文件**：`DamageHandler.ts:236-248`

```
if (tick.sp > 0) {
  ctx.queue.enqueue({
    type: "SP_CHANGE",
    time: ctx.state.getCurrentTime(),
    payload: {
      actorId: e.payload.sourceId,    // "POGRANICHNK"
      spChange: tick.sp,              // 5/10/20/30（取决于 variant）
      reason: "damage",
      sourceId: e.payload.actionId,
    },
  });
}
```

**碎甲四 variant 的 SP 回复链路**：
- Tick 0: sp=0 → 不入队 SP_CHANGE
- Tick 1: sp=30 → 入队 SP_CHANGE(spChange=30, reason="damage")

**链路完整** ✅

### ActionEnd spGain [已从代码确认]

POGRANICHNK 所有 action 的 `spGain` 均为 undefined [已确认]。SP 回复完全依赖 tick.sp。ActionEndHandler 不产生额外 SP_CHANGE。

### 天赋 trigger 响应 [已从自动化测试确认]

SP_CHANGE(spChange=30, reason="damage") → TriggerProcessor → POGRANICHNK 天赋 condition：
- `spChange > 0` ✅
- `reason === "damage"` ✅
- `spAccumulator += 30`
- 累计不到 80 → 不触发

**需要多次操作才能累计到 80**。

---

## D. 最小测试排轴方案

### SP 累计估算

| Action | tick SP 合计 | 说明 |
|--------|-------------|------|
| 碎甲四 variant (skill) | 30 | tick 1: sp=30 |
| 基础 link | 35 | tick 0:5 + tick 1:7 + tick 2:23 |
| 终结技 (ultimate) | 60 | tick 1-4:7.5×4=30 + tick 5:30 |
| **合计** | **125** | **超过 80 阈值，应触发 1 次天赋** |

### 推荐排轴

1. 添加 POGRANICHNK track
2. 放置 **战技碎甲四** variant（ActionLibrary 中应可见为独立条目）
3. 放置 **基础 link**
4. 放置 **终结技**
5. 确保三个 action 不重叠（按时间顺序）
6. 点击"伤害统计"

### 预期观察信号

| 观察窗口 | 预期信号 | 确认什么 |
|----------|---------|---------|
| **Boss debuff 栏** | 碎甲 variant 时间点出现 armor_break debuff | 碎甲效果路由成功 |
| **伤害统计面板** | 终结技的伤害略高于无天赋场景（ATK% buff 生效） | 天赋 conditional 触发并影响伤害 |
| **simLog (console)** | SP_CHANGE 条目，spChange=30(skill tick) + 5/7/23(link ticks) + 7.5×4+30(ult ticks) | SP 累计链路完整 |
| **simLog EFFECT_START** | `pogranichnk_morale_stack_N` 出现 | buff 被创建 |

---

## E. 如果前端仍然无法观察到预期信号

### 按层排查

| 层 | 可能断点 | 如何判断 | 严重性 |
|----|---------|---------|--------|
| **前端 variant 选择** | ActionLibrary 中看不到碎甲 variant 条目 | 打开 ActionLibrary 面板查看 POGRANICHNK 的可选技能列表 | 低概率（代码确认 createVariantSkill 存在） |
| **compileScenario 丢字段** | variant 的 physicalAnomaly 在编译后变成空 effects[] | 在 console 中打印 compiledScenario.timeline.actions，检查 effects 数组 | 低概率（代码确认 spread 保留所有字段） |
| **simulator 效果路由** | armor_break 效果入队了 APPLY_PHYSICAL_ANOMALY 但 handler 出错 | 检查 simLog 中是否有 ANOMALY_STATUS_CHANGE 条目 | 低概率（PHYSICAL_ANOMALY_MAP 确认包含 armor_break） |
| **SP_CHANGE 未入队** | tick.sp=0（使用了基础 action 而非 variant） | 检查 simLog 中 SP_CHANGE 条目的 spChange 值 | **最高概率**——用户可能放错了 action |
| **天赋 trigger 未注册** | POGRANICHNK 不在 TALENT_CONDITIONAL_TRIGGERS 中 | 检查 diagnostics 输出 | 低概率（代码确认已注册，测试通过） |
| **天赋 trigger 注册了但 condition 不触发** | 累计 SP 不够 80 | 检查 simLog 中所有 SP_CHANGE 条目的 spChange 求和 | 取决于排轴操作 |

### 最小代码缺口评估

**如果碎甲 variant 正确放置，代码层不存在阻塞性缺口** [已从代码确认数据流完整]。

唯一的语义简化是：variant 的 `stacks` 字段未传入 APPLY_PHYSICAL_ANOMALY 事件，碎甲消耗的层数基于 boss 实际 break stacks 而非 variant 标注值。这影响碎甲伤害/脆弱计算的精确性，但**不阻塞 SP 回复和天赋触发链路**（SP 回复来自 tick.sp，不依赖碎甲 stacks）。

---

## 结论

### 当前最小阻塞点

**静态代码追踪确认全链路数据保留完整。** variant → compile → simulator → SP_CHANGE → 天赋 trigger 的每一步都有代码路径支撑。

但以下环节**需要实际运行才能最终确认**（静态审计无法替代）：

1. 前端 ActionLibrary 是否正确展示碎甲 variant 条目
2. 碎甲 variant 放置后 compiledScenario 是否包含预期的 effects 和 tick.sp
3. PhysicalReactionResolver 在 boss 无 break stacks 时的行为（首次碎甲只加 1 层 break，不产生碎甲伤害/脆弱）
4. 累计 SP 是否在排轴时间窗内达到 80

### 是否真的只是"前端没选 variant"

**大概率是。** 但不能 100% 排除 compile 或 runtime 层的边界问题。建议下一步是**实际运行验证**（在前端放置碎甲四 variant + link + ult 排轴），而非继续做静态审计。

### 下一步建议

**做一次人工前端验证**，按上述最小排轴方案操作，然后根据观察到的实际信号决定：
- 如果 boss debuff 栏出现 armor_break + SP_CHANGE 累计到 80 + 天赋 buff 出现 → **P3 收口**
- 如果某一环节断裂 → 根据上面的排查表定位具体断点，做最小补口
