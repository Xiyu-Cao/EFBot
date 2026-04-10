# 装备数据修复 — 完成报告

## 问题

1. 所有 66 个非 Lv70 装备的 affix 数据为空（modifierId: null, values: [0]）
2. 装备的 `attack` modifier 需要区分 flat ATK vs ATK%

## 修复

### 数据更新
从 warfarin.wiki 抓取了全部 66 个非 Lv70 装备的真实属性数据，更新到 `gamedata.json`。

### 区分 flat vs percentage
- 武器的 `attack` modifier → `attack_percent`（通过 `remapWeaponModifierId`）
- 装备数据在抓取时直接区分：wiki 显示 `+10.5%` → 存为 `attack_percent`，显示 `+16` → 存为 `attack`（flat）
- 装备 delta 计算不再做 remap，直接使用数据中的 modifierId

### 新增 CORE_STATS 字段
- `defense`（防御力，装备提供）
- `hp_percent`（生命值百分比加成，装备提供）

## 改了哪些文件

| 文件 | 改动 |
|---|---|
| `public/gamedata.json` | 66 个非 Lv70 装备的 affix 数据从 warfarin.wiki 抓取填充 |
| `src/utils/coreStats.js` | 新增 `defense`、`hp_percent` 字段 |
| `src/stores/timelineStore.js` | `remapModifierId` 改为 `remapWeaponModifierId`（仅武器使用）；装备 delta 不再 remap |

## 验证

| 装备 | 预期 | 实际 |
|---|---|---|
| 蚀电屏蔽背心 (lv36) | flat attack +16 | `attack=16`（flat，进入 stats.attack） |
| 蚀电防护扳手 (lv36) | ATK +10.5% | `attack_percent=10.5`（进入 ATK% 乘区） |
| 蚀电防护背心 (lv36) | defense+28, will+44, agility+29, hp+10.5% | 全部正确（agility 之前被漏掉，已修复） |
| 巡行信使夹克 (lv36) | flat attack +16 | `attack=16`（flat） |
