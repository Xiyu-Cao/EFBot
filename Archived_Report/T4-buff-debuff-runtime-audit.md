# T4 Buff / Debuff 运行时生效主路径审计

---

## 1. 当前 buff / debuff 的定义与触发来源

### 来源一览

| 来源 | 定义位置 | 触发位置 | 入口函数 | 是否进入伤害结算 |
|---|---|---|---|---|
| **技能附着效果** | `scenarioAdapter.ts` 映射 | `simulator.ts` L221-253 → `EFFECT_START` 事件 | `EffectStartHandler.handle()` | **否** — 只写 EffectManager tag，不进公式 |
| **天赋 runtime_passive** | `talents.json` stages[].effects | `simulator.ts` L69-98 → 直接创建 Effect | `actorState.effects.add()` | **是** — 有 dynamicBonuses，进 fragility zone |
| **武器被动** | `gamedata.json` triggeredBuff | `weaponDataAdapter.ts` → `registry.ts` | `registerPassiveEffect()` → TriggerProcessor | **是** — trigger action 创建 dynamicBonuses Effect |
| **装备套装** | `equipment/definitions.ts` 硬编码 | `registry.ts` 同上 | 同上 | **是** — 同上 |
| **异常系统（新路径）** | `anomaly/types.ts` + `EnemyStatusState.ts` | `AnomalyHandlers.ts` | `APPLY_MAGIC_ATTACHMENT` 等事件 | **是** — 更新 EnemyStatusState，resistance zone 读取 |
| **异常系统（旧路径）** | `effects/types.ts` 静态工厂 + `afflictionEffectMap.ts` | `EffectStartHandler.ts` → `ReactionRegistry` | `target.effects.add()` | **否** — 只写 tag 到 EffectManager |

### 关键发现：存在两套平行反应系统

**旧路径（EffectStartHandler + ReactionRegistry）：**

```
simulator.ts action.effects → SCNEARIO_EFFECT_TYPE_MAP → EFFECT_START
  → EffectStartHandler → ReactionRegistry.check()
  → 跨元素反应 → spawnEffects (ELEMENT_CORROSION 等 tag Effect)
  → target.effects.add() → EffectManager (仅 tag，无 dynamicBonuses)
```

**新路径（AnomalyHandlers + MagicReactionResolver）：**

```
APPLY_MAGIC_ATTACHMENT 事件
  → ApplyMagicAttachmentHandler → resolveMagicAttachment()
  → 跨元素反应 → applyAnomalyDebuff() → status.applyCorrosion() 等
  → EnemyStatusState 更新 → 实际进入抗性区/易伤区
```

**主模拟循环只喂旧路径。新路径从未被调用。**

---

## 2. buff / debuff 的运行时存储与生命周期

### 存储位置

| 存储 | 类 | 位于 | 用途 |
|---|---|---|---|
| `actor.effects` | `EffectManager` | `state/ActorState.ts` | 武器 buff、天赋被动 Effect（有 dynamicBonuses） |
| `enemy.effects` | `EffectManager` | `state/EnemyState.ts` | 旧路径元素/物理 tag Effect（无 dynamicBonuses）+ PHYSICAL_VULNERABLE 特例 |
| `enemy.status` | `EnemyStatusState` | `anomaly/EnemyStatusState.ts` | 新异常子系统：burn/freeze/conduction/corrosion 结构化状态 |

### 机制运行状态

| 机制 | 是否实际运行 |
|---|---|
| `duration + startTime` 过期 | **是** — `sweepExpired()` 在 `ActorState.advanceTime()` 和 `EnemyState.advanceTime()` 中被调用 |
| `stackStrategy: REFRESH_DURATION` | **是** — `EffectManager.handleStacking()` 实现 |
| `stackStrategy: INDEPENDENT` | **是** — `addStackWithIndependentDuration()` 在 `equipment/types.ts` 中实现 |
| `EFFECT_END` 事件自动清理 | **是** — `EffectStartHandler` 自动 enqueue EFFECT_END |
| `EnemyStatusState.advanceCorrosion()` | **是** — 在 `EnemyStatusState.advance()` 中调用 |
| `ReactionRegistry` 跨元素触发 | **是** — 检测并生成 spawnEffects |
| **但** spawnEffects → 实际伤害影响 | **否** — spawn 的 Effect 只是 tag marker |

