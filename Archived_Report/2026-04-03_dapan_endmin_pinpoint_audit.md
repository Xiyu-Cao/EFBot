# Talent Conditional Registry 定点审计：DAPAN + ENDMINISTRATOR

> 日期：2026-04-03
> 类型：定点审计（不含实现）

---

## A. talentConditionalRegistry 现状

**已从代码确认（talentConditionalRegistry.ts:107-163）：**

registry 当前有 3 个角色：
- WULFGARD: event=APPLY_DIRECT_ANOMALY, condition=anomalyType=burn, refresh, 10s
- CHENQIANYU: event=DAMAGE_TICK, condition=action type in skill/link/ultimate, stack max 5, 10s
- POGRANICHNK: event=SP_CHANGE, conditionFactory(SP accumulator>=80), stack max 3, 20s

**测试文件（talentConditionalRegistry.test.ts，434 行）：**
- POGRANICHNK: 8 tests（SP 阈值、叠层、max 3、过期、数据驱动）
- WULFGARD: 2 tests（burn 触发、非 burn 不触发）
- CHENQIANYU: 2 tests（skill 触发叠层、attack 不触发）
- mapEffectToBonus: 4 tests（覆盖 attack_percent / blaze_dmg / 不支持类型）

**registerTriggeredBuff**（simulator.ts:140-208）：
- 硬编码 `sourceMustBeWearer: true`
- 支持 stack（independent duration）和 refresh（no stack）两种模式
- 支持 cooldownId + cooldownDuration

---

## B. talents.json 结构化字段检查

### DAPAN（已从代码确认 — talents.json:21-36）

```json
{
  "type": "damage_bonus",
  "stat": "physical_dmg",
  "value": 4,        // upgrade: 6
  "unit": "percent",
  "scope": "runtime_conditional",
  "note": "conditional self buff"
}
```

字段完备：type ✓, stat ✓, value ✓, scope=runtime_conditional ✓
`mapEffectToBonus("damage_bonus", "physical_dmg", 4)` → `[{ stat: "physical_dmg", value: 4 }]` ✓ 已支持

### ENDMINISTRATOR talent_0（已从代码确认 — talents.json:25-35）

```json
{
  "type": "stat_bonus",
  "stat": "attack_percent",
  "value": 15,       // upgrade: 30
  "unit": "percent",
  "scope": "runtime_conditional",
  "note": "conditional buff"
}
```

字段完备：type ✓, stat ✓, value ✓, scope=runtime_conditional ✓
`mapEffectToBonus("stat_bonus", "attack_percent", 15)` → `[{ stat: "all_dmg", value: 15, zone: "attackPercent" }]` ✓ 已支持

---

## C. DAPAN 的 APPLY_PHYSICAL_ANOMALY payload 是否足够

**已从代码确认（anomaly/events.ts:27-34）：**

```ts
payload: {
  physicalType: PhysicalAnomalyType;  // "launch"|"knockdown"|"armorBreak"|"slam"
  sourceActorId: string;
  targetId: string;
  sourceSkillId?: string;
}
```

payload 有 `physicalType` ✓ 和 `sourceActorId` ✓（extractSourceId 可提取）。

### 关键发现：DAPAN 自身技能不产生 armorBreak

**已从代码确认（compiler/fixture/scenario-1.ts:774-904）：**
- DAPAN_ultimate: physicalAnomaly = knockup + knockdown
- DAPAN_skill: physicalAnomaly = knockup
- DAPAN_link: physicalAnomaly = stagger（映射为 slam）

**DAPAN 的技能均不产出 `armor_break` 类型。**

### 这对触发条件的影响

天赋描述："每消耗1层破防后，造成的物理伤害+4%"

"破防"在代码中的行为（已从 PhysicalReactionResolver.ts 确认）：
- 任意物理异常作用于无 break 的敌人 → addBreakStack（stacks 1→2→3→4）
- `hasBreak()` = `stacks > 0`（不是 stacks >= 4）
- 当 `hasBreak()` 为 true 时，按 physicalType 分支：
  - **slam** → damage + **clearBreak()** → physicalBreak = null ← **消耗发生**
  - **armorBreak** → damage + **clearBreak()** + phys vuln ← **消耗发生**
  - launch/knockdown → damage + addBreakStack（不消耗）

所以 DAPAN 的 slam（stagger 映射）**可以触发"消耗破防"**——当敌人已有 break stacks 且 slam 反应清除它们时。

### 但存在"每消耗1层"的语义问题

`clearBreak()` 一次性清除全部 stacks（设 physicalBreak = null）。
`stacksBeforeReaction` 在 handler 内部被捕获（第 62 行），但不传递到事件 payload 或 condition callback。

