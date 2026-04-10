# Legality UI 可视化与 Audit 入口报告

> 时间：2026-03-25
> 基线：266 tests pass, 0 TS errors
> 结论：三态 legalityPolicy 已落地 UI，节点 legality badge 已接入，issue 列表数据已就绪

---

## 1. 修改清单

| 文件 | 操作 |
|---|---|
| `stores/timelineStore.js` | `strictMode` boolean → `legalityPolicy` ref 三态 + `strictMode` computed 兼容层 + `sortedLegalityIssues` |
| `components/ActionItem.vue` | +legality badge（warning/error/blocked 三色 + tooltip + 脉冲动画） |
| `views/TimelineEditor.vue` | 按钮改为三态循环（sandbox→audit→strict），按模式变色 |
| `i18n/locales/en.json` | +`legalityMode.sandbox/audit/strict` |
| `i18n/locales/zh-CN.json` | +`legalityMode` 中文（自由/验轴/严格） |

---

## 2. 三态按钮行为

点击按钮循环：**自由 → 验轴 → 严格 → 自由**

| 模式 | legalityPolicy | 按钮样式 | 放置行为 | 执行行为 | 节点标记 |
|---|---|---|---|---|---|
| 自由 (Sandbox) | `"sandbox"` | 默认 | 允许 | 允许 | 黄色 warning badge |
| 验轴 (Audit) | `"audit"` | 黄色高亮 | 允许 | 允许 | 黄色 warning badge |
| 严格 (Strict) | `"strict"` | 红色高亮 | 预检拦截 | blocked action 跳过 | 红色 error badge + 脉冲 |

sandbox 和 audit 的区别在 issue 的 `resolution` 字段：sandbox=`allowed`，audit=`warned`。UI 可据此做不同强度的显示。

---

## 3. 节点 legality badge

**位置**：ActionItem 左下角（与右上角的 lock/disabled 不冲突）

**三种状态**：
- **黄色三角**（`.legality-error`）：有 error-level issue，但未 blocked（sandbox/audit）
- **红色三角**（`.legality-blocked`）：action 被 strict 阻断，带脉冲动画
- **隐藏**：无 issue

**Tooltip**：hover 显示所有 issue 的 `[severity] message`，每条一行。

---

## 4. Issue 列表数据

### `store.legalityIssuesByAction`
`Map<actionId, LegalityIssue[]>` — 按 action 分组，供节点组件消费。

### `store.sortedLegalityIssues`
`LegalityIssue[]` — 按时间排序的扁平列表，供面板/列表视图消费。

每条 issue 结构：
```typescript
{
  time: number,
  actorId: string,
  actionId: string,
  severity: "info" | "warning" | "error",
  code: string,       // SP_INSUFFICIENT / GAUGE_INSUFFICIENT / COOLDOWN_ACTIVE / CONDITION_NOT_MET
  message: string,
  resolution: "allowed" | "warned" | "blocked"
}
```

---

## 5. 兼容性

- `store.strictMode` 仍可用（computed 从 legalityPolicy 派生：`=== 'strict'`）
- `store.toggleStrictMode()` 仍可用（内部改为三态循环）
- `validateSkillPlacement()` 不变（仍是 UI 放置预检）
- 已有组件中 `store.strictMode ? 'is-active' : ''` 仍正常工作

---

## 6. 仍为 TODO

| 项 | 说明 |
|---|---|
| Issue 面板 / 列表 UI 组件 | `sortedLegalityIssues` 数据已就绪，需实现面板 Vue 组件 |
| 点击 issue 定位到 action | 需要 `store.selectAction(actionId)` + scroll-into-view |
| audit 模式专属 UI 强调 | 当前 audit 与 sandbox 节点样式相同，可后续区分 |
| 角色专属条件映射 | endmin_debuff / magma_* / combo 仍 assumed met |
| Boss dodge window / hitstun | 预留了 issue code，未实现 |
