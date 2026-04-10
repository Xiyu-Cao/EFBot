# EFBot Simulation Handoff Document

> 生成时间：基于 Phase 10 完成后的代码库状态
> 251 tests pass, 0 TypeScript errors

---

## 1. 当前项目状态

**已完成**：Phase 4 → 5 → 5审计 → 6 → 6审计 → 7 → 7审计 → 8 → 8审计 → 9 → 9审计 → 10

**以这些报告为准**（按时间顺序，后者覆盖前者）：
- `PHASE10_REPORT.md` — 最新主报告（truth status / set bonus / rng options）
- `PHASE9_AUDIT_REPORT.md` — 最新收口审计（AnomalyDamageHandler rng 修复）
- `DATA_AUDIT_REPORT.md` — 数据源盘点（双真值源分析，仍有参考价值）

**项目状态**：**可继续开发**。所有 251 个测试通过，TypeScript 编译零错误，无已知阻塞问题。

---

## 2. 已完成的核心能力

### Simulation 主链路
- `simulator.ts` → `createEngine` → event loop → handlers → log
- `runSimulation.ts` 统一入口：compile → equipment registration → simulate → results
- `SimulateOptions` 支持 `equipmentConfigs` / `db` / `rng`
- 时间推进：`GameState.advanceTime` 遍历 team + enemy + all actors

### Damage Pipeline
- **攻击力公式**：`attackFormula.ts` — `floor((base*(1+pct)+flat) * (1 + trunc1(pri*0.5)/100 + trunc1(sec*0.2)/100))`
- **DamageResolver**：ATK × mult × 11 个乘区 → floor
- **11 个乘区**（`multiplierZones.ts`）：defense / crit / dmgBonus / amplify / combo / vulnerability / fragility / resistance / break / reduction / special
- **DynamicBonus 系统**：`equipment/types.ts` — 装备 buff 通过 `zone` 字段分流到不同乘区
- **percentBonus / flatBonus**：通过 `aggregateAttackBonuses` 从 actor effects 聚合，注入攻击力公式

### Reactions / Anomalies
- **异常公式统一真值**：`anomalyDamageCalc.ts` 是单一来源，`utils/anomalyCalc.js` 改为 re-export
- 法术爆发 / 异常触发 / 燃烧tick / 碎冰 / 击飞 / 猛击 / 碎甲 — 全部含等级系数 + artsPowerDamageMult
- **导电**：易伤 = `(level+2)*4*artsPowerDebuffMult`，只影响法术伤害
- **腐蚀**：减抗（物理+法术），含 `artsPowerDebuffMult` 缩放
- **碎甲**：物理伤害实例 + 物理易伤 debuff（两层完全分离），易伤用 `addOrRefreshBuff` 覆盖式写入
- **法术附着**：同元素叠层→爆发，异元素→反应+debuff，最多4层，30秒
- **物理异常**：break stacks + reaction（launch/knockdown/armorBreak/slam）
- **burn tick**：10秒每秒1次，canCrit=false，实时读取状态

### Equipment / Set / Weapon Passives
- **武器数据适配**：`weaponDataAdapter.ts` — JSON 元数据优先（trigger/duration/maxStacks/stackCooldown），hand-written action fallback
- **装备注册**：`registry.ts` — `registerEquipmentPassives` + `extractEquipmentConfigs`
- **6 个已实现样本**：点剑/动火用/脉冲式/潮涌（套装）+ 典范/蚀迹（武器）
- **静态词条**：由 timelineStore delta 机制融入 `ActorSnapshot.stats`，simulation 层不重复加算
- **动态 buff**：通过 `DynamicBonus { stat, value, zone }` 存储在 Effect.properties.dynamicBonuses
- **ICD**：TriggerProcessor 内置 cooldownId + cooldownDuration
- **叠层模式**：addOrRefreshBuff（覆盖）/ addStackWithIndependentDuration（独立计时）

### Boss / Enemy Templates
- `EnemyConfig` 含：maxStagger / staggerNodeCount / duration / breakDuration / executionRecovery / **defenseMultiplier** / **baseMagicResist** / **basePhysicalResist** / **controlImmunities**
- `ControlImmunities { freeze?, launch?, knockdown? }` — 免疫控制不免疫伤害
- freeze immune → debuff 仍保留 → shatter 仍触发
- `PhysicalReactionResolver` 读取 controlImmunities

