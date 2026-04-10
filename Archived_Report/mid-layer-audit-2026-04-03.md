# 中层 Runtime 连接层补口审计报告

> 审计时间: 2026-04-03
> 审计范围: runtime_passive / runtime_conditional / boundEffects 三条中层链路
> 原则: 所有结论标注"已从代码确认"或"推测/需验证"

---

## A. runtime_passive 当前的过滤 / 注册 / 消费逻辑

### 过滤逻辑 [已从代码确认]

**文件**: `simulation/simulator.ts:105-106`

```typescript
const passiveEffects = activeEffects.filter(
  (e: any) => e.scope === "runtime_passive" && e.type === "damage_bonus" && e.stat && e.value
);
```

过滤条件是四元 AND：
1. `scope === "runtime_passive"`
2. `type === "damage_bonus"` ← **硬编码唯一 type**
3. `e.stat` 必须存在（truthy）
4. `e.value` 必须存在（truthy）

### 注册逻辑 [已从代码确认]

**文件**: `simulation/simulator.ts:110-124`

```typescript
const dynBonuses = passiveEffects.map((e: any) => ({
  stat: e.stat,     // e.g., "cold_dmg", "physical_dmg"
  value: e.value,   // e.g., 10, 20
  zone: "fragility" as const,  // ← 硬编码到 fragility zone
}));

actorState.effects.add(new Effect({
  id: `talent_passive_${actor.id}`,
  tags: [],
  duration: 999999,  // 永久
  startTime: 0,
  properties: { dynamicBonuses: dynBonuses },
}));
```

关键设计选择：
- 所有 passive 合并到**一个** Effect（ID 为 `talent_passive_${actor.id}`）
- 统一进入 **fragility zone**（脆弱区）
- 无 tags、无 triggers
- duration 999999（永久）

### 消费逻辑 [已从代码确认]

消费路径：`DamageResolver.resolve()` → `computeFragilityZone()` → `aggregateZoneBonuses(state, actorId, "fragility", tags)`

**文件**: `calculation/multiplierZones.ts:257-270`
- 读取 actor.effects 中所有 `zone === "fragility"` 的 dynamicBonuses
- 对每个 bonus 调用 `evaluateDynamicBonus(bonus, tags)` 检查 school/element 匹配
- 累加到 fragility zone 乘区

**文件**: `equipment/types.ts` 中的 `evaluateDynamicBonus()`
- `physical_dmg` → 仅当 `tags.damageSchool === "physical"` 时生效
- `cold_dmg` → 仅当 `tags.damageType === "cold"` 时生效
- 其他元素/学派类推

### 数据来源 [已从代码确认]

**文件**: `stores/timelineStore.js:614-628`

```javascript
const allEffects = [
  ...activeTalents.flatMap(t => t.activeStage?.effects || []),
  ...activePotentials.flatMap(p => p.effects || []),
]
result._activeEffects = allEffects  // 全部效果（含所有 scope）原样传递
```

不做 scope 过滤——所有效果（static / runtime_passive / runtime_conditional / parsed_unimplemented）都通过 `_activeEffects` 传到 simulator。simulator 自己做过滤。

### 涉及文件汇总

| 阶段 | 文件 | 函数/行号 |
|------|------|-----------|
| 数据定义 | `data/operators/*/talents.json` | 各效果的 scope/type/stat/value |
| 数据聚合 | `stores/timelineStore.js` | `resolveTrackActiveEffects()` L657-696, `resolveTrackConfiguredStats()` L614-628 |
| 过滤+注册 | `simulation/simulator.ts` | L96-128 |
| 消费 | `calculation/multiplierZones.ts` | `computeFragilityZone()` L257-270 |
| 消费(底层) | `equipment/types.ts` | `aggregateZoneBonuses()`, `evaluateDynamicBonus()` |

---

## B. 已有数据但未被 simulator 主链消费的 runtime_passive type

### 完整清单 [已从代码确认]

