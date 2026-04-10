# Buff 区 v1.5 改造报告

> 时间：2026-03-31
> 基线：266 tests pass, 0 TS errors

---

## 1. 修改的文件

| 文件 | 修改 |
|---|---|
| `components/TimelineGrid.vue` | 个人 buff 从底部移回角色区、底部只留全局 buff、折叠+点击+pin 交互、set bonus 弱化 |
| `components/PropertiesPanel.vue` | +buff 详情视图（inject selectedBuffData）、+pin 按钮 |

---

## 2. 个人 buff 迁移后的交互

### 角色时间轴区域（从上到下）
1. **技能/行动条** — 不变
2. **个人 buff 条** — 完整 buff 时间条（原有 self-buff-layer，保持位置不变）
3. **武器效果条** — 不变
4. **终结技充能条** — 不变

### 个人 buff 条行为
- buff 数 ≤ 3 时：始终全部展示，无折叠
- buff 数 > 3 时：左侧标题显示 `▸ 自身增益 N`，点击可展开/收起
- 收起时：只显示已 pin 的 buff
- 展开时：显示全部 buff
- 每条 buff 可点击 → 右侧显示详情

### 下方全局 buff 区（从上到下）
1. **附着层** — 常驻展开
2. **物理异常层** — 常驻展开
3. **队伍增益** — 默认收起，点击标题展开
4. **Boss 减益** — 默认收起，点击标题展开

v1 中的"个人 buff 摘要行"已从底部移除。

---

## 3. 右侧 buff 详情

### 能显示的信息
- buff 名称
- buff 图标
- 来源角色 ID
- buff 类型 key
- 时间区间（startTime → endTime）
- 当前层数（stacks > 1 时显示）
- 是否已 pin
- "设为常显 / 取消常显"按钮

### 当前拿不到的信息
- **效果描述文本**：self-buff 数据中无 description 字段，只有 name/type/stacks
- **来源技能/装备名称**：数据中只有 sourceTrackId（角色 ID），无具体技能/武器名
- **人类可读效果值**（如 +28% 攻击力）：数据中无此字段

这些需要 buff 元数据扩展，当前先显示已有字段。

---

## 4. Pin / 常显交互

- 点击 buff → 右侧详情 → "📌 设为常显" 按钮
- 被 pin 的 buff 左上角显示 📌 小图标
- 选中的 buff 有金色 outline
- pin 状态为 session 内 `Set<string>`，不持久化
- 角色个人 buff 收起时，pin 的 buff 仍显示

---

## 5. Set bonus 处理

"已激活套装效果"文本替换为 `✦` 单字符 tooltip 提示，不再占整行文字空间。

---

## 6. 限制与建议 v2

| 项 | 说明 |
|---|---|
| buff 效果描述 | 需要 buff metadata 加 description 字段 |
| 来源技能名 | 需要在 self-buff 数据中记录 sourceActionId → 反查技能名 |
| pin 持久化 | 当前 session 内，可加 localStorage |
| 武器效果的点击/pin | 当前未纳入（有独立交互体系），可后续统一 |
| buff 排序/分组 | 当前按时间自然排列，可加按类型分组 |
