# 第三个试跑干员（莱万汀）迁移 — 完成报告

## 1. 选了谁，为什么

**莱万汀（LAEVATAIN）** — 6星突击，灼热元素，单手剑。

选她的理由：
- 有"默认解锁"天赋（灼心），之前修过解析 bug，是 schema 压力测试点
- 天赋1（灼心）有 3 个阶段（默认+E1升级+E3升级），不是标准的 2 阶段，验证 stages 数组弹性
- 职业"突击"（前两个分别是近卫、术师），继续验证职业多样性
- 主属性是"智识"（前两个都是"敏捷"），验证 mainAttribute 字段
- 战技（焚灭）有 14 行 levelData（含终结技增强变体），是技能数据量最大的案例
- 有 5 个专属 buff（熔火0-4），验证 exclusiveBuffs 多条目

## 2. 新增文件

```
src/data/operators/LAEVATAIN/
  meta.json              # 身份信息（突击/灼热/智识主属性）
  stats.json             # 90级完整属性表（脚本生成）
  skills.json            # 4技能（焚灭战技有14行倍率数据）
  talents.json           # 灼心(默认解锁,3阶段) + 复燃(标准2阶段) + 5个熔火buff
  ability-expansion.json # E0即解锁talent_0
```

## 3. 三条消费链

| 链路 | 状态 | 验证点 |
|---|---|---|
| 基础属性 | 已打通 | Lv90: 力量121/敏捷99/智识177/意志89/攻击318/HP5495（注意主属性是智识，最高值） |
| 技能详情 | 已打通 | 焚灭战技有14行数据（含终结技增强期间倍率），schema 容纳无问题 |
| 天赋/主属性 | 已打通 | 灼心显示3阶段描述（默认+E1强化+E3强化），主属性显示"智识" |

## 4. 与管理员/汤汤的 schema 一致性

| 维度 | 一致 | 莱万汀特殊点 |
|---|---|---|
| meta.json | 一致 | profession="vanguard"，mainAttribute="intellect" |
| stats.json | 一致 | 结构完全相同 |
| skills.json | 一致 | 焚灭有14行levelData（最多），结构相同只是行数多 |
| talents.json | **微补充** | 新增 `defaultUnlock: true` 字段标记默认解锁天赋；stages 有3个条目（多于标准2个） |
| ability-expansion | 一致 | E0 的 unlocks 含 talent_0（默认解锁天赋） |

## 5. Schema 问题发现

一个小补充：talents.json 的天赋条目新增了 `defaultUnlock: true` 布尔字段，标记"灼心"是默认解锁天赋。这是可选字段：
- ENDMINISTRATOR/TANGTANG 没有这个字段 → `undefined`，不影响
- 消费方可用 `talent.defaultUnlock === true` 判断是否默认解锁
- 向后兼容，不需要回头改已有文件

stages 数组从固定 2 个扩展到 3 个也完全兼容 — 结构不变，只是数量弹性。

## 6. 其他干员 fallback

未受影响。当前已迁移 3 个（ENDMINISTRATOR / TANGTANG / LAEVATAIN），其余继续走 wiki data。

## 7. 下一步建议

**写自动生成脚本**。3 个手动试跑覆盖了：
- 3 种职业（近卫/术师/突击）
- 3 种元素（物理/寒冷/灼热）
- 2 种主属性（敏捷/智识）
- 默认解锁 vs 标准解锁天赋
- 技能数据量从 2 行到 14 行

Schema 已充分验证，手动迁移的 ROI 递减。建议下一步写 Node 脚本一次性生成剩余 23 个干员。
