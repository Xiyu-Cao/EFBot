# Phase 8 Report

217 tests pass, 0 TypeScript errors.

---

## 核心成果

### A. Weapon triggeredBuffs 半自动化

**新文件**: `equipment/weaponDataAdapter.ts`

建立了"元数据优先、手工兜底"机制：

| 来源 | 内容 |
|---|---|
| gamedata.json | trigger, target, duration, maxStacks, stackCooldown |
| hand-written fallback | action 函数（effect 数值 + 复杂逻辑） |

核心函数：
- `buildTriggerFromMetadata(buff, fallback?)` — 从 JSON 元数据构建 EffectTrigger
- `registerWeaponFromData(engine, actorId, weaponData, fallbacks?)` — 完整注册流程
- `TRIGGER_EVENT_MAP` — 38 种 JSON trigger 字符串 → SimEvent 类型映射
- `buildTriggerCondition(trigger)` — 自动生成条件函数

**典范武器改造前后对比**：

| 改造前 | 改造后 |
|---|---|
| event/cooldownId/cooldownDuration/condition 全部手写 | 从 JSON 自动读取 trigger→event 映射、stackCooldown→ICD、condition 自动生成 |
| 只有 action 函数是实际逻辑 | 只需提供 action 函数，其余自动 |
| 每换一把武器要复制大量模板 | 只需 `registerWeaponFromData(engine, id, jsonData, { 0: actionFn })` |

### B. Pipeline 数据贯通

| 变更 | 文件 |
|---|---|
| `GameDatabase` 类型充实 | `compiler/types.ts` — 增加 weaponDatabase/equipmentDatabase 完整类型 |
| `simulate()` 接受 `db?: GameDatabase` | `simulator.ts` |
| `runSimulation()` 从 `options.db` 读取数据库 | `runSimulation.ts` |

数据流：`gamedata.json → options.db → runSimulation → simulate → registerEquipmentPassives`

### C. Skill Multiplier Overlay

**新文件**: `data/skillMultipliers.ts`

| 角色 | 技能 | 倍率 |
|---|---|---|
| ENDMINISTRATOR | skill | 2.8 |
| ENDMINISTRATOR | link | 3.5 |
| ENDMINISTRATOR | ultimate | 8.0 |
| CHENQIANYU | skill | 3.2 |
| CHENQIANYU | link | 3.0 |
| CHENQIANYU | ultimate | 10.0 |

`simulator.ts` 在 enqueue damage ticks 时自动从 overlay 读取 multiplier（仅当 tick 本身无 multiplier 时）。

### D. 全链路集成验证

测试验证了完整链路：

```
ENDMINISTRATOR (ATK=1000, physical_dmg=28)
  + 典范 weapon passive (JSON metadata + hand-written stacking)
  + boss template (defense=0.5, physResist=10%)
  + skill multiplier overlay (2.8x)
  → 第一击: floor(1000 * 2.8 * 0.5 * 0.90 * 1.28) = 1612
  → 第二击: floor(1000 * 2.8 * 0.5 * 0.90 * 1.56) = 1965
    (典范 +28% physical_dmg dynamic buff 生效)
```

---

## 修改文件清单

| 文件 | 操作 | 要点 |
|---|---|---|
| `equipment/weaponDataAdapter.ts` | NEW | 武器数据适配器，trigger→event 映射，JSON 元数据优先 |
| `data/skillMultipliers.ts` | NEW | 技能倍率 overlay，首批 2 个角色 |
| `equipment/definitions.ts` | MODIFIED | 典范改为 data-driven (JSON metadata + fallback action) |
| `compiler/types.ts` | MODIFIED | GameDatabase 类型充实 |
| `simulator.ts` | MODIFIED | 接受 db 参数，skill multiplier overlay 自动应用 |
| `runSimulation.ts` | MODIFIED | 从 options.db 读取数据库传入 simulate |
| `calculation/phase8.test.ts` | NEW | 15 个新测试 |

---

## 从数据源自动读取的字段

| 字段 | 数据源 | 读取方式 |
|---|---|---|
| weapon trigger type | `triggeredBuffs[].trigger` | `TRIGGER_EVENT_MAP` → SimEvent type |
| trigger condition | `triggeredBuffs[].trigger` | `buildTriggerCondition()` 自动生成 |
| ICD | `triggeredBuffs[].stackCooldown` | → `cooldownDuration` |
| buff duration | `triggeredBuffs[].duration` | → Effect.duration |
| max stacks | `triggeredBuffs[].maxStacks` | → `addStackWithIndependentDuration` maxStacks |
| weapon ID → registry key | `weaponDatabase[].id` | `WEAPON_ID_TO_KEY` |
| equipment category → set ID | `equipmentDatabase[].category` | `CATEGORY_TO_SET_ID` |

## 仍 fallback 到 hand-written definitions 的部分

| 部分 | 原因 |
|---|---|
| 典范 action 函数 | JSON effects[] 为空，stacking 逻辑需要手写 |
| 蚀迹 全部逻辑 | JSON 中找不到匹配的武器 ID（作品：蚀象 ≠ 作品：蚀迹），保留全手写 |
| 套装触发效果 | gamedata.json 的 equipmentCategoryConfigs 无触发条件/效果数据 |
| skill multipliers | gamedata.json ticks 无 multiplier 字段 |

---

## 新增测试 (15 个)

| 测试组 | 数量 | 覆盖 |
|---|---|---|
| Weapon Data Adapter | 4 | trigger 构建、unknown 类型、无 fallback、registerWeaponFromData |
| Paradigm Data-Driven | 3 | JSON 数据注册、默认数据兜底、duration/maxStacks 来自 JSON |
| Skill Multiplier Overlay | 5 | 已知角色、已知技能、unknown character/action/index |
| Full Integration Chain | 2 | 单技能真实伤害、多技能 + weapon buff + boss resist |
| Pipeline Plumbing | 1 | extractEquipmentConfigs 映射武器 ID |

---

## 仍保留的 TODO

| 问题 | 优先级 | 说明 |
|---|---|---|
| 蚀迹武器 ID 不匹配 | P1 | gamedata.json 中是"作品：蚀象"(wpn_funnel_0006)，非"作品：蚀迹"；需确认正确 ID |
| skill multipliers 值待验证 | P1 | 当前值为估算，需实机确认 |
| 套装触发效果无 JSON 数据源 | P1 | equipmentCategoryConfigs 只有 setBonus.duration |
| 更多 TRIGGER_EVENT_MAP 条目 | P2 | 38 种 trigger 中仅映射了最常见的十几种 |
| DamageHandler 无 rng 入口 | P2 | 集成测试需要 crit_rate: -100 hack 来消除随机性 |
| compile pipeline 自动应用 multiplier overlay | P3 | 当前在 simulator.ts enqueue 时应用，理想应在 compile 阶段 |

---

## 下一阶段建议

1. **更多角色技能 multiplier 数据** — 逐步扩展 skillMultipliers.ts
2. **套装触发效果数据化** — 等 equipmentCategoryConfigs 补充触发数据后接入 adapter
3. **蚀迹武器 ID 确认** — 与用户确认 gamedata.json 中的正确映射
4. **DamageHandler deterministic crit** — 支持 engine-level rng seed，消除测试随机性
5. **UI integration** — 让 timelineStore 在调用 runSimulation 时传入 `options.db` = gamedata
