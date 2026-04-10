# 第一批人工标注条目：定点实现审计

> 日期：2026-04-03
> 类型：定点审计（先审计再实现）

---

## A. 条目 2/3/5/6 能否不引入新系统最小落地？

### 条目 2：AVYWENNA 委婉手段（电磁脆弱 enemy debuff）— **可以**

**语义**：终结技命中后施加 6→10% 电磁脆弱，10s

**实现路径**：与现有 `spell_vulnerable`（Route 2.8）完全同构——在 simulator.ts 的 effect 路由中新增一个 `emag_fragility` 分支，往 `engine.state.enemy.effects` 添加带 `dynamicBonuses: [{ stat: "emag_dmg", value, zone: "fragility" }]` 的 Effect。

**前提**：AVYWENNA 终结技的 action data 中需要有一个 effect type 来触发此路由。当前 AVYWENNA 终结技在 fixture 中没有此 effect。需要两步：
1. talents.json：结构化 effects（替换 parsed_unimplemented）
2. simulator.ts：新增 effect type 路由（类似 spell_vulnerable）

但注意：这不是通过 talentConditionalRegistry 注册的——它是**技能本身的效果**（终结技命中施加 debuff），不是天赋触发的 buff。正确的实现路径是让 AVYWENNA 的终结技在 gamedata/action 数据中携带一个 `emag_fragility` effect，然后 simulator.ts 路由它。

**问题**：AVYWENNA 的终结技 action data 当前是否携带了这个 effect？需要在前端确认——如果技能数据里没有 `emag_fragility` effect node，需要先在 action template 里添加。

**最小改动**：
- `talents.json`：结构化 effects
- `simulator.ts`：新增 1 个 if 分支（Route 2.9）
- 不需要 talentConditionalRegistry 改动
- 不需要新事件类型

**改动文件**：
1. `data/operators/AVYWENNA/talents.json` — 替换 parsed_unimplemented
2. `simulation/simulator.ts` — 新增 `emag_fragility` effect 路由
3. 测试：`simulator.behavior.test.ts` 或新 test 验证 emag_fragility debuff 出现

---

### 条目 3：LIFENG physical_weakness（物理脆弱 enemy debuff）— **可以**

**语义**：战技第三段命中，如果敌人没有破防，施加物理脆弱

**实现路径**：当前 `physical_weakness` 作为 effect type 出现在 LIFENG 的 fixture 数据中（scenario-1.ts:448），但被 simulator.ts 跳过（UNKNOWN_EFFECT_TYPE）。修复：新增 `physical_weakness` → fragility zone 的路由，类似现有 `physical_vulnerable`（Route 2.7）。

**已确认**：
- fixture 数据中 LIFENG_skill 的 physicalAnomaly 包含 `type: "physical_weakness"`（scenario-1.ts:448, 534）
- `physical_weakness` 不在任何路由 map 中 → UNKNOWN_EFFECT_TYPE

**最小改动**：
- `simulation/simulator.ts`：新增 1 个 if 分支，将 `physical_weakness` → enemy fragility debuff（DynamicBonus `{ stat: "physical_dmg", value, zone: "fragility" }`）
- 脆弱值：固定百分比从 effect node 的 stacks 或 duration 字段读取（需确认 fixture 数据中 physical_weakness node 的结构）
- 不需要 talents.json 改动（这是技能 effect，不是天赋 effect）
- 不需要 talentConditionalRegistry

**改动文件**：
1. `simulation/simulator.ts` — 新增 `physical_weakness` 路由
2. 测试：验证 LIFENG physical_weakness debuff 出现在 enemy effects 中

---

### 条目 5：LIFENG 顿悟（static ATK% 属性缩放）— **可以**

**语义**：每点智识+意志 → ATK+0.10→0.15%。属于攻击力乘区，和装备 ATK% 同区。

**实现路径**：在 `resolveTrackConfiguredStats`（timelineStore.js:592）中，读取此天赋的结构化 effect，基于角色当前 intellect + will 计算 ATK% 加成，加入 `attack_percent`。

**当前流程**已支持 static scope 的 stat_bonus 消费（timelineStore.js:621-626）。但此天赋是**属性缩放**（每点智识+意志 → ATK%），不是固定值。需要新的 effect type 或在现有 static 消费路径中增加属性缩放逻辑。

**最小方案**：

方案 A（最小）：在 talents.json 中将 effect 结构化为 `type: "attribute_scaling_attack_percent"`，在 `resolveTrackConfiguredStats` 中加一个特殊处理分支，读取 intellect + will → 计算 ATK%。

方案 B（更干净）：在 talents.json 中结构化为一个带 `scaling` 字段的 effect：
```json
{
  "type": "stat_bonus",
  "stat": "attack_percent", 
  "scaling": { "from": ["intellect", "will"], "perPoint": 0.10 },
  "scope": "static"
}
```
在 `resolveTrackConfiguredStats` 中识别 `scaling` 字段，读取 `result.intellect + result.will`，乘以 `perPoint`，加到 `result.attack_percent`。

