# C 分支 P2 设计报告

---

## 1. 当前判断

- P1 simulation 健壮性修复已就位且足够。副作用边界可接受。
- ARCLIGHT/ALESH 无需继续介入。
- AVYWENNA 是 C 分支唯一需要新实现的角色。

## 2. Simulation 健壮性修复验证

**修复内容**: SimulationEngine event loop + store simulation computed 各加 try/catch。

**副作用边界**:
| 错误类型 | 降级行为 | 是否可接受 |
|---|---|---|
| getActor throw (actor not found) | 该 event 跳过，0 damage for that tick | ✅ 只丢单个 tick |
| Trigger processor throw | 该 event 的 trigger 跳过 | ✅ 丢 buff/debuff 触发 |
| ACTION_START handler error | SP 扣除可能丢失 | ⚠ 资源流偏差 |
| 整个 simulate() throw | console.error + null | ✅ DamageSummary 独立路径不受影响 |

**误导风险**: 当 handler 错误被跳过时，该 tick 的伤害丢失。如果用户没看到 console warning，可能认为计算正确但实际少了几个 tick 的伤害。但这些技能本身已标 "处理中"，用户已有精度预期。

**结论**: 当前修复足够，不需要进一步补强。

## 3. AVYWENNA 设计

### 机制拆解

| 技能 | 效果 |
|---|---|
| Link (雷枪·掣击) | 直接伤害 380% M3 + 生成 3 支雷枪（各持续 30s） |
| Ultimate (雷枪·决颤) | 直接伤害 950% M3 + 生成 1 支强雷枪（持续 30s） |
| Skill 默认 (雷枪·截回) | 直接伤害 150% M3 |
| Skill 召回变体 | 直接伤害 150% M3 + 每个被召回雷枪 168% M3 + 每个被召回强雷枪 432% M3 |

### 方案 A: 最小 MVP（compile-time 预算）

**思路**: 在 damageSummary 计算中（已有的 compile-time 预计算路径），为 AVYWENNA skill actions 做一个 pre-pass：向前扫描同 track 的 link/ult actions，计算技能触发时有多少存活雷枪/强雷枪，然后追加对应的额外伤害。

**优点**:
- 不改 simulation engine
- 不改 ActorState
- 不引入 persistent entity 系统
- 只在 damageSummary computed 内部做

**缺点**:
- 只影响 DamageSummary，不影响 simulation（simulation 仍然只算基础 tick）
- 如果将来 simulation 结果被其他系统消费，会不一致
- 是 damageSummary 层的特判，不是 runtime 层的真值

**涉及文件**: `timelineStore.js` 的 `damageSummary` computed（1 个文件）

**复杂度**: 低。约 30-50 行 AVYWENNA-specific 逻辑。

### 方案 B: 完整 runtime（simulation engine 层）

**思路**: 在 simulation state 中新增 persistent entity tracker。Link/ult ACTION_END 事件时创建实例。Skill DAMAGE_TICK 事件时遍历存活实例，为每个实例动态 enqueue 额外 DAMAGE_TICK events。

**优点**:
- 正确的 runtime 层实现
- simulation 输出和 DamageSummary 一致
- 可扩展到其他有类似机制的角色

**缺点**:
- 需要改 ActorState（新增 persistent entity 数组）
- 需要改 ActionEndHandler 或新增 handler（创建实例逻辑）
- 需要改 DamageHandler 或新增 handler（按实例触发额外 ticks）
- 需要时间推进时做 expiry 清理
- 涉及 4-5 个文件

**复杂度**: 中。需要设计 entity 生命周期。

### 方案 C: 不做，继续 WIP

**理由**: AVYWENNA 的机制是当前角色池中最复杂的之一。MVP 策略允许标"处理中"。实现它不会改变其他 20+ 角色的计算结果。

## 4. 建议

**当前走方案 C（继续 WIP）**。原因：

1. AVYWENNA 不阻塞 MVP 上线 — 标"处理中"即可
2. 方案 A 在 damageSummary 层特判，虽然快但制造了 damageSummary vs simulation 的新不一致
3. 方案 B 需要的工作量合理但不是当前最高优先级
4. 当前应把精力放在确保已有 20+ 角色的基础计算正确、用户可用

如果用户明确要求 AVYWENNA，再走方案 B。

## 5. 前端直接可见变化

**本轮没有明显前端直接可见变化**。

P1 的 simulation 健壮性修复已经是前端可见变化（报错不再导致全局崩溃）。本轮 P2 是设计/评估轮，未做代码改动。

如果走方案 A：用户会在 AVYWENNA skill 的 DamageSummary 中看到额外的雷枪/强雷枪伤害行。
如果走方案 B：simulation 输出也会包含这些额外伤害。
如果走方案 C：AVYWENNA skill 继续只显示基础 150% 的伤害，标"处理中"。

---

## 中心对话汇报

1. **分类**: C — 专属机制 / 角色特殊逻辑（P2 设计）
2. **改了哪些文件**: 无（纯设计/评估）
3. **行为变化**: 无
4. **可收口**: ARCLIGHT/ALESH 通过 variant 系统已完整工作；simulation 健壮性修复已足够
5. **阶段性实现**: AVYWENNA persistent instance 仍 WIP。三种方案已评估（compile-time 预算 / 完整 runtime / 继续 WIP）
6. **新真值源**: 无
7. **下一步**: 建议 AVYWENNA 继续 WIP。C 分支可暂时收口。如果用户明确要求 AVYWENNA，走方案 B（完整 runtime）
8. **前端可见变化**: 本轮无。P1 的健壮性修复已是最近一次前端可见变化
