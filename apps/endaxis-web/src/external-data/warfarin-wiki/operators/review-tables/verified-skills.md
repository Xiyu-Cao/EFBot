# Verified Skills — 已完成人工审核的技能

本文件记录所有已完成实机确认 + runtime 落地的技能条目。
每条按角色/技能为单位，记录结论和当前实现状态。

---

## ALESH — link: 凿孔底钓术

**状态**: 阶段性收口（runtime 行为已正确，skill level 维度尚未完整落地）

### 实机结论
- 默认本体 = **2 hit**（非单 hit）
- 命中时间 = 00:19 / 01:05（runtime offset = 0.317s / 1.083s，帧精度 19f / 65f @60fps）
- 2 hit 分配比例 = **33/133 : 100/133**（来自 Lv1 总倍率 133% = 33% + 100%）
- 强化态（"强化伤害倍率" wiki 行）= **不新增 hit**，只替换原 2 hit 总倍率，再按同比例拆分
  - M3 默认总倍率 300% → hit1 = 74.4%, hit2 = 225.6%
  - M3 强化总倍率 480% → hit1 = 119.1%, hit2 = 360.9%

### 当前实现
- `gamedata.json`: `link_damage_ticks` = 2 tick (offset 0.317, 1.083)
- `skillMultipliers.ts`: `ALESH.link.multipliers = [0.7444, 2.2556]`, `enhancedMultipliers = [1.191, 3.609]`
- `simulator.ts`: `enhancedActionIds` 从 UI variant 系统桥接，传入 overlay 的 `useEnhanced`
- 状态标记: `status: "verified"`, source: `"warfarin-wiki M3 + in-game 2-hit verification"`

### 已知限制
- 当前 multipliers 数组只存储 M3 级预拆分值
- 1-9 / M1 / M2 各级数据在 wiki extracted-skills 中已有，但未逐级写入 overlay
- 后续若需支持非 M3 级，需扩展 skillMultipliers 为 per-level 结构

---

## ARCLIGHT — skill: 疾风迅雷

**状态**: 阶段性收口（runtime 行为已正确，skill level 维度尚未完整落地）

### 实机结论
- 默认本体 = **2 hit**（tick0 offset=0.63, tick1 offset=0.80）
- M3 默认: hit1 = 101%, hit2 = 101%
- 存在 **1 段额外伤害**（追加伤害倍率 405%），为**独立 hit**
- 额外伤害触发时间 = offset 1.2s（与 end-axis 记录一致）
- **电磁 buff（conduction）消耗时机 = 额外伤害同帧、结算后消耗**
  - 运行时语义：先按当前 enemy state（含 conduction）完成该 hit 的伤害结算
  - 结算完成后同帧清除 conduction
  - 额外伤害**享受** conduction 的法术易伤加成

### 当前实现
- `gamedata.json`: base `skill_damage_ticks` = 2 tick (0.63, 0.80)；variant `v_1767273184428` 增加第 3 tick (1.2)，`boundEffects: ["consume_conduction"]`
- `skillMultipliers.ts`: `ARCLIGHT.skill.multipliers = [1.01, 1.01]`, `enhancedMultipliers = [1.01, 1.01, 4.05]`
- `DamageHandler.ts`: `processPostDamageEffects` 在 damage resolution 后处理 `consume_conduction` → 清除 `enemy.status.conduction`
- `simulator.ts`: `enhancedActionIds` 从 UI variant 系统桥接

### 同时验证
- `ARCLIGHT.ultimate` 终结技: 2 tick [3.5, 5.5] 与 gamedata 对齐

### 最终结论
- 405% 为 **conditional_extra_hit**，不并入默认 2-hit 序列
- 额外伤害为**独立第 3 hit**（variant 第 3 tick，offset 1.2s）
- 触发时间沿用当前 end-axis 记录，未修改
- conduction 消耗与该额外伤害**同帧**
- 顺序为：**先结算第 3 hit（享受导电易伤），再清 conduction**
- runtime 实现：`DamageHandler.processPostDamageEffects` + `boundEffects: ["consume_conduction"]`

### 已知限制
- 同 ALESH：仅 M3 级，未逐级写入

---

## AVYWENNA — skill: 雷枪·截回

**状态**: 已确认机制，暂不实现 runtime（需 buff 实例计数系统）

### 实机结论
- 技能本体 = **1 hit**（offset 0.6s，伤害倍率 150%，gamedata 1 tick 对齐）
- **雷枪** 和 **强雷枪** 是独立 buff 实例，各自存在时长 50s
- 战技施放并命中时：
  - 每个现存的雷枪 buff 实例各自触发 **1 段独立伤害**（168% per instance）
  - 每个现存的强雷枪 buff 实例各自触发 **1 段独立伤害**（432% per instance）
  - 这些伤害**不合并计算**，各为独立 hit
  - 可在**同一帧分别结算**
- 命中后**清除所有雷枪和强雷枪 buff**
- variant "战技-回收雷枪"（stagger 5→30）= 存在雷枪时回收触发的本体强化

### 分类结论
| Label | M3 值 | 分类 |
|---|---|---|
| 伤害倍率 | 150% | default_body_hit → tick_0 |
| 雷枪伤害倍率 | 168% | per_buff_instance_damage — 每个雷枪 buff 独立触发 |
| 强雷枪伤害倍率 | 432% | per_buff_instance_damage — 每个强雷枪 buff 独立触发 |

### 暂不实现的原因
- 雷枪/强雷枪的 hit 数量取决于命中时场上存在多少个 buff 实例
- 当前 simulation 无 "buff 实例计数 → 动态生成 N 个 damage tick" 机制
- 技能本体 150% (tick_0) 可以先入 skillMultipliers
- 雷枪/强雷枪伤害需要 buff instance tracking 系统支持后再接入

### 可先做
- `skillMultipliers.ts` 添加 AVYWENNA skill: `multipliers: [1.5]`（本体 1 tick）
- 雷枪/强雷枪倍率记录在案，待 buff 实例系统就绪后接入
