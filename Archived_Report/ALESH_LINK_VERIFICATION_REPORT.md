# ALESH — link: 凿孔底钓术 收口验证报告

> 时间：2026-03-30
> 基线：266 tests pass, 0 TS errors

---

## 1. useEnhanced 的真实调用路径

**上一版**：`applySkillMultiplierOverlay` 支持 `useEnhanced` 参数，但 `simulator.ts` 调用时未传入，永远为 `false`。强化态函数就绪但跑不到。

**本次补全**：
- `SimulateOptions` 新增 `enhancedActionIds?: Set<string>`
- `simulator.ts` 在 overlay 调用时检查 `enhancedActionIds.has(action.id)` 传入 `useEnhanced`
- `timelineStore.js` 的 `simulation` computed 从 `computedEffectiveActions.value.keys()` 收集所有 variant 激活的 action instanceId，传入 `enhancedActionIds`

**调用链**：
```
timelineStore:
  computedActionConditionResults → condResult.variantId 非空
  → computedEffectiveActions.keys() → enhancedIds Set
  → simulate(..., { enhancedActionIds: enhancedIds })

simulator.ts:
  action.resolvedDamageTicks.forEach → enhancedActionIds.has(action.id)
  → applySkillMultiplierOverlay(..., useEnhanced=true)
  → getSkillMultiplier(..., useEnhanced=true) → entry.enhancedMultipliers
```

现在当 UI 层 variant 条件命中时，simulation 会真实使用 `enhancedMultipliers: [1.191, 3.609]`。

---

## 2. 默认态验证

- gamedata `link_damage_ticks` = 2 个 tick → `compileTimeline` 产出 2 个 `resolvedDamageTick`
- `simulator.ts` 对每个 tick 调用 `applySkillMultiplierOverlay`，tickIndex 0 和 1 分别取 `[0.7444, 2.2556]`
- 排入 2 个独立 `DAMAGE_TICK` 事件，各自走 `DamageHandler` → `DamageResolver`，独立结算 buff/crit
- **不可能回退成单 hit**：gamedata 有 2 个 tick 就产出 2 个事件，这是由 `forEach` 循环保证的

---

## 3. 强化态验证

- 强化态走同一个 `action.resolvedDamageTicks.forEach`，tick 数量仍由 gamedata 决定 = 2
- `enhancedActionIds.has(action.id) === true` → overlay 取 `enhancedMultipliers: [1.191, 3.609]`
- 仍然是 2 个 `DAMAGE_TICK` 事件，只是 multiplier 不同
- **不会新增第 3 hit**：tick 数量完全由 gamedata 控制，overlay 只替换 multiplier 值

---

## 4. offset 调整

**已调整**。原值 0.32 / 1.08 改为 0.317 / 1.083（19/60 和 65/60 的 3 位小数精确值）。

**理由**：gamedata 中已有 3 位小数 offset（如 0.767 = 46/60），说明项目惯例支持帧级精度。保持一致。

---

## 5. 这版是否只是阶段性修正

**是**，但行为已经正确。

当前限制：
- `multipliers` 数组存储的是 **M3 级**预拆分值 `[0.7444, 2.2556]`
- 不包含 1-9 / M1 / M2 各级数据（这些在 wiki extracted-skills 中已有，但未逐级写入 overlay）
- 后续若需要支持非 M3 级，需要把 skillMultipliers 扩展为 per-level 结构，或在编译时从 wiki 数据动态读取
- 但 **runtime 2-hit 行为、split 比例、强化切换** 都已正确

---

## 6. 本次改了哪些文件

| 文件 | 修改 |
|---|---|
| `public/gamedata.json` | ALESH link tick offset: 0.32→0.317, 1.08→1.083 |
| `simulation/simulator.ts` | +`enhancedActionIds` 传参 + overlay 调用传 `isEnhanced` |
| `stores/timelineStore.js` | simulation computed 传入 `enhancedActionIds` |
