# Wiki Row → Existing Hit 候选映射报告

> 时间：2026-03-28
> 结果：517 行完成映射，24 干员，96 技能
> 存储：`src/external-data/warfarin-wiki/operators/hit-mapping/`
> 影响：266 tests pass, 0 TS errors — simulation 完全不受影响

---

## 1. 映射统计

### 按 category

| Category | Count | 说明 |
|---|---|---|
| excluded | 248 | 状态/资源/CD/失衡等，明确不进 multiplier |
| default_body_hit | 195 | 技能本体 hit，推荐对齐 gamedata tick |
| execution_attack | 24 | 处决攻击，全员通用，独立 hit type |
| fall_attack | 24 | 下落攻击，全员通用，独立 hit type |
| conditional_extra_hit | 11 | 条件触发额外伤害 |
| ult_enhanced_normal | 4 | 终结技期间强化普攻（莱万汀） |
| enhanced_variant | 2 | 强化变体 |
| conditional_branch | 2 | 条件分支（艾丝黛拉冻结/非冻结） |
| ult_phase_override | 2 | 终结技期间技能替换（莱万汀） |
| 其他 | 5 | 空中连斩/幻影/提前触发等 |

### 按 confidence

| Confidence | Count |
|---|---|
| high | 361 |
| medium | 46 |
| low | 110 |

low 主要来自 normalAttack（gamedata 无 normal tick 数据，无法对齐）。

---

## 2. Top 5 最复杂角色

1. **莱万汀 LAEVATAIN** — 10 条件行：追加伤害、终结技期间替换段、强化普攻4段
2. **伊冯 YVONNE** — 6 条件行：施加冻结伤害、每层附着额外伤害、终结技强力/额外攻击
3. **管理员 ENDMINISTRATOR** — 4 条件行：击碎结晶、额外伤害
4. **艾丝黛拉 ESTELLA** — 4 条件行：冻结/非冻结分支倍率
5. **阿蕾莎 ALESH** — 3 条件行：强化伤害

---

## 3. Top 10 优先审核技能

| 角色 | 技能 | 条件行数 | 最大疑点 |
|---|---|---|---|
| 莱万汀 | 战技:焚灭 | 4 | 追加伤害770% + ult期间替换段330%/370% |
| 莱万汀 | 终结:黄昏 | 4 | 强化普攻4段(146%/182%/260%/456%) |
| 艾丝黛拉 | 连携:失真 | 2 | 冻结360% vs 非冻结630% 哪个是默认 |
| 伊冯 | 战技:冰冰弹·β型 | 2 | 施加冻结150% + 每层附着200% |
| 伊冯 | 终结:冷冻射手 | 2 | 强力攻击300% + 额外攻击600% |
| 阿蕾莎 | 连携:凿孔底钓术 | 1 | 强化伤害480% 是否替换默认 |
| 弧光 | 战技:疾风迅雷 | 1 | 追加伤害405% |
| 维维安娜 | 战技:雷枪·截回 | 1 | 强雷枪432% |
| 大盘 | 终结:切丝入锅 | 1 | 空中连斩50% |
| 管理员 | 连携:锁闭序列 | 1 | 击碎结晶400% |

---

## 4. 输出文件

| 文件 | 用途 |
|---|---|
| `hit-mapping/*.json` | 每角色完整映射（per-row: label→mappedTarget+confidence+category） |
| `hit-mapping/_summary.json` | 全量统计汇总 |
| `review-tables/skills-needing-second-pass.md` | 按技能分组的人工审核清单 |
