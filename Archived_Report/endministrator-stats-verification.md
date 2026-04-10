# 管理员基础属性显示接入新静态数据 — 完成报告

## 改了哪些文件

| 文件 | 改动 |
|---|---|
| `timelineStore.js` | 导入 `lookupOperatorStats`；`resolveBaseStats()` 新增优先读取新静态数据逻辑 |
| `OperatorInfoPanel.vue` | `actorStats` 改为通过 `resolveTrackFinalStats()` 读取（base + deltas），不再直接读 `track.stats` |

## 管理员哪些属性走新结构

strength / agility / intellect / will / attack / hp — 这 6 项基础属性现在优先从 `src/data/operators/ENDMINISTRATOR/stats.json` 读取。

## 其他干员

仍走旧入口（warfarin-wiki normalized data）。`resolveBaseStats()` 内部逻辑：
1. 先 `lookupOperatorStats(id, level)` — 只有已迁移的干员（目前只有 ENDMINISTRATOR）命中
2. 返回 null → fallback 到 wiki data

## 失败时 fallback

- 新静态数据读取失败（文件缺失/字段缺失）→ 返回 null → 自动走 wiki data fallback
- wiki data 也失败 → `resolveTrackFinalStats()` 中 base 为 null → 只显示 weapon/equipment delta（和之前行为一致）
- 界面不会因此崩溃

## 去哪里验证

1. **左侧干员信息面板 → "能力值" 区域**
   - 选中管理员，应看到 力量/敏捷/智识/意志 有非零数值（之前可能显示 0）
   - Lv90 应显示: 力量 123 / 敏捷 140 / 智识 96 / 意志 107 / 攻击 319 / HP 5495
   - 如果装备了武器/装备，值会在此基础上叠加

2. **修改等级后数值变化**
   - 在干员信息面板里把等级从 90 改到 1
   - 应看到 力量 14 / 敏捷 14 / 智识 9 / 意志 10 / 攻击 30 / HP 500
   - 改到中间等级（如 60）应看到对应值

3. **切换到其他干员**
   - 选另一个干员后，能力值应正常显示（走 wiki fallback）
   - 切回管理员，值恢复
