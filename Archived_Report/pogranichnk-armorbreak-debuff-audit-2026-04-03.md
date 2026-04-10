# POGRANICHNK 碎甲 Debuff 未生效审计

> 审计时间: 2026-04-03
> 前置: SP 回复 + 天赋 conditional 已确认生效（P3 主链收口）
> 目标: 找出碎甲 debuff 不生效的精确原因

---

## A. 碎甲 variant 在 runtime 中生成了什么 target-side 状态

### 执行序列 [已从代码确认]

碎甲四 variant 产生一个 `APPLY_PHYSICAL_ANOMALY(physicalType: "armorBreak")` 事件。

PhysicalReactionResolver 的处理逻辑 (`anomaly/PhysicalReactionResolver.ts:28-127`)：

```
收到 armorBreak:
  if boss 无 break stacks:
    → 只加 1 层 break stack         ← 首次碎甲走这里
    → return [BREAK_CHANGED]         ← 没有伤害，没有脆弱
  
  if boss 有 break stacks:
    → 计算碎甲伤害（基于当前 stacks）
    → 清空所有 break stacks
    → 计算并施加 physical_vulnerable ← 脆弱在这里产生
    → return [PHYSICAL_DAMAGE, BREAK_CLEARED, PHYSICAL_VULN_APPLIED]
```

### 首次碎甲的实际行为

**Boss 初始状态**：无 break stacks（`physicalBreak === null`）。

POGRANICHNK 碎甲四 variant 的效果触发时：
1. `status.hasBreak()` → `false`（boss 无 break）
2. 走 L51-58 分支：`addBreakStack(time)` → boss 获得 1 层 break
3. **return**——不产生碎甲伤害，不产生 physical_vulnerable

**这就是碎甲 debuff 没生效的根本原因。**

### 如果在碎甲之前 boss 已有 break stacks

例如先用其他角色施加 break stacks，再用 POGRANICHNK 碎甲：
1. `status.hasBreak()` → `true`
2. 走 L91-109 armorBreak 分支
3. `stacksBeforeReaction = status.getBreakStacks()` → 读取当前 stacks
4. `calcBreachPhysVulnerability(stacks, artsPower)` → 计算脆弱值和持续时间
5. `status.clearBreak()` → 清空 break
6. outcome: `PHYSICAL_VULN_APPLIED` → emitOutcomes → 施加 PHYSICAL_VULNERABLE Effect

**在这条路径下，碎甲 debuff（physical_vulnerable）会生效并被后续伤害消费。**

---

## B. physical_vulnerable 是否被后续伤害计算消费

### 消费路径 [已从代码确认]

`PHYSICAL_VULN_APPLIED` outcome → `emitOutcomes()` (AnomalyHandlers.ts:223-240)：

```typescript
case "PHYSICAL_VULN_APPLIED": {
  const vulnEffect = new Effect({
    id: "PHYSICAL_VULNERABLE",
    tags: ["PHYSICAL_VULNERABLE"],
    duration: o.vulnDuration,
    startTime: time,
    properties: {
      physVulnPercent: o.physVulnPercent,
      sourceActorId: o.sourceActorId,
    },
  });
  addOrRefreshBuff(ctx.state.enemy.effects, vulnEffect);
}
```

消费点：`multiplierZones.ts:195-240` (`computeVulnerabilityZone`)：

```typescript
if (tags.damageSchool === "physical") {
  for (const inst of target.effects.getByTag("PHYSICAL_VULNERABLE")) {
    const pct = inst.effect.properties.physVulnPercent;
    if (typeof pct === "number" && pct > 0) {
      bonus += pct;
    }
  }
}
```

**消费路径完整**：Effect 挂载到 enemy.effects → vulnerability zone 读取 → 乘入 DamageResolver。

---

## C. 断点在哪一层

**断点在 PhysicalReactionResolver 的逻辑分支** [已从代码确认]。

不是 payload 丢字段，不是 debuff 未聚合，不是 multiplier zone 未消费。

是**首次碎甲时 boss 无 break stacks → resolver 只加 1 层 break → 不产生 PHYSICAL_VULN_APPLIED**。

碎甲（armorBreak）的游戏语义是"消耗已有 break stacks → 产生碎甲效果"。它是一个 **消耗型** 反应，不是一个 **施加型** debuff。必须先有 break stacks 才能碎。

