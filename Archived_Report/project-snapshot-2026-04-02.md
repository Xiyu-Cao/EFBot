# 项目阶段快照报告
**日期**: 2026-04-02
**目的**: 中心对话基线，用于后续分支开发切分

---

## 1. 当前总体状态

1. **Simulation / damage pipeline**: 核心计算链完整可用。攻击力公式（base + ATK% + ability multiplier）、伤害公式（ATK × mult × 11 乘区）、暴击系统、失衡系统均已实现
2. **技能倍率**: 已从 skills.json（wiki 真实数据）按等级选取，硬编码 `SKILL_MULTIPLIERS` 降为 fallback。8 个角色有倍率数据（3 verified / 14 estimated）
3. **配置输入链**: `track.growth`（精英化/等级/技能等级）→ `resolveTrackConfiguredStats`（base + weapon/equip + talent row1）→ `buildSimulationTracks` → simulation 全链贯通
4. **武器/装备**: 武器等级（1-90 ATK 成长）、baseAtk、passiveStats、common slot、buff bonus 全部接入。66 个非 Lv70 装备数据已从 wiki 抓取补全
5. **静态数据**: 25 个干员全量生成 operator folder（meta/stats/skills/talents/ability-expansion），loader + fallback 完整
6. **前端 UI**: 三种编辑模式（排轴 / 能力扩展 / 能力值详情），左侧面板精简，右侧详情统一消费 operator folder
7. **Legality**: 合法性检查系统完整（sandbox/strict 策略），ActionItem 显示支持状态标签
8. **支持状态展示**: `skillStatusRegistry.ts` 提供 supported/wip/unsupported 三级，ActionItem 和 DamageSummaryPanel 均有 UI 指示
9. **当前主线**: 配置链 → 计算链闭环，技能等级影响伤害
10. **不是当前主线**: 天赋二三行效果、潜能、复杂角色专属机制、视觉精修

---

## 2. 已完成模块盘点

### Simulation / Runtime
- `simulation/engine/`: SimulationEngine、事件队列、RNG ✅
- `simulation/events/`: DamageHandler、ActionHandler、SPHandler、StaggerHandler ✅
- `simulation/state/`: ActorState、TeamState、GameState ✅
- `simulation/calculation/`: attackFormula、DamageResolver、multiplierZones（11 乘区）、critSystem ✅
- `simulation/anomaly/`: 物理/法术异常反应 ✅
- `simulation/legality/`: 合法性检查 ✅
- **可收口**: 核心 pipeline 稳定，后续扩展是增量

### Damage Pipeline
- ATK 公式: `floor((baseATK + weaponATK + flat) × (1 + ATK%/100) × abilityMult)` ✅
- 11 乘区: defense / crit / dmgBonus / amplify / combo / vulnerability / fragility / resistance / break / reduction / special ✅
- **可收口**: 公式正确，乘区完整

### 配置输入链 (track → configured stats → simulation)
- `track.growth`: promotion / characterLevel / skillLevels ✅
- `resolveTrackBaseStats()`: operator folder + wiki fallback ✅
- `resolveTrackConfiguredStats()`: base + weapon/equip deltas + talent row1 + ATK% + primary/secondary ability ✅
- `buildSimulationTracks()`: 注入 finalStats + _growth ✅
- `skillLevelMap` → `simulate(options)` → `applySkillMultiplierOverlay(unifiedLevel)` ✅
- **可收口**: 链路完整，等级/武器/装备/天赋 row1 全部影响计算

### 武器 / 装备
- 武器: baseAtk (按等级成长) + passiveStats + commonSlots (tier 1-9) + buffBonuses + triggeredBuffs ✅
- 装备: primary1/primary2 + adapter + refine tier (Lv70 4 级) + 非 Lv70 已补数据 ✅
- `attack` vs `attack_percent` 区分 ✅
- `defense` / `hp_percent` 新增到 CORE_STATS ✅
- **可收口**: 数据完整，delta 系统稳定

### 静态数据 / Operator Folder
- 25 个干员 × 5 个文件（meta/stats/skills/talents/ability-expansion）✅
- `loader.js`: loadOperator / lookupOperatorStats / listMigratedOperators ✅
- 生成脚本: `scripts/generate-operator-data.js` ✅
- **可收口**: 全量生成完毕

