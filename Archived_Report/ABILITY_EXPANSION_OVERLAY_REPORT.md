# 能力扩展覆盖界面报告

> 时间：2026-04-01
> 基线：266 tests pass, 0 TS errors

---

## 1. 修改的文件

| 文件 | 操作 |
|---|---|
| `components/AbilityExpansionOverlay.vue` (新) | 覆盖中间主区域的能力扩展界面 |
| `views/TimelineEditor.vue` | 挂载 overlay + provide toggle + v-show 控制 workspace 隐藏 |
| `components/OperatorInfoPanel.vue` | 入口改为触发 overlay（移除旧内嵌 section + 清理死 CSS） |

---

## 2. 覆盖方式

**是**。点击"能力扩展"入口后，中间排轴器主区域（DamageSummaryPanel / TimelineGrid / ResourceMonitor / LegalityIssuePanel）通过 `v-show="!showAbilityExpansion"` 隐藏，`AbilityExpansionOverlay` 用 `position: absolute; inset: 0` 覆盖在 `.timeline-workspace` 上。

左侧 ActionLibrary 和右侧 PropertiesPanel 保持可见。

---

## 3. 左侧头像列

**保留**。`aside.action-library` 不受影响，干员头像列仍可用于切换当前干员。切换干员后 overlay 内容自动响应（通过 `store.activeTrackId` computed 联动）。

---

## 4. 右侧详情列 + 右下角 +/- 按钮

**右侧 PropertiesPanel 保留**。点击 overlay 中的技能图标 → 调用 `store.selectLibrarySkill()` → 右侧显示该技能详情。

**右下角 +/- 按钮**：overlay 底部右侧有浮动控件 `.ae-level-controls`，仅在选中技能时显示：
- 显示：`技能名 · 当前等级`
- 两个按钮：`−` / `+`
- disabled 规则：受精英化上限约束

---

## 5. 中间区域包含

### 战斗技能区（左列）
- 4 张卡片，固定顺序：普通攻击 → 战技 → 连携技 → 终结技 ✅
- 每张卡片：圆形图标 + 名字 + 当前等级 + 进度条
- 点击选中 → 右侧详情 + 右下角 +/-

### 天赋阵列区（右列）
- 3 排圆形节点：主能力 → 天赋1 → 天赋2
- 点击选中天赋 → 右侧可用于显示天赋信息（当前 PropertiesPanel 未特殊处理天赋对象，但点击操作已就绪）

### 顶部栏
- 标题"能力扩展" + 当前干员名 + 精英化等级
- "✕ 返回排轴"按钮关闭 overlay

---

## 6. 技能等级上限

| 精英化 | 统一上限 | 显示 |
|---|---|---|
| 0 | 1 | RANK 1 |
| 1 | 3 | RANK 3 |
| 2 | 6 | RANK 6 |
| 3 | 9 | RANK 9 |
| 4 | 12 | M3 |

精英化状态通过 `provide/inject` 从 OperatorInfoPanel 的 `getPromoState` 共享到 overlay。

---

## 7. 最小可行版本 + 后续补充

| 已完成 | 后续补 |
|---|---|
| 覆盖层结构 + 三栏保留 | 黄色背景随精英化变化 |
| 战斗技能 4 项 + 选中 + 等级 +/- | 技能进度条精确刻度（1-9/M1-M3 节点） |
| 天赋阵列 3 排静态展示 | 天赋锁定态/连线/解锁演出 |
| 右下角浮动 +/- 控件 | 更贴近游戏的升级按钮视觉 |
| 主能力用元素图标代理 | 真实主能力图标 |
| 天赋详情占位 | 天赋效果文本（需结构化数据） |

---

## 8. 只做了前端结构与交互

**是**。未改 store 数据结构、未改 simulation runtime、未改倍率真值。技能等级为组件内 `ref(Map)` UI 状态。
