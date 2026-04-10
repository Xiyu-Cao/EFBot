# ARCLIGHT 战技 consume_conduction 定点审计

> 日期：2026-04-04
> 类型：定点审计（不含实现）

---

## A. `consume_conduction` 代码入口

**已从代码确认：**

| 文件 | 位置 | 职责 |
|------|------|------|
| `simulation/events/DamageHandler.ts:58-72` | postDamageRegistry | consume_conduction handler 定义 |
| `simulation/events/DamageHandler.ts:191-208` | handle() post-damage 循环 | 遍历 tick.boundEffects，执行 post-damage handler |
| `public/gamedata.json` ARCLIGHT variant | `v_1767273184428` 第 3 tick | `boundEffects: ["consume_conduction"]` 标签来源 |
| `simulation/data/skillMultipliers.ts:80-100` | ARCLIGHT.skill | `enhancedMultipliers: [1.01, 1.01, 4.05]` — 第 3 tick 倍率 |

---

## B. 执行时序

**已从代码确认：post-damage。**

DamageHandler.handle() 执行顺序（DamageHandler.ts:147-234）：

```
1. 检查 blockedActionIds → 跳过被封禁的动作
2. Pre-damage boundEffects 循环（line 152-157）
3. DamageResolver.resolve()（line 162-188）← 导电易伤在此生效
4. Post-damage boundEffects 循环（line 191-208）← consume_conduction 在这里执行
5. simLog DAMAGE_TICK
6. STAGGER_CHANGE / SP_CHANGE 后续事件
```

**时序正确**：先结算伤害（享受导电易伤），再消耗导电。

---

## C. 挂 `consume_conduction` 标签的 tick

**已从代码确认：**

ARCLIGHT gamedata 中强化战技变体 `v_1767273184428`：

| tick | offset | stagger | sp | boundEffects | multiplier |
|------|--------|---------|----|--------------|----|
| 0 | 0.63 | 0 | 0 | [] | 1.01 |
| 1 | 0.80 | 5 | 0 | [] | 1.01 |
| **2** | **1.20** | **5** | **30** | **["consume_conduction"]** | **4.05** |

**基础战技（非强化）只有 2 个 tick**，无 boundEffects。

---

## D. handler 读取的状态字段

**已从代码确认（DamageHandler.ts:58-72）：**

```typescript
postDamageRegistry.set("consume_conduction", (e, ctx) => {
  const status = ctx.state.enemy.status;        // ← EnemyStatusState
  if (status.conduction !== null) {              // ← 检查 conduction 字段
    // ... simLog ...
    status.conduction = null;                    // ← 直接置 null
  }
});
```

读取：`ctx.state.enemy.status.conduction`（类型 `ConductionState | null`）

---

## E. consume 成功后如何清除

**已从代码确认：**

`status.conduction = null`（DamageHandler.ts:70）

直接赋值 null，不走 `clearConduction()` 方法。效果等价——`clearConduction()` 也是 `this.conduction = null`（EnemyStatusState.ts:183-185）。

---

## F. 为什么战技无法正确消耗导电 ⭐ 根因

**已从代码确认：第 3 tick 从未进入 simulation。**

### 完整因果链

```
1. 用户在排轴放置 ARCLIGHT skill（基础技能，2 tick）
2. 变体条件系统检测到导电 → computedActionConditionResults 标记该 action 为 enhanced
3. computedEffectiveActions 计算 overlay:
   → duration: ✓ 覆盖
   → gaugeGain: ✓ 覆盖
   → teamGaugeGain: ✓ 覆盖
   → damageTicks: ✗ 未覆盖 ← 根因
4. buildSimulationTracks() 构造模拟用轨道 → action.damageTicks 仍是基础技能的 2 tick
5. compileScenario → compileTimeline → resolvedDamageTicks 只有 2 tick
6. simulator.ts 遍历 resolvedDamageTicks（line 273）：
   → tickIndex 0 → multiplier = enhancedMultipliers[0] = 1.01 ✓
   → tickIndex 1 → multiplier = enhancedMultipliers[1] = 1.01 ✓
   → tickIndex 2 → 不存在，循环结束 ← 第 3 tick 从未创建
7. DamageHandler 从未收到带 boundEffects: ["consume_conduction"] 的 tick
8. consume_conduction handler 从未执行
9. conduction 永远不被消耗
```

### 对比：哪些变体属性能正确 overlay

| 属性 | computedEffectiveActions 是否覆盖 | 结果 |
|------|--------------------------------|------|
| duration | ✓ 覆盖 | 前端动作框正确加长 |
| gaugeGain | ✓ 覆盖 | 量表充能正确 |
| teamGaugeGain | ✓ 覆盖 | 团队量表正确 |
| **damageTicks** | **✗ 未覆盖** | **第 3 tick 丢失** |
| physicalAnomaly | ✗ 仅前端可视覆盖 | 前端图标正确但 simulation 不受影响 |

