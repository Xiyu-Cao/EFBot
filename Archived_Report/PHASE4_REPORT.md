# Phase 4 Part 1 — Real Damage Calculation Implementation Report

## Overview

本轮实现了第一版真实伤害计算系统，将 DamageTags / DamageResolver / 暴击系统 / hit 步骤机制真正接入 simulation，
使 anomaly damage / burst / shatter / burn tick 不再停留在 `damage: 0` 的占位状态。

---

## A. DamageTags / DamageType / DamageSchool / DamageSource

**新文件**: `calculation/damageTypes.ts`

- `DamageType`: burn / cold / electro / nature / physical / extradomain
- `DamageSchool`: magic / physical（由 DamageType 派生）
- `DamageSource`: 11 种来源（normalAttack / heavyAttack / activeSkill / comboSkill / ultimateSkill / magicAttachmentBurst / magicAnomalyDirect / burnTick / shatter / physicalAnomaly / equipmentProc）
- `DamageTags` 接口：包含 `countsAs*` 系列标志、`canCrit`、`isDot`、`critScope`
- `buildDamageTags()` 工厂函数：自动派生 school、设置 countsAs 标志
- `anomaly/types.ts` 现在从 `calculation/damageTypes.ts` re-export

### 关键规则实现

- 重击（heavyAttack）属于普通攻击伤害子集：`countsAsNormalAttackDamage = true`
- 燃烧 tick 默认 `canCrit = false`、`isDot = true`
- `critScope` 默认 `"shared"`

---

## B. 真实伤害公式

### 攻击力公式

**新文件**: `calculation/attackFormula.ts`

```
ATK = floor(
  ((baseAttack * (1 + percentBonus) + flatBonus)
   * (1 + truncate1(primaryAbility * 0.5) / 100
        + truncate1(secondaryAbility * 0.2) / 100))
)
```

- `truncateToOneDecimal()`: 确定性截断到 1 位小数（floor，非四舍五入）
- 最终攻击力向下取整
- `computeAttackFromStats(stats)`: 从 ActorStats 直接计算

### 乘区公式

**新文件**: `calculation/multiplierZones.ts`

```
总伤害 = ATK × 技能倍率
       × 防御区 × 暴击区 × 增伤区 × 增幅区
       × 连击区 × 易伤区 × 脆弱区 × 抗性区
       × 失衡区 × 减伤区 × 特殊系数区
```

| 乘区 | 函数 | 状态 |
|---|---|---|
| 防御区 | `computeDefenseZone` | 默认 0.5，可配置 |
| 暴击区 | `computeCritZone` | 已接入暴击系统 |
| 增伤区 | `computeDamageBonusZone` | 已接入：school/element/source 加成、all_skill_dmg_bonus、broken_dmg_bonus |
| 增幅区 | `computeAmplifyZone` | placeholder 1（TODO: buff 聚合） |
| 连击区 | `computeComboZone` | placeholder 1（TODO: buff 聚合） |
| 易伤区 | `computeVulnerabilityZone` | 已接入：导电（magic vuln）、物理易伤（placeholder 15%） |
| 脆弱区 | `computeFragilityZone` | placeholder 1（TODO: buff 聚合） |
| 抗性区 | `computeResistanceZone` | 已接入：腐蚀 resist reduction |
| 失衡区 | `computeBreakZone` | 已实现：broken = 1.3，否则 1 |
| 减伤区 | `computeReductionZone` | placeholder 1 |
| 特殊系数区 | `computeSpecialZone` | 已接入：源石技艺强度对异常来源 |

### DamageResolver 重写

**修改文件**: `calculation/DamageResolver.ts`

- `resolve(ctx)` 现在执行完整公式：ATK → baseDamage → 所有乘区 → floor
- 输出包含 breakdown（每个非 1 乘区记录 source/type/value/contribution）
- 支持 `critOverride`（shared scope 预判）和 `rng`（可注入确定性随机数）

---

## C. 暴击系统 v1

**新文件**: `calculation/critSystem.ts`

