# T1 收口修正报告

---

## 1. 这一步又改了哪些文件

| 文件 | 改动 |
|---|---|
| `timelineStore.js` | `changeTrackOperator()` 新增 rarity-aware `potentialLevel` 默认值设置；`getTalentMaxLevel()` 修复 defaultUnlock 计数 bug |
| `src/data/operators/*/talents.json` × 25 | 全量重新生成：完整多阶段 stages（之前每天赋只 1 stage，现在 1-3 stages） |

## 2. 潜能默认值现在在哪条主路径真正生效

`changeTrackOperator()` (timelineStore.js line ~3628):
```javascript
const newChar = characterRoster.value.find(c => c.id === newOperatorId)
track.growth = createDefaultGrowth()
track.growth.potentialLevel = getDefaultPotentialLevel(newChar?.rarity ?? 6)
```

当用户选择/切换干员时，growth 被重置，potentialLevel 按稀有度设置：
- 6★ → 0
- 5★/4★ → 5

旧数据迁移安全：`normalizeTrack()` 中 `{...defaultGrowth, ...growth}` spread 只在旧 growth 缺 potentialLevel 时补 0，不会覆盖已有值。

## 3. 新建角色时默认潜能等级

| 稀有度 | 默认 potentialLevel |
|---|---|
| 6★ | 0 |
| 5★ | 5 |
| 4★ | 5 |
| 其他 | 5 |

## 4. talents 主路径现在是否能稳定表达 0/1/2/3 级

**是。** 验证结果：

| 角色 | 天赋 | stages | Level 含义 |
|---|---|---|---|
| ENDMINISTRATOR 本质瓦解 | 2 | 0=未激活, 1=E1 ATK+15%, 2=E2 ATK+30% |
| LAEVATAIN 灼心 | 3 (default) | 0=未激活, 1=E0 无视10抗, 2=E1 无视15抗, 3=E3 无视20抗 |
| AKEKURI 心流时间 | 1 | 0=未激活, 1=E3 连击 |

`getTalentMaxLevel(talent, promotion)` 正确计算上限：LAEVATAIN 灼心 at E4 → max 3 ✅

## 5. activeTalents 是否能正确返回当前 level 对应阶段

**是。** `resolveTrackActiveEffects()` 中：
```javascript
const stageIdx = Math.min(currentLevel - 1, t.stages.length - 1)
activeStage = t.stages[stageIdx]
```
Level 0 → activeStage = null
Level 1 → stages[0]
Level 2 → stages[1]
Level 3 → stages[2] (如果存在)

## 6. 哪些角色/数据仍然不完整

- **ROSSI**: potentials.json 为空（无 wiki 数据）
- **部分角色 wiki 潜能文本**: ENDMINISTRATOR 3/4/5 潜为 `？？？？？？`（wiki 数据本身不全）
- **心流时间（AKEKURI）**: 只有 1 stage（E3 unlock），无 upgrade stage — 这是数据真实情况，非 bug
- **天赋效果结构化数值**: 仍只有文本描述，无 `effects[]` 数组

## 7. 为什么 T1 schema / 配置主路径可以认为基本定住了

| 维度 | 状态 |
|---|---|
| 天赋定义真值源 | talents.json 唯一主路径 ✅ |
| 天赋多阶段表达 | 1-3 stages，level 0/1/2/3 均有明确语义 ✅ |
| 天赋等级独立于 promotion | `growth.talentLevels` 独立配置，promotion 只约束上限 ✅ |
| 潜能定义真值源 | potentials.json 唯一主路径 ✅ |
| 潜能等级配置态 | `growth.potentialLevel` 0-5 ✅ |
| 默认值主路径 | `changeTrackOperator()` 按稀有度设置 ✅ |
| 聚合入口 | `resolveTrackActiveEffects()` 输出 activeTalents + activePotentials ✅ |
| 迁移安全 | `normalizeTrack()` spread 兼容旧数据 ✅ |

## 8. 是否引入了新的真值源

**否。**
- talents.json 是天赋定义唯一来源
- potentials.json 是潜能定义唯一来源
- growth.talentLevels / potentialLevel 是配置态唯一来源
- ability-expansion.json 仍为死数据（未新增消费）
- wiki fallback 仍存在但优先级低（talents.json 优先）