**已从代码确认（timelineStore.js:6087-6091）：**

```javascript
map.set(action.instanceId, {
    duration:       variant.duration       ?? action.duration,
    gaugeGain:      variant.gaugeGain      ?? action.gaugeGain,
    teamGaugeGain:  variant.teamGaugeGain  ?? action.teamGaugeGain,
    // ← damageTicks 未在此处覆盖
})
```

### enhancedActionIds 的局限

**已从代码确认（simulator.ts:274, skillMultipliers.ts:140）：**

`enhancedActionIds` 仅传入 `applySkillMultiplierOverlay` 的 `useEnhanced` 参数，作用是在 `multipliers` 和 `enhancedMultipliers` 数组之间选择。**它不创建新 tick。**

```typescript
// skillMultipliers.ts:140
const arr = (useEnhanced && entry.enhancedMultipliers) ? entry.enhancedMultipliers : entry.multipliers;
return arr[tickIndex]; // ← 只能读到已有 tickIndex 范围内的值
```

即使 `enhancedMultipliers` 有 3 个值 `[1.01, 1.01, 4.05]`，当只有 2 tick 时 `tickIndex` 最大只到 1，`enhancedMultipliers[2]` 从未被读取。

---

## G. 最小修正预计落点

| 文件 | 改动 | 必须/可选 |
|------|------|---------|
| `stores/timelineStore.js` | `computedEffectiveActions` 增加 `damageTicks` overlay | **必须** |
| `stores/timelineStore.js` 或 `simulation/compiler/compileScenario.ts` | 编译前将变体 damageTicks 应用到 action | **必须** |
| 其他 simulation 文件 | 不需要改 | — |

### 两种修正路径

**路径 A（推荐）：在 `computedEffectiveActions` 中补 damageTicks overlay**

1. `computedEffectiveActions` 增加 `damageTicks` 字段
2. `buildSimulationTracks()` 或 `compiledScenario` computed 中，对每个 enhanced action 应用 damageTicks overlay
3. 编译时 action 自动拥有 3 tick → 第 3 tick 带 boundEffects → consume_conduction 生效

**路径 B：在 simulator.ts 注入额外 tick**

在 `resolvedDamageTicks.forEach` 循环之后，如果 `isEnhanced` 且 `enhancedMultipliers` 有更多条目，注入合成 tick。
缺点：需要知道合成 tick 的 offset / stagger / sp / boundEffects，这些信息不在 simulator 的作用域内。

**推荐路径 A**：让正确的数据从源头流入，不在下游打补丁。

---

## H. 是否能在不扩成通用 consume system 的前提下解决

**可以。已从代码确认。**

- `consume_conduction` handler 已正确注册且逻辑无误（DamageHandler.ts:58-72）
- `DamageHandler.handle()` 的 boundEffects 循环已正确实现（DamageHandler.ts:191-208）
- 问题完全在**数据层**：第 3 tick 没有进入编译管线
- 不需要新建 consume 机制 / 事件类型 / handler
- 只需要让变体的 damageTicks 正确 overlay 到 action 上

---

## I. 前端验证信号

| 信号 | 怎么看 | 预期（修正后） |
|------|-------|-------------|
| simLog | 搜索 `"conduction_consumed"` | 强化战技第 3 tick 后出现 "Conduction consumed by ARCLIGHT" |
| boss debuff 栏 | 观察导电状态 | 强化战技第 3 tick 后导电从 debuff 栏消失 |
| DAMAGE_TICK damage | 第 3 tick 伤害 | 出现 4.05 倍率的高额单发伤害（显著高于前 2 tick） |
| 荒野游人 team buff | 3 次消耗后 | 三次成功 consume 后全队出现 arclight_wilderness_wanderer buff |

**验证步骤**：
1. 对敌人施加导电（用 ARCLIGHT 终结技 → conductive 异常）
2. 放 ARCLIGHT 强化战技
3. 确认第 3 tick 出现在 simLog + 导电被消耗
4. 重复 3 次后确认 team buff 出现

---

## 附：受影响的系统边界

本问题仅影响**变体 damageTicks overlay**机制。以下不受影响：

- consume_conduction handler 本身（逻辑正确）
- DamageHandler boundEffects 循环（逻辑正确）
- ARCLIGHT 荒野游人天赋 trigger（逻辑正确，只是从未收到过 consume_conduction tick）
- 其他角色的 boundEffects（如 estella_phys_vuln_if_frozen，无 variant 3rd tick 问题）
- 非 damageTicks 的变体属性（duration/gaugeGain/teamGaugeGain 均正确 overlay）
