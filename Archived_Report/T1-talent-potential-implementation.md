# T1 天赋/潜能 Schema 与输入链建设 — 实施报告

---

## 1. 实际修改的文件

| 文件 | 改动 |
|---|---|
| `src/stores/timelineStore.js` | `createDefaultGrowth()` 新增 `potentialLevel` + `talentLevels`；新增 `setTrackPotentialLevel` / `getDefaultPotentialLevel` / `setTrackTalentLevel` / `getTrackTalentLevel` / `getTalentMaxLevel`；新增 `resolveTrackActiveEffects` 聚合入口 |
| `src/data/operators/loader.js` | 新增 `potentialModules` glob + `loadOperator()` 返回 `potentials` 字段 |
| `src/data/operators/*/potentials.json` × 25 | **新建**，从 wiki potentials 文本自动生成 |

## 2. 每个文件改了什么

### timelineStore.js

- **`createDefaultGrowth()`**: 新增 `potentialLevel: 0`（默认无潜能）和 `talentLevels: {}`（空对象，使用时按需填充，默认走 max achievable）
- **`setTrackTalentLevel(trackId, talentId, level)`**: 独立设置某天赋等级，受 promotion 上限约束
- **`getTrackTalentLevel(trackId, talentId)`**: 读取当前天赋等级，未显式设置时默认返回 max achievable
- **`getTalentMaxLevel(talent, promotion)`**: 计算给定 promotion 下该天赋的最大可达等级
- **`resolveTrackActiveEffects(trackId)`**: 聚合入口，输出 activeTalents + activePotentials

### loader.js

- 新增 `potentialModules` glob（`'./**/potentials.json'`）
- `loadOperator()` 返回值新增 `potentials` 字段

### potentials.json × 25

- 从 wiki normalized `potentials` 字段自动解析生成
- Schema: `{ potentials: [{ level: 1-5, description: "..." }] }`
- 24 个有数据（来自 wiki），ROSSI 为空数组（无 wiki 数据）

## 3. 天赋 / potential 的主路径

### 天赋定义真值源
`src/data/operators/<ID>/talents.json` — **唯一主路径**

### 天赋配置态
`track.growth.talentLevels` — **独立于 promotion**

模型：
- `talentLevels: { talent_0: 2, talent_1: 1 }` — 每个天赋当前等级
- Level 0 = 未激活
- Level 1 = 第一阶段（通常对应精英 1 或 2 解锁）
- Level 2 = 第二阶段（通常对应升级）
- Level 3 = 第三阶段（少数角色如 LAEVATAIN 灼心）
- 未显式设置时，默认返回当前 promotion 允许的最大等级

### 潜能定义真值源
`src/data/operators/<ID>/potentials.json` — **唯一主路径**

### 潜能配置态
`track.growth.potentialLevel` — 0-5 整数

### 聚合入口
`store.resolveTrackActiveEffects(trackId)` — 输出：
```javascript
{
  promotion: 4,
  potentialLevel: 0,
  activeTalents: [
    {
      id: 'talent_0',
      name: '本质瓦解',
      icon: '...',
      currentLevel: 1,      // 用户当前设置的等级
      maxLevel: 1,           // 当前 promotion 允许的最大等级
      maxPossibleLevel: 1,   // 天赋定义的理论最大等级
      activeStage: { promotion: 1, type: 'unlock', description: '...' },
      defaultUnlock: false,
    }
  ],
  activePotentials: [
    { level: 1, description: '...' }
  ],
  totalPotentials: 5,
}
```

## 4. ability-expansion.json 的地位

**兼容数据 / 死数据**。已被 loader 加载但当前零消费。它的 `unlocks` 信息已被 talents.json 的 `unlockStage` 完全覆盖。本轮没有新增对它的消费。

## 5. potentialLevel 如何默认 / 存储 / 读取

| 项目 | 说明 |
|---|---|
| 存储位置 | `track.growth.potentialLevel` |
| 默认值 | 0（createDefaultGrowth） |
| 按稀有度默认 | `getDefaultPotentialLevel(rarity)`: 6★→0, 其他→5（导出但 UI 未调用） |
| 修改方法 | `store.setTrackPotentialLevel(trackId, level)` |
| 范围 | 0-5 |
| 迁移 | 旧 growth 对象缺 potentialLevel 时由 `{...defaultGrowth, ...growth}` spread 自动补 0 |

