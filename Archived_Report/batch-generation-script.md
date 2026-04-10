# 全量干员静态数据生成脚本 — 完成报告

## 1. 脚本位置与运行方式

```
scripts/generate-operator-data.js
```

运行：
```bash
node scripts/generate-operator-data.js
```

可重复执行，覆盖已有文件。ESM 格式。

## 2. 生成结果

- 25 个干员文件夹
- 每个文件夹 5 个 JSON 文件（meta / stats / skills / talents / ability-expansion）
- 24 个有完整 wiki 数据
- 1 个（ROSSI/洛茜）仅有 gamedata 数据，stats 为空 levels，skills 为空结构

## 3. 与试跑 schema 一致性

脚本输出结构与手工试跑（ENDMINISTRATOR / TANGTANG / LAEVATAIN）完全兼容。脚本覆盖了试跑文件，输出结构相同。

## 4. 字段缺失/特殊情况

| 情况 | 处理 |
|---|---|
| ROSSI 无 wiki 数据 | meta 从 gamedata 生成（profession 为 "unknown"），stats.levels 为空对象，skills 为空结构，talents 为空数组 |
| gamedata ID 与 wiki ID 不匹配（POGRANICHNK/LASTRITE/DAPAN/CHENQIANYU） | 通过 name_zh 匹配解决 |
| 默认解锁天赋（ARDELIA/LAEVATAIN） | 脚本正确解析 `默认解锁` 模式，标记 `defaultUnlock: true` |

## 5. 统一模板 vs 差异化

| 文件 | 生成方式 |
|---|---|
| meta.json | 差异化（每人不同的 profession/element/mainAttribute/icons） |
| stats.json | 差异化（每人不同的 90 级属性表） |
| skills.json | 差异化（每人不同的技能名/描述/倍率行数） |
| talents.json | 差异化（每人不同的天赋名/阶段/exclusiveBuffs） |
| ability-expansion.json | 半统一（promotionCaps/skillCap 相同，unlocks 因天赋不同而异） |

## 6. 建议抽检的干员

- **ARDELIA**（艾尔黛拉）— 辅助/自然/智识主属性，有默认解锁天赋
- **POGRANICHNK**（骏卫）— gamedata ID 与 wiki ID 不匹配的案例
- **ROSSI**（洛茜）— 无 wiki 数据的 fallback 案例

## 7. UI 消费链状态

本次只完成批量生成脚本，未大规模切换 UI 消费链。现有 loader 的 `import.meta.glob` 会自动拾取所有新生成的文件夹，所有 25 个干员的基础属性/技能详情/天赋说明现在都可以通过新结构读取。
