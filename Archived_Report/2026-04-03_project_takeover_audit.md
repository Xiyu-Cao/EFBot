# 重新接管项目：实现层理解报告

> 日期：2026-04-03
> 类型：全局审计 / 重新接管

---

## 1. 这个项目现在是什么

**终末地排轴器 / 战斗模拟器（endaxis-web）** —— 一个基于 Vue 3 的终末地游戏战斗时间轴编辑器，正在从纯排轴 UI 工具向**可做真实 runtime 伤害结算的模拟器 MVP** 推进。

**当前阶段定位**：核心 runtime / damage / anomaly 主链已经打通，不是"能不能跑"的问题，而是"数据真值覆盖面"和"角色机制完整度"的逐步填充期。项目采用 supported / wip / unsupported 三级标记诚实表达每个技能的可信度。

**技术栈**：Vue 3 + Pinia（UI/Store，JS）+ TypeScript（simulation 层）+ Vitest（测试）。monorepo 结构（apps/endaxis-web 为主体）。

**角色覆盖**：26 个角色有完整的 data/operators 文件夹（meta/stats/skills/talents/ability-expansion/potentials）。

---

## 2. 当前主链概览

### 2.1 时间轴动作 → 模拟执行

```
用户在 TimelineEditor 上排列技能动作
  → timelineStore.compiledTimeline（computed）
    → compileScenario() 编译场景（确定性）
      → normalizeScenario() 归一化 track / stats
      → compileTimeline() 拓扑排序动作、解析真实时间
    → simulate() 执行模拟
      → createEngine() 创建事件驱动引擎（11 种 handler）
      → registerEquipmentPassives() 注册武器/套装被动
      → 注册 runtime_passive talent effects（永久 buff）
      → registerTalentConditionals() 注册声明式触发 buff
      → 遍历 timeline.actions → 入队 ACTION_START/END + DAMAGE_TICK + anomaly 事件
      → engine.run()（PriorityQueue 主循环：出队 → 推进时间 → handler 处理 → TriggerProcessor 评估触发器）
    → 返回 SimulationResult { state, simLog, diagnostics, legalityIssues }
```

### 2.2 伤害结算

**DamageResolver** 使用 **11 区乘算公式**：

```
finalDamage = floor(ATK × skillMult × 防御 × 暴击 × 增伤 × 增幅 × 连击 × 易伤 × 脆弱 × 抗性 × 失衡 × 减伤 × 特殊)
```

各区实现：

| # | Zone | 实现状态 | 说明 |
|---|------|----------|------|
| 1 | Defense（防御区） | 完整 | enemy config defenseMultiplier，默认 0.5 |
| 2 | Crit（暴击区） | 完整 | resolveCrit → 1 或 (1 + totalCritDmg%) |
| 3 | DamageBonus（增伤区） | 完整 | school/element/source + dynamic equipment bonus |
| 4 | Amplify（增幅区） | 完整 | zone="amplify" aggregation |
| 5 | Combo（连击区） | 完整 | zone="combo" aggregation |
| 6 | Vulnerability（易伤区） | 完整 | conduction + physical_vulnerable + dynamic enemy bonus |
| 7 | Fragility（脆弱区） | 完整 | source-side + target-side，按 school/element 匹配 |
| 8 | Resistance（抗性区） | 完整 | baseResist - corrosion - talent resistance_ignore |
| 9 | Break（失衡区） | 完整 | broken = 1.3x |
| 10 | Reduction（减伤区） | 占位 | `return { value: 1 }` TODO |
| 11 | Special（特殊系数区） | 占位 | artsPowerDamageMult 已内含在异常公式中，此区目前 = 1 |

每次 DAMAGE_TICK 事件由 DamageHandler 调用 DamageResolver.resolve()，产出 breakdown。

### 2.3 Buff / Debuff / Conditional 进入路径

**三条并行路径**：

1. **runtime_passive**（talent effects，scope="runtime_passive"）→ simulator.ts 直接注册为永久 Effect（duration=999999），挂 DynamicBonus（fragility / resistance zone）
2. **runtime_conditional**（talent effects，scope="runtime_conditional"）→ `talentConditionalRegistry.ts` 声明式匹配 → `registerTriggeredBuff()` 注册为带 EffectTrigger 的永久 carrier Effect → 事件触发时创建临时 buff
3. **equipment passives** → `equipment/registry.ts` → `definitions.ts` 中各套装/武器的注册函数 → 同样通过 EffectTrigger 或直接 DynamicBonus

**当前已注册的 talent conditional**（3 个角色）：

