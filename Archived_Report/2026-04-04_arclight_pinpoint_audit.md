# ARCLIGHT（荒野游人）定点审计

> 日期：2026-04-04
> 类型：定点审计（不含实现）

---

## A. 当前最值得推进的高 ROI 天赋条目

**talent_0「荒野游人」**（已从代码确认）

描述（E1）："使用战技疾风迅雷成功触发3次额外效果后，根据自身的智识，提升全队造成的电磁伤害，每点智识+0.05%，持续15秒，该效果无法叠加"

描述（E2）：同上，每点智识+0.08%

当前数据状态：`parsed_unimplemented`（talents.json:26-30, 39-43）

**为什么是高 ROI**：
- 效果类型是 `damage_bonus/emag_dmg` → 已有 mapEffectToBonus 映射路径
- 无叠加（refresh 模式）→ registerTriggeredBuff 的默认模式
- 触发条件可用 conditionFactory 闭包计数器（POGRANICHNK 已验证的模式）
- ARCLIGHT 是电磁队核心辅助位，天赋对 DamageSummaryPanel 有直接可观测影响

**talent_1「众生智慧」**：概率忽略法术附着。防御性/随机性机制，无法在 DamageSummary 中观测，ROI 极低，本轮不考虑。

---

## B. 为什么还没能进入前端可测状态

**已从代码确认的四个缺口**：

| # | 缺口 | 当前状态 | 阻塞程度 |
|---|------|---------|---------|
| 1 | `target="team"` 不存在 | registerTriggeredBuff 只支持 `"self" \| "enemy"`（simulator.ts:149, 175-177） | **主阻塞** |
| 2 | bonusOverride 无法拿到 actor stats | 签名是 `(value: number) => DynamicBonus[]`（talentConditionalRegistry.ts:97） | **次阻塞** |
| 3 | 天赋数据未结构化 | `parsed_unimplemented`（talents.json:26-30） | 数据层 |
| 4 | 无 ARCLIGHT 注册条目 | TALENT_CONDITIONAL_TRIGGERS 中无 ARCLIGHT key | 缺注册 |

---

## C. 最接近落在哪条现有主链

**registerTriggeredBuff + conditionFactory 主链**（已从代码确认）

与以下已落地条目的模式最近：

| 对比项 | POGRANICHNK 活着的旗帜 | ARCLIGHT 荒野游人 |
|--------|----------------------|-----------------|
| 触发事件 | SP_CHANGE | DAMAGE_TICK |
| 条件 | 闭包累加器（每 80 SP） | 闭包计数器（每 3 次额外效果） |
| 效果 | ATK% self buff, 叠层 | emag_dmg **team** buff, 刷新 |
| bonusOverride | 不需要 | 需要（智识缩放） |
| target | self（默认） | **team（不存在）** |

差异点只有两处：target="team" 和 bonusOverride 需要 actor stats。其余完全复用现有主链。

---

## D. 当前最小真实阻塞点

### D1. `target="team"`（主阻塞）

**已从代码确认**：

registerTriggeredBuff（simulator.ts:175-177）：
```typescript
const targetEffects = opts.target === "enemy"
  ? ctx.state.enemy.effects
  : ctx.state.getActor(actorId).effects;
```

只有 `"enemy"` 和默认 `"self"` 两条路径。无 `"team"` 分支。

**但基础设施已存在**：
- `ctx.state.getAllActors()` 方法存在（GameState.ts:52-54），返回所有 ActorState
- EffectManager 上的 `addOrRefreshBuff()` / `addStackWithIndependentDuration()` 在所有 actor 上都可用

**最小补口**：在 action callback 中加一个 `else if (opts.target === "team")` 分支，循环 `ctx.state.getAllActors()` 对每个 actor 的 effects 执行 addOrRefreshBuff。对于荒野游人（无叠加/refresh），这就是 ~6 行。

### D2. bonusOverride 需要 actor stats（次阻塞）

**已从代码确认**：

bonusOverride 签名（talentConditionalRegistry.ts:97）：
```typescript
bonusOverride?: (value: number) => DynamicBonus[];
```

调用处（talentConditionalRegistry.ts:323）：
```typescript
const bonuses = desc.bonusOverride
  ? desc.bonusOverride(eff.value)
  : mapEffectToBonus(eff.type, eff.stat, eff.value);
```

荒野游人的 bonus = `intellect × perPoint`。需要 actor.stats 来读取 intellect。

**最小补口**：把 bonusOverride 签名改为 `(value: number, actorStats: Record<string, any>) => DynamicBonus[]`，调用处传入 `actor.stats`。1 行接口改 + 1 行调用改。向后兼容（已有 bonusOverride 只用第一个参数，忽略第二个）。

### D3 / D4 不是阻塞

- 天赋数据结构化：纯数据工作
- ARCLIGHT descriptor 注册：纯代码组装

---

## E. 最小缺口落点

| 缺口 | 落点文件 | 改动量 |
|------|---------|-------|
| target="team" | `simulation/simulator.ts`（registerTriggeredBuff action callback） | ~6 行 |
| bonusOverride 签名 | `simulation/data/talentConditionalRegistry.ts`（接口 + 调用） | ~2 行 |
| 天赋数据 | `data/operators/ARCLIGHT/talents.json`（talent_0 effects） | ~10 行 |
| ARCLIGHT descriptor | `simulation/data/talentConditionalRegistry.ts`（新注册条目） | ~30 行 |
| 测试 | `simulation/data/talentConditionalRegistry.test.ts` | ~80 行 |

