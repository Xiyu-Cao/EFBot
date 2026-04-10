# DAPAN 勾芡 — 定点实现审计

> 日期：2026-04-03
> 类型：定点审计（不含实现）

---

## A. talents.json 当前结构

**已从代码确认（data/operators/DAPAN/talents.json:21-36）：**

```json
{
  "type": "damage_bonus",
  "stat": "physical_dmg",
  "value": 4,        // upgrade stage: 6
  "unit": "percent",
  "scope": "runtime_conditional",
  "note": "conditional self buff"
}
```

- type: `damage_bonus` ✓
- stat: `physical_dmg` ✓
- value: 4/6 ✓（数据驱动）
- scope: `runtime_conditional` ✓
- **当前未被 registry 消费**（TALENT_CONDITIONAL_TRIGGERS 中没有 DAPAN 条目）
- `mapEffectToBonus("damage_bonus", "physical_dmg", 4)` → `[{ stat: "physical_dmg", value: 4 }]` → 增伤区。**注意**：人工标注指定增伤区，与此一致。

---

## B. break / armorBreak / physical anomaly 在 runtime 中的表示

**已从代码确认：**

### 状态存储
- `EnemyStatusState.physicalBreak: PhysicalBreak | null`（EnemyStatusState.ts:37）
- `PhysicalBreak = { stacks: number, expiresAt: number }`（types.ts:36-38）
- `hasBreak()` = `stacks > 0`（EnemyStatusState.ts:80-82）
- `addBreakStack()` = `stacks = min(4, stacks + 1)`（EnemyStatusState.ts:88-98）
- `clearBreak()` = `physicalBreak = null`（EnemyStatusState.ts:100-102）

### 事件触发
- `APPLY_PHYSICAL_ANOMALY` event 在 simulator.ts 的 action.effects.forEach 循环中入队
- payload: `{ physicalType, sourceActorId, targetId, sourceSkillId }`

### handler 处理（ApplyPhysicalAnomalyHandler → resolvePhysicalAnomaly）
- 无 break 时：addBreakStack → 返回 BREAK_CHANGED
- 有 break 时（按 physicalType）：
  - **slam / armorBreak** → `stacksBeforeReaction = getBreakStacks()` → damage → `clearBreak()` → BREAK_CLEARED
  - **launch / knockdown** → damage → addBreakStack（**不清除**）

### 清除语义
- `clearBreak()` 被调用 → `physicalBreak = null`
- **清除前**，`stacksBeforeReaction` 已在 resolver 内部被捕获（第 62 行）
- **清除后**，这个值既不在 event payload 中，也不传递到 TriggerProcessor

### DAPAN gamedata 确认（已从代码确认：gamedata.json:6516-6675）
- **skill**: physicalAnomaly = `knockup`（→ launch）— **不清除 break**
- **link**: physicalAnomaly = `stagger`（→ slam）— **清除 break** ✓
- **ultimate**: physicalAnomaly = `knockup` + `knockdown` — **不清除 break**

**只有 DAPAN 的连携技（link）可以触发 break 消耗。**

---

## C. 为什么不能按 `physicalType === "armorBreak"` 直接落地

**已从代码确认的 3 层不匹配：**

1. **DAPAN 不产出 armorBreak**。DAPAN 的三个技能分别产出 knockup/stagger(slam)/knockdown，没有 armorBreak。条件 `physicalType === "armorBreak"` 永远不会被 DAPAN 自身触发。

2. **触发语义不是"armorBreak 被施加"，而是"break 被清除"**。人工拍板的语义是"消耗破防层"，在代码中对应 `clearBreak()` 被调用（slam 或 armorBreak 对有 break 的敌人使用时）。

3. **consumed count 不在 event payload 中**。`stacksBeforeReaction` 在 PhysicalReactionResolver 内部被捕获（第 62 行），但不传递到事件 payload 或 TriggerProcessor。TriggerProcessor 的 condition 只能看到 handler 后的状态（`physicalBreak === null`），无法知道消耗了多少层。

