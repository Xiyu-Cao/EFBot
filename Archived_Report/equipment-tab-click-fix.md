# 装备 Tab 点击无响应 — Bug 修复报告

## 根因

`openWeaponSelector` / `openEquipmentSelector` 通过 Vue `provide/inject` 从 TimelineGrid 提供给 ActionLibrary。但在组件树中 ActionLibrary 和 TimelineGrid 是**兄弟关系**（都是 TimelineEditor 的子组件），不是父子关系。Vue 的 `provide/inject` 只能向下传递（parent → descendant），不能跨兄弟。

因此 ActionLibrary 的 `inject('openWeaponSelector', () => {})` 拿到的始终是 **fallback 空函数** `() => {}`，点击后什么都不会发生。

## 改了哪些文件

| 文件 | 改动 |
|---|---|
| `TimelineEditor.vue` | 新增 relay refs + provide：在共同父组件级别提供 `openWeaponSelector` / `openEquipmentSelector` 以及注册回调 `_registerWeaponSelector` / `_registerEquipmentSelector` |
| `TimelineGrid.vue` | 不再直接 `provide`；改为 `inject('_registerXxx')` 并调用注册函数，把自己的真实函数注册到父组件的 relay ref 上 |

## 修复后的链路

```
TimelineEditor (provide)
├── openWeaponSelector    →  relay wrapper  →  _weaponSelectorFn.value(...)
├── openEquipmentSelector →  relay wrapper  →  _equipmentSelectorFn.value(...)
│
├── TimelineGrid (inject _registerXxx → registers real functions)
│   └── _registerWeaponSelector(openWeaponSelector)
│   └── _registerEquipmentSelector(openEquipmentSelector)
│
└── ActionLibrary (inject openWeaponSelector / openEquipmentSelector)
    └── 现在拿到的是 relay wrapper，间接调用 TimelineGrid 的真实函数
```

## 验证

- 武器区域点击 → 调用 `openWeaponSelector(activeTrackIndex)` → relay 到 TimelineGrid → 打开武器选择弹窗
- 四个装备槽点击 → 调用 `openEquipmentSelector(activeTrackIndex, slotKey)` → relay 到 TimelineGrid → 打开对应装备选择弹窗
- `activeTrackIndex >= 0` 前置条件仍有效（需要先选中一个干员 track）

## 未改动

- 装备页布局/样式未改
- simulation/runtime 未改
- 数值层次结构未改
- 现有 store 的 `updateTrackWeapon` / `updateTrackEquipment` 未改
