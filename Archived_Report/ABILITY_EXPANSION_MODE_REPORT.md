# 能力扩展模式切换报告

> 时间：2026-04-01
> 基线：266 tests pass, 0 TS errors

---

## 1. 修改的文件

| 文件 | 操作 |
|---|---|
| `views/TimelineEditor.vue` | `editorMode` ref ('timeline'/'abilityExpansion')；三栏按 mode 切换内容；+左栏 avatar list CSS |
| `components/AbilityExpansionOverlay.vue` | 移除 `position: absolute` overlay 定位，改为普通流式布局 |
| `components/OperatorInfoPanel.vue` | 入口按钮读 `editorMode`，高亮激活态 |

---

## 2. 是否为 mode / view switch

**是**。`editorMode` 是 TimelineEditor 级别的 `ref('timeline')`，`provide` 给子组件。值为 `'abilityExpansion'` 时，`app-layout` 的三栏内容全部切换：

```
editorMode === 'timeline':
  左: ActionLibrary
  中: timeline-main (header + workspace)
  右: PropertiesPanel

editorMode === 'abilityExpansion':
  左: ae-left-col (干员头像列)
  中: ae-center-main (AbilityExpansionOverlay)
  右: ae-right-sidebar (PropertiesPanel)
```

三栏通过 `v-if="editorMode === 'timeline'"` / `v-else` 完整切换，不是 overlay 叠加。

---

## 3. 按钮高亮

**是**。`OperatorInfoPanel` 的"能力扩展"按钮 inject `editorMode`，当 `=== 'abilityExpansion'` 时加 `is-active` class：
- 金色背景加深 + 金色边框
- 箭头从 `▸` 变为 `●`

---

## 4. 排轴主体退出

**是**。`timeline-main`（含 header + workspace + DamageSummaryPanel + TimelineGrid + ResourceMonitor + LegalityIssuePanel）在 `editorMode !== 'timeline'` 时不渲染（`v-if`），完全退出 DOM。

---

## 5. 三栏内容

| 栏 | 能力扩展模式 |
|---|---|
| 左 | 干员头像列（ae-avatar-list）：显示所有队伍成员，点击切换 activeTrackId |
| 中 | AbilityExpansionOverlay：顶部栏 + 战斗技能区(4项) + 天赋阵列区(3排) |
| 右 | PropertiesPanel：显示选中技能详情 + 底部保留 +/- 控件 |

---

## 6. 右下角 +/- 

**是**。AbilityExpansionOverlay 底部右侧的浮动 `.ae-level-controls` 仍只对当前选中技能生效。选中天赋时不显示。

---

## 7. 复用 vs 替换

| 复用 | 替换 |
|---|---|
| 技能4项顺序 + 图标 | 从 overlay 定位 → 流式主内容 |
| 技能等级 +/- 精英化约束 | 从 workspace 内 overlay → editor mode 切换 |
| 天赋3排结构 | 左栏从 ActionLibrary → 独立 avatar 列表 |
| `provide/inject` promo 共享 | v-show 隐藏 → v-if 完整切换 |
