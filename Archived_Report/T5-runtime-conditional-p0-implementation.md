# T5 runtime_conditional P0 实施报告

---

## 1. 实际修改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/simulation/simulator.ts` | +1 import 行，+~80 行 runtime_conditional 注册块 |

仅 1 个文件。未新建任何文件。

## 2. 每个文件改了什么

### simulator.ts

**新增 import**：`addOrRefreshBuff`, `addStackWithIndependentDuration`, `DynamicBonus` from `equipment/types.ts`

**新增注册块**（在 runtime_passive 块之后、AVYWENNA lance tracking 之前）：
- 遍历 actors，过滤 `_activeEffects` 中 `scope === "runtime_conditional"` 的 effects
- 对 WULFGARD：找到 `damage_bonus blaze_dmg` effect → 注册 EffectTrigger 型被动
- 对 CHENQIANYU：找到 `stat_bonus attack_percent` effect → 注册 EffectTrigger 型被动
- 数值（value）从 effects[] 读取，不硬编码第二份

## 3. WULFGARD 灼热獠牙的触发链路

```
simulator.ts setup:
  _activeEffects 中找到 { type: "damage_bonus", stat: "blaze_dmg", value: 20/30, scope: "runtime_conditional" }
  → 注册永久载体 Effect (id: "talent_cond_wulfgard_blazing_fangs") with triggers
  → actorState.effects.add()

运行时:
  APPLY_DIRECT_ANOMALY 事件（燃烧施加）
  → TriggerProcessor 评估
  → 检查 sourceMustBeWearer（必须是 WULFGARD 自己施加的燃烧）
  → 检查 condition: anomalyType === "burn"
  → action: addOrRefreshBuff → 创建/刷新 "wulfgard_blaze_buff"
    → duration: 10s, dynamicBonuses: [{ stat: "blaze_dmg", value: 20/30 }]
  → 后续灼热伤害时 evaluateDynamicBonus 匹配 damageType === "burn" → 加入增伤区
  → 10s 后 sweepExpired 自动清理
```

## 4. CHENQIANYU 斩锋的触发链路

```
simulator.ts setup:
  _activeEffects 中找到 { type: "stat_bonus", stat: "attack_percent", value: 4/8, scope: "runtime_conditional" }
  → 注册永久载体 Effect (id: "talent_cond_chenqianyu_slash_edge") with triggers
  → actorState.effects.add()

运行时:
  DAMAGE_TICK 事件（技能命中）
  → TriggerProcessor 评估
  → 检查 sourceMustBeWearer（必须是 CHENQIANYU 自己造成的伤害）
  → 检查 condition: action.node.type 是 skill/link/ultimate（排除普攻）
  → action: addStackWithIndependentDuration → 创建独立持续时间叠层
    → duration: 10s, dynamicBonuses: [{ stat: "all_dmg", value: 4/8, zone: "attackPercent" }]
    → stackGroup: "chenqianyu_slash", maxStacks: 5
  → 每层独立倒计时，到期逐层移除
  → 伤害时 aggregateAttackBonuses 读取 zone=attackPercent → percentBonus += value/100
```

## 5. CHENQIANYU ATK% 的乘区落点

**落在 ATK 公式的 percentBonus 乘区。**

具体链路：
- dynamicBonuses: `{ stat: "all_dmg", value: 4, zone: "attackPercent" }`
- `aggregateAttackBonuses()` (equipment/types.ts:327-329) 检查 `db.zone === "attackPercent"` → `percentBonus += 4/100 = 0.04`
- `computeEffectiveAttack()` (attackFormula.ts:67) 使用 `baseAttack * (1 + percentBonus) + flatBonus`
- 最终 ATK = `floor(baseAttack * 1.04 * abilityMultiplier)`

**为何用 `stat: "all_dmg"` 而非 `"attack_percent"`**：`DynamicBonusStat` 类型不包含 `"attack_percent"`。对于 `zone: "attackPercent"`，`aggregateAttackBonuses` 不检查 `stat` 字段——它只检查 `zone`。所以 stat 值在此上下文无实际效果，使用 `"all_dmg"` 满足类型约束。

**为何不放在增伤区（damageBonus）**：ATK% 是攻击力百分比加成，在伤害公式中位于 ATK 计算层（第一层），而非增伤乘区（第三层）。放在增伤区会导致数值意义错误——ATK+15% 应该乘进基础攻击力，不是乘进增伤倍率。

## 6. 有没有引入新的真值源

**没有。**
- 数值（value）从 `_activeEffects` → talents.json effects[] 读取
- 触发逻辑在代码中（与武器被动完全同模式）
- 没有新建 registry / mapping 表 / JSON 配置
- 没有硬编码 value 数值

## 7. 仍然明确未支持的 runtime_conditional

| 角色 | 天赋 | 原因 |
|---|---|---|
| ENDMINISTRATOR | 本质瓦解 | 需要"源石结晶消耗"事件 |
| ROSSI | 斫痕 | 复合 DOT + debuff |
| ROSSI | 沸血 | 多条件链 + 额外伤害 |
| DAPAN | 勾芡 | 需要"破防层消耗"事件 |
| FLUORITE | 捉摸不定 | 概率触发 |
| CATCHER | 全局思维 | 额外伤害实例 |
| EMBER | 以铁还铁 | 需要"受伤"事件 |
| POGRANICHNK | 活着的旗帜 | SP 累计阈值追踪 |
| LIFENG | 伏魔 | 额外伤害 + 物理异常联动 |
| AVYWENNA | 高效派送 | gauge_modifier |
| ALESH | 闪冻锁鲜 | gauge_modifier |

以上全部不在本次范围。

## 8. 最小测试建议

1. **WULFGARD**：排轴放 WULFGARD 战技（触发燃烧），然后放后续灼热伤害技能
   - 点击"伤害统计" → 灼热伤害应比无天赋时增加 20%（E3）或 30%（E4 升级后）
   - 确认 buff 在 10s 后自然过期（后续超过 10s 的灼热伤害不受加成）

2. **CHENQIANYU**：排轴放 CHENQIANYU 多次战技/连携/终结
   - 每次命中叠一层 ATK+4/8%
   - 最多 5 层
   - 每层独立 10s 倒计时
   - 点击"伤害统计" → 后续命中的伤害应反映叠层后的 ATK 增加

3. **回归测试**：确认其他角色的伤害不受影响（代码只在 actorId === "WULFGARD" / "CHENQIANYU" 时触发）

## 前端可直接观察到的变化

无直接 UI 变化。主要通过"伤害统计"按钮结果验证：
- WULFGARD 触发燃烧后的灼热伤害增加
- CHENQIANYU 连续命中后的攻击力逐层增长
- 未触发天赋条件时（如 WULFGARD 未施加燃烧），伤害与之前一致
