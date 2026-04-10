# 第二个试跑干员（汤汤）迁移 — 完成报告

## 选了谁，为什么

**汤汤（TANGTANG）** — 6星术师，寒冷元素，手铳武器。

选她的理由：
- 和管理员在职业（近卫 vs 术师）、元素（物理 vs 寒冷）、武器（剑 vs 铳）上完全不同，能验证 schema 通用性
- 6星，技能数据完整（4个技能各12级倍率齐全）
- 天赋结构标准（2个天赋，解锁+强化阶段完整）
- 有多种专属 buff（水龙卷/涡流/古老图形/法术脆弱），可验证 exclusiveBuffs 结构
- 项目中数据齐全（wiki normalized + gamedata + 头像/图标资源全有）

## 新增文件

```
src/data/operators/TANGTANG/
  meta.json              # 身份信息
  stats.json             # 90级完整属性表（脚本从wiki数据生成）
  skills.json            # 4技能定义 + 12级倍率
  talents.json           # 主/副属性 + 2天赋 + 4个专属buff
  ability-expansion.json # 精英化阶段规则
```

## 3 条消费链是否打通

| 链路 | 状态 | 说明 |
|---|---|---|
| 基础属性显示 | 已打通 | `resolveBaseStats('TANGTANG', level)` 优先命中 `stats.json`，Lv90: 力量123/敏捷179/智识85/意志102/攻击321/HP5495 |
| 技能详情 | 已打通 | 能力扩展模式点击技能 → `opData.value.skills` 命中 `skills.json` → 右侧显示描述+当前等级倍率 |
| 天赋/主属性说明 | 已打通 | 点击天赋 → `opData.value.talents` 命中 `talents.json` → 右侧显示分阶段描述 |

无需额外代码改动 — 现有 loader + fallback 逻辑自动覆盖新增干员。

## 与管理员的 schema 一致性

| 字段/结构 | 一致 | 备注 |
|---|---|---|
| meta.json 所有字段 | 一致 | profession/element/weaponType 值不同但结构相同 |
| stats.json levels 结构 | 一致 | 同样 1-90 级，6个属性字段 |
| skills.json 4技能结构 | 一致 | levelData 行数不同（汤汤战技有8行 vs 管理员2行），但结构相同 |
| talents.json 结构 | 一致 | 2天赋各2阶段，exclusiveBuffs 数量不同（4 vs 1）但结构相同 |
| ability-expansion.json | 一致 | 完全相同的阶段规则 |

## 是否发现 schema 问题

没有。schema 对汤汤完全适用，无需任何补充字段。关键差异都在值层面（更多的技能倍率行、更多的专属buff），结构层面完全兼容。

## 其他干员 fallback

未受影响。只有 ENDMINISTRATOR 和 TANGTANG 走新结构，其余继续走 wiki data。

## 下一步建议

**写自动生成脚本**。两个手动试跑已验证 schema 通用性，继续手动迁移效率低下。建议写一个 Node 脚本：
- 输入：warfarin-wiki normalized JSON + gamedata.json
- 输出：每个干员的 5 个文件
- 一次性生成全部 26 个干员
- 生成后人工抽检 2-3 个即可