---

## D. 最小缺口是什么

**缺的只有一个东西：trigger action 中需要知道消耗了多少层 break stacks，以便一次添加 N 个 buff 层。**

当前 registerTriggeredBuff 的 trigger action 每次调用 addStackWithIndependentDuration 恰好 1 次。DAPAN 需要单次触发添加 N 个（N = consumed stacks，最大 4）。

**解决方案不需要改 event payload 或新建事件类型。** 可以完全在 condition 闭包 + trigger action 闭包内解决：

关键洞察：condition callback 和 trigger action callback 是**同一个 trigger 对象上的两个属性**，它们在同一轮 TriggerProcessor 评估中顺序执行（先 condition 返回 true，再执行 action）。如果 condition 闭包和 action 闭包**共享外层变量**（通过闭包捕获），condition 可以把 consumed count 写入共享变量，action 读取并循环添加。

```
// 伪代码 — 共享闭包
let _consumedStacks = 0;

condition: (e, ctx) => {
  if (breakJustCleared) { _consumedStacks = N; return true; }
  else { updateTracking(); return false; }
},
action: (e, ctx) => {
  for (let i = 0; i < _consumedStacks; i++) addStack();
}
```

**这不需要改 registerTriggeredBuff 的接口。** 只需要把 condition 和 action 都写成自定义 trigger（直接在 simulator.ts 的 DAPAN 注册逻辑中构造），而不是走 registry → registerTriggeredBuff 的标准路径。

**但这就绕开了 talentConditionalRegistry 的声明式模式。**

### 两个可选落点

**方案 1（推荐）：在 talentConditionalRegistry.ts 中用 conditionFactory + 自定义 action**

扩展 TalentConditionalDescriptor 新增一个可选的 `actionOverride` 字段：

```ts
actionOverride?: (e: any, ctx: any, opts: { bonuses, duration, stack, ... }) => void;
```

如果 `actionOverride` 存在，registerTalentConditionals 将它传入 registerTriggeredBuff 的 action 中，替代默认的"添加 1 个 stack"逻辑。

DAPAN 的 conditionFactory 和 actionOverride 共享一个闭包工厂，condition 写入 `_consumedStacks`，actionOverride 读取并循环。

改动量：registry.ts 接口 +1 字段，registerTalentConditionals +5 行，simulator.ts registerTriggeredBuff +3 行。

**方案 2（更小但更 ad-hoc）：直接在 simulator.ts 中用硬编码注册**

在 simulator.ts 的 registerTalentConditionals 调用之后，为 DAPAN 单独写一段注册逻辑（不走 registry），直接构造带共享闭包的 Effect + trigger。

改动量：simulator.ts +30 行。不改 registry 接口。

**推荐方案 1**——改动量几乎相同，但保持了 registry 的统一性。

---

## E. 最小缺口落点

**优先级：**

1. **`simulation/data/talentConditionalRegistry.ts`**（核心）— 新增 `actionOverride` 字段到 descriptor + registerTalentConditionals 识别并传入
2. **`simulation/simulator.ts`**（极小补口）— registerTriggeredBuff 需要支持 `actionOverride`：在 trigger action 中如果 opts 有 actionOverride，调用它替代默认逻辑
3. **`simulation/data/talentConditionalRegistry.test.ts`**（测试）— DAPAN 测试

**理由**：缺口在 registry → registerTriggeredBuff 接口之间。registry 声明意图（包括 condition + stackCount），simulator.ts 执行。补口最自然的落点就是这两者。

---

## F. 是否能在不新建事件类型的前提下完成？

**可以。**

最小方案触发链：