- 基础暴击率：5%
- 基础暴击伤害：50%（暴击乘数 = 1.5）
- `resolveCrit(canCrit, bonusRate, bonusDmg, rng)` → `CritResult { isCrit, multiplier }`
- `canCrit = false` 时强制返回 `NO_CRIT`
- `critScope: "shared"` — 调用方预 roll 一次，通过 `critOverride` 传递给所有 hit
- `critScope: "perHit"` — 每次 `resolve()` 独立 roll
- 燃烧 tick: `canCrit = false`（通过 DamageTags 强制）

---

## D. Hit 步骤执行机制

**新文件**: `mechanics/hitSteps.ts`

### 设计

hit 内的执行顺序由技能描述决定，不是全局固定顺序：

- "施加自然附着并造成伤害" → `[applyAttachment, dealDamage]`
- "造成伤害后添加法术脆弱" → `[dealDamage, applyDebuff]`

### 实现

- `HitStep` 联合类型：applyMagicAttachment / applyPhysicalAnomaly / applyDirectAnomaly / dealDamage / applyDebuff / applyBuff / consumeAttachment / gainResource
- `HitDefinition { steps: HitStep[] }`
- `executeHitSteps(hit, time, ctx)`: 按步骤顺序 enqueue 事件
- 利用 PriorityQueue 的 FIFO 特性：同时间事件按 enqueue 顺序处理
- `buildDefaultHitDefinition()`: 向后兼容（damage first, then anomaly）

---

## E. 异常/派生伤害真正进入 DamageResolver

**重写文件**: `anomaly/AnomalyHandlers.ts`

### 不再是 damage: 0

| 伤害来源 | damageSource | 倍率来源 | canCrit |
|---|---|---|---|
| 法术爆发 | magicAttachmentBurst | MAGIC_BURST_MULTIPLIER[stacks] | true |
| 法术异常直接伤害 | magicAnomalyDirect | ANOMALY_DIRECT_MULTIPLIER[type] | true |
| 燃烧 tick | burnTick | BURN_TICK_MULTIPLIER[level] | false |
| 碎冰 | shatter | SHATTER_MULTIPLIER[level] | true |
| 物理异常 | physicalAnomaly | PHYSICAL_ANOMALY_MULTIPLIER[type] | true |
| 装备触发 | equipmentProc | （标签层面已支持，倍率由具体装备定义） | true |

**新文件**: `calculation/anomalyDamageCalc.ts` — 各异常倍率表（placeholder 值，待替换真实数据）

### 燃烧 tick 机制

1. 当 burn 被施加时，预调度 10 个 ANOMALY_DAMAGE 事件（t+1 到 t+10）
2. AnomalyDamageHandler 处理 burnTick 时：
   - 调用 `advanceBurn()` 自然去重
   - 读取当前 burn 状态（level / sourceActorId）→ 实时状态读取
   - 查找当前 source actor 的 ATK → 实时攻击力
3. burn 被覆盖时：旧 tick 事件读到新 burn 状态
4. burn 过期后：tick 事件被 advanceBurn 跳过

### AnomalyDamageHandler

- 拥有自己的 `DamageResolver` 实例
- 对所有异常伤害构建 `DamageContext` → 走完整乘区管线
- burn tick 特殊路径：从 EnemyStatusState 读实时数据

---

## F. 导电/腐蚀进入 enemy modifier 管道

### 导电（Conduction）

- 在 `computeVulnerabilityZone` 中读取 `enemy.status.conduction`
- 仅对 `damageSchool === "magic"` 的伤害生效
- 按 level 查表：`CONDUCTION_PERCENT_BY_LEVEL[level]`（12/16/20/24%）

### 腐蚀（Corrosion）

- 在 `computeResistanceZone` 中读取 `enemy.status.getCorrosionResistDown()`
- 公式：`resistance_zone = 1 + resistReduction * 0.01 - baseResist * 0.01`
- 腐蚀随时间累积 resist reduction（已有 advanceCorrosion 机制）

---

## G. 测试

### 新增测试（33 个）

**文件**: `calculation/damageCalculation.test.ts`

