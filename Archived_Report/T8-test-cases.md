# T8 人工复核测试样例

---

## 统一测试条件

- 角色等级：90
- 精英化：4
- 技能等级：M3（unified level 12）
- **天赋等级：全部调为 0**（排除天赋 passive / conditional 干扰）
- **潜能等级：0**（排除潜能 static effects 干扰）
- 无武器、无装备
- 默认敌人配置（defense = 0.5, resist = 0, 未失衡）
- 暴击率/暴击伤害：stats.json 中无此字段 → 默认 0 → 无暴击 → 伤害确定性

---

## 统一公式

```
effectiveATK = floor(baseAttack × (1 + percentBonus) × abilityMult)

其中:
  abilityMult = 1 + trunc1(primaryAbility × 0.5) / 100 + trunc1(secondaryAbility × 0.2) / 100
  trunc1(x) = floor(x × 10) / 10

baseDamage = effectiveATK × skillMultiplier
finalDamage = floor(baseDamage × defense × fragility × vulnerability × ... 其余 zone 均为 1)
```

默认 zone 值（无 buff/debuff 时）：

| zone | 值 |
|---|---|
| defense | 0.5 |
| crit | 1（无暴击） |
| damageBonus | 1（无增伤） |
| amplify | 1 |
| combo | 1 |
| vulnerability | 1 |
| fragility | 1 |
| resistance | 1（resist=0） |
| break | 1（未失衡） |
| reduction | 1 |
| special | 1 |

---

## 测试 1：PERLICA 战技 — 基础法术伤害对照

### A. 测试名称

基础法术伤害对照（PERLICA 战技，无任何 buff/debuff）

### B. 排轴步骤

1. 只放 PERLICA 一个角色
2. 将天赋等级全部调为 0，潜能等级调为 0
3. 在排轴上放一个 PERLICA 战技
4. 点击"伤害统计"

### C. 为什么简单

- PERLICA 战技是单段单 hit，倍率 400%（M3）
- emag 元素 → damageSchool = magic
- PERLICA 无 runtime_passive / runtime_conditional 天赋（不在任何已注册天赋列表中）
- 无暴击（stats.json 无 crit 字段 → 默认 0）
- 无武器/装备 → 无 triggered buff
- 所有乘区除 defense 外均为 1

### D. 理论计算链

**角色数据**（来源：`src/data/operators/PERLICA/stats.json` levels["90"]）：
- attack = 303
- mainAttribute = intellect = 161
- subAttribute = will = 113

**ATK 计算**：
```
primaryContrib = trunc1(161 × 0.5) = trunc1(80.5) = 80.5
secondaryContrib = trunc1(113 × 0.2) = trunc1(22.6) = 22.6
abilityMult = 1 + 80.5/100 + 22.6/100 = 2.031
effectiveATK = floor(303 × 2.031) = floor(615.393) = 615
```

**伤害计算**：
```
skillMultiplier = 4.00（400%，来源：skills.json skill levelData "伤害倍率" index 11）
baseDamage = 615 × 4.00 = 2460
defense = 0.5
finalDamage = floor(2460 × 0.5) = floor(1230) = 1230
```

### E. 理论值

| 条件 | 伤害 |
|---|---|
| PERLICA 战技（无 buff/debuff） | **1230** |

### F. 计算过程

```
ATK = floor(303 × (1 + 0) × (1 + 80.5/100 + 22.6/100))
    = floor(303 × 2.031)
    = floor(615.393)
    = 615

伤害 = floor(615 × 4.00 × 0.5 × 1 × 1 × 1 × 1 × 1 × 1 × 1 × 1 × 1)
     = floor(1230)
     = 1230
```

---

## 测试 2：GILBERTA spell_vulnerable + PERLICA 战技

### A. 测试名称

GILBERTA 法术易伤验证（PERLICA 战技作为被测伤害源）

### B. 排轴步骤

1. 放 GILBERTA 和 PERLICA 两个角色
2. 天赋等级全部调为 0，潜能等级调为 0
3. 先放 GILBERTA 终结技
4. 在 GILBERTA 终结技之后放 PERLICA 战技（确保在 spell_vulnerable 的 5s 窗口内）
5. 点击"伤害统计"
6. 对照测试 1 的 PERLICA 战技伤害

