# T5 runtime_conditional 第一批接入点审计

---

## A. `_activeEffects` 到 simulation 的现状

### 当前消费点

**唯一消费者**：`simulator.ts` L88-117

```
actor.stats._activeEffects
  → filter: scope === "runtime_passive" && type === "damage_bonus"
  → 创建 permanent Effect with dynamicBonuses (zone="fragility")
  → actorState.effects.add()
```

过滤条件非常窄——只取 `runtime_passive` + `damage_bonus`。所有 `runtime_conditional` 全部被跳过。

### 设值点

`timelineStore.js` line 628：`resolveTrackConfiguredStats()` 将 `resolveTrackActiveEffects()` 的全部 effects 写入 `result._activeEffects`。包含所有 scope（static / runtime_passive / runtime_conditional / parsed_unimplemented），但只有 runtime_passive 的 damage_bonus 被 simulator.ts 消费。

### 适合复用的接入点

simulator.ts 的 runtime_passive 注册块（L69-98）之后，是 runtime_conditional 的最佳接入位置。理由：
- 时机正确：在 `engine.run()` 之前注册，保证整个 simulation 生效
- 模式一致：武器被动也在此阶段通过 `registerEquipmentPassives()` 注册
- actor 和 _activeEffects 都已就绪

### 不适合复用的路径

| 路径 | 原因 |
|---|---|
| 旧 EFFECT_START → ReactionRegistry | 只产出 tag-only Effect，不进伤害公式 |
| `_calcHitDamage` (damageSummary) | 独立简化公式，不是 simulation 主路径 |
| `_buildRawDebuffSegments` | 编译期效果段，不消费运行时状态 |

---

## B. 现有 buff/debuff/duration/trigger 机制盘点

### 可直接复用的机制

| 机制 | 文件 | 状态 | 适合 conditional |
|---|---|---|---|
| **EffectTrigger** | `effects/types.ts` | 生产就绪 | **是** — 事件匹配 + 条件回调 + 动作执行 |
| **TriggerProcessor** | `engine/TriggerProcessor.ts` | 生产就绪 | **是** — 每个事件后自动评估所有 trigger |
| **registerPassiveEffect** | `engine/SimulationEngine.ts:100` | 生产就绪 | **是** — 注册永久载体 Effect 到 actor |
| **addOrRefreshBuff** | `equipment/types.ts:139` | 生产就绪 | **是** — 不叠加、刷新持续时间 |
| **addStackWithIndependentDuration** | `equipment/types.ts:167` | 生产就绪 | **是** — 独立持续时间叠层 |
| **dynamicBonuses** | `equipment/types.ts:71` | 生产就绪 | **是** — 支持全部 zone 和 stat |
| **isEffectActive** | `equipment/types.ts:209` | 生产就绪 | **是** — 伤害时自动过滤过期 buff |
| **sweepExpired** | `state/EffectManager.ts:75` | 生产就绪 | **是** — 时间推进时自动清理 |
| **cooldownId + cooldownDuration** | `TriggerProcessor.ts` | 生产就绪 | **是** — per-actor ICD |

### 武器触发 buff 的完整模式（可直接复用）

```
注册阶段（engine.run() 之前）：
  engine.registerPassiveEffect(actorId, new Effect({
    id: "talent_xxx",
    tags: [],
    duration: Infinity,  // 载体永久存在
    triggers: [{
      event: "DAMAGE_TICK",  // 监听哪种事件
      sourceMustBeWearer: true,
      cooldownId: "talent_xxx_icd",
      cooldownDuration: 0,
      condition: (e, ctx) => { /* 条件判定 */ },
      action: (e, ctx) => {
        addOrRefreshBuff(actorState.effects, new Effect({
          id: "talent_xxx_buff",
          duration: 15,
          startTime: ctx.state.getCurrentTime(),
          properties: {
            dynamicBonuses: [{ stat: "all_dmg", value: 15, zone: "attackPercent" }]
          }
        }));
      }
    }]
  }));

运行阶段（自动）：
  事件触发 → TriggerProcessor 评估 → 条件通过 → action 执行 → buff 创建
  → 伤害时 aggregateAttackBonuses / aggregateDynamicBonuses 自动聚合
  → buff 到期 → sweepExpired 自动清理
```

### 不建议复用的机制

| 机制 | 文件 | 原因 |
|---|---|---|
| ReactionRegistry | `mechanics/reactions.ts` | 只处理元素/物理反应，不适合天赋条件 |
| AfflictionEffectMap | `effects/afflictionEffectMap.ts` | 预定义 tag-only Effect，无 dynamicBonuses |
| EffectStartHandler | `events/EffectStartHandler.ts` | 旧路径入口，主循环已不依赖 |

---