| 角色 | 天赋 | 触发事件 | 效果 |
|------|------|----------|------|
| WULFGARD | Blazing Fangs | APPLY_DIRECT_ANOMALY (burn) | +blaze_dmg, 10s |
| CHENQIANYU | Slash Edge | DAMAGE_TICK (skill/link/ultimate) | +ATK% stack, max 5, 10s |
| POGRANICHNK | Living Flag | SP_CHANGE (accumulator >= 80) | +ATK% stack, max 3, 20s |

### 2.4 Anomaly 主链

**三路分发**（simulator.ts 中按 effectType 路由）：

- **元素附着** → `APPLY_MAGIC_ATTACHMENT` → MagicReactionResolver（4元素×4层，同元素=爆裂，异元素=反应→异常debuff）
- **物理异常** → `APPLY_PHYSICAL_ANOMALY` → PhysicalReactionResolver（launch/knockdown/armorBreak/slam，4层break）
- **直接异常** → `APPLY_DIRECT_ANOMALY` → DirectAnomalyApplier（burning/freeze/conduction/corrosion，直接施加debuff）
- **特殊效果** → physical_vulnerable / spell_vulnerable 直接注册 enemy Effect

状态机在 EnemyStatusState 中维护：burn ticks（1s/tick）、freeze duration、conduction vulnerability（artsPower scaling）、corrosion resist reduction（累积）。

### 2.5 伤害统计输出

`SimulationResult.simLog` → store 中 `damageStatsSnapshot`（computed）→ `DamageSummaryPanel.vue` 展示按角色、按动作的伤害分布和百分比。

---

## 3. 当前已经比较稳定的模块

**已从代码确认为稳定主路径**：

| 模块 | 关键文件 | 确认依据 |
|------|----------|----------|
| **事件驱动引擎** | `engine/SimulationEngine.ts`, `PriorityQueue`, `TriggerProcessor` | FIFO 确定性，cooldown tracking，TriggerProcessor.test.ts |
| **11 区伤害公式** | `calculation/multiplierZones.ts`, `DamageResolver.ts` | 每个 zone 独立函数，phase6-10.test.ts + DamageResolver.test.ts |
| **异常子系统** | `anomaly/` 全部文件 | 4 magic + 4 physical + 4 debuff 完整状态机，anomaly.test.ts |
| **GameState / ActorState / EnemyState** | `state/` | 确定性快照，Effect sweepExpired，stagger node break，ActorState.test.ts + EffectManager.test.ts |
| **Effect / DynamicBonus 系统** | `effects/types.ts`, `equipment/types.ts` | refresh / independent-stack 两种模式，zone-based aggregation |
| **编译器** | `compiler/compileScenario.ts`, `compileTimeline.ts` | 拓扑排序，时间上下文，compileScenario.test.ts + compileTimeline.test.ts |
| **Legality 验证** | `legality/` | sandbox/audit/strict 三级策略，legality.test.ts |
| **诊断 & simLog** | `diagnostics.ts`, `formatSimLogEntry.ts` | 结构化日志 |
| **timelineStore.js** | `stores/timelineStore.js` | 7059 行，computed 层级清晰，defensive normalization |
| **Timeline 模式** | `activeSkillLibrary` computed | 纯展示层过滤（free/normal/strict），不影响编译和执行 |
| **UI 组件** | `components/` 17 个 Vue 文件 | DamageSummaryPanel / LegalityIssuePanel / StatsDetailOverlay 均可用 |
| **talentConditionalRegistry 框架** | `data/talentConditionalRegistry.ts` | 声明式 descriptor + conditionFactory，13 个测试用例 |
| **skillMultipliers + skills.json 双源** | `data/skillMultipliers.ts` | 优先级链：compiled tick → skills.json per-level → 硬编码 fallback |
| **skillStatusRegistry** | `data/skillStatusRegistry.ts` | 从 SKILL_MULTIPLIERS 派生 supported/wip/unsupported，不是新真值源 |

---

## 4. 当前仍然是阶段性实现的模块

**已从代码确认仍属阶段性**：

