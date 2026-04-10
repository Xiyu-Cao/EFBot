# T8 GILBERTA spell_vulnerable 数值方向审计

---

## 1. 已确认事实：GILBERTA spell_vulnerable 当前取值链

### 原始 effect node（gamedata）

```json
{ "type": "spell_vulnerable", "stacks": 1, "duration": 5, "offset": 2, "_id": "lybx0u9" }
```

### Route 处理（simulator.ts:465-489）

```
effectType === "spell_vulnerable"
  → stacks = max(1, min(4, 1)) = 1
  → artsPower = GILBERTA 的 originium_arts_power（若无则 0）
  → calcConductionDebuff(1, artsPower)
    → spellVulnerability = (1+2) * 4 * artsPowerDebuffMult(ap)
    → 当 artsPower=0: spellVulnerability = 3 * 4 * 1 = 12
  → duration = 5（从 gamedata 读取）
  → addOrRefreshBuff(enemy.effects, Effect {
      id: "SPELL_VULNERABLE",
      duration: 5,
      startTime: resolvedEffect.realStartTime,
      dynamicBonuses: [{ stat: "arts_dmg", value: 12, zone: "fragility" }]
    })
```

**确认**：value = +12（正数）。公式不可能产生负值（`artsPowerDebuffMult` 恒 ≥ 1）。

### 聚合消费（damage time）

```
computeFragilityZone(ctx)
  → aggregateZoneBonuses(state, sourceActorId, "fragility", tags)  // source-side
  → aggregateEnemyZoneBonuses(state, "fragility", tags)           // target-side
    → 遍历 enemy.effects → 找到 SPELL_VULNERABLE
    → evaluateDynamicBonus({ stat: "arts_dmg", value: 12 }, tags)
    → tags.damageSchool === "magic" ? 12 : 0
  → bonus = source_bonus + 12
  → value = 1 + bonus / 100 = 1.12 (或更高)

DamageResolver:
  finalDamage *= 1.12  → 伤害增加 12%
```

**确认**：每一步都是正值，最终乘到伤害上是 ×1.12（增加），不是减少。

---

## 2. 已确认事实：当前复用公式来源与适配性

### 公式来源

`calcConductionDebuff`（`anomalyDamageCalc.ts:223-231`）：
```
spellVulnerability = (anomalyLevel + 2) * 4 * artsPowerDebuffMult(artsPower)
```

### 该公式原本服务于

导电（conduction）异常产生的法术易伤。`computeVulnerabilityZone:212` 直接使用此公式的返回值。

### 适配性判断

公式本身无符号问题。`artsPowerDebuffMult(p)` 恒 ≥ 1，`(level+2)*4` 恒为正。spellVulnerability 最小值 = 12（level=1, artsPower=0）。

**注意**：该公式是否适用于"技能直接施加的法术脆弱"在游戏机制上未经人工确认。但数值方向（正值 → 增伤）是正确的。

---

## 3. 已确认事实：target-side 聚合与最终公式消费

### 聚合链

```
aggregateEnemyZoneBonuses(state, "fragility", tags)
  → 遍历 state.enemy.effects.getAll()
  → 过滤 isEffectActive(eff, currentTime)
  → 过滤 db.zone === "fragility"
  → evaluateDynamicBonus(db, tags) → +12（法术）或 0（物理）
  → 返回 total = 12
```

**确认**：聚合过程纯加法，无符号反转。

### 公式消费

```
computeFragilityZone:
  value = 1 + bonus / 100
```

bonus = 12 → value = 1.12。这是 > 1 的乘子，乘进 `finalDamage` 必然使伤害增加。

**确认**：消费层无反转。

---

## 4. 最可能的断点判断

**代码链中找不到符号反转。** 从 effect 值（+12）到聚合（+12）到乘区（1.12）到最终伤害（×1.12），每一步都是正向增益。

### 最可能的真实原因

**Route 2.7/2.8 的架构问题：直接在 setup 阶段 addOrRefreshBuff，绕过了事件系统。**

Routes 1/2/2.5 都通过 `engine.enqueue()` 将效果注册为事件，在 `engine.run()` 期间按时间顺序处理。但 Routes 2.7/2.8 在 setup 循环中直接调用 `addOrRefreshBuff`，导致：

1. **Effect 从 time=0 就在 enemy.effects 中**（而非在 action 触发时才创建）
2. **`isEffectActive` 不检查 startTime 下界**（只检查 `currentTime < startTime + duration`），所以 startTime=12, duration=5 的 effect 在 time=0 就被认为 active
3. **如果时间轴上有多个同类 effect，setup 循环中后者覆盖前者**（addOrRefreshBuff 按 id 覆盖），只有最后一个的 startTime/duration 生效

