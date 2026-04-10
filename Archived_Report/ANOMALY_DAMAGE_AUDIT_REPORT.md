# 异常伤害统一规则审计报告

> 审计时间：2026-03-24
> 基线：251 tests pass, 0 TS errors（Phase 10 完成后）
> 结论：**当前实现已正确，无需修改**

---

## 1. 审计结论

### 已符合规则的点

| 审计项 | 状态 | 说明 |
|---|---|---|
| 异常伤害作为独立 damage instance | **正确** | 走 `ANOMALY_DAMAGE` 事件 → `AnomalyDamageHandler` → `DamageResolver`，与技能 `DAMAGE_TICK` → `DamageHandler` 完全分离 |
| damageSource 分类 | **正确** | 使用 `magicAttachmentBurst` / `magicAnomalyDirect` / `burnTick` / `shatter` / `physicalAnomaly`，从不使用 `activeSkill` / `comboSkill` / `ultimateSkill` / `normalAttack` / `heavyAttack` |
| 不继承技能类别增伤 | **正确** | `buildDamageTags` 中 `countsAsActiveSkillDamage` / `countsAsComboSkillDamage` 等 flag 对异常 source 全部为 `false` → `computeDamageBonusZone` 不会加算 `skill_dmg_bonus` / `link_dmg_bonus` / `ultimate_dmg_bonus` / `all_skill_dmg_bonus` |
| 正确继承 school/elemental bonus | **正确** | `computeDamageBonusZone` 按 `tags.damageSchool` 读 `arts_dmg`/`physical_dmg`，按 `tags.damageType` 读 `blaze_dmg`/`cold_dmg` 等 |
| 目标侧易伤/减抗 | **正确** | `computeVulnerabilityZone` 读导电/碎甲易伤，`computeResistanceZone` 读腐蚀减抗，均基于 `tags.damageSchool` 匹配 |
| 独立暴击 | **正确** | `AnomalyDamageHandler` 对每个 instance 独立走 `resolveCrit`；burn tick `canCrit=false` → `NO_CRIT`；其余默认 `canCrit=true` |
| 日志分离 | **正确** | 技能伤害 → `DAMAGE_TICK` 日志；异常伤害 → `ANOMALY_DAMAGE` 日志，完全不混 |
| 无双真值源 | **正确** | 异常伤害唯一入口是 `ANOMALY_DAMAGE` 事件，不存在第二条路径进入 `DamageResolver` |
| special zone 不重复乘 artsPower | **正确** | `computeSpecialZone` return 1，artsPower 已内含在 anomaly multiplier 函数中 |

### 风险检查项

| 检查项 | 结果 |
|---|---|
| "由战技触发的击飞" 被误认为 "战技伤害" | **不存在**。物理异常始终用 `damageSource: "physicalAnomaly"` |
| "由连携触发的猛击" 被误认为 "连携技伤害" | **不存在**。同上 |
| anomaly tag 同时带 anomaly + skill-category | **不存在**。`countsAs*SkillDamage` 对异常源全为 false |
| UI 把 anomaly damage 合并进 skill damage | **不存在**。不同日志类型 |
| 重复加算 timelineStore 静态词条 | **不存在**。无修改发生 |
| 特殊乘区重复乘 anomaly 已含量 | **不存在**。special zone = 1 |

### 不影响 P0

- skill multiplier truth status：本次无任何改动涉及 `skillMultipliers.ts`
- CATEGORY_TO_SET 收敛：本次无任何改动涉及 `timelineStore.js` 或 `registry.ts` 映射

### 唯一的边角观察

碎冰 (`getShatterMultiplier`) 使用 `spellLevelCoef`（法术等级系数），而碎冰在 damageType/damageSchool 上被标记为 `physical`。这不是 tag/bonus 问题（标记正确），而是公式系数选择是否与实机一致，需要实机确认。

---

## 2. 修改计划

**不需要修改。** 当前实现已经正确满足所有规定规则。

---

## 3. 现状说明

### 异常伤害如何进入 damage pipeline

