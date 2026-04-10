# ARCLIGHT — skill: 疾风迅雷 初步分类报告

> 来源：warfarin wiki extracted-skills + gamedata tick 结构
> 状态：待实机确认

---

## 数据总览

### Wiki 行（M3 级）

| Label | M3 值 | 分类建议 |
|---|---|---|
| 第一段伤害倍率 | 101% | **默认本体 hit1** |
| 第二段伤害倍率 | 101% | **默认本体 hit2** |
| 第二段失衡值 | 5 | 不进 multiplier（stagger） |
| 追加伤害倍率 | 405% | **conditional branch — 需实机确认** |
| 追加失衡值 | 5 | 不进 multiplier（stagger） |
| 恢复技力 | 40 | 不进 multiplier（resource） |

### Gamedata tick 结构

```
skill_damage_ticks: 2 ticks
  tick0: offset=0.63  stagger=0  sp=0
  tick1: offset=0.80  stagger=5  sp=0
```

---

## 分类建议

### A. 该进默认本体 multiplier 的

| Wiki Label | → tick | M3 值 | 理由 |
|---|---|---|---|
| 第一段伤害倍率 | tick_0 | 101% = 1.01 | gamedata 2 tick 对应 wiki 2 段，tick 数量吻合 |
| 第二段伤害倍率 | tick_1 | 101% = 1.01 | 同上 |

**tick 数量吻合**：wiki 有 2 段本体倍率，gamedata 有 2 个 damage tick。可以直接 1:1 对齐。

### B. Conditional branch（不该进默认序列）

| Wiki Label | M3 值 | 理由 |
|---|---|---|
| 追加伤害倍率 | 405% = 4.05 | wiki 原文描述为"追加伤害"，属于条件触发额外效果 |

**关键疑问**：这个"追加伤害"在运行时如何生效？

可能的语义：
1. **命中后若满足某条件（如消耗附着/触发异常），额外产出一段 405% 伤害** → 应作为 conditional_extra，不并入默认 2-hit
2. **无条件追加，默认就会打出** → 那应该是第 3 hit，但 gamedata 只有 2 tick

**需要实机确认的点**：
- 追加伤害是否需要满足特定条件才触发？
- 追加伤害是否表现为独立的第 3 个伤害实例？
- 追加伤害的命中时间是什么？
- 如果是条件触发，触发条件是什么？

### C. 不该进 skill multiplier 的

| Wiki Label | M3 值 | 理由 |
|---|---|---|
| 第二段失衡值 | 5 | stagger，非伤害倍率 |
| 追加失衡值 | 5 | stagger，非伤害倍率 |
| 恢复技力 | 40 | resource gain，非伤害倍率 |

---

## 其他技能速览（无 review 项）

| 技能 | Wiki 行 | Gamedata ticks | 对齐 |
|---|---|---|---|
| link: 鸣雷 | 伤害倍率=350% | 3 ticks | **需确认**：wiki 只有 1 个"伤害倍率"但 gamedata 有 3 tick。可能是 3 段均分或不均分。 |
| ultimate: 轰雷掣电 | 第一段=350%, 第二段=550% | 2 ticks | 完美对齐：2 段对应 2 tick |

---

## 建议人工优先确认

1. **追加伤害倍率 405%** — 是无条件还是有条件？是否为第 3 hit？
2. **link 鸣雷** — wiki 只给了 1 个总倍率 350%，但 gamedata 有 3 tick，需要确认 3 段分配比例
3. skill 默认 2 hit (101% + 101%) 是否和 gamedata 2 tick 严格对应（可先假定对齐，后续验证）