```
1. DAPAN 连携技（link）产生 APPLY_PHYSICAL_ANOMALY (type=slam)
2. ApplyPhysicalAnomalyHandler 执行：
   - 如果 enemy hasBreak()：stacksBeforeReaction = getBreakStacks()，clearBreak()
   - 如果 enemy !hasBreak()：addBreakStack
3. TriggerProcessor 评估 DAPAN carrier effect 上的 trigger：
   - condition（conditionFactory 闭包）：
     a. 每次 APPLY_PHYSICAL_ANOMALY 时，检查 physicalBreak 状态
     b. 如果 physicalBreak 不为 null → 更新 lastBreakStacks 追踪值，返回 false
     c. 如果 physicalBreak 为 null 且 lastBreakStacks > 0 → 消耗发生！
        记录 consumedCount = lastBreakStacks，清零 lastBreakStacks，返回 true
   - actionOverride（共享闭包）：
     读取 consumedCount，循环添加 min(consumedCount, max) 个 stack
4. DAPAN 的 physical_dmg buff 层数正确加入 actor effects
```

**不需要新事件类型。不需要改 event payload。不需要改 PhysicalReactionResolver。**

---

## G. 预计改动文件

| 文件 | 角色 | 改动描述 |
|------|------|---------|
| `simulation/data/talentConditionalRegistry.ts` | **核心实现** | 1) descriptor 接口新增 `actionOverride` 字段。2) registerTalentConditionals 传入 actionOverride。3) DAPAN descriptor（含 conditionFactory + actionOverride 共享闭包） |
| `simulation/simulator.ts` | **极小补口** | registerTriggeredBuff 的 trigger action 中增加 actionOverride 分支（~5 行） |
| `simulation/data/talentConditionalRegistry.test.ts` | **测试** | DAPAN 勾芡 测试（~7-8 个 case） |

不涉及任何其他角色。不涉及 PhysicalReactionResolver、EnemyStatusState、event types。

---

## H. 前端验证信号（按有效性排序）

1. **simLog 中的 buff 出现**（最直接）— 在 break 被 slam 清除后，simLog 应立即有 DAPAN 的 buff effect 开始记录。观察 buff 层数应等于消耗的 break stacks 数。

2. **aggregateZoneBonuses / DamageSummaryPanel 中的物理伤害变化**（最有说服力）— break 清除后，DAPAN 的后续物理伤害应在增伤区增加。如果消耗 4 层，增伤 = 4 × 4% = 16%（E1）或 4 × 6% = 24%（E2）。

3. **buff 过期后伤害回落**（回归验证）— 10s 后 buff 应过期，伤害应回落。

**为什么这个顺序**：simLog 是最可靠的即时信号（不受其他乘区干扰）；DamageSummaryPanel 是最终可观测值；buff 过期是正确性回归。

---

## I. 本轮必须明确不做

1. 不新建事件类型（不加 BREAK_CONSUMED 等）
2. 不改 PhysicalReactionResolver（不改 outcomes 结构、不加 consumed count 到 payload）
3. 不改 EnemyStatusState 接口
4. 不做 ENDMINISTRATOR / ARCLIGHT / 其他角色
5. 不做 extra damage / incoming damage / gauge 扩展
6. 不做 target="team" 补口（那是 ARCLIGHT 的需求）
7. 不做 UI 优化或 normal 模式规则
8. 不重构 registerTriggeredBuff 的核心逻辑——只加一个 actionOverride 旁路

---

## 总判断

**本轮确实只差一个极小补口：让 trigger action 支持自定义逻辑（actionOverride），使 condition 闭包中记录的 consumed count 能被 action 读取并循环添加 N 个 stack。**

**最稳落点**：在 `talentConditionalRegistry.ts` 的 descriptor 接口上新增 `actionOverride` 可选字段，在 `simulator.ts` 的 registerTriggeredBuff trigger action 中加 ~5 行旁路分支。DAPAN 的 conditionFactory + actionOverride 用一个共享闭包工厂实现，所有状态（lastBreakStacks / consumedCount）封闭在闭包内。

总改动量估计：~60 行核心 + ~80 行测试。
