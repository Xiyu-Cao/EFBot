# 天赋/潜能 effects[] 与静态聚合接入点审计

---

## 1. 当前 activeTalents / activePotentials 消费情况

`resolveTrackActiveEffects()` 已导出但**当前零消费**。grep 确认无组件/store computed 调用它（仅在导出列表和注释中出现）。

**适合插入 effect 解释/聚合的节点**: `resolveTrackConfiguredStats()`（timelineStore.js line 592）。这是 Layer 2 统一聚合位置，已经包含 base stats + weapon/equip deltas + talent row1 bonus + ATK% 计算。天赋/潜能静态效果应在此处插入。

## 2. configuredStats / passive aggregation 当前主路径

`resolveTrackConfiguredStats(trackId)` 的当前聚合顺序：

```
1. base = resolveTrackBaseStats()          → 干员等级查表（6 字段）
2. delta = track.stats                     → 武器/装备 delta（weapon/equip sync 系统写入）
3. result = base + delta                   → 逐 CORE_STATS 字段合并
4. result[mainAttr] += getTalentRow1Bonus  → 天赋 row1 主属性加成（硬编码 [0,10,15,15,20]）
5. ATK% 乘算                               → attack_percent → attack
6. primary/secondary ability 解析           → 从 mainAttribute/subAttribute 映射
```

**最适合接天赋/潜能静态效果的位置**: 步骤 3 和 4 之间（或替换步骤 4）。在 base + weapon/equip delta 合并完之后、ATK% 乘算之前，插入天赋/潜能的 flat stat 加成。

**不能碰的路径**:
- `track.stats` — 这是武器/装备 delta 系统独占的可变状态，不应往里注入天赋/潜能值（否则会和 delta sync 机制冲突）
- `weaponAppliedDeltas` / `equipmentAppliedDeltas` — 同理

## 3. 现有效果系统可复用程度

### 武器 triggeredBuff effects schema（gamedata.json）

```javascript
{ stat: "physical_dmg", value: 100.8, zone: "增伤", unit: "percent" }
```

字段含义:
- `stat`: CORE_STATS 字段名或复合名（如 `all_ability`）
- `value`: 数值
- `zone`: 伤害公式中的乘区名（增伤/攻击加成/易伤/角色属性）
- `unit`: `"percent"` 或 `"flat"`

**可复用程度**: 这个 schema 适合作为天赋/潜能 effects[] 的基础。但有几个不适合照搬的点：

| 武器 schema 特性 | 是否适合天赋/潜能 |
|---|---|
| `stat` 字段 | ✅ 直接复用（CORE_STATS key） |
| `value` 字段 | ✅ 直接复用 |
| `zone` 字段 | ⚠️ 天赋静态加成不走乘区（它们是面板值加成，不是战斗中乘区），但 runtime 天赋（如增伤）需要 zone |
| `unit` 字段 | ✅ 直接复用 |
| 复合 stat（`all_ability`、`physical_emag_dmg`） | ⚠️ 需要 resolver 拆分 |

### simulation Effect/EffectManager

`EffectManager` 是 runtime buff 系统，管理战斗中的动态效果。天赋/潜能的静态面板加成不应进入 EffectManager——它们是 Layer 2 配置态，不是 Layer 3 动态态。

## 4. effects[] 结构建议

### 最小可扩展 schema

```javascript
{
  // === 效果识别 ===
  type: "stat_bonus",        // 效果类型 (见下方枚举)
  
  // === 数值定义 ===
  stat: "agility",           // CORE_STATS key
  value: 20,                 // 数值
  unit: "flat",              // "flat" | "percent"
  
  // === 作用域 ===
  scope: "static",           // "static" = Layer 2 面板值
                             // "runtime_passive" = Layer 3 运行时常驻
                             // "runtime_conditional" = Layer 3 运行时条件触发
  
  // === 条件（仅 runtime 类型需要）===
  condition?: "on_skill_hit", // trigger 条件字符串
  duration?: 15,              // buff 持续时间
}
```

### 效果类型枚举

| type | scope | 说明 | 第一批支持？ |
|---|---|---|---|
| `stat_bonus` | static | 面板 flat/percent 加成（如 敏捷+20, 暴击率+7%） | ✅ |
| `damage_bonus` | static | 伤害类型加成（如 物理伤害+8%） | ✅ |
| `gauge_reduction` | static | 终结技能量-15% | ✅ |
| `multiplier_scale` | static | 倍率提升至原本的 X 倍 | ⚠️ 需要额外解析 |
| `talent_enhance` | parsed-but-unimplemented | 天赋效果加强 | ❌ 本批不做 |
| `conditional_buff` | runtime_conditional | 条件触发 buff（如暴击后 ATK+10%） | ❌ 本批不做 |
| `dot_effect` | runtime_passive | 持续伤害（如天赋 DOT） | ❌ 本批不做 |

