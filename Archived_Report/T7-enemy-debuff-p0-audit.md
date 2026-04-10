# T7 Enemy Debuff P0 样例筛选与接入点审计

---

## 1. 已确认事实：`target: "enemy"` 路径支持现状

### registerTriggeredBuff 的 enemy 分支

**确认**：`simulator.ts:159` 已实现 enemy 分支：
```typescript
const targetEffects = opts.target === "enemy"
  ? ctx.state.enemy.effects
  : ctx.state.getActor(actorId).effects;
```

当 `target: "enemy"` 时，buff Effect 被写入 `ctx.state.enemy.effects`（EnemyState 的 EffectManager）。

### 关键断点：dynamicBonuses 放在 enemy.effects 上不会被消费

**确认**：三个聚合函数全部只读 actor.effects：

| 函数 | 文件:行 | 读取源 |
|---|---|---|
| `aggregateDynamicBonuses` | `equipment/types.ts:228` | `state.getActor(sourceActorId).effects` |
| `aggregateZoneBonuses` | `equipment/types.ts:269` | `state.getActor(sourceActorId).effects` |
| `aggregateAttackBonuses` | `equipment/types.ts:313` | `state.getActor(sourceActorId).effects` |

**结论**：如果用 `registerTriggeredBuff({ target: "enemy", bonuses: [...] })`，dynamicBonuses 被写入 enemy.effects，但伤害公式**完全不读**。这意味着 `target: "enemy"` + dynamicBonuses 当前是一条**断路**。

### 例外：PHYSICAL_VULNERABLE 标签机制

**确认**：`multiplierZones.ts:219` 有唯一的 enemy.effects 消费路径：

```typescript
if (tags.damageSchool === "physical") {
  for (const inst of target.effects.getByTag("PHYSICAL_VULNERABLE")) {
    const pct = inst.effect.properties.physVulnPercent;
    if (typeof pct === "number" && pct > 0) {
      bonus += pct;
    }
  }
}
```

这是 tag + properties 机制，不是 dynamicBonuses。它被 `computeVulnerabilityZone` 消费，进入易伤乘区。

### 路径现状汇总

| 路径 | 写入 | 消费 | 状态 |
|---|---|---|---|
| `target: "self"` + dynamicBonuses → actor.effects | ✅ | ✅ aggregate* 读取 | **已通** |
| `target: "enemy"` + dynamicBonuses → enemy.effects | ✅ 写入 | ❌ aggregate* 不读 | **断路** |
| `target: "enemy"` + PHYSICAL_VULNERABLE tag → enemy.effects | ✅ 写入 | ✅ getByTag 读取 | **已通**（特例） |
| anomaly status → EnemyStatusState | ✅ | ✅ 专用消费 | **已通** |

---

## 2. 候选样例列表

### 候选 A：ESTELLA 连携技 — physical_vulnerable

| 项 | 值 |
|---|---|
| 角色/技能 | ESTELLA 连携技 |
| effect type (gamedata) | `"physical_vulnerable"` |
| debuff 类型 | 物理易伤（对目标施加物理易伤，增加其受到的物理伤害） |
| 目标 | enemy (boss) |
| stacks | 1 |
| duration | 6s（gamedata 明确标注） |
| 叠层/刷新 | 不叠层，刷新覆盖（与破甲易伤同行为） |
| 对应乘区 | vulnerability zone（物理易伤） |
| 触发事件 | 技能 effect 施放（effect routing loop，非 trigger） |
| 消费路径 | `computeVulnerabilityZone` → `target.effects.getByTag("PHYSICAL_VULNERABLE")` → `physVulnPercent` |
| physVulnPercent 计算 | `calcBreachPhysVulnerability(stacks=1, artsPower)` → `(1+2)*4*artsPowerDebuffMult(ap)` |
| **为什么适合 P0** | **消费路径完全现成**（PHYSICAL_VULNERABLE tag → computeVulnerabilityZone）。只需把 `"physical_vulnerable"` 接到已有机制上。 |

### 候选 B：LIFENG 战技 — physical_vulnerable

| 项 | 值 |
|---|---|
| 角色/技能 | LIFENG 战技 |
| effect type | `"physical_vulnerable"` |
| duration | 10s |
| stacks | 1 |
| 其余 | 与 ESTELLA 完全同机制 |
| **为什么适合 P0** | 同 A，持续时间更长更容易观察 |

### 候选 C：GILBERTA 终结技 — spell_vulnerable

| 项 | 值 |
|---|---|
| 角色/技能 | GILBERTA 终结技 |
| effect type | `"spell_vulnerable"` |
| duration | 5s |
| stacks | 1 |
| 对应乘区 | vulnerability zone（法术易伤） |
| 消费路径 | **不存在** — 当前 `computeVulnerabilityZone` 没有读取 SPELL_VULNERABLE 的逻辑 |
| **为什么不适合 P0** | 需要新增消费路径（在 multiplierZones.ts 中新增 spell vulnerable 读取），改动面更大 |

---