| 干员 | 天赋 | type | stat | value(各阶段) | scope | 是否被消费 |
|------|------|------|------|--------------|-------|-----------|
| XAIHI | talent_0 启动进程 | `damage_bonus` | `cold_dmg` | 7 / 10 | runtime_passive | ✅ 已消费 |
| ENDMINISTRATOR | talent_1 现实静滞 | `damage_bonus` | `physical_dmg` | 10 / 20 | runtime_passive | ✅ 已消费 |
| **LAEVATAIN** | **talent_0 灼心** | **`resistance_ignore`** | **(无 stat 字段)** | **10 / 15 / 20** | **runtime_passive** | **❌ 未消费** |

### LAEVATAIN 详细分析 [已从代码确认]

**文件**: `data/operators/LAEVATAIN/talents.json:28-32, 42-46, 56-60`

三个阶段的效果定义：
```json
{ "type": "resistance_ignore", "value": 10, "unit": "flat", "scope": "runtime_passive", "note": "resistance penetration" }
{ "type": "resistance_ignore", "value": 15, "unit": "flat", "scope": "runtime_passive", "note": "resistance penetration" }
{ "type": "resistance_ignore", "value": 20, "unit": "flat", "scope": "runtime_passive", "note": "resistance penetration" }
```

**未消费原因**:
1. `type === "resistance_ignore"` ≠ `"damage_bonus"`，被 simulator.ts:106 的 filter 排除
2. 没有 `stat` 字段 → 即使放宽 type 过滤，`e.stat` 也不为 truthy → 仍会被排除
3. simulation 目录全局搜索 `resistance_ignore`：**0 匹配** [已从代码确认]

**接入需要的改动**:
- simulator.ts 中增加一个 `resistance_ignore` 的处理分支
- 不能复用 dynamicBonuses fragility zone——需要进入 **resistance zone** (`computeResistanceZone()`)
- `computeResistanceZone()` 当前只读 corrosion resist-down，有 TODO 注释 "other resist reduction sources from buffs"（L294）
- 需要让 resistance zone 也查询 actor effects 的 resistance_ignore bonus

### ENDMINISTRATOR talent_1 语义精度问题 [推测/需验证]

**描述**: "附着源石结晶的敌人受到的物理伤害+10%"——应该**仅在敌人有结晶附着时**生效。

**当前实现**: 注册为无条件永久 fragility buff，不检查结晶附着状态。

**影响**: 当敌人没有结晶附着时，这个 buff 仍然在生效 → 伤害偏高。在实际排轴中，如果 ENDMINISTRATOR 频繁使用技能，结晶大部分时间存在，偏差可能不大。但从精确性角度，这是一个已知的语义简化。

**是否属于本轮修复范围**: 推测不属于（需要在伤害时检查 enemy debuff 状态，改动较大）。先标注 TODO。

---

## C. WULFGARD / CHENQIANYU 的 runtime_conditional 如何挂进主链

### 完整链路 [已从代码确认]

**文件**: `simulation/simulator.ts:199-250`

#### 步骤 1: 过滤 conditional 效果

```typescript
const conditionals = activeEffects.filter(
  (e: any) => e.scope === "runtime_conditional" && e.value
);
```

仅检查两个条件：`scope === "runtime_conditional"` 且 `e.value` truthy。不检查 type。

#### 步骤 2: 按角色 ID 分发

```typescript
if (actorId === "WULFGARD") { ... }
if (actorId === "CHENQIANYU") { ... }
```

每个角色是独立的 if 块，不互斥。

#### 步骤 3: 从 conditionals 数组中查找匹配的效果

WULFGARD：`conditionals.find((e: any) => e.type === "damage_bonus" && e.stat === "blaze_dmg")`
CHENQIANYU：`conditionals.find((e: any) => e.type === "stat_bonus" && e.stat === "attack_percent")`

#### 步骤 4: 调用 registerTriggeredBuff()

WULFGARD:
```
registerTriggeredBuff(actorId, {
  carrierId: "talent_cond_wulfgard_blazing_fangs",
  event: "APPLY_DIRECT_ANOMALY",
  condition: (e) => e.payload?.anomalyType === "burn",
  buffId: "wulfgard_blaze_buff",
  duration: 10,
  bonuses: [{ stat: "blaze_dmg", value: eff.value }],
  // 无 stack → refresh 模式
})
```