TriggerProcessor 的 condition 只看到 handler 后的状态（physicalBreak === null），**无法知道消耗了多少层**。

**这意味着**：
- 如果解释为"每次 break 清除 = 1 次触发 = 1 层 buff" → 可行，但不精确
- 如果解释为"清除 N 层 = N 层 buff" → 当前无法实现，因为 consumed count 不可获取
- registerTriggeredBuff 的 trigger action 每次只能添加 1 个 stack

### DAPAN 结论

**不是** 0 系统改动纯 descriptor 落地。存在以下需要解决的设计点：

1. 条件不是 `physicalType === "armorBreak"`（原方案错误），而应是"break 被清除"
2. 检测方式：`ctx.state.enemy.status.physicalBreak === null`，但需排除"从未有过 break"的情况
3. "每消耗1层"的精确语义：当前系统单次清除全部 stacks，无法按层触发
4. `sourceMustBeWearer: true` 限制：只有 DAPAN 自身的物理异常应用才能触发；如果队友的 slam 清除了 break，DAPAN 不会受益

**可行的简化方案（需接受近似）**：
- 每次 break 清除视为获得 max（4）层 buff（因为 break 通常积累到 4 层才有反应机会）
- 或者：每次清除视为 1 层 buff，允许多次 break 循环逐步叠加
- 使用 conditionFactory 追踪 break 状态变化

---

## D. ENDMINISTRATOR 的 APPLY_MAGIC_ATTACHMENT + attachment 消耗检测

### 关键发现：源石结晶 ≠ 通用魔法附着

**已从代码确认（ENDMINISTRATOR/skills.json 搜索结果）：**

ENDMINISTRATOR 连携技描述：
> "冲到敌人身边，对其造成物理伤害，并**附着源石结晶**，在一段时间内将其封印。施加**物理异常或破防**会**消耗源石结晶**并额外造成物理伤害。"

终结技描述：
> "如果敌人身上附着源石结晶，则**消耗源石结晶**并额外造成一次物理伤害。"

**"源石结晶"是 ENDMINISTRATOR 独有的角色机制，不是通用的 4 元素魔法附着系统（fire/cold/electro/nature）。**

**已从代码确认（fixture/scenario-2.ts, simulator.fixture.ts）：**
- ENDMINISTRATOR 连携技的 effect type = `"endmin_debuff"`
- `"endmin_debuff"` 不在任何路由 map 中（不在 ELEMENT_ATTACH_MAP / PHYSICAL_ANOMALY_MAP / DIRECT_ANOMALY_MAP / SCNEARIO_EFFECT_TYPE_MAP）

**已从代码确认（simulator.ts effect 路由逻辑，第 340-487 行）：**
- `endmin_debuff` 走到最后的 legacy fallback
- `SCNEARIO_EFFECT_TYPE_MAP` 只含 8 种已知类型（4 physical + 4 element），不含 endmin_debuff
- 结果：**diagnostics.warn("UNKNOWN_EFFECT_TYPE", ...)** → 效果被跳过

**已从 runSimulation.test.ts:28 确认注释：**
> `"endmin_debuff", "frozen", "ice_shatter", "break" are not in the map`

### ENDMINISTRATOR 结论

**方案 A 不可行。** 原因：

1. "源石结晶被消耗"是角色独有机制，不是通用 APPLY_MAGIC_ATTACHMENT 事件
2. 结晶的应用（endmin_debuff）当前被 simulation 跳过，**敌人身上根本没有结晶状态**
3. 结晶的消耗（物理异常或终结技触发）**没有对应的事件**
4. 因此无论用 APPLY_MAGIC_ATTACHMENT 还是 ANOMALY_DAMAGE，都**无法检测到结晶消耗**

要实现此天赋，需要先完成：
- 新增结晶状态（EnemyStatusState 或 enemy EffectManager）
- 新增 endmin_debuff 的路由和应用逻辑
- 新增结晶消耗事件（或在现有事件上附加语义）

**这是 C 类工作，不属于本轮范围。**

### ENDMINISTRATOR talent_1 (现实静滞) 的附带确认

**已从代码确认（simulator.ts:102-134）：**

runtime_passive 处理逻辑将 `damage_bonus/physical_dmg` 注册为永久 fragility buff：
```ts
if (e.type === "damage_bonus" && e.stat && e.value) {
  dynBonuses.push({ stat: e.stat, value: e.value, zone: "fragility" });
}
```

天赋描述："**附着源石结晶的敌人**受到的物理伤害+10/20%"

