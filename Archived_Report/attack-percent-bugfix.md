# 武器攻击力百分比加成 Bug 修复 — 完成报告

## 1. 根因

武器 common slot 的 `attack` modifier（值为 5-39）和 `passiveStats.attack`（值为 14-28）在游戏中是 **攻击力百分比加成**（+39%），不是 flat 攻击力 +39。

旧代码直接把它写入 `track.stats.attack`（flat 加法），导致 +39% 被当成 +39 处理。

## 2. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `coreStats.js` | 新增 `attack_percent` 字段（默认 0） |
| `timelineStore.js` | `computeWeaponDeltasForTrack` 中将 `attack` modifier 重定向到 `attack_percent`；`resolveTrackConfiguredStats` 中新增 ATK% 乘算 |
| `StatsDetailOverlay.vue` | ATK breakdown 新增"百分比加成"层和"基础攻击力"中间层 |

## 3. 现在的攻击力计算公式

```
基础攻击力 = 干员攻击力 + 武器攻击力(按等级) + 装备攻击力(flat)
基础总值   = floor(基础攻击力 × (1 + 攻击力百分比加成/100))
最终攻击力 = floor(基础总值 × (1 + 主能力×0.5%/100 + 副能力×0.2%/100))
```

## 4. ATK 详情展开

```
攻击力                     3443
├── 基础总值                1138
│   ├── 基础攻击力           819
│   │   ├── 干员攻击力       319
│   │   └── 武器攻击力       500
│   └── 百分比加成         +39.0%
└── 能力值加成           +202.6%
    ├── 来自敏捷的攻击加成 +178.0%
    └── 来自力量的攻击加成  +24.6%
```

## 5. 验证（管理员 E4/Lv90 + 宏愿 Lv90 tier9）

| 项 | 旧（bug） | 新（修复后） |
|---|---|---|
| ATK% 处理 | flat +39 | ×1.39 |
| 基础总值 | 858 | 1138 |
| 最终攻击力 | 2596 | 3443 |

受影响的词条：所有武器 `attack` common slot modifier + 所有武器 `passiveStats.attack`。