CHENQIANYU:
```
registerTriggeredBuff(actorId, {
  carrierId: "talent_cond_chenqianyu_slash_edge",
  event: "DAMAGE_TICK",
  condition: (e, ctx) => {
    const action = ctx.getAction(e.payload?.actionId);
    const t = action?.node?.type;
    return t === "skill" || t === "link" || t === "ultimate";
  },
  buffId: "chenqianyu_atk_stack",
  duration: 10,
  bonuses: [{ stat: "all_dmg", value: eff.value, zone: "attackPercent" }],
  stack: { group: "chenqianyu_slash", max: 5 },
})
```

#### 步骤 5: registerTriggeredBuff 创建 carrier Effect + EffectTrigger

carrier Effect（永久，duration 999999）挂载到 actorState.effects 上。
carrier Effect 携带一个 EffectTrigger，监听指定事件。

#### 步骤 6: TriggerProcessor 每事件后评估

每个事件处理完毕后，`TriggerProcessor.process(event, ctx)` 遍历所有 actor/enemy 的 effects，找到匹配事件类型的 trigger，依次评估 cooldown → sourceMustBeWearer → condition → action。

#### 步骤 7: action 回调创建 buff Effect

buff Effect 携带 `dynamicBonuses`，通过 `addOrRefreshBuff` 或 `addStackWithIndependentDuration` 添加到目标 effects。

#### 步骤 8: DamageResolver 在下一次伤害时消费

通过各 zone 的 `aggregateZoneBonuses` / `aggregateDynamicBonuses` 查询活跃的 dynamicBonuses。

### 数据驱动程度

- `eff.value`（buff 数值）：**数据驱动**——从 talents.json 读取
- 触发事件类型、条件回调、buff 持续时间、叠层逻辑：**硬编码**
- 这意味着如果 WULFGARD 的天赋等级从 20% 升级到 30%，数据自动反映；但如果要改触发条件，需要改 simulator.ts 代码

---

## D. registerTriggeredBuff() 当前支持的能力

### 完整能力清单 [已从代码确认]

**文件**: `simulation/simulator.ts:134-197`

| 能力 | 状态 | 说明 |
|------|------|------|
| **refresh（刷新持续时间）** | ✅ 支持 | 无 stack 参数时走 `addOrRefreshBuff()`，同 ID 效果刷新 startTime |
| **stack（叠层）** | ✅ 支持 | 有 stack 参数时走 `addStackWithIndependentDuration()`，每层独立计时 |
| **independent duration** | ✅ 支持 | 每个 stack 实例有独立 ID (`${buffId}_${_buffCounter}`)，独立 startTime/duration |
| **condition callback** | ✅ 支持 | `opts.condition?: (e: any, ctx: any) => boolean`，可访问 event payload 和 SimulationContext |
| **target self** | ✅ 支持（默认） | `opts.target` 未指定或 `"self"` 时，buff 加到 actor.effects |
| **target enemy** | ✅ 支持 | `opts.target === "enemy"` 时，buff 加到 enemy.effects |
| **sourceMustBeWearer** | ⚠️ 硬编码 true | L156：`sourceMustBeWearer: true`。**不可配置**。当前所有 triggered buff 都只响应自身事件 |
| **ICD / cooldown** | ❌ 不支持 | EffectTrigger 接口支持 `cooldownId` + `cooldownDuration`，但 registerTriggeredBuff 不传递这两个字段 |
| **target team/otherTeammates** | ❌ 不支持 | opts.target 仅支持 "self" \| "enemy"。equipment/types.ts 有 `applyBuffToTargets` 支持 "team"/"otherTeammates"，但 registerTriggeredBuff 未使用 |
| **多 bonus** | ✅ 支持 | `opts.bonuses: DynamicBonus[]` 支持数组 |
| **zone 自定义** | ✅ 支持 | DynamicBonus 的 zone 字段可选，由 CHENQIANYU 样例验证（`zone: "attackPercent"`） |
| **buff 消费方式** | 自动 | buff 靠 EffectManager.sweepExpired() 在 advanceTime 时自动清理 |

### 扩展到 ICD 的难度评估 [推测]

TriggerProcessor 已原生支持 cooldown（L116-122, L161-163），只需在 registerTriggeredBuff 的 EffectTrigger 构建处增加可选的 `cooldownId` + `cooldownDuration` 参数即可。预估改动 ~5 行。

### 扩展到 team target 的难度评估 [推测]