### RNG / Crit
- `engine/rng.ts`：`createSeededRng(seed)` / `buildRng({ seed?, deterministicCrits? })`
- 模式：seed（可复现）/ alwaysCrit / neverCrit / Math.random（默认）
- 链路：`simulate(options.rng)` → `engine.rng` → `SimulationContext.rng` → `DamageHandler.rng` + `AnomalyDamageHandler.rng` → `DamageResolver.resolveCrit(rng)`
- `runSimulation(scenario, { rng: { seed: 42 } })` 已支持

### UI / runSimulation 数据入口
- `timelineStore.js` → `simulate(timeline, configs, actors, { equipmentConfigs, db })`
- **套装自动检测**：timelineStore 中按 category 计数 ≥ 3 件 → `CATEGORY_TO_SET` 映射
- **武器注册**：`weaponDatabaseId` → `WEAPON_ID_TO_KEY` → registry 自动推导
- **db 传递**：`{ weaponDatabase, equipmentDatabase }` 从 store refs 传入

### Skill Multiplier Overlay / Truth Status
- `data/skillMultipliers.ts`：5 个角色 × 3 技能 = 15 个 entry
- `MultiplierTruthStatus: "verified" | "estimated"` — 当前全部为 estimated
- `applySkillMultiplierOverlay`：只填充 multiplier=0 的 tick，不覆盖已有值
- `getEntriesByStatus("estimated")` 可查询所有待验证条目
- `EffectManager.sweepExpired(currentTime)` 定期清理过期 buff

---

## 3. 当前真值源与数据入口

### 来自 gamedata.json / tables / scenario track

| 数据 | 来源 | 入口 |
|---|---|---|
| 角色基础 stats | `ScenarioTrack.stats`（含武器/装备 delta） | `ActorSnapshot.stats` |
| 武器静态词条 | `weaponDatabase[].passiveStats` + `commonSlots` + `buffBonuses` | timelineStore delta → `track.stats` |
| 装备静态词条 | `equipmentDatabase[].affixes` | timelineStore delta → `track.stats` |
| 武器触发元数据 | `weaponDatabase[].triggeredBuffs[]` | `weaponDataAdapter.ts` → `buildTriggerFromMetadata` |
| 装备套组类别 | `equipmentDatabase[].category` | `extractEquipmentConfigs` / timelineStore |
| 敌人预设（失衡参数） | `enemyDatabase[]` | `timelineStore.applyEnemyPreset` → `systemConstants` |
| 技能 tick 结构 | `characterRoster[].skill_damage_ticks` | compile → `ResolvedDamageTick` |
| 异常公式常量 | `anomalyDamageCalc.ts`（统一真值） | simulation + UI 共用 |

### 来自 hand-written overlay / definitions / fallback

| 数据 | 文件 | 原因 |
|---|---|---|
| skill multipliers (倍率) | `data/skillMultipliers.ts` | gamedata ticks 无 multiplier 字段 |
| 武器 action 函数 | `equipment/definitions.ts` | JSON effects[] 为空 |
| 套装触发效果 | `equipment/definitions.ts` | equipmentCategoryConfigs 无触发数据 |
| TRIGGER_EVENT_MAP | `weaponDataAdapter.ts` | JSON trigger 字符串→SimEvent 映射 |
| CATEGORY_TO_SET_ID | `equipment/registry.ts` | 中文类别→注册 key 映射 |
| WEAPON_ID_TO_KEY | `equipment/registry.ts` | gamedata weapon ID→注册 key 映射 |

### 待确认映射 / TODO

| 问题 | 位置 |
|---|---|
| 蚀迹武器 ID：gamedata 中是 "作品：蚀象"(wpn_funnel_0006)，非 "作品：蚀迹" | `registry.ts:132` |
| 15 个 skill multiplier 值均为 estimated | `skillMultipliers.ts` |
| timelineStore CATEGORY_TO_SET 与 registry CATEGORY_TO_SET_ID 重复 | `timelineStore.js` + `registry.ts` |

### 绝对不能重复加算

