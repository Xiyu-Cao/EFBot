# 本轮修改摘要

- 处理范围: 光荣记忆 / 狼之绯 / 落草 / 望乡
- 是否只限四把武器: 是
- 是否引入新真值源: 否

# 修改文件清单

| 文件路径 | 修改内容 | 为什么改 | 类别 |
|---|---|---|---|
| `public/gamedata.json` → 光荣记忆 | triggeredBuff[0]: trigger 改为 `on_physical_anomaly`，补 effects `[ultimate_dmg_bonus: 33.6]`，补 duration=30，补 buffName | 原 trigger `on_skill_break_apply` 未识别 + effects 为空 → 被动完全不生效 | 主路径必需 |
| `public/gamedata.json` → 望乡 | triggeredBuff[0].effects: `cold_nature_dmg` → `cold_dmg` | 原 stat 不在 CORE_STATS → 无法被消费 | 主路径必需 |

# 四把武器结果表

| 武器名 | 本轮改动 | 配置链 | 属性链 | simulation 链 | 状态 |
|---|---|---|---|---|---|
| 光荣记忆 | ✅ trigger+effects+duration | ✅ | ✅ | ✅ 被动已进入 | 基础完整 |
| 狼之绯 | ❌ 无改动 | ✅ | ✅ | ✅ (无被动) | 基础可用，缺外部真值 |
| 落草 | ❌ 无改动 | ✅ | ✅ | ⚠️ 1/2 被动 | 基础可用，部分不完整 |
| 望乡 | ✅ stat 修正 | ✅ | ✅ | ❌ trigger 仍未识别 | 基础可用，被动待 trigger |

# 逐武器说明

## 光荣记忆
- 改了什么: triggeredBuff trigger `on_skill_break_apply` → `on_physical_anomaly`；补 effects `[{stat: 'ultimate_dmg_bonus', value: 33.6}]`；补 duration=30；补 buffName
- 为什么: 原 trigger 未在 TRIGGER_EVENT_MAP 中，effects 为空 → 被动完全跳过
- 已解决: 被动"终结技伤害+33.6%"可进入 simulation
- 仍未解决: trigger 是近似映射（`on_physical_anomaly` vs 原始 `on_skill_break_apply`）。精确语义是"技能施加破防时"而非"任意物理异常时"，但当前 adapter 不支持更精确的 trigger。maxStacks=3 保留原值

## 狼之绯
- 改了什么: 无
- 为什么: wiki 无页面（404），gamedata 无 `_raw` 描述，无可靠外部真值来源
- 已解决: N/A
- 仍未解决: baseAtk=495 仍为估算值；passiveStats/triggeredBuffs 仍为空（可能有被动但无数据来源）

## 落草
- 改了什么: 无
- 为什么: commonSlots 的实际 modifierId 无法确认（无 wiki、无 `_raw`）；triggeredBuff[1] trigger `_unknown` 无法确认实际触发类型
- 已解决: N/A（triggeredBuff[0] 已在上一轮审计时确认为可工作）
- 仍未解决: 2 个 null commonSlots（无词条加成）；triggeredBuff[1]（对敌 arts_dmg+16.8%）被动未接入

## 望乡
- 改了什么: triggeredBuff[0].effects 中 `cold_nature_dmg` → `cold_dmg`
- 为什么: `cold_nature_dmg` 不在 CORE_STATS，即使未来 trigger 被修复也无法被消费
- 已解决: effects 数据现在全部是合法 stat（`cold_dmg` + `nature_dmg`）
- 仍未解决: trigger 仍为 `_unknown` → 被动仍未进入 simulation。需要确认实际触发条件才能映射

# 链路验证结果

- 配置链: ✅ 四把武器均可被配置页识别（未改动此链路）
- 属性链: ✅ passiveStats + commonSlots 消费正常（落草 null slots 安全跳过）
- 武器攻击力计算链: ✅ 四把 baseAtk 均为有效数字
- simulation 输入链:
  - 光荣记忆: ✅ `on_physical_anomaly` 已被识别，effects 有值
  - 狼之绯: ✅ 无 triggeredBuffs（安全）
  - 落草: ⚠️ triggeredBuff[0] ✅, triggeredBuff[1] ❌ (`_unknown`)
  - 望乡: ❌ trigger `_unknown` → 被动被跳过
- 是否影响其他武器: **否**（只改了 2 个武器的 triggeredBuff 字段，不涉及全局逻辑）
- 是否引入新真值源: **否**

# 未解决项

| 项目 | 原因 | 归属 |
|---|---|---|
| 狼之绯 baseAtk 精确值 | wiki 404，无外部可靠来源 | 需游戏内验证 |
| 狼之绯 passiveStats / triggeredBuffs | 同上 | 需游戏内验证 |
| 落草 commonSlots 2×null | 无可靠来源确认 modifierId | 需游戏内/wiki 验证 |
| 落草 triggeredBuff[1] `_unknown` | 无 `_raw` 描述，无法确认 trigger 类型 | 需游戏内验证 |
| 望乡 triggeredBuff trigger `_unknown` | 无 `_raw` 描述 | 需游戏内验证 |
| 光荣记忆 trigger 精度 | `on_physical_anomaly` 是近似（实际应为 "技能施加破防时"）| 需 weaponDataAdapter 新增精确 trigger 类型 |

# 给主会话的收口摘要

- **分类**: 小型武器数据精修 — 4 把武器
- **改了哪些文件**: `public/gamedata.json`（光荣记忆 triggeredBuff 补齐 + 望乡 invalid stat 修正）
- **行为变化**: 光荣记忆被动"终结技伤害+33.6%"从完全不生效变为可进入 simulation（trigger 近似映射）；望乡 effects 从无效 stat 修正为合法 stat（但 trigger 仍未识别）
- **可收口**: 四把武器基础面板数值（ATK + 词条 + passiveStats）全部正常；光荣记忆被动已接入
- **阶段性实现**: 狼之绯缺外部真值（baseAtk 估算，无被动数据）；落草 2 个 null slots + 1 个 `_unknown` trigger；望乡 trigger 仍 `_unknown`；光荣记忆 trigger 为近似
- **新真值源**: 无
- **下一步**: 本武器精修分支可收口。剩余 `_unknown` trigger 和 null slots 需要游戏内数据验证后更新 gamedata.json
