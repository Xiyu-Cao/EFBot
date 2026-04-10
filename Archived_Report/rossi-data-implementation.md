# ROSSI + 狼之绯 最小补数实施报告

---

## 1. 本轮实际修改文件

| 文件 | 改动 |
|---|---|
| `src/data/operators/ROSSI/meta.json` | 从空壳补齐：profession=guard, mainAttribute=agility, subAttribute=intellect, nameEn=Rossi, 所有 icon 路径 |
| `src/data/operators/ROSSI/stats.json` | 从 0 级补齐为完整 90 级属性表（wiki full table 抓取） |
| `src/data/operators/ROSSI/skills.json` | 从空壳补齐：4 技能名称 + wiki 完整 12 级倍率表（attack 7 行, skill 4 行, link 8 行, ultimate 6 行） |
| `src/data/operators/ROSSI/talents.json` | 从空补齐：mainAttribute/subAttribute + 2 天赋条目含分阶段描述 |
| `src/data/operators/ROSSI/ability-expansion.json` | unlocks 填充（talent_0 at E1, talent_1 at E2） |
| `public/gamedata.json` | ROSSI: 补 skill_icon/link_icon/ultimate_icon 路径；狼之绯: 补 baseAtk=495 |

## 2. ROSSI 数据补齐结果

| 字段 | 补齐状态 | 数据来源 |
|---|---|---|
| 基础信息（profession/element/mainAttr） | ✅ 完整 | warfarin.wiki 基础表 |
| 90 级属性表 | ✅ 完整（90 级） | warfarin.wiki 完整等级表 |
| 4 技能名称/倍率表 | ✅ 完整（12 级 R1~M3） | warfarin.wiki 技能表 |
| 天赋文本 | ✅ 完整（2 天赋各 2 阶段） | warfarin.wiki 天赋描述 |
| 技能图标路径 | ✅ 补齐（gamedata + meta） | avatars 目录已有文件 |

### 仍为阶段性占位

| 项目 | 状态 | 原因 |
|---|---|---|
| 天赋 runtime 机制（斫痕 DOT + 增伤） | 文本已接入，runtime 未实现 | 归 C 分支 |
| 天赋 runtime 机制（沸血暴击追加伤害） | 文本已接入，runtime 未实现 | 归 C 分支 |
| 技能描述文本 | 空字符串 | wiki 描述提取需更精细解析，不阻塞主路径 |

## 3. 狼之绯补齐结果

| 字段 | 值 | 确认/估算 |
|---|---|---|
| baseAtk | 495 | **估算**（6 星剑范围 490-510，取中位数。wiki 无此武器页面） |
| commonSlots | agility(large) + crit_rate(large) | 已有，未改 |
| passiveStats | {} | 未补（wiki 无数据，不伪造） |
| triggeredBuffs | [] | 未补（wiki 无数据，不伪造） |
| buffName | "" | 未补（wiki 无数据） |

## 4. 链路变化

| 环节 | 修改前 | 修改后 |
|---|---|---|
| `resolveBaseStats('ROSSI', 90)` | null（levels 为空） | `{strength:97, agility:176, intellect:118, will:89, attack:323, hp:5495}` |
| `resolveTrackConfiguredStats` | primary_ability=0 | primary_ability=176+天赋row1加成 |
| `getSkillMultiplierFromData('ROSSI','skill',12)` | undefined | 1.92（第一段192%，2 tick 1:1 mapping） |
| `hasSkillsJsonMultiplier('ROSSI','skill')` | false → unsupported | true → **wip** |
| DamageSummary ROSSI skill | 0 伤害 + "未支持" | 非零伤害 + "处理中" |
| 装备狼之绯 | baseAtk=undefined → ATK=NaN | baseAtk=495 → ATK=125(Lv1)~495(Lv90) |

### 预期前端可见变化
- ROSSI 技能方块 tag: "未支持" → "处理中"
- DamageSummary: ROSSI 从 0 伤害变为非零伤害
- 装备狼之绯: 武器攻击力正常显示
- 能力值面板: ROSSI 基础属性从全 0 变为真实值

## 5. 边界控制

**本轮明确没做**:
- 没有实现 ROSSI 天赋 runtime 机制
- 没有实现狼之绯被动/触发效果
- 没有改动其他角色数据
- 没有改动 simulation/runtime 代码
- 没有改动 skillStatusRegistry 或 UI 组件

**是否引入新真值源**: **否**。所有数据走现有 operator folder + gamedata.json 主路径。

## 6. 剩余问题

| 项目 | 归属 |
|---|---|
| ROSSI 天赋斫痕 DOT（每秒 ATK×25%/30% 物理伤害） | C 分支角色专属 |
| ROSSI 天赋斫痕增伤（物理+灼热伤害 +6%/+12%） | C 分支角色专属 |
| ROSSI 天赋沸血（暴击追加灼热伤害） | C 分支角色专属 |
| 狼之绯 baseAtk 精确值 | 需游戏内验证 |
| 狼之绯 被动/触发效果 | E 分支武器数据 |
| ROSSI 潜能效果 | 潜能系统（未实现） |
| ROSSI 技能描述文本 | 低优先级数据完善 |

## 7. 给主会话的收口摘要

1. **分类**: 小型数据补缺 — ROSSI + 狼之绯
2. **改了哪些文件**: ROSSI 5 个 operator folder 文件（从空壳补齐为完整数据）+ gamedata.json（ROSSI 图标 + 狼之绯 baseAtk）
3. **行为变化**: ROSSI 从"全部未支持/0 伤害/0 属性"变为"处理中/有伤害/有属性"；狼之绯从 baseAtk=undefined 变为可用
4. **可收口**: ROSSI 基础数据补齐完成，可被现有主路径消费
5. **阶段性实现**: 天赋 runtime 机制未实现（文本已入）；狼之绯 baseAtk 为估算值；技能描述文本为空
6. **新真值源**: 无
7. **下一步**: 如需 ROSSI 天赋效果 → C 分支；如需狼之绯精确数据 → 游戏内验证