### 前端 UI
- 三种编辑模式: timeline / abilityExpansion / statsDetail ✅
- 能力扩展: 战斗技能区 + 天赋阵列（横向精英化分区）✅
- 能力值详情: ATK 展开分解 ✅
- 右侧详情统一: 技能/天赋/主属性详情走 operator folder ✅
- 装备 tab: 武器大图标 + 等级滑块 + 三词条 ✅
- **阶段性完成**: 功能可用，视觉待精修

---

## 3. 阶段性实现 / 临时实现

### 3.1 SKILL_MULTIPLIERS 硬编码（fallback 角色）
- **文件**: `src/simulation/data/skillMultipliers.ts`
- **作用**: 8 个角色的手工倍率数据，多数为 "estimated"
- **为什么是阶段性**: skills.json 已成为主数据源，硬编码仅在 skills.json 无对应行或多 tick 分配时使用
- **后续**: 逐步用 skills.json 完全替代，最终移除

### 3.2 WIP_OVERRIDES
- **文件**: `src/simulation/data/skillStatusRegistry.ts` line 24-31
- **内容**: ALESH:link / ARCLIGHT:skill / AVYWENNA:skill 三条 WIP 标记
- **作用**: 即使有 multiplier 数据，也强制显示"处理中"
- **后续**: 逐个完成专属机制后移除

### 3.3 enhancedMultipliers（终结技增强态）
- **文件**: `skillMultipliers.ts` 各角色 entry
- **作用**: 终结技期间的增强倍率
- **为什么是阶段性**: 只有部分角色有，且仍用硬编码
- **后续**: 应从 skills.json 的终结技增强相关数据行提取

### 3.4 Wiki normalized glob（双数据源）
- **文件**: `AbilityExpansionOverlay.vue` line 65-68
- **作用**: 天赋解析的 fallback 数据源
- **为什么是阶段性**: 所有 25 个干员已有 operator folder 数据，wiki glob 增加 ~240KB bundle
- **后续**: 可移除 wiki glob，只保留 operator folder

### 3.5 Wiki index import（双数据源）
- **文件**: `OperatorInfoPanel.vue` line 5, `timelineStore.js` line 442-446
- **作用**: `resolveBaseStats` 和职业显示的 fallback
- **为什么是阶段性**: operator folder 已全量覆盖，wiki 仅理论 fallback
- **后续**: 可移除，减小 bundle

### 3.6 武器 ATK 成长曲线
- **文件**: `timelineStore.js` `computeWeaponAtkAtLevel()`
- **公式**: `floor(baseAtk × (0.25 + 0.75 × (L-1)/89))`
- **为什么是阶段性**: 线性近似，实际游戏可能有不同成长曲线
- **后续**: 获取真实每级数据后替换

### 3.7 Debug tools
- **文件**: `src/simulation/debug-tools/damage-calculator/`
- **内容**: DamageDebugCalculator.vue + 3 个工具文件
- **标注**: "TEMP DEBUG TOOL — NOT IN PRODUCTION FLOW — SAFE TO DELETE"
- **后续**: 验证完成后删除

---

## 4. 当前支持状态盘点

### Supported（已验证，可信赖）
- ALESH: link（含 enhanced variant，但仅 M3）
- ARCLIGHT: skill（含条件额外 hit）, ultimate

### WIP（处理中，数据基本到位但有未完成细节）
- ALESH: link per-level coverage
- ARCLIGHT: skill conduction consume timing
- AVYWENNA: skill 雷枪/强雷枪 per-buff-instance damage
- 所有 "estimated" 倍率角色: ENDMINISTRATOR / CHENQIANYU / GILBERTA / ESTELLA / POGRANICHNK 的 skill / link / ultimate

### Unsupported（无倍率数据，计算结果为 0）
- 所有不在 `SKILL_MULTIPLIERS` 且 skills.json 主倍率行无法自动匹配的角色/技能
- 当前 17/25 角色的 skill/link/ultimate 可能命中此状态（但 skills.json per-level 查表会尝试覆盖）