### "能显示但不参与结算"的对象

所有通过 `EFFECT_START` → `EffectStartHandler` 路径创建的元素/物理附着 Effect：

- `ELEMENT_HEAT`, `ELEMENT_CRYO`, `ELEMENT_ELECTRIC`, `ELEMENT_NATURE`
- `ELEMENT_CORROSION`, `ELEMENT_COMBUSTION`, `ELEMENT_SOLIDIFICATION`, `ELEMENT_ELECTRIFICATION`
- `ELEMENT_*_BURST`
- `PHYSICAL_BREACH`, `PHYSICAL_CRUSH`, `PHYSICAL_KNOCK_DOWN`, `PHYSICAL_LIFT`

这些 Effect 存在于 `enemy.effects` 中，simLog 会记录 `EFFECT_START` / `REACTION_OCCURRED`，但：

- 无 `dynamicBonuses` → `aggregateDynamicBonuses` / `aggregateZoneBonuses` 忽略
- 唯一特例：`PHYSICAL_VULNERABLE` tag 被 `computeVulnerabilityZone` 特殊读取 `physVulnPercent` 属性

---

## 3. buff / debuff 到伤害计算的消费路径

### 一次 DAMAGE_TICK 的完整链路

```
DamageHandler.handle()
  → DamageResolver.resolve(damageCtx)
    → computeEffectiveAttack()
      → aggregateAttackBonuses(state, sourceActorId)
        [读 actor.effects, zone=attackPercent/attackFlat]
    → computeAllZones(zoneCtx)
      → computeDamageBonusZone()
        → source.stats 上的静态字段 (physical_dmg, arts_dmg, blaze_dmg, ...)
        → aggregateDynamicBonuses(state, sourceActorId)
          [读 actor.effects, zone=damageBonus 或无 zone]
      → computeAmplifyZone()
        → aggregateZoneBonuses(state, sourceActorId, "amplify")
          [读 actor.effects]
      → computeComboZone()
        → aggregateZoneBonuses(state, sourceActorId, "combo")
          [读 actor.effects]
      → computeVulnerabilityZone()
        → target.status.conduction → 法术易伤 (来自 EnemyStatusState)
        → target.effects.getByTag("PHYSICAL_VULNERABLE") → 物理易伤 (来自 enemy.effects)
        → aggregateZoneBonuses(state, sourceActorId, "vulnerability")
          [读 actor.effects]
      → computeFragilityZone()
        → aggregateZoneBonuses(state, sourceActorId, "fragility", tags)
          [读 actor.effects]
      → computeResistanceZone()
        → target.config.baseMagicResist / basePhysicalResist
        → target.status.getCorrosionResistDown()
          [读 EnemyStatusState]
      → computeBreakZone()
        → target.isBroken()
```

### 当前真正被消费的 buff/debuff 类型