| 测试组 | 测试数 | 覆盖内容 |
|---|---|---|
| Attack Formula | 7 | truncation、ability 计算、floor 时机 |
| Normal Damage — Full Pipeline | 4 | physical/magic skill damage、heavy attack、bonus 叠加 |
| Physical Anomaly Damage | 1 | 物理异常伤害 > 0（集成测试） |
| Magic Burst Damage | 1 | 法术爆发伤害 > 0（集成测试） |
| Burn Tick | 2 | canCrit=false、非零伤害、实时状态 |
| Shatter | 2 | canCrit=true、归属正确、非零伤害（集成） |
| Crit System | 5 | NO_CRIT、crit roll、shared vs perHit |
| Conduction — Vulnerability Zone | 2 | magic 伤害增加、physical 不受影响 |
| Corrosion — Resistance Zone | 1 | resist reduction 增加伤害 |
| Hit Step Ordering | 3 | 步骤顺序、executeHitSteps、反序 |
| Independent Damage Instances | 2 | skill vs equipment proc 标签差异、计算差异 |
| DamageType utilities | 3 | element/school 映射 |

### 更新的已有测试

- `DamageResolver.test.ts`: 适配新 DamageContext API
- `anomaly.test.ts`: 更新 tag 字段名（damageSource 替代 originType）、添加非零伤害断言、修复多 actor 测试
- `simulator.behavior.test.ts`: 更新期望值（defense zone 0.5）

### 总计

```
Test Files  14 passed (14)
Tests       138 passed (138)
```

---

## 修改文件清单

| 文件 | 操作 |
|---|---|
| `calculation/damageTypes.ts` | NEW |
| `calculation/attackFormula.ts` | NEW |
| `calculation/critSystem.ts` | NEW |
| `calculation/multiplierZones.ts` | NEW |
| `calculation/anomalyDamageCalc.ts` | NEW |
| `calculation/damageCalculation.test.ts` | NEW |
| `mechanics/hitSteps.ts` | NEW |
| `calculation/type.ts` | MODIFIED |
| `calculation/DamageResolver.ts` | REWRITTEN |
| `calculation/DamageResolver.test.ts` | UPDATED |
| `calculation/CalculationPipeline.ts` | UNCHANGED（仍用于 stagger） |
| `anomaly/types.ts` | MODIFIED（re-export） |
| `anomaly/events.ts` | MODIFIED（multiplier 字段） |
| `anomaly/AnomalyHandlers.ts` | REWRITTEN |
| `anomaly/anomaly.test.ts` | UPDATED |
| `events/DamageHandler.ts` | MODIFIED |
| `events/event.types.ts` | MODIFIED（import path） |
| `simulator.behavior.test.ts` | UPDATED |

---

## 仍保留 TODO 的位置

| 位置 | TODO 内容 |
|---|---|
| `multiplierZones.ts` — computeAmplifyZone | 增幅区需要从 buff 聚合 |
| `multiplierZones.ts` — computeComboZone | 连击区需要从 buff 聚合 |
| `multiplierZones.ts` — computeFragilityZone | 脆弱区需要从 buff 聚合 |
| `multiplierZones.ts` — computeDamageBonusZone | "造成的伤害增加"总标签需要 buff 支持 |
| `multiplierZones.ts` — computeVulnerabilityZone | 物理易伤 placeholder 15%，需从 effect 属性读取 |
| `multiplierZones.ts` — computeResistanceZone | 敌人基础抗性默认 0，需 per-enemy 配置 |
| `multiplierZones.ts` — computeSpecialZone | 源石技艺强度精确缩放公式待验证 |
| `anomalyDamageCalc.ts` — 所有倍率表 | placeholder 值，需替换为真实游戏数据 |
| `attackFormula.ts` — computeAttackFromStats | percentBonus / flatBonus 从 buff 聚合 |
| `AnomalyHandlers.ts` — burn tick 重申 | burn 被覆盖延长时长后额外 tick 的边界情况 |
| `damageTypes.ts` — extradomain | extradomain 类型暂作为 magic school 处理 |

---

## 下一阶段建议优先级

1. **真实异常倍率数据** — 从游戏客户端提取替换 placeholder
2. **Buff → 乘区聚合** — EffectManager properties 接入各乘区（增幅/连击/脆弱/造成的伤害增加）
3. **技能迁移到 hit step** — compile pipeline 集成，逐步迁移现有技能定义
4. **角色特例** — per-skill critScope 覆盖、特殊乘区交互
5. **装备触发伤害** — equipmentProc 作为独立伤害实例进入主链路
6. **敌人配置扩展** — 基础抗性、防御值 per-enemy
