# DAPAN 连携技 + 物理异常 stacks 透传修正报告

> 日期：2026-04-04
> 类型：bugfix + 数据修正
> 前置：sourceMustBeWearer 修正（已完成）

---

## 概述

本轮修正解决了 DAPAN 连携技（link）物理异常相关的三个问题：

1. **stacks 字段被忽略**：gamedata 中 `stacks: 4` 从未传入 PhysicalReactionResolver
2. **异常偏移不对齐**：link 的 stagger 异常在 0.77s 触发，但唯一的 damage tick 在 1.76s
3. **破防消耗后残余显示**：slam 消耗破防后，前端仍显示 ~5s 的破防占位段

---

## 问题 1：stacks 字段透传

### 根因

gamedata.json 中 DAPAN link 的物理异常定义：
```json
{ "type": "stagger", "stacks": 4, "duration": 0, "offset": 1.76, "_id": "r58y37u" }
```

但 `stacks` 字段在整个事件链中被丢弃：
- `simulator.ts` Route 2 未读取 `resolvedEffect.node.stacks`
- `ApplyPhysicalAnomalyEvent` payload 无 `stacks` 字段
- `ApplyPhysicalAnomalyHandler` 不传 stacks 给 resolver
- `resolvePhysicalAnomaly()` 固定加 1 层 break

### 修改（4 个文件）

| 文件 | 改动 |
|------|------|
| `anomaly/events.ts` | `ApplyPhysicalAnomalyEvent` payload 新增 `stacks?: number` |
| `simulator.ts` Route 2 | 读取 `resolvedEffect.node.stacks`，clamp [1,4]，写入 payload |
| `anomaly/AnomalyHandlers.ts` | `ApplyPhysicalAnomalyHandler` 传 `e.payload.stacks \|\| 1` 给 resolver |
| `anomaly/PhysicalReactionResolver.ts` | 新增 `incomingStacks` 参数；`!hasBreak()` 和 `launch/knockdown` 分支循环 N 次 `addBreakStack()` |

### 影响范围

- **所有角色的物理异常**都走此路径（不只 DAPAN）
- stacks 默认 1，向后兼容
- slam/armorBreak 的 hasBreak() 分支不受影响（消耗型反应不叠层）
- PHYSICAL_BREAK_MAX_STACKS = 4 上限不变（addBreakStack 内置 clamp）

### 透传链完整路径

```
gamedata.json  stacks: 4
    ↓
compileTimeline.ts  resolvedEffect.node.stacks = 4  (line 165: node: effect)
    ↓
simulator.ts Route 2  incomingStacks = clamp(4, 1, 4) = 4  (line 369)
    ↓
APPLY_PHYSICAL_ANOMALY event  payload.stacks = 4
    ↓
AnomalyHandlers.ts  e.payload.stacks || 1 = 4  (line 285)
    ↓
PhysicalReactionResolver  incomingStacks = 4  (line 35)
    ↓
!hasBreak() 分支: for (i=0; i<4; i++) addBreakStack()  → 一次加 4 层
hasBreak() + launch/knockdown 分支: 同样循环 N 次加层
hasBreak() + slam/armorBreak 分支: 不受影响（消耗路径不叠层）
```

---

## 问题 2：异常偏移不对齐

### 根因

DAPAN link gamedata 中：
- damage tick offset = **1.76s**（唯一的 hit）
- stagger anomaly offset = **0.77s**（boundEffects 绑定到该 tick）

对比 DAPAN 其他动作：
- **skill**：damage tick 0.37s，anomaly 0.37s — **对齐** ✓
- **ultimate**：damage tick 1.4s/2.67s，anomaly 1.4s/2.67s — **对齐** ✓
- **link**：damage tick 1.76s，anomaly 0.77s — **不对齐** ✗

0.77s 是数据录入错误。

### 修改

```diff
# public/gamedata.json (DAPAN link_anomalies)
- "offset": 0.77,
+ "offset": 1.76,
```

### 影响

- 物理异常（slam）现在与 damage tick 同时在 1.76s 触发
- 破防判定点与 hit 对齐，符合游戏实际表现
- 仅影响 DAPAN link 动作，其他角色/动作不受影响

---

## 问题 3：破防消耗后 5s 残余显示

### 根因

`timelineStore.js` 的 `_computePhysicalVulnerable()` 函数在 slam/armorBreak 消耗破防后，生成一个 `PHYSICAL_CONSUME_DURATION = 5` 秒的占位可视段。这导致前端看到破防在被消耗后仍"持续"~5s。

```javascript
// 旧代码
const PHYSICAL_CONSUME_DURATION = 5 // 消耗后占位时长（秒）

// 消耗分支
result.push(makeSeg(t, snapMs(t + PHYSICAL_CONSUME_DURATION), consumeLevel, true))
```

### 修改

```diff
# src/stores/timelineStore.js
- const PHYSICAL_CONSUME_DURATION = 5 // 消耗后占位时长（秒）
+ const PHYSICAL_CONSUME_DURATION = 0 // 消耗后占位时长（秒）— 消耗即清除，不显示残余
```

### 影响

- 所有角色的 slam/armorBreak 消耗破防后，不再生成可见占位段
- 破防在消耗时刻立即从时间线上消失
- 仅影响前端可视化，不影响 simulation runtime 逻辑

---

## 改动文件清单

| 文件 | 改动类型 | 影响范围 |
|------|---------|---------|
| `anomaly/events.ts` | 类型扩展 | 全局（事件定义） |
| `simulator.ts` Route 2 | 读取 stacks | 全局（所有物理异常路由） |
| `anomaly/AnomalyHandlers.ts` | 透传 stacks | 全局（所有物理异常处理） |
| `anomaly/PhysicalReactionResolver.ts` | 循环加层 | 全局（所有 !hasBreak/launch/knockdown） |
| `public/gamedata.json` | offset 修正 | 仅 DAPAN link |
| `stores/timelineStore.js` | 消耗占位清零 | 全局（所有破防消耗可视化） |

---

## 测试结果

53 测试全部通过：
- anomaly.test.ts: 21 passed（含 break logic 5 项）
- talentConditionalRegistry.test.ts: 29 passed（含 DAPAN 勾芡 8 项）
- simulator.behavior.test.ts: 3 passed

---

## 前端验证结果

- ✓ 天赋正常触发（可观察到两次普攻伤害不同）
- ✓ 破防判定点对齐到 1.76s hit
- ✓ 消耗后破防立即消失（无 5s 残余）

---

## 与之前 sourceMustBeWearer 修正的关系

本轮修正是在 sourceMustBeWearer 修正之上的补充：

| 修正 | 解决的问题 |
|------|-----------|
| sourceMustBeWearer（上轮） | condition 无法观察队友的 break 事件 → 天赋永不触发 |
| stacks 透传（本轮） | gamedata stacks:4 被忽略 → 只加 1 层而非 4 层 |
| offset 对齐（本轮） | slam 在 0.77s 而非 1.76s 触发 → 时间点不对 |
| 消耗占位清零（本轮） | 消耗后 5s 残余显示 → 破防看起来没被清除 |

四项修正共同使 DAPAN 勾芡天赋从"永不触发"达到完整可用状态。
