# 技能候选映射 — 人工审核表生成报告

> 时间：2026-03-25
> 总审核项：77 条 needs_review
> 存储：`src/external-data/warfarin-wiki/operators/review-tables/`
> 影响：266 tests pass, 0 TS errors

---

## 1. 输出文件

| 文件 | 用途 |
|---|---|
| `skill-mapping-needs-review.json` | 完整 JSON，含 valuesByLevel、suspectedCategory、reviewPriority |
| `skill-mapping-needs-review.md` | 人工可读 Markdown，含 summary + 逐条 review table |

---

## 2. Priority 分布

| Priority | Count | 说明 |
|---|---|---|
| high | 23 | 最像真实技能伤害、最可能误判的条目 |
| medium | 27 | 处决攻击（24）+ 少量强化/提前触发 |
| low | 27 | 下落攻击（24）+ 脆弱/增幅边缘值 |

---

## 3. 按类别归纳

| 归纳类型 | 典型 label | 数量 | 建议 |
|---|---|---|---|
| 处决攻击 | 处决攻击倍率 | 24 | 全员通用，独立 hit type |
| 下落攻击 | 下落攻击倍率 | 24 | 全员通用，独立 hit type |
| 条件额外伤害 | 追加伤害/额外伤害/击碎结晶/消耗附着 | 10 | 角色特定，需逐条确认 |
| 终结技期间强化 | 终结技期间N段/强化普攻N段 | 7 | 莱万汀专属，ult phase override |
| 条件分支 | 对冻结/非冻结敌人伤害 | 2 | 埃特拉连携，需确认哪个进 multiplier |
| 其他 | 幻影追击/空中连斩/强雷枪/巨浪提前 | 7 | 各角色独有，逐条审核 |
| 状态值泄漏 | 脆弱/增幅上限 | 3 | 应排除，不进 multiplier |

---

## 4. 最优先审核的 5 个角色

### 莱万汀 LAEVATAIN (10 条)
战技有终结技期间替换段 + 追加伤害，终结技有强化普攻段。是最复杂的角色。

### 伊冯 YVONNE (6 条)
战技有施加冻结伤害 + 消耗附着额外伤害，终结技有强力攻击/额外攻击。

### 管理员 ENDMINISTRATOR (4 条)
连携有击碎结晶伤害，终结技有额外伤害（消耗结晶条件）。

### 埃特拉 ESTELLA (4 条)
连携有冻结/非冻结两个分支倍率，需要确认哪个对应实际 tick。

### 汤汤 TANGTANG (5 条)
终结技有提前降下巨浪变体。

---

## 5. 审核后怎么用

1. 打开 `review-tables/skill-mapping-needs-review.md`
2. 从 high priority 开始逐条判断
3. 判断结果记录在 `notes` 字段（或单独表格）
4. 判断完成后，将确认的 `include=true` 项批量写入 `skillMultipliers.ts`
5. 确认的 `include=false` 项标记为已审核，不进 runtime
