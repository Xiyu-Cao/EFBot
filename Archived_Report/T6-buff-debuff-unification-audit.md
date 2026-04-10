# T6 常见 Buff / Debuff 结构统一审计

---

## 1. 已确认事实：anomaly status 现状

### 存储位置

`src/simulation/anomaly/EnemyStatusState.ts` — 独立于 EffectManager 的结构化状态。

### 四种 anomaly 的字段对比

| 字段 | Burn | Freeze | Conduction | Corrosion |
|---|---|---|---|---|
| `level` | AnomalyLevel (1-4) | AnomalyLevel (1-4) | AnomalyLevel (1-4) | AnomalyLevel (1-4) |
| `expiresAt` | `time + 10` (固定) | `time + FREEZE_DURATION_BY_LEVEL[level]` (6/7/8/9) | `time + CONDUCTION_DURATION_BY_LEVEL[level]` (12/18/24/30) | `time + 15` (固定) |
| `sourceActorId` | 有 | 有 | 有 | 有 |
| `lastTickTime` | **有**（DOT tick 去重） | 无 | 无 | 无 |
| `shattered` | 无 | **有**（碎冰状态标记） | 无 | 无 |
| `currentResistDown` | 无 | 无 | 无 | **有**（累积减抗值） |
| `perSecondDelta` | 无 | 无 | 无 | **有**（每秒减抗速率） |
| `maxResistDown` | 无 | 无 | 无 | **有**（减抗上限） |

### 持续时间表示

统一用 `expiresAt`（绝对游戏时间）。没有 `duration` / `remainingDuration` / `appliedAt` 字段。

### 持续时间覆盖机制

**不存在。** 所有 `apply*()` 方法使用硬编码常量，不接受外部 duration 参数。gamedata 中的 `duration` 字段（如 PERLICA conductive 的 8.75）当前被忽略。

### 重施加行为

全部为"直接覆盖"（低等级可覆盖高等级）。腐蚀特殊：重施加时保留已累积的 `currentResistDown`，只增不减 `maxResistDown`。

### 写入者、读取者、结算者

| 步骤 | 文件 | 方法 |
|---|---|---|
| **写入** | `EnemyStatusState.ts` | `applyBurn/Freeze/Conduction/Corrosion()` |
| **触发** | `anomaly/AnomalyHandlers.ts` | `ApplyDirectAnomalyHandler.handle()` → `applyDirectAnomaly()` |
| **时间推进** | `EnemyStatusState.ts` | `advanceTime()` — 过期清理；`advanceCorrosion()` — 腐蚀每秒累积 |
| **燃烧 tick** | `AnomalyHandlers.ts:327-341` | `advanceBurn()` 返回 tick 数，读取当前 `status.burn.sourceActorId` + `level` |
| **导电消费** | `multiplierZones.ts:200-214` | 读 `target.status.conduction`，用 `sourceActorId` 获取施加者 artsPower |
| **腐蚀消费** | `multiplierZones.ts:284` | 读 `target.status.getCorrosionResistDown()` |
| **冻结/碎冰** | `PhysicalReactionResolver.ts` | 读 `freeze.level` + `sourceActorId` |

**关键**：燃烧 tick 时 `sourceActorId` 是从当前 burn state 动态读取的（不是施加时快照）。如果 burn 被其他角色重施加覆盖了 sourceActorId，后续 tick 伤害归属会变。

---

## 2. 已确认事实：通用 buff/debuff 现状

### 存储位置

`actor.effects`（EffectManager）— 每个 actor 和 enemy 各自一个。

### Effect 实际被消费的字段

| 字段 | 被谁消费 | 如何消费 |
|---|---|---|
| `id` | `EffectManager.add()`, `addOrRefreshBuff()` | 同 ID 判定叠加/刷新 |
| `tags` | `EffectManager.getByTag()` | 物理易伤特例：`PHYSICAL_VULNERABLE` tag → 读 `physVulnPercent` |
| `duration` | `sweepExpired()`, `isEffectActive()` | 到期自动清理 + 伤害时过滤 |
| `startTime` | 同上 | `startTime + duration` = 到期时间 |
| `maxStacks` | `EffectManager.add()` | 同 ID 叠加上限 |
| `stackStrategy` | `handleStacking()` | **只有 `REFRESH_DURATION` 生效**；`INDEPENDENT` 和 `ADD_DURATION` 未实现 |
| `currentStacks` | `handleStacking()` | 叠层计数（仅 EffectManager 内部叠加用） |
| `properties.dynamicBonuses` | `aggregateDynamicBonuses/ZoneBonuses/AttackBonuses()` | **核心消费路径** |
| `properties.stackGroup` | `addStackWithIndependentDuration()` | 独立持续时间叠层分组 |
| `properties.physVulnPercent` | `computeVulnerabilityZone()` | 物理易伤百分比 |
| `triggers` | `TriggerProcessor` | 事件驱动触发 |

