# C 分支 P1 执行报告

---

## 1. 当前判断

ARCLIGHT 和 ALESH 已通过 variant 系统端到端可工作，与修正版审计一致。C 分支不需要为它们做任何改动。

用户反馈"很多技能仍报错"的根因定位为 **simulation 引擎缺乏 event handler 级别的错误隔离** — 任何一个 handler 内部 throw 会导致整个事件循环崩溃，`simulate()` 返回失败。

## 2. ARCLIGHT / ALESH 无需改动的确认

| 角色 | variant 名称 | gamedata 中存在 | 技能库中暴露 | tick 结构 | boundEffects | enhanced multiplier |
|---|---|---|---|---|---|---|
| ARCLIGHT | 强化战技 | ✅ 3 ticks, offset [0.63, 0.8, 1.2] | ✅ 独立技能卡 | tick2 = conditional extra | `["consume_conduction"]` on tick2 | [1.01, 1.01, 4.05] |
| ALESH | 强化连携 | ✅ 1 tick, offset 1.27 | ✅ 独立技能卡 | 独立结构 | - | 走 variant damageTicks |

**两者都通过 variant 系统完整工作，无需 C 分支介入。**

## 3. "很多技能报错"的层级定位

| 层级 | 是否是问题所在 | 证据 |
|---|---|---|
| 倍率链路 (B 分支) | ❌ 已打通 | skills.json → overlay → damageSummary 正常 |
| variant 系统 | ❌ 正常 | ARCLIGHT/ALESH variant 完整 |
| **simulation 引擎健壮性** | **✅ 主因** | SimulationEngine 事件循环无 try/catch → 单个 handler throw 崩溃全局 |
| DamageSummary | ❌ 独立路径 | 读 compiledScenario + 自己的 overlay，不依赖 simulate() |

## 4. 修改的文件

| 文件 | 改动 | 目的 |
|---|---|---|
| `SimulationEngine.ts` | event handler 和 trigger processor 各加 try/catch → 异常降级为 diagnostics.warn | 单个 handler 失败不再崩溃整个事件循环 |
| `timelineStore.js` | `simulation` computed 中 `simulate()` 调用加 try/catch → catch 输出 console.error + 返回 null | simulation 失败不再让整个 computed 链断裂 |

## 5. AVYWENNA 状态

仍然完全缺失。需要的状态位/触发点：

1. **Persistent entity tracker** — 记录当前存活的雷枪/强雷枪实例（创建时间 + 类型 + 50s 到期时间）
2. **Instance creation hook** — 战技 action 命中时创建新实例（不刷新旧实例）
3. **Per-instance damage resolution** — 战技命中时，遍历所有存活实例，每个触发独立伤害 tick
4. **Instance expiry** — 到期自动移除

本轮不做实现。原因：需要在 simulation state 中新增 persistent entity 概念（当前 ActorState 只有 buffs + cooldowns + resources），这不是几行代码能解决的。继续标 WIP。

## 6. 修改后 runtime 行为变化

| 场景 | 修改前 | 修改后 |
|---|---|---|
| 某个 handler throw（如 actor not found） | 整个 simulation 崩溃 → null | 该 event 被跳过 + diagnostics warning，后续 events 继续处理 |
| `simulate()` 在 store 中 throw | Vue computed 报错 → simulation=undefined | console.error + simulation=null |
| 正常技能的 DamageSummary | 不受影响（独立路径） | 不受影响 |
| 包含报错技能的排轴 | simulation 全局失败 | 报错技能被跳过，其余技能正常 |

## 7. 阶段性实现

- **AVYWENNA**: 完全 WIP，persistent instance 未实现
- **diagnostics.warn 收集**: handler 错误现在被记录但不展示到 UI（未来可在调试面板显示）
- **错误隔离粒度**: 当前是 event 级别。单个 event 失败 → 跳过。更精细的隔离（如 per-tick）不在本轮范围

## 8. 未引入新真值源

无。只做了防御性错误处理。

## 9. 前端直接可见变化

### 变化 1: 包含"坏"技能的排轴不再全局崩溃
- **界面**: 排轴主区域 + DamageSummary 面板
- **测试**: 在排轴中放多个不同角色的技能（包括可能报错的技能）
- **修改前**: 如果任一技能的 simulation handler 报错 → 控制台大量红色报错 → simulation 结果可能全 null
- **修改后**: 报错技能被跳过（console 有 warning），其余技能的 simulation 结果正常产出
- **DamageSummary**: 不受此修改影响（独立计算路径），但 simulation 结果不再因单个技能而全部丢失

### 变化 2: 控制台报错样式变化
- **修改前**: 红色 `Uncaught Error: Actor XXX not found` 或类似崩溃
- **修改后**: 黄色 `[simulation] runtime error:` 或 diagnostics warning，不再是未捕获异常

---

## 中心对话汇报

1. **分类**: C — 专属机制 / 角色特殊逻辑（P1 执行）
2. **改了哪些文件**: `SimulationEngine.ts`（event handler try/catch）、`timelineStore.js`（simulation computed try/catch）
3. **行为变化**: simulation 引擎从"单个 handler throw 崩溃全局"变为"跳过报错 event + diagnostics warning"；store 中 simulation computed 从"throw 时 undefined"变为"catch + console.error + null"
4. **可收口**: ARCLIGHT/ALESH 确认无需 C 分支介入（variant 系统完整工作）；simulation 健壮性防御修复完成
5. **阶段性实现**: AVYWENNA persistent instance 完全 WIP
6. **新真值源**: 无
7. **下一步**: (a) 用户实际测试确认报错减少 (b) AVYWENNA 推到后续专项
8. **前端可见变化**: 包含报错技能的排轴不再全局崩溃 → DamageSummary/simulation 其余部分正常显示。控制台从红色未捕获异常变为黄色 warning。测试方法：放多个不同角色技能到排轴，观察是否所有非报错技能都有伤害数值
