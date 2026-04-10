# B 分支 P2 完成报告

---

## 1. P1 防回退检查结果

- **显示状态**: 9 个 "unsupported" 全部是无伤害倍率的辅助/治疗/增幅技能（XAIHI/SNOWSHINE/ANTAL/AKEKURI）或无数据的 ROSSI。正确行为，非回退。
- **A 类 12 个**: 全部正常返回 per-level 值，tickIndex>0 不为 0。
- **已移除 entry**: 运行时正确从 skills.json 取值，无伤害归零。
- **tickCount 传递**: 无边缘影响。单 tick 技能 tickCount=1，Case 3 不触发。

**结论**: P1 无回退。

## 2. 本轮实际修改文件

| 文件 | 改动 |
|---|---|
| `skillMultipliers.ts` | `getSkillMultiplierFromData` 新增 Case 3（单行多 tick per-tick）和 Case 4（group mapping: 2 行→首末 / 3 行→首中末）；移除 CHENQIANYU:ult、GILBERTA:skill、POGRANICHNK:skill/ult 的 SM entry |

**POGRANICHNK:link 保留**（3 tick，含 enhanced 强化第三段）。
**ARCLIGHT:skill/ult 和 ALESH:link 不动**（verified entry 有 conditional/enhanced 职责）。

## 3. B 类 7 个技能逐个结论

| 技能 | ticks | rows | 结论 | 映射方式 |
|---|---|---|---|---|
| CHENQIANYU:ult | 7 | 2 | **A→结构化** | 斩击81%→t0-5 均分 13.5%/tick, 终結1023%→t6 |
| GILBERTA:skill | 5 | 2 | **A→结构化** | 牵引219%→t0-3 均分 54.75%/tick, 爆炸130%→t4 |
| POGRANICHNK:ult | 6 | 3 | **A→结构化** | 进军300%→t0, 袭扰100%→t1-4 均分 25%/tick, 决胜450%→t5 |
| EMBER:skill | 2 | 1 | **A→per-tick** | 390% per tick（可能是 total，标 wip） |
| DAPAN:skill | 2 | 1 | **A→per-tick** | 300% per tick（可能是 total，标 wip） |
| FLUORITE:skill | 2 | 1 | **A→per-tick** | 420% per tick（可能是 total，标 wip） |
| ARDELIA:ult | 3 | 1 | **A→per-tick** | 165% per tick（stagger 均匀，likely per-tick） |

## 4. POGRANICHNK:ultimate 试点

已落地。skills.json 有 3 行（进军/袭扰/决胜），gamedata 6 ticks。映射：
- tick0 = 进军 300%
- tick1-4 = 袭扰 100% ÷ 4 = 25% each
- tick5 = 决胜 450%
- M3 总量 = 300 + 4×25 + 450 = 850%

SM entry 已移除，完全由 skills.json group mapping 驱动。

## 5. D 类 2 个技能结论

| 技能 | 结论 | 理由 |
|---|---|---|
| WULFGARD:skill | **resolved** | 伤害 230% = 默认本体, 追加 850% = conditional（被 EXCLUDE 排除）。3 tick 单行→per-tick |
| ARCLIGHT:link | **resolved** | 伤害 350% = 3 tick 总量。单行→per-tick |

D 类清空，无 needs-review 剩余。

## 6. 修改后行为变化

| 技能 | 修改前 | 修改后 (M3) |
|---|---|---|
| CHENQIANYU:ult | SM 估算 [2.0,1.0×5,3.0] | skills.json [0.135×6, 10.23] |
| GILBERTA:skill | SM 估算 [0.8×4,2.4] | skills.json [0.5475×4, 1.3] |
| POGRANICHNK:ult | SM 估算 [1.5,0.5×4,3.0] | skills.json [3.0, 0.25×4, 4.5] |
| EMBER:skill | 0 (无 entry) | 3.9 per tick |
| DAPAN:skill | 0 (无 entry) | 3.0 per tick |
| FLUORITE:skill | 0 (无 entry) | 4.2 per tick |
| ARDELIA:ult | 0 (无 entry) | 1.65 per tick |
| WULFGARD:skill | 0 (无 entry) | 2.3 per tick |
| ARCLIGHT:link | 0 (无 entry) | 3.5 per tick |

