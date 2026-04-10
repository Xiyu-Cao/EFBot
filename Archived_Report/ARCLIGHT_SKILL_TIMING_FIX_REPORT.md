# ARCLIGHT — skill: 疾风迅雷 时序修正报告

> 时间：2026-03-30
> 基线：266 tests pass, 0 TS errors

---

## 改了哪些文件

| 文件 | 修改 |
|---|---|
| `simulation/events/DamageHandler.ts` | `processPreTickEffects` → `processPostDamageEffects`，从 damage resolution 前移到后 |

其余文件（gamedata.json / skillMultipliers.ts / simulator.ts）**无改动**。

---

## 验证结论

### 1. 第 3 hit 结算时是否仍能读到 conduction

**是**。`resolver.resolve(damageCtx)` 先执行，此时 `enemy.status.conduction` 仍存在。`computeVulnerabilityZone` 读取 conduction 并加入法术易伤。额外伤害享受导电加成。

### 2. conduction 是否在第 3 hit 结算完成后被清除

**是**。`processPostDamageEffects` 在 `resolver.resolve()` 之后、同一个 `handle()` 调用内执行，设置 `status.conduction = null`。

### 3. 后续事件是否已看不到 conduction

**是**。同一时间点的后续 DAMAGE_TICK / STAGGER_CHANGE / SP_CHANGE 等事件处理时，conduction 已为 null。

### 4. consume_conduction 的实际调用顺序

```
DamageHandler.handle(e, ctx)
  ├─ blockedActionIds check
  ├─ resolver.resolve(damageCtx)       ← conduction 仍在，易伤生效
  ├─ processPostDamageEffects(...)     ← 清除 conduction
  ├─ simLog DAMAGE_TICK
  ├─ enqueue STAGGER_CHANGE
  └─ enqueue SP_CHANGE
```

同帧、同 handler、先算伤害后消耗 buff。
