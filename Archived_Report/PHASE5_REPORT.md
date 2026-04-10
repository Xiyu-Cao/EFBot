# Phase 5 Part 1 — Equipment / Set / Weapon Passives Implementation Report

## Overview

本轮将第一批真实装备 / 套装 / 武器效果真正接入 simulation 的 passive / trigger / modifier / equipmentProc 主链路。
复用现有 DamageTags、TriggerProcessor、EffectManager、DamageResolver 体系，不引入新的事件类型。

---

## A. 装备框架与通用能力

### 新文件: `equipment/types.ts`

**DynamicBonus 机制**

装备 buff 通过 `Effect.properties.dynamicBonuses` 存储动态属性加成：

```typescript
interface DynamicBonus {
  stat: string;   // "blaze_dmg", "arts_dmg", "physical_dmg", etc.
  value: number;  // 百分比加成
}
```

`multiplierZones.computeDamageBonusZone` 在每次伤害计算时从 actor 的 `EffectManager` 聚合所有未过期的 `dynamicBonuses`，与基础属性加算后统一进入增伤区。

**支持的 stat 类型映射**

| stat | 匹配条件 |
|---|---|
| `blaze_dmg` | damageType === "burn" |
| `cold_dmg` | damageType === "cold" |
| `emag_dmg` | damageType === "electro" |
| `nature_dmg` | damageType === "nature" |
| `physical_dmg` | damageSchool === "physical" |
| `arts_dmg` | damageSchool === "magic" |
| `all_skill_dmg_bonus` | 所有技能来源伤害 |
| `all_dmg` | 所有伤害（造成的伤害增加） |
| `attack_dmg_bonus` / `skill_dmg_bonus` / `link_dmg_bonus` / `ultimate_dmg_bonus` | 对应来源 |

### 通用辅助函数

| 函数 | 用途 |
|---|---|
| `addOrRefreshBuff(effects, effect)` | 不可叠加、仅刷新持续时间 |
| `addStackWithIndependentDuration(effects, effect, groupId, maxStacks)` | 叠层独立计时（如典范） |
| `isEffectActive(effect, currentTime)` | 检查 buff 是否过期 |
| `evaluateDynamicBonus(db, tags)` | 判断某条 bonus 是否匹配当前伤害 |
| `aggregateDynamicBonuses(state, actorId, tags)` | 聚合 actor 所有活跃 buff 的匹配加成 |
| `applyBuffToTargets(state, sourceId, target, createBuff)` | 按 self/team/otherTeammates 施加 buff |

### BuffTarget 目标机制

```typescript
type BuffTarget = "self" | "team" | "otherTeammates";
```

- `self`: 仅施加给装备者
- `team`: 施加给所有队员（含装备者）
- `otherTeammates`: 施加给其他队员（不含装备者）

---

## B. ICD / 不可叠加 / 独立计时叠层

| 机制 | 实现方式 |
|---|---|
| ICD (内置冷却) | TriggerProcessor 内置 `cooldownId` + `cooldownDuration` |
| 不可叠加 + 刷新持续时间 | `addOrRefreshBuff()` — 同 id 覆盖 startTime |
| 叠层 + 独立计时 | `addStackWithIndependentDuration()` — 每层独立 Effect，按 `stackGroup` 分组，超上限移除最旧 |
| 过期检查 | `isEffectActive()` + `aggregateDynamicBonuses()` 在伤害计算时跳过过期 buff |

---

## C. 6 个真实装备 / 武器实现

### 新文件: `equipment/definitions.ts`

#### 1. 点剑 (Dianjian) — 3 件套

| 效果 | 实现 |
|---|---|
| +20% 失衡效率 | TODO: stagger efficiency stat |
| 物理异常后 250% ATK 物理 equipmentProc + 10 失衡 | `APPLY_PHYSICAL_ANOMALY` trigger → `ANOMALY_DAMAGE` (equipmentProc) + `STAGGER_CHANGE` |
| 15s ICD | `cooldownId: "dianjian_3pc_icd", cooldownDuration: 15` |