### Runtime 表现
- unsupported: `tick.multiplier` 保持 0 → DamageHandler 计算出 0 伤害 → DamageSummaryPanel 显示"未支持"红标签
- wip: 计算正常但精度未验证 → ActionItem 显示"处理中"黄标签
- supported: 计算可信赖 → 无额外标签

### 新增覆盖（via skills.json per-level）
技能等级接入后，所有 25 个干员的技能若在 skills.json 中有"倍率"/"伤害"相关行（tickIndex === 0），会自动被 `getSkillMultiplierFromData` 覆盖。这意味着实际 unsupported 数量大幅减少，但这些自动匹配的可靠性依赖于 skills.json 行标签的准确性。

---

## 5. 已确认的专属机制修正

### ALESH link（深鳍连携技）
- **代码位置**: `skillMultipliers.ts` ALESH entry
- **状态**: multipliers verified, enhancedMultipliers 有，per-level 未覆盖
- **WIP_OVERRIDES**: "enhanced variant M3 only, per-level not yet covered"
- **未完成**: per-level 倍率选择

### ARCLIGHT skill（弧光战技）
- **代码位置**: `skillMultipliers.ts` ARCLIGHT entry
- **状态**: 2-hit base + 3-hit conditional variant, multipliers verified
- **WIP_OVERRIDES**: "conditional extra hit (conduction consume) phase-close"
- **未完成**: 导电消耗触发时机的精确模拟

### AVYWENNA skill（雷枪/强雷枪）
- **代码位置**: WIP_OVERRIDES 标记，无 SKILL_MULTIPLIERS entry
- **状态**: 规则已确认但完全未接入
- **WIP_OVERRIDES**: "雷枪/强雷枪 per-buff-instance damage not yet implemented"
- **未完成**: 整体实现

---

## 6. MVP 上线视角

### 已足够上线
- 排轴编辑器核心（时间轴 / 连接 / 拖拽 / 导入导出）
- Legality 检查
- 基础伤害计算 pipeline
- 武器/装备配置 + delta 系统
- supported/wip/unsupported 状态展示
- 能力扩展模式（技能等级 / 精英化 / 天赋 row1）
- 能力值详情模式

### 可标"处理中"后上线
- 所有 "estimated" 倍率角色（标注倍率为估算值即可）
- skills.json 自动匹配的倍率（标注来源为 wiki 数据）
- 天赋第二/第三行效果（UI 展示正常，效果未接入计算）
- 武器 ATK 成长曲线（近似值，偏差较小）

### 不适合上线
- AVYWENNA 雷枪机制（完全未实现）
- 依赖 enhancedMultipliers 但值为 "estimated" 的终结技增强态
- Debug tools（标记为 TEMP，应在上线前删除）

### 最值得优先继续开发的 3 个方向
1. **技能倍率真值校验**: 把 "estimated" 逐个对照 wiki/游戏内验证，升级为 "verified"
2. **角色专属机制补全**: AVYWENNA 雷枪、ARCLIGHT 导电消耗时机、ALESH per-level
3. **天赋二三行效果接入**: 使天赋对伤害/属性有实际影响

---

## 7. 风险与边界

### 双真值源风险 ⚠️
- `resolveBaseStats`: operator folder + wiki normalized 并存
- `AbilityExpansionOverlay`: operator folder + wiki glob 并存
- `applySkillMultiplierOverlay`: skills.json + SKILL_MULTIPLIERS 并存
- **建议**: 确认 operator folder 全量正确后，移除 wiki 路径

### 生成数据与人工真值混淆风险 ⚠️
- `generate-operator-data.js` 自动生成 skills.json 的天赋解析使用正则，可能有边缘 case
- 非 Lv70 装备数据由 scraper 从 wiki 抓取，未经人工逐条校验
- **建议**: 对关键角色手动抽检

### Unsupported skill 结果误解风险
- 多 tick 技能的 tick 分配仍依赖 hardcoded `SKILL_MULTIPLIERS`
- `getSkillMultiplierFromData` 只覆盖 tickIndex === 0 的 skills.json 查表
- 对于多 tick 技能（CHENQIANYU ult 7 ticks），若无 SKILL_MULTIPLIERS entry 则仅第一个 tick 有值
- **建议**: 扩展 skills.json 匹配逻辑到多 tick

