# 项目数据源盘点报告

## 1. 敌人数据现状

### 已有数据

| 字段 | 数据源 | 路径 | 是否真实使用 |
|---|---|---|---|
| maxStagger | `gamedata.json` → `enemyDatabase[].maxStagger` | `public/gamedata.json` | **是**：通过 `timelineStore.applyEnemyPreset()` → `systemConstants` → `compileScenario` → `EnemyConfig` → `EnemyState` |
| staggerNodeCount | 同上 | 同上 | **是**：同上链路 |
| staggerNodeDuration | 同上 | 同上 | **是** |
| staggerBreakDuration | 同上 | 同上 | **是** |
| executionRecovery | 同上 | 同上 | **是** |
| tier (boss/elite/normal) | `gamedata.json` → `enemyDatabase[].tier` | 同上 | **仅 UI**：用于分类展示，未进入 simulation |
| category | `gamedata.json` → `enemyDatabase[].category` | 同上 | **仅 UI** |

总计 58 个敌人预设，含 boss / elite / normal 分类。

### 缺失数据（simulation 中硬编码或 TODO）

| 字段 | 当前状态 | 硬编码位置 |
|---|---|---|
| 防御区 | **硬编码 0.5** | `multiplierZones.ts:52` |
| 基础抗性（法抗/物抗） | **硬编码 0** | `multiplierZones.ts:247` |
| 控制免疫（按类型） | **完全缺失** | 无 |

**结论**：敌人失衡相关数据链路完整且真实使用中。防御 / 抗性 / 控制免疫完全缺失——`gamedata.json` 的 `enemyDatabase` 不含这些字段。

---

## 2. 角色数据现状

### 数据链路

```
gamedata.json (characterRoster)
  → timelineStore (characterRoster ref)
    → 用户在 UI 添加角色到 timeline
      → ScenarioTrack.stats (ActorStats)
        → compileScenario → ActorSnapshot
          → simulation 使用
```

### 已有数据

| 字段 | 数据源 | 是否接入 simulation |
|---|---|---|
| attack | `ScenarioTrack.stats.attack` （用户配置或武器 delta 累加） | **是**：`attackFormula.computeAttackFromStats` |
| primary_ability / secondary_ability | `ScenarioTrack.stats` | **是**：`attackFormula` 截断+取整 |
| crit_rate / crit_dmg | `ScenarioTrack.stats` | **是**：`critSystem.resolveCrit` |
| blaze_dmg / cold_dmg / emag_dmg / nature_dmg | `ScenarioTrack.stats` | **是**：`multiplierZones.computeDamageBonusZone` |
| physical_dmg / arts_dmg | `ScenarioTrack.stats` | **是** |
| attack_dmg_bonus / skill_dmg_bonus / link_dmg_bonus / ultimate_dmg_bonus | `ScenarioTrack.stats` | **是** |
| all_skill_dmg_bonus / broken_dmg_bonus | `ScenarioTrack.stats` | **是** |
| originium_arts_power | `ScenarioTrack.stats` | **是**：`multiplierZones.computeSpecialZone` |
| ult_charge_eff | `ScenarioTrack.stats` | **是**：终结技充能 |
| link_cd_reduction | `ScenarioTrack.stats` | **是**：连携 CD 缩减 |
| hp | `ScenarioTrack.stats` | 部分（仅存储，未用于伤害计算） |

### 默认值来源

`coreStats.js:createDefaultStats()` — 所有 27 个属性的默认值（大部分为 0，`ult_charge_eff` 默认 100）。

### 武器对 stats 的影响

`timelineStore.js` 中 `computeWeaponDeltasForTrack` → `applyWeaponDeltasToTrack`：
- 读取武器的 `commonSlots`（通用词条）和 `buffBonuses`（特殊词条）
- 按精炼等级查表
- 以 delta 方式累加到 `track.stats`
- **在 UI 层完成，进入 scenario 时 stats 已包含武器静态词条**

