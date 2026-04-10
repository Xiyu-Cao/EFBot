# 第二阶段重构报告：EffectTrigger 执行系统

> 生成日期：2026-03-24
> 目标：让 EffectTrigger 从静态类型定义变成真正可执行的系统能力
> 说明：本轮未修改 UI，未修改 timelineStore.js

---

## 修改文件清单

### 修改的文件

| 文件 | 变更 |
|---|---|
| `engine/SimulationEngine.ts` | 新增 `TriggerProcessor` 调用（每个事件处理后执行）；新增 `registerPassiveEffect()` 方法；共享 `DiagnosticCollector` |
| `engine/SimulationContext.ts` | `SimulationContext` 接口新增 `diagnostics: DiagnosticCollector` 字段 |
| `engine/PriorityQueue.ts` | 重写：新增 `_seq` 插入序号，同时间事件按 FIFO 顺序出队（确定性保障） |
| `engine/createEngine.ts` | 接受可选 `diagnostics` 参数，传递给引擎 |
| `state/types.ts` | `ActorSnapshot.activeBuffs` 类型从 `Map<string, ResolvedEffect>` 改为 `Map<string, EffectSnapshot>` |
| `state/ActorState.ts` | 新增 `buildActiveBuffs()` 方法，从 `EffectManager.getAll()` 派生 activeBuffs |
| `simulator.ts` | 单一 `DiagnosticCollector` 与引擎共享（simulator 层 + trigger 层写入同一个 collector） |

### 新增的文件

| 文件 | 用途 |
|---|---|
| `engine/TriggerProcessor.ts` | **核心交付**：遍历所有活跃 effect 的 triggers，匹配当前事件后执行；支持 cooldown / sourceMustBeWearer / condition / action；错误进入 diagnostics |
| `engine/TriggerProcessor.test.ts` | 9 个测试用例：匹配/不匹配/sourceMustBeWearer/cooldown/condition/事件产生/错误诊断/activeBuffs 反映/确定性 |

---

## Trigger 执行链路

```
SimulationEngine.run()
  ↓ for each event:
  handler.handle(event, ctx)              ← 主事件处理
  ↓
  triggerProcessor.process(event, ctx)    ← 新增：trigger 评估
    ↓
    collectActiveTriggers(state, eventType)
      → 遍历 actors.effects + enemy.effects
      → 筛选 trigger.event === eventType
    ↓
    evaluateTrigger(entry, event, ctx)
      1. cooldown 检查（按 ownerId::cooldownId 作用域）
      2. sourceMustBeWearer 检查
      3. condition 谓词评估
      4. 执行 action（可入队新事件）
      5. 设置 cooldown
```

### 数据流说明

- **trigger 从哪里读上下文**：trigger 的 `action(event, ctx)` 回调接收完整的 `SimulationContext`，可以读取 `ctx.state`（GameState / ActorState / EnemyState）
- **trigger 如何判断匹配**：`trigger.event` 字段匹配当前事件类型 → cooldown → sourceMustBeWearer → condition
- **trigger 产出什么**：
  - 新事件：通过 `ctx.queue.enqueue()`
  - 新 effect：通过 `ctx.queue.enqueue({ type: "EFFECT_START", ... })`
  - 数值修饰：通过修改 state 或入队事件间接实现
  - diagnostics：错误自动进入共享 DiagnosticCollector
- **统一入口**：所有 trigger 逻辑集中在 `TriggerProcessor.process()`，不散落在各个 handler 里

---

## 各目标达成状态

### A. EffectTrigger 最小可运行执行机制

**已完成。**

- `TriggerProcessor` 在每个事件处理后自动执行
- 支持 5 种控制：event type 匹配、sourceMustBeWearer、cooldownId + cooldownDuration、condition 谓词、action 执行
- 测试覆盖：匹配/不匹配/owner 过滤/cooldown/条件/事件产生/错误处理/确定性

