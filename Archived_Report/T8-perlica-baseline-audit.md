# T8 PERLICA 基线伤害审计

---

## 1. 已确认事实：PERLICA 战技当前真实伤害链

### 原始数据

| 字段 | 值 | 来源 |
|---|---|---|
| baseAttack | 303 | `stats.json` levels["90"].attack |
| intellect | 161 | `stats.json` levels["90"].intellect |
| will | 113 | `stats.json` levels["90"].will |
| mainAttribute | intellect | `meta.json` |
| subAttribute | will | `meta.json` |
| 天赋阵列 Row 1 bonus | +60 | `TALENT_ROW1_BONUSES` 累计：E1(+10) + E2(+15) + E3(+15) + E4(+20) = 60 |
| skill multiplier M3 | 400% | `skills.json` "伤害倍率" index 11 |
| crit_rate (stats) | 0 | stats.json 无此字段 → CORE_STATS default = 0 |
| crit_dmg (stats) | 0 | 同上 |

### ATK 计算

```
intellect (base)      = 161
talent row 1 bonus    = +60（来自 promotion=4，不受天赋等级影响）
total intellect       = 221

primary_ability  = 221（mainAttribute = intellect）
secondary_ability = 113（subAttribute = will）

primaryContrib   = trunc1(221 × 0.5) = trunc1(110.5) = 110.5
secondaryContrib = trunc1(113 × 0.2) = trunc1(22.6)  = 22.6
abilityMult      = 1 + 110.5/100 + 22.6/100 = 2.331

effectiveATK = floor(303 × 2.331) = floor(706.293) = 706
```

### 伤害计算

```
baseDamage = 706 × 4.0 = 2824
defense    = 0.5

非暴击: floor(2824 × 0.5)       = floor(1412)   = 1412 ✓
暴击:   floor(2824 × 0.5 × 1.5) = floor(2118)   = 2118 ✓
```

---

## 2. 已确认事实：crit 来源与 crit 计算现状

### 基础暴击系统

**文件**：`src/simulation/calculation/critSystem.ts`

```typescript
export const BASE_CRIT_RATE = 5;    // 5% 基础暴击率
export const BASE_CRIT_DAMAGE = 50; // 50% 基础暴击伤害 → 暴击倍率 1.5
```

### resolveCrit 函数

```typescript
const totalRate = Math.max(0, Math.min(100, BASE_CRIT_RATE + bonusCritRate));
// PERLICA: totalRate = 5 + 0 = 5%
const roll = rng();
if (roll >= totalRate / 100) return NO_CRIT;  // 95% 概率不暴击
// 5% 概率暴击:
const totalCritDmg = BASE_CRIT_DAMAGE + bonusCritDamage; // 50 + 0 = 50
return { isCrit: true, multiplier: 1 + 50 / 100 };       // = 1.5
```

### 随机源

```typescript
// buildRng(undefined) → Math.random
// 每次 simulation run 使用 Math.random → 每次结果不确定
```

**确认**：当前 simulation 不传 rng 选项 → 使用 `Math.random` → 暴击判定每次不同。

---

## 3. 1412 与 2118 的差异拆解

| 条件 | 伤害 | 计算过程 |
|---|---|---|
| 非暴击 | **1412** | `floor(706 × 4.0 × 0.5 × 1.0)` |
| 暴击 (1.5×) | **2118** | `floor(706 × 4.0 × 0.5 × 1.5)` |
| 比值 | 1.500 | `2118 / 1412 = 1.5` ✓ |

**确认**：两者差异 100% 来自 crit zone，其余所有 zone 值不变。

---

## 4. 多方案波动：暴击采样，不是方案串扰

**首选判断：是暴击采样。**

1. "伤害统计"按钮每次点击都读取 `simulation.value`
2. `simulation` 是 computed，依赖 `compiledScenario`（依赖 `tracks.value`）
3. 任何 track 变化都会触发 `simulation` 重算
4. 重算时 `simulate()` 用 `buildRng(undefined)` → `Math.random`
5. 每次重算独立抽样：5% 概率暴击 → 1412 或 2118
6. 多次点击/切换方案 → 每次独立抽样 → 结果在 1412/2118 间跳变

**不是方案串扰**：每次 simulation run 完全独立（createEngine 创建新状态），不存在跨 run 的共享状态。

---

## 5. 当前 PERLICA 战技真实计算链与公式

### 完整链路

