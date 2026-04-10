# 上线前数据清单 + 处理中 Tag 实现报告

> 时间：2026-03-31
> 基线：266 tests pass, 0 TS errors

---

## 一、上线前数据清单

### A. 必须有（没有就不适合上线）✅ 全部就绪

| 项目 | 状态 | 说明 |
|---|---|---|
| simulation 主链 | ✅ | `runSimulation` → compile → simulate → damage output 完整可用 |
| DamageResolver + 11 乘区 | ✅ | 全部实现（defense/crit/dmgBonus/amplify/combo/vuln/fragility/resist/break/reduction/special） |
| 攻击力公式 | ✅ | `computeEffectiveAttack` 已验证（含 truncation + floor） |
| 暴击系统 | ✅ | `resolveCrit` + seeded RNG |
| 异常/附着/反应 | ✅ | 法术附着、物理异常、燃烧/冻结/导电/腐蚀/碎冰全部接入 |
| SP/gauge 资源系统 | ✅ | refundSP 双池 + SP→gauge 充能 + gauge 消耗 |
| gamedata tick 结构 | ✅ | 24/25 角色有 skill ticks，23/25 有 link ticks，20/25 有 ult ticks |
| 伤害汇总 UI | ✅ | `DamageSummaryPanel` 按角色/技能展示，实时更新 |
| 干员/武器/装备面板 | ✅ | 从 gamedata + timelineStore delta 汇总到 `ActorSnapshot.stats` |

### B. 可后补（不阻塞上线）

| 项目 | 说明 |
|---|---|
| 18 个角色无 multiplier overlay | 这些角色的技能 damage = 0（multiplier 未填），不影响已有角色 |
| skill level 全量覆盖 | 当前仅存 M3 级，1-9/M1/M2 未逐级写入 |
| 角色专属 conditional branch | LAEVATAIN ult phase override、ESTELLA 冻结/非冻结分支等 |
| 召唤物/持续体伤害 | AVYWENNA 雷枪 per-buff-instance damage |
| reduction zone / special zone | 当前返回 1.0，待敌人具体减伤数据 |
| boss 防御/抗性真值 | gamedata 无此字段，当前用默认值 |

### C. 应标注"处理中"的技能

| 角色 | 技能 | 原因 |
|---|---|---|
| ENDMINISTRATOR | skill/link/ultimate | estimated multiplier（初始估值，非 wiki 真值） |
| CHENQIANYU | skill/link/ultimate | estimated multiplier |
| GILBERTA | skill/link/ultimate | estimated multiplier |
| ESTELLA | skill/link/ultimate | estimated multiplier |
| POGRANICHNK | skill/link/ultimate | estimated multiplier |
| ALESH | link | verified base，但 per-level 未完整覆盖 |
| ARCLIGHT | skill | verified base，但 conditional extra hit (conduction consume) 为阶段性实现 |
| AVYWENNA | skill | 雷枪/强雷枪 per-buff-instance damage 未接入 |

**不标处理中的**：ARCLIGHT ultimate（verified, 无 conditional branch，2 tick 完全对齐）

---

## 二、处理中 Tag 实现

### 改了哪些文件

| 文件 | 修改 |
|---|---|
| `simulation/data/skillStatusRegistry.ts` (新) | 从 `SKILL_MULTIPLIERS` 派生状态，不新建真值源 |
| `components/ActionItem.vue` | +import + `skillStatus` computed + template tag + CSS |

### 状态数据从哪来

`skillStatusRegistry.ts` 读取 `SKILL_MULTIPLIERS`：
- entry.status === `"verified"` 且不在 `WIP_OVERRIDES` → `"supported"`（不显示 tag）
- entry.status === `"estimated"` 或在 `WIP_OVERRIDES` → `"wip"`（显示"处理中"）
- 无 entry → `null`（不显示 tag，因为没有 multiplier 数据）

`WIP_OVERRIDES` 用于覆盖：已验证 base 但专属机制未完整接入的技能（如 ALESH link、ARCLIGHT skill、AVYWENNA skill）。

### 当前显示"处理中"的技能

全部 estimated 条目（5 角色 × 3 技能 = 15 条）+ 3 条 WIP override = **18 个技能显示"处理中"**。

ARCLIGHT ultimate 不显示（verified，无 override）。

### 是否引入新双真值源

**否**。`skillStatusRegistry.ts` 是纯派生层，从 `SKILL_MULTIPLIERS` 读取，不存储独立真值。`WIP_OVERRIDES` 是轻量临时 map，仅用于 UI 状态标注。

### 界面示例

```
[ 构成序列 处理中 ]    ← estimated multiplier，黄色小 tag
[ 锁闭序列 处理中 ]    ← WIP override (ALESH enhanced variant)
[ 轰雷掣电 ]           ← verified, 无 tag
```

Tag 样式：7px 字号，黄色半透明背景 + 黄色文字，紧跟技能名右侧。不影响交互。
