# 技能候选映射报告

> 时间：2026-03-25
> 结果：24 干员 96 技能全部映射完成，0 unknown_needs_review
> 存储：`src/external-data/warfarin-wiki/operators/mapped-skills/`
> 影响：266 tests pass, 0 TS errors — simulation 完全不受影响

---

## 1. Classification 汇总

| 分类 | 数量 | 说明 |
|---|---|---|
| base_damage_candidate | 161 | 技能本体 hit 倍率，推荐进入 skill multiplier |
| stagger_or_break_value | 85 | 失衡值，不进入 multiplier |
| extra_damage_candidate | 50 | 追加/条件伤害，需人工审核 |
| cooldown_or_cost | 47 | CD / 终结技能量消耗 |
| status_value | 38 | buff/debuff/脆弱/增幅数值 |
| resource_gain | 37 | 技力恢复/终结技充能 |
| status_duration | 35 | 持续时间 |
| multi_hit_damage_candidate | 30 | 多段 hit 倍率，推荐进入 multiplier |
| finisher_damage_candidate | 28 | 终结一击/处决，推荐进入（处决需审核） |
| anomaly_or_reaction_damage | 3 | 持续伤害/异常伤害，不进入 skill multiplier |

---

## 2. includeInSkillMultiplier 分布

- `true` (推荐进入): 219 行
- `false` (明确排除): 245 行
- `"needs_review"` (需人工确认): 50 行

---

## 3. Spot Check 样例

### 管理员 ENDMINISTRATOR

| 技能 | INCLUDE | REVIEW | EXCLUDE |
|---|---|---|---|
| 普攻 | 5段倍率 | 处决、下落 | — |
| 战技 | 伤害倍率 | — | 失衡值 |
| 连携 | 伤害倍率 | 击碎结晶伤害 | CD、失衡、封印时间 |
| 终结 | 伤害倍率 | 额外伤害 | 失衡值 |

### 莱万汀 LAEVATAIN

| 技能 | INCLUDE | REVIEW | EXCLUDE |
|---|---|---|---|
| 普攻 | 5段倍率 | 处决、下落 | — |
| 战技 | 初始爆炸 | 追加伤害、终结技期间各段 | DoT、失衡、充能、燃烧时长 |
| 连携 | 伤害倍率 | — | CD、失衡、充能 |
| 终结 | — | 强化普攻1-4段 | 能量、持续时间 |

### 波格拉尼奇尼克 POGRANICHNIK

| 技能 | INCLUDE | REVIEW | EXCLUDE |
|---|---|---|---|
| 普攻 | 5段倍率 | 处决、下落 | — |
| 战技 | 第一段、第二段 | — | 失衡、破防技力恢复 |
| 连携 | 第一/二/三段 | 强化第三段 | CD、失衡、技力恢复 |
| 终结 | 进军、袭扰、决胜 | — | 能量、持续时间、失衡、技力恢复 |

---

## 4. 后续操作建议

1. **人工审核 50 条 `needs_review`** — 主要是处决攻击、下落攻击、条件额外伤害、终结技期间强化段
2. **批量写入 skillMultipliers.ts** — 将 `includeInSkillMultiplier === true` 的行提取 M3 值，÷100 转小数
3. **对齐 gamedata tick 结构** — 将 mapped-skills 的 suggestedTickGroup 映射到 gamedata 的 damage_ticks 顺序
