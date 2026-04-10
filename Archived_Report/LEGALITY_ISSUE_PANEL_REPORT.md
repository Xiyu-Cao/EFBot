# Legality Issue 面板与节点定位报告

> 时间：2026-03-25
> 基线：266 tests pass, 0 TS errors
> 结论：issue 面板已落地，点击定位已接通，audit 模式 UI 增强已完成

---

## 1. 修改清单

| 文件 | 操作 |
|---|---|
| `components/LegalityIssuePanel.vue` (新) | 完整 issue 列表组件（排序/分色/点击定位） |
| `views/TimelineEditor.vue` | 引入 + 挂载面板到 workspace 底部 |
| `components/ActionItem.vue` | +`isAuditMode` computed + audit badge 样式增强 |

---

## 2. Issue 面板

### 位置
workspace 底部，ResourceMonitor 下方。自动显示条件：
- `legalityPolicy !== 'sandbox'`，或
- `sortedLegalityIssues.length > 0`

sandbox 模式无 issue 时面板自动隐藏。

### 面板内容
- **顶栏**：Legality 标题 + policy badge（sandbox/audit/strict 分色） + issue 数量
- **列表**：每行显示 severity icon / time / actorId / code / message / resolution
- **分色**：warning=amber，error=red，blocked=red 填充背景
- **最大高度**：160px，超出可滚动

### 点击交互
点击任意 issue 行：
1. `store.selectAction(issue.actionId)` — 选中对应 action 节点
2. `document.getElementById('action-' + actionId).scrollIntoView()` — 滚动到可见区域

---

## 3. Audit 模式 UI 增强

| 元素 | sandbox | audit | strict |
|---|---|---|---|
| 工具栏按钮 | 默认样式 | 黄色高亮 | 红色高亮 |
| 面板顶栏 badge | 灰色 `SANDBOX` | 黄色 `AUDIT` | 红色 `STRICT` |
| 面板边框 | 默认 | 黄色顶边 | 红色顶边 |
| 节点 badge | 黄色三角 | 黄色三角 + 发光 | 红色三角 + 脉冲 |

audit 模式节点 badge 使用 `filter: drop-shadow(0 0 3px rgba(250,173,20,0.6))` 产生发光效果，区别于 sandbox 的普通 warning badge。

---

## 4. 仍为 TODO

| 项 | 说明 |
|---|---|
| 面板折叠/展开按钮 | 当前面板不可折叠，有 issue 时常驻 |
| issue 过滤（按 severity/actor） | 当前显示全部，无过滤控件 |
| issue 计数 badge 在工具栏按钮上 | 可在 legality 切换按钮旁显示数量 |
| 角色专属条件映射 | endmin_debuff / magma_* / combo |
| Boss dodge window / hitstun | 预留 issue code |
