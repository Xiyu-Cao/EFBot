# E1 伤害统计模式审计与方案设计

---

## 1. 顶部按钮位置与当前逻辑

**文件**：`src/views/TimelineEditor.vue` line 570-575

```html
<button @click="router.push('/simulator')" title="DPS 模拟器">
  模拟器
</button>
```

**当前行为**：点击后通过 vue-router 跳转到 `/simulator` 页面（`SimulatorView.vue`），是一个完全独立的外部后端 DPS 模拟器入口，与当前时间轴编辑器无关。

**相关状态**：无。没有 `simulatorMode`、`simMode` 等状态标记。按钮是纯导航，不影响时间轴编辑器内部任何状态。

**结论**：这个按钮可以安全替换，不会影响任何现有功能链。

---

## 2. 当前伤害统计实时重算链路

### 存在两条并行链

**链 A：轻量 damageSummary（当前面板使用）**

```
tracks.value 变化（拖动技能）
  → compiledScenario (computed, line 4383)
    → compileScenario({ tracks: buildSimulationTracks() })
  → damageSummary (computed, line 6086)
    → 遍历 timeline.actions
    → 对每个 tick 调用 _calcHitDamage()（独立简化公式）
    → 返回 { totalDamage, byActor }
  → DamageSummaryPanel.vue 读 store.damageSummary (line 9)
```

**特点**：
- 不运行 simulation 引擎
- 使用独立简化公式 `_calcHitDamage`
- vulnerability=0, resistance=1.0 硬编码
- 不消费运行时 buff/debuff（导电/腐蚀/武器被动等）
- 每次 `tracks.value` 变化自动重算（轻量，但频繁）

**链 B：完整 simulation（当前存在但面板不消费）**

```
tracks.value 变化
  → compiledScenario (computed, line 4383)
  → simulation (computed, line 4399)
    → simulate(timeline, teamConfig, enemyConfig, actors, options)
    → 完整 engine 运行（Effect/Trigger/Anomaly 全链）
    → 返回 { state, simLog, legalityIssues }
  → 被以下消费：
    - legalityIssuesByAction (line 4481) — 合法性检查
    - spSeries (line 4499) — SP 折线图
    - staggerSeries (line 4504) — 失衡折线图
```

**特点**：
- 每次 tracks 变化都会完整重跑 simulation 引擎
- simLog 中有真实伤害值（包含导电/腐蚀/武器被动等全部运行时效果）
- 但 DamageSummaryPanel 不读 simLog——它读的是链 A 的 `damageSummary`
- **已有的完整 simulation 结果被浪费了**

### 哪些地方导致拖动技能时不断重算

- `compiledScenario` 依赖 `tracks.value`（通过 `buildSimulationTracks()`）
- `simulation` 依赖 `compiledScenario.value`
- `damageSummary` 依赖 `compiledScenario.value`
- 三者全部是 computed，无 debounce/throttle/lock
- 每次拖动 → tracks 变化 → 三个 computed 全部重算

---

## 3. 最小改法建议

引入一个显式的"手动触发"机制：

| 状态 | 类型 | 用途 |
|---|---|---|
| `damageStatsSnapshot` | `ref(null)` | 缓存最近一次点击"伤害统计"时的结果 |

**点击"伤害统计"按钮时**：
1. 读取当前 `simulation.value`（已存在的 computed，无需额外运算）
2. 从 `simulation.value.simLog` 提取 DAMAGE_TICK + ANOMALY_DAMAGE 条目
3. 按 actionId/actorId 聚合
4. 写入 `damageStatsSnapshot`
5. DamageSummaryPanel 改读 `damageStatsSnapshot`

**后续拖动时**：`damageStatsSnapshot` 不变，面板不刷新。直到用户再次点击按钮。

---

## 4. 推荐方案 B，理由如下

### 方案 A：复用 damageSummary，改为"点击时计算一次"

- 把 `damageSummary` 从 computed 改为普通函数，点击时调用
- **问题**：`damageSummary` 使用的是 `_calcHitDamage` 简化公式，不消费导电/腐蚀/武器被动
- 导电不生效的问题仍然存在
- 后续要接入完整归因时需要整个替换，返工大

### 方案 B：点击时从 simulation.simLog 提取真实伤害

- `simulation` computed 已存在且已在每次 tracks 变化时运行
- simLog 中已有每个 DAMAGE_TICK 的真实 damage（经过全部 11 个乘区）
- 只需从 simLog 聚合，不需要再跑一次 simulation
- **导电/腐蚀/武器被动/天赋被动自动生效**
- 后续扩展完整归因时，simLog 已包含 breakdown 信息，过渡自然