### 装备对 stats 的影响

`timelineStore.js` 中 `computeEquipmentDeltasForTrack` → `applyEquipmentDeltasToTrack`：
- 读取装备的 `affixes`（主词条 + 副词条）
- 按精炼等级查表
- 以 delta 方式累加到 `track.stats`
- **同样在 UI 层完成**

**结论**：角色基础属性链路完整。武器/装备的静态词条通过 `timelineStore` delta 机制在场景构建时就已融入 `track.stats`，simulation 拿到的 `ActorSnapshot.stats` 已经是"裸角色 + 武器词条 + 装备词条"的总和。

---

## 3. 装备 / 套装 / 武器数据现状

### 3.1 gamedata.json 中的数据（真值源）

**weaponDatabase** (66 把武器):

```typescript
{
  id: string,           // "wpn_claym_0004"
  name: string,         // "典范"
  type: string,         // "claym"
  rarity: number,       // 6
  baseAtk: number,      // 500
  icon: string,
  commonSlots: [{modifierId, size}],   // 通用词条槽
  buffBonuses: [{modifierId, values}], // 特殊词条
  passiveStats: Record<string, number>, // 常驻属性（如 physical_dmg: 28）
  triggeredBuffs: [{                   // 触发效果
    trigger: string,     // "on_skill_or_ultimate_hit"
    name: string,        // "多层斩断"
    target: string,      // "self" | "enemy" | "team" | "others" | "main_operator"
    effects: [{stat, value, zone, unit}],
    duration: number,
    maxStacks: number,
    stackCooldown: number,
    _raw: string,        // 原文描述
  }],
  duration: number,      // set bonus icon 持续时间（UI）
}
```

已有触发类型（38 种）：`on_skill_hit`, `on_skill_or_ultimate_hit`, `on_physical_anomaly`, `on_burning_apply`, `on_freeze_apply`, `on_conductive_apply`, `on_nature_attach`, `on_link`, `on_ultimate`, 等。

已有目标类型：`self`, `enemy`, `team`, `others`, `main_operator`

已有 effect zone 类型：`增伤`, `攻击加成`, `角色属性`, `易伤`, `特殊系数`, `暴击`

**equipmentDatabase** (170 件装备):

```typescript
{
  id: string,
  name: string,
  category: string,      // "点剑", "动火用", etc.
  slot: string,          // "armor", "gloves", "accessory"
  level: number,         // 50 or 70
  affixes: {
    primary1: {modifierId, values[]},
    primary2: {modifierId, values[]},
    adapter: {entries: [{modifierId, values[]}], modifierIds[], values[]},
  }
}
```

**equipmentCategoryConfigs** (21 个套组):

```typescript
{
  "点剑": { setBonus: { duration: 0 } },
  "动火用": { setBonus: { duration: 8 } },
  ...
}
```

### 3.2 timelineStore 中的使用方式

| 功能 | 使用的数据 | 代码位置 |
|---|---|---|
| 武器静态词条 → stats delta | `weaponDatabase[].commonSlots` + `buffBonuses` + `misc.weaponCommonModifiers` | `timelineStore.js:1358-1418` |
| 装备静态词条 → stats delta | `equipmentDatabase[].affixes` | `timelineStore.js:1459-1520` |
| 套装激活判断 | `equipmentDatabase[].category` + 计数 >= 3 | `timelineStore.js:1601-1611` |
| 套装效果持续时间（UI） | `equipmentCategoryConfigs[].setBonus.duration` | `timelineStore.js:1613-1619` |

### 3.3 simulation/equipment 中的使用方式

| 功能 | 数据来源 | 代码位置 |
|---|---|---|
| 套装触发效果 | **硬编码在 `definitions.ts`** | `equipment/definitions.ts` |
| 武器触发效果 | **硬编码在 `definitions.ts`** | `equipment/definitions.ts` |
| 常驻属性加成 | **硬编码在 `definitions.ts`**（直接修改 stats） | `equipment/definitions.ts` |
| 注册映射 | **硬编码在 `registry.ts`** 的 `SET_REGISTRY` / `WEAPON_REGISTRY` | `equipment/registry.ts` |