## C. 第一批 runtime_conditional 候选与优先级

### 全部 26 个 runtime_conditional 效果按触发条件分类

| 触发模式 | 数量 | 角色 | 复杂度 |
|---|---|---|---|
| 施加燃烧后 → self blaze_dmg buff | 2 | WULFGARD | **低** — 已有 APPLY_DIRECT_ANOMALY 事件 |
| 技能命中后 → self ATK% stack | 2 | CHENQIANYU | **低** — 已有 DAMAGE_TICK 事件 |
| 源石结晶被消耗后 → self ATK% buff | 2 | ENDMINISTRATOR | 中 — 需要跟踪结晶消耗事件 |
| 消耗破防层后 → self physical_dmg stack | 2 | DAPAN | 中 — 需要跟踪破防消耗 |
| 受到伤害后 → self ATK% stack | 2 | EMBER | 中 — 当前无"受伤"事件 |
| 每恢复 80 SP 后 → self ATK% + artsPower stack | 2 | POGRANICHNK | 中高 — 需要累计 SP 追踪 |
| 概率免疫法伤后 → self ATK% buff | 2 | FLUORITE | 高 — 概率触发 + 免疫判定 |
| 战技命中 → target DOT + debuff | 2 | ROSSI 斫痕 | **高** — DOT + 复合 debuff |
| 对特定状态目标暴击 → extra damage | 2 | ROSSI 沸血 | 高 — 多条件链 |
| 终结技追加冲击波 | 2 | CATCHER | 高 — 额外伤害实例 |
| 造成倒地 → extra damage | 2 | LIFENG | 高 — 额外伤害 + 物理异常触发 |
| on-hit → gauge gain | 4 | AVYWENNA, ALESH | 独立 — 需改 gauge 系统 |

### 优先级排序

**P0（第一批，最通用最低风险）：**

| # | 角色 | 天赋 | 触发 | 效果 | 持续 | 叠加 | 理由 |
|---|---|---|---|---|---|---|---|
| 1 | WULFGARD | 灼热獠牙 | 施加燃烧后 | blaze_dmg +20/30% | 10s | 不叠加 | 已有 `APPLY_DIRECT_ANOMALY` 事件，与武器 `on_burning_apply` 完全同模式 |
| 2 | CHENQIANYU | 斩锋 | 技能命中后 | ATK +4/8% | 10s | 最多5层 | 已有 `DAMAGE_TICK` 事件，与武器 `on_skill_or_ultimate_hit` 同模式 |

**选择理由**：
- 触发事件已存在（无需新事件类型）
- 武器系统已有完全相同的触发模式可参考
- 不需要角色专属特判
- 覆盖了两种最常见的 buff 模式（不叠加刷新 + 独立持续时间叠层）
- 覆盖了两种 bonus 类型（damage_bonus + attackPercent）

**P1（第二批，需少量扩展）：**

| # | 角色 | 天赋 | 需要什么 |
|---|---|---|---|
| 3 | ENDMINISTRATOR | 本质瓦解 | 需要"源石结晶消耗"事件（可挂在 EFFECT_END 或自定义） |
| 4 | DAPAN | 勾芡 | 需要"破防层消耗"事件（可挂在物理反应 outcome） |
| 5 | EMBER | 以铁还铁 | 需要"actor 受伤"事件（当前无此事件类型） |

**暂不做：**

| 角色 | 原因 |
|---|---|
| ROSSI 斫痕/沸血 | 复合 DOT + 条件链 |
| CATCHER 全局思维 | 额外伤害实例，不是 buff |
| LIFENG 伏魔 | 额外伤害 + 物理异常联动 |
| FLUORITE 捉摸不定 | 概率触发 |
| POGRANICHNK 活着的旗帜 | SP 累计阈值追踪 |
| AVYWENNA/ALESH | gauge 系统，非伤害 |

---

## D. schema 最小需求

### 当前 effects[] 已有的字段

```json
{ "type": "stat_bonus", "stat": "attack_percent", "value": 15, "unit": "percent", "scope": "runtime_conditional", "note": "conditional buff" }
```

已有 `type`、`stat`、`value`、`unit`、`scope`、`note`。

### 第一批是否需要补字段

**第一批不需要补 schema 字段。**

理由：第一批采用与武器被动完全相同的模式——**代码驱动注册，数据驱动数值**：
- 触发逻辑（事件类型、条件、持续时间、叠加行为）在代码中实现（类似 `equipment/definitions.ts`）
- 数值（value）从 `effects[]` 读取

这与武器系统完全一致：`definitions.ts` 硬编码每把武器的触发逻辑，但数值来自 `gamedata.json`。

### 后续可能需要补的字段（不在第一批）