`equipment/types.ts` 的 `applyBuffToTargets()` 已实现 "self" | "team" | "otherTeammates" 逻辑。registerTriggeredBuff 可复用此函数。预估改动 ~10 行。

---

## E. 哪些角色"只差一个通用分发层"，不需要新增 runtime 事件

### 结论：没有完全零成本就能接入的剩余角色 [已从代码确认 + 推测]

仔细对比每个干员的天赋描述与当前可用事件类型后，结论是**所有剩余 runtime_conditional 干员都需要至少一种"现有事件 + 条件增强"或"新事件类型"**。

但有几个可以用**现有事件 + 轻量条件 hack** 近似实现：

| 干员 | 天赋 | 描述要求 | 现有事件可否满足 | 说明 |
|------|------|----------|----------------|------|
| POGRANICHNK | 活着的旗帜 | 每恢复80点技力 → ATK% buff, 3层, 20s | ⚠️ **部分可用** | SP_CHANGE 事件存在，但需要 **condition 中维护累加器**（闭包状态），registerTriggeredBuff 当前不支持 ICD 且无累积器模板 |
| DAPAN | 勾芡 | 每消耗1层破防 → physical_dmg buff, 4层, 10s | ❌ 需新事件 | "消耗破防"发生在 PhysicalReactionResolver 内部（crush/slam/armorBreak 消耗 break stacks），当前不触发独立事件 |
| ENDMINISTRATOR | 本质瓦解 | 结晶消耗后 → ATK% buff, 15s | ❌ 需新事件 | "结晶消耗"是 ENDMINISTRATOR 独有机制，无对应事件 |
| EMBER | 以铁还铁 | 受到敌方伤害 → ATK% buff, 7s, 3层 | ❌ 需新事件 | 当前无 DAMAGE_TAKEN（受击）事件 |
| CATCHER | 全局思维 | 终结技最后一击产生冲击波(额外伤害) | ❌ 需新事件或机制 | 不是 buff，是额外伤害实例；数据中简化为 ATK% 但实际需要额外 DAMAGE_TICK |
| LIFENG | 伏魔 | 每次击倒 → 额外物理伤害 | ❌ 需新事件或机制 | 与 CATCHER 类似，是额外伤害实例而非 buff |
| ROSSI | 斫痕 | 技能命中后施加 debuff | ⚠️ **部分可用** | DAMAGE_TICK + skill type check 可触发，但需要 target="enemy" 的 debuff 施加（registerTriggeredBuff 支持 target=enemy） |
| ROSSI | 沸血 | 暴击命中被标记的敌人 → ATK% buff | ❌ 需暴击判定接入 | 需在 DAMAGE_TICK 后获知暴击结果，当前 DamageHandler 先算暴击再写 simLog，但 TriggerProcessor 在 DamageHandler **之后**运行时，暴击信息不在 event payload 里 |
| FLUORITE | 捉摸不定 | 20%概率格挡 → ATK% buff | ❌ 需新机制 | 需概率判定事件 |
| ALESH | 闪冻锁鲜 | 附近敌人冻结/结晶 → 终能, 3s ICD | ⚠️ **部分可用** | APPLY_DIRECT_ANOMALY + freeze check 可触发，但需 ICD（registerTriggeredBuff 当前不支持），且效果类型是 gauge_modifier 而非 damage_bonus/stat_bonus |
| AVYWENNA | 高效派送 | 雷枪命中 → 终能 | ❌ 需独立机制 | 雷枪是 compile-time prepass，不走 runtime 事件系统 |

### 真正"只差分发层 + 轻量扩展"的候选

| 干员 | 需要扩展 | 扩展内容 |
|------|---------|---------|
| **POGRANICHNK** | registerTriggeredBuff + ICD + 条件闭包累加器 | SP_CHANGE 事件可用；需 condition 中维护累加计数器(每80SP触发一次)；需 ICD 或等效机制 |
| **ROSSI talent_0** | registerTriggeredBuff + target=enemy | DAMAGE_TICK + skill check 可用；但效果是施加 enemy debuff 而非 self buff |
| **ALESH** | registerTriggeredBuff + ICD + gauge_modifier 支持 | APPLY_DIRECT_ANOMALY + freeze check 可用；需 ICD(3s)；效果是终能而非伤害 |

