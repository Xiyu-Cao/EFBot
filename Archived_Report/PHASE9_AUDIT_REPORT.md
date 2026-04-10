# Phase 9 收口审计报告

## 结论：建议合并

238 tests pass, 0 TypeScript errors.

---

## 审查发现与修复

| # | 严重程度 | 文件 | 问题 | 修复 |
|---|---|---|---|---|
| 1 | **MEDIUM** | `anomaly/AnomalyHandlers.ts` | `AnomalyDamageHandler` 构建 `DamageContext` 时未传 `rng: ctx.rng`，导致异常伤害（如 shatter canCrit=true）的 crit roll 仍使用 `Math.random`，不受 seed 控制 | 增加 `rng: ctx.rng` 到 DamageContext |
| 2 | LOW | `stores/timelineStore.js` | simulation computed 中注释误称"extractEquipmentConfigs is called inside simulate → runSimulation"，实际 timelineStore 直接调 simulate() | 修正注释 |

---

## 确认无问题的检查项

| 检查项 | 结果 |
|---|---|
| `createSeededRng` 同 seed 一致性 | 测试覆盖 |
| `buildRng` 四种模式 | 测试覆盖：seed / alwaysCrit / neverCrit / default |
| `engine.rng` → `SimulationContext.rng` → `DamageHandler.DamageContext.rng` | 链路完整 |
| `AnomalyDamageHandler.DamageContext.rng` | **本轮修复**，现在也传 `ctx.rng` |
| `simulate()` 新签名向后兼容 | 4 参数调用（无 options）仍工作 |
| `timelineStore` 传 `db` + `equipmentConfigs` | 已接入 `weaponDatabase` + `equipmentDatabase` |
| `registerEquipmentPassives` 自动推导 weaponKey | `WEAPON_ID_TO_KEY[config.weaponDatabaseId]` fallback |
| skill multiplier overlay 不覆盖已有 multiplier | `applySkillMultiplierOverlay` 守卫 `!tick.multiplier \|\| tick.multiplier === 0` |
| 5 个角色 multiplier 覆盖边界 | 每个标注 "estimated, TODO: verify" |

---

## Phase 8 残留 crit_rate:-100 hack

`phase8.test.ts` 中 2 处仍使用 `crit_rate: -100` 而非新的 `neverCrit` 模式。这不影响正确性（两种方式结果相同），但在第十阶段清理测试时可顺手迁移。**不阻塞合并**。

---

## 仍保留的 TODO

| 问题 | 优先级 | 说明 |
|---|---|---|
| skill multipliers 实机核对 | **P0 — 第十阶段** | 5 个角色的值均为估算 |
| timelineStore set bonus 自动检测 | **P0** | `setId: undefined` + TODO 注释，UI 路径下 set bonus 不生效 |
| phase8.test.ts `crit_rate:-100` → neverCrit 迁移 | P1 | 低风险清理 |
| runSimulation 支持 rng options | P1 | 当前 runSimulation 不传 rng，只有 simulate 支持 |
| 更多 TRIGGER_EVENT_MAP 条目 | P2 | 38 种中映射 16 种 |
| 更多 boss / enemy 真值 | P2 | 需游戏数据补充 |
| 蚀迹武器 ID 确认 | P2 | gamedata 中是"作品：蚀象"非"蚀迹" |

---

## 第十阶段阻塞风险

**无阻塞**。理由：

1. seeded RNG 链路现在覆盖 DamageHandler + AnomalyDamageHandler，所有 damage path 都受 seed 控制
2. `SimulateOptions` 接口稳定 — 新增 option 字段不影响现有调用
3. `SKILL_MULTIPLIERS` 是纯数据 — 实机核对后直接更新值即可
4. timelineStore 的 set bonus TODO 是独立功能，不影响 weapon passive 链路
5. `runSimulation` 添加 rng options 只需 1 行改动
