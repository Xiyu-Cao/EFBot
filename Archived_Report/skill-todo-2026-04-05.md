# 技能效果待办清单（更新）

日期: 2026-04-05

上一轮已完成：ENDMIN 终结技消耗结晶、ROSSI 暴击 buff（crit zone）、ROSSI 终结技暴伤、GILBERTA 破防层加成、LAEVATAIN 战技燃烧、XAIHI 智识加成。暴击系统已改造为 real/expected 双模式。

---

## 可用现有系统扩展（剩余）

| # | 角色 | 效果 | 说明 | 复杂度 |
|---|------|------|------|--------|
| 1 | POGRANICHNK | 战技按破防层梯度回 SP | 消耗1/2/3/4层→5/10/20/30 SP。需在碎甲消耗时读取层数 | 低 |
| 2 | POGRANICHNK | 连携技动态段数 | 按消耗破防层数决定 1-3 段，4 层强化第 3 段 | 中 |
| 3 | ROSSI | 连携技消耗附着层→额外伤害 | 消耗法术附着，每层 80-180% 额外伤害 | 中 |
| 4 | ANTAL | 连携技触发条件映射 | 聚焦目标进入物理异常/法术附着时触发 | 低 |
| 5 | ANTAL | 连携技重新施加异常 | 命中后重新对目标施加该物理异常/法术附着 | 中 |
| 6 | LAEVATAIN | 天赋灼心 4 层条件 | runtime_passive 当前无条件生效，需检查 magma≥4 | 低 |
| 7 | WULFGARD | 连携技延迟爆炸 | 投掷→延迟→爆炸→灼热附着（延迟机制） | 中 |
| 8 | LASTRITE | 战技幻影追击伤害+SP | 低温灌注消耗→幻影追击伤害+寒冷附着+返还30SP | 中 |
| 9 | ARCLIGHT | 终结技强制导电 | 消耗电磁附着→强制施加导电 | 低 |

## 暂缓（依赖未实现系统）

### 依赖受击系统
| 角色 | 效果 |
|------|------|
| CATCHER | 战技受击反击+破防；连携技血量<40%+护盾 |
| EMBER | 战技受击失衡；连携技受伤→护盾+治疗；终结技全队护盾 |
| SNOWSHINE | 战技受击反击；连携技血量<60%→治疗 |

### 依赖附着层消耗+按层缩放
| 角色 | 效果 |
|------|------|
| ALESH | 战技消耗寒冷附着层→冻结+按层 SP |
| LASTRITE | 连携技消耗全部寒冷附着→按层伤害+能量 |
| YVONNE | 战技消耗附着层→冻结+按层伤害/能量 |

### 依赖新子系统
| 系统 | 角色/效果 |
|------|----------|
| 召唤物/区域 | GILBERTA 引力奇点, FLUORITE 炸弹, SNOWSHINE 冰域, YVONNE 速冻仔, ARDELIA 多利影子 |
| 终结技模式 | LAEVATAIN 黄昏, LASTRITE 临终别礼, YVONNE 冷冻射手 |
| 治疗/护盾 | EMBER, SNOWSHINE, XAIHI, ARDELIA, CATCHER |
| 暴击追踪(isCrit) | ROSSI 沸血 |
| 击杀事件 | ALESH 终结技回 SP, ANTAL 聚焦击杀返 SP |
| 概率判定 | ALESH 珍鳞 10%, FLUORITE 法术免疫 20% |

### 天赋暂缓
| 角色 | 天赋 | 原因 |
|------|------|------|
| LASTRITE | 低温症 | 待连携技消耗附着机制 |
| LASTRITE | 低温脆性 | 待乘算放大机制 |
| ROSSI | 沸血 | 待 isCrit 事件字段 |
| POGRANICHNK | 战术教导 | 跨角色终结技触发 |
| DAPAN | 尝尝咸淡 | 动态冷却恢复 |
| 受击相关天赋 | EMBER/CATCHER/SNOWSHINE/FLUORITE | 待受击系统 |
| 新子系统天赋 | GILBERTA/ARDELIA/TANGTANG/YVONNE/AKEKURI/PERLICA/ESTELLA | 治疗/实体/光环等 |