**未被消费的字段**：`name`、`description`、`type` — 仅存在于 snapshot 中，运行时不读取。

### 7 个乘区的消费路径

| 乘区 | zone 值 | 聚合函数 | 是否检查 stat 匹配 |
|---|---|---|---|
| 增伤区 | `"damageBonus"` 或无 | `aggregateDynamicBonuses()` | 是（evaluateDynamicBonus） |
| 增幅区 | `"amplify"` | `aggregateZoneBonuses()` | 否（直接加值） |
| 连击区 | `"combo"` | `aggregateZoneBonuses()` | 否 |
| 易伤区 | `"vulnerability"` | `aggregateZoneBonuses()` | 否 |
| 脆弱区 | `"fragility"` | `aggregateZoneBonuses(tags)` | 是（evaluateDynamicBonus） |
| 攻击力% | `"attackPercent"` | `aggregateAttackBonuses()` | 否（只看 zone） |
| 攻击力固定 | `"attackFlat"` | `aggregateAttackBonuses()` | 否 |

### 叠加/刷新模式

| 模式 | 实现方式 | 文件 | 状态 |
|---|---|---|---|
| 不叠加，刷新持续时间 | `addOrRefreshBuff()` | `equipment/types.ts:139` | **生产就绪** |
| 独立持续时间叠层 | `addStackWithIndependentDuration()` | `equipment/types.ts:167` | **生产就绪** |
| EffectManager 同 ID 叠加 + REFRESH_DURATION | `EffectManager.handleStacking()` | `state/EffectManager.ts` | **可用但较少使用** |
| 同名覆盖（直接替换） | `addOrRefreshBuff()` 覆盖 properties | 同上 | 等效于不叠加刷新 |
| 最大值覆盖 | **不存在** | — | 未实现 |
| ADD_DURATION | `EffectManager.handleStacking()` | `state/EffectManager.ts` | **声明存在但无实际效果（bug）** |

---

## 3. 三类边界判断

### A. Anomaly Status — 不应硬统一到 Effect/dynamicBonuses

| 特征 | 原因 |
|---|---|
| 自带 tick 逻辑 | 燃烧每秒 DOT、腐蚀每秒累积减抗 — 需要 `advanceTime()` 中主动推进 |
| 每种异常字段不同 | 燃烧有 `lastTickTime`，冻结有 `shattered`，腐蚀有 `currentResistDown/perSecondDelta/maxResistDown` — 无法用统一 struct 覆盖 |
| 消费路径专用 | 导电由 `computeVulnerabilityZone` 读、腐蚀由 `computeResistanceZone` 读 — 不走 dynamicBonuses 聚合 |
| 重施加语义特殊 | 腐蚀保留已累积值、燃烧直接覆盖 — 不是简单的 refresh/stack |
| level 驱动公式 | anomaly level 参与 debuff 公式（artsPowerDebuffMult），不是简单的 `value: N` |

**结论**：anomaly 的内部 payload 必须保持专用结构。尝试把 burn/freeze/conduction/corrosion 压成统一 `{ stat, value, zone }` 会丢失 tick 逻辑和特殊字段。

### B. Timed Modifier / Buff / Debuff — 已有统一主路径，可继续扩展

当前 `Effect` + `dynamicBonuses` + 7 个 zone 的组合已覆盖大多数场景：

| 场景 | 可用 | 走什么路径 |
|---|---|---|
| self ATK% buff 10s | 是 | `dynamicBonuses: [{ zone: "attackPercent", value }]` |
| self damage_bonus buff 10s | 是 | `dynamicBonuses: [{ stat: "blaze_dmg", value }]` |
| target fragility debuff | 是 | `dynamicBonuses: [{ zone: "fragility", stat, value }]` |
| target vulnerability debuff | 是 | `dynamicBonuses: [{ zone: "vulnerability", value }]` |
| 不叠加刷新 | 是 | `addOrRefreshBuff()` |
| 独立持续时间叠层 | 是 | `addStackWithIndependentDuration()` |
| amplify / combo | 是 | `dynamicBonuses: [{ zone: "amplify"/"combo", value }]` |

