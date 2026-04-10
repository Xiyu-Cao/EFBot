# DA_PAN — ultimate: 切丝入锅！ 初步分类报告

> 来源：warfarin wiki extracted-skills + gamedata tick 结构
> 状态：待实机确认

---

## 数据总览

### Wiki 行（M3 级）

| Label | M3 值 | 分类建议 |
|---|---|---|
| 所需终结技能量 | 90 | 不进 multiplier（cost） |
| 空中连斩伤害倍率 | 50% | **需确认** — 多段连斩？每段 50%？ |
| 终结伤害倍率 | 400% | **默认本体 finisher hit** |

### Gamedata tick 结构

```
ultimate_damage_ticks: 2 ticks
  tick0: offset=1.40  stagger=0  sp=0
  tick1: offset=2.67  stagger=0  sp=0

无 variant
```

---

## 分析

gamedata 有 2 tick，wiki 有 2 个伤害行。初步对齐：

| Tick | Wiki Label | M3 值 | 推测 |
|---|---|---|---|
| tick0 (1.40s) | 空中连斩伤害倍率 | 50% | 空中连斩阶段——可能是多次 50%，也可能是单次 |
| tick1 (2.67s) | 终结伤害倍率 | 400% | 最终落地一击 |

### 关键疑问

**"空中连斩伤害倍率 50%"的语义不明确**：
1. 如果是**单次 50%** → tick0 = 0.5，tick1 = 4.0，直接对齐
2. 如果是**每段 50% × N 段** → gamedata 只记了 1 个 tick 作为代表，实际可能有多个同帧或近帧的 hit → tick 结构不完整
3. 如果是**持续 50%/s 的滞空伤害** → 类似 DoT，不适合按 tick 建模

---

## 需要实机确认

1. **空中连斩 50% 是单次 hit 还是 N 次 hit？** 如果是 N 次，各段命中时间是什么？
2. **如果是多段，gamedata 只有 1 tick 是否足够？** 可能需要补 tick
3. **终结伤害 400% 对应 tick1 是否正确？**

### 如果确认为单次 50% + 单次 400%
- 可直接入 `skillMultipliers: [0.5, 4.0]`，与 gamedata 2 tick 对齐
- 这是最简单的情况

### 如果确认为多段 50%
- 需要知道段数和各段时间
- gamedata tick 结构可能需要修改
