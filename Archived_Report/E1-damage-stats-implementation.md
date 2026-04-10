# E1 伤害统计模式实施报告

---

## 1. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/views/TimelineEditor.vue` | "模拟器"按钮 → "伤害统计"按钮，点击调用 `store.runDamageStats()` |
| `src/stores/timelineStore.js` | 新增 `damageStatsSnapshot` ref + `runDamageStats()` 方法 + 导出 |
| `src/components/DamageSummaryPanel.vue` | 数据源从 `store.damageSummary` 改为 `store.damageStatsSnapshot`，空状态提示更新 |

仅 3 个文件。

## 2. 具体改了什么

### TimelineEditor.vue
- 按钮文案：`模拟器` → `伤害统计`
- 点击事件：`router.push('/simulator')` → `store.runDamageStats()`
- 图标：闪电 → 折线图（与 DamageSummaryPanel 标题图标一致）

### timelineStore.js
- 新增 `damageStatsSnapshot = ref(null)` — 缓存最近一次计算结果
- 新增 `runDamageStats()` 方法：
  1. 读取 `simulation.value`（已有 computed，不额外运行引擎）
  2. 从 `simLog` 提取 `DAMAGE_TICK` 和 `ANOMALY_DAMAGE` 条目
  3. 按 actorId / actionId 聚合真实伤害值
  4. ANOMALY_DAMAGE 按来源 actor 分组为"异常伤害"条目
  5. 输出格式与旧 `damageSummary` 兼容（totalDamage + byActor 数组）
  6. 写入 `damageStatsSnapshot`

### DamageSummaryPanel.vue
- 数据源：`store.damageSummary` → `store.damageStatsSnapshot`
- 空状态提示：`暂无数据（请先编译时间轴）` → `点击顶部「伤害统计」按钮计算`

## 3. 行为变化

| 之前 | 现在 |
|---|---|
| 面板实时跟随时间轴变化自动重算 | 面板只在点击"伤害统计"按钮时更新 |
| 伤害值来自 `_calcHitDamage` 简化公式 | 伤害值来自 simulation 引擎的 simLog 真实结果 |
| vulnerability=0, resistance=1.0 硬编码 | 导电/腐蚀/武器被动/天赋被动全部自动反映 |
| 拖动技能时面板不断闪动 | 拖动时面板静止，需手动刷新 |

## 4. 未改动的内容

- 旧 `damageSummary` computed 保留（未删除，可能有其他消费者）
- 旧 `_calcHitDamage` 函数保留
- `simulation` computed 仍为实时 reactive（legality/SP/stagger 仍依赖）
- 面板样式和布局不变
- 不做完整归因 / buff 贡献分摊 / 异常来源拆分

## 5. 测试结果

- vue-tsc 类型检查通过
- 78 个 simulation 相关测试全通过，0 新增失败
