# 当前配置接入 simulation 计算输入 — 完成报告

## 1. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `timelineStore.js` | 新增 `buildSimulationTracks()` 桥接函数；`compiledScenario` 改为使用桥接后的 tracks；`resolveTrackFinalStats()` 新增 `primary_ability` / `secondary_ability` 解析 |

## 2. 桥接层入口

### `buildSimulationTracks()`
- 位置: `timelineStore.js`（内部函数，由 `compiledScenario` computed 调用）
- 职责: 为每个有 operatorId 的 track 注入：
  - `stats`: 完整最终属性（base + weapon/equipment deltas），替换原来只有 deltas 的 `track.stats`
  - `_growth`: 当前 growth 配置（promotion、characterLevel、skillLevels），作为 sidecar 数据随 track 传入编译链

### 数据流
```
track.growth (配置状态)
    ↓
resolveTrackFinalStats(trackId)
    ├── resolveBaseStats → stats.json 基础属性
    ├── track.stats → weapon/equipment deltas
    └── loadOperator().meta → mainAttribute/subAttribute → primary_ability/secondary_ability
    ↓
buildSimulationTracks() → 注入到 compiledScenario
    ↓
compileScenario → processActors → ActorSnapshot.stats
    ↓
simulate → DamageResolver.resolve
    ├── computeEffectiveAttack(baseAttack=319, primary=140, secondary=123)
    ├── computeAllZones(crit, dmgBonus, ...)
    └── finalDamage = floor(ATK × mult × zones)
```

## 3. 最终属性如何接入

之前：`track.stats` 只包含 weapon/equipment deltas → `baseAttack = 0` → 伤害计算基础为 0
现在：`track.stats` 被替换为 `resolveTrackFinalStats()` 的输出 → `baseAttack = 319`（以管理员 Lv90 为例）

`primary_ability` 和 `secondary_ability` 也从 operator meta 的 mainAttribute/subAttribute 映射填入（管理员: 敏捷 140 / 力量 123）。

## 4. 技能等级如何接入

当前技能等级通过 `_growth.skillLevels` 随 track 传入编译链。编译器/运行时当前尚未消费此字段（硬编码的 `SKILL_MULTIPLIERS` 仍在使用），但基础设施已就位，后续可直接读取。

## 5. 哪条实际计算链已在消费

**整条 damage 计算链**现在消费最终属性：
- `compiledScenario` → `compileScenario` 读取增强后的 `track.stats`
- `processActors` 创建 `ActorSnapshot.stats`
- `DamageResolver.resolve` 调用 `computeEffectiveAttack` 使用 `stats.attack`、`stats.primary_ability`、`stats.secondary_ability`
- 所有伤害加成区（暴击、元素伤害、技能伤害加成等）读取 `stats.*` 字段

验证：管理员 Lv90 无装备时有效攻击力 = floor(319 × 1.946) = 620

## 6. 未覆盖 / 下一步

| 项目 | 状态 | 下一步 |
|---|---|---|
| 基础属性 → damage 计算 | 已接入 | — |
| primary/secondary ability | 已接入 | — |
| 技能等级 → 倍率选择 | 基础设施就位（`_growth` 随 track 传入） | 修改 `applySkillMultiplierOverlay` 接受 skill level，从 skills.json 查对应倍率 |
| `SKILL_MULTIPLIERS` 硬编码 | 仍在使用 | 逐步替换为 skills.json 的 levelData |
| 角色等级变化 → 属性自动更新 | 已生效（通过 growth → resolveBaseStats 链） | — |
| 武器/装备配置变化 → 属性更新 | 已生效（通过现有 delta 系统） | — |
