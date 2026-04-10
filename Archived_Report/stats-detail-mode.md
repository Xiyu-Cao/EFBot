# 能力值详情模式 — 完成报告

## 1. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `TimelineEditor.vue` | 新增 `statsDetail` editor mode + `openStatsDetail` provide + StatsDetailOverlay 挂载点 |
| `StatsDetailOverlay.vue` | **新增** — 属性详情面板（核心属性 + ATK 展开 + 其他属性列表） |
| `OperatorInfoPanel.vue` | 能力值精简为 5 项 + 点击入口进入 statsDetail 模式 |

## 2. 左侧常驻能力值

精简为 5 项：
- 力量 / 敏捷 / 智识 / 意志（4 格网格）
- ⚔ 有效攻击力（1 行）

不再常驻显示 HP、暴击率/暴伤、bonusStats 等。这些移入详情页。

## 3. 属性详情模式交互

- 点击"能力值 ▸" → 进入 statsDetail 模式（覆盖中间工作区）
- 再点"能力值 ●" → 退出回到排轴
- 切换干员 → 自动显示对应干员属性（不退出模式）
- 交互风格与能力扩展模式一致（同一个 ae-workspace-panel CSS）

## 4. 详情页展示字段

### 核心属性区
- ♥ 生命值
- ⚔ 攻击力（可展开/收起）
- 力量 / 敏捷 / 智识 / 意志

### 其他属性区（17 项）
暴击率、暴击伤害、源石技艺强度、治疗效率、连携冷却缩减、终结充能效率、物理/灼热/电磁/寒冷/自然伤害加成、普攻/战技/连携/终结/全技能伤害加成、对失衡目标伤害加成

所有值来自 `resolveTrackConfiguredStats()`（Layer 2 配置后值），非固定值。

## 5. 攻击力展开详情

```
攻击力                     620
├── 基础总值                319
│   ├── 干员攻击力          319  (resolveBaseStats().attack)
│   ├── 武器攻击力           0  (track.weaponAppliedDeltas.attack)
│   └── 装备攻击力           0  (track.equipmentAppliedDeltas.attack)
└── 能力值加成           +94.6%
    ├── 来自敏捷的攻击加成 +70.0%  (truncate(agility×0.5))
    └── 来自力量的攻击加成 +24.6%  (truncate(strength×0.2))
```

（以管理员 Lv90 无武器/装备为例）

## 6. 数据来源真实性

| 部分 | 来源 | 状态 |
|---|---|---|
| 干员攻击力 | `resolveBaseStats().attack` → stats.json | 真实查表 |
| 武器攻击力 | `track.weaponAppliedDeltas.attack` | 真实 delta |
| 装备攻击力 | `track.equipmentAppliedDeltas.attack` | 真实 delta |
| 能力值加成 | ATK 公式 `primary×0.5% + secondary×0.2%` | 与 `attackFormula.ts` 一致 |
| 所有 CORE_STATS | `resolveTrackConfiguredStats()` | 真实计算 |

参考图中的"防御力"和"各类抗性"在当前 CORE_STATS 中不存在，暂未显示。这是数据源缺失，不是代码遗漏。

## 7. 未动内容

- simulation/runtime：未改
- 能力扩展模式：未改
- 技能倍率选择：未改（明确待办）
- operator folder schema：未改
