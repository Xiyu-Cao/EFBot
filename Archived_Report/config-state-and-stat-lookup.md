# 干员配置状态整理 + 基础属性查表入口 — 完成报告

## 改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/utils/operatorStats.js` | **新增** — 基础属性查表工具：`lookupBaseStats()`、`parseStatsTable()`、`createWikiDataLoader()`、`STAT_NAME_MAP` |
| `src/stores/timelineStore.js` | 导入 operatorStats；新增 `resolveBaseStats(operatorId, level)` 和 `resolveTrackBaseStats(trackId)`；扩展 growth 区域注释，明确配置状态 vs 派生数据的语义边界 |

## track 配置状态字段一览

### 属于"当前配置"（保存到 track）

| 字段 | 位置 | 用途 |
|---|---|---|
| `growth.promotion` | `track.growth` | 精英化等级 0-4 |
| `growth.characterLevel` | `track.growth` | 角色等级 1-90 |
| `growth.skillLevels.*` | `track.growth` | 四技能各自的 rank/mastery |
| `weaponId` | track 根级 | 当前武器选择 |
| `weaponCommon1Tier` | track 根级 | 武器普通槽1潜力等级 |
| `weaponCommon2Tier` | track 根级 | 武器普通槽2潜力等级 |
| `weaponBuffTier` | track 根级 | 武器增益槽潜力等级 |
| `equipArmorId` | track 根级 | 护甲选择 |
| `equipGlovesId` | track 根级 | 手套选择 |
| `equipAccessory1Id` | track 根级 | 饰品1选择 |
| `equipAccessory2Id` | track 根级 | 饰品2选择 |
| `equipArmorRefineTier` 等 | track 根级 | 各装备精锻等级 |

### 明确不应存入 track（按需查出来）

| 数据 | 来源 | 查表方式 |
|---|---|---|
| 干员基础属性（力量/敏捷/智识/意志/攻击力/生命值） | warfarin-wiki 规范化数据 | `store.resolveBaseStats(operatorId, level)` 或 `store.resolveTrackBaseStats(trackId)` |
| 武器静态数据 | weaponDatabase | `store.getWeaponById(id)` |
| 装备静态数据 | equipmentDatabase | `store.getEquipmentById(id)` |
| 技能每级倍率 | warfarin-wiki skills | 尚未接入，后续可扩展 |

## 基础属性查表入口

### `resolveBaseStats(operatorId, level)`
- **位置**: `timelineStore.js`（已导出）
- **输入**: 干员 ID + 角色等级
- **输出**: `{ strength, agility, intellect, will, attack, hp }` 或 `null`
- **数据源**: warfarin-wiki normalized JSON → `stats.tables[1]`（完整 1-90 级数据，直接查表无需插值）

### `resolveTrackBaseStats(trackId)`
- **位置**: `timelineStore.js`（已导出）
- **输入**: track ID
- **输出**: 同上，自动从 `track.growth.characterLevel` 读取等级
- **便捷封装**: 内部调用 `resolveBaseStats(track.id, growth.characterLevel)`

### 底层工具 (`src/utils/operatorStats.js`)
- `parseStatsTable(wikiNormalized)` — 解析 wiki 数据 table[1] 为 `Map<level, stats>`
- `lookupBaseStats(wikiNormalized, level)` — 单次查询
- `createWikiDataLoader()` — 返回 `(slug) → normalizedJSON` 的工厂函数
- `STAT_NAME_MAP` — 中文列名 → CORE_STATS id 映射

## 武器/装备配置

武器和装备配置字段**已经在 track 根级**（`weaponId`, `equipArmorId` 等），本次未移动它们。它们天然就是"当前配置状态"，语义正确。

未来如果需要把它们统一到一个 `track.build` 对象里，可以做，但当前武器/装备 delta 计算系统（`syncTrackWeaponModifiers`、`syncTrackEquipmentModifiers`）直接读这些根级字段，移动成本较高，这次不改。

## 未接入的部分

- simulation/runtime — 未改动
- 最终属性计算（base + weapon + equipment + buff 聚合）— 未实现，仅铺好了入口
- `track.stats` 仍由现有 weapon/equipment delta 系统维护 — 这是 track 上唯一的"计算结果存储"，后续可逐步迁移为 computed

## 后续继续接的路径

```
1. track.growth         ← 已完成
2. resolveBaseStats()   ← 已完成（本次）
3. 武器/装备配置读取     ← 已有（track 根级字段）
4. 修饰符聚合            ← 已有（syncWeapon/Equipment delta 系统）
5. ★ 最终属性 computed  ← 下一步：基于 base + deltas 组合出最终显示值
6. simulation 输入       ← 之后：把最终属性喂给 runtime
```

建议下一步从第 5 步开始：写一个 `computedTrackFinalStats(trackId)` 或 store getter，把 `resolveTrackBaseStats()` 的结果和 `track.stats`（已含 weapon/equipment deltas）合并，输出一个完整的当前属性视图。