---

## D. POGRANICHNK 碎甲语义与通用 armorBreak 是否不一致

### 对比

| 维度 | 通用 armorBreak 语义 | POGRANICHNK variant 标注 |
|------|---------------------|------------------------|
| 触发条件 | boss 必须先有 break stacks | variant 标注 stacks:1-4（表示"消耗几层"） |
| 首次碎甲效果 | 无 break → 只加 1 层 break，不产生脆弱 | variant 期望"消耗 N 层 break → 产生脆弱" |
| stacks 字段 | 不被 APPLY_PHYSICAL_ANOMALY 事件使用 | 定义在 variant.physicalAnomaly[].stacks |

### 判断：这是"当前简化设计"，不是 bug

理由：
1. PhysicalReactionResolver 的逻辑对所有角色一致——armorBreak 在无 break 时只加 stack，有 break 时才消耗并产生脆弱。这是正确的游戏机制 [已从代码确认]。
2. variant 的 `stacks:1-4` 表达的是"这个技能在游戏中可以消耗 1-4 层 break"，是**描述性元数据**，不是"直接施加 N 层 break"。
3. **真正的阻塞**是排轴中 boss 在碎甲前没有 break stacks。需要先通过其他物理异常（如击飞、倒地、猛击）积攒 break stacks，然后碎甲才能消耗它们并产生脆弱。

### 如何在排轴中让碎甲生效

**需要在碎甲 variant 之前，先给 boss 施加足够的 break stacks。** 例如：
1. 先放 POGRANICHNK（或其他角色）的普攻/连携中的 knockdown/slam/launch 等物理异常
2. 每次施加一个物理异常 → boss +1 break stack（无 break 时）
3. 积攒 1-4 层 break stacks
4. 再放碎甲 variant → 消耗全部 break stacks → 产生 PHYSICAL_VULN_APPLIED

或者：使用编辑器在排轴中直接为 boss 配置初始 break 状态。

---

## E. 最小补口建议

### 判断：不需要改 simulation 代码

PhysicalReactionResolver 的逻辑是正确的。碎甲不生效是因为排轴中 boss 缺少 break stacks 前置条件。

### 如果需要方便测试

最小的补口有两个选择（互斥，选一个）：

**选项 A（零代码改动）**：在前端排轴中，通过以下方式给 boss 预置 break stacks：
- 在碎甲 variant 前放置其他物理异常 action（如 knockdown/slam/launch）
- 或在 DataEditor 中为 boss 手动配置初始 break 状态

**选项 B（最小代码辅助）**：如果编辑器当前不支持手动配置 boss 初始 break stacks，可以在 enemy config 中增加一个 `initialBreakStacks` 字段。但这可能超出本轮范围。

### 建议

**选项 A**——在排轴中先用 POGRANICHNK 自己的 link action 给 boss 施加物理异常（如果 link 有物理异常效果），或用另一个物理系角色先打出 break stacks。

如果 POGRANICHNK 自身的 link 也没有物理异常效果（需验证），则需要多角色排轴配合。

---

## 结论

### 碎甲 debuff 为什么没真实生效

**不是代码 bug。** 碎甲（armorBreak）是消耗型反应——必须先有 break stacks 才能消耗并产生 physical_vulnerable。排轴中 boss 初始无 break stacks → 首次碎甲只加 1 层 break → 不产生脆弱 debuff。

### 最小补口

**不需要改 simulation 代码。** 需要的是排轴中在碎甲前先积攒 break stacks。可通过：
1. 多放几个 POGRANICHNK 碎甲 variant（第一次加 break，第二次消耗并产生脆弱）
2. 或用其他角色先施加物理异常积攒 break

### 修完后前端看什么验证

排轴安排：先施加物理异常积攒 break → 再放碎甲 variant：
1. **Boss debuff 栏**：碎甲后出现 `physical_vulnerable` debuff（不是 `armor_break`，是 `physical_vulnerable`）
2. **伤害统计面板**：脆弱生效期间的物理伤害升高（vulnerability zone 乘区 > 1）
3. **simLog**：出现 `ANOMALY_STATUS_CHANGE` 描述 "break cleared" + `PHYSICAL_VULN_APPLIED`
