# T6 注册层收口 + Anomaly Duration Override 实施报告

---

## 1. 处理的分类

- Part 1（完成）：modifier 注册层最小收口 — 提取 `registerTriggeredBuff` 通用 helper
- Part 2（完成）：anomaly duration override 最小口子 — 4 个 apply 方法均支持可选 durationOverride

## 2. 实际修改了哪些文件

| 文件 | Part | 改动 |
|---|---|---|
| `src/simulation/simulator.ts` | 1+2 | 提取 `registerTriggeredBuff` helper；WULFGARD/CHENQIANYU 改用 helper；direct anomaly 路由传 durationOverride |
| `src/simulation/anomaly/events.ts` | 2 | `ApplyDirectAnomalyEvent` payload 加 `durationOverride?: number` |
| `src/simulation/anomaly/AnomalyHandlers.ts` | 2 | `ApplyDirectAnomalyHandler` 透传 durationOverride |
| `src/simulation/anomaly/DirectAnomalyApplier.ts` | 2 | `applyDirectAnomaly` 接受并透传 durationOverride |
| `src/simulation/anomaly/MagicReactionResolver.ts` | 2 | `applyAnomalyDebuff` 接受并透传 durationOverride |
| `src/simulation/anomaly/EnemyStatusState.ts` | 2 | 4 个 apply 方法均加 `durationOverride?: number` 参数 |

共 6 个文件。每个 anomaly 文件改动 1-3 行。

## 3. 改变了什么行为 / 数据流

### Part 1: registerTriggeredBuff helper

**新增 helper 签名**（simulator.ts 内部函数）：
```typescript
registerTriggeredBuff(actorId, {
  carrierId,      // 载体 Effect ID
  event,          // 触发事件类型
  condition?,     // 触发条件
  buffId,         // buff Effect ID（不叠加时用于去重；叠加时作为前缀）
  duration,       // buff 持续秒数
  bonuses,        // DynamicBonus[]
  target?,        // "self"（默认）| "enemy"
  stack?,         // { group, max }（若提供则走独立持续时间叠层）
})
```

**行为不变** — WULFGARD 和 CHENQIANYU 的触发逻辑、buff 效果、持续时间完全保持原样，只是代码从 ~40 行内联逻辑变成 ~8 行 config 调用。

### Part 2: anomaly duration override

**默认行为不变** — 不传 durationOverride 时，仍走原本按 level/常量决定的持续时间。

**新行为** — 当 gamedata effect node 的 `duration` 字段为正数时，作为 `durationOverride` 传入 anomaly apply 方法，覆盖默认持续时间。

当前 gamedata 中有正 duration 的 direct anomaly：
- PERLICA link `conductive`: `duration: 8.75` → 导电持续 8.75s（而非默认 12s）
- 其他 direct anomaly 的 duration 为 0 或不存在 → 不触发 override，走默认

## 4. 哪些已经可收口

| 项目 | 状态 |
|---|---|
| 不叠加刷新型 buff（addOrRefreshBuff） | **已收口** — 通过 `registerTriggeredBuff` 不传 stack 参数 |
| 独立持续时间叠层 buff（addStackWithIndependentDuration） | **已收口** — 通过 `registerTriggeredBuff` 传 stack: { group, max } |
| self buff | **已收口** — target 默认 "self" |
| enemy debuff | **已预留** — target: "enemy" 已实现，待首个具体 debuff 样例验证 |
| anomaly duration override | **已通** — 全链路可选参数，仅正数 duration 才触发 |

## 5. 哪些仍是阶段性实现

| 项目 | 状态 |
|---|---|
| 更多 runtime_conditional 天赋 | 仍需逐个注册（代码驱动），但新增一个只需 ~8 行 config |
| 通用 conditional 解释器 | 未做，当前仍需按角色手写 condition/event |
| anomaly duration 数据准确性 | gamedata 中的 duration 未经人工验证，仅"口子打开" |

## 6. 有没有引入新的真值源或临时覆盖层

**没有。**
- `registerTriggeredBuff` 是 simulator.ts 内的局部函数，不是新模块
- anomaly duration 仍从 gamedata effect node 原始数据读取，不新建映射
- 数值仍从 `_activeEffects` 读取

## 7. 测试结果

- vue-tsc 类型检查通过
- 107 个 anomaly/equipment/damage/mechanics 测试全通过
- 全量 266 测试中 12 个失败均为预存 skill multiplier 问题

## 8. 下一步最适合测什么

1. **PERLICA 连携技导电**：现在应该持续 8.75s（gamedata duration override 生效），而非默认 12s
2. **WULFGARD 终结技燃烧**：持续时间仍为 10s（gamedata duration=0 → 不触发 override → 默认）
3. **新增 runtime_conditional 天赋**：用 `registerTriggeredBuff` 注册，验证 ~8 行即可接入一个新天赋

## 前端可直接观察到的变化

无直接 UI 变化。通过"伤害统计"按钮验证：
- PERLICA 连携技施加导电后的伤害窗口可能更短（8.75s vs 12s）
- 其他行为与之前一致
