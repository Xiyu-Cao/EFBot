# 武器/装备数值完整接入 — 完成报告

## 1. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `timelineStore.js` | 修复 `primary_ability` / `secondary_ability` 计算：现在正确包含直接的 primary_ability 武器delta，不再被覆盖 |
| `OperatorInfoPanel.vue` | `bonusStats` 从硬编码列表改为完整的 16 项 BONUS_STAT_DISPLAY 配置，自动显示所有非零值 |

## 2. 武器接入的数值字段

武器 delta 系统（`computeWeaponDeltasForTrack`）**已经完整接入所有 17 种 modifier**：

| Modifier | 来源 | 查表方式 |
|---|---|---|
| primary_ability | weaponCommonModifiers table | 按 slot size + tier (1-9) 查表 |
| strength / agility / intellect / will | 同上 | 同上 |
| attack / hp | 同上 | 同上 |
| crit_rate | 同上 | 同上 |
| blaze/emag/cold/nature_dmg | 同上 | 同上 |
| healing_effect | 同上 | 同上 |
| physical_dmg / arts_dmg | 同上 | 同上 |
| originium_arts_power | 同上 | 同上 |
| ult_charge_eff | 同上 | 同上 |
| buffBonuses (任意 modifierId) | 武器 buffBonuses 数组 | 按 buffTier (1-9) 查 values 数组 |

所有数值均按 `weaponCommon1Tier` / `weaponCommon2Tier` / `weaponBuffTier` 实时查表，不是固定值。

## 3. 装备接入的数值字段

装备 delta 系统（`computeEquipmentDeltasForTrack`）**已完整接入**：

| 来源 | 查表方式 |
|---|---|
| primary1 affix (如 agility) | Lv70: 按 refineTier (0-3) 查 values[tier]；其他: values[0] |
| primary2 affix (如 strength) | 同上 |
| adapter entries (如 physical_dmg) | 同上 |
| adapter modifierIds (批量 modifier) | 同上 |

4 个装备槽独立计算，结果累加。

## 4. 修复的 bug

**primary_ability delta 被覆盖**：武器可以直接添加 `primary_ability` modifier（意为"给主属性加值"）。之前 `resolveTrackConfiguredStats` 用 `result[mainAttribute]` 直接覆盖了 `result.primary_ability`，丢失了直接 delta。

修复后：`result.primary_ability = result[mainAttribute] + directPrimaryDelta`。secondary_ability 同理。

验证：武器宏愿(tier9) + 管理员(Lv90)，agility=140+156=296, attack=319+39=358, effectiveATK=floor(358×2.726)=975。

## 5. 数据源完整性

武器和装备数据源（`weaponDatabase` / `equipmentDatabase`）加载自 gamedata.json，由服务器提供。每件武器/装备有完整的：
- commonSlots 定义（modifierId + size）
- buffBonuses 定义（modifierId + 9 级 values 数组）
- 装备 affixes（modifierId + 4 级 values 数组）

没有发现数据缺失。所有数值都是按真实等级/阶段/精锻查表接入的。

## 6. 进入 configured stats 的完整属性列表

以下属性均会随武器/装备配置变化而更新：

**基础 + 武器/装备 delta**：strength, agility, intellect, will, attack, hp
**纯 delta（基础为 0）**：crit_rate, crit_dmg, physical_dmg, arts_dmg, blaze/emag/cold/nature_dmg, healing_effect, attack/skill/link/ultimate_dmg_bonus, all_skill_dmg_bonus, broken_dmg_bonus, originium_arts_power, ult_charge_eff, link_cd_reduction
**派生**：primary_ability, secondary_ability, effectiveAttack

## 7. 已进计算 vs 已显示到 UI

| 属性 | 进入 simulation | 显示到面板 |
|---|---|---|
| 6 基础属性 | ✅ | ✅（能力值 4 格 + 攻击力 + HP） |
| effectiveAttack | ✅（damage formula 内部计算） | ✅（⚔ 319 → 620 格式） |
| 16 种加成属性 | ✅（通过 track.stats） | ✅（bonusStats 动态显示非零项） |
| primary/secondary ability | ✅（修复后） | ✅（通过 effectiveAttack 间接） |

## 8. 未动内容

- 技能倍率选择：未改 `SKILL_MULTIPLIERS`，明确保留为待办
- simulation/runtime 架构：未改
- operator folder schema：未改
- 能力扩展 UI：未改
