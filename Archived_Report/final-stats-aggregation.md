# 最终属性视图聚合入口 — 完成报告

## 1. resolveTrackBaseStats 确认

代码中 `resolveTrackBaseStats(trackId)` 内部调用 `resolveBaseStats(trackId, g.characterLevel)`。

在这个项目里 `track.id === operatorId`（由 `changeTrackOperator` 设置 `track.id = newOperatorId`），所以 `trackId` 就是 `operatorId`，语义正确，不是笔误。

已将注释补明确：`@param {string} trackId — also the operatorId`。

## 2. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/stores/timelineStore.js` | 新增 `resolveTrackFinalStats(trackId)` 和 `BASE_STAT_FIELDS` 常量，导出 |

本次未新增文件，未改其他组件。

## 3. 聚合入口

### `resolveTrackFinalStats(trackId)`

- **位置**: `timelineStore.js`，已导出
- **性质**: 按需计算函数，不持久存储结果

### 输入
- `trackId`（即 operatorId）
- 内部自动读取：
  - `track.growth.characterLevel` → 用于查基础属性
  - `track.stats` → 武器/装备 delta（由现有 syncWeapon/Equipment 系统维护）

### 输出
完整 CORE_STATS 对象（34 个字段），包含：

| 字段类型 | 字段 | 计算方式 |
|---|---|---|
| 基础属性 | `strength`, `agility`, `intellect`, `will`, `attack`, `hp` | wiki 基础值 + 武器/装备 delta |
| 修饰属性 | `crit_rate`, `crit_dmg`, `blaze_dmg`, ... 等 28 个 | 0 + 武器/装备 delta（基础为 0） |

## 4. 聚合逻辑

```
对于每个 CORE_STATS 字段:
  baseVal = (该字段属于基础6项 且 wiki数据可用) ? wiki查表值 : 0
  deltaVal = track.stats[field] (由 weapon/equipment delta 系统维护)
  result[field] = baseVal + deltaVal
```

- 基础属性来自: `resolveTrackBaseStats()` → wiki normalized data table[1]
- Delta 来自: `track.stats`（由 `syncTrackWeaponModifiers` + `syncTrackEquipmentModifiers` 写入）

## 5. 未改动的部分

- simulation/runtime — 未改
- 武器/装备 delta 系统 — 未改
- 最终属性未持久写回 track — 仅函数调用时现算
- UI 组件 — 未改

## 6. 后续接入建议

### UI 消费
任何组件可直接调用：
```javascript
const stats = store.resolveTrackFinalStats(store.activeTrackId)
// stats.strength, stats.attack, stats.hp, ...
```
适合用在 OperatorInfoPanel 的属性展示区或能力扩展面板。

### Simulation 接入
`resolveTrackFinalStats()` 返回的对象可直接作为 simulation 输入的属性源。在 compiler/runtime 需要读取角色属性时，替换当前硬编码或默认值即可。

### 如果需要 reactive
当前是普通函数（非 computed）。如果 UI 需要自动响应 growth/weapon/equipment 变化，可在组件内包一层：
```javascript
const finalStats = computed(() => store.resolveTrackFinalStats(store.activeTrackId))
```
Vue 的响应式会自动追踪 `tracks.value` 和 `growth` 的变化。
