# T2 收口补丁报告

---

## 1. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/data/operators/*/talents.json` × 25 | 为每个 talent stage 补 `effects[]` 数组（98 条，含 runtime/parsed 标记） |
| `src/stores/timelineStore.js` | configuredStats 聚合改进：`result._activeEffects` 透传全部 effects（含 gauge_modifier） |

## 2. talents 侧 effects[] 已真正落地

98 个 talent stage effects：

| scope | 数量 | 含义 |
|---|---|---|
| `runtime_conditional` | 26 | 条件触发 buff（如"消耗源石结晶后 ATK+15% 持续15秒"）|
| `runtime_passive` | 7 | 常驻被动（如"敌人受到的物理伤害+10%"、"无视抗性10点"）|
| `parsed_unimplemented` | 65 | 复杂效果，仅标记待后续实现 |

**无 static scope** — 这是正确的。天赋阶段效果全部是条件/被动/复杂的，不是面板静态值。

样例：
- ENDMINISTRATOR 本质瓦解 E1: `{type:"stat_bonus", stat:"attack_percent", value:15, scope:"runtime_conditional"}`
- ENDMINISTRATOR 现实静滞 E2: `{type:"damage_bonus", stat:"physical_dmg", value:10, scope:"runtime_passive"}`
- WULFGARD 灼热獠牙 E1: `{type:"damage_bonus", stat:"blaze_dmg", value:20, scope:"runtime_conditional"}`
- LAEVATAIN 灼心 E0: `{type:"resistance_ignore", value:10, scope:"runtime_passive"}`

## 3. 哪些 talent effects 进入 configuredStats

**零个**。所有 talent stage effects 都是 `runtime_*` 或 `parsed_unimplemented`，不是 `static`。configuredStats 的 static 聚合循环正确跳过它们。这不是遗漏，是游戏机制决定的：天赋效果全部是战斗中的条件/被动增益。

## 4. parsed_unimplemented 表示方式

```json
{ "type": "parsed_unimplemented", "scope": "parsed_unimplemented", "note": "complex effect, see description" }
```

这明确区分了：
- `effects: []` — 尚未解析
- `effects: [{ scope: "parsed_unimplemented" }]` — 已解析但效果复杂，当前不实现
- `effects: [{ scope: "runtime_conditional" }]` — 已解析且数值已提取，待 runtime 接入
- `effects: [{ scope: "static" }]` — 已解析且已进入 configuredStats（仅潜能侧有）

## 5. gauge_modifier 可见性

`resolveTrackConfiguredStats()` 现在输出 `result._activeEffects` — 包含当前 active 的全部 effects（含 gauge_modifier）。消费者可通过 `configuredStats._activeEffects.filter(e => e.type === 'gauge_modifier')` 读取。

当前不进入 CORE_STATS（`ult_gauge_cost` 不是 CORE_STATS key），但对 UI/后续聚合可见。

## 6. 为什么 T2 effect 接口层现在可认为已基本建立

| 维度 | 状态 |
|---|---|
| potentials effects[] | ✅ 60 个 static effects 已聚合进 configuredStats |
| talents stages effects[] | ✅ 98 个 effects 已标记（runtime/parsed），结构就绪 |
| scope 区分 | ✅ static / runtime_conditional / runtime_passive / parsed_unimplemented |
| configuredStats 聚合 | ✅ static effects 自动聚合 |
| gauge_modifier 可见 | ✅ 通过 `_activeEffects` 透传 |
| 无双路径 | ✅ effects[] 嵌入现有 JSON，configuredStats 从 resolveTrackActiveEffects() 读 |

## 7. 新真值源

**否。** effects[] 直接嵌入 talents.json / potentials.json 的 stages / entries 中。configuredStats 从 `resolveTrackActiveEffects()` 单一入口读取。`_activeEffects` 是透传非新源。