```
stats.json Lv90: attack=303, intellect=161, will=113
  ↓
resolveTrackConfiguredStats:
  intellect += getTalentRow1Bonus(promotion=4) = +60 → 221
  primary_ability = 221 (intellect = mainAttribute)
  secondary_ability = 113 (will = subAttribute)
  ↓
buildSimulationTracks → actor.stats:
  attack = 303, primary_ability = 221, secondary_ability = 113
  crit_rate = 0, crit_dmg = 0
  ↓
DamageResolver.resolve:
  ATK = floor(303 × (1 + 0) × (1 + trunc1(221×0.5)/100 + trunc1(113×0.2)/100))
      = floor(303 × 2.331)
      = 706
  baseDamage = 706 × 4.0 = 2824
  ↓
computeDefenseZone: 0.5
computeCritZone: resolveCrit(canCrit=true, bonusRate=0, bonusDmg=0, Math.random)
  → totalRate = 5%, roll = random()
  → 95%: NO_CRIT (multiplier=1.0) → crit zone = 1.0
  → 5%:  CRIT (multiplier=1.5)    → crit zone = 1.5
computeDamageBonusZone: 1.0 (无增伤)
computeAmplifyZone: 1.0
computeComboZone: 1.0
computeVulnerabilityZone: 1.0
computeFragilityZone: 1.0
computeResistanceZone: 1.0 (baseMagicResist=0)
computeBreakZone: 1.0
computeReductionZone: 1.0
computeSpecialZone: 1.0
  ↓
finalDamage = floor(2824 × 0.5 × critZone × 1 × ... × 1)
  非暴击: floor(2824 × 0.5 × 1.0) = 1412
  暴击:   floor(2824 × 0.5 × 1.5) = 2118
```

### 与之前测试文档 1230 的差异来源

| 差异项 | 之前文档假设 | 真实值 | 影响 |
|---|---|---|---|
| **天赋 Row 1 主属性加成** | 0（假设不存在或不影响） | +60（E4 累计） | primary_ability 从 161 → 221，ATK 从 615 → 706 |
| **基础暴击率** | 0% | 5%（critSystem.ts BASE_CRIT_RATE） | 单段技能有 5% 概率 ×1.5 |

Row 1 bonus 对 ATK 的影响：`706 / 615 = 1.148` → **+14.8%**

这完全解释了 `1412 / 1230 = 1.148`（非暴击差异）。

---

## 6. 首选根因判断

**之前人工测试文档的两个假设都错了：**

1. **遗漏了天赋 Row 1 主属性加成**：E4 累计 +60 加到 intellect 上，显著影响 abilityMult。这个加成取决于 promotion（精英化等级），**不受天赋等级设置影响**。即使天赋等级全调为 0，Row 1 加成仍然生效。
2. **遗漏了 5% 基础暴击率**：`critSystem.ts` 硬编码 `BASE_CRIT_RATE = 5`，所有可暴击伤害都有 5% 暴击概率。每次 simulation 用 `Math.random` 抽样，导致结果在 1412/2118 间随机跳变。

**不存在方案串扰**。每次跳变就是独立的暴击抽样。

---

## 7. 最小改动实施方案（仅方案，不实施）

### 问题 A：暴击随机导致测试不稳定

**推荐方案**：在 `runDamageStats()` 调用 `simulate()` 时传入固定 seed。

| 文件 | 改什么 |
|---|---|
| `timelineStore.js` 的 `simulation` computed | 传 `rng: { seed: 固定值 }` 或 `rng: { mode: "neverCrit" }` |

`buildRng` 已支持 `SimulationRngOptions`，只需检查是否已有 `seed` / `neverCrit` 模式。如果没有，添加一个 `neverCrit` 模式（返回恒定 0.99 → 永不暴击）用于确定性测试。

**替代方案**（更小改动）：在 `runDamageStats()` 中多跑几次取平均；或在伤害统计面板中显示"含暴击"标记。

### 问题 B：测试文档需修正

**需要修正之前 T8-test-cases.md 的理论值**：

| 测试 | 旧值 | 修正值（非暴击） | 修正值（暴击） |
|---|---|---|---|
| PERLICA 战技基线 | 1230 | **1412** | 2118 |
| + spell_vulnerable 12% | 1377 | **1581** | 2372 |

修正后的 spell_vulnerable 验证逻辑：
- 无 debuff 非暴击：1412
- 有 spell_vulnerable 非暴击：`floor(1412 × 1.12) = floor(1581.44) = 1581`
- 差值比：`1581 / 1412 = 1.1197...` ≈ +12%

### 为什么这是当前最该先修的点

在暴击随机 + 理论值错误的状态下，任何 buff/debuff 效果验证都不可靠。必须先让测试结果确定性化，再验证 spell_vulnerable 等效果的方向和数值。
