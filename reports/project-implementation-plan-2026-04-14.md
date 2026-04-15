# 项目实现讨论：三模式排轴系统

## 资源盘点

### V2 Kernel 能力（全部 COMPLETE）

| 子系统 | 状态 | 说明 |
|--------|------|------|
| 伤害计算 (damage.ts) | 完整 | 11乘区全实现，real/expected 暴击，per-hit 控制 |
| 效果系统 (effects.ts) | 完整 | BuffManager (3种叠加模式) + StackBuffTracker + 变体选择 |
| 触发系统 (triggers.ts) | 完整 | 10种条件，ICD，immediate/deferred |
| 异常系统 (anomaly.ts) | 完整 | 附着/爆发/反应/物理异常/破防/失衡，全部公式 |
| 资源系统 (resources.ts) | 完整 | SP (双池+回复+暂停)，Gauge (充能效率+封锁窗口) |
| 角色构建 (characterBuild.ts) | 完整 | 武器ATK、属性分解、能力乘数、天赋行1 |
| Store 桥接 (storeAdapter.ts) | 完整 | build构建、action映射、ref解析 |
| 投影 (projections.ts) | 完整 | 8个投影函数，buff/gauge/SP/stagger/damage |
| 角色数据 | 3个完整 | 管理员/骏卫/别礼 全技能+天赋+潜能+触发器 |
| processEffect | 13种类型 | 附着/异常/破防/buff/消耗/delayed_damage/SP等 |
| 条件校验 + 打断 | 完整 | SP/Gauge/CD检查 + 优先级打断 |

### 当前缺口（非阻塞）

| 缺口 | 影响 | 工作量 |
|------|------|--------|
| 连携CD减少stat未应用 | linkCdReduction 不生效 | 30min |
| 武器被动stat未路由 | 武器面板stat不进入build | 1h |
| 装备套装效果注册 | set bonus 无效果 | 需设计 |
| 闪避/切人机制 | 无dodge action | 需设计 |

## 三个模式的实现讨论

### 模式 1：自由排轴（Free Mode）

**用户流程**: 自由摆放技能 → 点击"验证" → kernel 从 t=0 跑一遍 → 报错或通过

**当前状态**: 基本框架已有
- `validateTimeline()` 调用 V2 kernel，`validateConditions: true`
- 条件检查（SP/Gauge/CD）在 kernel 内部
- 打断优先级在 kernel 内部
- `ValidationResultDialog.vue` 弹窗已有

**还需要做的**:
1. **验证通过后的 buff 显示** — kernel 产出 events → projections → 前端渲染（管线已有，但 kernel 的 buff_apply/trigger 链路还没完全调通，别礼幻影追击未验证）
2. **简化模式开关** — 用户说"只计算效果不算伤害"。可以给 KernelConfig 加 `skipDamageCalc: true`，kernel 跳过 Phase 4 的 resolveDamage 但仍产出 buff/attachment/anomaly 事件
3. **前端 buff 渲染** — 见 `reports/buff-frontend-display-plan-2026-04-14.md`

### 模式 2：真实排轴（Realistic Mode）

**用户流程**: 随时间推进放技能，kernel 实时计算每个技能的效果

**当前状态**: V1 有拟真模式框架（playhead + 快捷键），但计算走 V1 引擎（已禁用）

**实现方式讨论**:

kernel 的 `simulate()` 目前是一次性跑完所有 PlacedSkill。真实模式需要**增量模拟**：

**方案 A: 每次放技能重跑全部**
- 用户放一个新技能 → 收集当前时间轴所有技能 → 调用 `simulate()` → 用全量 events 更新显示
- 优点: 最简单，复用现有 kernel
- 缺点: 技能多了会慢（但3-4个角色、30s 时间轴内的技能数量不大，性能应该不是问题）

**方案 B: 增量模拟（kernel 保持状态）**
- kernel 暴露一个 `step(placedSkill)` 方法，接受单个技能，在已有状态上继续处理
- 优点: 真正增量，性能好
- 缺点: 需要重构 kernel 为有状态实例，撤销操作需要快照/回滚机制

**推荐方案 A** — 重跑全部。原因：
1. 排轴场景中技能数量有限（通常 < 50个 hit），重跑开销极小
2. 撤销/重排只需重新 simulate，不需要复杂的状态管理
3. 与自由模式共享同一个代码路径

**前端交互**:
- 拟真模式已有的 playhead + 键盘快捷键可以复用
- 放技能后自动触发 `simulate()` + 投影更新
- 技能可用性检查：从最新 SimulationResult 的 finalState 读 SP/Gauge/CD，决定哪些技能可放

### 模式 3：伤害计算（Damage Mode）

**用户流程**: 排完轴 → 进入伤害计算页面 → 选择暴击模式 → 查看每个 hit 的伤害明细

**当前状态**: kernel 的 `resolveDamage()` 已完整（11乘区），暴击系统支持 real/expected

**还需要**:
1. **新前端页面** — 用户说后面再具体说
2. **per-hit 暴击控制** — 需要扩展 KernelConfig 或 PlacedSkill，让用户指定某些 hit 强制暴击/不暴击
3. **输出格式** — 操作流程 + 每 hit 伤害明细 + 总伤害

暂不实现，优先做模式 1 和 2。

## 架构原则

```
┌─────────────────────────────────┐
│         前端 (Vue)              │
│  ┌──────┐  ┌──────┐  ┌──────┐  │
│  │放技能│  │角色  │  │buff  │  │
│  │      │  │配置  │  │显示  │  │
│  └──┬───┘  └──┬───┘  └──────┘  │
│     │         │         ▲       │
│     ▼         ▼         │       │
│  ┌────────────────────────────┐ │
│  │     storeAdapter.ts        │ │
│  │  (Store → V2 inputs 转换)  │ │
│  └────────────┬───────────────┘ │
│               │                 │
│  ┌────────────▼───────────────┐ │
│  │      V2 Kernel             │ │
│  │  simulate() → SimEvent[]   │ │
│  │  (所有计算集中在这里)       │ │
│  └────────────┬───────────────┘ │
│               │                 │
│  ┌────────────▼───────────────┐ │
│  │     projections.ts         │ │
│  │  SimEvent[] → UI 数据       │ │
│  └────────────────────────────┘ │
└─────────────────────────────────┘
```

**前端能交互的**:
1. 放置/移动/删除技能（时间轴编辑）
2. 更改角色等级/天赋/装备/武器（角色配置面板）
3. 选择暴击模式（伤害计算页面，后续）
4. 点击验证（自由模式）

**前端不做的**:
- 任何 buff 计算
- 任何伤害计算
- 任何条件检查
- 任何状态模拟

## 下一步实施优先级

1. **调通 trigger 链路** — 别礼幻影追击（buff_apply + heavy_attack trigger + delayed_damage + consume）
2. **自由模式验证流程** — 放技能无显示 → 验证 → buff 显示/报错
3. **真实模式** — 放技能自动 simulate → 实时 buff 显示
4. **Buff 前端渲染** — 来源层 + 效果层 + 点击交互（见 reports 计划）