**改动文件**：
1. `data/operators/LIFENG/talents.json` — 结构化 effect
2. `stores/timelineStore.js` — `resolveTrackConfiguredStats` 增加 scaling 分支
3. 前端：StatsDetailOverlay 应自动反映（ATK 最终值变化）

---

### 条目 6：ARCLIGHT 荒野游人（团队电磁增伤 buff）— **可以，但需要数据+registry**

**语义**：战技触发 3 次额外效果后，根据智识提升全队电磁伤害（每点智识+0.05→0.08%），15s，不叠加

**实现路径**：这是 runtime_conditional，需要 talentConditionalRegistry。但有两个复杂点：

1. **触发条件**："战技触发 3 次额外效果后" → 需要计数器（conditionFactory），类似 POGRANICHNK 的 SP 累积
2. **buff 值是属性缩放**：value = intellect × 0.05/0.08%，不是固定值。当前 registry 从 `_activeEffects.value` 读取固定数值。需要 `bonusOverride` 来动态计算
3. **target=team**：需要对所有角色添加 buff。当前 registerTriggeredBuff 支持 `target: "self" | "enemy"`，**不支持 "team"**

**最小补口**：
- registerTriggeredBuff 需要增加 `target: "team"` 支持（改动 simulator.ts 中 trigger action 的 target 分支，复用 `applyBuffToTargets`）
- conditionFactory 需要计数 DAMAGE_TICK 中 action type=skill 的次数（每 3 次触发一次）
- bonusOverride 需要读取 actor 的 intellect 计算 value

**但"最小可测版本"可以先近似**：
- 触发条件近似为"战技命中 3 次后"（DAMAGE_TICK + action=skill, 计数器每 3 次触发）
- value 先用固定近似值（例如 intellect=200 时 200×0.08%=16%）——或在 registry 层用 bonusOverride 动态读
- target="team" 需要补口

**改动文件**：
1. `data/operators/ARCLIGHT/talents.json` — 结构化 effects
2. `simulation/data/talentConditionalRegistry.ts` — 新增 ARCLIGHT descriptor
3. `simulation/simulator.ts` — registerTriggeredBuff 增加 target="team" 分支
4. `simulation/data/talentConditionalRegistry.test.ts` — 新增测试

---

## B. 条目 4：DAPAN 勾芡 — "按实际消耗层数加层"的最小补口

### 问题定义

当前 registerTriggeredBuff 的 trigger action 每次只添加 1 个 stack（通过 addStackWithIndependentDuration）。DAPAN 需要"单次触发添加 N 个 stack"（N = 消耗的破防层数）。

### 最小补口方案

**在 TalentConditionalDescriptor 上新增一个 `stackCountResolver` 可选字段**：

```ts
interface TalentConditionalDescriptor {
  // ...existing fields...
  /** 
   * Optional: resolve how many stacks to add per trigger.
   * If omitted, adds exactly 1 stack (current behavior).
   * Receives the event and context, returns stack count.
   */
  stackCountResolver?: (e: any, ctx: any) => number;
}
```

**对应改动 registerTalentConditionals**：将 `stackCountResolver` 传入 registerTriggeredBuff 的 opts。

**对应改动 registerTriggeredBuff**（simulator.ts）：在 trigger action 中，如果 `opts.stackCount` > 1，循环调用 addStackWithIndependentDuration N 次。

**DAPAN 的 stackCountResolver**：

```ts
conditionFactory: () => {
  let lastBreakStacks = 0;
  return (e: any, ctx: any) => {
    const breakState = ctx.state.enemy.status.physicalBreak;
    if (breakState && breakState.stacks > 0) {
      lastBreakStacks = breakState.stacks;
      return false; // break still exists, no consumption yet
    }
    // physicalBreak is null → was just cleared?
    if (lastBreakStacks > 0) {
      // yes, consumption occurred
      return true;
    }
    return false;
  };
},
stackCountResolver: (e: any, ctx: any) => {
  // By the time this runs, break was already cleared
  // The conditionFactory closure has lastBreakStacks from before clear
  // But we need to pass it... 
}
```

**问题**：conditionFactory 的闭包里持有 `lastBreakStacks`，但 `stackCountResolver` 是 descriptor 级别的，不共享闭包。

**更好的方案**：不用 stackCountResolver，而是让 conditionFactory 在闭包中存储 consumed count，然后在 trigger action 中用 `actionOverride` 读取。

**最实际的最小补口**：

不改 descriptor 接口。在 registerTriggeredBuff 中新增 `opts.stackCountFn?: (e: any, ctx: any) => number`，然后在 trigger action 中循环添加：

```ts
// In registerTriggeredBuff's trigger action:
const count = opts.stackCountFn ? opts.stackCountFn(e, ctx) : 1;
for (let i = 0; i < count; i++) {
  _buffCounter++;
  addStackWithIndependentDuration(...);
}
```

然后 DAPAN 的 descriptor 用一个共享闭包工厂：

