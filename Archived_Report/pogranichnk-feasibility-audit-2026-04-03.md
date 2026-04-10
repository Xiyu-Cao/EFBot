# POGRANICHNK 接入可行性审计

> 审计时间: 2026-04-03
> 前置已完成: runtime_conditional adapter 最小迁移 (WULFGARD / CHENQIANYU)
> 目的: 判断 POGRANICHNK 是否适合作为 adapter 的第一个新增样例

---

## 1. Talent 数据是否需要补全

### 现状 [已从代码确认]

`data/operators/POGRANICHNK/talents.json` 天赋 talent_0「活着的旗帜」每个阶段只有 **1 个** effect 条目：

```json
{ "type": "stat_bonus", "stat": "attack_percent", "value": 4, "unit": "percent", "scope": "runtime_conditional" }
```

天赋描述原文：
> "士气激昂效果：攻击力+4%，**源石技艺强度+4**"（E2: 攻击力+8%，源石技艺强度+8）

**确认缺失**：`originium_arts_power +4/8` 没有结构化 effect 条目。

### 最合理的补法

在同一个 stage 的 `effects` 数组中增加第二个条目：

```json
{
  "type": "stat_bonus",
  "stat": "originium_arts_power",
  "value": 4,
  "unit": "flat",
  "scope": "runtime_conditional",
  "note": "conditional buff (arts power component)"
}
```

这与天赋描述一致（两个 buff 同时获得），且不改变数据结构 schema——只是同一个 effects 数组多一个元素。

**但**这只解决数据侧。runtime 侧能否消费它，是问题 3 的范畴。

---

## 2. "每恢复 80 SP 触发一次"能否用现有 condition 闭包实现

### SP_CHANGE 事件结构 [已从代码确认]

**文件**: `simulation/events/event.types.ts:48-55`

```typescript
type SpChangeEvent = SimBaseEvent<"SP_CHANGE", {
  actorId: string;
  spChange: number;   // 正=恢复, 负=消耗
  reason: string;     // "skill" | "damage" | "execution"
  sourceId: string;
  parent: SimEvent;
}>;
```

SP_CHANGE 的 reason 值分布 [已从代码确认]：

| 来源 | reason | spChange | 文件 |
|------|--------|----------|------|
| 技能消耗 (ActionStart) | `"skill"` | 负 | ActionStartHandler.ts:80 |
| 技能返回 (ActionEnd) | `"skill"` | 正 | ActionEndHandler.ts:40 |
| 处决恢复 (ActionEnd) | `"execution"` | 正 | ActionEndHandler.ts:52 |
| 命中回复 (DamageHandler) | `"damage"` | 正 | DamageHandler.ts:243 |

### 过滤条件设计

天赋描述"通过自身技能每恢复80点技力后"——需要过滤：
- `spChange > 0`（仅恢复，排除消耗）
- `reason === "skill" || reason === "damage"`（排除 execution，两者都属于"自身技能"产生的 SP）
- `sourceMustBeWearer: true` 已由 registerTriggeredBuff 硬编码，确保只响应自身事件

这个过滤可以稳定工作 [已从代码确认]。

### 累加器最小设计

```
伪代码——闭包内维护状态:
let spAccumulator = 0;
condition: (e, ctx) => {
  if (e.payload.spChange <= 0) return false;
  if (e.payload.reason !== "skill" && e.payload.reason !== "damage") return false;
  spAccumulator += e.payload.spChange;
  if (spAccumulator >= 80) {
    spAccumulator -= 80;
    return true;  // 触发一次 buff
  }
  return false;
}
```

**状态维护位置**：condition 闭包内的 `let spAccumulator`。不需要改 helper 签名或引擎机制。

### 单次大额恢复跨多阈值的问题

如果一次 spChange = 160，上述逻辑只触发一次（TriggerProcessor 不会对同一事件重评估同一 trigger）。剩余 80 留在累加器中，下次事件时触发。

