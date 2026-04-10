# T2 天赋/潜能 effects[] 与静态聚合接入报告

---

## 1. 实际修改的文件

| 文件 | 改动 |
|---|---|
| `src/data/operators/*/potentials.json` × 25 | 为每条潜能补 `effects: [...]` 数组（60 个 static effects across 22 operators） |
| `src/stores/timelineStore.js` | `resolveTrackConfiguredStats()` 新增 static effects 聚合；`resolveTrackActiveEffects()` 的 activePotentials 输出新增 `effects` 字段 |

## 2. 每个文件改了什么

### potentials.json × 25
每条潜能现在有 `effects` 数组（可为空）。例：
```json
{
  "level": 2,
  "description": "追忆之旅智识+20，普通攻击伤害+15%",
  "effects": [
    { "type": "stat_bonus", "stat": "intellect", "value": 20, "unit": "flat", "scope": "static" },
    { "type": "damage_bonus", "stat": "attack_dmg_bonus", "value": 15, "unit": "percent", "scope": "static" }
  ]
}
```

### timelineStore.js
- `resolveTrackConfiguredStats()` line ~615: 调用 `resolveTrackActiveEffects()`，遍历所有 active talent stages + active potentials 的 `effects[]`，聚合 `scope: "static"` 的 `stat_bonus` 和 `damage_bonus` 到 `result[stat]`
- `resolveTrackActiveEffects()`: `activePotentials` 输出新增 `effects` 字段（从 potentials.json 透传）

## 3. effects[] 最终采用的结构

```typescript
{
  type: "stat_bonus" | "damage_bonus" | "gauge_modifier",
  stat: string,           // CORE_STATS key (e.g., "intellect", "emag_dmg", "ult_gauge_cost")
  value: number,          // positive = bonus, negative = reduction
  unit: "flat" | "percent",
  scope: "static"         // only "static" is currently aggregated
}
```

后续可扩展 scope: `"runtime_passive"` / `"runtime_conditional"` / `"parsed_unimplemented"`。

## 4. 已支持进入 configuredStats 的 effect types

| type | scope | 说明 | 已接入 |
|---|---|---|---|
| `stat_bonus` | static | 属性 flat 加成（力量+15, 敏捷+20 等） | ✅ |
| `damage_bonus` | static | 伤害类型%加成（物理伤害+8%, 普攻伤害+15% 等） | ✅ |
| `gauge_modifier` | static | 终结技能量%修改 | ❌ （stat `ult_gauge_cost` 不在 CORE_STATS，需后续桥接） |

## 5. 只做了结构化标记但未实现的

所有带条件/触发/持续时间/倍率修改的潜能描述目前 `effects: []`（空数组），description 文本保留。例：
- "通过技能恢复技力后，攻击力+10%，持续10秒" → `effects: []`（runtime_conditional）
- "战技伤害倍率提升至原本的1.2倍" → `effects: []`（multiplier_scale）
- "天赋效果加强" → `effects: []`（talent_enhance）

## 6. TALENT_ROW1_BONUSES 收口状态

**保留，不收口。** 原因：

Row 1 是能力扩展面板的"主属性节点行"，是一个**全角色统一的能力扩展机制**（每精英化阶段给主属性+10/15/15/20），不是某个天赋的 stage effect。它在 UI 上是天赋阵列的第一行节点，但在数据模型上不属于任何一个 talent 的 stages。

天赋 stages（row 2/3）的效果几乎全是 runtime conditional（如"命中后 ATK+15% 持续15秒"、"目标受到物理伤害+10%"）。这些不适合作为 static effects 聚合——它们需要 simulation 事件系统支持。

因此当前不存在"旧 row1 硬编码 + 新 effects[] 双路径"的风险，因为它们作用于不同层：
- `TALENT_ROW1_BONUSES` → 全角色统一 row1 机制 → static → configuredStats
- `talent.stages[].effects` → 目前全空（runtime effects 待接入）→ 不影响 configuredStats

## 7. 天赋/潜能静态效果进入 configuredStats 的主路径

```
growth.potentialLevel → resolveTrackActiveEffects() → activePotentials[].effects[]
                                                    → (scope: "static" filtered)
                                                    → resolveTrackConfiguredStats()
                                                    → result[stat] += value
                                                    → configuredStats output
```

## 8. 前端可观察的变化

**当 potentialLevel > 0 时，configuredStats 会反映潜能的静态加成。**

示例（LAEVATAIN, E4, potentialLevel=2）：
- intellect: 177(base) + 60(row1) + 20(pot L2) = 257
- attack_dmg_bonus: 0 + 15(pot L2) = 15

这会体现在：
- 左侧能力值面板的属性数值
- 能力值详情模式的 ATK breakdown
- DamageSummary 的伤害计算

**当前默认 6★ potentialLevel=0**，所以不会立即看到变化。需要用户手动设置 potentialLevel > 0（或后续接 UI 选择器）才能观察到。

## 9. 是否引入新的真值源

**否。** effects[] 直接嵌入现有 potentials.json / talents.json 中（定义层）。configuredStats 通过 `resolveTrackActiveEffects()` 从单一来源读取。无新 JSON / 无新 registry / 无平行覆盖层。
