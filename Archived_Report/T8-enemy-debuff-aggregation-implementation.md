# T8 通用 Enemy Debuff 聚合路径 + spell_vulnerable 实施报告

---

## 1. 处理的分类

- Part 1（完成）：通用 enemy debuff 聚合补口 — fragility + vulnerability target-side 读取
- Part 2（完成）：验证样例 — GILBERTA 终结技 `spell_vulnerable`

## 2. 实际修改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/simulation/equipment/types.ts` | 新增 `aggregateEnemyZoneBonuses` 函数（~25 行） |
| `src/simulation/calculation/multiplierZones.ts` | +1 import, `computeFragilityZone` 加 1 行, `computeVulnerabilityZone` 加 1 行 |
| `src/simulation/simulator.ts` | +1 import, Route 2.8 `spell_vulnerable` 分支（~20 行） |

共 3 个文件。

## 3. 改变了什么行为 / 数据流

### Part 1: 聚合补口

**之前**：enemy.effects 上的 dynamicBonuses 无任何消费者（断路）

**现在**：
- `computeFragilityZone` = source-side fragility + **target-side fragility（新增）**
- `computeVulnerabilityZone` = conduction + physVuln + source-side vuln + **target-side vuln（新增）**
- 其他 zone（damageBonus/amplify/combo/attackPercent/attackFlat）不变，仍只读 actor.effects

### Part 2: spell_vulnerable 路由

```
GILBERTA 终结技 effect type "spell_vulnerable"
  → Route 2.8
  → calcConductionDebuff(stacks=1, artsPower) → spellVulnerability = 12% (@artsPower=0)
  → addOrRefreshBuff on enemy.effects
  → Effect { id: "SPELL_VULNERABLE", dynamicBonuses: [{ stat: "arts_dmg", value: 12, zone: "fragility" }] }
  → computeFragilityZone → aggregateEnemyZoneBonuses("fragility", tags)
  → evaluateDynamicBonus 匹配 damageSchool === "magic" → 法术伤害增加
  → 物理伤害不匹配 → 不受影响
  → duration=5s 后 sweepExpired 清理
```

## 4. 已可收口

| 项目 | 状态 |
|---|---|
| enemy.effects 上的 dynamicBonuses（fragility zone） | **已通** |
| enemy.effects 上的 dynamicBonuses（vulnerability zone） | **已通** |
| GILBERTA 终结技 spell_vulnerable | **已路由** |
| registerTriggeredBuff target:"enemy" + dynamicBonuses | **现在可用** — 只要 zone 是 fragility 或 vulnerability |

## 5. 仍是阶段性实现

| 项目 | 状态 |
|---|---|
| damageBonus/amplify/combo/attackPercent 的 target-side | 未通（这些是 source-side 语义，暂不需要） |
| 更多 spell_vulnerable 样例（如其他角色） | 未接（只做了 GILBERTA） |
| spell_vulnerable 百分比值的游戏真值验证 | 使用 calcConductionDebuff 公式，待人工验证 |

## 6. 有没有引入新的真值源

没有。
- `spell_vulnerable` 的百分比使用现有 `calcConductionDebuff.spellVulnerability` 公式
- duration 从 gamedata effect node 读取（5s）
- stacks 从 gamedata 读取（1）
- artsPower 从施加者 stats 读取

## 7. 下一步最适合测什么

1. 放 GILBERTA 终结技 → 后续 5s 内法术伤害应增加约 12%
2. 物理伤害不应被 spell_vulnerable 影响
3. 5s 后法术伤害恢复原值
4. 已有 physical_vulnerable（ESTELLA/LIFENG）行为不变
5. 已有 self buff（WULFGARD/CHENQIANYU）行为不变
6. 已有 runtime_passive fragility（ENDMINISTRATOR/XAIHI）行为不变

## 8. 通用 enemy debuff 聚合路径打通情况

| zone | target-side 是否已通 |
|---|---|
| fragility | **已通** — `aggregateEnemyZoneBonuses(state, "fragility", tags)` |
| vulnerability | **已通** — `aggregateEnemyZoneBonuses(state, "vulnerability")` |
| damageBonus | 未通（source-side 语义，不需要） |
| amplify | 未通（同上） |
| combo | 未通（同上） |
| attackPercent/Flat | 未通（同上） |

`registerTriggeredBuff({ target: "enemy", bonuses: [{ zone: "fragility", ... }] })` **现在可以工作了**。

## 9. 验证样例数值来源

**已确认**：使用 `calcConductionDebuff(anomalyLevel, artsPower).spellVulnerability` — 这是代码中现有的、与导电共用的法术易伤公式，而非临时创造的公式。stacks=1 → anomalyLevel=1 → `(1+2)*4*1 = 12%`（artsPower=0 时）。

## 测试结果

- vue-tsc 类型检查通过
- 120 个 simulation 测试全通过（含 phase7 物理易伤测试），0 新增失败
