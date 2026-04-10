# 第三阶段重构报告：反应/附着子系统骨架

> 生成日期：2026-03-24
> 目标：建立附着/异常/反应子系统的最小闭环，为后续伤害标签词典和完整公式接入打基础
> 说明：本轮未修改 UI，未修改 timelineStore.js

---

## 修改文件清单

### 修改的文件

| 文件 | 变更 |
|---|---|
| `events/event.types.ts` | SimEvent union 新增 `AnomalyEvent`（4 种）；SimLogEntry 新增 `ANOMALY_STATUS_CHANGE` 和 `ANOMALY_DAMAGE` |
| `state/EnemyState.ts` | 新增 `status: EnemyStatusState` 字段（组合模式）；`advanceTime()` 中调用 `status.advanceTime()` |
| `engine/createEngine.ts` | 注册 4 个新 anomaly handler |

### 新增的文件

| 文件 | 用途 |
|---|---|
| `anomaly/types.ts` | 全部类型定义：`MagicElement`、`PhysicalAnomalyType`、`AnomalyDebuffType`、各状态接口、查找表、`ResolverOutcome`、**`DamageTags`** |
| `anomaly/EnemyStatusState.ts` | 状态类：法术附着（叠层/过期/清除）、物理破防（叠层/清除）、燃烧（施加/覆盖/tick）、冻结（施加/碎冰）、导电（施加/覆盖）、腐蚀（施加/推进/resistDown 保留） |
| `anomaly/MagicReactionResolver.ts` | 解析：无附着→添加、同元素→爆发、异元素→异常+伤害。导出共享函数 `applyAnomalyDebuff()` |
| `anomaly/PhysicalReactionResolver.ts` | 解析：无破防→添加、有破防→按类型处理、冻结碎冰检查 |
| `anomaly/DirectAnomalyApplier.ts` | 直接施加异常 debuff，不产生反应伤害 |
| `anomaly/events.ts` | 4 种事件类型：`APPLY_MAGIC_ATTACHMENT`、`APPLY_PHYSICAL_ANOMALY`、`APPLY_DIRECT_ANOMALY`、`ANOMALY_DAMAGE` |
| `anomaly/AnomalyHandlers.ts` | 4 个 EventHandler 类，委托 resolver 处理，将 outcome 转为 log/事件 |
| `anomaly/anomaly.test.ts` | 21 个测试，覆盖全部 10 个要求场景 |

---

## 新增的状态 / 事件 / Resolver

### 敌方状态子结构（EnemyStatusState）

```
EnemyState
  └── status: EnemyStatusState
        ├── magicAttachment: { element, stacks(1-4), expiresAt } | null
        ├── physicalBreak:   { stacks(1-4), expiresAt } | null
        ├── burn:            { level, expiresAt, lastTickTime, sourceActorId } | null
        ├── freeze:          { level, expiresAt, shattered, sourceActorId } | null
        ├── conduction:      { level, expiresAt, sourceActorId } | null
        └── corrosion:       { level, expiresAt, currentResistDown, perSecondDelta, maxResistDown, sourceActorId } | null
```

### 新增事件

| 事件类型 | Payload | 用途 |
|---|---|---|
| `APPLY_MAGIC_ATTACHMENT` | `{ element, sourceActorId, targetId, sourceSkillId? }` | 施加法术附着 |
| `APPLY_PHYSICAL_ANOMALY` | `{ physicalType, sourceActorId, targetId, sourceSkillId? }` | 施加物理异常 |
| `APPLY_DIRECT_ANOMALY` | `{ anomalyType, level, sourceActorId, targetId, sourceSkillId? }` | 直接施加异常 debuff |
| `ANOMALY_DAMAGE` | `{ damage, tags: DamageTags }` | 反应/DOT 产生的伤害 |

### Resolver 调用链

```
APPLY_MAGIC_ATTACHMENT
  → ApplyMagicAttachmentHandler
    → resolveMagicAttachment(status, element, actor, time)
      ├── Case 1: 无附着 → 添加 1 层
      ├── Case 2: 同元素 → 叠层 + MAGIC_BURST_DAMAGE
      └── Case 3: 异元素 → 清空 + applyAnomalyDebuff + REACTION_DAMAGE
    → emitOutcomes → ANOMALY_DAMAGE events + ANOMALY_STATUS_CHANGE logs

APPLY_PHYSICAL_ANOMALY
  → ApplyPhysicalAnomalyHandler
    → resolvePhysicalAnomaly(status, physicalType, actor, time)
      ├── 冻结碎冰检查 → ICE_SHATTER_DAMAGE
      ├── 无破防 → 添加 1 层
      └── 有破防 → 按 launch/knockdown/armorBreak/slam 分支处理
    → emitOutcomes

APPLY_DIRECT_ANOMALY
  → ApplyDirectAnomalyHandler
    → applyDirectAnomaly(status, type, level, actor, time)
      └── 只施加 debuff，不产生反应伤害
    → emitOutcomes
```

