# 天赋阵列第一行效果接入 — 完成报告

## 1. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `timelineStore.js` | 新增 `TALENT_ROW1_BONUSES` / `getTalentRow1Bonus()`；`resolveTrackConfiguredStats` 中注入主能力加成 |
| `AbilityExpansionOverlay.vue` | Row 1 改为全部使用主能力图标；`row1Nodes` computed 替代旧 `ATTR_ENTRIES`；新增 `selectRow1Node` 点击处理 |

## 2. 第一行图标

4 个节点全部显示当前干员的主能力图标（敏捷→敏捷图标×4，智识→智识图标×4）。不再显示四种不同能力图标。已生效节点有 `active` 高亮。

## 3. 四个节点的加成规则

```javascript
TALENT_ROW1_BONUSES = [0, 10, 15, 15, 20]  // index = promotion stage
```

| 节点 | 对应阶段 | 单独加成 | 累计加成 |
|---|---|---|---|
| E1 | 精英1 | +10 | +10 |
| E2 | 精英2 | +15 | +25 |
| E3 | 精英3 | +15 | +40 |
| E4 | 精英4 | +20 | +60 |

规则存放在 store 的 `TALENT_ROW1_BONUSES` 常量中，通过 `getTalentRow1Bonus(promotion)` 累加。

## 4. 精英化 0~4 时主能力总加成

| 精英化 | 累计加成 | 管理员敏捷 (Lv90) | effectiveATK |
|---|---|---|---|
| E0 | +0 | 140 | 620 |
| E1 | +10 | 150 | 636 |
| E2 | +25 | 165 | 660 |
| E3 | +40 | 180 | 684 |
| E4 | +60 | 200 | 716 |

## 5. 是否进入 configured stats

是。`resolveTrackConfiguredStats` 中在 base + weapon/equipment delta 之后、primary_ability 解析之前注入：

```
result[mainAttribute] += getTalentRow1Bonus(promotion)
```

这意味着主能力值增加 → primary_ability 增加 → effectiveATK 增加。

## 6. 联动链

| 消费点 | 是否联动 |
|---|---|
| 左侧常驻能力值（力量/敏捷/智识/意志） | ✅ |
| 左侧常驻攻击力 | ✅ |
| 能力值详情模式（全部属性 + ATK breakdown） | ✅ |
| buildSimulationTracks → simulation 输入 | ✅ |
| 能力扩展模式 Row 1 节点高亮 | ✅ (active class) |
| 右侧说明区（点击节点显示描述） | ✅ |

## 7. 第二/第三行

未接入效果。仍为天赋说明展示 + 占位。本次只处理了第一行。
