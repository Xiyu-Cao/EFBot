# Phase 10 Report

251 tests pass, 0 TypeScript errors.

---

## 核心成果

### A. Skill Multiplier 真值状态标记

**修改文件**: `data/skillMultipliers.ts`

新增 `MultiplierTruthStatus` 类型和 `status` 字段：

```typescript
type MultiplierTruthStatus = "verified" | "estimated";

interface SkillMultiplierEntry {
  multipliers: number[];
  status: MultiplierTruthStatus;
  source?: string;  // e.g. "datamine v1.2"
}
```

| 角色 | 技能数 | 当前状态 | 说明 |
|---|---|---|---|
| ENDMINISTRATOR | skill/link/ult | estimated | initial estimate, needs in-game verification |
| CHENQIANYU | skill/link/ult | estimated | initial estimate |
| GILBERTA | skill(5)/link/ult | estimated | 5-tick pattern observed in gamedata |
| ESTELLA | skill/link/ult | estimated | initial estimate |
| POGRANICHNK | skill(2)/link(3)/ult(6) | estimated | tick patterns from gamedata |

新增查询工具：
- `getSkillMultiplierEntry(charId, actionType)` — 返回完整 entry（含 status）
- `getEntriesByStatus("estimated")` — 列出所有待验证条目（当前 15 个）

### B. timelineStore Set Bonus 自动检测

**修改文件**: `stores/timelineStore.js`

`simulation` computed 中新增套装检测逻辑：
1. 读取每个 track 的 4 个装备槽 ID
2. 在 `equipmentDatabase` 中查找每个 ID 的 `category`
3. 按 category 计数，3+ 件同类 → 通过 `CATEGORY_TO_SET` 映射到 setId
4. `equipmentDatabase` 缺失时 graceful skip

**支持的套装**：点剑/动火用/脉冲式/潮涌（与 `CATEGORY_TO_SET_ID` 映射一致）

**之前**：`setId: undefined // TODO`
**之后**：自动检测，无需用户手动配置

### C. runSimulation rng options 透传

**修改文件**: `compiler/compileScenario.ts`, `runSimulation.ts`

```typescript
// CompileOptions 新增 rng 字段
interface CompileOptions {
  systemConstants?: Partial<SystemConstants>;
  db?: GameDatabase;
  rng?: SimulationRngOptions;
}

// 使用
runSimulation(scenario, {
  rng: { seed: 42 },         // deterministic
  rng: { deterministicCrits: "neverCrit" },  // force no crit
});
```

### D. 清理 crit_rate:-100 hack

**修改文件**: `calculation/phase8.test.ts`

2 处 `crit_rate: -100` 已替换为 `engine.rng = buildRng({ deterministicCrits: "neverCrit" })`。

---

## 修改文件清单

| 文件 | 操作 | 要点 |
|---|---|---|
| `data/skillMultipliers.ts` | MODIFIED | MultiplierTruthStatus, status 字段, getEntriesByStatus, getSkillMultiplierEntry |
| `stores/timelineStore.js` | MODIFIED | 套装自动检测（CATEGORY_TO_SET + category 计数） |
| `compiler/compileScenario.ts` | MODIFIED | CompileOptions.rng 字段 |
| `runSimulation.ts` | MODIFIED | 透传 options.rng 到 simulate |
| `calculation/phase8.test.ts` | MODIFIED | crit_rate:-100 → neverCrit |
| `calculation/phase10.test.ts` | NEW | 13 个新测试 |

---

## 新增测试 (13 个)

| 测试组 | 数量 | 覆盖 |
|---|---|---|
| Truth Status | 4 | 所有 entry 有 status、estimated 全量查询、verified 为空、entry 含 status |
| Set Bonus Detection | 4 | 3+ 同类激活、<3 不激活、无 db graceful skip、weapon+set 组合 |
| runSimulation rng | 2 | seed 可复现、neverCrit 透传 |
| Overlay Boundary | 3 | 不覆盖非零 multiplier、填充零 multiplier、unknown 角色不改 |

---

## 技能样本真值状态

| 标记 | 数量 | 含义 |
|---|---|---|
| `estimated` | 15 entries (5 chars × 3 actions) | 初始估算值，待人工核对 |
| `verified` | 0 | 尚无经过验证的值 |

**后续人工核对流程**：
1. 调用 `getEntriesByStatus("estimated")` 获取待验证清单
2. 在游戏中实测实际倍率
3. 更新 `multipliers` 数组并将 `status` 改为 `"verified"`
4. 填写 `source` 字段（如 "in-game test 2025-03-24"）

---

## 仍保留的 TODO

| 问题 | 优先级 | 说明 |
|---|---|---|
| 15 个 skill multiplier 实机核对 | **P0** | 所有值为 estimated |
| timelineStore CATEGORY_TO_SET 硬编码 | P1 | 与 registry 的 CATEGORY_TO_SET_ID 重复，应改为共享导入 |
| 蚀迹武器 ID 不匹配 | P1 | gamedata 中是"作品：蚀象"(wpn_funnel_0006)，需确认 |
| 更多 TRIGGER_EVENT_MAP 条目 | P2 | 38 种中映射 16 种 |
| 更多 boss / enemy 真值 | P2 | 需游戏数据补充 defense/resist/immunities |

---

## 下一阶段建议

1. **实机核对 skill multipliers** — 逐步把 estimated 改为 verified，这是数值可信度的关键
2. **共享 CATEGORY_TO_SET** — 从 registry.ts 导出供 timelineStore 使用，消除重复
3. **更多角色扩展** — 在 verified 的基础上扩展新角色
4. **完整 UI 集成测试** — 用真实 gamedata.json 跑一个端到端 scenario 验证所有链路