### 3.4 双真值源风险 — 关键发现

**`gamedata.json` 的 `triggeredBuffs` 与 `equipment/definitions.ts` 是同一效果的两份独立描述。**

示例对比——典范武器：

| 字段 | gamedata.json | definitions.ts |
|---|---|---|
| passiveStats | `{ physical_dmg: 28 }` | `stats.physical_dmg += 28` |
| trigger | `on_skill_or_ultimate_hit` | `event: "DAMAGE_TICK"` + condition: skill/ultimate |
| duration | 30 | 30 |
| maxStacks | 3 | `addStackWithIndependentDuration(..., 3)` |
| stackCooldown | 0.1 | `cooldownDuration: 0.1` |
| effects | `[]` (空！_raw 存了描述文本) | `{ stat: "physical_dmg", value: 28 }` |

`gamedata.json` 有完整的触发条件元数据但 **effects 数组经常为空**——真实效果值藏在 `_raw` 文本中。`definitions.ts` 是手工翻译这些 `_raw` 描述的代码化版本。

---

## 4. 旧伤害 / 效果数据现状

### 4.1 异常伤害公式——双真值源

| 公式 | `utils/anomalyCalc.js` (旧) | `calculation/anomalyDamageCalc.ts` (新) |
|---|---|---|
| 法术爆发 | `attack * 1.6 * spellLevelCoef(level)` | `MAGIC_BURST_MULTIPLIER: {1:0.5, 2:0.8, 3:1.2, 4:1.8}` (placeholder) |
| 法术异常触发 | `attack * 0.8 * (1 + anomalyLevel) * spellLevelCoef * artsPowerDamageMult` | `ANOMALY_DIRECT_MULTIPLIER: {burn:1.0, freeze:0.8, ...}` (placeholder) |
| 燃烧 tick | `attack * 0.12 * (1 + anomalyLevel) * spellLevelCoef * artsPowerDamageMult` | `BURN_TICK_MULTIPLIER: {1:0.3, 2:0.5, 3:0.7, 4:1.0}` (placeholder) |
| 碎冰 | `attack * 1.2 * (1 + anomalyLevel) * spellLevelCoef * artsPowerDamageMult` | `SHATTER_MULTIPLIER: {1:1.5, 2:2.0, 3:2.5, 4:3.0}` (placeholder) |
| 击飞/倒地 | `attack * 1.2 * physLevelCoef * artsPowerDamageMult` | `launch: 0.8, knockdown: 0.8` (placeholder) |
| 猛击 | `attack * 1.5 * (1 + stacks) * physLevelCoef * artsPowerDamageMult` | `slam: 1.2` (placeholder) |
| 碎甲 | `attack * 0.5 * (1 + stacks) * physLevelCoef * artsPowerDamageMult` | `armorBreak: 1.0` (placeholder) |

**`anomalyCalc.js` 是更准确的公式**（含等级系数、源石技艺强度乘区），被 `timelineStore.js` 引用用于 UI 投影伤害。

**`anomalyDamageCalc.ts` 是 Phase 4 为 simulation 写的 placeholder**，数值不准确，且不含等级系数和 artsPower 乘区（artsPower 在 `multiplierZones.computeSpecialZone` 单独处理，但公式不同）。

**这是当前最大的双真值源问题。**

### 4.2 导电/腐蚀参数