### 定义层 vs 运行时解释层

| 字段 | 放在哪里 | 原因 |
|---|---|---|
| `type / stat / value / unit / scope` | 定义层（talents.json / potentials.json） | 静态数据，不依赖运行时状态 |
| `condition / duration` | 定义层 | 条件定义也是静态的 |
| "该效果是否当前生效" | 运行时解释层（resolveTrackActiveEffects → configuredStats） | 依赖 talentLevel / potentialLevel |
| "该效果对最终面板的实际数值贡献" | 运行时解释层（configuredStats） | 需要聚合所有来源 |

## 5. 最小实施路线建议

### 第一批优先支持的 effect type

从当前潜能文本中最常见、最容易结构化的效果入手：

| 效果类型 | 潜能文本示例 | effects[] 表示 |
|---|---|---|
| flat stat bonus | "智识+20" | `{ type: "stat_bonus", stat: "intellect", value: 20, unit: "flat", scope: "static" }` |
| percent stat bonus | "暴击率+7%" | `{ type: "stat_bonus", stat: "crit_rate", value: 7, unit: "percent", scope: "static" }` |
| damage type bonus | "造成的电磁伤害+8%" | `{ type: "damage_bonus", stat: "emag_dmg", value: 8, unit: "percent", scope: "static" }` |
| gauge reduction | "终结技能量-15%" | `{ type: "gauge_reduction", value: 15, scope: "static" }` |

### 第一批不做的

| 效果类型 | 原因 |
|---|---|
| 倍率提升（×1.2 倍） | 需要 multiplier 系统配合，不属于面板静态加成 |
| 条件 buff（暴击后 ATK+10%） | runtime conditional，需要 simulation 事件系统 |
| 天赋效果加强 | 需要 talent 间引用关系 |
| DOT（每秒 ATK×25%） | runtime 计算 |

### 建议落地文件

| 文件 | 改什么 |
|---|---|
| `potentials.json` × 25 | 为可结构化潜能补 `effects: [...]` 数组（与 description 并列） |
| `talents.json` × 25 | 为可结构化天赋阶段补 `effects: [...]`（在 stages[].effects） |
| `resolveTrackConfiguredStats()` in `timelineStore.js` | 读 activeTalents/activePotentials 的 effects，聚合 static scope 的 flat/percent 到 result |

### 如何避免二次真值表

- effects[] 直接放在 talents.json / potentials.json 的对应条目里（定义层）
- configuredStats 从 `resolveTrackActiveEffects()` 的输出读，不新建另一个效果表
- 无需新 JSON / md / registry

---

## 最小改动实施方案（仅方案，不实施）

### Phase 1: 为潜能补 effects[]

选 3-5 个效果最清晰的角色作为样例，在 potentials.json 中为"可静态结构化"的潜能条目补 `effects` 数组。

样例角色:
- LAEVATAIN L2: `智识+20，普通攻击伤害+15%` → `[{type:"stat_bonus",stat:"intellect",value:20,unit:"flat",scope:"static"},{type:"damage_bonus",stat:"attack_dmg_bonus",value:15,unit:"percent",scope:"static"}]`
- AVYWENNA L3: `意志+15，造成的电磁伤害+8%` → `[{type:"stat_bonus",stat:"will",value:15,unit:"flat",scope:"static"},{type:"damage_bonus",stat:"emag_dmg",value:8,unit:"percent",scope:"static"}]`
- AKEKURI L2: `敏捷+10，智识+10` → `[{type:"stat_bonus",stat:"agility",value:10,...},{type:"stat_bonus",stat:"intellect",value:10,...}]`

不可结构化的条目保留 `effects: []` 空数组 + description 文本。

### Phase 2: configuredStats 聚合

在 `resolveTrackConfiguredStats()` 的步骤 4（当前 talent row1 bonus 处）：
1. 调用 `resolveTrackActiveEffects(trackId)`
2. 遍历 `activeTalents` + `activePotentials` 的 effects[]
3. 对 `scope: "static"` 且 `type: "stat_bonus"` 的条目：`result[stat] += value`（flat）或累加到 percent bucket
4. 用同样逻辑替换当前 `TALENT_ROW1_BONUSES` 硬编码（row1 效果也变成 effects[] 驱动）

### Phase 3: 验证

验证 LAEVATAIN L2 潜能（智识+20）→ configuredStats.intellect 应增加 20 → primary/secondary ability 联动 → effectiveATK 变化。
