# C 分支 P1 审计（修正版）

---

## P0 审计修正

P0 审计的核心结论需要修正：

### ARCLIGHT — 已经可以工作 ✅

**修正**: P0 报告说"第 3 tick 从未被创建"——这是错的。

gamedata.json 中 ARCLIGHT 已有完整 variant 定义 "强化战技"：
- 3 个 damage ticks（包括 offset=1.2 的第 3 tick）
- `boundEffects: ["consume_conduction"]` 已绑定在第 3 tick 上
- variant 在 `activeSkillLibrary` 中作为独立技能卡暴露
- `computedEffectiveActions` 会把 variant action 标为 enhanced
- `enhancedMultipliers: [1.01, 1.01, 4.05]` 在 overlay 中正确应用

**用户操作方式**: 从技能库拖 "强化战技" 到排轴（而非默认"疾风迅雷"）。系统自动处理 3 tick + conduction 消耗。

**C 分支不需要改动。**

### ALESH — 已经可以工作 ✅

**修正**: P0 报告说"enhanced 触发条件不存在"——这也是错的。

gamedata.json 中 ALESH 有 variant "强化连携"：
- 独立的 1-tick 结构（不同于默认 2-tick）
- 在技能库中作为独立技能卡暴露
- `computedEffectiveActions` 正确处理

注意：ALESH 强化连携的 tick 结构（1 tick）与默认连携（2 tick）不同。这意味着 `enhancedMultipliers` 路径可能不适用（tick count 变了）。但 variant 系统直接用 variant 自己的 damageTicks，不需要 overlay。

**C 分支不需要改动。**

### AVYWENNA — 确实未实现 ❌

仍然完全缺失。这一点 P0 判断正确。

## 实际问题定位

用户反馈"除了普通攻击之外很多技能仍报错"的真正原因最可能是：

### 原因 1: simulation 引擎无 try/catch

`SimulationEngine.ts` line 133: 任何 event handler 内部 throw → 整个 simulation 崩溃。`simulation` computed 失败 → 返回 undefined/null。

但 `damageSummary` 读的是 `compiledScenario`（不走 simulate），所以 DamageSummary 面板应该还能正常显示。

### 原因 2: 报错来自 console，非 UI

用户说的"报错"可能是浏览器 console 里的红色报错，而非 UI 上的"未支持"标签。这属于 runtime 健壮性问题，不属于 C 分支专属机制范围。

## C 分支 P1 实际可做的最小改动

鉴于 ARCLIGHT 和 ALESH 已经通过 variant 系统工作，C 分支 P1 的实际目标变为：

1. **确认当前 variant 系统对 ARCLIGHT/ALESH 的端到端行为**（纯验证，不改代码）
2. **AVYWENNA WIP 边界梳理**（不做实现，只明确状态）
3. **如果用户报错是 console 崩溃**: 可以考虑给 simulation 加 try/catch 作为防御性修复，但这更像 runtime 健壮性而非"专属机制"

## 当前结论

| 角色 | P0 结论 | 修正后结论 | C 分支需要做什么 |
|---|---|---|---|
| ARCLIGHT | 需要生成 3rd tick | 已通过 variant 工作 | 无需改动 |
| ALESH | 需要 enhanced 桥接 | 已通过 variant 工作 | 无需改动 |
| AVYWENNA | 完全未实现 | 仍然未实现 | P2 做 persistent instance |

**C 分支最高优先级变为**: AVYWENNA persistent buff instance 实现（如果当前轮要做的话），以及 simulation 引擎健壮性（try/catch）。

---

## 中心对话汇报

1. **分类**: C — 专属机制 / 角色特殊逻辑（P1 审计修正）
2. **改了哪些文件**: 无（纯审计修正）
3. **行为变化**: 无
4. **已可收口**: ARCLIGHT 和 ALESH 通过 variant 系统已经可以工作，C 分支不需要为它们做额外改动
5. **阶段性实现**: AVYWENNA persistent instance 仍完全缺失
6. **新真值源**: 无
7. **下一步**:
   - 如果用户反馈的"报错"是 console 报错 → 给 simulation 引擎加 try/catch（防御性修复）
   - 如果需要继续 AVYWENNA → 进 P2 做 persistent buff instance 设计
   - ARCLIGHT/ALESH 已确认无需 C 分支介入