但这三个都不是"零成本只加分发层"——都需要对 registerTriggeredBuff 做小扩展。

---

## F. 需要新增 runtime 事件的角色，应留到下一轮

### 需要全新事件类型 [已从代码确认]

| 干员 | 天赋 | 需要的新事件 | 当前不存在的原因 |
|------|------|-------------|----------------|
| ENDMINISTRATOR | 本质瓦解 | `CRYSTAL_CONSUMED` 或 `ATTACHMENT_CONSUMED` | 结晶消耗是角色独有机制，PhysicalReactionResolver/MagicReactionResolver 内部发生但不触发独立事件 |
| DAPAN | 勾芡 | `BREAK_STACK_CONSUMED` 或 `PHYSICAL_ANOMALY_RESOLVED` (含消耗信息) | 破防消耗发生在 PhysicalReactionResolver 内部，当前只对外产出 ANOMALY_DAMAGE 事件 |
| EMBER | 以铁还铁 | `DAMAGE_TAKEN` / `ACTOR_DAMAGED` | 当前事件系统只跟踪出向伤害，无入向伤害事件（单 Boss 模型下 Actor 不受击） |

### 需要额外伤害实例机制（不是 buff）[推测/需验证]

| 干员 | 天赋 | 实际效果 | 数据中的简化 |
|------|------|----------|------------|
| LIFENG | 伏魔 | 击倒后额外造成物理伤害 | 简化为 ATK% buff |
| CATCHER | 全局思维 | 终结技最后一击冲击波(额外伤害实例) | 简化为 ATK% buff |

这两个在 talents.json 中被简化为 `stat_bonus + attack_percent`，但游戏内实际是额外伤害实例。如果用 buff 近似实现，数值语义会有偏差（buff 影响所有后续伤害 vs 额外伤害仅产生一次）。

### 需要概率机制 [已从代码确认]

| 干员 | 天赋 | 需要的机制 |
|------|------|-----------|
| FLUORITE | 捉摸不定 | 概率判定 + 伤害格挡（20%格挡法术伤害 → ATK buff） |

### 需要 gauge_modifier 支持 [已从代码确认]

| 干员 | 天赋 | 效果类型 |
|------|------|---------|
| AVYWENNA | 高效派送 | `gauge_modifier` / `ult_gauge_gain` (3-4 flat) |
| ALESH | 闪冻锁鲜 | `gauge_modifier` / `ult_gauge_gain` (3-4/6 flat, 3s ICD) |

registerTriggeredBuff 的 bonuses 目前只支持 DynamicBonus（走 multiplierZones），而 gauge_modifier 需要修改终结技能量，走的是完全不同的路径。

### 建议留到后续轮次的理由

以上所有项都需要**引擎层改动**（新事件类型 / 新 handler / 新资源修改路径），超出"中层连接层补口"的范畴。

---

## G. DamageHandler 中的 boundEffect 标签审计

### 完整标签清单 [已从代码确认]

**文件**: `simulation/events/DamageHandler.ts`

| 标签 | 阶段 | 角色 | 行号 | 触发条件 | 动作 | 数据源 |
|------|------|------|------|---------|------|--------|
| `estella_phys_vuln_if_frozen` | **PRE-damage** (L106-128) | ESTELLA | DamageHandler L106 | 敌人处于冻结 && 未碎冰 | 施加 PHYSICAL_VULNERABLE | ESTELLA skills.json ("物理脆弱倍率", "物理脆弱持续时间") |
| `consume_conduction` | **POST-damage** (L29-42) | ARCLIGHT | DamageHandler L29 | 敌人有导电状态 | 清除导电 (`status.conduction = null`) | 无外部数据 |
| `consume_corrosion_apply_vuln` | **POST-damage** (L45-97) | ARDELIA | DamageHandler L45 | 敌人有腐蚀状态 | 清除腐蚀 + 施加双脆弱 (PHYSICAL_VULNERABLE + SPELL_VULNERABLE) | ARDELIA skills.json ("脆弱效果", "脆弱持续时间（秒）") |

### 数据来源链路 [已从代码确认]

