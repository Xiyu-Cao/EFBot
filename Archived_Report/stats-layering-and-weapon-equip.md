# 武器/装备数值接入 + 属性层次整理 — 完成报告

## 1. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `timelineStore.js` | `resolveTrackFinalStats` 重命名为 `resolveTrackConfiguredStats`（保留旧名 alias）；新增 3 层模型文档注释；导出新名 |
| `OperatorInfoPanel.vue` | `actorStats` 改为读 `resolveTrackConfiguredStats`；新增 `effectiveAttack` computed（ATK 公式实算）；新增 `bonusStats` computed（武器/装备加成展示） |

## 2. 武器/装备数值这次补齐了什么

武器/装备 delta 系统本身已完整（写入 `track.stats` 所有 34 个 CORE_STATS 字段），之前就已通过 `resolveTrackFinalStats` 流入。这次补齐的是 **UI 展示**：

- `effectiveAttack`：面板现在显示 `⚔ 319 → 620`（基础攻击 → 经主/副能力加成后的实际攻击力）
- `bonusStats`：武器/装备贡献的非零加成（暴击率、暴伤、元素伤害、技能加成等）自动列出，无需手动维护

## 3. 角色基础数据完整性

| 数据 | 来源 | 面板显示 |
|---|---|---|
| 力量/敏捷/智识/意志 | stats.json → resolveTrackBaseStats + weapon/equip delta | 已显示（4 格） |
| 基础攻击力 | stats.json + delta | 已显示 |
| 有效攻击力 | ATK × (1 + primary×0.5% + secondary×0.2%) | **新增**显示 |
| HP | stats.json + delta | 已显示 |
| 暴击/暴伤 | weapon/equip delta | **新增**动态显示（有值时才出现） |
| 元素/技能伤害加成 | weapon/equip delta | **新增**动态显示 |
| primary_ability / secondary_ability | 由 mainAttribute/subAttribute 映射 | 间接显示（通过有效攻击力） |

## 4. 三层属性模型

```
Layer 1 — BASE STATS (resolveTrackBaseStats)
  纯等级查表值。6 字段。
  变化时机：角色等级改变

Layer 2 — CONFIGURED STATS (resolveTrackConfiguredStats) ← 本次主力
  Base + 武器/装备 delta。全部 CORE_STATS 字段 + primary/secondary ability。
  这是"build 面板值"——进入战斗前的角色面板属性。
  变化时机：等级、武器、装备、精锻改变

Layer 3 — DYNAMIC STATS (未实现，预留)
  Configured + 战斗 buff/debuff/技能状态。
  将由 simulation runtime 每 tick 计算，不存入 track。
  变化时机：每帧/每 tick
```

## 5. 是否避免了固定值

是。所有面板数值都是 `computed`，响应式读取：
- `configuredStats` = `computed(() => store.resolveTrackConfiguredStats(...))`
- `effectiveAttack` = `computed` 基于 `configuredStats`
- `bonusStats` = `computed` 基于 `configuredStats`

改等级/武器/装备/精锻 → 数值自动更新。没有任何硬编码常量。

## 6. 待办确认

**"技能等级 / 专精等级真正影响倍率选择"**已明确保留为待办，本次未实现。`SKILL_MULTIPLIERS` 硬编码查表未改动。`_growth.skillLevels` 已随 track 传入编译链但尚未被消费。

## 7. 后续 buff 接入路径

```
当前已实现:
  resolveTrackConfiguredStats (Layer 2) → buildSimulationTracks → compiledScenario → simulate

后续 buff 接入:
  simulate 内部 DamageHandler 已有 aggregateAttackBonuses(ctx.state, actorId)
  → ctx.state 管理 activeBuffs
  → 在 DamageResolver 里 percentBonus/flatBonus 已预留位置
  → 只需在 runtime 层叠加 buff 到 configured stats 即可
  → 不需要修改 Layer 2 或 track 存储
```

也就是说：Layer 2 (configured) 提供"进入战斗时的初始值"，Layer 3 (dynamic) 由 runtime 在每个 damage tick 时实时叠加 buff。两层不互相侵入。