---

## 新增测试（21 个）

| # | 测试 | 覆盖要求 |
|---|---|---|
| 1 | 无附着时添加 1 层 | 要求 1 |
| 2 | 同元素叠层 + 产生爆发伤害 | 要求 2 |
| 3 | 叠层上限 4 仍产生爆发 | 要求 2 |
| 4 | 同元素刷新持续时间 | 要求 2 |
| 5 | 异元素清空 + 异常 debuff + 反应伤害 | 要求 3 |
| 6 | 直接施加异常只产生 debuff 不产生伤害 | 要求 4 |
| 7 | 直接施加冻结 | 要求 4 |
| 8 | 冻结 + 物理异常 → 碎冰 | 要求 5 |
| 9 | 一次冻结只碎冰一次 | 要求 5 |
| 10 | 无破防时物理异常添加 1 层 | 要求 6 |
| 11 | launch 有破防时叠层 + 伤害 | 要求 7 |
| 12 | knockdown 有破防时叠层 + 伤害 | 要求 7 |
| 13 | armorBreak 清破防 + 物理易伤 | 要求 7 |
| 14 | slam 清破防无易伤 | 要求 7 |
| 15 | 燃烧低等级覆盖高等级 | 要求 8 |
| 16 | 腐蚀 currentResistDown 不回退 | 要求 9 |
| 17 | 腐蚀 maxResistDown 只增不减 | 要求 9 |
| 18 | 无异常事件时引擎正常运行 | 要求 10 |
| 19 | 异常事件与普通事件混合运行 | 要求 10 |
| 20 | 完整异元素反应集成测试 | 要求 3 + 10 |
| 21 | 冻结 + 物理碎冰集成测试 | 要求 5 + 10 |

---

## DamageTags 骨架预留的接口

`DamageTags`（位于 `anomaly/types.ts`）当前字段：

| 字段 | 类型 | 用途 | 状态 |
|---|---|---|---|
| `sourceActorId` | `string` | 伤害来源角色 | 已就位 |
| `targetId` | `string` | 目标 | 已就位 |
| `sourceSkillId` | `string?` | 来源技能 | 可选，已预留 |
| `sourceEffectId` | `string?` | 来源效果 | 可选，已预留 |
| `originType` | union | 伤害分类 | 已就位，等待词典扩展 |
| `damageElement` | union | 元素学校 | 已就位 |
| `canCrit` | `boolean` | 能否暴击 | 已就位（碎冰=true，燃烧=false） |
| `isDot` | `boolean` | 是否 DOT | 已就位 |
| `provisional` | `Record?` | 实验性标签 bag | 已预留 |

`originType` 当前支持的值：

- `skill` — 技能直接命中
- `magic_burst` — 同元素爆发
- `magic_reaction` — 异元素反应瞬发伤害
- `physical_reaction` — 物理异常瞬发伤害
- `ice_shatter` — 碎冰伤害
- `burn_tick` — 燃烧 DOT
- `other` — 兜底

---

## 等待伤害标签词典收口的 TODO

| 位置 | TODO |
|---|---|
| `DamageTags.originType` | 扩展更多分类（如 `ultimate_hit`、`link_hit`、`skill_sub_hit` 等），等词典定稿 |
| `AnomalyHandlers.ts` 所有 `damage: 0` | 接入 DamageResolver 管道计算实际伤害值 |
| `EnemyStatusState.CORROSION_PARAMS` | 替换为真实游戏数据 |
| `BurnState.advanceBurn()` | 需要引擎层定时调用（当前只在 advanceTime 过期，DOT tick 调度未接入） |
| 导电易伤 / 腐蚀减抗 | 已存储状态值，需接入 DamageResolver 的 modifier 管道 |
| `PHYSICAL_VULN_APPLIED` | 当前只写 log，未创建实际 debuff 效果（等词典定义物理易伤的数值） |

---

## 下一阶段推荐 3 件事

### 1. 接入燃烧 DOT tick 调度

在引擎 advanceTime 或专用 handler 中定时调用 `advanceBurn()`，为每个 tick 发出 `ANOMALY_DAMAGE` 事件（`originType: "burn_tick"`, `canCrit: false`, `isDot: true`）。

### 2. 将导电/腐蚀的数值效果接入 DamageResolver

导电的易伤乘区、腐蚀的减抗乘区，作为 `CalculationPipeline` 的 modifier 读取 `EnemyStatusState`。这需要 `DamageContext` 中增加对 `EnemyStatusState` 的引用。

### 3. 最终确定伤害标签词典

收口 `DamageTags.originType` 的完整分类，然后把 `ANOMALY_DAMAGE` 的 `damage: 0` 替换为真实计算。