### Skill level 不完整导致的误差风险
- enhancedMultipliers（终结技增强态）不受 skill level 影响，始终用硬编码值
- attackSegments 倍率不受 skill level 影响
- **建议**: 后续扩展 enhanced + attack segment 的 per-level 支持

### 角色专属机制未完全接入
- 3 个 WIP 角色有已知未完成机制
- 某些角色可能有未发现的特殊机制
- **建议**: 逐角色 review + 对照 wiki 验证

---

## 8. 分支开发建议

### 分支 A: 技能倍率真值 / wiki 映射
- 逐角色校验 skills.json 倍率与游戏内一致
- 把 SKILL_MULTIPLIERS estimated → verified
- 扩展多 tick 技能的 per-level 支持
- 扩展 enhanced + attack segment 的 per-level 支持

### 分支 B: 专属机制 / 角色特判
- AVYWENNA 雷枪实现
- ARCLIGHT 导电消耗时机
- ALESH enhanced per-level
- 其他角色专属 buff/debuff 联动

### 分支 C: Runtime / damage pipeline
- 天赋二三行效果接入 configuredStats
- buff aggregation 完善（战斗中的动态 ATK%、DMG% 等）
- anomaly 精确化（TODO 标记的占位值替换）

### 分支 D: Front-end UI / 排版
- 能力扩展视觉精修（黄色背景/精英化进度/解锁演出）
- 天赋阵列连线调整
- 移除 wiki glob 减小 bundle
- Debug tools 删除

### 分支 E: 静态数据 / 配置输入链
- 武器 ATK 成长曲线替换为真实数据
- 潜能模块接入
- 装备套装效果数据补全
- 移除 wiki fallback 路径

### 分支 F: MVP / 支持状态 / 上线准备
- 关键角色倍率抽检
- unsupported 提示文案优化
- 性能 audit（bundle 大小、computed 开销）
- 导出/分享功能验证

---

## 结论：后续分支切分建议

当前仓库作为中心对话基线，最适合按以下方式切分：

1. **主线（分支 A + F）**: 技能倍率真值校验 + MVP 上线准备 — 这是到 MVP 的最短路径
2. **并行支线（分支 B）**: 角色专属机制 — 可独立推进，不阻塞主线
3. **收尾支线（分支 D + E）**: UI 精修 + 数据清理（移除双数据源）— 可在 MVP 后做
4. **后续迭代（分支 C）**: Runtime 深度扩展（天赋效果、buff 动态层）— 属于 V2 范围

每个分支可以在独立会话中推进，以本报告中的文件路径和模块名为坐标对齐。

 勘误 / Errata（附于 project-snapshot-2026-04-02.md 后）
                                                                                                                                                                                                      
  ▎ E1. 倍率统计口径修正                                                                                                                                                                              
  ▎ 原文"8 个角色有倍率数据（3 verified / 14 estimated）"有误。
  ▎ 准确统计：7 个角色 在 SKILL_MULTIPLIERS 中有 hardcoded entry，共 18 个 multiplier entry（3 verified / 15 estimated）。
  ▎ 另外，技能等级接入后 getSkillMultiplierFromData() 会从 skills.json 为所有 25 个干员的单 tick 技能自动查表，不受 SKILL_MULTIPLIERS 有无 entry 限制。所以实际有倍率可用的角色数远大于 7。

  ▎ E2. ARCLIGHT skill 时序修正
  ▎ 原文将 ARCLIGHT:skill WIP 原因描述为"conduction consume timing"，表述不够准确。
  ▎ 实际状态：时序语义已确定 —— 同帧先结算第 3 hit 伤害，再清除 conduction 层数。当前代码已按此语义实现。
  ▎ WIP_OVERRIDES 保留原因应改为：阶段性实现，条件额外 hit 的触发/伤害分配仍可进一步精修，而非时序未确定。

  ▎ E3. AVYWENNA 补充
  ▎ AVYWENNA 雷枪/强雷枪的规则已在设计层面确认（per-buff-instance damage 区分），但代码仍完全未接入。WIP_OVERRIDES 中有标记，SKILL_MULTIPLIERS 中无 entry。