- **武器 passiveStats**：已通过 timelineStore delta 融入 `track.stats`，`definitions.ts` **不可** `stats += N`
- **装备 affixes**：同上
- **artsPowerDamageMult**：已内含在异常倍率函数输出中，`computeSpecialZone` 返回 1（不重复乘）

---

## 4. 当前最重要的已知规则

### 法术附着 / 物理异常
- 同一时刻目标最多一种法术附着，最大 4 层，30 秒
- 同元素 → 叠层 + 法术爆发；异元素 → 清空 + 异常 debuff + 直接伤害
- 物理异常：无 break → 加 1 stack；有 break → reaction（damage + clear/add）

### armorBreak / conduction / corrosion / burn / freeze / shatter
- **armorBreak**：伤害 + 清 break + 物理易伤 debuff（两层分离）
- **导电**：法术易伤 `(level+2)*4*artsPowerDebuffMult`，只影响 magic
- **腐蚀**：减抗（物理+法术），随时间累积
- **燃烧**：10秒 DoT，每秒1次，canCrit=false，实时读取状态
- **冻结**：6/7/8/9秒（按 level），被物理异常→碎冰
- **碎冰**：物理伤害，canCrit=true，归属物理异常施加者

### 伤害公式乘区
```
damage = floor(ATK × mult × defense × crit × dmgBonus × amplify
         × combo × vulnerability × fragility × resistance
         × break × reduction × special)
```
- 乘区间相乘，乘区内加算
- defense：默认 0.5，per-enemy 可配
- resistance：`1 + resistReduction*0.01 - baseResist*0.01`
- break：失衡时 1.3

### Control Immunity
- 按类型：freeze / launch / knockdown
- 免疫控制 ≠ 免疫伤害
- freeze immune → debuff 仍保留 → shatter 仍可触发
- launch/knockdown immune → 伤害仍产出

### Damage 来源边界
- skill damage：`damageSource = activeSkill/comboSkill/ultimateSkill/heavyAttack/normalAttack`
- anomaly damage：走 `ANOMALY_DAMAGE` 事件 → `AnomalyDamageHandler` → `DamageResolver`
- equipment proc：`damageSource = "equipmentProc"`，独立伤害实例，独立 DamageTags

---

## 5. 当前未完成事项

### P0 — 下次回来最先做
1. **实机核对 15 个 skill multiplier 值** — `getEntriesByStatus("estimated")` 查询清单
2. **共享 CATEGORY_TO_SET** — timelineStore 重复了 registry 的映射表

### P1 — 重要但不阻塞
3. 蚀迹武器 ID 确认（gamedata 中 "作品：蚀象" vs 代码中 "作品：蚀迹"）
4. 更多 TRIGGER_EVENT_MAP 条目（38 种中已映射 16 种）
5. 更多 boss/enemy 真值（gamedata 无 defense/resist/immunities 字段）
6. JSON `effects[]` → auto action 生成（当前所有 effects 需 hand-written fallback）

### P2 — 后续再做
7. 更多角色技能扩展
8. 精英怪/小怪模板
9. hit step 机制与更多技能对接
10. 完整 UI 端到端集成测试

---

## 6. 下次恢复项目时的建议步骤

1. **看报告**：先读 `PHASE10_REPORT.md` → `PHASE9_AUDIT_REPORT.md` → 本文件
2. **确认环境**：
   ```bash
   cd E:/EFBot/apps/endaxis-web
   npx vitest run          # 应 251 tests pass
   npx vue-tsc --noEmit    # 应 0 errors
   ```
3. **定位待办**：在 `data/skillMultipliers.ts` 中调用 `getEntriesByStatus("estimated")` 查看待验证清单
4. **P0 任务**：
   - 如果有实机数据 → 更新 multiplier 值 + 改 `status: "verified"` + 填 `source`
   - 如果没有 → 先做 P0 #2（共享 CATEGORY_TO_SET）减少重复
5. **扩展角色**：在 `SKILL_MULTIPLIERS` 中添加新角色条目，标记 `status: "estimated"`

---

## 7. 关键文件索引

