# 资源系统接入报告

> 时间：2026-03-24
> 基线：251 tests pass, 0 TS errors
> 结论：refundSP 双池 + SP→终结技充能已接入 simulation 主链

---

## 1. 本次修改清单

| 文件 | 操作 |
|---|---|
| `state/types.ts` | TeamSnapshot 增 `trueSP` / `refundSP` 字段 |
| `state/TeamState.ts` | 完整重写：双池存储、consumeSp()、addRefundSp()、addTrueSp()、regen 覆盖逻辑 |
| `state/ActorState.ts` | 增 mutable `gauge` 字段 + `modifyGauge()` + `getGauge()` |
| `events/SpChangeHandler.ts` | 重写：消耗走 consumeSp，正向按 reason 路由 refund/true；消耗时计算全队 gauge |
| `events/event.types.ts` | SP_CHANGE log 增 trueSP/refundSP；新增 GAUGE_CHANGE log 类型 |
| `formatSimLogEntry.ts` | 增 GAUGE_CHANGE 格式化 |

---

## 2. SP 消耗如何转终结技充能

```
ActionStartHandler → SP_CHANGE (spChange=-100, reason="skill")
  → SpChangeHandler:
    1. consumeSp(100):
       - 先扣 refundSP (不充能)
       - 再扣 trueSP (充能)
       - 返回 { trueSPConsumed, refundSPConsumed }
    2. if trueSPConsumed > 0:
       baseCharge = trueSPConsumed × 6.5 / 100
       for each actor:
         actualCharge = baseCharge × (actor.stats.ult_charge_eff / 100)
         actor.modifyGauge(actualCharge)
         log GAUGE_CHANGE
```

示例：消耗 100 trueSP → baseCharge = 6.5 → 默认 ult_charge_eff=100 → 全队每人 +6.5 gauge。

---

## 3. refundSP 存储与消耗

- `TeamState` 内部字段：`trueSP: number` + `refundSP: number`
- `getSp()` 返回 `trueSP + refundSP`（总量，兼容现有 projection）
- `consumeSp(amount)`：先扣 refundSP，再扣 trueSP，返回各扣了多少
- `addRefundSp(amount)`：skill 返还 SP 走这里，cap 到 maxSp
- `addTrueSp(amount)`：execution/damage/regen 走这里

路由规则（SpChangeHandler）：
- `reason === "skill" && spChange > 0` → `addRefundSp`
- `reason === "skill" && spChange < 0` → `consumeSp`
- 其他正向 → `addTrueSp`

---

## 4. 自然回复如何覆盖 refundSP

`regenSp(dt)` 逻辑：
- 若 `total < maxSp`：regen 增加 trueSP（正常回复）
- 若 `total >= maxSp && refundSP > 0`：不增加总量，而是把 refundSP 转为 trueSP
  - 每 tick 转换量 = `min(refundSP, dt × spRegenRate)`
  - 最终效果：逐步把 refundSP 替换成 trueSP，直到全部是 trueSP

---

## 5. 其他说明

- **全程 float**，无整数截断
- **TeamSnapshot** 保留 `sp` 字段（= trueSP + refundSP）兼容现有 `projectSpSeries`
- **ActorState.gauge** 可变，通过 `modifyGauge()` 更新，snapshot 中反映最新值
- **legacy `modifySp()`** 仍可用于不需要区分双池的场景（正值→trueSP，负值→consumeSp）

---

## 6. STR→HP 审计结论

**不接入。** 原因：
- gamedata 不含角色基础 HP 字段
- `stats.hp` 默认值为 0，只有武器 passiveStats 偶尔含 hp 小值（如 56）
- 即使加 STR×5，缺少基础 HP 仍然不完整
- `strengthToHp()` 函数保留在 `derivedStats.ts` 备用

---

## 7. 仍为 TODO 的部分

| 项目 | 状态 |
|---|---|
| 重击 SP 回复 (+15) | placeholder 常量，无 simulation 事件触发 |
| 闪避 SP 回复 (+7.4) | placeholder 常量，无 simulation 事件触发 |
| AGI→物理抗性 | placeholder 返回 0，公式未确认 |
| INT→法术抗性 | placeholder 返回 0，公式未确认 |
| 角色基础 HP 数据源 | gamedata 无此字段 |
| 终结技消耗 gauge | gauge 消耗在 ActionStartHandler 未处理（当前只消耗 SP） |
| per-actor maxGauge | modifyGauge 暂用 Infinity，待接入角色 maxGauge 数据 |

---

## 8. 建议后续推进

1. **终结技 gauge 消耗** — ActionStartHandler 中 `type === "ultimate"` 时扣 gauge
2. **连携技固定 +10 gauge** — ActionEndHandler 中 `type === "link"` 时给施放者 +10
3. **per-actor maxGauge** — 从 gamedata `ultimate_gaugeMax` 接入 ActorState