**结论**：通用 timed modifier 已有足够的表达能力，不需要重新设计。缺的只是更多 trigger 类型和对应注册逻辑。

### C. 特殊资源 / 特殊状态 — 不应塞进 anomaly 或 modifier

| 示例 | 原因 |
|---|---|
| 管理员源石结晶 | 资源计数器，不是 buff/debuff；消耗时触发其他效果 |
| 波格拉尼克士气激昂 | SP 累计阈值触发，不是事件驱动 buff |
| AVYWENNA 雷枪 | 实体对象（有位置、存活时间、召回机制），不是简单数值 buff |

**结论**：这些需要独立的状态追踪机制（自定义 actor state 扩展或 per-actor 资源计数器）。强行塞进 anomaly 或 modifier 会导致语义混乱。

---

## 4. 推荐建模方案

### 设计原则

不引入统一 envelope 层。原因：当前两个系统（EnemyStatusState 和 Effect/dynamicBonuses）各自的消费路径完全不同，硬加一层抽象会导致两端都需要 adapter，增加复杂度而不减少。

**推荐维持双轨制：**

```
Track 1: EnemyStatusState (anomaly)
  → 独立结构化状态
  → 专用 advance/tick 逻辑
  → 专用消费路径（multiplierZones 中的 conduction/corrosion 读取）

Track 2: Effect + dynamicBonuses (modifier)
  → EffectManager 存储
  → 统一聚合路径（aggregateDynamicBonuses/ZoneBonuses/AttackBonuses）
  → 统一过期管理（sweepExpired）
```

### 需要补齐的是"注册层"而非"存储层"

当前缺口不在数据结构，在于**注册逻辑**：哪些天赋/效果应该注册为 Track 1 的 anomaly 事件，哪些应该注册为 Track 2 的 timed Effect。

### 具体示例如何落到结构上

**狼卫终结技：施加 1 级燃烧，持续 10 秒**
```
Track 1 (anomaly):
  simulator.ts → enqueue APPLY_DIRECT_ANOMALY
  → ApplyDirectAnomalyHandler → EnemyStatusState.applyBurn(1, actorId, time)
  → burn state: { level: 1, expiresAt: time+10, lastTickTime: time, sourceActorId }
  [已实现 — T5 DIRECT_ANOMALY_MAP]
```

**佩丽卡连携：施加 1 级导电**
```
Track 1 (anomaly):
  simulator.ts → enqueue APPLY_DIRECT_ANOMALY
  → applyConduction(1, actorId, time)
  → conduction state: { level: 1, expiresAt: time+12, sourceActorId }
  持续时间当前用 CONDUCTION_DURATION_BY_LEVEL[1]=12，gamedata 的 8.75 被忽略
  [已实现 — T5 DIRECT_ANOMALY_MAP]
```

**艾尔黛拉连携：施加 1 级腐蚀**
```
Track 1 (anomaly):
  同上路径 → applyCorrosion(1, actorId, time)
  → corrosion state: { level: 1, expiresAt: time+15, currentResistDown: 0, ... }
  [已实现 — T5 DIRECT_ANOMALY_MAP]
```

**塞希终结技：施加自然/寒冷增幅 12s，带智识修正**
```
Track 2 (modifier):
  simulator.ts → 注册 EffectTrigger on actor
  → trigger 监听 ACTION_START (ultimate)
  → action: addOrRefreshBuff → Effect with dynamicBonuses:
    [{ stat: "nature_dmg", value: computed(artsPower), zone: "damageBonus" },
     { stat: "cold_dmg",   value: computed(artsPower), zone: "damageBonus" }]
  → duration: 12
  [未实现 — 需要 runtime_conditional 扩展]
```

**管理员源石结晶**
```
不塞进 Track 1 或 Track 2。
独立方案：在 simulator.ts 或独立 state 扩展中追踪结晶计数。
结晶消耗事件 → 触发 Track 2 的 timed Effect（ATK% buff）。
[未实现 — 需要角色专属资源追踪]
```

### 关于 anomaly duration override

当前所有 anomaly 持续时间为硬编码常量。gamedata 中某些技能携带的 `duration` 字段（如 PERLICA conductive 的 8.75）被忽略。

