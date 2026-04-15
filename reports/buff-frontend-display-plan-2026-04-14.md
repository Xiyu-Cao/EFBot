# [待实现] Buff 前端显示系统

## 核心原则

前端显示 = V2 kernel 计算结果的投影。不做任何前端独立计算/预测。

```
V2 kernel SimEvent[] → projections → UI 渲染
```

## 数据流

1. **kernel 产出事件**: `buff_apply`, `buff_remove`, `stack_change`, `attachment_change`, `anomaly_apply`, `damage` 等
2. **projections 转换**: `projectBuffBars()`, `projectStackBuffBars()` 等 → UI 数据结构
3. **投影时标记来源**: 每个 buff bar 携带 `sourceActionId` + `hitTime`（用于在技能条上方显示 buff 图标 + 点击关联）
4. **UI 纯渲染**: 根据投影数据渲染图标/条/颜色

## 显示规则

### 来源层（技能条上方）
- 紧贴技能条上方，位于产生 buff 的 hit 位置
- 只显示图标，不显示持续时间
- 数据来源：kernel 事件中的 time 与 PlacedSkill 的 hit offset 关联

### 效果层（目标对象的 buff 行）
- self buff → 角色 self-buff 行
- team buff → 团队增益行
- enemy debuff → Boss 减益行
- 显示持续时间条（类似现有附着/燃烧条的样式）

### 颜色
- 物理/通用: 灰色 `#999`
- 灼热相关: `#ff6b35`（附着/增幅/脆弱同色）
- 寒冷相关: `#4fc3f7`
- 电磁相关: `#ab47bc`
- 自然相关: `#66bb6a`

### 点击交互
| 点击目标 | 右侧面板显示 |
|---------|------------|
| 技能条 | hit 列表（倍率 + 效果，边框用元素色）|
| buff 图标（技能上方）| buff 详情 + 来源 hit 高亮 |
| buff 条（效果行）| buff 详情 + 来源 hit 高亮 |

### PropertiesPanel 改动
- 删除：基础属性、伤害判定点
- 保留：技能说明、连线控制
- 新增：hit 列表视图、buff 详情视图

## 涉及文件
- `components/ActionItem.vue` — hit 上方 buff 图标
- `components/TimelineGrid.vue` — buff 条颜色
- `components/PropertiesPanel.vue` — 面板重设计
- `simulation/v2/v2ProjectionAdapter.ts` — 颜色逻辑
- `simulation/v2/projections.ts` — BuffBar 携带 sourceActionId/hitTime
- `stores/timelineStore.js` — 交互 API
