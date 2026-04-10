# T3 天赋/潜能 Runtime Effects 接入 Simulation 审计

---

## 1. _activeEffects 当前流向

`result._activeEffects` 在 `resolveTrackConfiguredStats()` (timelineStore.js line 628) 被设置。

**当前消费者: 零。** grep 确认仅有设置位，无读取位。

`buildSimulationTracks()` 将 `resolveTrackFinalStats()` 结果作为 `track.stats` 传入编译链。`track.stats` 是 plain object，`_activeEffects` 作为下划线前缀属性随之传入。但 `compileScenario` → `processActors` 只读 `track.stats` 的 CORE_STATS 字段，`_activeEffects` 被忽略。

**最适合的统一入口**: `simulator.ts` 的 `simulate()` 函数——它已有 `skillLevelMap` 和 AVYWENNA lance tracking 等 per-actor compile-time prepass 模式。runtime effects 也应在此处注册。

## 2. Simulation 事件系统接入点

### 现有 runtime buff 机制（已验证存在）

```
Effect (effects/types.ts)
  → properties.dynamicBonuses: DynamicBonus[]
  → registered on ActorState.effects (EffectManager)
  → aggregated at damage time by multiplierZones.ts
```

这是武器被动已经使用的模式。天赋/潜能的 runtime effects 应复用此机制。

### 接入点分析

| 接入点 | 风险 | 适合什么 |
|---|---|---|
| `simulator.ts` — action enqueue 前的 setup 阶段 | **低** | 常驻被动（runtime_passive）→ 注册为 permanent Effect on actor |
| `simulator.ts` — 类似 AVYWENNA lance 的 per-action hook | **低** | 条件触发（runtime_conditional）→ 在 action 处理时动态注册 buff |
| `DamageHandler.ts` — damage resolution 后 | **中** | 造成伤害后的追加效果（如 DOT、回复） |
| `multiplierZones.ts` | **高风险** | 不应直接修改——已通过 dynamicBonuses 间接接入 |
| `aggregateAttackBonuses` / `aggregateZoneBonuses` | **高风险** | 不应直接修改——已从 EffectManager 读取 |

### 容易造成重复计算的风险

| 风险 | 原因 | 防范 |
|---|---|---|
| static + runtime 双重计入 | 如果 static effects 已加入 configuredStats (如 potential 的 stat_bonus)，又在 runtime 注册为 buff → 重复 | 必须只用一条路径：static 走 configuredStats，runtime 走 Effect/dynamicBonuses |
| ATK% 重复 | configuredStats 已乘过 attack_percent，如果 runtime 再加 ATK% buff → 正确（两层独立）| 不是重复，是设计内两层 |

## 3. 可优先支持的第一批 runtime effect 类型

基于现有天赋/潜能 effects 数据，按通用性和风险排序：

### 第一批（最通用，最低风险）

| effect type | scope | 数量 | 实现方式 | 示例 |
|---|---|---|---|---|
| `damage_bonus` (enemy debuff) | runtime_passive | 7 | 注册为 permanent Effect on "boss"，dynamicBonuses zone="fragility" | ENDMINISTRATOR 现实静滞: 物理伤害+10% |

原因：
- 数量少（7 个）但影响大（直接乘进伤害公式）
- 复用现有 fragility zone 机制
- 不需要条件判定引擎
- 天赋解锁状态由 talentLevels 确定，simulation 开始前已知

### 第二批（通用但需 buff 状态机）

| effect type | scope | 数量 | 实现方式 | 示例 |
|---|---|---|---|---|
| `stat_bonus` (ATK% conditional) | runtime_conditional | 26 | 需要触发条件 + duration buff | ENDMINISTRATOR 本质瓦解: 消耗后 ATK+15% 持续 15s |

原因：
- 数量多（26 个）但每个需要独立触发条件
- 需要在 simulation 事件系统中注册 trigger
- 类似武器 triggeredBuff 的模式，但触发条件更多样
- 建议在第一批之后做

### 不在第一二批的

