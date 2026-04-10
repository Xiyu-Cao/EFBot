# B 分支 P1 完成报告

---

## 1. P1 前置收口改了哪些文件

| 文件 | 改动 |
|---|---|
| `skillStatusRegistry.ts` | 导入 `hasSkillsJsonMultiplier`；无 SM entry 时查 skills.json → "wip" 而非 "unsupported" |
| `skillMultipliers.ts` | 新增 `hasSkillsJsonMultiplier()` 导出；`getSkillMultiplierFromData` 重写为支持多 tick 映射（1:1 / 每段 / primary-only 三种模式）；`EXCLUDE_PATTERNS` 增加 `消耗`；移除 10 个被 skills.json 完全覆盖的单 tick estimated entry（ENDMINISTRATOR 全部、ESTELLA 全部、CHENQIANYU skill+link、GILBERTA link+ultimate） |
| `simulator.ts` | `applySkillMultiplierOverlay` 调用增加 `tickCount` 参数 |

## 2. 消除了什么不一致

| 修改前 | 修改后 |
|---|---|
| 18 个角色显示"未支持"但实际有伤害 | 有 skills.json 覆盖的显示"处理中" |
| 模糊匹配可能命中条件伤害行 | 排除 6 类条件关键词 + 优先级排序 |
| ENDMINISTRATOR skill SM=2.8 vs skills.json=3.5 双值并存 | SM entry 移除，skills.json 为唯一来源 |
| tickIndex>0 只能靠 SM 硬编码 | 支持 1:1 和"每段"映射 |

## 3. 多 tick 技能审计结果

28 个多 tick 技能，分四类：

- **A 类（12 个）**: skills.json 行数===tick 数 或 "每段" 均分 → 可直接结构化映射 ✅ 已实现
- **B 类（7 个）**: 行数≠tick 数，需要 SM 或均分策略 → 阶段性，仍需 fallback
- **C 类（6 个）**: 含 enhanced/conditional → 不并入默认本体，ALESH/ARCLIGHT 已有 verified entry
- **D 类（2 个）**: needs-review（WULFGARD:skill, ARCLIGHT:link）

详细分桶见 `reports/branch-B-P1-multitick-audit.md`。

## 4. 修改后行为变化

| 技能 | 修改前 | 修改后 |
|---|---|---|
| LIFENG:skill (3 tick) | tick0 有值, tick1-2 = 0 | tick0=0.86, tick1=0.86, tick2=2.68 (M3) |
| LASTRITE:ult (3 tick) | 全部 0 | 4.0 + 4.0 + 8.0 (M3) |
| FLUORITE:ult (4 tick) | 全部 0 | 2.5 × 4 (M3) |
| AKEKURI:link (2 tick "每段") | tick0 有值, tick1 = 0 | 1.8 × 2 (M3) |
| ENDMINISTRATOR:skill | SM 2.8 → skills.json 3.5 | 3.5 (M3, 准确) |

以上均支持 per-level（RANK 1~M3），不再只有 M3。

## 5. 仍然是阶段性实现

- **B 类 7 个多 tick 技能**: 行数≠tick 数，目前只能用 SM 分配或 tickIndex=0 primary-only
- **enhanced 变体**: 仍仅 ALESH:link + ARCLIGHT:skill 有手工真值
- **attackSegments**: 完全不受 skill level 影响
- **skills.json 行匹配**: 比之前精确，但仍非完全结构化（依赖行标签关键词）

## 6. 未引入新真值源

- 无新 JSON / md 被运行时读取
- skills.json 保持唯一新数据源角色
- SKILL_MULTIPLIERS 保留 5 个多 tick + 2 个 verified entry
- 无平行覆盖层

## 7. 下一步建议

1. 对 B 类 7 个多 tick 技能逐个分析 skills.json 行-tick 语义映射
2. 对 POGRANICHNK:ultimate (6 tick, 3 行) 做试点：进军→tick0, 袭扰→tick1-4 均分, 决胜→tick5
3. 对 D 类 2 个 needs-review 做人工确认

---

## 中心对话汇报格式

1. **分类**: B — 技能倍率真值 / skill level / wiki 映射
2. **改了哪些文件**: `skillMultipliers.ts`（重写多 tick 映射 + 清理 10 个 estimated entry）、`skillStatusRegistry.ts`（感知 skills.json）、`simulator.ts`（传 tickCount）
3. **行为变化**: 12 个多 tick 技能获得 per-level 结构化映射；18 个角色从"未支持"变为"处理中"；ENDMINISTRATOR 等 10 个单 tick entry 从双源混存变为 skills.json 单源
4. **可收口**: P1 前置收口（显示状态修正 + 匹配精度 + estimated 清理）；A 类 12 个多 tick 映射
5. **阶段性实现**: B 类 7 个多 tick 需进一步映射；enhanced 仍手工；attackSegments 无 level 维度
6. **新真值源**: 无。skills.json 为主，SKILL_MULTIPLIERS 为 fallback，主从关系不变
7. **下一步**: B 类多 tick 逐个映射（POGRANICHNK:ult 试点） → verified entry per-level 补全 → D 类人工确认
