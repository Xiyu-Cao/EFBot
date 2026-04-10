# B 分支审计报告 — Round 1
**范围**: 技能倍率真值 / skill level / wiki 映射

---

## 1. 当前 B 分支对仓库现状的判断

倍率系统处于**双源共存、主从已确立但未完全收口**的状态。

- skills.json（wiki 真实数据）已成为 per-level 倍率的**主真值源**
- SKILL_MULTIPLIERS（手工硬编码）已降级为 **fallback**，但在多 tick 分配和 enhanced 变体上仍是唯一来源
- `getSkillMultiplierFromData` 的自动匹配逻辑存在**覆盖范围盲区**（只匹配 tickIndex===0 的单 tick，且靠行标签模糊匹配）
- 显示状态系统 `skillStatusRegistry.ts` 仍然**只读 SKILL_MULTIPLIERS**，不知道 skills.json 覆盖的存在 — 导致 18/25 角色显示"未支持"，实际运行时有倍率

---

## 2. 当前倍率真值链路图

```
tick.multiplier 赋值优先级（applySkillMultiplierOverlay）：

1. 编译器已填入非零值 → 直接使用（不经过 overlay）
2. tickIndex === 0 且 skills.json 有匹配倍率行
   → getSkillMultiplierFromData(charId, actionType, unifiedLevel)
   → 解析 "X%" → X/100
   → 直接赋值
3. SKILL_MULTIPLIERS[charId][actionType].multipliers[tickIndex]
   → 如果 skills.json 也有 M3 值，按 ratio 缩放
   → 否则原值直接赋值
4. 以上都没有 → multiplier 保持 0 → DamageHandler 产出 0 伤害
```

```
显示状态（skillStatusRegistry.ts）：

WIP_OVERRIDES 命中 → "wip"
SKILL_MULTIPLIERS 无 entry → "unsupported"
entry.status === "verified" → "supported"
entry.status === "estimated" → "wip"

注意：skills.json 路径完全不参与显示状态判定
```

---

## 3. 主路径文件

| 文件 | 角色 |
|---|---|
| `src/simulation/data/skillMultipliers.ts` | 倍率数据 + overlay 逻辑 + skills.json 查表 |
| `src/data/operators/*/skills.json` | 25 个干员的 per-level wiki 倍率数据 |
| `src/simulation/data/skillStatusRegistry.ts` | 显示状态派生 |
| `src/simulation/simulator.ts` | 传入 skillLevelMap，调用 overlay |
| `src/stores/timelineStore.js` | 构建 skillLevelMap，传入 simulate() |

---

## 4. Fallback 文件

| 文件 | 用途 | 何时触发 |
|---|---|---|
| `SKILL_MULTIPLIERS` 硬编码 | 多 tick 分配 + enhanced 变体 | tickIndex > 0，或 skills.json 无匹配行 |
| wiki normalized glob（AbilityExpansionOverlay.vue） | 天赋描述 fallback | 与倍率无关，但属于数据双源 |

---

## 5. 双真值风险

### 风险 1: skills.json vs SKILL_MULTIPLIERS 主从不一致 ⚠️
- **症状**: 单 tick 技能用 skills.json 值（准确），多 tick 技能用 SKILL_MULTIPLIERS 值（estimated，不准确）
- **示例**: ENDMINISTRATOR skill，skills.json M3 = 350%，SKILL_MULTIPLIERS = 280%。单 tick 时用 350%（正确）。但如果 gamedata 有 >1 tick，则 tickIndex>0 的 tick 用硬编码值
- **当前实际影响**: ENDMINISTRATOR skill 只有 1 tick，所以暂无实际偏差。但 LAEVATAIN skill（10 ticks，无 SM entry）tickIndex>0 全部 0

### 风险 2: 显示状态与实际运行不符 ⚠️
- **症状**: `skillStatusRegistry` 只查 SKILL_MULTIPLIERS → 无 entry 的角色显示"未支持"。但 `applySkillMultiplierOverlay` 会从 skills.json 拿到值 → 实际有倍率、有伤害
- **影响**: 用户看到"未支持"标签，但 DamageSummary 里出现了非零伤害 → 困惑
- **涉及角色**: 18 个无 SKILL_MULTIPLIERS entry 的角色

