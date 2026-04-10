# AVYWENNA — skill: 雷枪·截回 初步分类报告

> 来源：warfarin wiki extracted-skills + gamedata tick 结构
> 状态：待实机确认

---

## 数据总览

### Wiki 行（M3 级）

| Label | M3 值 | 分类建议 |
|---|---|---|
| 伤害倍率 | 150% | **默认本体 hit** — 技能本体伤害 |
| 失衡值 | 5 | 不进 multiplier（stagger） |
| 雷枪伤害倍率 | 168% | **conditional branch** — 雷枪召唤物的伤害？ |
| 雷枪失衡值 | 5 | 不进 multiplier（stagger） |
| 强雷枪伤害倍率 | 432% | **enhanced variant / conditional branch** — 强化版雷枪伤害 |
| 强雷枪失衡值 | 10 | 不进 multiplier（stagger） |

### Gamedata tick 结构

```
skill_damage_ticks: 1 tick
  tick0: offset=0.6  stagger=5  sp=0

variant "战技-回收雷枪":
  1 tick: offset=0.6  stagger=30  sp=0  (同 offset，失衡值大幅提高)
```

---

## 分析

### 技能机制（推测）
这个技能似乎涉及"雷枪"召唤物系统：
- **伤害倍率 150%** = 技能本体伤害（tick0，offset 0.6）
- **雷枪伤害倍率 168%** = 场上存在雷枪时，雷枪自身造成的伤害（可能是独立伤害源 / 召唤物伤害）
- **强雷枪伤害倍率 432%** = 强化状态的雷枪伤害（更高倍率的变体）

### 关键疑问

gamedata 只有 1 个 damage tick（本体），雷枪伤害和强雷枪伤害在 gamedata 中**没有对应的 tick**。这意味着：
1. 雷枪伤害可能是**召唤物/持续效果**产出的，不是技能动画中的 hit
2. 或者雷枪伤害在别的地方触发（如连携技的 boundEffects、武器 skill interaction 等）

### 分类建议

| Label | 建议分类 | 是否进 skillMultipliers |
|---|---|---|
| 伤害倍率 150% | default_body_hit → tick_0 | **是** |
| 雷枪伤害倍率 168% | conditional_branch（召唤物/独立来源） | **否** — 不属于技能本体 tick |
| 强雷枪伤害倍率 432% | enhanced_variant（强化召唤物） | **否** — 同上 |
| 失衡值 / 雷枪失衡值 / 强雷枪失衡值 | excluded | **否** |

---

## 需要实机确认

1. **雷枪伤害 168%** 是什么？是召唤物持续伤害？是技能施放时的额外 hit？还是连携/终结技触发的效果？
2. **强雷枪 432%** 与普通雷枪 168% 的关系——是条件分支（满足条件打强版，否则打普通版）还是完全独立的两种效果？
3. 雷枪伤害的**触发时间**和**伤害来源**——是算技能伤害还是算召唤物伤害？
4. variant "战技-回收雷枪"（stagger 从 5 提高到 30）对应什么游戏行为？

### 建议处理顺序
- 如果雷枪是召唤物系统 → 暂不处理，不进 skillMultipliers（当前项目无召唤物伤害框架）
- 如果雷枪是技能本体额外 hit → 需要加 tick 并实现
- **先确认机制再动代码**