当前实现将其视为**永久 buff**，但实际应仅在敌人有结晶时生效。这是一个已知的近似——由于结晶机制未建模，永久 buff 是当前的 fallback。**本轮不改。**

---

## E. DAPAN 能否 0 系统改动纯 descriptor 落地？

**不能。** 需要解决：

1. **条件逻辑比 `physicalType === "armorBreak"` 复杂**：
   - DAPAN 自己不产出 armorBreak，产出的是 slam（stagger 映射）
   - 触发条件是"break 被清除"，不是"特定 physicalType 被应用"
   - 需要 conditionFactory 检测 `physicalBreak` 从有到 null 的转换

2. **"每消耗1层"的精确实现需要 consumed count**：
   - clearBreak() 一次清除全部 stacks
   - TriggerProcessor 无法获取 consumed count
   - 需要选择近似策略（每次清除 = 4 层 or 1 层）

**可在不引入新系统的前提下实现**（不需要新事件类型、新状态），但需要：
- 一个 conditionFactory（类似 POGRANICHNK 的模式）
- 一个关于"每消耗1层"语义的明确决策

---

## F. ENDMINISTRATOR 方案 A 是否可行？

**不可行。** 

- 我之前假设"源石结晶"= 通用魔法附着，**这个假设是错的**
- 源石结晶是 ENDMINISTRATOR 独有的角色机制（endmin_debuff）
- 该机制在当前 simulation 中完全未建模（endmin_debuff 被跳过）
- 没有结晶状态 → 没有消耗事件 → 无法触发天赋

---

## G. 本轮最小改动涉及文件

### 如果只做 DAPAN：

| 文件 | 改动类型 |
|------|----------|
| `simulation/data/talentConditionalRegistry.ts` | 新增 DAPAN descriptor（含 conditionFactory） |
| `simulation/data/talentConditionalRegistry.test.ts` | 新增 DAPAN 测试 |

不需要改其他文件。不需要新事件、新状态、新路由。

### ENDMINISTRATOR：本轮不可行

需要先完成结晶机制建模（多个文件），不属于 registry 扩展范围。

---

## H. 前端验证信号

### DAPAN

验证前提：排轴中需要有至少 2 次物理异常应用——第 1 次建立 break stacks，后续 slam 类型触发 break 清除 → buff 出现。

| 验证点 | 观察什么 |
|--------|----------|
| **simLog** | 看到 `ANOMALY_STATUS_CHANGE: "break cleared"` 后，紧接着应有 DAPAN 的 buff effect 开始 |
| **DamageSummaryPanel** | DAPAN 在 buff 激活期间的物理伤害应比 buff 前更高 |
| **aggregateZoneBonuses** | 在测试中，break 清除后 `aggregateDynamicBonuses` 应包含 physical_dmg bonus |

### ENDMINISTRATOR

**本轮无法验证**——结晶机制未建模。

---

## I. 本轮必须明确不做的事

1. **不做 ENDMINISTRATOR 的结晶机制建模**（endmin_debuff 路由、结晶状态、消耗事件）
2. **不改 ENDMINISTRATOR 的 runtime_passive 近似**（talent_1 永久 fragility buff）
3. **不新增事件类型**（不加 BREAK_CONSUMED 之类的新事件）
4. **不改 extractSourceId 或 sourceMustBeWearer 逻辑**
5. **不扩展到其他角色**
6. **不重构 registerTriggeredBuff 支持多 stack 单次添加**
7. **不做 normal 模式、展示层、UI 优化**

---

## 总结：与上一轮审计结论的修正

| 项目 | 上轮结论 | 本轮定点审计后 |
|------|----------|---------------|
| DAPAN 分类 | A 类（0 改动） | **降级**：可行但需 conditionFactory + 语义决策。不是最简单的 descriptor 落地。 |
| DAPAN 触发条件 | `physicalType === "armorBreak"` | **错误**。DAPAN 不产出 armorBreak。实际是"break 被清除"（slam/armorBreak 反应后 physicalBreak === null）。 |
| ENDMINISTRATOR 分类 | B 类（少量工作） | **降级为 C 类**。源石结晶是角色独有机制，完全未建模。不可能通过 registry 扩展解决。 |
| ENDMINISTRATOR 触发方案 | APPLY_MAGIC_ATTACHMENT + attachment === null | **不可行**。源石结晶 ≠ 通用魔法附着。endmin_debuff 被 simulation 跳过。 |

**DAPAN 仍然是本轮唯一可推进的角色。** 实现需要：
1. 确认"每消耗1层"的近似策略
2. 编写 conditionFactory 检测 break 清除
3. 补测试