**推荐**：短期不改。原因：
1. 当前 4 种 anomaly 的持续时间由系统公式决定（level → duration lookup），不是技能自定义
2. gamedata 中的 `duration` 字段可能是 UI 描述用（"短暂的导电"），不一定是精确的 gameplay duration
3. 如果后续确认某些技能确实需要覆盖 anomaly 持续时间，只需给 `apply*()` 加一个 optional `durationOverride` 参数

---

## 5. 风险与不建议做的事

| 不建议做 | 原因 |
|---|---|
| 给 anomaly 加通用 envelope 层 | 4 种 anomaly 各自字段不同，envelope 层要么太松（无类型安全）要么太紧（限制扩展） |
| 把 anomaly 状态迁移到 EffectManager | EffectManager 没有 tick 逻辑、没有累积逻辑、sweepExpired 的过期语义与腐蚀累积不兼容 |
| 统一所有 buff/debuff 成一个 class | Effect class 已经是通用 modifier 的表达层；anomaly 不是 modifier |
| 给 Effect 加 anomaly 专属字段 | 污染通用类，导致所有 Effect 消费者都要感知 anomaly 语义 |
| 新建全局 BuffRegistry | 引入新真值源，与 _activeEffects / effects[] / EffectManager 三者平行 |
| 现在就修 ADD_DURATION stackStrategy | 当前无消费者，修了也没人用 |

---

## 6. 最小改动实施方案（仅方案，不实施）

### 第一步优先做什么

**扩展 runtime_conditional 注册逻辑**（simulator.ts），不动存储层。

理由：
- 存储层（EnemyStatusState + EffectManager + dynamicBonuses）已经足够
- 缺的是"把天赋条件效果转换为 EffectTrigger 并注册"的注册逻辑
- 这完全在 simulator.ts 的 setup 阶段完成，不需要新文件

### 更稳的做法

**先补注册层，不动定义层也不动 runtime 存储层。**

注册层 = simulator.ts 中的 "读 _activeEffects → 根据 actorId 和 effect type 创建 EffectTrigger → 注册到 actor"

这与武器被动完全同模式，已验证可行（T5 P0 的 WULFGARD/CHENQIANYU 已证明）。

### 最不容易引入新真值源

按当前模式继续：
- 数值从 `_activeEffects`（来自 talents.json effects[]）读取
- 触发逻辑在代码中实现（每个天赋一段注册逻辑）
- 不新建 JSON 配置 / registry / adapter 文件

当支持的天赋达到 5+ 个时，再考虑抽出独立 `talentConditionalAdapter.ts` 文件。

### P0 建议（第一批 2 个）

已完成（T5）：
1. WULFGARD 灼热獠牙 — on_burn_apply → self blaze_dmg, 10s, no stack
2. CHENQIANYU 斩锋 — on_skill_hit → self ATK%, 10s, max 5 stacks

### P1 建议（接下来最值得做的 2-3 个）

| 天赋 | 触发 | 效果 | 需要什么 |
|---|---|---|---|
| ENDMINISTRATOR 本质瓦解 | 源石结晶消耗 | self ATK%, 15s | 需要结晶消耗事件（最小实现：在管理员技能释放时假设结晶被消耗） |
| DAPAN 勾芡 | 消耗破防层 | self physical_dmg%, 10s, max 4 stacks | 需要跟踪 PHYSICAL_VULNERABLE 被消耗 |
| EMBER 以铁还铁 | 受到伤害 | self ATK%, 7s, max 3 stacks | 需要 "actor takes damage" 事件（当前不存在） |

### 关于 anomaly duration override

如果后续确认需要：
- 给 `EnemyStatusState.applyConduction()` 等方法加 optional `durationOverride?: number` 参数
- 在 simulator.ts 的 DIRECT_ANOMALY_MAP 路由中，读 `resolvedEffect.node.duration`，非零时传入
- 改动极小（每个 apply 方法加 1 行），不影响现有调用者

---

## 结论

**推荐维持双轨制，扩展注册层。**

理由：
- anomaly 和 modifier 的消费路径完全不同（anomaly 走 EnemyStatusState 专用读取，modifier 走 dynamicBonuses 聚合）
- 强行统一成一个 "通用 buff 对象" 需要在两端都加 adapter，复杂度增加而非减少
- 当前缺口是"注册逻辑"（把天赋条件效果转为 EffectTrigger），不是"存储结构"
- 按武器被动模式继续扩展注册逻辑，是改动最小、风险最低、最不容易引入新真值源的路径