### 计算核心
| 文件 | 作用 |
|---|---|
| `simulation/calculation/DamageResolver.ts` | 伤害计算主入口 — ATK × mult × 11 zones |
| `simulation/calculation/multiplierZones.ts` | 11 个乘区实现 |
| `simulation/calculation/attackFormula.ts` | 攻击力公式（含 truncation + floor） |
| `simulation/calculation/anomalyDamageCalc.ts` | 异常伤害公式统一真值（与 UI 共享） |
| `simulation/calculation/critSystem.ts` | 暴击系统（base 5%/50%） |
| `simulation/calculation/damageTypes.ts` | DamageType/School/Source/Tags + buildDamageTags |

### 异常 / 反应
| 文件 | 作用 |
|---|---|
| `simulation/anomaly/AnomalyHandlers.ts` | 异常事件处理（burst/reaction/burn/shatter/phys） |
| `simulation/anomaly/PhysicalReactionResolver.ts` | 物理异常反应（含 controlImmunities） |
| `simulation/anomaly/MagicReactionResolver.ts` | 法术附着反应 |
| `simulation/anomaly/EnemyStatusState.ts` | 敌人异常状态（attachment/break/burn/freeze/conduction/corrosion） |
| `simulation/anomaly/types.ts` | 异常类型定义 + 常量 |

### 装备 / 武器
| 文件 | 作用 |
|---|---|
| `simulation/equipment/definitions.ts` | 6 个装备/武器触发效果 hand-written 实现 |
| `simulation/equipment/registry.ts` | 注册入口 + extractEquipmentConfigs + ID 映射 |
| `simulation/equipment/weaponDataAdapter.ts` | JSON triggeredBuffs → EffectTrigger 适配 |
| `simulation/equipment/types.ts` | DynamicBonus / addOrRefreshBuff / aggregation helpers |

### 数据 / 入口
| 文件 | 作用 |
|---|---|
| `simulation/data/skillMultipliers.ts` | 技能倍率 overlay + truth status |
| `simulation/simulator.ts` | simulate() 主入口 — SimulateOptions |
| `simulation/runSimulation.ts` | 统一 headless 入口 — compile + simulate |
| `stores/timelineStore.js` | UI 层 simulation computed — 传 db + equipmentConfigs + set bonus |
| `simulation/engine/rng.ts` | 确定性 RNG — seed / alwaysCrit / neverCrit |
| `utils/anomalyCalc.js` | UI 层异常公式（re-exports from anomalyDamageCalc.ts） |

### 状态 / 引擎
| 文件 | 作用 |
|---|---|
| `simulation/state/types.ts` | EnemyConfig + ControlImmunities + ActorSnapshot |
| `simulation/state/EnemyState.ts` | 敌人运行时状态 |
| `simulation/state/EffectManager.ts` | 效果管理（含 sweepExpired） |
| `simulation/engine/SimulationEngine.ts` | 事件循环主体 |
| `simulation/engine/TriggerProcessor.ts` | 效果触发器处理 |

---

## 8. 风险与注意事项

### 双真值源风险
- ✅ **已消除**：异常伤害公式（`anomalyDamageCalc.ts` 是唯一真值，`anomalyCalc.js` re-export）
- ✅ **已消除**：静态词条（definitions.ts 不再 `stats +=`）
- ⚠️ **残留**：`CATEGORY_TO_SET` 在 timelineStore.js 和 registry.ts 各有一份（值相同但独立维护）

### 静态词条重复加算
- `definitions.ts` 已清理所有 `stats +=` / `stats *=`
- 武器 `passiveStats` 和装备 `affixes` 的真值来自 timelineStore delta → `track.stats`
- **绝对不要**在 `definitions.ts` 的 register 函数中再次加算

### 未确认映射
- `WEAPON_ID_TO_KEY["wpn_staff_0006"] = "zuopin_shiji"` 标注了 `TODO: verify actual id`
- gamedata 中"作品：蚀象"(wpn_funnel_0006) 而非 "作品：蚀迹" — 可能是不同武器

### 需实机核对的规则
- 15 个 skill multiplier 值（全部 `status: "estimated"`）
- controlImmunities 对 break stacks 是否仍累积（当前保守实现：仍累积）
- 法术爆发是否确实吃 artsPowerDamageMult（代码已按"是"实现，anomalyCalc.js 旧实现未传 artsPower）
- boss 具体法抗/物抗/防御值（gamedata 中无此字段）