### 风险 3: `getSkillMultiplierFromData` 模糊匹配 ⚠️
- **症状**: 靠行标签包含 "倍率" 或 "伤害" + 值包含 "%" 来判断。可能匹配到非主伤害行（如"击碎结晶伤害倍率"而非"伤害倍率"）
- **影响**: 取到的是第一个匹配行，不一定是技能的主伤害倍率

---

## 6. 本轮建议修改的最小范围

### 修改 1: 让 `skillStatusRegistry` 也感知 skills.json 覆盖
- 在 `getSkillDisplayStatus` 中，当 SKILL_MULTIPLIERS 无 entry 时，检查 skills.json 是否有该技能的倍率行
- 有 → 返回 "wip"（因为是自动匹配，精度未人工验证）而非 "unsupported"
- **目的**: 消除"显示未支持、实际有伤害"的不一致

### 修改 2: 在 `getSkillMultiplierFromData` 中增加匹配精度
- 优先匹配行标签完全以 "伤害倍率" 结尾的行
- 其次匹配包含 "倍率" 的行
- 排除明确是条件伤害的行（如 "击碎结晶伤害倍率"、"额外伤害倍率"、"提前降下巨浪伤害倍率"）
- **目的**: 减少错误匹配

### 修改 3: 更新 ENDMINISTRATOR/ESTELLA 等单 tick estimated entry
- 这些角色的 SKILL_MULTIPLIERS 值已被 skills.json 完全覆盖（单 tick，tickIndex===0）
- 可以把 `status` 从 "estimated" 改为注释说明 "superseded by skills.json"
- 或直接移除，让 skills.json 成为唯一来源
- **目的**: 减少双源混淆

### 不修改
- 不动 ALESH/ARCLIGHT 的 verified entry（多 tick 分配 + enhanced 是手工真值，skills.json 无法替代）
- 不动 simulator.ts 调用链
- 不动 runtime 事件顺序
- 不新增任何平行倍率表

---

## 7. 修改后应达到的行为变化

| 场景 | 修改前 | 修改后 |
|---|---|---|
| 无 SM entry 但有 skills.json 的单 tick 技能 | 显示"未支持"，实际有伤害 | 显示"处理中"，实际有伤害 |
| 有 SM entry 的 estimated 单 tick 技能 | SM 值（不准确）被 skills.json 覆盖但 SM 仍残留 | SM entry 标注 superseded 或移除 |
| 多 tick 技能的首个 tick | skills.json 值 | 更准确的 skills.json 值（匹配改进） |
| 多 tick 技能的 tickIndex>0 | SM 值或 0 | 不变（仍依赖 SM 分配） |

---

## 8. 仍然是阶段性实现的部分

- **多 tick 分配**: 仍依赖 SKILL_MULTIPLIERS 手工拆分。28 个多 tick 技能中只有 8 个有 SM entry
- **enhanced 变体**: 仅 ALESH:link 和 ARCLIGHT:skill 有 enhancedMultipliers
- **attackSegments**: 完全不受 skill level 影响
- **skills.json 行匹配**: 仍是模糊匹配，非结构化映射
- **武器 ATK 成长曲线**: 线性近似

---

## 9. 本轮不引入新真值源

- 不新增倍率汇总文件
- 不新增平行 JSON
- 只在现有 `skillMultipliers.ts` + `skillStatusRegistry.ts` 内做最小调整
- skills.json 继续同时服务说明和 runtime，不分裂

---

## 10. 下一步建议

1. **本轮实施 §6 的 3 项最小修改**（显示状态修正 + 匹配精度 + estimated 清理）
2. **下一轮**: 对 28 个多 tick 技能逐个审计 skills.json 的行结构，识别哪些可以做结构化 tick-to-row 映射（而非只取 first row）
3. **再下一轮**: 对 verified entry（ALESH/ARCLIGHT）补 per-level 维度到 SKILL_MULTIPLIERS 结构中
4. **最终目标**: 所有单 tick 技能完全由 skills.json 驱动，SKILL_MULTIPLIERS 只保留多 tick 分配比例和 conditional branch 定义
