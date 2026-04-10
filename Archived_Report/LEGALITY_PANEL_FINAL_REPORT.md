# Legality 面板收尾报告

> 时间：2026-03-25
> 基线：266 tests pass, 0 TS errors

---

## 修改

只改了 `components/LegalityIssuePanel.vue`。

### 1. 折叠持久化
- `localStorage` key `endaxis_legality_collapsed`
- `watch(collapsed, ...)` 自动写入
- 刷新页面后保持上次状态

### 2. 按 code 分组
- header 区 `G` 按钮切换 flat ↔ grouped 视图
- grouped 视图按 issue code 分组，每组可独立展开/折叠
- 组头显示 severity icon + code + count
- 组内 item 缩进，省略 severity icon 和 code（已在组头显示）

### 3. 复制摘要
- header 区剪贴板按钮，点击复制当前过滤后的 issue 列表为纯文本
- 格式：
  ```
  Legality Report (strict) — 3 issue(s)
  ————————————————————————————————————————
  [error] t=1.00 HERO_A SP_INSUFFICIENT: SP insufficient: need 250, have 200.0
  [error] t=5.00 HERO_A GAUGE_INSUFFICIENT: Gauge insufficient: need 60, have 30.0 (BLOCKED)
  ```
- 复制成功显示 "Copied!" 反馈，1.5s 后恢复