### B. Trigger 执行的清晰数据流

**已完成。**

- 统一入口：`TriggerProcessor.process(event, ctx)`
- 产出方式：通过 `ctx.queue.enqueue()` 产生新事件（事件 / effect / SP 变化均可）
- 错误处理：condition 或 action 抛异常时捕获并写入 diagnostics，不中断模拟
- 不侵入 handler 层：handler 代码零修改

### C. activeBuffs 有真实来源

**已完成。**

- `ActorState.buildActiveBuffs()` 从 `EffectManager.getAll()` 派生
- `ActorSnapshot.activeBuffs` 类型改为 `Map<string, EffectSnapshot>`（从 `ResolvedEffect` 迁移）
- effect 开始后可观测，effect 结束后自动清理（因为 EffectManager.remove() 在 EffectEndHandler 中调用）
- 测试验证：`registerPassiveEffect` → `snapshot().activeBuffs.size === 1`

### D. 为自动触发型效果铺路

**已完成。**

- `engine.registerPassiveEffect(actorId, effect)` 允许在 event loop 启动前注册被动效果
- 被动效果的 triggers 会在后续事件中自动评估
- 未来 `bootstrapPassives(actors, equipmentDB)` 只需调用 `registerPassiveEffect` 即可

### E. 确定性保证

**已完成。**

- `PriorityQueue` 新增 `_seq` 插入序号，同 time 事件按 FIFO 出队
- TriggerProcessor 遍历顺序：actors 按 Map 插入序 → enemy → effect instances 按 EffectManager 内部顺序
- 测试验证：同一输入 3 次运行结果完全一致

### F. 测试覆盖

**已完成。** 9 个测试用例：

1. 匹配事件时触发 trigger ✓
2. 不匹配事件类型时不触发 ✓
3. sourceMustBeWearer 过滤 ✓
4. cooldown 机制（t=1 触发, t=3 跳过, t=8 再触发）✓
5. condition 谓词过滤 ✓
6. trigger 产生新事件（入队 SP_CHANGE）✓
7. trigger action 抛异常时写入 diagnostics ✓
8. activeBuffs 反映注册的 effect ✓
9. 多次运行确定性一致 ✓

---

## 仍然保留的 TODO

| 位置 | TODO |
|---|---|
| `TriggerProcessor` | 如果 trigger 移除了另一个已收集的 effect instance，该 instance 仍可能在本轮执行。当跨 trigger 移除变多时需 revisit |
| `TriggerProcessor` | 未来：支持 trigger 间优先级排序（当前按遍历顺序执行） |
| `registerPassiveEffect` | 未来：构建 `PassiveRegistry` + `bootstrapPassives(actors, equipmentDB)`，从 weaponId / talentId 自动加载 |
| `EffectStartHandler:46` | 预存问题：反应产生的 effect 传入 `Effect` 而非 `EffectSnapshot` |
| `EffectEndHandler` | 可优化：通过 `targetId` 路由而非搜索全部实体 |

---

## 下一阶段推荐的 3 件事

### 1. 真实被动数据加载

构建 `PassiveRegistry`，将武器/天赋/装备 ID 映射到带 triggers 的 `Effect` 实例。新增 `bootstrapPassives()` 函数，读取 `ScenarioTrack.weaponId` 等字段后调用 `engine.registerPassiveEffect()`。这是将 trigger 系统连接到实际游戏数据的关键一步。

### 2. 最小合法性校验

利用已就绪的 `ActorState.isOnCooldown()` + `ActorState.getActiveAction()` 构建 `validateTimeline()` 函数，在模拟运行前生成 `rejectedActions[]`。基础设施已全部到位。

### 3. 真实伤害公式

替换 `DamageResolver` 中的 `attack * multiplier` 占位公式为实际游戏公式（项目记忆中的 11 乘区体系），将 `anomalyCalc.js` 中的函数接入 pipeline 作为 modifier。