| 类型 | 读取自 | Zone | 文件 |
|---|---|---|---|
| actor dynamicBonuses (zone=damageBonus) | `actor.effects` | 增伤区 | `equipment/types.ts:218` |
| actor dynamicBonuses (zone=fragility) | `actor.effects` | 脆弱区 | `equipment/types.ts:258` |
| actor dynamicBonuses (zone=amplify) | `actor.effects` | 增幅区 | `equipment/types.ts:258` |
| actor dynamicBonuses (zone=combo) | `actor.effects` | 连击区 | `equipment/types.ts:258` |
| actor dynamicBonuses (zone=vulnerability) | `actor.effects` | 易伤区 | `equipment/types.ts:258` |
| actor dynamicBonuses (zone=attackPercent/Flat) | `actor.effects` | ATK 公式 | `equipment/types.ts:303` |
| actor stats 静态字段 | `source.stats` | 增伤区 | `multiplierZones.ts:84` |
| PHYSICAL_VULNERABLE physVulnPercent | `enemy.effects` tag 特例 | 易伤区 | `multiplierZones.ts:219` |
| Conduction | `enemy.status` | 易伤区 | `multiplierZones.ts:200` |
| Corrosion | `enemy.status` | 抗性区 | `multiplierZones.ts:284` |
| Break status | `enemy` | 失衡区 | `multiplierZones.ts:301` |

### 创建但不进入结算的 buff/debuff

**所有 EffectManager 中的 tag-only Effect** — 即没有 `properties.dynamicBonuses` 的 Effect。包括所有通过 `SCNEARIO_EFFECT_TYPE_MAP` → `AfflictionEffectMap` 创建的附着/异常/物理效果。

---

## 4. 以"腐蚀不影响管理员战技"为样例定位断点

### 链路追踪

1. **ENDMINISTRATOR 战技的自然附着** → `nature_attach` → `SCNEARIO_EFFECT_TYPE_MAP` → `"ELEMENT_NATURE"` — 有映射
2. → enqueue `EFFECT_START` → `EffectStartHandler` — 被处理
3. → `ReactionRegistry.check()` — 如果 enemy 上有其它元素附着 → 跨元素反应 → spawn `ELEMENT_CORROSION` — 反应产生
4. → spawn 的 ELEMENT_CORROSION 通过 `EFFECT_START` 再次进入 `EffectStartHandler` — 被添加到 enemy.effects
5. **断点在这里**：ELEMENT_CORROSION 是 tag-only Effect，加入 `enemy.effects` 后：
   - `computeResistanceZone()` 读的是 `target.status.getCorrosionResistDown()` — 来自 `EnemyStatusState`
   - 但 `EnemyStatusState.corrosion` **从未被 set**
   - 因为 `applyCorrosion()` 只被 `ApplyDirectAnomalyHandler` 和 `MagicReactionResolver` 调用
   - 而主循环从不 enqueue `APPLY_MAGIC_ATTACHMENT` 或 `APPLY_DIRECT_ANOMALY`

### 断点定位

**第一断点（根因）**：`simulator.ts` L221-253 将元素附着映射为 `EFFECT_START` 事件，走旧反应路径（ReactionRegistry → EffectManager tag）。但伤害公式读取新异常路径（EnemyStatusState）。两个系统从未被桥接。

**第二断点（结构性）**：`SCNEARIO_EFFECT_TYPE_MAP` 只包含 8 种映射（4 物理 + 4 元素附着），没有直接映射到 `APPLY_MAGIC_ATTACHMENT` / `APPLY_DIRECT_ANOMALY` 事件。`hitSteps.ts` 机制已设计但未被主循环使用。

---

## 5. 真实主路径 vs 展示链 / 旁路

### 真实 runtime 主路径（影响伤害数值）

| 模块 | 文件 | 作用 |
|---|---|---|
| DamageResolver | `calculation/DamageResolver.ts` | 伤害公式入口 |
| multiplierZones | `calculation/multiplierZones.ts` | 11 个乘区计算 |
| aggregateDynamicBonuses | `equipment/types.ts:218` | 从 actor.effects 聚合 dynamicBonuses |
| aggregateZoneBonuses | `equipment/types.ts:258` | 分 zone 聚合 dynamicBonuses |
| aggregateAttackBonuses | `equipment/types.ts:303` | ATK% 和 ATK flat 聚合 |
| evaluateDynamicBonus | `equipment/types.ts:82` | 按 damage tag 匹配 bonus 是否适用 |
| EnemyStatusState | `anomaly/EnemyStatusState.ts` | corrosion/conduction 被公式消费 |
| actor.effects (EffectManager) | `state/ActorState.ts` | dynamicBonuses 的实际存储 |
| TriggerProcessor | `engine/TriggerProcessor.ts` | 武器/装备 trigger → 创建 dynamicBonuses buff |
| addOrRefreshBuff / addStackWithIndependentDuration | `equipment/types.ts` | buff 创建/更新 |