```ts
DAPAN: [
  {
    effectMatch: { type: "damage_bonus", stat: "physical_dmg" },
    carrierId: "talent_cond_dapan_gouqian",
    event: "APPLY_PHYSICAL_ANOMALY",
    // conditionFactory and stackCountResolverFactory share closure
    _factory: (() => {
      let lastBreakStacks = 0;
      return {
        condition: (e: any, ctx: any) => {
          const bs = ctx.state.enemy.status.physicalBreak;
          if (bs && bs.stacks > 0) { lastBreakStacks = bs.stacks; return false; }
          if (lastBreakStacks > 0) { const consumed = lastBreakStacks; lastBreakStacks = 0; return true; }
          return false;
        },
        stackCount: () => lastBreakStacks, // read the captured value
      };
    })(),
  }
]
```

但这不符合 descriptor 接口。需要轻微扩展。

### 推荐的最小补口（涉及文件）

| 文件 | 改动 |
|------|------|
| `simulation/simulator.ts` | registerTriggeredBuff 新增 `stackCountFn` 可选参数，trigger action 循环添加 |
| `simulation/data/talentConditionalRegistry.ts` | 1) descriptor 接口新增 `stackCountFactory` 可选字段。2) registerTalentConditionals 将其传入 registerTriggeredBuff。3) DAPAN descriptor 用 conditionFactory + stackCountFactory 共享闭包 |
| `simulation/data/talentConditionalRegistry.test.ts` | DAPAN 测试 |

总改动量：simulator.ts ~5 行，registry.ts ~40 行（含 descriptor），test ~60 行。

---

## C. 推荐实现顺序

| 顺序 | 条目 | 理由 |
|------|------|------|
| **1** | **#3 LIFENG physical_weakness** | 最简单：simulator.ts 加 1 个 if 分支。fixture 数据已有。0 新接口。 |
| **2** | **#2 AVYWENNA 委婉手段** | 同构于 physical_weakness：simulator.ts 加 1 个 if 分支 + talents.json 结构化。 |
| **3** | **#5 LIFENG 顿悟** | 数据层改动（talents.json + store），不涉及 simulation runtime。 |
| **4** | **#4 DAPAN 勾芡** | 需要先补口 registerTriggeredBuff 的 stackCountFn。改动最多但价值高。 |
| **5** | **#6 ARCLIGHT 荒野游人** | 需要补口 target="team" + conditionFactory + bonusOverride。改动最多。 |

**先做 #1 和 #2**（纯路由补口），**再做 #3**（数据层），**再做 #4**（轻微 runtime 扩展），**最后 #5**（最多改动）。

---

## D. 前端验证方式

| 条目 | 验证方式 |
|------|---------|
| #2 AVYWENNA 委婉手段 | 排轴放置 AVYWENNA 终结技 → simLog 中看到 enemy effect 出现（emag fragility）→ 后续电磁伤害在 DamageSummaryPanel 中应提升 |
| #3 LIFENG physical_weakness | 排轴放置 LIFENG 战技 → simLog 中看到 enemy effect 出现（physical fragility）→ 不再出现 UNKNOWN_EFFECT_TYPE warning → 后续物理伤害提升 |
| #5 LIFENG 顿悟 | 在 OperatorInfoPanel 或 StatsDetailOverlay 中观察 LIFENG 的 ATK 值 → 应比基础值更高（体现智识+意志的加成）→ 切换天赋等级应改变加成 |
| #4 DAPAN 勾芡 | 排轴中先积累 break stacks → 放置 slam/armorBreak 技能清除 break → simLog 中看到 DAPAN buff 出现 + 正确层数 → 后续物理伤害提升 |
| #6 ARCLIGHT 荒野游人 | 排轴放置 ARCLIGHT 战技 3 次 → simLog 看到全队 emag buff 出现 → 全队电磁伤害提升 |

---

## E. 预计新增测试

| 条目 | 测试内容 | 文件 |
|------|---------|------|
| #2 AVYWENNA | emag_fragility effect 路由 → enemy 获得 fragility debuff；值正确；持续 10s | `simulator.behavior.test.ts` 或新文件 |
| #3 LIFENG | physical_weakness effect 路由 → enemy 获得 physical fragility debuff；不再 UNKNOWN_EFFECT_TYPE | 同上 |
| #5 LIFENG 顿悟 | 属性缩放计算正确（intellect=200 + will=100 → ATK% = 300×0.15% = 0.45%）；天赋关闭时不加成 | store 层测试或 unit test |
| #4 DAPAN 勾芡 | 1) break clear 后获得正确层数 buff。2) 消耗 4 层 → 4 stack。3) 消耗 2 层 → 2 stack。4) max 4 cap。5) 10s 过期。6) 非 slam/armorBreak 不触发。7) 值从 _activeEffects 读取 | `talentConditionalRegistry.test.ts` |
| #6 ARCLIGHT | 1) 3 次战技 DAMAGE_TICK 后全队获得 emag buff。2) < 3 次不触发。3) 15s 过期。4) 不叠加（refresh）。5) value 基于 intellect | `talentConditionalRegistry.test.ts` |