这不会直接导致"数值方向反转"，但会导致 effect 的活跃窗口与预期不同。用户观察到的"降低"最可能是以下场景之一：

- **对照组混淆**：加入 GILBERTA 后时间轴排布变化，导致其他 buff/debuff（如导电、腐蚀、附着反应）的触发时序改变
- **effect 覆盖**：如果排轴中有多个 GILBERTA 终结技，后者的 addOrRefreshBuff 覆盖前者，startTime 变为最后一个的，但用户观察的是中间的伤害

**首选判断**：不是 value 符号问题，而是 **setup 阶段直接注册 vs 事件系统注册** 的行为差异导致的时序/覆盖异常。

---

## 5. 当前 spell_vulnerable / fragility / vulnerability 的计算链与公式

### spell_vulnerable 完整链

```
gamedata: { type: "spell_vulnerable", stacks: 1, duration: 5, offset: 2 }
  ↓ 编译
resolvedEffect: { node: { type, stacks, duration }, realStartTime: action.realStartTime + offset*timeScale }
  ↓ Route 2.8 (simulator.ts:465)
calcConductionDebuff(1, artsPower) → { spellVulnerability: 12, duration: 12 }
  ↓ 取 duration = 5 (gamedata), value = 12
addOrRefreshBuff(enemy.effects, Effect {
  id: "SPELL_VULNERABLE",
  startTime: resolvedEffect.realStartTime,
  duration: 5,
  dynamicBonuses: [{ stat: "arts_dmg", value: 12, zone: "fragility" }]
})
  ↓ 在 damage time
aggregateEnemyZoneBonuses(state, "fragility", tags)
  → evaluateDynamicBonus({ stat: "arts_dmg", value: 12 }, { damageSchool: "magic" })
  → returns 12
  ↓
computeFragilityZone: value = 1 + (source_bonus + 12) / 100
  ↓
DamageResolver: finalDamage *= value (> 1 → 增伤)
```

### fragility zone 公式

```
fragility = 1 + bonus / 100

bonus = source_side（actor.effects with zone=fragility, evaluateDynamicBonus 匹配）
      + target_side（enemy.effects with zone=fragility, evaluateDynamicBonus 匹配）

正值 → 增伤, 负值 → 减伤（当前无负值路径）
```

### vulnerability zone 公式

```
vulnerability = 1 + bonus / 100

bonus = conduction_spell_vuln（从 EnemyStatusState 读, 仅法术）
      + physical_vulnerable（从 enemy.effects tag 读, 仅物理）
      + source_side_vuln（actor.effects with zone=vulnerability）
      + target_side_vuln（enemy.effects with zone=vulnerability）
```

### calcConductionDebuff 公式

```
文件: anomalyDamageCalc.ts:223-231
spellVulnerability = (anomalyLevel + 2) * 4 * artsPowerDebuffMult(artsPower)
artsPowerDebuffMult(p) = p > 0 ? 1 + (2p)/(300+p) : 1

level=1, ap=0: (1+2)*4*1 = 12
level=2, ap=0: (2+2)*4*1 = 16
level=4, ap=300: (4+2)*4*(1 + 600/600) = 6*4*2 = 48
```

---

## 6. 最小改动实施方案（仅方案，不实施）

### 推荐修复：将 Route 2.7/2.8 从直接 addOrRefreshBuff 改为 enqueue 事件

**问题本质**：Routes 2.7/2.8 在 setup 阶段直接修改 enemy.effects，绕过事件系统。与 Routes 1/2/2.5（全部 enqueue 事件）不一致。这导致：
- effect 从 time=0 就存在，而非在事件时间才生效
- 多个同类 effect 在 setup 阶段互相覆盖
- `isEffectActive` 不检查 startTime 下界，effect 在应该开始之前就活跃

**修复方式**：将 Route 2.7/2.8 改为 enqueue `EFFECT_START` 事件（或自定义事件），让 effect 在正确时间由事件处理器创建。

但这需要 EffectStartHandler 能处理 dynamicBonuses 类型的 Effect（当前它主要处理 tag-only Effect）。需确认兼容性。

**更小的替代修复**：在 `isEffectActive` 中增加 startTime 下界检查：

```
return currentTime >= effect.startTime && currentTime < effect.startTime + effect.duration;
```

**风险**：这会影响所有使用 isEffectActive 的地方。但语义上更正确——effect 只在 [startTime, startTime+duration) 区间内活跃。

**最推荐**：改 `isEffectActive` 增加 startTime 下界检查。改动 1 行，风险可控，语义正确。

| 文件 | 改什么 |
|---|---|
| `equipment/types.ts:isEffectActive` | 增加 `currentTime >= effect.startTime` 条件 |

这是最小且最通用的修复——同时修正 physical_vulnerable 和 spell_vulnerable 的时序问题。
