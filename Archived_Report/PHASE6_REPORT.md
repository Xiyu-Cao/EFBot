# Phase 6 — Formula Alignment, Enemy Template, Zone Completion Report

## Summary

189 tests pass, 0 TypeScript errors. This phase eliminates the most dangerous dual-truth sources and fills the critical multiplier zone / enemy template gaps.

---

## 双真值源修复

### 1. 异常伤害公式 — 已统一

**之前**: `utils/anomalyCalc.js` (UI) 和 `calculation/anomalyDamageCalc.ts` (simulation) 各自维护不同公式，后者是 placeholder。

**之后**: `anomalyDamageCalc.ts` 成为单一真值源，包含所有已确认公式。`anomalyCalc.js` 改为从中导入共享函数 + 提供 UI 投影包装。

| 公式 | 旧 placeholder | 新真值 |
|---|---|---|
| 法术爆发 | `{1:0.5, 2:0.8, 3:1.2, 4:1.8}` 查表 | `1.6 × spellLevelCoef × artsPowerDamageMult` |
| 法术异常触发 | `{burn:1.0, freeze:0.8, ...}` 查表 | `0.8 × (1+level) × spellLevelCoef × artsPowerDamageMult` |
| 燃烧 tick | `{1:0.3, 2:0.5, 3:0.7, 4:1.0}` 查表 | `0.12 × (1+level) × spellLevelCoef × artsPowerDamageMult` |
| 碎冰 | `{1:1.5, 2:2.0, 3:2.5, 4:3.0}` 查表 | `1.2 × (1+level) × spellLevelCoef × artsPowerDamageMult` |
| 击飞/倒地 | `launch:0.8, knockdown:0.8` | `1.2 × physLevelCoef × artsPowerDamageMult` |
| 猛击 | `slam:1.2` | `1.5 × (1+stacks) × physLevelCoef × artsPowerDamageMult` |
| 碎甲 | `armorBreak:1.0` | `0.5 × (1+stacks) × physLevelCoef × artsPowerDamageMult` |

### 2. artsPowerDamageMult — 统一进入异常倍率

**之前**: `computeSpecialZone` 用 `1 + artsPower/100`，与 anomaly 倍率函数分开计算，存在双重乘的风险。

**之后**: `artsPowerDamageMult` 已内含在每个异常倍率函数中（如 `getMagicBurstMultiplier(artsPower)`）。`computeSpecialZone` 不再重复乘 artsPower，返回 1。

### 3. 静态词条 — 不再重复加算

**之前**: `definitions.ts` 中 `actor.snapshotData.stats.physical_dmg += 28`（典范）、`stats.originium_arts_power += 30`（动火用/脉冲式）、`stats.attack *= 1.196`（蚀迹）。

**之后**: 所有 `stats +=` 和 `stats *=` 已删除。注释说明静态词条真值来自 `ScenarioTrack.stats / ActorSnapshot.stats`（由 timelineStore delta 机制预先融入）。

---

## 新增能力

### EnemyConfig 扩展

| 新字段 | 类型 | 默认值 | 用途 |
|---|---|---|---|
| `defenseMultiplier` | `number?` | 0.5 | 防御区乘数 |
| `baseMagicResist` | `number?` | 0 | 法术基础抗性 |
| `basePhysicalResist` | `number?` | 0 | 物理基础抗性 |
| `controlImmunities` | `ControlImmunities?` | `{}` | 按类型控制免疫 |

`ControlImmunities`: `{ freeze?: boolean; launch?: boolean; knockdown?: boolean; }`

规则: 控制免疫不等于伤害免疫。freeze 免疫时 debuff 仍保留，shatter 仍可触发。

### DynamicBonus zone 判别字段

| zone | 对应乘区 |
|---|---|
| `"damageBonus"` (默认) | 增伤区 |
| `"amplify"` | 增幅区 |
| `"combo"` | 连击区 |
| `"vulnerability"` | 易伤区 |
| `"fragility"` | 脆弱区 |
| `"attackPercent"` | 攻击力公式 percentBonus |
| `"attackFlat"` | 攻击力公式 flatBonus |

### 乘区补齐