| 字段 | 用途 | 何时补 |
|---|---|---|
| `trigger` | 标准化触发类型（如 `"on_burn_apply"`） | 当通用 effect type 足够多（>5）时 |
| `duration` | 持续秒数 | 同上 |
| `target` | `"self"` / `"enemy"` / `"team"` | 同上 |
| `maxStacks` | 最大叠加层数 | 同上 |
| `stackBehavior` | `"refresh"` / `"independent"` | 同上 |

这些字段留待第二批或通用解释层建立时统一补入。第一批仅用 2 个天赋，不值得为此建立泛型 schema。

---

## E. 最小改动实施方案（仅方案，不实施）

### 接入点

`simulator.ts` 的 runtime_passive 注册块之后（L98 后），新增 runtime_conditional 注册块。

### 模式

完全复用武器被动模式：
1. 对每个 actor 检查 `_activeEffects` 中 `scope === "runtime_conditional"` 的 effects
2. 根据 actor ID 匹配到对应的注册函数
3. 注册函数创建带 EffectTrigger 的永久载体 Effect
4. 通过 `engine.registerPassiveEffect(actorId, effect)` 或 `actorState.effects.add()` 注册
5. 后续由 TriggerProcessor 自动处理

### 第一批范围

仅 2 个天赋，4 个 effect entries（2 天赋 × 2 stages）：
1. WULFGARD 灼热獠牙：`on_burn_apply → self blaze_dmg +20/30%, 10s, no stack`
2. CHENQIANYU 斩锋：`on_skill_hit → self ATK +4/8%, 10s, max 5 stacks`

### 预计改动文件

| 文件 | 改什么 | 行数估计 |
|---|---|---|
| `simulator.ts` | runtime_passive 块后新增 runtime_conditional 注册块，根据 actorId 分派到注册函数 | ~30 行 |

注册逻辑可直接写在 simulator.ts 中（仅 2 个天赋），无需新建文件。当后续支持 >5 个天赋时再考虑抽出独立 adapter 文件。

### 不新增的文件/结构

- 不新建 `talentDataAdapter.ts`（第一批仅 2 个，不值得）
- 不新建 `talentDefinitions.ts`（同上）
- 不新建 registry / effect 映射表
- 不修改 talents.json schema

### 具体实现要点

**WULFGARD 灼热獠牙**：
- 载体 Effect：`id: "talent_wulfgard_blazing_fangs"`, `duration: Infinity`, `triggers: [...]`
- Trigger：`event: "APPLY_DIRECT_ANOMALY"`, condition: `anomalyType === "burn" && sourceActorId === actorId`
- Action：`addOrRefreshBuff(actorState.effects, new Effect({ id: "wulfgard_blaze_buff", duration: 10, dynamicBonuses: [{ stat: "blaze_dmg", value: effectValue }] }))`
- value 从 `_activeEffects` 中读取

**CHENQIANYU 斩锋**：
- 载体 Effect：`id: "talent_chenqianyu_slash_edge"`, `duration: Infinity`, `triggers: [...]`
- Trigger：`event: "DAMAGE_TICK"`, `sourceMustBeWearer: true`, condition: 检查 action type 是 skill/link/ultimate
- Action：`addStackWithIndependentDuration(actorState.effects, new Effect({ id: "chenqianyu_atk_stack_N", duration: 10, dynamicBonuses: [{ stat: "all_dmg", value: effectValue, zone: "attackPercent" }], stackGroup: "chenqianyu_slash" }), "chenqianyu_slash", 5, time)`
- value 从 `_activeEffects` 中读取

### 风险点

| 风险 | 防范 |
|---|---|
| ATK% buff 与 configuredStats 的 attack_percent 重复 | 不会——configuredStats 的 ATK% 在 base attack 公式中已乘过；dynamicBonuses 的 `zone: "attackPercent"` 是独立乘区，两者互不干扰 |
| 只支持 2 个天赋，其他天赋用户期待也生效 | 在 diagnostics 中标注哪些 runtime_conditional 未被支持 |
| 注册函数直接写在 simulator.ts 导致文件膨胀 | 仅 ~30 行，在可控范围；后续扩展到 >5 个时抽出独立文件 |

### 验证方法

1. WULFGARD 在排轴上放战技（施加燃烧）→ 后续灼热伤害应 +20/30%
2. CHENQIANYU 在排轴上放多次战技 → 每次命中后 ATK 叠层，最多 5 层
3. 对比"伤害统计"按钮的结果，有无天赋效果时伤害差异应与理论值一致

### 明确 out of scope

- 不做通用 conditional 解释器
- 不修改 talents.json schema
- 不支持 P1/暂不做的天赋
- 不支持 gauge_modifier
- 不做 UI 变化
- 不清理旧代码
- 不做归因/贡献拆分