### C. 为什么简单

- PERLICA 战技仍是单段法术伤害
- spell_vulnerable 只影响法术伤害的 fragility zone
- GILBERTA 终结技同时施加 nature_attach，但 PERLICA 是 emag 元素，不会与 nature 产生跨元素反应（需要两种不同附着同时在敌人身上才反应）
- 无暴击、无武器/装备

**注意事项**：
- 由于 Route 2.8 的 setup 阶段注册问题（isEffectActive 不检查 startTime 下界），spell_vulnerable 可能从 time=0 就活跃
- 即使 PERLICA 战技在 GILBERTA 终结技之前也可能吃到 debuff
- 这是已知的时序问题，不是符号问题

### D. 理论计算链

**spell_vulnerable debuff 数值**：
```
calcConductionDebuff(stacks=1, artsPower=0)
  = { spellVulnerability: (1+2) × 4 × 1 = 12, duration: 12 }
但 duration 被 gamedata 覆盖为 5

写入 enemy.effects:
  dynamicBonuses: [{ stat: "arts_dmg", value: 12, zone: "fragility" }]
```

**PERLICA 战技伤害（有 spell_vulnerable）**：
```
effectiveATK = 615（同测试 1）
baseDamage = 615 × 4.00 = 2460
defense = 0.5
fragility = 1 + 12/100 = 1.12
finalDamage = floor(2460 × 0.5 × 1.12) = floor(1377.6) = 1377
```

### E. 理论值

| 条件 | 伤害 | 变化 |
|---|---|---|
| 无 debuff（测试 1） | 1230 | — |
| 有 spell_vulnerable | **1377** | +147 (+12.0%) |

### F. 计算过程

```
fragility zone = 1 + 12 / 100 = 1.12

伤害 = floor(615 × 4.00 × 0.5 × 1.12)
     = floor(2460 × 0.5 × 1.12)
     = floor(1230 × 1.12)
     = floor(1377.6)
     = 1377
```

---

## 测试 3：ESTELLA physical_vulnerable + ENDMINISTRATOR 战技

### A. 测试名称

ESTELLA 物理易伤验证（ENDMINISTRATOR 战技作为被测伤害源）

### B. 排轴步骤

1. 放 ESTELLA 和 ENDMINISTRATOR 两个角色
2. 天赋等级全部调为 0，潜能等级调为 0
3. 先放 ESTELLA 连携技
4. 在连携后放 ENDMINISTRATOR 战技（确保在 physical_vulnerable 的 6s 窗口内）
5. 点击"伤害统计"
6. 对照无 ESTELLA 连携时的 ENDMINISTRATOR 战技伤害

### C. 为什么简单

- ENDMINISTRATOR 是 physical 元素 → damageSchool = physical → 吃 physical_vulnerable
- physical_vulnerable 走 tag+physVulnPercent 机制，进 vulnerability zone
- ENDMINISTRATOR 天赋等级调为 0 → 无 runtime_passive 物理脆弱效果
- 无暴击、无武器/装备

**注意**：与测试 2 同理，physical_vulnerable 在 setup 阶段注册，可能从 time=0 就活跃。

### D. 理论计算链

**ENDMINISTRATOR 数据**（`stats.json` levels["90"]）：
```
attack = 319
mainAttribute = agility = 140
subAttribute = strength = 123
```

**ATK 计算**：
```
primaryContrib = trunc1(140 × 0.5) = trunc1(70.0) = 70.0
secondaryContrib = trunc1(123 × 0.2) = trunc1(24.6) = 24.6
abilityMult = 1 + 70.0/100 + 24.6/100 = 1.946
effectiveATK = floor(319 × 1.946) = floor(620.774) = 620
```

**ENDMINISTRATOR 战技倍率**：350%（M3，来源 skills.json "伤害倍率" index 11）

**注意**：ENDMINISTRATOR 战技可能是多段。如果是多段，伤害统计面板会显示该 action 的总伤害。理论值按总倍率计算。

