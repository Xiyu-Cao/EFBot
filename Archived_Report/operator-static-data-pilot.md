# 干员静态数据目录结构试跑 — 完成报告

## 目录结构

```
src/data/operators/
  README.md                         # Schema 说明
  loader.js                         # 轻量加载器
  ENDMINISTRATOR/
    meta.json
    stats.json
    skills.json
    talents.json
    ability-expansion.json
```

## 试跑干员

ENDMINISTRATOR（管理员） — 项目里数据最齐全、能力扩展/天赋/技能已全部有对应 UI。

## 各文件内容

| 文件 | 承载内容 |
|---|---|
| `meta.json` | id、名称、稀有度、职业、元素、武器类型、主/副属性、头像和技能/天赋图标路径。字段用稳定英文 key（`profession: "guard"`），中文 label 放在 `*Label` 字段 |
| `stats.json` | 完整 1-90 级基础属性表（strength/agility/intellect/will/attack/hp），key 为等级字符串。另含 `promotionCaps` 数组 |
| `skills.json` | 4 个技能（attack/skill/link/ultimate），各含 name、icon、description、12 级倍率表（RANK1-9 + M1-M3） |
| `talents.json` | 主属性/副属性定义、2 个天赋（含 unlockStage/upgradeStage/分阶段描述）、专属 buff 列表 |
| `ability-expansion.json` | 5 个精英化阶段的 maxLevel、skillCap（统一等级 1-12）、unlocks（天赋 ID 列表） |

## 静态 vs 配置边界

### 属于静态文件（在此目录）
- 干员身份信息、图标路径
- 每级基础属性值
- 技能描述和每级倍率
- 天赋描述和解锁阶段
- 精英化阶段规则

### 刻意不放进静态文件（留在 track/store）
- 当前精英化等级
- 当前角色等级
- 当前技能等级/专精
- 当前武器/装备选择
- 当前精锻等级
- 计算后的最终属性

## 加载器

`loader.js` 提供：
- `loadOperator(id)` → 返回 `{ meta, stats, skills, talents, abilityExpansion }`，未迁移的干员返回 null 字段
- `lookupOperatorStats(id, level)` → 直接查某干员某等级基础属性，未迁移返回 null
- `listMigratedOperators()` → 列出已迁移的干员 ID

全部用 `import.meta.glob` eager 加载，对未迁移的干员 graceful fallback。

## 本次范围

只做了"模板 + ENDMINISTRATOR 单干员试跑"，未全量迁移，未替换现有读取链。

## 全量迁移建议

1. 写一个 Node 脚本从 warfarin-wiki normalized + gamedata.json 自动生成每个干员的 5 个文件
2. 逐步让 `resolveBaseStats()` 优先从新结构读取，wiki 数据作 fallback
3. 让 AbilityExpansionOverlay 的天赋/技能数据优先从新结构读取
4. 最终移除对 warfarin-wiki normalized 全量 glob 的依赖（减小 bundle）