```
gamedata.json
  └ 各 action 的 damage_ticks[].boundEffects: string[]
    ↓
DataEditor.vue (可通过 UI 选择绑定效果)
    ↓
compileScenario → compileTimeline
    ↓ (原样传递 boundEffects 数组)
simulator.ts 入队 DAMAGE_TICK 事件 (payload 包含 tick.boundEffects)
    ↓
DamageHandler.handle()
  ├ L106: pre-damage 扫描 tick.boundEffects?.includes("estella_phys_vuln_if_frozen")
  ├ L157: DamageResolver.resolve()
  └ L162: post-damage 调用 processPostDamageEffects(tick.boundEffects, e, ctx)
```

### 注册表化可行性评估

| 标签 | 适合注册表化？ | 理由 |
|------|--------------|------|
| `consume_conduction` | ✅ 适合 | 最简单 case：无条件清除状态，无外部数据读取 |
| `consume_corrosion_apply_vuln` | ✅ 适合 | 模式标准化：consume(X) + apply([Y,Z]) + readSkillsJson(labels) |
| `estella_phys_vuln_if_frozen` | ✅ 适合 | 模式标准化：checkCondition(freeze) + apply(Y) + readSkillsJson(labels) |

三个标签都可以迁移到注册表（`Map<string, BoundEffectHandler>`），每个 handler 声明 phase ("pre"/"post") + process 函数。好处：
- 消除 DamageHandler.handle() 中的 if-else 嵌套
- 新增消耗效果时不用改 DamageHandler 主逻辑
- 可做编译期校验（boundEffect tag 必须在注册表中存在）

### 双真值源风险

boundEffect 标签字符串存在于：
1. `public/gamedata.json`（各 action 的 damageTicks）
2. `DamageHandler.ts`（硬编码处理逻辑）

如果 gamedata 中添加了一个新的 boundEffect 标签，但 DamageHandler 不认识 → **静默忽略**，无任何报错。

---

## H. 如果本轮只做最小补口，最合理的推进顺序

### 推荐顺序

#### 第 1 步: runtime_passive resistance_ignore 接入 [最高优先]

**改动范围**:
- `simulator.ts`: 在 L96-128 区域新增 `resistance_ignore` 处理分支（~15行）
- `multiplierZones.ts`: 在 `computeResistanceZone()` 中新增读取 actor effects 中 resistance_ignore bonus 的逻辑（~10行）

**为什么先做**:
- 改动极小
- 立即修复 LAEVATAIN 天赋"静默失效"的 bug
- DamageSummaryPanel 可直接观察到伤害变化（LAEVATAIN 的伤害会因抗性穿透而上升）

**前端可观察变化**: 在包含 LAEVATAIN 的排轴中，点击"伤害统计"后，LAEVATAIN 的伤害数值会升高（resistance zone 乘区值变大）。

#### 第 2 步: registerTriggeredBuff 增加 ICD 支持 [轻量扩展]

**改动范围**:
- `simulator.ts`: registerTriggeredBuff opts 增加 `cooldownId?: string; cooldownDuration?: number;`（~5行）
- 在 EffectTrigger 构建处传递 cooldownId/cooldownDuration

**为什么第二做**:
- TriggerProcessor 已原生支持 cooldown
- 只是 registerTriggeredBuff 没暴露接口
- 为 ALESH、POGRANICHNK 等需要 ICD 的角色打开口子

**前端可观察变化**: 无直接变化（仅增加能力，未接入新角色）

#### 第 3 步: boundEffect 注册表化 [结构改善]

**改动范围**:
- `DamageHandler.ts`: 提取 pre/post handler 到两个 Map，替代 if-else（~40行改写，行为不变）

**为什么第三做**:
- 不改变行为，纯结构改善
- 为后续新角色的消耗效果降低接入成本

**前端可观察变化**: 无。行为完全不变。

#### 第 4 步（可选）: runtime_conditional 通用分发层骨架

**改动范围**:
- `simulator.ts:199-250`: 将 WULFGARD / CHENQIANYU 的 if-else 迁移为模板化注册
- 定义 `ConditionalTemplate` 接口（event + condition factory + buff config）
- 保留 WULFGARD / CHENQIANYU 作为首批走通模板的样例

**为什么可选**:
- 当前只有 2 个角色，收益有限
- 但如果紧接着要做第 5 步（新角色），这一步是前置依赖