| 模块 | 现状 | 具体说明 |
|------|------|----------|
| **SKILL_MULTIPLIERS 硬编码表** | 仅 ARCLIGHT（skill/ultimate）和 ALESH（link）有 verified | 其余走 skills.json 自动解析，全部 estimated |
| **talentConditionalRegistry 条目** | 仅 3 个角色 | 框架完整但覆盖面极小 |
| **talent effects 数据** | 大量 `parsed_unimplemented` | talents.json 中 effects 数组很多角色无结构化 effect |
| **potentials 数据** | effects 数组几乎全空 | 只有文字描述 |
| **武器注册** | 仅 2 把：paradigm（典范）, zuopin_shiji（作品蚀迹） | WEAPON_REGISTRY 2 条 |
| **套装注册** | 4 套：dianjian/donghuoyong/maichongshi/chaoyong | 框架可扩展，覆盖有限 |
| **originium_arts_power 动态消费** | 无 runtime dynamic bonus path | POGRANICHNK 天赋 +arts_power/层未进入 runtime |
| **Reduction Zone** | `return { value: 1 }` | TODO 占位 |
| **Special Zone** | `return { value: 1 }` | 占位 |
| **hitSteps 框架** | `mechanics/hitSteps.ts` | 已建框架，未广泛使用 |
| **AVYWENNA 雷枪** | WIP_OVERRIDES 标记 | 基础召回可用，潜能 +20s 未接入 |
| **normal/strict 模式** | 仅过滤 ActionLibrary 可见性 | 对已放置动作无校验 |
| **enhancedMultipliers** | 仅 ARCLIGHT:skill 和 ALESH:link | 其余角色强化变体倍率未填 |

---

## 5. 当前项目的任务列表与优先级理解

### 当前最该做的（高优先级）

1. **扩展 talentConditionalRegistry 覆盖面** —— 框架稳定，瓶颈是 descriptor 条目。每多接一个角色的 runtime_conditional，模拟准确度实质性提升。投入产出比最高。

2. **补充 talent effects 结构化数据** —— talentConditionalRegistry 的前提是 talents.json 有结构化 effects（type/stat/value/scope）。大量角色仍是 parsed_unimplemented。

3. **normal 模式规则第二轮细化** —— 当前仅 ActionLibrary filter。如要推向 MVP，需对已放置的 variant 动作做模式相关提示/警告。

### 可以做但不急的（中优先级）

4. **更多武器/套装 passive 注册** —— 每把武器需独立实现 triggered buff 逻辑。

5. **技能倍率 verified 验证** —— 大量角色目前 estimated，需人工核实后标记 verified。

6. **originium_arts_power 动态路径** —— 需在 mapEffectToBonus 和 DynamicBonus 系统中增加 artsPower zone。

7. **Reduction Zone / Special Zone 实装** —— 取决于是否有需要的敌人/机制。

### 暂时不该扩进去的（低优先级）

8. **全盘重写技能系统** —— variant 系统虽是阶段性但已端到端跑通。

9. **hitSteps 框架全面铺开** —— 当前时序对大部分角色够用。

10. **组件级测试** —— simulation 层测试覆盖良好（25+ test 文件），UI 层优先级低。

---

## 6. 建议下一轮最先做什么

### 方向 1：扩展 talentConditionalRegistry（推荐首选）

**为什么**：这是当前"中层语义缺口"最大的瓶颈。框架完全稳定（TalentConditionalDescriptor + registerTriggeredBuff + mapEffectToBonus），缺的只是每个角色的 descriptor 条目。每接入一个角色，模拟准确性就实质性提升。

**具体做法**：选 2-3 个数据层已有 runtime_conditional effects 的角色，为其编写 descriptor 并补测试。

### 方向 2：talent effects 数据结构化补充

**为什么**：talentConditionalRegistry 能工作的前提是 talents.json 的 effects 数组有结构化数据。如果要扩展方向 1，很可能需要先补这些数据。

### 方向 3：normal 模式规则第二轮

**为什么**：面向"可上线 MVP"的关键体验打磨。可以在 LegalityIssuePanel 中对模式不匹配的动作给出提示。

---

## 附：与线索对照的差异说明

| 线索 | 代码确认结果 |
|------|-------------|
| runtime_conditional 已有统一 adapter 框架 | **一致**。talentConditionalRegistry.ts 完整声明式框架，3 角色已接入 |
| POGRANICHNK 已推进到前端可人工验证 | **一致**。13 个测试用例，talent 数据有结构化 effects |
| 模式切换是展示层控制 | **一致**。activeSkillLibrary computed 纯前端 filter |
| LAEVATAIN resistance_ignore 必须先修 | **待验证**。本轮未深入检查 LAEVATAIN talents.json 和 runtime_passive 处理现状 |
| registerTriggeredBuff 缺 ICD | **已修复**。当前 registerTriggeredBuff 支持 cooldownId + cooldownDuration 参数 |

---

## 附：测试覆盖一览

simulation 层 25 个测试文件：

- `simulator.test.ts`, `simulator.behavior.test.ts`, `runSimulation.test.ts`
- `calculation/`: damageCalculation, DamageResolver, phase6-10 (5 files)
- `compiler/`: compileScenario, compileTimeline, timeContext
- `data/`: skillMultipliers, talentConditionalRegistry
- `effects/`: effect.snapshot
- `engine/`: TriggerProcessor
- `equipment/`: equipment
- `legality/`: legality
- `mechanics/`: reactions
- `anomaly/`: anomaly
- `state/`: ActorState, EffectManager
