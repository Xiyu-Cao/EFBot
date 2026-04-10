# Phase 8 收口审计报告

## 结论：建议合并

222 tests pass, 0 TypeScript errors.

---

## 审查结果

### 1. weapon triggeredBuffs 半自动读取

**确认来自 JSON 的字段：**
- `trigger` → `TRIGGER_EVENT_MAP` → SimEvent type + `buildTriggerCondition`
- `stackCooldown` → `cooldownDuration`
- `duration` → 传入 definitions 的 action factory（如典范的 `buff.duration ?? 30`）
- `maxStacks` → 传入 action factory
- `name` → 用于 `cooldownId` 命名

**仍由 hand-written fallback 提供：**
- action 函数体（effect 值、stacking 逻辑、buff 创建）
- 套装触发效果（equipmentCategoryConfigs 无触发数据）

**边界清晰**：`registerWeaponFromData` 中有完整的 diagnostics 覆盖：
- `WEAPON_TRIGGER_UNKNOWN` — JSON trigger 字符串无法映射
- `WEAPON_TRIGGER_NO_ACTION` — 无 fallback 且 effects[] 为空
- `WEAPON_EFFECTS_JSON_NOT_AUTO` — 有 effects[] 但无 fallback（提示未模拟）
- `WEAPON_PASSIVE_EMPTY` — 元数据存在但零个可构建 trigger

**无冲突路径**：典范武器通过 `registerParadigmWeapon(engine, actorId, weaponData?, diagnostics?)` 优先使用 JSON 的 `weaponData`，缺失时使用 `PARADIGM_DEFAULT_DATA` 内建值。两者结构一致，无静默覆盖。

### 2. compile / run data plumbing

**链路完整**：
```
gamedata.json
  → runSimulation(scenario, { db: gamedata })
    → options.db → extractEquipmentConfigs(scenario, db.equipmentDatabase)
    → simulate(timeline, ..., equipmentConfigs, db)
      → registerEquipmentPassives(engine, configs, { db, diagnostics })
        → weaponDataFromDb(db, config.weaponDatabaseId) → WeaponData
        → registerParadigmWeapon(engine, actorId, weaponData, diagnostics)
```

`EquipmentConfig` 现在携带 `weaponDatabaseId`（原始 gamedata ID），用于从 `db.weaponDatabase` 查找完整武器数据。

### 3. skill multiplier overlay

**优先级正确**：`applySkillMultiplierOverlay` 仅在 `!tickData.multiplier || tickData.multiplier === 0` 时填入 overlay 值。已有 non-zero multiplier 不会被覆盖。

**无误导命名**：文件注释明确"hand-entered"、"TODO: verify exact values with datamine"。`SKILL_MULTIPLIERS` 只有 2 个角色条目，不会给人"全量已接入"的错觉。

### 4. hand-written fallback 职责边界

**definitions.ts 当前职责（正确）：**
- 套装触发效果（点剑 proc / 动火用 buff / 脉冲式 buff / 潮涌 buff）
- 武器 action 函数体（典范 stacking / 蚀迹 team buff）
- 无 stats += / *= 突变

**definitions.ts 不再承担（正确已移除）：**
- trigger event type / condition / ICD — 改由 `weaponDataAdapter` 从 JSON 构建
- 静态词条 — 由 timelineStore delta 处理

---

## 确认无问题的检查项

| 检查项 | 结果 |
|---|---|
| 典范 trigger/condition/ICD 来自 JSON | 通过 `registerWeaponFromData` + `buildTriggerFromMetadata` |
| JSON 与 hand-written 冲突有 diagnostics | `WEAPON_TRIGGER_UNKNOWN` / `WEAPON_TRIGGER_NO_ACTION` / `WEAPON_EFFECTS_JSON_NOT_AUTO` |
| `applySkillMultiplierOverlay` 不覆盖已有 multiplier | `!tickData.multiplier \|\| tickData.multiplier === 0` 守卫 |
| db 链路从 runSimulation 到 registerEquipmentPassives | options.db → simulate → registerEquipmentPassives({ db }) |
| 无 stats += 残留 | grep 确认 |
| `buildTriggerCondition` 类型安全 | 所有 case 都有 `e.type !== "XXX"` 前置检查 |

---

## 仍保留的 TODO

| 问题 | 优先级 | 说明 |
|---|---|---|
| 更多真实角色技能 multiplier | **P0 — 第九阶段** | 当前仅 2 角色估算值，需实机确认并扩充 |
| UI 层传入 options.db | **P0** | timelineStore 调用 runSimulation 时需传入 `{ db: gamedata }` |
| deterministic crit / rng seed | **P1** | 集成测试依赖 `crit_rate: -100` hack |
| 蚀迹武器 ID 未确认 | P1 | gamedata 中是"作品：蚀象"(wpn_funnel_0006)，需确认映射 |
| 套装触发效果无 JSON 数据源 | P1 | equipmentCategoryConfigs 无触发条件/效果数据 |
| JSON `effects[]` → auto action 生成 | P2 | 当前所有 effects 仍需 hand-written fallback |
| 更多 TRIGGER_EVENT_MAP 条目 | P2 | 38 种 trigger 中映射了 16 种 |
| 更多 boss / enemy 真值模板 | P2 | 需要游戏数据补充 defense/resist/immunities |

---

## 第九阶段阻塞风险

**无阻塞**。理由：

1. `weaponDataAdapter` 接口稳定 — 新增武器只需添加 fallback action + registry 映射
2. `TRIGGER_EVENT_MAP` 可自由扩展 — 新增 trigger 字符串不影响现有映射
3. `SKILL_MULTIPLIERS` 是纯数据 — 新增角色零风险
4. `GameDatabase` 类型已定义 — UI 传入 `{ db: gamedata }` 只需一行改动
5. `options.db` 链路完整 — 从 runSimulation 到 registerEquipmentPassives 无断点
6. deterministic crit 可通过在 DamageResolver 添加 engine-level rng seed 解决，不影响现有接口
