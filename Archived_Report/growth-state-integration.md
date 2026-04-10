# 能力扩展模式接入主状态/store — 完成报告

## 改了哪些文件

| 文件 | 改动 |
|---|---|
| `timelineStore.js` | 新增 `growth` 字段到 `createEmptyTrack()`，新增 `getTrackGrowth`、`setTrackPromotion`、`setTrackCharacterLevel`、`setTrackSkillLevel`、`skillToUnified`、`skillFromUnified`、`skillMaxUnified` 等 store 方法，`normalizeTrack` 中增加 `growth` 迁移逻辑 |
| `AbilityExpansionOverlay.vue` | 删除本地 `skillLevels` Map 和所有重复的转换函数，改为通过 store 读写 |
| `OperatorInfoPanel.vue` | 删除本地 `promotionLevels` Map 和 `skillLevels` Map，删除 `provide('getPromoState')`，全部改为 store `growth` 读写 |

## 技能等级在主状态的位置

```
store.tracks[i].growth.skillLevels.{attack|skill|link|ultimate}
```

每个值为 `{ rank: 1-9, mastery: 0-3 }`。

## 同步范围

- 能力扩展面板（段数、专精图标）— 即时更新
- 左侧 OperatorInfoPanel 技能等级显示 — 即时更新（读同一份 `track.growth`）
- 切换干员各自独立 — 状态挂在各 track 上
- 退出能力扩展模式后状态不丢失 — 状态在 store
- 项目导出/导入自动包含 — `growth` 在 track 内，序列化自动覆盖

## 状态来源一览

| 状态 | 来源 |
|---|---|
| 精英化等级 | `track.growth.promotion` |
| 角色等级 | `track.growth.characterLevel` |
| 技能等级 | `track.growth.skillLevels` |

三者从同一个 `growth` 对象读写。

## 被移除的 local ref

- `OperatorInfoPanel.promotionLevels` (Map)
- `OperatorInfoPanel.skillLevels` (Map)
- `AbilityExpansionOverlay.skillLevels` (Map)
- `provide('getPromoState')` / `inject('getPromoState')` 跨组件注入链

## Simulation/runtime

未改动。`growth` 数据目前还没有接入 simulation 计算链。

## 后续扩展

`track.growth` 可自然添加字段：

```javascript
{
  promotion: 4,
  characterLevel: 90,
  skillLevels: { ... },
  // 后续:
  // abilityExpansion: { ... },
  // weaponConfig: { ... },
  // computedStats: { ... },
}
```

所有 growth helper（`skillToUnified`、`skillMaxUnified`、`PROMO_CAPS` 等）已从 store 导出，任何组件可直接使用。
