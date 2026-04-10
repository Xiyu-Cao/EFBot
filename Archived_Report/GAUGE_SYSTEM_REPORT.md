# Gauge 系统闭环报告

> 时间：2026-03-24
> 基线：251 tests pass, 0 TS errors
> 结论：gauge 现已具备 充能 + 消耗 + 上限 的完整闭环

---

## 1. 本次修改清单

| 文件 | 操作 |
|---|---|
| `events/event.types.ts` | ActionStartEvent 增 `gaugeCost?` 字段 |
| `simulator.ts` | enqueue ACTION_START 时传入 `action.node.gaugeCost` |
| `state/types.ts` | ActorSnapshot.resources 增 `maxGauge: number` |
| `compiler/compileScenario.ts` | processActors 填 `maxGauge` (从 `track.maxGaugeOverride ?? 100`) |
| `state/ActorState.ts` | 持有 `maxGauge`，`modifyGauge()` 使用它 clamp [0, maxGauge] |
| `events/ActionStartHandler.ts` | ultimate 发动时扣 gauge + log GAUGE_CHANGE |
| `calculation/resourceFormulas.ts` | 补 ult_charge_eff 语义统一文档 |

---

## 2. Gauge 闭环行为

### 充能 (已接入，上一阶段)
```
战技消耗 trueSP → computeBaseUltCharge(trueSP) → × (ult_charge_eff / 100) → 全队 gauge +
```

### 消耗 (本次接入)
```
ActionStartHandler:
  if gaugeCost > 0:
    actor.modifyGauge(-gaugeCost)
    log GAUGE_CHANGE { change: -gaugeCost, reason: "ultimate_cast" }
```

### 上限 (本次接入)
```
ActorSnapshot.resources.maxGauge = track.maxGaugeOverride ?? 100
ActorState.modifyGauge(amount):
  gauge = clamp(gauge + amount, 0, maxGauge)
```

---

## 3. ult_charge_eff 语义

**统一口径：总倍率百分数，100 = 1.0x**

| 值 | 含义 |
|---|---|
| 100 | 基础（无加成） |
| 120 | +20% 充能效率 |
| 182.8 | +82.8% 充能效率 |

**录入规则**：游戏面板显示 "+82.8%" → 录入 `ult_charge_eff = 182.8`

三处使用（coreStats / SpChangeHandler / timelineStore）语义一致，无冲突。

---

## 4. Snapshot / Log 可见性

- **TeamSnapshot**: `{ sp, trueSP, refundSP, ... }`
- **ActorSnapshot.resources**: `{ hp, gauge, maxGauge }`
- **SP_CHANGE log**: 含 `trueSP`, `refundSP` 字段
- **GAUGE_CHANGE log**: `{ actorId, change, gauge, reason }`
  - reason = `"sp_consumption"` (充能) 或 `"ultimate_cast"` (消耗)

---

## 5. 仍为 TODO 的部分

| 项目 | 状态 |
|---|---|
| 连携技固定 +10 gauge (给施放者) | 未接入 ActionEndHandler |
| 终结技期间特殊充能 (per-character gaugeGain) | 未接入 |
| gauge 不足时阻止 ultimate 发动 | 当前只扣不阻，simulation 不做 canCast 校验 |
| per-actor maxGauge 从 gamedata 自动读取 | 当前依赖 track.maxGaugeOverride，null 时 fallback 100 |
| 重击/闪避 SP | placeholder 常量，无事件触发 |
| AGI/INT 抗性 | placeholder |

---

## 6. 建议后续推进

1. **连携技 +10 gauge** — ActionEndHandler 中 `type === "link"` 时给施放者 +10
2. **gauge 不足校验** — 在 ActionStartHandler 或 compile 阶段增加 canCast 检查
3. **maxGauge 从 gamedata 自动读取** — 在 timelineStore 或 compile 阶段从 `charInfo.ultimate_gaugeMax` 填充
