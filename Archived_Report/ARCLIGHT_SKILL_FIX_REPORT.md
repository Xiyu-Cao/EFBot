# ARCLIGHT — skill: 疾风迅雷 修正报告

> 时间：2026-03-30
> 基线：266 tests pass, 0 TS errors

---

## 1. 改了哪些文件

| 文件 | 修改 |
|---|---|
| `public/gamedata.json` | variant `v_1767273184428` 第 3 tick 增加 `boundEffects: ["consume_conduction"]` |
| `simulation/data/skillMultipliers.ts` | +ARCLIGHT entry: skill [1.01, 1.01] / enhanced [1.01, 1.01, 4.05] / ultimate [3.5, 5.5] |
| `simulation/events/DamageHandler.ts` | +`processPreTickEffects` 方法：damage resolution 前处理 `consume_conduction` |
| `review-tables/verified-skills.md` | +ARCLIGHT 实机结论记录 |

## 2. 默认本体有没有改

**没有**。默认 `skill_damage_ticks` 仍为 2 tick (offset 0.63, 0.80)，未变动。multipliers [1.01, 1.01] 与 wiki M3 一致。

## 3. 额外伤害如何表示

- gamedata variant `v_1767273184428` ("强化战技") 已有第 3 tick at offset 1.2
- `skillMultipliers.ts` 的 `enhancedMultipliers: [1.01, 1.01, 4.05]` 对应 3 tick
- 当 UI variant 条件命中（导电状态）→ `enhancedActionIds` 包含该 action → overlay 用 `enhancedMultipliers` → 3 个 `DAMAGE_TICK` 事件
- 额外伤害是独立 hit，独立结算 buff/crit

## 4. 电磁 buff 消耗前置 1 帧在哪里实现

`DamageHandler.processPreTickEffects`:
- 在 `handle()` 最前面、damage resolution 之前调用
- 检查 `tick.boundEffects` 数组
- 遇到 `"consume_conduction"` → 清除 `ctx.state.enemy.status.conduction = null` + 写 log
- 之后才进入 damage calculation → 此时 conduction 已不存在 → 额外伤害**不享受**导电法术易伤

## 5. 如何验证"先消耗 buff，再触发额外伤害"

`processPreTickEffects` 在 `DamageHandler.handle()` 内、`this.resolver.resolve(damageCtx)` 之前执行。调用顺序：
```
handle(e, ctx)
  → processPreTickEffects(tick.boundEffects, ...)  // clears conduction
  → resolver.resolve(damageCtx)                     // reads enemy state (conduction = null)
```
同一个 handle 调用内，先清后算，无异步/时序风险。
