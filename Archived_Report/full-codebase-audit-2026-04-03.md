# Endaxis-Web 程序实现层全局现状审计报告

> 审计时间: 2026-04-03
> 审计方法: 全仓库代码读取，以 `apps/endaxis-web/src/` 下代码为唯一真值源
> 约定: 所有文件路径相对于 `E:\EFBot\apps\endaxis-web\src\`，除非另有标注

---

## 1. 执行摘要

**项目阶段：中期——核心管线已稳定，角色效果覆盖面仍窄。**

从代码确认的现状：

- **伤害公式管线（11个乘区）**：完整且稳定，经过测试验证
- **事件驱动模拟引擎**：架构成熟，12种事件类型、优先队列、TriggerProcessor 三层可靠运行
- **异常/debuff 子系统**：4元素附着 + 4物理异常 + 直接异常应用全部走通
- **25个干员数据**：meta/stats/skills/talents/potentials/ability-expansion 全部定义完毕
- **技能倍率**：绝大多数干员 skills.json 驱动 + ~5个复杂技能硬编码覆盖，per-level 支持完整
- **设备/武器被动**：4套装 + 2武器，EffectTrigger 模式稳定可扩展
- **天赋 runtime 接入**：runtime_passive 仅覆盖 `type === "damage_bonus"` (3干员); runtime_conditional 仅硬编码 WULFGARD + CHENQIANYU
- **最大缺口**：天赋/潜能效果的 runtime 语义覆盖面极窄——130处 `parsed_unimplemented`、大量 `runtime_conditional` 数据已定义但 simulator 无对应代码。这不是"差个别角色"的问题，而是**中层通用触发/效果分发语义**尚未建立。

**最该优先做的**：在 simulator.ts 中建立通用 `runtime_conditional` 分发层（读 talent 数据 → 按 type/stat/scope 自动注册到 registerTriggeredBuff），替代当前的 `if (actorId === "XXX")` 特判模式。

---

## 2. 当前主链结构图

```
用户在 TimelineEditor 排轴
    ↓
timelineStore.compiledScenario (computed)
    ↓
compileScenario() → compileTimeline() → ResolvedTimeline
    ↓
timelineStore.simulation (computed, 调用 simulate())
    ↓
simulate() [simulator.ts]
  ├── createEngine() → SimulationEngine + 所有 EventHandler 注册
  ├── registerEquipmentPassives() → 武器/套装注册为 Effect+Trigger
  ├── runtime_passive 注册 → 永久 Effect(dynamicBonuses)
  ├── runtime_conditional 注册 → Effect 携带 EffectTrigger
  ├── 遍历 timeline.actions:
  │     每个 action → enqueue ACTION_START / ACTION_END
  │     每个 damageTick → applySkillMultiplierOverlay → enqueue DAMAGE_TICK
  │     特殊: AVYWENNA 雷枪追踪(编译期预跑)
  │     特殊: action.effects → 按 type 分流:
  │         ELEMENT_ATTACH_MAP → enqueue APPLY_MAGIC_ATTACHMENT
  │         PHYSICAL_ANOMALY_MAP → enqueue APPLY_PHYSICAL_ANOMALY
  │         DIRECT_ANOMALY_MAP → enqueue APPLY_DIRECT_ANOMALY
  │         其他 → 旧路径 EFFECT_START (legacy, 不再主用)
  └── engine.run() → 事件循环
        每个事件:
          1. 主 Handler 执行
          2. TriggerProcessor.process() 评估所有活跃 Trigger
        ↓
  返回 SimulationResult { state, simLog, diagnostics, legalityIssues }
    ↓
timelineStore.runDamageStats() [手动触发]
  → 聚合 simLog 中 DAMAGE_TICK + ANOMALY_DAMAGE
  → damageStatsSnapshot
    ↓
