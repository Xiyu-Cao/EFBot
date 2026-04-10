# ARCLIGHT consume_conduction 前端验证失败审计

> 日期：2026-04-04
> 类型：定点审计（不含实现）
> 前置：consume_conduction 上游修正（同日，simulation 层自动化测试通过但前端人工验证失败）

---

## A. 自动化测试验证到的是哪一层

**已从代码确认：自动化测试只覆盖到 simulation 层，完全没有覆盖到前端。**

| 层 | 是否覆盖 | 说明 |
|---|---------|------|
| compileScenario | ✓ | 测试手动构造带 3 tick 的 action，走 compileScenario |
| simulate / DamageHandler | ✓ | simulate() 执行 DamageHandler，consume_conduction 在 post-damage 中运行 |
| simLog | ✓ | 测试断言 simLog 有 `conduction_consumed` 条目 |
| enemy.status.conduction | ✓ | 测试断言 `result.state.enemy.status.conduction === null` |
| **前端 store 派生状态** | **✗ 未覆盖** | `computedAnomalyDebuffs` / `computedAnomalyDebuffsEffective` 未被任何测试触及 |
| **前端 debuff 栏渲染** | **✗ 未覆盖** | TimelineGrid.vue 的 `sortedDebuffStatuses` 未被测试 |
| **variant 自动切换** | **✗ 未覆盖** | 测试直接构造 3 tick action，绕过了 `computedEffectiveActions` 和 `releaseConditions` 整条路径 |

**测试通过但前端失败的根因：测试绕过了 variant 自动切换路径，直接构造了理想数据。**

---

## B. boss debuff 栏读的是哪一份状态

**已从代码确认：boss debuff 栏完全不读 simulation 状态。它读的是 timeline store 的前端派生状态。**

数据链路（已从代码确认）：

```
TimelineGrid.vue:589-591
  └─ sortedDebuffStatuses = debuffStatuses + computedAnomalyDebuffsEffective
       └─ computedAnomalyDebuffsEffective (timelineStore.js:6045-6077)
            └─ computedAnomalyDebuffs (timelineStore.js:5713-5792)
                 └─ 遍历 tracks.value[].actions[].physicalAnomaly
                      └─ 从 action 设计数据提取 type/offset/duration/stacks
                      └─ 对 type === "conductive" 用默认时长生成 debuff 条
```

**关键发现：`computedAnomalyDebuffs` 遍历的是 action 的设计数据（`physicalAnomaly`），不是 simulation 结束后的 `enemy.status`。**

这意味着：
- 导电的 debuff 条**只取决于哪个 action 的 physicalAnomaly 里写了 `conductive` 类型**
- simulation 中 `status.conduction = null` 对前端 debuff 栏**零影响**
- 这不是 consume_conduction 特有的问题——所有异常 debuff 在前端都是从 action 设计数据渲染，不反映 simulation 的实时消耗

---

## C. simulation 中 `status.conduction = null` 是否同步到前端可视层

**没有。中断点已确认。**

```
simulation 层:
  DamageHandler → consume_conduction → status.conduction = null  ← ✓ 状态已变
  simulate() 返回 result.state.enemy.status.conduction === null  ← ✓ 可被测试断言

前端可视层:
  boss debuff 栏 ← 读 computedAnomalyDebuffs ← 读 action.physicalAnomaly ← 从不读 simulation 状态
  → 导电 debuff 条始终显示（因为产生导电的 action 的 physicalAnomaly 没变）
```

**中断点：前端 debuff 栏和 simulation 状态之间没有任何连接。这是设计时架构决策，不是 bug——debuff 栏是"排轴视图"（设计时预览），不是"simulation 结果视图"。**

---

## D. team buff 不出现的原因

**已从代码确认：team buff 不出现，根因是第 3 tick 从未进入 simulation。**

这不是 target="team" 显示链路的问题，而是更上游：variant 从未被激活。

原因链：

```
1. ARCLIGHT gamedata 中有 variant v_1767273184428（强化战技，3 tick）
2. 但 ARCLIGHT gamedata 中没有 releaseConditions 配置 ← 根因
3. computedActionConditionResults 对 ARCLIGHT skill 返回无 variantId
4. computedEffectiveActions 不包含该 action
5. buildSimulationTracks() 的 damageTicks overlay 不触发
6. 编译管线收到的是 base skill 的 2 tick
7. 第 3 tick（带 consume_conduction）从未创建
8. ARCLIGHT 天赋计数器从未增长
9. team buff 从未触发
```

**已从代码确认（gamedata.json）：ARCLIGHT 条目中不存在 `releaseConditions` 字段。**

对比已有 releaseConditions 的角色，条件系统支持的条件类型（timelineStore.js:5916-5934）：
- `selfBuff`：检查自身 buff 层数
- `ultimateActive`：检查终结技是否激活

