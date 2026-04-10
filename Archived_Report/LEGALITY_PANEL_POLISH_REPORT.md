# Legality 面板可用性打磨报告

> 时间：2026-03-25
> 基线：266 tests pass, 0 TS errors

---

## 修改清单

| 文件 | 操作 |
|---|---|
| `components/LegalityIssuePanel.vue` | +折叠/展开 + severity 过滤（cycle 按钮）+ actor 过滤（select）+ error 计数 |
| `views/TimelineEditor.vue` | +issue 数量 badge（红色=有 error，灰色=仅 warning） |

---

## 面板折叠/展开

- 点击 header 行切换折叠/展开
- 折叠时只显示 header（标题 + badge + 计数）
- 展开时显示完整 issue 列表（max-height 160px 可滚动）
- 折叠状态为 panel local ref，不持久化，切 policy / rerun 时保持

---

## 过滤

### Severity 过滤
header 内 cycle 按钮，点击循环：**All → error → blocked → warning → All**。
激活时按钮高亮紫色边框。

### Actor 过滤
当有多个 actor 产出 issue 时，显示 select 下拉框。
单 actor 时自动隐藏。

### 计数显示
`filteredCount/totalCount`（过滤激活时显示分数）+ `N err`（error 数红色高亮）。

---

## 工具栏 badge

legality 按钮右侧显示 issue 数量圆角 badge：
- 灰底白字：仅 warning
- 红底白字：含 error
- 无 issue 时隐藏

---

## 仍为 TODO

| 项 | 说明 |
|---|---|
| 面板持久折叠到 localStorage | 当前折叠状态为 session 内 |
| 按 code 分组折叠 | 当 issue 很多时，可按 code 分组 |
| 右键 issue → 复制 | 便于分享验轴结果 |
| 角色专属条件 | endmin_debuff / magma_* / combo |
