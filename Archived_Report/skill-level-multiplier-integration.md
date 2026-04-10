# 技能等级影响倍率选择 — 完成报告

## 1. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `simulation/simulator.ts` | `SimulateOptions` 新增 `skillLevelMap`；simulate 内传入 `unifiedLevel` 给 `applySkillMultiplierOverlay` |
| `simulation/data/skillMultipliers.ts` | `applySkillMultiplierOverlay` 新增 `unifiedLevel` 参数；新增 `getSkillMultiplierFromData()` 从 skills.json 按等级查表 |
| `stores/timelineStore.js` | 构建 `skillLevelMap` 并传入 `simulate()` |

## 2. Runtime 技能等级读取链

```
track.growth.skillLevels → skillToUnified() → skillLevelMap → simulate(options.skillLevelMap)
  → applySkillMultiplierOverlay(trackId, actionType, tickIndex, tick, isEnhanced, unifiedLevel)
    → getSkillMultiplierFromData(characterId, actionType, unifiedLevel)
```

## 3. 倍率选择逻辑

### 优先级
1. 编译器已填入非零 multiplier → 保持不变
2. skills.json 有该技能的倍率行 → 按当前 unifiedLevel 索引取值（e.g., 350% → 3.5）
3. 硬编码 SKILL_MULTIPLIERS → 用作 fallback，并按 skills.json 的等级比例缩放
4. 都没有 → multiplier 保持 0（不计算伤害）

### 单 tick 技能（tickIndex === 0 且有 skills.json）
直接用 skills.json 对应等级的值，完全替代硬编码。

### 多 tick 技能
用硬编码的 per-tick 分布 × (当前等级值/M3值) 的缩放比例，保持 tick 间比例不变。

## 4. 复用的 helper

- `skillToUnified({ rank, mastery })` — store 已有，直接用
- unified level 1-12 → skills.json 数组 index 0-11

## 5. 已消费的计算链

整条 damage 计算链：
- `compiledScenario` → `simulate()` → `applySkillMultiplierOverlay()` → `DamageHandler` → `DamageResolver.resolve()`
- 改变技能等级 → `skillLevelMap` 变化 → `simulation` computed 重算 → 伤害结果变化

## 6. skills.json 角色

本次 skills.json **同时** 用于说明和 runtime 真值。`getSkillMultiplierFromData` 直接解析 skills.json 的 `levelData` 中包含 `%` 和 `倍率`/`伤害` 的行作为倍率来源。

这比硬编码 `SKILL_MULTIPLIERS` 更准确（硬编码是 "estimated"，skills.json 来自 warfarin.wiki 真实数据）。

## 7. 未覆盖

- 攻击段（attackSegments）倍率 — 暂未接入 skills.json 每段数据
- 特殊技能效果（燃烧持续时间、封印时间等）— 非倍率字段，不在本次范围
- enhancedMultipliers — 仍从硬编码读取（终结技增强态）

## 验证：ENDMINISTRATOR 构成序列（战技）

条件：Lv90 E4，无武器/装备，敌人防御100（防御乘区×0.5），无暴击/无其他加成

| 等级 | 倍率 | 基础伤害 | 防御后伤害 |
|---|---|---|---|
| RANK 1 | ×1.56 | 1116 | **558** |
| RANK 9 | ×2.80 | 2004 | **1002** |
| M3 | ×3.50 | 2506 | **1253** |

effectiveATK = 716（base 319 × ability mult 2.246）