### 展示层 / 旁路（不影响伤害数值）

| 模块 | 文件 | 误导风险 |
|---|---|---|
| **ReactionRegistry** | `mechanics/reactions.ts` | **高** — 会产生反应日志（`REACTION_OCCURRED`），看起来反应成功触发，但 spawn 的 Effect 无 dynamicBonuses |
| **SCNEARIO_EFFECT_TYPE_MAP** | `effects/scenarioAdapter.ts` | **高** — 完整映射 8 种效果，看起来"已接入"，实际只产出 tag |
| **AfflictionEffectMap** | `effects/afflictionEffectMap.ts` | **高** — 17 种预定义 Effect 全部无 dynamicBonuses |
| **EffectStartHandler → simLog** | `events/EffectStartHandler.ts` | **高** — 记录 `EFFECT_START` 日志，显示 buff 已挂上 |
| **Effect 静态工厂方法** | `effects/types.ts:228-320` | **中** — 13 个工厂方法全部创建 tag-only Effect |
| **hitSteps.ts** | `mechanics/hitSteps.ts` | **低** — 设计了正确的新路径但未被主循环使用 |

### 最容易误以为"已生效"的地方

1. **simLog 显示 `EFFECT_START: ELEMENT_CORROSION`** — 看起来腐蚀已挂上敌人，但只是 tag 进了 EffectManager
2. **simLog 显示 `REACTION_OCCURRED: Arts Reaction`** — 看起来反应已触发，但反应产物不进伤害公式
3. **EffectManager.hasTag("ELEMENT_CORROSION") 返回 true** — 状态查询确认"有腐蚀"，但不等于 EnemyStatusState.corrosion 被设置

---

## 6. 第一批最值得补齐的 buff/debuff 类型

按优先级排序：

### P0: 桥接旧反应路径到新异常系统

| 类型 | 价值 | 理由 |
|---|---|---|
| 元素附着 → EnemyStatusState | **极高** | 这是整个异常系统能工作的前提。不修这个，corrosion/conduction/burn/freeze 全部断路 |

修复后自动解锁：

- 腐蚀减抗 → resistance zone
- 导电法术易伤 → vulnerability zone
- 燃烧 DOT → ANOMALY_DAMAGE
- 冻结碎冰 → ANOMALY_DAMAGE

### P1: 武器/装备触发型 buff（已工作，补覆盖）

当前武器 triggeredBuff 机制已完整工作。需要补齐的是更多武器的具体 trigger 映射，但机制本身已通。

### P2: 天赋 runtime_conditional buff

| 类型 | 数量 | 理由 |
|---|---|---|
| 条件性 stat_bonus (ATK%、DMG% 等) | 26 个 | 需要 trigger 注册系统，类似武器被动模式 |

### 不在第一批

| 类型 | 理由 |
|---|---|
| DOT 系统重构 | P0 修复后 burn tick 自动工作 |
| 异常反应全重构 | 不需要——新路径已完整，只需桥接 |
| resistance_ignore | 需修改 resistance zone 计算，独立任务 |
| gauge_modifier | 独立于伤害系统 |

---

## 7. 最小改动实施方案（仅方案，不实施）

### 切入点

将主模拟循环的元素附着从旧 `EFFECT_START` 路径切换到新 `APPLY_MAGIC_ATTACHMENT` / `APPLY_PHYSICAL_ANOMALY` 路径。

### 为什么这个切入点最小且通用

