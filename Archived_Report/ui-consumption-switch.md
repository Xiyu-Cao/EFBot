# UI 消费链切换到 operator folder — 完成报告

## 1. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `OperatorInfoPanel.vue` | 导入 `loadOperator`；`professionResolved` 优先从 `opData.meta.professionLabel` 读取，fallback 到 wiki index |
| `AbilityExpansionOverlay.vue` | `skills` computed 技能名称优先从 `opData.skills.{key}.name` 读取，fallback 到通用标签 |

注意：基础属性（`resolveBaseStats`）、技能详情（`selectSkill`）、天赋说明（talents computed）这 3 条链在之前的 pilot 阶段已经接好，本次只补充了两个未覆盖的读取点。

## 2. 3 条 UI 消费链现在的状态

| 链路 | 新数据优先 | fallback |
|---|---|---|
| 基础属性显示（能力值区域） | `lookupOperatorStats()` → stats.json | wiki normalized → track.stats |
| 技能详情（AE 模式右侧） | `opData.skills` → skills.json（含名称、描述、当前等级倍率） | 通用标签（"战技"等） |
| 天赋/主属性说明（AE 模式右侧） | `opData.talents` → talents.json（含分阶段描述） | wiki parseTalentEntries → exclusive_buffs |

所有 25 个干员现在都走新结构优先。

## 3. fallback 行为

- `loadOperator(id)` 对每个字段独立 fallback（meta/stats/skills/talents 各自可 null）
- stats.json levels 为空 → `lookupOperatorStats` 返回 null → 走 wiki data
- skills.json 某技能 name 为空字符串 → 用通用标签（"战技"等）
- talents.json talents 为空数组 → 走 wiki parseTalentEntries → 走 exclusive_buffs
- 全部缺失 → UI 显示默认占位值，不崩溃

## 4. 旧数据源保留

是。wiki normalized glob、wiki index、gamedata.json 全部保留作为 fallback。未删除任何旧读取路径。

## 5. 边缘案例检查

| 干员 | 情况 | 表现 |
|---|---|---|
| ENDMINISTRATOR | 正常案例 | 全部字段从新数据读取 |
| TANGTANG | 正常案例 | 全部字段从新数据读取 |
| ARDELIA | 默认解锁天赋 | `defaultUnlock: true` 正确标记，天赋名称/描述正常 |
| POGRANICHNK | ID 不匹配 | 脚本通过 name_zh 匹配成功，profession=先锋, mainAttribute=意志 |
| ROSSI | 无 wiki 数据 | stats 为空 → base stats null → 只显示 weapon/equipment deltas |

## 6. 接下来建议

最适合先切的剩余入口：
1. **普通模式下的技能详情**（PropertiesPanel 中 targetData 驱动的详情区 — 当前仍读 gamedata/store 而非 skills.json）
2. **OperatorInfoPanel 中天赋/技能的 compact 显示**（名称/图标可切到新数据）
3. **去除 AbilityExpansionOverlay 中的 wiki normalized glob**（24 个 JSON 的 eager 加载已被新 loader 替代，可降为 lazy 或移除以缩减 bundle）
