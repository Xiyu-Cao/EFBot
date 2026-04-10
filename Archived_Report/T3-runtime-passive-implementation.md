# T3 Runtime Passive Effects 接入 Simulation 报告

---

## 1. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/simulation/simulator.ts` | 新增 runtime_passive effect 注册逻辑（~20 行）+ Effect import |

仅 1 个文件。

## 2. 每个文件改了什么

### simulator.ts

在 equipment passives 注册之后、AVYWENNA lance tracking 之前，新增 runtime_passive 注册块：

```javascript
for (const actor of actors) {
  // 从 actor.stats._activeEffects 读取 runtime_passive damage_bonus
  // 注册为 permanent Effect on actor → dynamicBonuses zone="fragility"
}
```

## 3. Runtime effects 进入 simulation 的主路径

```
talents.json stages[].effects
  → resolveTrackActiveEffects() → activeTalents[].activeStage.effects
  → resolveTrackConfiguredStats() → result._activeEffects
  → buildSimulationTracks() → actor.stats._activeEffects
  → simulator.ts setup → engine.state.getActor().effects.add(permanent Effect)
  → computeFragilityZone() → aggregateZoneBonuses("fragility")
  → DamageResolver damage formula ×fragility
```

## 4. 第一批实际支持的 effect types

| effect | scope | stat | 注册方式 | 验证角色 |
|---|---|---|---|---|
| `damage_bonus` | `runtime_passive` | `physical_dmg` | actor permanent Effect → fragility zone | ENDMINISTRATOR 现实静滞 |
| `damage_bonus` | `runtime_passive` | `cold_dmg` | 同上 | XAIHI 启动进程 |

共 4 个 effect entries（2 角色 × 2 stages）。

## 5. 明确未实现的

| 类型 | 原因 |
|---|---|
| `runtime_conditional`（26 个）| 需要触发条件 + duration buff 管理 |
| `resistance_ignore`（LAEVATAIN 灼心）| 需要修改 resistance zone 计算 |
| `gauge_modifier` | 需要修改 gauge 系统 |
| `parsed_unimplemented`（65 个）| 复杂效果待逐个分析 |

## 6. 现有伤害公式主链是否被修改

**否。** 完全复用现有机制：

- `Effect` class — 从 `effects/types.ts` 导入，现有类
- `dynamicBonuses` — 武器被动已使用的属性模式
- `zone: "fragility"` — 已有 fragility zone 聚合逻辑
- `evaluateDynamicBonus()` — 已有 `physical_dmg` → `damageSchool === "physical"` 匹配
- `aggregateZoneBonuses("fragility")` — 已有从 actor effects 读取并聚合

没有修改 multiplierZones.ts / DamageResolver.ts / aggregateAttackBonuses 等核心文件。

## 7. 前端可观察的变化

### ENDMINISTRATOR（默认 E4，现实静滞 level 2）

**修改前**: 物理伤害无 fragility 加成
**修改后**: 物理伤害 ×1.20（+20% fragility from 现实静滞 E3 upgrade）

**在 DamageSummary 中**: ENDMINISTRATOR 的所有物理伤害技能（战技/连携/终结）伤害增加 20%。

**测试方法**:
1. 排轴中放 ENDMINISTRATOR 的战技
2. 比较修改前后 DamageSummary 的伤害数值
3. 应增加约 20%

### XAIHI 启动进程

如果 XAIHI 有寒冷伤害技能在排轴上，fragility zone 会加 +7%（E1）或 +10%（E2）。

**注意**: 这些是天赋被动，默认在 E4 且 talentLevel = max 时自动生效。如果用户手动设置 talentLevel = 0（天赋未激活），则不生效。

## 8. 新真值源

**否。** effects 数据来自 talents.json 的 stages[].effects 字段。通过 `resolveTrackActiveEffects()` → `_activeEffects` → simulator 读取。无新 JSON / registry / 硬编码映射。