| 参数 | `anomalyCalc.js` (旧) | `anomaly/types.ts` (新) |
|---|---|---|
| 导电易伤 % | `(anomalyLevel + 2) * 4 * artsPowerDebuffMult` | `CONDUCTION_PERCENT_BY_LEVEL: {1:12, 2:16, 3:20, 4:24}` |
| 导电持续时间 | `anomalyLevel * 6 + 6` | `CONDUCTION_DURATION_BY_LEVEL: {1:12, 2:18, 3:24, 4:30}` |
| 腐蚀减抗（初始） | `(anomalyLevel * 1.2 + 2.4) * artsPowerDebuffMult` | `EnemyStatusState.CORROSION_PARAMS` (placeholder 固定值) |
| 腐蚀减抗（每秒） | `(anomalyLevel * 0.28 + 0.56) * artsPowerDebuffMult` | 同上 |
| 腐蚀减抗（上限） | `(anomalyLevel * 4 + 8) * artsPowerDebuffMult` | 同上 |

导电持续时间的数值恰好一致（公式结果 = 查表结果）。但**导电易伤和腐蚀参数在 `anomalyCalc.js` 中会乘 `artsPowerDebuffMult`**，而 `anomaly/types.ts` 的查表值不含此修正。

### 4.3 技能倍率 / damage ticks

来源：`gamedata.json` → `characterRoster[].skill_damage_ticks` 等 → 用户 UI 编辑 → `ScenarioTrack.actions[].damageTicks` → `compileScenario` → `ResolvedDamageTick`。

`DamageTick.multiplier` 字段目前大多为 **0 或缺省**（`gamedata.json` 中的 ticks 没有 multiplier 字段）。multiplier 来自用户手动输入或后续扩展。

### 4.4 增幅 / 易伤 / 脆弱 / 连击的现有字段

`gamedata.json` 的 `triggeredBuffs[].effects[].zone` 已定义了：
- `增伤` — 增伤区
- `易伤` — 易伤区
- `特殊系数` — 特殊系数区
- `攻击加成` — 攻击力百分比加成
- `暴击` — 暴击区
- `角色属性` — 基础属性修改

但 simulation 的 `multiplierZones.ts` 中，增幅区 / 连击区 / 脆弱区 / 减伤区仍为 placeholder。

---

## 5. 双真值源风险点

### 风险 1 — 异常伤害公式（HIGH）

| 位置 | 用途 | 状态 |
|---|---|---|
| `utils/anomalyCalc.js` | UI 投影伤害（timelineStore 调用） | **包含真实公式**：等级系数 + artsPower 乘区 |
| `calculation/anomalyDamageCalc.ts` | simulation 真实伤害 | **placeholder 值，数值不正确** |

**风险**：两个系统对同一伤害给出不同数字，用户会困惑。

**建议**：第六阶段应将 `anomalyCalc.js` 的公式迁入 `anomalyDamageCalc.ts`，或让 simulation 调用 `anomalyCalc.js` 中的函数。

### 风险 2 — 装备触发效果（MEDIUM）

| 位置 | 用途 | 状态 |
|---|---|---|
| `gamedata.json` → `triggeredBuffs` | 数据源，含 trigger/target/duration/maxStacks/stackCooldown | effects 数组经常为空，_raw 为文本 |
| `equipment/definitions.ts` | simulation 实际执行 | 手工翻译 `_raw`，与 gamedata.json 未自动对齐 |

**风险**：gamedata.json 更新后 definitions.ts 不更新，两边不一致。

**建议**：第六阶段建立从 `triggeredBuffs` 元数据自动生成 trigger 的机制，至少对 trigger/target/duration/maxStacks/stackCooldown 字段做自动读取。

### 风险 3 — DEFAULT_SYSTEM_CONSTANTS（LOW）

| 位置 | 用途 |
|---|---|
| `compiler/compileScenario.ts:60-71` | simulation 编译默认值 |
| `stores/timelineStore.js:151-162` | UI 默认值 |

两处值完全一致，但手动同步。

**建议**：从 `compileScenario.ts` 导出并让 `timelineStore.js` 导入，消除重复。但这涉及 JS→TS 导入，优先级低。

### 风险 4 — 武器 passiveStats vs definitions.ts 硬编码（MEDIUM）

`gamedata.json` 已有 `passiveStats: { physical_dmg: 28 }`，但 `definitions.ts` 中又写了 `stats.physical_dmg += 28`。