#### 2. 动火用 (Donghuoyong) — 3 件套

| 效果 | 实现 |
|---|---|
| +30 源石技艺强度 | 直接修改 `actor.snapshotData.stats.originium_arts_power` |
| 直接施加燃烧 → 灼热伤害 +50%, 10s | `APPLY_DIRECT_ANOMALY` trigger, condition: burn |
| 直接施加腐蚀 → 自然伤害 +50%, 10s | `APPLY_DIRECT_ANOMALY` trigger, condition: corrosion |
| 不可叠加 | `addOrRefreshBuff()` |

**关键设计**: 监听 `APPLY_DIRECT_ANOMALY` 事件而非 `APPLY_MAGIC_ATTACHMENT`，天然排除反应触发的燃烧。

#### 3. 脉冲式 (Maichongshi) — 3 件套

| 效果 | 实现 |
|---|---|
| +30 源石技艺强度 | 直接修改 stats |
| 直接施加导电 → 电磁伤害 +50%, 10s | `APPLY_DIRECT_ANOMALY` trigger, condition: conduction |
| 直接施加冻结 → 寒冷伤害 +50%, 10s | `APPLY_DIRECT_ANOMALY` trigger, condition: freeze |

#### 4. 潮涌 (Chaoyong) — 3 件套

| 效果 | 实现 |
|---|---|
| +20% 所有技能伤害 | 直接修改 `stats.all_skill_dmg_bonus` |
| 敌人达到 2 层及以上法术附着 → 法术伤害 +35%, 15s | `APPLY_MAGIC_ATTACHMENT` trigger, condition: `getMagicStacks() >= 2` |

**关键设计**: TriggerProcessor 在 handler 之后执行，此时 `getMagicStacks()` 已反映最新状态。

#### 5. 典范 (Paradigm) — 武器

| 效果 | 实现 |
|---|---|
| +28% 物理伤害 (常驻) | 直接修改 `stats.physical_dmg` |
| 战技/终结技命中 → +28% 物理伤害, 30s, 最多 3 层, 独立计时 | `DAMAGE_TICK` trigger, condition: action.type === skill/ultimate |
| 0.1s ICD | `cooldownId: "paradigm_icd", cooldownDuration: 0.1` |

**关键设计**: 使用 `addStackWithIndependentDuration` + `stackGroup: "paradigm_buff"` 实现独立计时叠层。

#### 6. 作品：蚀迹 (Zuopin Shiji) — 武器

| 效果 | 实现 |
|---|---|
| +19.6% 攻击力 | `stats.attack *= 1.196` (TODO: proper percentBonus) |
| 战技施加自然附着 → 其他干员法术伤害 +14% + 5.6%/自然附着敌人, 15s | `APPLY_MAGIC_ATTACHMENT` trigger, condition: nature + skill action |
| 不可叠加 | `addOrRefreshBuff()` |
| 目标: 其他队员 | `applyBuffToTargets(state, actorId, "otherTeammates", ...)` |

---

## D. multiplierZones 动态聚合

**修改文件**: `calculation/multiplierZones.ts`

`computeDamageBonusZone` 新增动态 buff 聚合逻辑：

```
bonus += aggregateDynamicBonuses(state, sourceActorId, tags)
```

流程：
1. 通过 `state.getActor(sourceActorId)` 获取 actor 实时状态
2. 遍历 `actor.effects.getAll()`
3. 跳过已过期的 buff（`isEffectActive` 检查）
4. 对每个 `dynamicBonuses` 条目，通过 `evaluateDynamicBonus` 判断是否匹配当前伤害标签
5. 匹配的加成值加算进增伤区

---

## E. TriggerProcessor 修复

**修改文件**: `engine/TriggerProcessor.ts`

`extractSourceId` 增加 `sourceActorId` 识别：

```typescript
return (p.actorId ?? p.sourceId ?? p.sourceActorId ?? undefined)
```

