# 角色面板与资源公式层审计报告

> 审计时间：2026-03-24
> 基线：251 tests pass, 0 TS errors
> 结论：攻击力链已正确；spRegenRate 已修正 8→8.5；派生公式/资源公式已落地为独立模块

---

## 1. 审计结论

| 范围 | 状态 | 说明 |
|---|---|---|
| A. 攻击力链 | **已正确** | `attackFormula.ts` 完全符合五步公式，`DamageResolver` 正确调用 |
| B. 派生公式 | **缺失→已补** | STR→HP/WIL→heal [verified] + AGI/INT→resist [placeholder] 落入 `derivedStats.ts` |
| C. 直接加算 | **已正确** | `ActorStats` 含所有增伤字段，`multiplierZones.ts` 正确读取 |
| D. 资源系统 | **部分→已补** | spRegenRate 修正为 8.5；资源公式落入 `resourceFormulas.ts`；refundSP 双池记录为 TODO |

双真值源风险：无新增。gauge 投影仍仅在 UI 层 (`timelineStore.js`)，simulation 引擎未处理 `gaugeGain`/`teamGaugeGain`。

---

## 2. 本次修改清单

| 文件 | 操作 |
|---|---|
| `calculation/attackFormula.ts` | 补 spec 术语注释（五步中文名、verified 来源、floor 未确认注记） |
| `compiler/compileScenario.ts` | spRegenRate 8→8.5，maxSp/skillSpCostDefault 改为引用 `resourceFormulas` 常量 |
| `calculation/derivedStats.ts` (新) | STR→HP, WIL→heal [verified]；AGI→resist, INT→resist [placeholder, return 0] |
| `calculation/resourceFormulas.ts` (新) | SP_REGEN_RATE=8.5, SP_CAP=300, computeBaseUltCharge, applyUltChargeEfficiency, refundSP 规则文档 |
| `state/TeamState.ts` | 补 refundSP 双池 TODO 注释 |
| `simulator.test.ts` snapshot | 因 regen rate 变化自动更新 |

---

## 3. 公式接入状态

| 公式 | 真值状态 | 运行时接入 |
|---|---|---|
| 攻击力五步公式 | working verified | ✅ DamageResolver 直接调用 |
| SP 自然回复 8.5/s | working verified | ✅ TeamState.regenSp |
| SP 上限 300 | working verified | ✅ TeamState.modifySp |
| STR→HP (×5) | working verified | 函数就绪，未接入 compile（需确认 stats.hp 是否已含） |
| WIL→heal (×0.1%) | working verified | 函数就绪，无消费方 |
| AGI→phys resist | placeholder | 返回 0 |
| INT→magic resist | placeholder | 返回 0 |
| SP→终结技充能 (×6.5/100) | working verified | 函数就绪，未接入 SpChangeHandler |
| 终结技充能效率 | working verified | 函数就绪，未接入 simulation（UI 已用） |
| refundSP 双池 | working verified (规则) | 未实现，TODO in TeamState |
| 重击 +15 SP | placeholder | 常量就绪，无事件触发 |
| 闪避 +7.4 SP | placeholder | 常量就绪，无事件触发 |

---

## 4. 新文件索引

| 文件 | 作用 |
|---|---|
| `simulation/calculation/derivedStats.ts` | 角色派生属性公式（STR→HP, WIL→heal, AGI→resist, INT→resist） |
| `simulation/calculation/resourceFormulas.ts` | 资源系统公式与常量（SP回复/上限/充能公式/refundSP规则文档） |

---

## 5. 仍需实机确认

1. **AGI → 物理抗性**的精确公式
2. **INT → 四系法抗**的精确公式
3. `stats.hp` 是否已包含 STR×5 贡献（决定是否接入 processActors）
4. 重击 / 闪避 SP 回复精确值
5. "战斗内部是否也用 floor 后整数攻击力" 最终确认

---

## 6. 建议后续推进（1~3 项）

1. **接入 gauge 充能到 simulation 引擎** — SpChangeHandler 消耗 trueSP 时调用 `computeBaseUltCharge` → 发 GAUGE_CHANGE 事件 → ActorState.resources.gauge 更新
2. **实现 refundSP 双池** — 拆分 TeamState.sp → {trueSP, refundSP}，修改 modifySp 消耗顺序
3. **确认 STR→HP 是否需要在 compile 阶段追加** — 如果 gamedata 已含则不加；否则在 processActors 中 `resources.hp += strengthToHp(stats.strength)`
