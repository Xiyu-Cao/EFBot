# Phase 9 Report

238 tests pass, 0 TypeScript errors.

---

## 核心成果

### A. Deterministic Crit / Seeded RNG

**新文件**: `engine/rng.ts`

| 模式 | 使用方式 | 效果 |
|---|---|---|
| `{ seed: 42 }` | mulberry32 PRNG | 同 seed 始终产出相同 crit 序列 |
| `{ deterministicCrits: "neverCrit" }` | 固定返回 1 | 所有 crit roll 失败 |
| `{ deterministicCrits: "alwaysCrit" }` | 固定返回 0 | 所有 crit roll 成功 |
| 无参数 | Math.random | 默认随机（用户模式） |

**集成路径**:
```
simulate(timeline, configs, actors, { rng: { seed: 42 } })
  → engine.rng = buildRng(options)
    → SimulationContext.rng
      → DamageHandler → DamageContext.rng
        → DamageResolver → resolveCrit(canCrit, rate, dmg, rng)
```

不再需要 `crit_rate: -100` hack 来消除测试随机性。

### B. simulate() API 重构

旧签名: `simulate(timeline, teamConfig, enemyConfig, actors, equipmentConfigs?, db?)`

新签名: `simulate(timeline, teamConfig, enemyConfig, actors, options?: SimulateOptions)`

```typescript
interface SimulateOptions {
  equipmentConfigs?: EquipmentConfig[];
  db?: GameDatabase;
  rng?: SimulationRngOptions;
}
```

**向后兼容**: 4 参数调用（无 options）仍正常工作。

### C. 扩展技能 multiplier (3 新角色)

| 角色 | 元素 | skill ticks | 特点 |
|---|---|---|---|
| GILBERTA | nature | 5 ticks: [0.8, 0.8, 0.8, 0.8, 2.4] | 多段 + nature_attach |
| ESTELLA | cold | 1 tick: [3.0] | cold_attach + shatter + knockup |
| POGRANICHNK | physical | 2 ticks: [1.5, 1.5] | 多段物理 |

总计 5 个角色有 multiplier 数据: ENDMINISTRATOR, CHENQIANYU, GILBERTA, ESTELLA, POGRANICHNK.

### D. UI 调用入口接入 db

**修改文件**: `stores/timelineStore.js`

`simulation` computed 现在传入:
- `equipmentConfigs` — 从 tracks 提取 weaponDatabaseId
- `db` — `{ weaponDatabase, equipmentDatabase }` 从 store refs

`registerEquipmentPassives` 中新增: 当 `config.weaponId` 未设置时，自动从 `config.weaponDatabaseId` 通过 `WEAPON_ID_TO_KEY` 推导。

---

## 修改文件清单

| 文件 | 操作 | 要点 |
|---|---|---|
| `engine/rng.ts` | NEW | createSeededRng, buildRng, SimulationRngOptions |
| `engine/SimulationContext.ts` | MODIFIED | 增加 `rng: () => number` 字段 |
| `engine/SimulationEngine.ts` | MODIFIED | 增加 `rng` 字段，传入 ctx |
| `events/DamageHandler.ts` | MODIFIED | 传 `ctx.rng` 到 DamageContext |
| `simulator.ts` | MODIFIED | SimulateOptions 替代位置参数，`buildRng` 接入 |
| `runSimulation.ts` | MODIFIED | 适配新 simulate options |
| `data/skillMultipliers.ts` | MODIFIED | 新增 GILBERTA/ESTELLA/POGRANICHNK |
| `stores/timelineStore.js` | MODIFIED | simulation computed 传入 db + equipmentConfigs |
| `equipment/registry.ts` | MODIFIED | registerEquipmentPassives 自动推导 weaponKey |
| `calculation/phase9.test.ts` | NEW | 16 个新测试 |

---

## 新增测试 (16 个)

| 测试组 | 数量 | 覆盖 |
|---|---|---|
| Seeded RNG | 3 | 同 seed 一致、不同 seed 不同、范围 [0,1) |
| buildRng | 4 | neverCrit/alwaysCrit/seed/default |
| Deterministic Crit in Resolver | 3 | neverCrit 忽略高 crit rate、alwaysCrit 无视低 rate、seed 可复现 |
| Expanded Multipliers | 3 | GILBERTA 5-tick/ESTELLA 三种/POGRANICHNK 多 tick |
| Full Chain Deterministic | 2 | ESTELLA cold + magic resist + neverCrit、GILBERTA 5-tick 数值验证 |
| Engine RNG Wiring | 1 | engine.rng 通过 context 传入 DamageHandler |

---

## 已传入 options.db 的入口

| 入口 | 状态 |
|---|---|
| `runSimulation(scenario, { db })` | 已接入 |
| `simulate(timeline, ..., { db })` | 已接入 |
| `timelineStore.simulation` computed | 已接入（weaponDatabase + equipmentDatabase） |
| `SimulatorView.vue` (API flow) | 不适用（Python backend 独立路径） |

---

## 仍保留的 TODO

| 问题 | 优先级 | 说明 |
|---|---|---|
| skill multiplier 值待实机验证 | P1 | 当前所有 5 个角色的值为估算 |
| timelineStore set bonus 检测 | P1 | UI 传入的 equipConfigs 缺少 setId 自动检测（已有 TODO 注释） |
| 蚀迹武器 ID 不匹配 | P1 | gamedata 中是"作品：蚀象"非"作品：蚀迹" |
| AnomalyDamageHandler 未使用 ctx.rng | P2 | 异常伤害的 crit 仍使用 `NO_CRIT` 或无 rng |
| 更多 TRIGGER_EVENT_MAP 条目 | P2 | 38 种 trigger 中映射了 16 种 |
| 更多 boss / enemy 真值 | P2 | 需游戏数据补充 defense/resist/immunities |

---

## 下一阶段建议

1. **实机验证 skill multipliers** — 当前值为估算，优先级最高
2. **timelineStore set bonus 自动检测** — 从 equipmentDatabase 中按 category 计数
3. **AnomalyDamageHandler 接入 ctx.rng** — 让异常伤害 crit 也受 seed 控制
4. **更多角色接入** — 按需逐步扩展 SKILL_MULTIPLIERS
5. **runSimulation options.rng** — 让 runSimulation 也支持 rng options 传递