## 3. Enemy debuff 的真实消费位置

### 已有消费路径

| debuff 类型 | 消费函数 | 文件:行 | zone | 读取源 |
|---|---|---|---|---|
| PHYSICAL_VULNERABLE (physVulnPercent) | `computeVulnerabilityZone` | `multiplierZones.ts:218-225` | vulnerability | `target.effects.getByTag("PHYSICAL_VULNERABLE")` |
| conduction (导电) | `computeVulnerabilityZone` | `multiplierZones.ts:200-214` | vulnerability | `target.status.conduction` |
| corrosion (腐蚀) | `computeResistanceZone` | `multiplierZones.ts:284` | resistance | `target.status.getCorrosionResistDown()` |
| break (失衡) | `computeBreakZone` | `multiplierZones.ts:301-302` | break | `target.isBroken()` |

### 不存在的消费路径

| debuff 类型 | 需要什么 |
|---|---|
| spell_vulnerable (法术易伤) | 需在 `computeVulnerabilityZone` 中新增法术侧读取 |
| 通用 dynamicBonuses on enemy.effects | 需在 aggregate* 函数中新增 enemy.effects 读取 |

---

## 4. 最推荐的 P0 样例

**首选：ESTELLA 连携技 `physical_vulnerable`**

理由：
1. **消费路径完全现成** — `PHYSICAL_VULNERABLE` tag + `physVulnPercent` 属性已被 `computeVulnerabilityZone` 消费
2. **创建机制已有参考** — `AnomalyHandlers.ts:226-248` 的 `PHYSICAL_VULN_APPLIED` outcome 已实现完全相同的 Effect 创建
3. **不需要改伤害公式** — 不需要改 multiplierZones.ts
4. **不需要改聚合函数** — 不需要改 aggregate*
5. **只需要在 simulator.ts 的 effect routing loop 中加一条路由** — 把 `"physical_vulnerable"` 映射为创建 PHYSICAL_VULNERABLE-tagged Effect
6. **duration 已有 gamedata 数据** — 6s，清晰明确
7. **physVulnPercent 可用现有公式计算** — `calcBreachPhysVulnerability(stacks, artsPower)`
8. **验证容易** — 放 ESTELLA 连携后看后续物理伤害是否增加

**LIFENG 物理易伤同理可顺带支持**（同 effect type，只差 duration）。

**注意**：这个 P0 走的是 effect routing loop（技能施放时直接创建 debuff），不是 `registerTriggeredBuff` 的 `target: "enemy"` 分支。但这是最小路径——因为 registerTriggeredBuff 的 enemy dynamicBonuses 路径需要先修聚合函数。

---

## 5. 风险与不建议做的事

| 不建议做 | 原因 |
|---|---|
| 直接用 registerTriggeredBuff target:"enemy" + dynamicBonuses | 聚合函数不读 enemy.effects 的 dynamicBonuses，需要先补这条路 |
| 先做 spell_vulnerable | 没有现成消费路径，需要在 multiplierZones 中新增法术易伤读取 |
| 把 physVulnPercent 硬编码 | 应使用 `calcBreachPhysVulnerability` 现有公式，保持与破甲易伤同真值源 |
| 为此新建 debuffRegistry 或 adapter | 过度设计，只需在 effect routing loop 中加一条路由 |

---

## 6. 最小改动实施方案（仅方案，不实施）

### 做什么

在 simulator.ts 的 effect routing loop 中，新增 `physical_vulnerable` 路由。当技能 effect type 为 `"physical_vulnerable"` 时：

1. 读取 effect 的 `stacks`（默认 1）和 `duration`
2. 读取施加者的 `originium_arts_power`
3. 用 `calcBreachPhysVulnerability(stacks, artsPower)` 计算 `physVulnPercent` 和默认 `duration`
4. 创建 PHYSICAL_VULNERABLE-tagged Effect on `enemy.effects`
5. 使用 `addOrRefreshBuff` 注册（不叠加，覆盖刷新）

### 预计改动文件

| 文件 | 改什么 |
|---|---|
| `simulator.ts` | effect routing loop 新增 `physical_vulnerable` 分支（~15 行） |

**仅 1 个文件。** 不需要改 multiplierZones / EnemyStatusState / AnomalyHandlers / 聚合函数。

### 可能需要新增的 import

`calcBreachPhysVulnerability` from `calculation/anomalyDamageCalc.ts`

### 路由位置

建议放在 Route 2.5（DIRECT_ANOMALY_MAP）之后、Route 3（legacy fallback）之前，作为 Route 2.7。

### 验证方法

1. 排轴放 ESTELLA 连携技
2. 后续放任意物理伤害技能
3. 点击"伤害统计"→ 物理伤害应在连携后 6s 内增加（物理易伤 +12%@level1 无 artsPower）
4. 同理 LIFENG 战技 → 10s 内物理易伤

### 前端可观察到的变化

"伤害统计"中：ESTELLA 连携后的物理伤害增加约 12%（level 1, artsPower=0 时）。LIFENG 战技同理。