**前端可观察变化**: 无。WULFGARD / CHENQIANYU 行为不变。

---

## 额外审计发现

### 1. ENDMINISTRATOR talent_1 "现实静滞" 语义简化

**已从代码确认**：描述是"附着源石结晶的敌人受到的物理伤害+10%"（条件性），但当前实现为**无条件永久** fragility buff。

这意味着即使敌人身上没有结晶，ENDMINISTRATOR 的物理伤害也在享受这个加成。在多数实际排轴中偏差不大（ENDMINISTRATOR 技能会持续维持结晶），但在短排轴或结晶中断场景中会高估伤害。

标注 TODO，不在本轮修复。

### 2. CHENQIANYU 的 bonus zone 选择

**已从代码确认**：CHENQIANYU 的 conditional 效果是 `{ stat: "all_dmg", value: eff.value, zone: "attackPercent" }`。

注意 stat 是 `all_dmg` 但 zone 是 `attackPercent`。这意味着它不是走增伤区的 all_dmg bonus，而是走攻击力百分比区的加成。这与天赋数据中 `type: "stat_bonus", stat: "attack_percent"` 的语义一致。但数据层的 type/stat 和 runtime 层的 DynamicBonus stat/zone **使用了不同的字段名**：
- 数据层: `stat: "attack_percent"`
- Runtime 层: `{ stat: "all_dmg", zone: "attackPercent" }`

这是一个隐式映射，在通用分发层中需要显式处理。

### 3. _activeEffects 类型安全

**已从代码确认**：`(actor.stats as any)?._activeEffects` — 完全无类型保护。如果 timelineStore 的数据结构变化，simulator 不会编译报错。

---

## 建议下一步

### P1-A: 最适合先补的 runtime_passive type

**`resistance_ignore`**（LAEVATAIN 灼心天赋）

理由：
- 仅需 ~25 行改动（simulator.ts + multiplierZones.ts）
- 修复已知的"天赋静默失效" bug
- DamageSummaryPanel 有直接可观察的数值变化
- 不引入新的架构概念
- 不存在双真值源风险

### P1-B: 最适合先接的 1~2 个角色

**无真正零成本可接入的新角色。**

如果要选"投入最小、收益最大"的目标：

1. **POGRANICHNK**（活着的旗帜）——如果同时做了 ICD 扩展 + condition 闭包累加器，可用 SP_CHANGE 事件实现。但"累加器"需要在 condition 闭包中维护状态，属于 hack 而非正式模式。
2. **ROSSI talent_0**（斫痕）——DAMAGE_TICK + skill type check + target=enemy。模式与 CHENQIANYU 相似，但效果是 enemy debuff 而非 self buff。需要验证 "conditional ATK% debuff on enemy" 在伤害公式中的正确路径。

建议本轮**不强行接入新角色**，而是把精力用在 P1-A + registerTriggeredBuff ICD 扩展 + boundEffect 注册表化上，为下一轮批量接入打好基础。

### P1-C: 是否值得本轮一起做

| 项 | 是否值得一起做 | 理由 |
|---|---|---|
| resistance_ignore 接入 | ✅ **必做** | 最小改动，修复已知 bug |
| registerTriggeredBuff ICD 扩展 | ✅ **值得** | 改动 ~5 行，解锁 ALESH/POGRANICHNK 等角色的前置条件 |
| boundEffect 注册表化 | ⚠️ **视时间** | 纯结构改善，不改变行为；如果时间充裕一起做；否则留到下一轮 |
| runtime_conditional 通用分发层骨架 | ⚠️ **视时间** | 当前只有 2 个角色，收益有限；但如果紧接着要接新角色则是前置依赖 |
| 接入新角色 (POGRANICHNK/ROSSI) | ❌ **不建议本轮** | 都需要额外逻辑（累加器/enemy debuff），超出"最小补口"范畴 |

**本轮推荐的最小可交付物**：
1. ✅ resistance_ignore 接入（修 LAEVATAIN）
2. ✅ registerTriggeredBuff ICD 扩展
3. 如果时间允许：boundEffect 注册表化

这三项加起来改动量约 50-80 行代码，风险极低，且每一项都有明确的前后可验证标准。