**没有"敌人身上是否有导电"的条件类型。** 即使添加 releaseConditions，现有条件系统也无法表达"敌人有 conduction 时自动切换"。

---

## E. 明确区分两件事的状态

### "后端 simulation 状态已变化" — 有条件地成立

| 条件 | 是否成立 | 说明 |
|------|---------|------|
| 自动化测试中（手动构造 3 tick action） | ✓ 成立 | conduction 被清除，simLog 有记录 |
| 真实前端运行中（用户放 base skill） | ✗ 不成立 | base skill 只有 2 tick，第 3 tick 不存在，consume_conduction 从未执行 |
| 真实前端运行中（用户放 variant skill） | **可能成立**（见下方说明） | variant skill 有 3 tick，但 multiplier 和 enhancedActionIds 匹配需验证 |

**关于手动放置 variant skill 的情况**：如果用户在排轴库中选择"强化战技"（而非"疾风迅雷"）放置，action.damageTicks 应直接包含 3 tick。但此时 `enhancedActionIds` 不包含该 action（因为不是通过 releaseConditions 自动切换），所以 `applySkillMultiplierOverlay` 用 base `multipliers[2]` = undefined → 第 3 tick 无倍率 → 不出伤害。但 boundEffects 仍会执行 → consume_conduction 应该能运行。**此路径未经人工验证。**

### "前端 UI 已显示变化" — 不成立

| 表现 | 是否成立 | 原因 |
|------|---------|------|
| boss debuff 栏导电消失 | ✗ | debuff 栏读 action 设计数据，不读 simulation 状态 |
| team buff 出现 | ✗ | 第 3 tick 未进入 simulation，天赋计数器从未增长 |
| 第 3 tick 高额伤害 | ✗ | 第 3 tick 不存在于 simulation |

---

## F. 最小修正预计落在哪些文件

**问题拆分为两个独立修正：**

### 修正 1：让第 3 tick 真实进入 simulation（必须）

| 方案 | 文件 | 说明 | 复杂度 |
|------|------|------|--------|
| **A. 添加 releaseConditions + 扩展条件类型** | gamedata.json + timelineStore.js | 需要新条件类型"敌人有导电" | 高，超出本轮范围 |
| **B. 用户手动放置 variant skill** | 无代码改动 | 依赖用户在库中选对技能 | 零，但 UX 不理想 |
| **C. ARCLIGHT skill 自动注入 3rd tick（当 enhancedActionIds 命中时）** | simulator.ts | 在 damage tick 循环后，如果 isEnhanced 且 enhancedMultipliers 有更多条目，从 gamedata variant 注入额外 tick | 中，需要 variant tick 数据源 |
| **D. 在 buildSimulationTracks 中始终用 variant damageTicks 覆盖 ARCLIGHT skill** | timelineStore.js | 不依赖 releaseConditions，直接用角色 variant 配置覆盖 | **低，推荐** |

**推荐方案 D**：在 `buildSimulationTracks()` 中，对 ARCLIGHT skill 类型的 action，即使没有 releaseConditions 触发，也检查该角色是否有对应 type 的 variant，如果有则覆盖 damageTicks。这绕过了 releaseConditions 缺失的问题，同时把 action 标记为 enhanced（加入 enhancedActionIds），使倍率也正确。

但要注意：这本质上是"ARCLIGHT skill 始终视为强化版"。这在排轴上下文中是合理的——如果用户放了 ARCLIGHT skill，且导电存在，应该自动用强化版。如果导电不存在，强化战技的 consume 只是不消耗（已有测试覆盖）。

### 修正 2：boss debuff 栏的导电消失（不在本轮范围）

boss debuff 栏从 action 设计数据渲染，这是整体架构决策。要让它反映 simulation 消耗，需要建立 simulation 状态到前端渲染的同步通道——这是全新子系统，不在本轮范围。

**本轮可接受的现状**：导电 debuff 条在 boss debuff 栏上仍显示（因为有 action 产生了它），但 simulation 内部导电已被正确消耗，DamageSummaryPanel 中的伤害数值能反映导电被消耗的影响。

---

## 附：为什么自动化测试和真实前端结果不一致

| 自动化测试做了什么 | 真实前端做了什么 |
|------------------|---------------|
| 手动构造 action，damageTicks 直接写 3 tick | action 来自 timeline store，经过 variant 自动切换路径 |
| 不经过 computedEffectiveActions | 必须经过 computedEffectiveActions |
| 不经过 releaseConditions | 必须经过 releaseConditions（ARCLIGHT 缺失） |
| 不经过 buildSimulationTracks | 必须经过 buildSimulationTracks |
| compileScenario 直接收到 3 tick | compileScenario 收到 base skill 的 2 tick |

**测试验证的是"如果第 3 tick 存在，consume_conduction 能正确工作"。但它没有验证"第 3 tick 是否真的从 variant 系统进入了 simulation"。**