---

## F. 是否能在不新建通用 team-effect 系统的前提下完成

**可以。已从代码确认。**

理由：
1. `target="team"` 只是 registerTriggeredBuff action callback 里多一个 `else if` 分支
2. 该分支循环 `ctx.state.getAllActors()` → 对每个 actor 执行 addOrRefreshBuff（与现有 self/enemy 路径完全对称）
3. 不需要新的 TeamEffectManager / 全队效果广播系统 / 效果同步机制
4. 不需要修改 EffectManager / Effect / EffectTrigger 接口
5. 不需要修改 TriggerProcessor

**这不是 team-effect 系统，这是给现有的 registerTriggeredBuff 加一条 target 路由。**

---

## G. 本轮最小实现预计会改哪些文件

| 文件 | 改动类型 | 必须/可选 |
|------|---------|---------|
| `simulation/simulator.ts` | registerTriggeredBuff action callback 加 "team" 分支 | **必须** |
| `simulation/data/talentConditionalRegistry.ts` | 1) bonusOverride 签名扩展 2) target 类型加 "team" 3) ARCLIGHT descriptor 注册 | **必须** |
| `data/operators/ARCLIGHT/talents.json` | talent_0 effects 从 parsed_unimplemented 改为结构化 | **必须** |
| `simulation/data/talentConditionalRegistry.test.ts` | ARCLIGHT 测试用例 | **必须** |

### 不需要改的文件

| 文件 | 理由 |
|------|------|
| `simulation/effects/types.ts` | Effect/EffectTrigger 接口不变 |
| `simulation/engine/TriggerProcessor.ts` | 触发评估逻辑不变 |
| `simulation/engine/SimulationEngine.ts` | 事件循环不变 |
| `simulation/state/GameState.ts` | getAllActors() 已存在 |
| `simulation/equipment/types.ts` | DynamicBonus 不变 |
| `simulation/events/DamageHandler.ts` | consume_conduction 已注册 |
| `stores/timelineStore.js` | 前端可视化不需要改 |

---

## H. 前端验证信号

| 信号 | 怎么看 | 预期 |
|------|-------|------|
| simLog | 搜索 buff 创建事件 | ARCLIGHT 第 3 次强化战技后出现 `arclight_huangyeyouren` buff |
| DamageSummaryPanel | 看 buff 后所有队员的电磁伤害 | buff 期间（15s）全队电磁 DAMAGE_TICK 伤害提升 |
| 属性面板 | 看 buff 是否出现在队员 effects 列表 | 所有队员都有该 buff（不只 ARCLIGHT） |
| 对比 | 放 3 次强化战技 vs 放 2 次 | 3 次后伤害提升，2 次后无变化 |

**最直接的观测**：DamageSummaryPanel 中队友（非 ARCLIGHT）的电磁伤害在第 3 次强化战技后出现提升。

---

## I. 本轮必须明确不做的事

| 不做 | 原因 |
|------|------|
| 通用 TeamEffectManager / 全队效果框架 | 一个 else if 分支够用 |
| 修改 EffectTrigger / TriggerProcessor 接口 | 不需要 |
| talent_1「众生智慧」 | 防御性随机机制，无可测产出 |
| 其他角色的 team buff 扩展 | 不顺手扩；如后续需要，复用 target="team" 路由即可 |
| buff 可视化 / 前端 UI 改动 | 现有 DamageSummaryPanel 已能反映伤害变化 |
| consume_conduction 机制改动 | 已正确工作，不碰 |
| bonusOverride 重构为通用缩放系统 | 加一个参数够用 |
| intellect 动态追踪（buff 中实时读取） | 用注册时快照，不在 buff 期间动态更新 |

---

## 附：触发条件检测方案

### "3次额外效果"的检测（已从代码确认可行）

ARCLIGHT 强化战技（variant `v_1767273184428`）的第 3 tick 有：
```json
{ "offset": 1.2, "stagger": 5, "sp": 30, "boundEffects": ["consume_conduction"] }
```

`consume_conduction` 已在 DamageHandler.ts 的 postDamageRegistry 中注册（line 58）。

**条件检测方案**：
```
event: "DAMAGE_TICK"
condition: (e, ctx) => {
  // 只计 ARCLIGHT 的带 consume_conduction 的 tick
  if (e.payload.sourceId !== "ARCLIGHT") return false;
  const bound = e.payload.tickData?.boundEffects || [];
  if (!bound.includes("consume_conduction")) return false;
  counter++;
  if (counter >= 3) { counter = 0; return true; }
  return false;
}
```

**无需新建事件类型**。DAMAGE_TICK event payload 已包含 `tickData: ResolvedDamageTick`，其中 `boundEffects` 可直接读取。

### 智识缩放方案

注册时（registerTalentConditionals 内）可直接读取 `actor.stats.intellect`：
```
bonusOverride: (perPoint, actorStats) => {
  const intellect = actorStats.intellect || 0;
  return [{ stat: "emag_dmg", value: intellect * perPoint }];
}
```

bonus 值在注册时固定（快照语义），不随 buff 期间 intellect 变化而动态更新。这与 LIFENG 顿悟的处理方式一致。