| 乘区 | 之前 | 之后 |
|---|---|---|
| 防御区 | 硬编码 0.5 | 读取 `config.defenseMultiplier ?? 0.5` |
| 增伤区 | 基础 stats + dynamicBonuses | 新增 `all_dmg` 支持 |
| 增幅区 | placeholder 1 | 从 actor effects aggregateZoneBonuses("amplify") |
| 连击区 | placeholder 1 | 从 actor effects aggregateZoneBonuses("combo") |
| 易伤区 | 硬编码导电查表 + placeholder 物理易伤 | 导电用真值公式(含artsPowerDebuffMult) + dynamicBonuses |
| 脆弱区 | placeholder 1 | 按 school/element 匹配的 aggregateZoneBonuses("fragility") |
| 抗性区 | 硬编码 baseResist=0 | 按 school 读取 config.baseMagicResist / basePhysicalResist |
| 特殊系数区 | `1 + artsPower/100` (与倍率函数重复) | 返回 1（artsPower 已内含在倍率中） |

### 攻击力公式

`DamageResolver` 现在调用 `aggregateAttackBonuses(state, actorId)` 从 actor effects 中读取 `attackPercent` / `attackFlat` zone 的动态加成，传入 `computeEffectiveAttack`。蚀迹的 +19.6% 攻击力可通过此路径正确接入（不再使用乘法近似）。

---

## 修改文件清单

| 文件 | 操作 | 要点 |
|---|---|---|
| `calculation/anomalyDamageCalc.ts` | REWRITTEN | 真值公式，消灭 placeholder 表 |
| `utils/anomalyCalc.js` | REWRITTEN | 改为从 anomalyDamageCalc.ts 导入 + UI 包装 |
| `anomaly/AnomalyHandlers.ts` | MODIFIED | 传入 artsPower/level/stacks 到新公式签名 |
| `state/types.ts` | MODIFIED | EnemyConfig 增加 defense/resist/controlImmunities |
| `calculation/multiplierZones.ts` | REWRITTEN | 全 11 区重写，接入 enemy config + zone 聚合 |
| `calculation/DamageResolver.ts` | MODIFIED | 接入 aggregateAttackBonuses |
| `equipment/types.ts` | MODIFIED | DynamicBonus 增加 zone 字段 + aggregateZoneBonuses + aggregateAttackBonuses |
| `equipment/definitions.ts` | MODIFIED | 删除所有 stats += 重复加算 |
| `equipment/equipment.test.ts` | MODIFIED | 修改 3 个测试为"不重复加算"断言 |
| `calculation/phase6.test.ts` | NEW | 27 个新测试 |

---

## 新增测试 (27 个)

| 测试组 | 数量 | 覆盖 |
|---|---|---|
| Anomaly Formula Alignment | 9 | 所有异常公式与确认真值对齐 |
| Arts Power Multipliers | 4 | artsPowerDamageMult 影响 burst; artsPowerDebuffMult 影响导电/腐蚀 |
| No Static Double-Counting | 1 | 注册不改变 actor stats |
| All Damage | 2 | all_dmg 影响物理/异常伤害 |
| Amplify / Combo / Fragility | 4 | 独立乘区; 法术脆弱不影响物理; 元素+法术脆弱叠加 |
| Boss Template | 3 | defenseMultiplier / baseMagicResist / basePhysicalResist |
| Control Immunities | 1 | freeze 免疫但 shatter 仍触发 |
| Attack Formula percentBonus | 2 | percentBonus / flatBonus 通过动态 buff |

---

## 仍保留的 TODO

| 位置 | 内容 | 优先级 |
|---|---|---|
| `multiplierZones.ts` — vulnerability | armorBreak 物理易伤仍用 placeholder 15% | P1 |
| `definitions.ts` — 蚀迹 | +19.6% 攻击力需确认 timelineStore 是否正确处理为 percentBonus | P1 |
| `AnomalyHandlers.ts` | 法术爆发旧注释说"artsPower 不参与"但现已确认参与，UI 的 `calcSpellBurstDamage` wrapper 仍未传 artsPower | P1 |
| `state/types.ts` | ControlImmunities 结构已定义但 PhysicalReactionResolver 尚未使用 | P2 |
| `anomalyCalc.js` | UI wrapper 函数仍然是裸公式（不走乘区），与 simulation 有语义差异 | P2 |
| `equipment/types.ts` | buff 过期仍只在计算时跳过，未从 EffectManager 清理 | P2 |

---

## 下一阶段建议

1. **armorBreak 物理易伤真值** — 替换 placeholder 15%，用 `calcBreachPhysVulnerability` 写入 effect properties
2. **PhysicalReactionResolver 读取 controlImmunities** — 阻止控制效果但保留伤害
3. **UI 投影与 simulation 结果对比** — 验证 anomalyCalc.js wrappers 与 DamageResolver 输出一致性
4. **weapon triggeredBuffs 半自动读取** — 从 gamedata.json 读取 trigger/target/duration/maxStacks/stackCooldown
5. **compile pipeline 自动注册** — 从 ScenarioTrack 自动调用 registerEquipmentPassives