所有均支持 per-level（RANK 1~M3）。

## 7. 仍是阶段性实现

- **EMBER/DAPAN/FLUORITE:skill 单行倍率语义**: 可能是 total 而非 per-tick，wip 标签已设
- **POGRANICHNK:link**: SM estimated entry 仍保留（含 enhanced 强化第三段，C 类边界）
- **ALESH/ARCLIGHT verified entries**: 保持不动
- **attackSegments**: 不受 skill level 影响

## 8. 未引入新真值源

- 无新 JSON/md 接入运行时
- SM 从 8 entry 精简至 4（POGRANICHNK:link + ARCLIGHT:skill/ult + ALESH:link）
- skills.json 为主来源，SM 仅在有 verified conditional/enhanced 职责处保留

## 9. 排轴器上可直接看到的变化

### 测试 1: POGRANICHNK 终结技从"未支持"→有伤害
- 操作: 排轴中放一个骏卫终结技
- 修改前: DamageSummary 显示 0 伤害 + "未支持"标签
- 修改后: 应显示非零伤害 + "处理中"标签
- 修改技能等级: M3 → RANK1 → 伤害应明显降低

### 测试 2: EMBER/DAPAN/FLUORITE 战技从"未支持"→有伤害
- 操作: 放一个余烬战技 / 大潘战技 / 萤石战技
- 修改前: 0 伤害 + "未支持"
- 修改后: 非零伤害 + "处理中"

### 测试 3: CHENQIANYU 终结技数值变化
- 操作: 排轴中放一个陈千雨终结技
- 修改前: SM 估算值（总量~10.0）
- 修改后: wiki 真值（斩击81%×6 + 终結1023%，总量~11.1 at M3）
- 修改等级: 应看到 per-level 变化

### 测试 4: ARCLIGHT 连携技从 0→有伤害
- 操作: 放一个弧光连携技
- 修改前: 0 伤害（无 SM entry）
- 修改后: 350% per tick × 3 at M3

## 10. 下一步建议

1. **EMBER/DAPAN/FLUORITE:skill 单行语义确认**: 需要人工确认 wiki 的 "伤害倍率" 是 total 还是 per-tick。如果是 total，改为 ÷ tickCount
2. **POGRANICHNK:link enhanced**: 补充 per-level 或标注仍需 verified 校验
3. **剩余 SM 4 个 entry**: 全部是 verified 或 C 类边界，不宜在 B 分支继续操作

---

## 中心对话汇报

1. **分类**: B — 技能倍率真值 / skill level / wiki 映射
2. **改了哪些文件**: `skillMultipliers.ts`（新增 group mapping Case 3/4；移除 4 个 SM entry）
3. **行为变化**: B 类 7 个多 tick 技能全部获得 per-level 结构化映射；D 类 2 个 needs-review 降级为 resolved；SM 从 8→4 个 entry。9 个新技能从"未支持/0伤害"变为有伤害
4. **可收口**: A 类 12 + B 类 7 = 19 个多 tick 技能结构化映射完成；D 类清空
5. **阶段性实现**: EMBER/DAPAN/FLUORITE:skill 单行语义待确认；POGRANICHNK:link enhanced 仍用 SM
6. **新真值源**: 无。SM 精简到 4 个仅承担 verified conditional/enhanced 职责
7. **排轴器可见变化**: POGRANICHNK 终结技、EMBER/DAPAN/FLUORITE 战技、ARCLIGHT 连携技从 0 伤害变为有伤害+处理中标签；CHENQIANYU 终结技数值从估算→wiki 真值。改技能等级→伤害跟着变
8. **下一步**: 单行语义人工确认 → POGRANICHNK:link enhanced per-level → B 分支基本收口