- **不需要修改伤害公式** — `multiplierZones.ts` 已正确消费 EnemyStatusState
- **不需要新建文件** — AnomalyHandlers、MagicReactionResolver、EnemyStatusState 全部就绪
- **不需要修改 EffectManager / Effect 类** — 保持现有存储机制
- **不需要新 registry** — 复用现有 `SCNEARIO_EFFECT_TYPE_MAP` 的映射关系
- **一次修复解锁全部 4 种异常** — corrosion、conduction、burn、freeze

### 预计动的文件

| 文件 | 改什么 |
|---|---|
| `simulator.ts` L221-253 | 元素附着效果（blaze_attach/emag_attach/cold_attach/nature_attach）改为 enqueue `APPLY_MAGIC_ATTACHMENT` 事件而非 `EFFECT_START`。物理效果（armor_break/stagger/knockdown/knockup）改为 enqueue `APPLY_PHYSICAL_ANOMALY` 事件。 |

可能需要微调：

| 文件 | 可能需要 |
|---|---|
| `scenarioAdapter.ts` | 可能需要扩展映射以区分 element 类型（heat/cryo/electric/nature），当前只有 tag 名 |

### 具体做法

在 `simulator.ts` 的 `action.effects.forEach()` 循环中：

**当前逻辑**：所有效果 → `SCNEARIO_EFFECT_TYPE_MAP` → `AfflictionEffectMap[tag].clone()` → `EFFECT_START`

**修改为**：

- 如果 tag 是 `ELEMENT_HEAT/CRYO/ELECTRIC/NATURE`（4 种元素附着）→ enqueue `APPLY_MAGIC_ATTACHMENT` 事件，payload 包含 `element`, `sourceActorId`, `targetId`
- 如果 tag 是 `PHYSICAL_BREACH/CRUSH/KNOCK_DOWN/LIFT`（4 种物理效果）→ enqueue `APPLY_PHYSICAL_ANOMALY` 事件，payload 包含 `physicalType`, `sourceActorId`, `targetId`
- 不再通过 `EFFECT_START` + `ReactionRegistry` 旧路径

### 复用现有机制

| 现有机制 | 复用方式 |
|---|---|
| `SCNEARIO_EFFECT_TYPE_MAP` | 判断效果类型（元素/物理），决定走哪种事件 |
| `ApplyMagicAttachmentHandler` | 已注册在 createEngine.ts，直接接收事件 |
| `MagicReactionResolver` | 已实现跨元素反应 → applyAnomalyDebuff() → EnemyStatusState |
| `ApplyPhysicalAnomalyHandler` | 已注册，处理物理破甲/易伤 |
| `EnemyStatusState` | 已有 applyCorrosion/Conduction/Burn/Freeze 全套方法 |
| `computeResistanceZone` / `computeVulnerabilityZone` | 已读取 EnemyStatusState |

### 避免的事

- **不删除 ReactionRegistry** — 可能有其它消费者（测试等），只是主循环不再走这条路
- **不修改 multiplierZones / DamageResolver** — 已正确消费 EnemyStatusState
- **不修改 AnomalyHandlers** — 已正确处理所有事件
- **不修改 EnemyStatusState** — 已有完整的 apply/advance/clear 机制
- **不新增 registry / effect 表** — 复用现有 SCNEARIO_EFFECT_TYPE_MAP 确定效果类型
- **不扩展到 runtime_conditional** — 那是独立任务
- **不重构异常系统** — 新路径已完整，只需让主循环用上它

### 验证方法

1. 放一个 nature 角色 + 一个非 nature 角色在排轴上
2. 让两者交替释放技能（产生跨元素反应 → 腐蚀）
3. 观察 ENDMINISTRATOR 物理战技伤害在腐蚀存在时是否增加（通过减抗）
4. simLog 应出现 `ANOMALY_STATUS_CHANGE: corrosion applied` 而非仅 `EFFECT_START: ELEMENT_CORROSION`