DamageSummaryPanel.vue 读取显示
```

### 主链关键文件

| 链路段 | 文件 | 职责 |
|--------|------|------|
| 编译 | `compiler/compileScenario.ts`, `compileTimeline.ts` | 时间轴→可执行场景 |
| 入口 | `simulator.ts` | 注册装备/天赋、入队事件、跑引擎 |
| 引擎 | `engine/SimulationEngine.ts` | 优先队列事件循环 |
| 触发 | `engine/TriggerProcessor.ts` | 每事件后评估所有 Trigger |
| 伤害 | `events/DamageHandler.ts` → `calculation/DamageResolver.ts` → `multiplierZones.ts` | 伤害计算 |
| 异常 | `anomaly/AnomalyHandlers.ts`, `MagicReactionResolver.ts`, `PhysicalReactionResolver.ts`, `DirectAnomalyApplier.ts` | 附着/反应/直接异常 |
| 状态 | `state/GameState.ts`, `ActorState.ts`, `EnemyState.ts`, `EffectManager.ts` | 运行时状态 |
| 输出 | `events/event.types.ts` (SimLogEntry) | 日志格式 |

### 旁路 / 旧路径

- **Legacy EFFECT_START 路径**：`SCNEARIO_EFFECT_TYPE_MAP → AfflictionEffectMap → EFFECT_START → ReactionRegistry`，simulator.ts L19-22 注释明确说明"retained as legacy but no longer used by the main simulation loop"
- **damageSummary (computed)**：timelineStore.js L6105，基于 compiledScenario 实时算的预估伤害，**不经过引擎**，是独立的平行计算路径
- **utils/anomalyCalc.js**：旧版异常计算工具，与新 `anomalyDamageCalc.ts` 并存

---

## 3. 分模块成熟度审计

### 3.1 Simulation / Runtime Engine

| 项 | 状态 |
|---|---|
| 当前状态 | **已形成稳定主路径** |
| 关键文件 | `engine/SimulationEngine.ts` (156行), `engine/createEngine.ts`, `engine/TriggerProcessor.ts` (177行) |
| 事件类型 | 12种: ACTION_START/END, DAMAGE_TICK, SP/STAGGER/GAUGE_CHANGE, EFFECT_START/END, APPLY_MAGIC_ATTACHMENT, APPLY_PHYSICAL_ANOMALY, APPLY_DIRECT_ANOMALY, ANOMALY_DAMAGE |
| 主要风险 | 无架构级风险。TriggerProcessor 有一个 TODO：trigger 删除另一 effect 时可能在同 pass 内仍执行 |
| 确认方式 | 已从代码确认 |

### 3.2 Damage Calculation Pipeline

| 项 | 状态 |
|---|---|
| 当前状态 | **已形成稳定主路径**，11区中10区有实效 |
| 关键文件 | `calculation/DamageResolver.ts` (108行), `calculation/multiplierZones.ts` (369行), `calculation/attackFormula.ts` (93行), `calculation/critSystem.ts`, `calculation/anomalyDamageCalc.ts` (271行) |
| 公式 | ATK × skillMult × defense × crit × damageBonus × amplify × combo × vulnerability × fragility × resistance × break × reduction × special |
| 缺口 | `computeReductionZone` 返回固定 1（L322-324 TODO）；`computeSpecialZone` 返回固定 1（L342-347）；resistance 区只读 corrosion，TODO 其他抗性下降来源（L294） |
| 确认方式 | 已从代码确认 |

### 3.3 Data Truth Sources (干员数据)

| 项 | 状态 |
|---|---|
| 当前状态 | **完整且稳定** |
| 关键文件 | `data/operators/*/` (25干员 × 6 JSON), `data/operators/loader.js`, `public/gamedata.json` |
| 主路径 | `loadOperator()` → { meta, stats, skills, talents, abilityExpansion, potentials } |
| 风险 | gamedata.json (运行时数据库) 与 data/operators/ (静态定义) 并行存在，前者用于 UI/editor，后者用于 simulation |
| 确认方式 | 已从代码确认 |

### 3.4 Skills / Multipliers

| 项 | 状态 |
|---|---|
| 当前状态 | **已形成稳定主路径** |
| 关键文件 | `simulation/data/skillMultipliers.ts`, `simulation/data/skillStatusRegistry.ts` |
| 主路径 | 三级优先：compiled tick 非零 → skills.json per-level lookup → SKILL_MULTIPLIERS 硬编码 fallback |
| 临时路径 | ~5 角色有硬编码 overlay (ARCLIGHT/ALESH/AVYWENNA/CHENQIANYU/POGRANICHNK/GILBERTA) |
| 风险 | 低。hybrid 方案合理，硬编码仅用于已验证复杂技能 |

### 3.5 Talents / Potentials

| 子模块 | 状态 | 说明 |
|---|---|---|
| 天赋定义 (talents.json) | **数据完整** | 25/25 有文件，但 **130处 parsed_unimplemented** |
| 天赋 Row1 加成 (主属性+10/15/20) | **已形成主路径** | timelineStore.getTalentRow1Bonus() |
| 天赋等级系统 | **稳定** | 独立于技能等级，受突破约束 |
| static stat_bonus 聚合 | **稳定** | resolveTrackConfiguredStats() Phase 3 |
| runtime_passive (damage_bonus) | **基本可用** | ENDMINISTRATOR/XAIHI 走通 |
| runtime_passive (resistance_ignore) | **未接入** | LAEVATAIN 有数据但 simulator 不处理此 type |
| runtime_conditional (damage_bonus) | **2/25 已接入** | WULFGARD + CHENQIANYU 硬编码 |
| runtime_conditional (其他10+干员) | **仅数据在** | ENDMINISTRATOR/CATCHER/POGRANICHNK/EMBER/LIFENG/ROSSI/ALESH/DAPAN/FLUORITE 等有数据标记但 simulator 无代码 |
| 潜能定义 (potentials.json) | 25/25 完整 | ~60% effects 为空数组 |
| 潜能静态接入 | **已接入** configuredStats | stat_bonus/gauge_modifier 在编译期聚合 |
| 潜能条件型/天赋增强型 | **未接入** | 无基础设施 |

**这是当前项目最大的"看起来有但实际没接入"区域。**

### 3.6 Weapon / Equipment

| 项 | 状态 |
|---|---|
| 当前状态 | **已形成主路径，覆盖面有限** |
| 关键文件 | `equipment/registry.ts`, `equipment/definitions.ts`, `equipment/weaponDataAdapter.ts`, `equipment/types.ts` |
| 已实现 | 4套装 (点剑/动火用/脉冲式/潮涌) + 2武器 (典范/作品蚀迹) |
| 模式 | `registerEquipmentPassives()` → 分套装/武器注册 Effect + EffectTrigger，稳定可扩展 |
| 风险 | 静态属性加成通过 timelineStore delta 外部预合并，simulation 内不可见 |

### 3.7 Passive / Conditional (运行时被动/条件)

| 项 | 状态 |
|---|---|
| 当前状态 | **基础设施就绪，覆盖率极低** |
| 关键文件 | `simulator.ts:96-250`, `engine/TriggerProcessor.ts`, `equipment/types.ts` (addOrRefreshBuff / addStackWithIndependentDuration) |
| runtime_passive | 仅 `type==="damage_bonus"` → 永久 Effect(dynamicBonuses zone="fragility")。LAEVATAIN 的 resistance_ignore 静默忽略 |
| runtime_conditional | registerTriggeredBuff() 辅助函数设计良好(L134-197)，但每个角色仍需硬编码 `if (actorId === "XXX")`。已实现 2/~12 个有 runtime_conditional 数据的干员 |
| 主要风险 | **高**。扩展靠在 simulator.ts 里加 if-else 分支，不可持续 |

### 3.8 Anomaly / Debuff

| 项 | 状态 |
|---|---|
| 当前状态 | **已形成稳定主路径** (整个 repo 最完善的模块之一) |
| 关键文件 | `anomaly/EnemyStatusState.ts`, `anomaly/AnomalyHandlers.ts`, `anomaly/MagicReactionResolver.ts`, `anomaly/PhysicalReactionResolver.ts`, `anomaly/DirectAnomalyApplier.ts` |
| 已实现 | 4元素附着(最多4层/30s) ✅; 同元素爆发 ✅; 异元素反应 ✅; 直接异常(T5) ✅; 4类物理异常 ✅; 碎冰 ✅; 灼烧 DoT(10tick) ✅; 导电易伤 ✅; 腐蚀减抗 ✅; 碎甲→物理脆弱 ✅ |
| 缺口 | CORROSION_PARAMS 标注 TODO placeholder；消耗语义靠 boundEffects 硬编码 |

### 3.9 UI Verification Surface

| 观察窗口 | 可信度 | 说明 |
|---|---|---|
| DamageSummaryPanel (damageStatsSnapshot) | **中** | 需手动点击触发；TEMP_FORCE_NO_CRIT 强制关暴击导致显示 DPS 偏低 |
| 技能 supported/wip/unsupported 标注 | **高** | 读自 skillStatusRegistry，逻辑简单 |
| Boss debuff 栏 | **中** | 读自编辑器配置，非 simulation runtime 数据 |
| 属性面板 configuredStats | **中高** | 经完整聚合链，可与游戏内比对 |
| simLog 查看 | **无前端 UI** | formatSimLogEntry.ts 仅 console 格式化 |
| 调试计算器 | debug-tools/ 存在但标注 TEMP | 未集成到主流程 |

### 3.10 Support Status

| 项 | 状态 |
|---|---|
| 当前状态 | **已形成主路径** |
| 关键文件 | `simulation/data/skillStatusRegistry.ts` |
| 逻辑 | WIP_OVERRIDES → SKILL_MULTIPLIERS 硬编码查找 → skills.json fallback → unsupported |
| 当前 WIP | 仅 AVYWENNA:skill (雷枪召回基础可用，潜能+20s未接入) |

---

## 4. 临时实现 / 特判 / 覆盖层清单

### 4.1 boundEffects 角色特判 (DamageHandler.ts)

| 标签 | 角色 | 位置 | 为什么是临时方案 | 风险 |
|------|------|------|-----------------|------|
| `consume_conduction` | ARCLIGHT | DamageHandler.ts L29-42 | 硬编码字符串匹配，无通用消耗框架 | 低(可用但不可泛化) |
| `consume_corrosion_apply_vuln` | ARDELIA | DamageHandler.ts L45-97 | 硬编码读 ARDELIA skills.json 行标签 | 中(其他角色消耗腐蚀需再写一套) |
| `estella_phys_vuln_if_frozen` | ESTELLA | DamageHandler.ts L106-128 | 硬编码读 ESTELLA skills.json | 中(pre-damage 只有这一个样例) |

**后续建议**：迁移为通用 `BoundEffectRegistry`（Map<string, handler>），将标签映射到标准化处理函数。

### 4.2 runtime_conditional 角色硬编码 (simulator.ts:199-250)

| 角色 | 位置 | 实现方式 |
|------|------|---------|
| WULFGARD | simulator.ts L214-226 | `if (actorId === "WULFGARD")` + registerTriggeredBuff |
| CHENQIANYU | simulator.ts L229-246 | `if (actorId === "CHENQIANYU")` + registerTriggeredBuff |

- **为什么是临时方案**：每个角色需手写 if-else，不可规模化
- **风险**：中高。已有 ~10 个干员有 runtime_conditional 数据标记，如果逐个硬编码 simulator.ts 会膨胀
- **建议**：建立通用分发层，从 talent effect 数据自动映射到 registerTriggeredBuff 调用

### 4.3 AVYWENNA 雷枪追踪 (simulator.ts:252-371)

- **作用**：编译期预扫描 link/ult/skill 动作，维护内存中 lance 列表，skill 时入队 recall DAMAGE_TICK
- **为什么是临时方案**：仅为 AVYWENNA 写的~120行持久实体追踪，不走事件系统
- **风险**：低-中。逻辑正确，但无法复用
- **建议**：保留，等出现第二个持久实体角色时再抽象

### 4.4 TEMP_FORCE_NO_CRIT (timelineStore.js:4465)

```javascript
const TEMP_FORCE_NO_CRIT_FOR_DAMAGE_STATS = true
```

- **风险**：中。UI 显示伤害不含暴击加成，与真实期望 DPS 偏低。标记为 TODO
- **建议**：实现暴击期望值模式后移除

### 4.5 旧 EFFECT_START 链路 (simulator.ts:19-22 注释)

- `SCNEARIO_EFFECT_TYPE_MAP → AfflictionEffectMap → EFFECT_START → ReactionRegistry`
- 注释明确标注"retained as legacy but no longer used by the main simulation loop"
- **风险**：极低（不进入主链）
- **建议**：下一轮清理时移除

### 4.6 runtime_passive 仅处理 damage_bonus (simulator.ts:105-106)

```typescript
const passiveEffects = activeEffects.filter(
  (e: any) => e.scope === "runtime_passive" && e.type === "damage_bonus" && e.stat && e.value
);
```

- **问题**：LAEVATAIN 天赋定义了 `type: "resistance_ignore", scope: "runtime_passive"`，但 simulator 不处理此 type → **静默忽略**
- **风险**：**高**。LAEVATAIN 看似有天赋接入，实际抗性穿透在 simulation 中完全不生效
- **建议**：扩展 runtime_passive 处理逻辑，支持 resistance_ignore 等类型

---

## 5. 双真值源 / 平行系统风险清单

### 风险 1 [高]: damageSummary vs damageStatsSnapshot

- **damageSummary** (timelineStore.js L6105)：computed，从 compiledScenario 实时算，不经引擎，**不含 runtime buff/武器被动/异常消耗**
- **damageStatsSnapshot** (timelineStore.js L6252)：ref，从 simLog 手动聚合，**含全部 runtime 效果**
- **问题**：两者数值必然不同；UI 仅展示 damageStatsSnapshot 但需手动触发
- **建议**：统一到 simLog 聚合路径，移除或降级 damageSummary 为"快速预览"

### 风险 2 [中高]: 武器/装备静态属性 — timelineStore delta vs simulation 内

- 武器/装备的基础属性加成通过 timelineStore delta 预合并到 configuredStats
- simulation 内 definitions.ts 有 10+ 处注释警告"NOT applied here, handled by timelineStore delta"
- **问题**：两层各自负责一部分属性加成，中间没有显式契约
- **建议**：文档化哪些走 delta(静态)、哪些走 runtime aggregation(动态)

### 风险 3 [中]: anomalyDamageSummary vs simLog 内异常伤害

- `anomalyDamageSummary`：timelineStore 内独立计算的异常伤害汇总
- simLog 中的 ANOMALY_DAMAGE：simulation 运行时的真实异常伤害
- **问题**：两条路径使用不同计算逻辑
- **建议**：确认两者用途分工或统一

### 风险 4 [低-中]: skillMultipliers 硬编码 overlay vs skills.json per-level

- 有明确优先级: overlay > skills.json > 0
- **问题**：如果 skills.json 更新但 overlay 未同步 → overlay 覆盖新数据
- **建议**：长期逐步减少硬编码 overlay

### 风险 5 [低]: configuredStats._activeEffects 载体机制

- 天赋/潜能效果通过 `_activeEffects` 字段附着在 stats 对象上传递到 simulator
- 类型系统中是 `(actor.stats as any)?._activeEffects`，完全无类型保护
- **问题**：搭便车传递，不安全
- **建议**：长期应独立为 ActorSnapshot 的顶层字段

---

## 6. 目前最缺的中层能力判断

### 结论 [已从代码确认]: 最缺的是"runtime_conditional 通用分发层" + "runtime_passive type 扩展"

### 为什么这是最缺的一层

1. **数据侧已经就绪**：~12个干员的 talents.json 已标注 `scope: "runtime_conditional"` 并定义了 type/stat/value，但 simulator 中只有 WULFGARD 和 CHENQIANYU 的硬编码处理

2. **基础设施已经就绪**：`registerTriggeredBuff()` 辅助函数已封装好 refresh/stack 两种模式，`TriggerProcessor` + `EffectTrigger` 架构成熟

3. **卡在中间的连接层**：缺少"读 talent effect 数据 → 按 type/stat/条件类型 → 自动选择事件+条件+buff 注册"的分发逻辑

### 如果不先补这一层

- 每新增一个角色的天赋效果，都需要在 simulator.ts 加 if-else 特判
- 无法批量验证天赋效果正确性
- ENDMINISTRATOR、DAPAN、EMBER、POGRANICHNK、CATCHER 等角色的 runtime_conditional 数据已定义但全部悬空
- 最终要做"中层收口"时返工量比现在大得多

### 哪些"角色问题"其实是这层缺口的表面症状

- LAEVATAIN 天赋 resistance_ignore "不生效" → runtime_passive 只处理 damage_bonus
- ENDMINISTRATOR 天赋 conditional ATK% "不生效" → 无对应 if-else 分支
- CATCHER、POGRANICHNK、EMBER、LIFENG、ROSSI 等 → 同上
- 所有 ~130 处 parsed_unimplemented → 效果描述已存在于 talent JSON，但 runtime 没有消费端

---

## 7. Conditional 系统审计

### 已支持的 trigger / event / context

| 触发事件 | 已有实例 | 文件 |
|---|---|---|
| APPLY_DIRECT_ANOMALY + anomalyType check | WULFGARD 灼热獠牙 | simulator.ts:214-226 |
| DAMAGE_TICK + actionType check | CHENQIANYU 斩锋 | simulator.ts:229-246 |
| DAMAGE_TICK + 各种条件 | 4套装+2武器 | equipment/definitions.ts |
| APPLY_MAGIC_ATTACHMENT + element/stacks check | 潮涌套装 | equipment/definitions.ts |
| APPLY_PHYSICAL_ANOMALY | 点剑套装 | equipment/definitions.ts |
| ACTION_START | 部分武器 | weaponDataAdapter.ts |

### 支持的条件和buff机制

| 机制 | 状态 |
|---|---|
| 条件回调 (condition) | **已支持** — 可检查 action type、anomaly type、attachment stacks 等 |
| ICD (cooldownId + cooldownDuration) | **已支持** — 典范武器在用 |
| sourceMustBeWearer | **已支持** |
| 无叠加刷新 (addOrRefreshBuff) | **已支持** |
| 独立计时叠加 (addStackWithIndependentDuration) | **已支持** |

### 评估

- TriggerProcessor 是真正的通用评估器 [已从代码确认]
- registerTriggeredBuff() 是可复用 helper [已确认]
- **瓶颈**：角色天赋触发需手写 if 分支——不是系统不行，是"系统到 if 分支之间缺一个映射层"

### 继续做 ENDMINISTRATOR / DAPAN / EMBER 是否可行

- 模式与 WULFGARD/CHENQIANYU 相同的（on_X_event → self_buff），现在就能做——但要手写 if 分支
- ENDMINISTRATOR 可能需要"结晶消耗事件"（当前无此事件类型）
- DAPAN 可能需要"破绽层消耗事件"（当前无此事件类型）
- EMBER 可能需要"受击事件"（当前无此事件类型）
- **建议**：先建通用分发层 + 补缺失事件类型，再批量接入

---

## 8. 消耗异常 / 附着、连携触发、命中前后时序

### 当前代码状态

| 能力 | 状态 | 实现方式 |
|---|---|---|
| consume conduction | 已实现 | boundEffect 标签 "consume_conduction" (DamageHandler.ts L29-42) |
| consume corrosion → apply vuln | 已实现 | boundEffect 标签 "consume_corrosion_apply_vuln" (DamageHandler.ts L45-97) |
| freeze → physical vuln (pre-damage) | 已实现 | boundEffect 标签 "estella_phys_vuln_if_frozen" (DamageHandler.ts L106-128) |
| consume attachment (通用) | **未实现** | 无通用 consume attachment 机制 |
| 连携技触发 / release trigger | **未实现** | 无专用事件或语义 |
| pre-damage hook (通用) | **无通用** | 仅 estella 一个硬编码 pre-damage |
| post-damage hook (通用) | **部分** | processPostDamageEffects 存在但按标签特判 |
| current hit 生效 vs next hit 生效 | **无显式区分** | 靠时间戳排序隐式实现 |
| variant / hit resolution | **已实现** | enhancedMultipliers + enhancedActionIds 机制走通 |

### 体系评估

当前这一层**主要靠分散写法 / 临时方案**，没有体系化。每种消耗行为是一个独立的 boundEffect 标签字符串 + DamageHandler 中的 if-else。

### 最小补口建议

1. 将 DamageHandler 的 boundEffect 处理改为注册表：`Map<string, (e, ctx) => void>` 分 pre/post 两个 Map
2. 新增 EFFECT_CONSUMED 事件类型：在 consume 发生后触发，供 TriggerProcessor 监听
3. 暂不需要完整的 action lifecycle 重构

---

## 9. Talents / Potentials Runtime 接入真实程度

### 分层现状

| 层 | 状态 |
|---|---|
| 定义真值源 (talents.json) | 25/25 完整 |
| 配置状态真值源 (timelineStore) | 完整，talentLevel per-track, promotion 约束正确 |
| 静态数值接入 (stat_bonus → configuredStats) | 可用 |
| runtime_passive 接入 | **极窄** — 仅 `type==="damage_bonus"` 走通 |
| runtime_conditional 接入 | **极窄** — 仅 WULFGARD + CHENQIANYU |
| 仅能显示 | 130处 parsed_unimplemented 在 UI 有文字描述，runtime 不消费 |
| 潜能 runtime 接入 | **最低限度** — stat_bonus 静态生效，条件型完全未接入 |

### 看似支持但实际只支持一部分的角色

| 干员 | 问题 |
|---|---|
| **LAEVATAIN** | runtime_passive + resistance_ignore 数据就绪，simulator 不处理此 type → **抗性穿透不生效** |
| **ENDMINISTRATOR** | 天赋1 runtime_conditional ATK% 数据就绪，无代码；天赋2 runtime_passive physical_dmg 正常生效 |
| **POGRANICHNK** | runtime_conditional ATK% 数据就绪，无代码 |
| **CATCHER** | runtime_conditional ATK% 数据就绪，无代码 |
| **EMBER** | runtime_conditional ATK% 数据就绪，无代码 |
| **LIFENG** | runtime_conditional 50%/100% 数据就绪，无代码 |
| **ROSSI** | 4个 runtime_conditional 效果数据就绪，无代码 |
| **ALESH** | runtime_conditional gauge_modifier 数据就绪，无代码 |

---

## 10. Enemy Debuff / Anomaly 真实成熟度

| 子系统 | 真进入伤害公式？ | 说明 |
|---|---|---|
| 导电 (conduction) vulnerability | **是** | multiplierZones Zone 6, artsPower 公式驱动 |
| 碎甲 (armorBreak) physical vulnerable | **是** | PHYSICAL_VULNERABLE Effect → physVulnPercent |
| 腐蚀 (corrosion) resist reduction | **是** | EnemyStatusState.getCorrosionResistDown() → Zone 8 |
| 冻结 + 碎冰 | **是** | 碎冰伤害通过 anomalyDamageCalc |
| 灼烧 DoT | **是** | 10 tick 调度，每 tick 通过 anomalyDamageCalc |
| 失衡 1.3x | **是** | Zone 9, enemy.isBroken(time) |
| spell_vulnerable (ARDELIA) | **是** | dynamicBonuses zone="fragility" 挂载 enemy.effects |
| CORROSION_PARAMS | **Placeholder** | 标注 TODO — 当前数值可能不准确 |

### 不能泛化的地方

- consume_conduction 仅 ARCLIGHT 3rd hit 使用
- consume_corrosion_apply_vuln 仅 ARDELIA 专用
- estella_phys_vuln_if_frozen 仅 ESTELLA 专用
- 每种消耗行为硬编码在 DamageHandler，新角色消耗需新增 if 分支

---

## 11. 前端可信验证窗口

### 比较可信的

| 窗口 | 原因 |
|---|---|
| 技能 supported/wip/unsupported 标记 | 直接读 skillStatusRegistry，逻辑简单 |
| 属性面板 configuredStats | 经完整聚合链 (base + talent row1 + talent/potential static + weapon delta) |

### 中等可信的

| 窗口 | 限制 |
|---|---|
| DamageSummaryPanel | 需手动触发; TEMP_FORCE_NO_CRIT 导致偏低; 不含暴击期望值 |
| Boss debuff 栏 | 编辑器定义，不一定与 runtime 状态一致 |

### 不能只靠 UI 判断的

| 窗口 | 原因 |
|---|---|
| 天赋是否真正生效 | UI 显示天赋但不显示"是否被 simulator 消费"，需查 simLog |
| 武器/装备被动是否触发 | 无触发次数/buff 状态展示 |
| 运行时 buff 状态 | 无 UI 展示当前模拟时刻的 actor.effects |

---

## 12. 后续建议顺序

### 第一步 [最高优先]: 通用 runtime_conditional 分发层

在 simulator.ts 中替换角色 if-else 为数据驱动分发。registerTriggeredBuff() 基础设施已就绪，缺的是从 JSON 描述符到它的桥接层。

**同时修复**：runtime_passive type 扩展——支持 resistance_ignore（修复 LAEVATAIN）

**预期收益**：一次性解锁 ~10 个干员的天赋效果

### 第二步: boundEffect 注册表化

将 DamageHandler 中的 3 个硬编码标签改为注册表 + 标准化参数。

### 第三步: 补充缺失事件类型 (按需)

当具体角色卡住时再补：EFFECT_CONSUMED、ACTOR_DAMAGED、SP_THRESHOLD 等。

### 第四步: 角色效果批量接入

通用分发层 + 事件补口完成后，批量接入 ENDMINISTRATOR / CATCHER / POGRANICHNK / EMBER / LIFENG / ROSSI 等。

### 先不要做的

- **暴击期望值模式**：TEMP_FORCE_NO_CRIT 影响展示但不影响正确性
- **清理旧 EFFECT_START 链路**：已标注 legacy，不进入主链，无害
- **统一 damageSummary / damageStatsSnapshot**：分工明确
- **potentials 条件型/天赋增强型接入**：优先保证天赋层走通

---

## 13. 三个额外问题的回答

### Q1: 现在更适合推进 P1 runtime_conditional，还是先插"通用触发/消耗语义补口"分支？

**答：两者合并做最高效。** registerTriggeredBuff() 基础设施已就绪，缺的是分发层(1-2天工作量)。消耗语义补口(boundEffect 注册表化)也不大。建议一个分支内完成。

### Q2: 如果只能选一个"最值钱的小型中层补口"？

**答：runtime_passive type 扩展。** 在 simulator.ts:105-106 处支持 resistance_ignore 等 type。

理由：
- 改动极小（~20行）
- **立即修复 LAEVATAIN 天赋完全不生效的 bug**
- 为后续更多 passive type 打开口子

### Q3: 下一轮建议先做什么？

**答：中层通用语义补口。**

理由：
- 结构审计已在本轮完成，不需要单独"运行验证"轮
- 做具体角色实现会继续堆积 if-else 特判
- 中层补口一次性解锁最多角色效果，ROI 最高
- 具体建议：一个分支内完成第一步 + 第二步，然后用 ENDMINISTRATOR 和 LAEVATAIN 做端到端验证