**建议**：静态词条应从 `passiveStats` 自动读取，不需要在 `definitions.ts` 里重复。

---

## 6. 第六阶段建议复用的入口

### 必须复用

| 数据 | 入口 | 理由 |
|---|---|---|
| 异常伤害公式 | `utils/anomalyCalc.js` | 含完整的等级系数、artsPower 计算，是经过验证的真值 |
| 武器 passiveStats | `gamedata.json` → `weaponDatabase[].passiveStats` | 已在 UI 层通过 delta 机制生效，simulation 不应重复加 |
| 武器 triggeredBuffs 元数据 | `gamedata.json` → `weaponDatabase[].triggeredBuffs` | trigger/target/duration/maxStacks/stackCooldown 字段可直接映射到 EffectTrigger |
| 装备 affixes → stats delta | `timelineStore` 的 delta 机制 | 已生效进入 `track.stats`，simulation 拿到的 stats 已含 |
| 套组激活判断 | `timelineStore.getActiveSetBonusCategories(trackId)` | 已实现 category 计数 >= 3 的逻辑 |
| 敌人预设 | `gamedata.json` → `enemyDatabase` | 含 58 个 boss/elite，失衡参数完整 |

### 建议新建（gamedata.json 中不存在）

| 数据 | 理由 |
|---|---|
| 敌人防御区数值 | gamedata.json 无此字段，simulation 硬编码 0.5 |
| 敌人基础抗性 | gamedata.json 无此字段，simulation 硬编码 0 |
| 敌人控制免疫配置 | 完全缺失 |
| 装备套组触发效果的精确数值 | gamedata.json 的 `equipmentCategoryConfigs` 只有 `setBonus.duration`，无触发条件和效果数值 |

---

## 7. 需要用户补充的真值数据

### P0 — 阻塞第六阶段异常伤害修正

1. **确认 `anomalyCalc.js` 的公式是否为最终真值**
   - 法术爆发: `attack * 1.6 * spellLevelCoef(level)`，源石技艺强度不参与——是否正确？
   - 法术异常触发: `attack * 0.8 * (1 + anomalyLevel) * spellLevelCoef * artsPowerDamageMult`
   - 燃烧 tick: `attack * 0.12 * (1 + anomalyLevel) * ...`
   - 这些是否需要额外乘 防御区 / 增伤区 / 暴击区 等乘区？（当前 `timelineStore` 调用时没有乘这些）

2. **确认 artsPowerDebuffMult 公式**
   - 导电易伤: `(anomalyLevel + 2) * 4 * artsPowerDebuffMult(artsPower)` 中的 `artsPowerDebuffMult = 1 + (p * 2) / (p + 300)` 是否为最终真值？
   - 这与 simulation 的 `CONDUCTION_PERCENT_BY_LEVEL` 固定查表不一致。

### P1 — 阻塞装备效果数据驱动

3. **`gamedata.json` 中 `triggeredBuffs[].effects` 为空的武器，效果数值从哪获取？**
   - 当前只有 `_raw` 文本描述
   - 是否计划补充 `effects` 数组？
   - 示例：典范的 `triggeredBuffs[0].effects` 为 `[]`，但实际效果是 +28% physical_dmg

4. **装备套组的触发效果数据是否计划加入 `equipmentCategoryConfigs`？**
   - 当前只有 `{ setBonus: { duration: N } }`
   - 点剑的 "250% ATK 物理伤害 + 10 失衡" 等触发效果只在 `definitions.ts` 硬编码

### P2 — 可后续补充

5. **敌人防御区 / 基础抗性数据**
   - 全 boss 是否统一 0.5 防御？
   - 基础抗性是否为 0？是否有按元素区分的抗性？

6. **角色技能倍率数据**
   - `gamedata.json` 的 `skill_damage_ticks` 没有 `multiplier` 字段
   - 这些数据是否已存在于其他位置（如游戏客户端数据提取）？
