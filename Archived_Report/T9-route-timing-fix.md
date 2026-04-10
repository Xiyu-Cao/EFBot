# T9 Route 2.7 / 2.8 时序问题收口

---

## 1. 处理的分类

D. Simulation / damage pipeline / runtime — `isEffectActive` 时序修正

## 2. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/simulation/equipment/types.ts` | `isEffectActive` 增加 `currentTime >= effect.startTime` 下界检查（1 行） |

仅 1 个文件，1 行核心改动。

## 3. 改变了什么行为

**之前**：`isEffectActive` 只检查过期上界（`currentTime < startTime + duration`），不检查生效下界。在 setup 阶段注册的 Effect（如 Route 2.7/2.8 的 physical_vulnerable / spell_vulnerable）即使 startTime 在未来，也从 time=0 就被视为 active。

**现在**：Effect 的活跃窗口严格为 `[startTime, startTime + duration)`。setup 阶段注册的 Effect 只有在 simulation 时间推进到 startTime 后才生效。

## 4. 已可收口

| 项目 | 状态 |
|---|---|
| Route 2.7 physical_vulnerable 时序 | **已修正** — 只在 resolvedEffect.realStartTime 后生效 |
| Route 2.8 spell_vulnerable 时序 | **已修正** — 同上 |
| 现有 weapon/equipment trigger buffs | **不受影响** — 全部使用 `startTime: getCurrentTime()`，恒满足 `currentTime >= startTime` |
| runtime_passive | **不受影响** — `startTime: 0`，恒满足 |
| Infinity duration effects | **不受影响** — Infinity 分支先返回，不走 startTime 检查 |

## 5. 仍是阶段性实现

Route 2.7 / 2.8 仍然是 setup 阶段直接注册（非事件式）。这不再是时序问题（因为 isEffectActive 现在正确检查了 startTime 下界），但如果后续需要支持更复杂的 debuff 动态交互（如被反应消耗），可能需要改为事件式注册。当前阶段不需要。

## 6. 新的真值源或临时覆盖层

没有。

## 7. 下一步建议

本分支任务完成。Route 2.7 / 2.8 时序问题已收口。可以回到主会话继续其他任务。

## 测试结果

120 个 simulation 测试全通过，0 新增失败。现有 `isEffectActive` 测试（startTime=5, duration=10, 测 time=10/14.99/15/20）行为完全不变。