```
技能/攻击 → APPLY_MAGIC_ATTACHMENT / APPLY_PHYSICAL_ANOMALY 事件
         → MagicReactionResolver / PhysicalReactionResolver
         → ResolverOutcome[]
         → emitOutcomes() → ANOMALY_DAMAGE 事件（含 multiplier + DamageTags）
         → AnomalyDamageHandler → DamageResolver.resolve() → sim log
```

### 吃哪些 bonus

- school bonus（法术增伤 / 物理增伤）
- elemental bonus（灼热 / 寒冷 / 电磁 / 自然）
- 对失衡目标增伤（broken_dmg_bonus）
- equipment dynamic bonus 中的 `all_dmg`
- 导电易伤（magic only）、碎甲物理易伤（physical only）
- 腐蚀减抗
- 失衡区 ×1.3

### 不吃哪些 bonus

- 普攻增伤（attack_dmg_bonus）
- 战技增伤（skill_dmg_bonus）
- 连携技增伤（link_dmg_bonus）
- 终结技增伤（ultimate_dmg_bonus）
- 所有技能伤害加成（all_skill_dmg_bonus）

### 独立 crit

- burnTick：`canCrit = false` → NO_CRIT
- 其余所有异常伤害：`canCrit = true` → 独立 resolveCrit

### 与 skill damage / equipment proc 分离

- 三者使用不同 `damageSource`，不同日志类型（`DAMAGE_TICK` / `ANOMALY_DAMAGE`）
- equipment proc 用 `damageSource: "equipmentProc"`，也不吃技能类别增伤

### 不影响 UI 入口

`runSimulation(..., { db, rng })` 链路无变化。

---

## 4. 关键代码位置索引

| 文件 | 作用 | 审计结果 |
|---|---|---|
| `simulation/calculation/damageTypes.ts:164-212` | `buildDamageTags` — 异常 source 的 countsAs* 全为 false | 正确 |
| `simulation/calculation/multiplierZones.ts:84-146` | `computeDamageBonusZone` — 技能增伤只在 countsAs* 为 true 时加算 | 正确 |
| `simulation/calculation/multiplierZones.ts:334-340` | `computeSpecialZone` — return 1，不重复乘 artsPower | 正确 |
| `simulation/calculation/anomalyDamageCalc.ts` | 异常倍率公式已内含 artsPowerDamageMult | 正确 |
| `simulation/anomaly/AnomalyHandlers.ts:314-376` | `AnomalyDamageHandler` — 独立走 DamageResolver，独立 crit | 正确 |
| `simulation/anomaly/AnomalyHandlers.ts:58-253` | `emitOutcomes` — 全部用异常专属 damageSource | 正确 |
| `simulation/events/DamageHandler.ts` | 技能伤害走 DAMAGE_TICK，与异常完全分离 | 正确 |

---

## 5. 风险与后续

### 这次没有碰的部分

- `anomalyDamageCalc.ts` 中的具体公式系数（如碎冰用 spellLevelCoef vs physLevelCoef）
- 腐蚀的 placeholder 参数（`EnemyStatusState.CORROSION_PARAMS`）
- 碎冰归属：artsPower 取的是物理异常施加者而非冻结施加者

### 仍需实机确认

1. 碎冰倍率是否确实用 `spellLevelCoef`（还是应该用 `physLevelCoef`）
2. 碎冰 artsPower 取物理异常施加者 vs 冻结施加者
3. 腐蚀每秒减抗 / 最大减抗的精确值（当前为 placeholder）
4. controlImmunities 对 break stacks 是否仍累积

### 建议后续推进（1~3 项）

1. **P0 #2 — 共享 CATEGORY_TO_SET**：timelineStore 从 registry 导入，消除重复映射
2. **实机核对腐蚀/碎冰参数**：替换 placeholder → verified
3. **补充异常伤害 bonus applicability 专项测试**：当前测试覆盖了异常伤害产出和公式计算，但可以补一组明确验证"异常伤害不吃技能类别增伤"的回归测试，防止未来误改
