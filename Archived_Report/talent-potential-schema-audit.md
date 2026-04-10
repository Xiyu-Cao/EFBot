# 天赋 / 潜能 Schema 与输入链审计报告

---

## 1. 天赋定义现状

### talents.json schema（确认看到）

位于 `src/data/operators/<ID>/talents.json`，25 个角色均有。

```
{
  mainAttribute: { key, label, icon } | null,
  subAttribute: { key, label, icon } | null,
  talents: [
    {
      id: "talent_0",
      name: "天赋名",
      icon: "/avatars/.../icon_talent_xxx_01.webp",
      unlockStage: 1,           // 精英化阶段解锁
      upgradeStage: 2,          // 精英化阶段强化
      defaultUnlock?: true,     // 可选，默认解锁（如 LAEVATAIN 灼心）
      stages: [                 // 分阶段描述
        { promotion: 1, type: "unlock"|"upgrade"|"default", description: "..." }
      ]
    }
  ],
  exclusiveBuffs: [ { key, name, icon } ]
}
```

**统一格式**: 是。25 个角色结构一致。LAEVATAIN 有可选 `defaultUnlock: true`。

**能表达的信息**: 名称、图标、解锁/升级阶段、分阶段文本描述、专属 buff 名称

**不能表达的信息**:
- 天赋的**数值效果**（如 ATK+15%、DOT 倍率）— 只有文本描述，无结构化数值
- 天赋的**升级状态**（当前是解锁态还是强化态）— 无此字段
- **潜能等级**及其对天赋的修正 — 无此概念

## 2. 能力扩展与天赋的关系

### ability-expansion.json schema（确认看到）

位于 `src/data/operators/<ID>/ability-expansion.json`，25 个角色均有。

```
{
  promotionStages: [
    { promotion: 0, maxLevel: 20, skillCap: 1, unlocks: [] },
    { promotion: 1, maxLevel: 40, skillCap: 3, unlocks: ["talent_0"] },
    ...
  ]
}
```

**与 talents.json 重复的内容**: `unlocks` 数组中的 talent_id 与 talents.json 中的 `unlockStage` 是同一信息的两种表达。例如 ENDMINISTRATOR talent_0 的 `unlockStage: 1` 对应 ability-expansion stage 1 的 `unlocks: ["talent_0"]`。

**当前前端是否把 ability-expansion 当另一套天赋来源**: **否**。`ability-expansion.json` 虽然被 loader 加载（`loadOperator().abilityExpansion`），但**当前没有任何组件消费它**。grep 确认零引用。

**两者的关联**: talents.json 通过 `unlockStage` 自身表达解锁阶段。ability-expansion.json 通过 `unlocks` 数组从精英化阶段角度表达同一关系。当前只有 talents.json 被消费。

## 3. 消费链

### 谁在读 talents.json

| 消费者 | 读取方式 | 用途 |
|---|---|---|
| `AbilityExpansionOverlay.vue` | `opData.value.talents` (via loadOperator) | 天赋图标/名称/描述/解锁阶段 for 天赋阵列 UI |
| `AbilityExpansionOverlay.vue` | `opData.value.talents.mainAttribute` | 主/副属性图标 for row1 |

### 谁在读 ability-expansion.json

**当前无组件消费**。loader 加载了 `abilityExpansion` 字段，但 grep 确认无 `opData.*abilityExpansion` 引用。

### 其他天赋相关路径

| 消费者 | 数据源 | 用途 |
|---|---|---|
| `OperatorInfoPanel.vue` | `char.value.exclusive_buffs`（gamedata.json） | 左侧面板天赋图标列表 |
| `AbilityExpansionOverlay.vue` | wiki normalized fallback（`parseTalentEntries`） | 天赋解析 fallback |
| `timelineStore.js` | `TALENT_ROW1_BONUSES` 硬编码 + `growth.promotion` | 天赋 row1 主属性加成 → configuredStats |

### 天赋 row1 加成进入配置态的路径（确认看到）

`resolveTrackConfiguredStats(trackId)` line 557:
```javascript
result[opMeta.mainAttribute] += getTalentRow1Bonus(g.promotion)
```

这里 `TALENT_ROW1_BONUSES = [0, 10, 15, 15, 20]` 是**全角色统一硬编码**，不读 talents.json 也不读 ability-expansion.json。

## 4. 当前配置态现状

### 已有配置态结构（确认看到）

`track.growth`（`timelineStore.js` line 376）:
```javascript
{
  promotion: 4,
  characterLevel: 90,
  skillLevels: { attack, skill, link, ultimate }
}
```

**UI 输入点**: OperatorInfoPanel 的精英化/等级 slider + 能力扩展模式的 +/- 按钮

**可复用模式**: `growth` 已有 promotion / characterLevel / skillLevels 的 get/set 模式。如果要加 `potentialLevel` 或 `talentStates`，最自然的位置是在 `growth` 对象中新增字段。

### 没有的配置态