| effect type | 原因 |
|---|---|
| `resistance_ignore` | 需要修改 multiplierZones 的 resistance 计算 |
| `gauge_modifier` | 需要修改 gauge 系统 |
| `parsed_unimplemented` (65 个) | 复杂效果，需逐个分析 |

## 4. 统一解释层建议

### runtime_passive → permanent Effect

```javascript
// In simulator.ts setup phase:
for (const actor of actors) {
  const activeEffects = resolveTrackActiveEffects(actor.id)
  for (const talent of activeEffects.activeTalents) {
    for (const eff of talent.activeStage?.effects || []) {
      if (eff.scope !== 'runtime_passive') continue
      if (eff.type === 'damage_bonus' && eff.note === 'enemy debuff') {
        // Register as fragility on boss
        engine.state.enemy.effects.add(new Effect({
          id: `talent_${talent.id}_fragility`,
          tags: [],
          duration: Infinity,
          startTime: 0,
          properties: {
            dynamicBonuses: [{ stat: eff.stat, value: eff.value, zone: 'fragility' }]
          }
        }))
      }
    }
  }
}
```

### runtime_conditional → 类似 weaponDataAdapter 的 trigger 注册

需要一个 `talentEffectAdapter` 类似 `weaponDataAdapter`，把天赋条件效果映射到 EffectTrigger。但这比 runtime_passive 复杂得多，建议第二批做。

### 已有结构可直接复用

| 结构 | 来源 | 复用方式 |
|---|---|---|
| `Effect` class | effects/types.ts | 天赋被动 → permanent Effect |
| `DynamicBonus` type | equipment/types.ts | 天赋增伤 → dynamicBonuses 数组 |
| `EffectManager.add()` | state/EffectManager.ts | 注册到 actor 或 enemy |
| `aggregateZoneBonuses()` | equipment/types.ts | 已有 fragility zone 聚合 |

### 不适合照搬的

| 结构 | 原因 |
|---|---|
| `weaponDataAdapter.ts` 的 TRIGGER_EVENT_MAP | 天赋触发条件更多样，不能用同一个 map |
| equipment/definitions.ts 的硬编码 action | 天赋效果应由 effects[] 数据驱动，不应硬编码 |

## 5. 最小实施路线

### Phase 1: runtime_passive → permanent Effect（推荐先做）

**改动文件**: `simulator.ts`（1 个文件，~20 行）

**流程**:
1. 在 `simulate()` 的 action enqueue 循环之前
2. 对每个 actor 调用 `resolveTrackActiveEffects()`
3. 遍历 `activeTalents` 中 `scope: "runtime_passive"` 且 `note: "enemy debuff"` 的 effects
4. 为每个注册一个 permanent Effect on `engine.state.enemy`（duration=Infinity）
5. 使用 `dynamicBonuses` + `zone: "fragility"` — 复用现有 fragility zone 聚合

**不需要改的**:
- multiplierZones.ts — 已有 fragility 聚合
- DamageResolver.ts — 已消费 fragility zone
- DamageHandler.ts — 不需要改
- 不新增真值源 — effects 数据来自 talents.json

**验证**: ENDMINISTRATOR 现实静滞 E3（物理伤害+20%）→ 对物理伤害的 fragility zone 应 +20%

### Phase 2: runtime_conditional → trigger 注册（后续做）

需要 `talentEffectAdapter.ts` 新文件，参考 `weaponDataAdapter.ts` 模式。触发条件需要逐天赋分析。建议在 Phase 1 验证通过后再做。

---

## 风险与边界

| 风险 | 防范 |
|---|---|
| static + runtime 双重计入 | runtime_passive effects 的 stat 走 fragility zone（乘区），不走 configuredStats（面板）。两者不是同一字段，不会重复 |
| 天赋等级=0 时不应生效 | `resolveTrackActiveEffects()` 已处理：level=0 时 activeStage=null，不产出 effects |
| enemy state 注入时机 | 在 engine.run() 之前注册 permanent effect，保证整个 simulation 生效 |
| 不引入新真值源 | effects 数据来自 talents.json.stages[].effects，不新建文件 |
