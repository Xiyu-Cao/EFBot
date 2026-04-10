# B 分支 P2.5 收尾报告

---

## 1. 检查了哪些文件

- `src/simulation/data/skillMultipliers.ts` — Case 3 逻辑 + POGRANICHNK SM entry
- `src/data/operators/EMBER/skills.json`, `DAPAN/skills.json`, `FLUORITE/skills.json` — 行语义
- `src/data/operators/POGRANICHNK/skills.json` — link 行结构
- `src/data/operators/ARDELIA/skills.json` — 交叉验证
- `public/gamedata.json` — tick stagger/boundEffects 确认

## 2. EMBER / DAPAN / FLUORITE 单行倍率结论

| 技能 | tick 数 | 行值 M3 | tick0 stagger | tick1 stagger | 结论 |
|---|---|---|---|---|---|
| EMBER:skill | 2 | 390% | 0 (空，无 boundEffects) | 10 (实际伤害) | **total** |
| DAPAN:skill | 2 | 300% | 0 (空) | 10 (实际伤害) | **total** |
| FLUORITE:skill | 2 | 420% | 0 (空) | 10 (延迟爆炸) | **total** |

三者完全相同模式：tick0 是蓄力/放置阶段（stagger=0, 无 boundEffects），tick1 是实际伤害。"伤害倍率"是技能总量。

**修改**: Case 3 从 `return parseRow(rows[0])` 改为 `return parseRow(rows[0]) / tickCount`（保守均分）。

**副作用**: ARDELIA:ultimate（3 tick, 均匀 stagger, 可能是 per-tick）也被影响。165% ÷ 3 = 55% per tick，underestimated。但 ARDELIA:ult 已标 "wip"，比 EMBER/DAPAN/FLUORITE 2× overcounting 的问题小得多。

## 3. POGRANICHNK:link 边界结论

| 部分 | 来源 | 处理 |
|---|---|---|
| 默认本体（3 tick） | skills.json 3 行 1:1 映射 | **skills.json 覆盖，SM 移除** |
| 强化第三段 297% | skills.json 有行但被 EXCLUDE 排除 | **C 类，B 分支不处理** |

SM entry 移除。SM 最终从原始 18 entry → 仅剩 **ARCLIGHT + ALESH = 2 entries**，全部 verified，承担 conditional_extra_hit / enhanced 不可替代职责。

## 4. "技能报错"非 B 分支的边界判断

用户反馈"除了普通攻击之外很多技能仍报错"。基于 B 分支职责边界，以下类型的问题**不属于 B 分支**：

| 报错类型 | 属于 | 原因 |
|---|---|---|
| runtime 事件处理异常（如 effect 找不到 target） | C — runtime | 事件链/行为实现问题 |
| 武器 triggered buff 注册失败 | E — equipment | 武器被动逻辑问题 |
| 连携技触发条件判定失败 | C — runtime | 连携触发条件是 runtime 行为 |
| SP/gauge 计算异常 | C — runtime | resource 系统 |
| 终结技增强态 multiplier 缺失 | C — enhanced | enhancedMultipliers 是 C 类 |
| 倍率确实为 0（无 skills.json 行） | B — 但已处理 | 仅 ROSSI 和纯辅助技能 |

**B 分支已确认通路**: 倍率从 skills.json → overlay → damageSummary 全链已打通。如果某个技能有非零倍率但仍报错，问题在 runtime/行为层，不在倍率链。

## 5. B 分支收口状态

| 项目 | 状态 |
|---|---|
| skills.json 主真值源 | ✅ 收口 |
| import.meta.glob 连通 | ✅ 收口 |
| damageSummary overlay 连通 | ✅ 收口 |
| 单 tick 技能 per-level | ✅ 收口 |
| 多 tick A 类 1:1/每段映射 | ✅ 收口 |
| 多 tick B 类 group mapping | ✅ 收口 |
| 单行 total 语义修正 | ✅ 收口（保守均分） |
| SM 精简 | ✅ 收口（仅 2 entries） |
| 显示状态感知 skills.json | ✅ 收口 |
| POGRANICHNK:link default | ✅ 收口（skills.json 1:1） |

## 6. 仍是阶段性实现

- **Case 3 均分**: ARDELIA:ult 等"真 per-tick"技能被 underestimate，无法自动区分
- **enhanced 变体**: POGRANICHNK:link 强化、终结技增强态 → C 类
- **attackSegments**: 普通攻击不受 skill level 影响 → 不在 B 分支范围

## 7. 未引入新真值源

SM 从 18 → 2。无新 JSON/md 接入运行时。

## 8. 排轴器可见变化

### EMBER/DAPAN/FLUORITE 战技伤害变化
- **修改前**: 两个 tick 各得到全量倍率（2× overcounting）
- **修改后**: 均分，总量正确
- **测试**: 放一个余烬战技，观察 DamageSummary 伤害应约为之前的一半

### POGRANICHNK 连携技精度提升
- **修改前**: SM estimated [1.0, 1.2, 2.5]
- **修改后**: skills.json [0.95, 1.22, 1.49] at M3（per-level）
- **测试**: 放一个骏卫连携，改技能等级应看到伤害变化

---

## 中心对话汇报

1. **分类**: B — P2.5 收尾
2. **改了哪些文件**: `skillMultipliers.ts`（Case 3 改为 total÷tickCount + 移除 POGRANICHNK SM entry）
3. **行为变化**: EMBER/DAPAN/FLUORITE 战技从 2× overcounting 修正为正确总量；POGRANICHNK:link 从 SM 估算切到 skills.json per-level；SM 从 4 → 2 entries
4. **可收口**: B 分支主要工作全部完成（主真值源、连通性、映射逻辑、SM 精简、显示状态）
5. **阶段性实现**: Case 3 均分对部分"真 per-tick"技能 underestimate；enhanced 变体仍无 per-level
6. **新真值源**: 无
7. **排轴器可见**: EMBER/DAPAN/FLUORITE 伤害减半（修正 overcounting）；POGRANICHNK 连携 per-level 生效
8. **非 B 分支报错**: runtime 事件异常、武器被动、连携触发条件、SP/gauge、终结技增强态 → 属于 C/E 分支
9. **下一步**: B 分支可标记为基本收口。剩余的 Case 3 精度问题和 enhanced per-level 归入后续迭代
