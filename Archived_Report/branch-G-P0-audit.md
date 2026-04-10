# G-P0 审计报告

---

## 1. 支持状态系统涉及文件

| 路径 | 作用 | 主/辅/可疑 |
|---|---|---|
| `src/simulation/data/skillStatusRegistry.ts` | **定义 `getSkillDisplayStatus()`**：WIP_OVERRIDES → SM entry → skills.json fallback | **主路径** |
| `src/simulation/data/skillMultipliers.ts` | 提供 `hasSkillsJsonMultiplier()` 给 registry 用；提供 `SKILL_MULTIPLIERS` entry 和 status | **主路径的数据源** |
| `src/components/ActionItem.vue` line 26-33 | 调用 `getSkillDisplayStatus()` 渲染 "处理中"/"未支持" tag | **UI 消费点 1** |
| `src/components/DamageSummaryPanel.vue` line 77,101-102 | 读 `damageSummary` 中的 `unsupportedTickCount` / `hasUnsupported` 显示 "未支持"/"部分未支持"/"部分未计入" | **UI 消费点 2** |
| `src/stores/timelineStore.js` damageSummary computed | 按 tick-level multiplier 是否为 0 计算 `unsupportedTickCount` | **第二判定源（tick 级别）** |

## 2. 当前状态判定主路径

**主路径**: `skillStatusRegistry.ts` → `getSkillDisplayStatus(charId, actionType)`

判定逻辑（优先级从高到低）：
1. `WIP_OVERRIDES[key]` → "wip"
2. `SKILL_MULTIPLIERS[charId][type]` 有 entry → verified="supported", estimated="wip"
3. `hasSkillsJsonMultiplier(charId, type)` → "wip"（skills.json 有倍率行但非 verified）
4. 以上都无 → "unsupported"

**UI 消费**:
- ActionItem.vue：调用 registry → 渲染 tag
- DamageSummaryPanel.vue：**不调用 registry**，有独立的 tick-level 判断

## 3. 潜在双路径 / 冲突点

### 问题 1: ActionItem 与 DamageSummary 使用不同判定源

| 组件 | 判定依据 | 语义 |
|---|---|---|
| ActionItem | `skillStatusRegistry.getSkillDisplayStatus()` | 基于数据源存在性判断 |
| DamageSummary | `tick.multiplier === 0` after overlay | 基于实际倍率值判断 |

**当前是否冲突**: 经验证，不冲突。所有 skills.json 有倍率行的技能，overlay 后 multiplier > 0。9 个 unsupported 技能确实都是无倍率行的辅助/增幅/治疗/ROSSI。

**潜在风险**: 如果未来出现"registry 说 wip 但 overlay 实际返回 0"的边缘 case，两个 UI 会显示不同结果。但当前不存在此情况。

### 问题 2: WIP_OVERRIDES 与项目真实状态不同步

当前 3 个 WIP_OVERRIDES：
- `ALESH:link` — **已过时**。C 分支确认 variant 系统端到端工作。
- `ARCLIGHT:skill` — **已过时**。C 分支确认 variant 系统端到端工作。
- `AVYWENNA:skill` — **仍合理**。雷枪基础可用但潜能未接入。

## 4. 可能已过时的状态

| 名称 | 当前状态 | 建议状态 | 原因 |
|---|---|---|---|
| ARCLIGHT:skill | wip (WIP_OVERRIDE) | **supported** | C 分支确认 variant "强化战技" 完整工作（3 tick + conduction consume）；底层 SM status=verified |
| ALESH:link | wip (WIP_OVERRIDE) | **supported** | C 分支确认 variant "强化连携" 完整工作；底层 SM status=verified |
| AVYWENNA:skill | wip (WIP_OVERRIDE) | **wip（保留但更新理由）** | 雷枪召回伤害已接入，潜能 +20s 未接入 |

修改后预计状态分布：supported 3, wip 63, unsupported 9。

## 5. 展示语义审计

### ActionItem（技能方块 tag）

| 要求 | 当前实现 | 一致？ |
|---|---|---|
| supported → 无 tag | ✅ `skillStatus === null` 或 supported 时不渲染 tag | ✅ |
| wip → 黄色"处理中" | ✅ `skill-wip-tag` | ✅ |
| unsupported → 红色"未支持" | ✅ `skill-unsupported-tag` | ✅ |
| attack/dodge 类型不显示 tag | ✅ line 28: `if type === 'attack' \|\| 'dodge' return null` | ✅ |