## 6. talentLevels 与 promotion 的关系

- **promotion 约束上限**: `getTalentMaxLevel(talent, promotion)` 计算当前 promotion 下最大可达等级
- **talentLevels 记录实际等级**: `setTrackTalentLevel` 会 clamp 到 max
- **不强制**: E2 时天赋可以是 level 0（未激活）、level 1（只解锁）或 level 2（已升级），取决于用户设置
- **默认行为**: 未显式设置时返回 max achievable（和技能等级默认 M3 同一模式）

### 处理特殊情况

| 情况 | 处理 |
|---|---|
| E0 无天赋 | `getTalentMaxLevel` → 0 → 不能激活 |
| E2 但不升级天赋 | 用户设置 `talentLevels.talent_0 = 1` → 保持 level 1 |
| 3 级天赋（LAEVATAIN 灼心） | `stages.length = 3` + `defaultUnlock: true` → max 可达 3 级 |

## 7. 前端可观察行为

**本轮主要是 schema/配置链接通，无显著 UI 变化**。

可通过代码验证：
- `store.resolveTrackActiveEffects('ENDMINISTRATOR')` 返回正确的 activeTalents 和 activePotentials
- `store.setTrackTalentLevel('ENDMINISTRATOR', 'talent_0', 0)` 可将天赋设为未激活
- `store.setTrackPotentialLevel('ENDMINISTRATOR', 3)` 可设置潜能等级

UI 接入（潜能选择器 / 天赋等级选择器）留待下一步。

## 8. 仍然是"主路径已接好，但效果未完整实现"的部分

| 项目 | 状态 |
|---|---|
| 天赋效果应用到 configuredStats | 仍只有 row1 硬编码加成（`TALENT_ROW1_BONUSES`） |
| 潜能效果应用到 configuredStats | 未实现（聚合入口就绪，效果解析未做） |
| talents.json stages 数据完整度 | 当前每个天赋只有 1 个 stage entry（parser 限制），实际应有 2-3 个 |
| potentials.json 结构化效果 | 当前只有文本描述，无 `effects[]` 结构化数值 |
| UI 入口 | 无天赋等级选择器 / 潜能等级选择器 |

## 9. 双真值源风险

**没有引入新的双真值源。**

| 数据 | 真值源 | 旁路 |
|---|---|---|
| 天赋定义 | talents.json | wiki fallback（已有，低优先级） |
| 天赋等级 | growth.talentLevels | 无 |
| 潜能定义 | potentials.json | 无 |
| 潜能等级 | growth.potentialLevel | 无 |
| 聚合结果 | resolveTrackActiveEffects() | 无 |

exclusive_buffs（gamedata）仍独立用于 OperatorInfoPanel buff 图标展示，与 talents.json 的天赋定义不重叠。

## 10. 样例数据覆盖

25 个角色全部生成了 `potentials.json`。
- 24 个有 1-5 条潜能描述（从 wiki 解析）
- ROSSI 为空（无 wiki 数据）
- 描述为原始文本（部分角色未知潜能显示为 `？？？？？？`）

---

## 给主会话的收口摘要

1. **分类**: T1 天赋/潜能 Schema 与输入链建设
2. **改了哪些文件**: `timelineStore.js`（growth 新增 potentialLevel + talentLevels + 聚合入口）、`loader.js`（新增 potentials 加载）、25 × `potentials.json`（新文件）
3. **行为变化**: 天赋等级现在是独立于 promotion 的可配置状态；潜能等级 0-5 可配置；`resolveTrackActiveEffects()` 输出当前 active talents + potentials
4. **可收口**: schema + 配置态 + loader + 聚合入口全部接通
5. **阶段性实现**: 天赋/潜能效果未应用到 configuredStats；talents.json stages 数据不完整（每天赋只 1 stage）；无 UI 选择器
6. **新真值源**: 无
7. **下一步**: (a) UI 接入 potentialLevel/talentLevel 选择器 (b) talents.json 补齐多阶段 stages (c) 天赋/潜能效果结构化 + 应用到 configuredStats
