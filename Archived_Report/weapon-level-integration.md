# 武器等级数值接入 + 面板改版 — 完成报告

## 1. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `timelineStore.js` | 新增 `weaponLevel` 到 track；新增 `computeWeaponAtkAtLevel()`/`setTrackWeaponLevel()`；`computeWeaponDeltasForTrack` 新增 baseAtk + passiveStats 读取；`normalizeTrack` 迁移支持 |
| `ActionLibrary.vue` | 武器区改为大图标+等级滑块布局；新增 `weaponLevelValue`/`weaponAtkDisplay` computed |

## 2. weaponLevel 字段位置

`track.weaponLevel`（默认 90，范围 1-90）。与 weaponId / weaponCommon1Tier 等并列存储在 track 根级。导入旧存档时自动补 90。

## 3. 武器攻击力数据来源

```
ATK(L) = floor(baseAtk × (0.25 + 0.75 × (L-1)/89))
```

- `baseAtk` 来自 `weaponDatabase[weapon].baseAtk`（每件武器的 Lv90 满级攻击力）
- 线性增长：Lv1 = 25% × baseAtk，Lv90 = 100% × baseAtk
- 示例：宏愿(baseAtk=500) Lv1=125, Lv40=289, Lv90=500

注：项目中武器数据只有单一 `baseAtk` 值，无逐级表。此公式是线性近似，后续有真实成长曲线数据时可替换。

## 4. 词条1/2 查表

词条1/2 = `commonSlots`，通过 `weaponCommonModifiers` 表按 tier (1-9) + size (small/medium/large) 查值。**已有逻辑，本次未改动**。

## 5. 词条3 / 武器 buff

词条3 = `triggeredBuffs`，由 `weaponDataAdapter.ts` 在 simulation 启动时注册为装备被动效果，战斗中按触发条件激活。**已有逻辑，属于 Layer 3 动态体系，本次未改动**。

另外新增了 `passiveStats` 读取：武器的静态面板加成（如源石技艺强度 +84）现在也进入 delta。

## 6. 新增进入 delta 的武器数据

| 数据源 | 之前 | 现在 |
|---|---|---|
| `baseAtk` → 武器攻击力 | ❌ 未使用 | ✅ 按等级查表进入 `deltas.attack` |
| `passiveStats` → 静态加成 | ❌ 未使用 | ✅ 所有条目进入对应 delta |
| `commonSlots` → 词条1/2 | ✅ | ✅（未改） |
| `buffBonuses` → 词条buff | ✅ | ✅（未改） |
| `triggeredBuffs` → 战斗buff | ✅（Layer 3） | ✅（未改） |

## 7. 联动验证

宏愿 Lv90 装备到管理员(E4/Lv90)：
- 武器ATK delta: +500
- 管理员 base attack: 319
- common slot 1 (agility large tier9): +39 → agility
- common slot 2 (attack large tier9): +39 → attack
- passiveStats: originium_arts_power +84
- configured attack = 319 + 500 + 39 = 858
- agility = 200(含天赋row1) + 39 = 239 → primary_ability +119.5%
- effectiveATK = floor(858 × 2.441) = 2093

改 weaponLevel → ATK 变化 → configured stats 更新 → 左侧面板/详情模式/simulation 输入全链联动。

## 8. 未动内容

- 潜能模块：未做
- 技能倍率选择：未做
- simulation/runtime 架构：未改
- 装备部分：未在本次扩展