### DamageSummary（伤害面板）

| 要求 | 当前实现 | 一致？ |
|---|---|---|
| 角色行：任意 action 有 unsupported tick → "⚠ 部分未计入" | ✅ `actor.hasUnsupported` → dsp-unsupported-hint | ✅ |
| 技能行：所有 tick 都缺 multiplier → "未支持" | ✅ `unsupportedTickCount > 0 && ticks.length === 0` | ✅ |
| 技能行：部分 tick 缺 multiplier → "部分未支持" | ✅ `unsupportedTickCount > 0` (else-if) | ✅ |

### 风险点

| 风险 | 严重度 | 当前状态 |
|---|---|---|
| "未支持"技能产生 0 伤害被误读为"正确结果就是 0" | 中 | DamageSummary 有 "未支持" 标签 ✅ 但如果用户不展开看 action 行可能忽略 |
| 9 个 unsupported 全是辅助/增幅/治疗 → 用户可能困惑"为什么我的治疗技能显示未支持" | 低 | 这些技能确实不产生伤害，"未支持"是准确的但可能让用户以为是 bug |

## 6. 最小改动建议（仅方案，不实施）

### 文件 1: `skillStatusRegistry.ts`

改什么：
- 移除 `ALESH:link` 和 `ARCLIGHT:skill` 的 WIP_OVERRIDE
- 更新 `AVYWENNA:skill` 的 WIP_OVERRIDE 理由文本

为什么是最小范围：
- 这些角色的底层 status 已经正确（ALESH/ARCLIGHT 是 verified → 移除 override 自动变 supported）
- 不需要改 registry 逻辑本身
- 不需要改 UI 组件

### 不需要改的文件：

| 文件 | 原因 |
|---|---|
| ActionItem.vue | 逻辑正确，只消费 registry |
| DamageSummaryPanel.vue | 逻辑正确，tick-level 判断准确 |
| skillMultipliers.ts | 数据正确，不需要改 |
| simulator.ts | 不涉及状态显示 |
| timelineStore.js | damageSummary 的 unsupportedTickCount 逻辑正确 |

## 7. 风险与待确认事项

| 项目 | 状态 |
|---|---|
| 9 个 unsupported 是否全是"确实无伤害"的辅助技能 | **已确认**：LAEVATAIN:ult（增强普攻型终结）/ ROSSI（无数据）/ XAIHI（治疗+增幅）/ SNOWSHINE:link（治疗）/ ANTAL:ult（增幅）/ AKEKURI:ult（SP恢复）→ 全部是非直接伤害技能或无数据 |
| LAEVATAIN:ultimate "黄昏" | 特殊情况：这是增强普攻型终结技，wiki 行标签是"强化普攻倍率"，被 EXCLUDE 排除。它确实不直接造成伤害 tick，而是增强后续普攻。标 unsupported 是当前合理的，但理由应为"增强型终结，非直接伤害" |
| 双路径长期风险 | ActionItem(registry) vs DamageSummary(tick-level) 双路径当前一致，但无自动化校验。长期应考虑统一 |

## 8. 结论

### 旧状态明显应该收口
- `ALESH:link` WIP_OVERRIDE → 移除，让底层 verified 生效 → **supported**
- `ARCLIGHT:skill` WIP_OVERRIDE → 移除，让底层 verified 生效 → **supported**

### 仍应保留阶段性 WIP
- `AVYWENNA:skill` → 保留 wip，更新理由
- 所有 skills.json 有倍率但非 verified 的技能 → 继续 wip

### 新真值源或平行 registry
**无**。当前只有 `skillStatusRegistry.ts` 一个 registry，`damageSummary` 的 tick-level 判断是基于实际运行时值的独立验证，不构成平行 registry。

---

## 给 G 分支下一步（P1）的建议

P1 应只做 `skillStatusRegistry.ts` 的 WIP_OVERRIDES 清理：

1. 移除 `ALESH:link` 和 `ARCLIGHT:skill` 的 WIP_OVERRIDE（让 verified 状态自然生效 → supported）
2. 更新 `AVYWENNA:skill` 的理由文本为更准确的描述
3. 不改 registry 逻辑本身
4. 不改 UI 组件
5. 不扩大到改造 DamageSummary 的 tick-level 判断

改动范围：1 个文件，3 行修改。

验证方式：排轴中放 ARCLIGHT 强化战技 → ActionItem tag 从"处理中"变为无 tag（supported）。放 ALESH 强化连携 → 同样变为无 tag。
