# B 分支 P1 — 多 tick 审计与分桶

## 多 tick 技能分桶结果（28 个技能）

### A. 可直接由 skills.json 做结构化 tick-to-row 映射（13 个）

skills.json 的倍率行数 === gamedata tick 数，且行标签有明确的 per-tick 标识。

| 角色 | 技能 | ticks | skills.json 行 | 映射方式 |
|---|---|---|---|---|
| POGRANICHNK | skill | 2 | 第一段192%, 第二段238% | 行 0→tick0, 行 1→tick1 |
| LIFENG | skill | 3 | 第一段86%, 第二段86%, 第三段268% | 直接 1:1 |
| LIFENG | link | 2 | 第一段105%, 第二段375% | 直接 1:1 |
| LASTRITE | ultimate | 3 | 第一段400%, 第二段400%, 第三段800% | 直接 1:1 |
| ARDELIA | link | 2 | 伤害100%, 爆炸250% | 行 0→tick0, 行 1→tick1 |
| ARCLIGHT | ultimate | 2 | 第一段350%, 第二段550% | 直接 1:1（已 verified） |
| DAPAN | ultimate | 2 | 空中连斩50%, 终结400% | 行 0→tick0, 行 1→tick1 |
| CATCHER | ultimate | 3 | 第一段200%, 第二段270%, 第三段400% | 直接 1:1 |
| FLUORITE | ultimate | 4 | 第一段250%×4 | 直接 1:1 |
| CHENQIANYU | ultimate | 7 | 斩击81%, 终结一击1023% | 见 B 类（行数≠tick数） |
| AKEKURI | link | 2 | 每段180% | 均分：每 tick 180% |
| WULFGARD | ultimate | 5 | 每段72% | 均分：每 tick 72% |
| TANGTANG | skill | 2 | 射击180%, 水龙卷300% | 行 0→tick0, 行 1→tick1 |

注：CHENQIANYU:ultimate 行数(2)≠tick数(7)，移入 B 类。

**修正后 A 类实际 12 个**。

### B. 部分映射，仍需 SKILL_MULTIPLIERS 提供分配比例（7 个）

skills.json 行数 ≠ tick 数，但 skills.json 提供总量，SM 提供分配。

| 角色 | 技能 | ticks | 问题 | 处理方案 |
|---|---|---|---|---|
| CHENQIANYU | ultimate | 7 | 2 行 vs 7 ticks | 斩击81% 分配给 tick0-5，终结一击1023% 给 tick6。tick0-5 内部均分 |
| GILBERTA | skill | 5 | 2 行 vs 5 ticks | 牵引219% 分配给 tick0-3，爆炸130% 给 tick4。tick0-3 内部均分 |
| POGRANICHNK | ultimate | 6 | 3 行 vs 6 ticks | 进军300%→tick0, 袭扰100%→tick1-4 均分, 决胜450%→tick5 |
| EMBER | skill | 2 | 1 行 vs 2 ticks | 总倍率390%，tick 分配需要 SM 或均分 |
| DAPAN | skill | 2 | 1 行 vs 2 ticks | 总倍率300%，tick 分配需要 SM 或均分 |
| FLUORITE | skill | 2 | 1 行 vs 2 ticks | 总倍率420%，tick 分配需要 SM 或均分 |
| ARDELIA | ultimate | 3 | 1 行 vs 3 ticks | 伤害165%×3 tick（是 per-tick 还是总量？需 review） |

### C. 含 enhanced / conditional_branch / conditional_extra_hit（6 个）

不应将条件行并入默认本体。

| 角色 | 技能 | 条件内容 | 处理 |
|---|---|---|---|
| ARCLIGHT | skill | 追加伤害倍率405% = conditional_extra_hit | SM 已 verified，不动 |
| ALESH | link | 强化伤害倍率480% = enhanced variant | SM 已 verified，不动 |
| POGRANICHNK | link | 强化第三段297% = enhanced variant | SM 中第三段可接受 enhanced |
| LASTRITE | link | 消耗每层附着额外伤害240% = conditional | 不并入默认本体 |
| LAEVATAIN | skill | 终结技期间330%/370%/900% = enhanced state | 不并入默认10 tick |
| LIFENG | ultimate | 追加伤害倍率600% = conditional | 不并入默认 2 tick |

### D. needs-review（2 个）

| 角色 | 技能 | 问题 |
|---|---|---|
| WULFGARD | skill | 2 行(伤害230%, 追加850%) vs 3 ticks — 追加是 conditional 还是第 3 tick？ |
| ARCLIGHT | link | 1 行(伤害350%) vs 3 ticks — tick 分配完全不明 |

---

## 本轮建议实施的最小多 tick 试点

从 A 类中选**最有把握、结构最清晰的 6 个**做结构化映射：

1. LIFENG:skill (3 tick, 3 行 1:1)
2. LIFENG:link (2 tick, 2 行 1:1)
3. LASTRITE:ultimate (3 tick, 3 行 1:1)
4. CATCHER:ultimate (3 tick, 3 行 1:1)
5. FLUORITE:ultimate (4 tick, 4 行 1:1)
6. POGRANICHNK:skill (2 tick, 2 行 1:1)

这些全是行数===tick数、标签有明确段数标识的最简单情况。