| 对比 | 方案 A | 方案 B |
|---|---|---|
| 改动量 | 小 | 略大但仍小 |
| 导电/腐蚀是否生效 | 否 | **是** |
| 武器被动是否生效 | 否 | **是** |
| 后续返工 | 大（需替换整个公式） | **小**（simLog 聚合逻辑保留，后续只需加 breakdown 展开） |
| 复杂度 | 低 | 低（simLog 结构简单，按 actionId 聚合即可） |

**推荐方案 B**。

---

## 5. 需要改哪些文件

| 文件 | 改什么 |
|---|---|
| `src/views/TimelineEditor.vue` | "模拟器"按钮改为"伤害统计"按钮，点击调用 store 方法而非 router.push |
| `src/stores/timelineStore.js` | 新增 `damageStatsSnapshot` ref + `runDamageStats()` 方法（从 simulation.simLog 聚合） |
| `src/components/DamageSummaryPanel.vue` | 数据源从 `store.damageSummary` 改读 `store.damageStatsSnapshot` |

可能微调：
| 文件 | 可能需要 |
|---|---|
| `DamageSummaryPanel.vue` | 如果 simLog 聚合结果的字段格式与现有 damageSummary 不同，需适配 |

---

## 6. 这一步明确不做

| 不做 | 理由 |
|---|---|
| 完整归因（每技能的 buff 贡献拆分） | 需要 breakdown 展开 UI，后续做 |
| buff 贡献分摊（"导电贡献了多少伤害"） | 需要 with/without 对比计算，后续做 |
| 异常/DOT 间接归因 | 燃烧 DOT 归属于谁，后续做 |
| 法术爆发/碎冰/腐蚀来源拆分 | ANOMALY_DAMAGE 的来源归因，后续做 |
| 主界面美化 | 不改布局/样式 |
| 时间轴锁定/只读模式 | 不需要——按钮改为手动触发后，拖动不影响已缓存的快照 |
| 删除旧 `damageSummary` computed | 保留，可能有其他消费者或作为 fallback |
| 删除旧 `_calcHitDamage` | 保留 |
| simulation computed 改为手动触发 | 当前 legality/SP/stagger 面板仍依赖它的实时性，不动 |

---

## 7. 最小实施方案（仅方案，不实施）

### 步骤 1：TimelineEditor.vue — 按钮替换

将 line 570-575 的"模拟器"按钮改为：
- 文案：`伤害统计`
- 点击：`@click="store.runDamageStats()"`（调用 store 方法，不跳转路由）
- 可选：按钮增加 active 状态指示（有快照时高亮）

### 步骤 2：timelineStore.js — 新增快照机制

```
damageStatsSnapshot = ref(null)

function runDamageStats():
  1. 读取 simulation.value（已有 computed，触发时已是最新）
  2. 若 simulation.value 为 null → 返回 / 提示
  3. 从 simulation.value.simLog 提取所有 type === "DAMAGE_TICK" 和 "ANOMALY_DAMAGE" 条目
  4. 按 actionId → actorId 聚合 damage
  5. 构造与 damageSummary 相同格式的结果对象 { totalDamage, byActor }
  6. 写入 damageStatsSnapshot.value
```

导出 `damageStatsSnapshot` 和 `runDamageStats`。

### 步骤 3：DamageSummaryPanel.vue — 数据源切换

```
// 之前
const summary = computed(() => store.damageSummary)

// 之后
const summary = computed(() => store.damageStatsSnapshot)
```

面板其余逻辑（展开/折叠、格式化、per-actor 列表）不变，只要输出格式兼容。

### 步骤 4：输出格式兼容

确保 `runDamageStats()` 输出的 `byActor` 数组与现有 `damageSummary.byActor` 格式一致：
```javascript
{
  totalDamage: number,
  byActor: [
    {
      actorId: string,
      name: string,
      damage: number,
      actions: [
        { actionId, skillType, damage, ticks: [...] }
      ]
    }
  ]
}
```

如果 simLog 的聚合结果无法直接产出 `ticks` 数组（simLog 只记录最终 damage，不记录 per-tick multiplier），可以只填 `damage` 字段，`ticks` 为空或省略——面板应能 graceful 降级显示。

### 预期效果

1. 用户编辑时间轴时，DamageSummaryPanel 不自动刷新（显示上次快照或空）
2. 点击"伤害统计"按钮 → 面板立即更新为当前时间轴的真实 simulation 伤害
3. 导电/腐蚀/武器被动/天赋被动全部自动反映在数值中
4. 继续拖动技能 → 面板数字不变（直到再次点击按钮）
