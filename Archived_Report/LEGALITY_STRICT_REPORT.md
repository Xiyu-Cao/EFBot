# Legality Strict 收尾报告

> 时间：2026-03-24
> 基线：266 tests pass (251 原始 + 15 legality), 0 TS errors
> 结论：strict 模式现在真正阻断 blocked action 的全部后续效果；连携条件检查已接入

---

## 1. 修改清单

| 文件 | 操作 |
|---|---|
| `engine/SimulationContext.ts` | +`blockedActionIds: Set<string>` |
| `engine/SimulationEngine.ts` | 初始化 blockedActionIds |
| `events/ActionStartHandler.ts` | blocked 时记录 actionId 到 blockedActionIds |
| `events/DamageHandler.ts` | +1 行：`if (blockedActionIds.has(actionId)) return` |
| `events/ActionEndHandler.ts` | +1 行：同上 |
| `events/EffectStartHandler.ts` | +1 行：同上（可选，有 actionId 时检查） |
| `events/event.types.ts` | ActionStartEvent +`allowedTypes?: string[]` |
| `simulator.ts` | 传 `action.node.allowedTypes` 到 ACTION_START 事件 |
| `legality/types.ts` | +`ISSUE_CONDITION_NOT_MET` code |
| `legality/checkActionLegality.ts` | +连携条件检查 + CD 扩展到全 action type |
| `legality/legality.test.ts` | +6 新测试（条件/CD 扩展） |
| `simulator.behavior.test.ts` | 修复手动构造的 ctx 缺少新字段 |

---

## 2. Strict 下 blocked action 现在会发生什么

```
ActionStartHandler:
  → checkActionLegality() 返回 issues
  → shouldBlockAction(issues) === true
  → ctx.blockedActionIds.add(actionId)    ← 新增
  → return                                ← 跳过全部执行

后续事件:
  DamageHandler.handle():  if (blockedActionIds.has(actionId)) return ← 跳过
  ActionEndHandler.handle(): if (blockedActionIds.has(actionId)) return ← 跳过
  EffectStartHandler.handle(): if (actionId && blockedActionIds.has(actionId)) return ← 跳过
```

**结果**：blocked action 不消耗资源、不产出伤害、不施加 buff、不触发 action end（不设 cooldown、不回 SP）。

---

## 3. 新增的条件检查

### `CONDITION_NOT_MET` — 基于 `allowedTypes` (OR 语义)

| 条件字符串 | 检查对象 | 状态 |
|---|---|---|
| `knockup` | enemy.effects tag PHYSICAL_LIFT | working |
| `knockdown` | enemy.effects tag PHYSICAL_KNOCK_DOWN | working |
| `armor_break` | enemy.effects tag PHYSICAL_BREACH | working |
| `stagger` | enemy.effects tag PHYSICAL_CRUSH | working |
| `break` | enemy.status.hasBreak() | working |
| `cold_attach` | enemy.status magic element === "cold" | working |
| `blaze_attach` | enemy.status magic element === "fire" | working |
| `emag_attach` | enemy.status magic element === "electro" | working |
| `nature_attach` | enemy.status magic element === "nature" | working |
| `frozen` / `ice_shatter` | enemy.status.isFrozen(time) | working |
| `corrosion` | enemy.status.corrosion !== null | working |
| `burn` / `combustion` | enemy.status.burn !== null | working |
| `conduction` | enemy.status.conduction !== null | working |
| `cold_burst` 等 | 近似：检查同元素 attachment | estimated |
| `endmin_debuff` / `magma_*` / `combo` | **unknown → assumed met** | TODO |

未知条件 assumed met，避免误拦。后续映射角色专属条件时添加。

---

## 4. CD 检查覆盖面

**已扩展到全 action type**（不再只检查 link）。任何 action 的 skillId 如果在 ActorState cooldowns 里且未过期，都会产出 `COOLDOWN_ACTIVE` issue。

实际影响：
- **link**: 有 CD（`action.node.cooldown > 0`），最常触发
- **skill**: 通常 CD=0（靠 SP 门控），不触发
- **ultimate**: 通常 CD=0（靠 gauge 门控），不触发
- **execution**: CD=0

---

## 5. 仍为 TODO

| 项 | 说明 |
|---|---|
| 角色专属条件 (`endmin_debuff`, `magma_*`, `combo`) | 需映射到 simulation 状态 |
| Burst 条件精确判断 | 当前用 attachment 近似，burst 是瞬时事件 |
| Boss dodge window | 预留了 issue code，未实现 |
| Hitstun / interrupt | 预留了 issue code，未实现 |
| UI 层集成 | timelineStore.strictMode 仍独立运作，未与 simulation legality 打通 |
