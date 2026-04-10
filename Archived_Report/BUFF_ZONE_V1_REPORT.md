# Buff 区 v1 改造报告

> 时间：2026-03-31
> 基线：266 tests pass, 0 TS errors
> 只改了 1 个文件：`components/TimelineGrid.vue`

---

## 1. 改了什么

只改了 `components/TimelineGrid.vue`，包括：
- 新增 script 段：collapse state refs + toggle 函数 + 摘要计算函数
- 重写左侧 header 区块：新顺序 + 折叠箭头 + 个人 buff 摘要行
- 重写右侧 content 区块：对应新顺序 + 折叠逻辑
- 新增 CSS：collapse arrow、selfbuff 摘要行样式、transition

---

## 2. v1 交互行为

### 4 层结构（从上到下）

| 层 | 标签 | 默认状态 | 折叠控制 |
|---|---|---|---|
| 1. 附着 + 物理异常 | 附着 / 物理异常 | **常驻展开** | 不可折叠 |
| 2. 个人 buff | 角色名 + 数量 + 摘要 | **默认收起** | 按角色独立 ▸/▾ |
| 3. 队伍增益 | 队伍增益 N | **默认收起** | 整组 ▸/▾ |
| 4. Boss 减益 | Boss 减益 N | **默认收起** | 整组 ▸/▾ |

### 个人 buff 摘要条
- 左侧 header：`▸ 角色ID 3` + `雷枪×2 印记×3`（层数>1 的 buff 显示为 notable）
- 右侧 content：收起时显示 notable buff icon×stacks 小标签行
- 点击展开后显示完整 buff 时间条轨道
- 每个角色独立展开/收起（`selfBuffExpandedTracks: Set<trackId>`）

### 队伍增益 / Boss 减益
- 收起时：24px 标题行，只显示标签 + 数量，不渲染 buff 条
- 展开后：恢复完整 buff 轨道（team buff / debuff 各自独立）

### 高度变化
- 收起行 = 24px（`COLLAPSED_ROW_HEIGHT`）
- 展开行 = 按 lane 数量动态计算（与原逻辑一致）
- 添加 `transition: height 0.15s ease` 避免生硬跳动

---

## 3. v2 建议

| 项 | 说明 |
|---|---|
| Pin 关键 buff | 允许用户把某个 buff 固定在摘要行常驻显示 |
| 自动摘要分类规则 | 根据 buff metadata 区分"层数型/资源型/持续型"，当前 v1 只看 `stacks > 1` |
| 单 buff 小眼睛 | 每个详细 buff 条上加 show/hide toggle |
| 收起状态持久化 | 当前 collapse 状态为 session 内 ref，可加 localStorage |
| 附着层紧凑模式 | 当附着 + 物理异常行很多时，允许合并为一行 |

---

## 4. 受限点

- **摘要显示**：当前 v1 只能区分 `stacks > 1` 的 buff 作为 notable 显示。更精确的"层数型/资源型"分类需要 buff metadata 里有显式标记，当前数据里没有。
- **武器 buff** 仍在各角色 track 内的 `weapon-status-layer` 里，未纳入新的个人 buff 摘要层（它们有独立的 icon+bar 样式和拖拽交互，移动风险较高）。
