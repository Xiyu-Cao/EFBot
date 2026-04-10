# T8 人工复核测试样例（修正版）

---

## 统一测试条件

- 角色等级：90
- 精英化：4
- 技能等级：M3（unified level 12）
- **天赋等级：全部调为 0**（排除 runtime_passive / runtime_conditional 干扰）
- **潜能等级：0**
- 无武器、无装备
- 默认敌人配置（defense = 0.5, resist = 0, 未失衡）
- **暴击已强制关闭**（TEMP_FORCE_NO_CRIT），结果确定性

**关键修正**：天赋阵列 Row 1 主属性加成（E4 累计 +60）取决于**精英化等级**，不受天赋等级设置影响。所有计算已包含此加成。

---

## 公式

```
Row 1 bonus = E1(+10) + E2(+15) + E3(+15) + E4(+20) = 60

primary_ability  = mainAttribute基础值 + Row1 bonus(60)
secondary_ability = subAttribute基础值

trunc1(x) = floor(x × 10) / 10
abilityMult = 1 + trunc1(primary × 0.5) / 100 + trunc1(secondary × 0.2) / 100
effectiveATK = floor(baseAttack × abilityMult)

finalDamage = floor(effectiveATK × multiplier × 0.5 × zone乘积)
```

---

## 测试 1：PERLICA 战技 — 基础法术伤害对照

### 排轴步骤
1. 只放 PERLICA
2. 天赋等级全 0，潜能 0
3. 放 1 个 PERLICA 战技
4. 点击"伤害统计"

### 角色数据

| 字段 | 值 | 来源 |
|---|---|---|
| baseAttack | 303 | stats.json |
| mainAttribute | intellect = 161 | stats.json + meta.json |
| subAttribute | will = 113 | stats.json + meta.json |
| Row 1 bonus | +60（加到 intellect） | TALENT_ROW1_BONUSES, promotion=4 |
| primary_ability | **221** (161+60) | |
| secondary_ability | **113** | |
| skill multiplier M3 | 400% | skills.json |

### 计算过程

```
primaryContrib   = trunc1(221 × 0.5) = 110.5
secondaryContrib = trunc1(113 × 0.2) = 22.6
abilityMult      = 1 + 110.5/100 + 22.6/100 = 2.331
effectiveATK     = floor(303 × 2.331) = floor(706.29) = 706

damage = floor(706 × 4.00 × 0.5) = floor(1412) = 1412
```

### 预期值

| 条件 | 伤害 |
|---|---|
| **PERLICA 战技（无 buff/debuff）** | **1412** |

---

## 测试 2：GILBERTA spell_vulnerable + PERLICA 战技

### 排轴步骤
1. 放 GILBERTA 和 PERLICA
2. 天赋等级全 0，潜能 0
3. 先放 GILBERTA 终结技
4. 然后放 PERLICA 战技
5. 点击"伤害统计"
6. 对比 PERLICA 战技伤害与测试 1

### spell_vulnerable debuff 数值

```
calcConductionDebuff(stacks=1, artsPower=0):
  spellVulnerability = (1+2) × 4 × 1 = 12
  → dynamicBonuses: [{ stat: "arts_dmg", value: 12, zone: "fragility" }]
  → duration = 5s（gamedata）
```

### 计算过程

```
effectiveATK = 706（同测试 1）
fragility    = 1 + 12/100 = 1.12

damage = floor(706 × 4.00 × 0.5 × 1.12) = floor(1412 × 1.12) = floor(1581.44) = 1581
```

### 预期值

| 条件 | 伤害 | 变化 |
|---|---|---|
| 无 debuff（测试 1） | 1412 | — |
| **有 spell_vulnerable** | **1581** | **+169 (+12.0%)** |

---

## 测试 3：ESTELLA physical_vulnerable + ENDMINISTRATOR 战技

### 排轴步骤
1. 放 ESTELLA 和 ENDMINISTRATOR
2. 天赋等级全 0，潜能 0
3. 先放 ESTELLA 连携技
4. 然后放 ENDMINISTRATOR 战技
5. 点击"伤害统计"

### ENDMINISTRATOR 角色数据

| 字段 | 值 | 来源 |
|---|---|---|
| baseAttack | 319 | stats.json |
| mainAttribute | agility = 140 | stats.json + meta.json |
| subAttribute | strength = 123 | stats.json + meta.json |
| Row 1 bonus | +60（加到 agility） | |
| primary_ability | **200** (140+60) | |
| secondary_ability | **123** | |
| skill multiplier M3 | 350% | skills.json |
| element | physical | meta.json |

### ENDMINISTRATOR ATK 计算

```
primaryContrib   = trunc1(200 × 0.5) = 100.0
secondaryContrib = trunc1(123 × 0.2) = 24.6
abilityMult      = 1 + 100.0/100 + 24.6/100 = 2.246
effectiveATK     = floor(319 × 2.246) = floor(716.47) = 716
```

### physical_vulnerable debuff 数值

```
calcBreachPhysVulnerability(stacks=1, artsPower=0):
  physVulnPercent = (1+2) × 4 × 1 = 12
  → tag: PHYSICAL_VULNERABLE, physVulnPercent: 12
  → duration = 6s（gamedata）
  → 进入 vulnerability zone
```

### 计算过程

```
无 debuff:
  damage = floor(716 × 3.50 × 0.5) = floor(1253) = 1253

有 physical_vulnerable:
  vulnerability = 1 + 12/100 = 1.12
  damage = floor(716 × 3.50 × 0.5 × 1.12) = floor(1253 × 1.12) = floor(1403.36) = 1403
```

### 预期值

| 条件 | 伤害 | 变化 |
|---|---|---|
| 无 debuff | 1253 | — |
| **有 physical_vulnerable** | **1403** | **+150 (+12.0%)** |

---

## 测试 4：physical_vulnerable 不影响法术伤害

### 排轴步骤
1. 放 ESTELLA 和 PERLICA
2. 天赋/潜能全 0
3. ESTELLA 连携 → PERLICA 战技
4. 点击"伤害统计"
5. PERLICA 战技伤害应与测试 1 完全一致

### 预期值

| 条件 | PERLICA 战技伤害 |
|---|---|
| **有 physical_vulnerable 但被测为法术伤害** | **1412**（不变） |

如果不是 1412，说明 physical_vulnerable 错误地影响了法术伤害。

---

## 预期值汇总

| # | 测试 | 预期伤害 | 验证什么 |
|---|---|---|---|
| 1 | PERLICA 战技基线 | **1412** | ATK 公式 + 基础乘区 |
| 2 | GILBERTA spell_vulnerable + PERLICA 战技 | **1581** (+12%) | 法术易伤 fragility zone |
| 3a | ENDMINISTRATOR 战技基线 | **1253** | 物理角色基线 |
| 3b | ESTELLA physical_vulnerable + ENDMINISTRATOR 战技 | **1403** (+12%) | 物理易伤 vulnerability zone |
| 4 | ESTELLA physical_vulnerable + PERLICA 战技 | **1412**（不变） | 物理易伤不影响法术 |

---

## 建议实测顺序

1. **测试 1**（PERLICA 基线 = 1412）→ 如果不对，其余全部无意义
2. **测试 2**（spell_vulnerable → 1581）→ 验证法术易伤方向和数值
3. **测试 3a**（ENDMINISTRATOR 基线 = 1253）→ 物理角色基线
4. **测试 3b**（physical_vulnerable → 1403）→ 验证物理易伤
5. **测试 4**（physical_vulnerable 不影响法术 = 1412）→ 反向验证