**无 debuff 伤害**：
```
baseDamage = 620 × 3.50 = 2170
defense = 0.5
finalDamage = floor(2170 × 0.5) = floor(1085) = 1085
```

**physical_vulnerable debuff 数值**：
```
calcBreachPhysVulnerability(stacks=1, artsPower=0)
  = { physicalVulnerability: (1+2) × 4 × 1 = 12, duration: 12 }
duration 被 gamedata 覆盖为 6

写入 enemy.effects:
  tag: PHYSICAL_VULNERABLE, physVulnPercent: 12
```

**有 debuff 伤害**：
```
vulnerability = 1 + 12/100 = 1.12
finalDamage = floor(2170 × 0.5 × 1.12) = floor(1215.2) = 1215
```

### E. 理论值

| 条件 | 伤害 | 变化 |
|---|---|---|
| 无 debuff | 1085 | — |
| 有 physical_vulnerable | **1215** | +130 (+12.0%) |

**关键检查**：PERLICA 战技（法术伤害）不应被 physical_vulnerable 影响，仍应为 1230。

### F. 计算过程

```
ENDMINISTRATOR ATK:
  = floor(319 × (1 + 0) × (1 + 70.0/100 + 24.6/100))
  = floor(319 × 1.946)
  = floor(620.774)
  = 620

无 debuff:
  = floor(620 × 3.50 × 0.5)
  = floor(1085)
  = 1085

有 physical_vulnerable:
  vulnerability = 1 + 12 / 100 = 1.12
  = floor(620 × 3.50 × 0.5 × 1.12)
  = floor(1085 × 1.12)
  = floor(1215.2)
  = 1215
```

---

## 测试 4（可选）：PERLICA 战技验证不吃 physical_vulnerable

### A. 测试名称

物理易伤不影响法术伤害确认

### B. 排轴步骤

1. 放 ESTELLA 和 PERLICA
2. 天赋/潜能全部调为 0
3. ESTELLA 连携 → PERLICA 战技
4. 点击"伤害统计"
5. PERLICA 战技伤害应仍为 1230（与测试 1 一致）

### C. 为什么简单

反向验证：physical_vulnerable 只影响物理伤害，不影响法术伤害。PERLICA 是 emag（法术），不应被影响。

### D-F. 理论值

PERLICA 战技 = **1230**（与测试 1 完全一致）

如果不是 1230，说明 physical_vulnerable 错误地影响了法术伤害。

---

## 待确认项

| 项 | 说明 |
|---|---|
| ENDMINISTRATOR 战技是否单段 | 如果是多段（如 3 段各 116.7%），伤害统计面板会显示总和。理论总值不变，但需核对分段 |
| PERLICA 战技是否确为单段 | 如果实际有多段 tick，总值不变但分段情况不同 |
| artsPower 在无天赋/无潜能时是否为 0 | stats.json 无此字段 → configuredStats 应为 0。如果有默认值需要修正 |
| 天赋等级调为 0 后 ENDMINISTRATOR 的 runtime_passive 是否消失 | getTrackTalentLevel 返回 0 → activeStage = null → 无 effects → 确认正确 |

---

## 建议优先实测顺序

### 第 1 步：测试 1（PERLICA 基线）

这是所有后续测试的基线。如果这里就不对，说明 ATK 公式或基础乘区有问题。

**预期值：1230**

### 第 2 步：测试 2（GILBERTA spell_vulnerable）

在基线已确认的前提下，加入 GILBERTA 终结技，看 PERLICA 战技伤害是否变为 1377。

- 如果 > 1230 但 ≠ 1377：spell_vulnerable 生效但数值不对
- 如果 = 1230：spell_vulnerable 未生效
- 如果 < 1230：方向反了（用户报告的现象）
- 如果 = 1377：完全正确

### 第 3 步：测试 3（ESTELLA physical_vulnerable）

验证物理易伤：ENDMINISTRATOR 战技从 1085 变为 1215。

### 第 4 步：测试 4（反向验证）

确认 physical_vulnerable 不影响 PERLICA 法术伤害（仍为 1230）。