修复了 `sourceMustBeWearer` 对异常事件 (APPLY_MAGIC_ATTACHMENT, APPLY_PHYSICAL_ANOMALY, APPLY_DIRECT_ANOMALY) 的匹配。

---

## F. 注册管线

### 新文件: `equipment/registry.ts`

| 函数 | 用途 |
|---|---|
| `registerEquipmentPassives(engine, configs)` | 批量注册所有装备 |
| `SET_REGISTRY` | setId → 注册函数映射表 |
| `WEAPON_REGISTRY` | weaponId → 注册函数映射表 |

### 修改文件: `simulator.ts`

`simulate()` 新增可选参数 `equipmentConfigs?: EquipmentConfig[]`，在 `engine.run()` 前调用 `registerEquipmentPassives`。

---

## G. 测试

### 新增测试 (23 个)

**文件**: `equipment/equipment.test.ts`

| 测试组 | 测试数 | 覆盖内容 |
|---|---|---|
| Dianjian Set | 3 | equipmentProc 触发、15s ICD、独立伤害实例 |
| Donghuoyong Set | 4 | direct burn 触发、reaction burn 不触发、不可叠加刷新、arts power 加成 |
| Maichongshi Set | 2 | conduction/freeze 触发对应 buff |
| Chaoyong Set | 3 | 2 层附着触发、1 层不触发、all_skill_dmg_bonus |
| Zuopin Shiji | 2 | 只给其他队员、动态敌人附着加成 |
| Paradigm | 3 | 叠层机制、ICD、base stat bonus |
| Dynamic Aggregation | 3 | buff 影响伤害计算、过期 buff 排除、多 buff 加算 |
| Equipment Helpers | 3 | isEffectActive、addOrRefreshBuff |

### 总计

```
Test Files  15 passed (15)
Tests       161 passed (161)
TypeScript  0 errors
```

---

## 修改文件清单

| 文件 | 操作 |
|---|---|
| `equipment/types.ts` | NEW — 框架类型 + 辅助函数 |
| `equipment/definitions.ts` | NEW — 6 个装备/武器定义 |
| `equipment/registry.ts` | NEW — 注册入口 |
| `equipment/equipment.test.ts` | NEW — 23 个测试 |
| `calculation/multiplierZones.ts` | MODIFIED — 动态 buff 聚合 |
| `engine/TriggerProcessor.ts` | MODIFIED — extractSourceId 修复 |
| `simulator.ts` | MODIFIED — equipmentConfigs 参数 |

---

## 仍保留的 TODO

| 位置 | 内容 |
|---|---|
| `definitions.ts` — 点剑 | +20% 失衡效率 stat 未实现 |
| `definitions.ts` — 蚀迹 | 攻击力 +19.6% 用乘法近似，待接入 percentBonus |
| `definitions.ts` — 典范 | 叠层触发需要真实 timeline action 才能验证 condition |
| `types.ts` — buff 过期 | 过期 buff 仅在伤害计算时跳过，未从 EffectManager 实际清理 |
| `multiplierZones.ts` | 增幅区 / 连击区 / 脆弱区仍为 placeholder |
| 全局 | boss 控制免疫配置未实现（不阻止伤害实例触发的规则已天然满足） |

---

## 下一阶段建议

1. **更多装备/武器接入** — 按 registry 模式扩展，无需修改框架
2. **buff 过期清理** — 添加定时清理或 EFFECT_END 调度机制
3. **percentBonus 聚合** — attackFormula 读取装备/buff 的 percent 加成
4. **增幅区 / 连击区** — 从 buff 系统聚合（类似 dynamicBonuses 但归属不同乘区）
5. **boss 控制免疫** — per-enemy 配置，控制类型独立开关
6. **失衡效率** — 新增 stagger efficiency stat + zone
7. **compile pipeline 集成** — 从 ScenarioTrack 的 equipArmorId/weaponId 自动解析装备并注册
