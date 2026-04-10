# T8 通用 Enemy Debuff 聚合路径审计

---

## 1. 已确认事实：各聚合 / zone 函数的读取源现状

### 聚合函数

| 函数 | 文件:行 | 读取源 | 服务乘区 | source/target |
|---|---|---|---|---|
| `aggregateDynamicBonuses` | `equipment/types.ts:218` | `state.getActor(sourceActorId).effects` | damageBonus | source-side |
| `aggregateZoneBonuses` | `equipment/types.ts:258` | `state.getActor(sourceActorId).effects` | amplify/combo/vulnerability/fragility | source-side |
| `aggregateAttackBonuses` | `equipment/types.ts:303` | `state.getActor(sourceActorId).effects` | attackPercent/attackFlat | source-side |

**三个聚合函数全部只读 actor.effects，不读 enemy.effects。**

### Zone 计算函数

| zone 函数 | 文件:行 | 读取源 | target-side 支持 |
|---|---|---|---|
| `computeDefenseZone` | `multiplierZones.ts:53` | `target.config.defenseMultiplier` | 是（固定值） |
| `computeCritZone` | `multiplierZones.ts:62` | `ctx.critResult` | N/A |
| `computeDamageBonusZone` | `multiplierZones.ts:84` | `source.stats` + `aggregateDynamicBonuses(actor)` | **否** — 纯 source-side |
| `computeAmplifyZone` | `multiplierZones.ts:156` | `aggregateZoneBonuses(actor, "amplify")` | **否** — 纯 source-side |
| `computeComboZone` | `multiplierZones.ts:174` | `aggregateZoneBonuses(actor, "combo")` | **否** — 纯 source-side |
| `computeVulnerabilityZone` | `multiplierZones.ts:194` | `target.status.conduction` + `target.effects.getByTag("PHYSICAL_VULNERABLE")` + `aggregateZoneBonuses(actor, "vulnerability")` | **部分** — conduction 和 physVuln 是 target-side；dynamicBonuses 的 vulnerability 仍只读 actor |
| `computeFragilityZone` | `multiplierZones.ts:253` | `aggregateZoneBonuses(actor, "fragility", tags)` | **否** — 纯 source-side |
| `computeResistanceZone` | `multiplierZones.ts:274` | `target.config` + `target.status.getCorrosionResistDown()` | 是（target-side） |
| `computeBreakZone` | `multiplierZones.ts:300` | `target.isBroken()` | 是（target-side） |

### 注意

`computeVulnerabilityZone` 的注释（line 227）写着 "Dynamic vulnerability from actor/**enemy** effects"，但实际代码只调用 `aggregateZoneBonuses(state, tags.sourceActorId, "vulnerability")` 读 actor effects。**注释与实际不一致。**

---

## 2. 已确认事实：通用 enemy debuff 当前不生效的根因

**根因**：`aggregateZoneBonuses` 的函数签名决定了它只能读一个 actor 的 effects：

```typescript
function aggregateZoneBonuses(state, sourceActorId, zone, tags?) {
  actorState = state.getActor(sourceActorId);  // ← 只读 actor
  for (instance of actorState.effects.getAll()) { ... }
}
```

没有任何代码路径会对 `state.enemy.effects` 执行 dynamicBonuses 聚合。

**为什么 PHYSICAL_VULNERABLE 能工作**：它绕开了 aggregateZoneBonuses，直接在 `computeVulnerabilityZone` 中用 `target.effects.getByTag("PHYSICAL_VULNERABLE")` 读 tag+property。这是硬编码特例，不经过通用聚合。

**为什么 conduction/corrosion 能工作**：它们不在 EffectManager 中，在 EnemyStatusState 中有专用字段，zone 函数直接读 `target.status.*`。

**写入路径和消费路径的断裂**：

```
registerTriggeredBuff(target: "enemy") → enemy.effects.add(Effect with dynamicBonuses)
  ✅ 写入成功

computeFragilityZone / computeVulnerabilityZone → aggregateZoneBonuses(state, sourceActorId, ...)
  → state.getActor(sourceActorId).effects.getAll()
  ❌ 只读 actor.effects，不读 enemy.effects → 永远看不到 enemy 上的 dynamicBonuses
```

---

## 3. 哪些乘区最适合率先支持通用 enemy debuff

### 语义判断

| 乘区 | 是否天然适合 target-side | 理由 |
|---|---|---|
| **fragility（脆弱区）** | **是** | "目标受到某类伤害增加" — 天然 target-side 语义 |
| **vulnerability（易伤区）** | **是** | "目标易伤" — 天然 target-side 语义 |
| damageBonus（增伤区） | 否 | "自身造成伤害增加" — source-side 语义 |
| amplify（增幅区） | 否 | "自身法术增幅" — source-side 语义 |
| combo（连击区） | 否 | "连击加成" — source-side 语义 |
| attackPercent/Flat | 否 | "攻击力加成" — source-side 语义 |

### 实施难度判断

| 乘区 | 缺什么 | 补口难度 | 与现有逻辑冲突风险 |
|---|---|---|---|
| **fragility** | `computeFragilityZone` 需增加一行读 enemy.effects | **极低** — 加一行调用 | **无** — source-side 和 target-side fragility 相加，语义正确 |
| **vulnerability** | `computeVulnerabilityZone` 已有注释说读 enemy effects 但没做 | **极低** — 加一行调用 | **无** — 已有 conduction + physVuln 特例，通用 dynamicBonuses 只是补齐缺失的通道 |

### 推荐顺序

**P0：fragility** — 最小改动，已有 T3 runtime_passive 在 source-side 验证过此 zone，补 target-side 只需镜像一行。

---

## 4. 推荐的最小改动方案

### 做什么

