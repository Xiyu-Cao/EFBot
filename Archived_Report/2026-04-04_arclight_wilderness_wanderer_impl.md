# ARCLIGHT 荒野游人 实现报告

> 日期：2026-04-04
> 类型：最小补口实现
> 前置：ARCLIGHT 定点审计（同日）

---

## 1. 本次处理的分类

ARCLIGHT talent_0「荒野游人」— 3 次强化战技额外效果后全队电磁伤害提升（智识缩放，15s，刷新）

---

## 2. 实际改了哪些文件

恰好 4 个，未新增第 5 个文件：

1. `simulation/simulator.ts`
2. `simulation/data/talentConditionalRegistry.ts`
3. `data/operators/ARCLIGHT/talents.json`
4. `simulation/data/talentConditionalRegistry.test.ts`

---

## 3. 每个文件具体改了什么

### simulator.ts

- `target` 类型联合从 `"self" | "enemy"` 扩为 `"self" | "enemy" | "team"`
- `registerTriggeredBuff` 的 action callback 新增 `"team"` 分支：循环 `ctx.state.getAllActors()`，对每个 actor 执行 `addOrRefreshBuff`
- 仅支持 refresh 模式（ARCLIGHT 不需要 stack）

```typescript
if (opts.target === "team") {
  for (const teammate of ctx.state.getAllActors()) {
    addOrRefreshBuff(
      teammate.effects,
      new Effect({ id: opts.buffId, ... }),
    );
  }
  return;
}
```

### talentConditionalRegistry.ts

- `TalentConditionalDescriptor.target` 类型加 `"team"`
- `bonusOverride` 签名从 `(value: number) => DynamicBonus[]` 扩为 `(value: number, actorStats: Record<string, any>) => DynamicBonus[]`
- 调用处传入 `actor.stats`（向后兼容：AVYWENNA 的旧 bonusOverride 只收第一个参数，自动忽略第二个）
- `registerTalentConditionals` 函数签名中 target 类型同步扩展
- 新增 ARCLIGHT descriptor：
  - `event: "DAMAGE_TICK"`
  - `conditionFactory` 闭包计数器（3 次 `consume_conduction` tick 后触发，触发后归零重新累计）
  - `target: "team"`
  - `bonusOverride` 读 `actorStats.intellect × perPoint`

### ARCLIGHT/talents.json

talent_0 两个 stage 的 effects 从 `parsed_unimplemented` 改为结构化：

| 字段 | E1 | E2 |
|------|----|----|
| type | damage_bonus | damage_bonus |
| stat | emag_dmg | emag_dmg |
| value | 0.05 | 0.08 |
| unit | percent_per_intellect | percent_per_intellect |
| scope | runtime_conditional | runtime_conditional |
| target | team | team |

### talentConditionalRegistry.test.ts

- `makeRegisterTriggeredBuff` 新增 `"team"` 分支（与 simulator.ts 对称）
- 新增 8 个 ARCLIGHT 测试用例

---

## 4. 哪些行为现在已经变成前端可测试

- ARCLIGHT 排轴中放 3 次强化战技（每次消耗导电），第 3 次后全队获得 `arclight_wilderness_wanderer` buff
- buff 持续 15s，刷新模式（不可叠加）
- buff 数值 = ARCLIGHT 的智识 × perPoint（E1: 0.05, E2: 0.08）
- 全队所有成员的电磁伤害在 buff 期间提升

---

## 5. 新增了哪些测试，是否全部通过

8 个新测试，全部通过（总计 37 pass，含已有 29 个回归测试）：

| # | 测试 | 覆盖 |
|---|------|------|
| 1 | 前 2 次不触发 | 计数器正确 |
| 2 | 第 3 次触发 | 计数阈值 |
| 3 | buff 作用于全队 | target="team" 分发 |
| 4 | bonus = intellect × perPoint | 智识缩放 + 队友同值 |
| 5 | 非 ARCLIGHT 来源不触发 | sourceMustBeWearer 默认 |
| 6 | 无 consume_conduction 不触发 | boundEffects 过滤 |
| 7 | 重复触发刷新不叠层 | refresh 行为 + startTime 更新 |
| 8 | E2 数值 0.08 | 数据驱动 |

其他测试套件回归结果：
- anomaly.test.ts: 21 passed
- simulator.behavior.test.ts: 3 passed
- 全部 61 测试通过，无回归

---

## 6. 前端如何验证

1. 排轴放 ARCLIGHT + 至少一个队友
2. 对敌人施加导电（先用 ARCLIGHT 终结技的 emag_attach → conductive）
3. 放 3 次 ARCLIGHT 强化战技（每次会消耗导电）
4. 验证点：

| 信号 | 怎么看 | 预期 |
|------|-------|------|
| DamageSummaryPanel | 队友的电磁 DAMAGE_TICK 伤害 | 第 3 次强化战技后提升 |
| buff 出现 | 全队成员 effects 列表 | 所有队员都有 `arclight_wilderness_wanderer` buff |
| 对比 | 只放 2 次 vs 3 次 | 2 次无变化，3 次后出现 |
| 15s 后 | buff 到期后伤害 | 回落到无 buff 水平 |

**最直接的观测**：DamageSummaryPanel 中队友（非 ARCLIGHT）的电磁伤害在第 3 次强化战技后出现提升。

---

## 7. 已知限制 / 简化假设

| 限制 | 说明 |
|------|------|
| 智识快照语义 | bonus 在注册时固定（intellect × perPoint），buff 期间不随智识动态变化。与 LIFENG 顿悟处理方式一致。 |
| team 路由仅 refresh | `target="team"` 当前仅实现 addOrRefreshBuff，不支持 stack 模式的 team 分发。如需后续扩展，在同一 if 分支内加 stack 逻辑即可。 |
| "3次额外效果"简化 | 每次带 `consume_conduction` boundEffect 的 DAMAGE_TICK 计为 1 次，不校验导电是否真正存在并被消耗。实际排轴中，无导电时不会放强化战技，所以此简化在实践中不影响结果。 |
| 计数器不跨 simulate() | conditionFactory 每次 simulate() 生成新闭包，计数器归零。这是 conditionFactory 的标准行为。 |

---

## 8. 有没有引入新的真值源或临时覆盖层

| 改动 | 是否新真值源 | 说明 |
|------|------------|------|
| bonusOverride 签名扩展 | 否 | 新增第二个参数 `actorStats`，向后兼容（旧调用者忽略） |
| target="team" 路由 | 否 | 新增路由分支，不改已有 self/enemy 路径 |
| ARCLIGHT descriptor | 否 | 复用现有 DAMAGE_TICK 事件，未新增事件类型 |
| 智识读取 | 否 | 从现有 actor.stats 快照读取，无新数据源 |

全部走现有 registerTriggeredBuff → TriggerProcessor → EffectManager 主链，无临时 hack。