**实际影响**：单次 SP 回复通常 5-40 点（命中回复）或 20-50（技能返还），远低于 80。跨双阈值几乎不会发生，可接受的近似。

### 结论

可以用现有 registerTriggeredBuff + condition 闭包实现。**不需要改 helper 签名或引擎机制。**

---

## 3. originium_arts_power bonus 是否已有消费路径

### 现状 [已从代码确认]

`originium_arts_power` 在 simulation 中的使用方式：

| 使用位置 | 如何读取 | 用途 |
|----------|---------|------|
| `anomaly/AnomalyHandlers.ts:52` | `actor.snapshotData.stats.originium_arts_power` | 异常伤害缩放 |
| `calculation/multiplierZones.ts:208` | `state.getActor(id).snapshotData.stats.originium_arts_power` | 导电易伤公式 |
| `calculation/CalculationPipeline.ts:48` | `ctx.source.stats.originium_arts_power` | 失衡增伤系数 |
| `simulator.ts:404,433` | `engine.state.getActor(id).snapshotData.stats.originium_arts_power` | 碎甲脆弱 / 导电 debuff |

关键发现：**所有读取都直接从 `snapshotData.stats` 取值**。这是编译期快照，模拟运行期间不变。

### DynamicBonus 系统能否表达

`DynamicBonusStat` 联合类型 [已从代码确认]：

```typescript
type DynamicBonusStat =
  | "blaze_dmg" | "cold_dmg" | "emag_dmg" | "nature_dmg"
  | "physical_dmg" | "arts_dmg"
  | "attack_dmg_bonus" | "skill_dmg_bonus" | "link_dmg_bonus" | "ultimate_dmg_bonus"
  | "all_skill_dmg_bonus" | "all_dmg";
```

**`originium_arts_power` 不在其中。** DynamicBonus 系统只用于乘区加成，originium_arts_power 用于异常伤害/debuff 公式缩放——不是同一类东西。

### 如果要接入的最小补口

**不建议本轮通过 DynamicBonus 接入。** 理由：
- 所有 4+ 个读取点都从 snapshot 静态取值，要改为"snapshot + 动态 bonus"聚合，改动面大
- 收益有限：+4/8 arts_power 对异常伤害影响约 4%/8%，对物理系 POGRANICHNK 异常伤害占比极低

如果未来要补齐，最小补口是：
1. `ActorState` 增加 `artsPowerBonus: number` 动态字段
2. 各异常公式读取点改为 `snapshot.originium_arts_power + actorState.artsPowerBonus`
3. registerTriggeredBuff 的 action 中设置 artsPowerBonus

**这不是本轮应该做的事。**

---

## 结论

**POGRANICHNK 适合作为 P2 第二阶段唯一新增样例**，但需接受一个妥协：只实现 attack_percent 部分，originium_arts_power 暂缺。

### 前置清单

| 前置 | 状态 | 工作量 |
|------|------|--------|
| talent 数据补全 (加第二个 effect 条目) | 需做，但 runtime 暂不消费它 | ~5 行 JSON |
| SP 累加器 condition 闭包 | adapter 内用闭包实现 | ~15 行 |
| mapEffectToBonus 支持 attack_percent | ✅ 已有 | 0 |
| originium_arts_power 动态 bonus | **暂不做**——发 diagnostic warning | 0 |
| ICD | 天赋描述不含 ICD，无需 | 0 |

### 风险评估

- attack_percent 是伤害主要贡献（直接影响 ATK → 影响所有技能伤害）
- originium_arts_power +4/8 缺失只影响异常伤害缩放，对物理系 POGRANICHNK 影响极小
- SP 累加器用闭包实现是干净的局部状态，不影响其他角色
- 前端可观察变化：POGRANICHNK 排轴中使用技能恢复 SP 后，伤害统计面板后续伤害数值会升高（ATK% buff 叠层可见）