新增一个小函数 `aggregateEnemyZoneBonuses`，镜像现有 `aggregateZoneBonuses`，但读 `state.enemy.effects` 而非 actor.effects。

然后在 `computeFragilityZone` 和 `computeVulnerabilityZone` 各加一行调用。

### 新增函数（约 20 行）

在 `equipment/types.ts` 中新增：

```
aggregateEnemyZoneBonuses(state, zone, tags?):
  遍历 state.enemy.effects.getAll()
  过滤 isEffectActive
  过滤 db.zone === zone
  fragility zone 时走 evaluateDynamicBonus（带 damage type 匹配）
  其它 zone 直接加 value
```

签名与 `aggregateZoneBonuses` 类似，但不需要 sourceActorId（因为读的是 enemy，只有一个）。

### 调用点（各 1 行）

**`computeFragilityZone`**（multiplierZones.ts:253-261）：
```
现有: bonus = aggregateZoneBonuses(state, sourceActorId, "fragility", tags)
新增: bonus += aggregateEnemyZoneBonuses(state, "fragility", tags)
```

**`computeVulnerabilityZone`**（multiplierZones.ts:228-232）：
```
现有: bonus += aggregateZoneBonuses(state, sourceActorId, "vulnerability")
新增: bonus += aggregateEnemyZoneBonuses(state, "vulnerability")
```

### 涉及文件

| 文件 | 改什么 |
|---|---|
| `equipment/types.ts` | 新增 `aggregateEnemyZoneBonuses` 函数（~20 行） |
| `multiplierZones.ts` | `computeFragilityZone` 加 1 行, `computeVulnerabilityZone` 加 1 行 |

共 2 个文件，约 22 行新增代码。

### 不改什么

- 不改 `aggregateZoneBonuses` 原函数
- 不改 `aggregateDynamicBonuses`
- 不改 `aggregateAttackBonuses`
- 不改 source-side 任何乘区
- 不改 EnemyStatusState
- 不改 EffectManager
- 不改 simulator.ts

---

## 5. 推荐的首个验证样例

### GILBERTA 终结技 `spell_vulnerable`

| 项 | 值 |
|---|---|
| 角色 | GILBERTA |
| 技能 | 终结技 |
| effect type (gamedata) | `"spell_vulnerable"` |
| stacks | 1 |
| duration (gamedata) | 5s |
| 语义 | 目标受到法术伤害增加 |
| 对应 zone | fragility（用 `stat: "arts_dmg"` → `evaluateDynamicBonus` 匹配 `damageSchool === "magic"`） |

### 为什么适合做首个验证

1. 消费路径打通后自动生效（`computeFragilityZone` → `aggregateEnemyZoneBonuses("fragility", tags)` → `evaluateDynamicBonus` 匹配法术）
2. 不需要新 tag/property 特例机制
3. 验证容易：放 GILBERTA 终结技后看法术伤害增加，物理伤害不增加
4. 与 `physical_vulnerable` 特例互不干扰（后者走 tag 机制在 vulnerability zone，前者走 dynamicBonuses 在 fragility zone）

### 实施路径

在打通通用聚合后，只需在 simulator.ts 的 effect routing loop 中加一条 `spell_vulnerable` 路由：
- 创建 Effect on enemy.effects
- `dynamicBonuses: [{ stat: "arts_dmg", value: X, zone: "fragility" }]`
- duration 从 gamedata 读取
- 值可暂用与 physical_vulnerable 同公式（`(stacks+2)*4*artsPowerDebuffMult(ap)`）

---

## 6. 风险与不建议做的事

| 风险 | 评估 |
|---|---|
| source-side 和 target-side 重复计入 | **不会** — source-side 读 `actor.effects`，target-side 读 `enemy.effects`，两个 EffectManager 是独立实例，同一个 Effect 不可能同时在两者中 |
| 与 PHYSICAL_VULNERABLE 特例冲突 | **不会** — physVuln 走 tag 机制在 vulnerability zone，通用 dynamicBonuses 走聚合函数，两者相加，语义正确 |
| 误伤 self buff 聚合 | **不会** — 新函数只读 `state.enemy.effects`，不碰 actor.effects |
| damageBonus/amplify/combo 被误加 target-side 读取 | **不会** — 只对 fragility 和 vulnerability 调用新函数 |

| 不建议做 | 理由 |
|---|---|
| 给全部 7 个 zone 都加 enemy-side 读取 | damageBonus/amplify/combo/attackPercent/attackFlat 是 source-side 语义，不应读 enemy |
| 修改 `aggregateZoneBonuses` 函数签名 | 影响所有现有调用者，不如新增独立函数 |
| 为此新建 debuff registry | 过度设计 |
| 把所有 debuff 统一成 dynamicBonuses | 有些 debuff（conduction/corrosion）天然不适合 dynamicBonuses |

---

## 7. 最小改动实施方案（仅方案，不实施）

### 第一步：补通聚合路径

| 文件 | 改什么 |
|---|---|
| `equipment/types.ts` | 新增 `aggregateEnemyZoneBonuses(state, zone, tags?)` 函数 |
| `multiplierZones.ts` | `computeFragilityZone` 加 1 行, `computeVulnerabilityZone` 加 1 行 |

### 第二步：路由 spell_vulnerable

| 文件 | 改什么 |
|---|---|
| `simulator.ts` | effect routing loop 加 `spell_vulnerable` 分支，创建 enemy debuff Effect |

### 验证方法

1. 放 GILBERTA 终结技 → 后续 5s 内法术伤害增加
2. 物理伤害不受影响
3. 已有 physical_vulnerable / conduction / corrosion 行为不变
4. 已有 self buff（WULFGARD / CHENQIANYU / runtime_passive fragility）不变
