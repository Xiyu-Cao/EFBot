# Legality System 骨架报告

> 时间：2026-03-24
> 基线：260 tests pass (251 + 9 new), 0 TS errors
> 结论：三档 validation policy 骨架已落地，首批 SP/gauge/CD 检查已接入

---

## 1. 修改清单

| 文件 | 操作 |
|---|---|
| `legality/types.ts` (新) | LegalityPolicy / LegalityIssue / issue codes / resolveIssue / shouldBlockAction |
| `legality/checkActionLegality.ts` (新) | 纯函数：SP/gauge/CD 三类检查 |
| `legality/legality.test.ts` (新) | 9 个测试覆盖 sandbox/audit/strict × 三类检查 |
| `engine/SimulationContext.ts` | 增 legalityPolicy + legalityIssues |
| `engine/SimulationEngine.ts` | 持有 policy/issues，暴露 getLegalityIssues() |
| `events/ActionStartHandler.ts` | 执行前调 checkActionLegality，按 policy 处理 |
| `simulator.ts` | SimulateOptions 增 legalityPolicy，返回 legalityIssues |
| `runSimulation.ts` | 透传 legalityIssues |
| `events/event.types.ts` | 增 LEGALITY_ISSUE log 类型 |
| `formatSimLogEntry.ts` | 增 LEGALITY_ISSUE 格式化 |

---

## 2. 三档 Policy 行为

| Policy | error-level issue | 资源消耗 | 后续事件 |
|---|---|---|---|
| **sandbox** | resolution=`allowed`，记录 issue，继续执行 | 正常扣除 | 正常产出 |
| **audit** | resolution=`warned`，记录 issue，继续执行 | 正常扣除 | 正常产出 |
| **strict** | resolution=`blocked`，记录 issue，**跳过整个 action** | 不扣除 | 不产出 |

sandbox 和 audit 的区别：resolution 标记不同（`allowed` vs `warned`），方便 UI 过滤展示。

---

## 3. 当前支持的检查

| Code | 触发条件 | Severity |
|---|---|---|
| `SP_INSUFFICIENT` | spCost > team.getSp() | error |
| `GAUGE_INSUFFICIENT` | gaugeCost > actor.getGauge() | error |
| `COOLDOWN_ACTIVE` | link skill on cooldown at action time | error |

---

## 4. Issue 结构

```typescript
interface LegalityIssue {
  time: number;          // simulation time
  actorId: string;       // who
  actionId: string;      // what
  severity: "info" | "warning" | "error";
  code: string;          // machine-readable
  message: string;       // human-readable
  resolution: "allowed" | "warned" | "blocked";
}
```

同时写入 sim log (`LEGALITY_ISSUE` 条目) + `legalityIssues` 数组。

---

## 5. 接入点

```
simulator.ts
  → engine.legalityPolicy = options.legalityPolicy ?? "sandbox"
  → engine.run()
    → ActionStartHandler.handle(event, ctx)
      → checkActionLegality(event, ctx.state, ctx.legalityPolicy)
      → if shouldBlockAction(issues): return (skip execution)
      → else: normal execution (SP/gauge/regen pause/etc.)
```

检查在 `ActionStartHandler` 内、资源消耗前执行。strict 模式跳过后，该 action 的所有后续事件（DAMAGE_TICK、EFFECT_START、ACTION_END）仍会执行但无 actor context（因为 setActiveAction 被跳过）。

---

## 6. 后续可扩展的检查（不需要改骨架）

在 `checkActionLegality.ts` 中添加新检查函数即可：

| 未来检查 | Issue Code (预留) |
|---|---|
| Boss dodge window | `BOSS_DODGE_WINDOW` |
| Hitstun / interrupt | `HITSTUN_INTERRUPTED` |
| Debuff / condition not met | `CONDITION_NOT_MET` |
| Action overlap | `ACTION_OVERLAP` |
| Assumed / unverified timing | `TIMING_UNVERIFIED` |

这些都复用同一套 `LegalityIssue` 结构、同一套 policy 分发逻辑。

---

## 7. 使用示例

```typescript
// Strict mode: illegal actions are blocked
const result = simulate(timeline, teamConfig, enemyConfig, actors, {
  legalityPolicy: "strict",
});
console.log(result.legalityIssues); // blocked actions listed here

// Audit mode: all issues collected but nothing blocked
const result2 = simulate(timeline, teamConfig, enemyConfig, actors, {
  legalityPolicy: "audit",
});
console.log(result2.legalityIssues); // warned issues

// Default (sandbox): issues recorded with resolution="allowed"
const result3 = simulate(timeline, teamConfig, enemyConfig, actors);
```

---

## 8. 未触碰

- skillMultipliers / anomaly damage / equipment triggers / TRIGGER_EVENT_MAP
- AGI/INT 抗性 placeholder
- 重击/闪避 SP placeholder
- boss AI / boss lane
- UI 层集成（timelineStore strictMode 仍独立运作）