- **potentialLevel**: 当前不存在。无字段、无 UI、无默认值
- **talentStates**（天赋当前是第几阶段/是否已激活）: 不存在。当前由 `growth.promotion` 隐式驱动（精英化 ≥ unlockStage → 视为已解锁）

## 5. 潜能现状

### 当前存在的"潜能"相关内容

| 位置 | 内容 | 是否被消费 |
|---|---|---|
| `warfarin-wiki normalized/*.json` → `potentials` | 原始文本描述（如 "1最后的苏醒战技..." ） | **否**。未被 loader/组件/simulation 读取 |
| `gamedata.json` → `WEAPON_POTENTIAL_MAX_TIER = 9` | 武器词条潜力等级（1-9）— 这是**武器词条**概念，不是角色潜能 | **是**，用于武器 commonSlot tier |
| operator folder | **无 potentials 字段** | — |

**结论: 当前不存在正式角色潜能主路径。** 仓库中唯一的潜能数据在 wiki normalized JSON 的 `potentials` 字段中，但从未被任何 loader / component / simulation 消费。

## 6. 双真值源风险审计

| 风险点 | 描述 | 严重度 | 原因 |
|---|---|---|---|
| talents.json vs exclusive_buffs | OperatorInfoPanel 读 `exclusive_buffs`（gamedata），AbilityExpansionOverlay 读 `talents.json`。两者内容不同（exclusive_buffs 是 buff 图标，talents 是天赋定义）但展示上可能混淆 | **中** | 两条路径展示的是不同概念（buff 图标 vs 天赋描述），但用户可能以为是同一个 |
| talents.json unlockStage vs ability-expansion.json unlocks | 同一信息的两种表达 | **低** | ability-expansion 当前不被消费，不会冲突 |
| TALENT_ROW1_BONUSES 硬编码 vs talents.json | row1 主属性加成是全角色统一硬编码 `[0,10,15,15,20]`，不读任何 JSON | **中** | 如果未来不同角色 row1 加成不同，需要改为按角色查表 |
| wiki normalized fallback vs talents.json | AbilityExpansionOverlay 有 wiki fallback (`parseTalentEntries`)；当 talents.json 有数据时优先用，否则走 wiki | **低** | 25 个角色全部有 talents.json，fallback 极少触发 |
| 未来潜能数据来源 | wiki `potentials` 字段存在但未消费。如果未来接入潜能，需要明确主真值是 operator folder 还是 wiki | **中** | 当前无风险（未消费），但设计时需提前决定 |

## 7. 建议的最小改动方案（仅方案，不实施）

### 如果要接入"天赋升级状态 + 潜能等级"

#### 定义真值（静态数据）应放在:

| 内容 | 建议位置 | 原因 |
|---|---|---|
| 天赋效果结构化数值 | `talents.json` → `stages[].effects[]` | 扩展现有 schema，不新增文件 |
| 潜能定义（5 条效果描述 + 结构化数值） | `src/data/operators/<ID>/potentials.json` **新文件** | 与 talents.json 并列，由 loader 加载 |

#### 用户当前配置状态应放在:

| 内容 | 建议位置 | 原因 |
|---|---|---|
| `potentialLevel` (0-5) | `track.growth.potentialLevel` | 复用现有 growth 模式 |
| 天赋升级状态 | **不需要独立字段** — 由 `growth.promotion` 隐式驱动 | 当前逻辑已成立：promotion ≥ unlockStage → 已解锁 |

#### 聚合后的已生效效果列表应放在:

| 内容 | 建议位置 | 原因 |
|---|---|---|
| 天赋 row1 主属性加成 | `resolveTrackConfiguredStats` 内（现有位置） | 已有，只需从硬编码改为查 ability-expansion.json |
| 天赋 row2/3 效果 | `resolveTrackConfiguredStats` 内新增 | 与 row1 同模式 |
| 潜能效果 | `resolveTrackConfiguredStats` 内新增 | 与武器 delta 同层级 |

### 最小改动文件范围

| 文件 | 改什么 |
|---|---|
| `createDefaultGrowth()` in `timelineStore.js` | 新增 `potentialLevel: 0` 字段 |
| `normalizeTrack()` in `timelineStore.js` | 迁移支持：缺 potentialLevel 时补默认值 |
| `resolveTrackConfiguredStats()` in `timelineStore.js` | 读 potentialLevel，查 potentials 数据，应用面板效果 |
| `src/data/operators/<ID>/potentials.json` × 25 | **新文件**，由 generator 从 wiki `potentials` 字段生成 |
| `loader.js` | 新增 potentials glob + 返回字段 |
| UI: OperatorInfoPanel 或 AbilityExpansionOverlay | 新增潜能等级选择器 |

### 不需要改的文件

- `skillMultipliers.ts` — 潜能不直接影响倍率选择
- `simulator.ts` — 潜能效果通过 configuredStats 间接进入
- `DamageSummaryPanel.vue` — 不需要改
- `skillStatusRegistry.ts` — 不需要改
