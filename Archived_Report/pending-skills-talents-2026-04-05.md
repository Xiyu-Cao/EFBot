# 待处理技能与天赋清单

日期: 2026-04-05

---

## 依赖受击系统

需要设计敌方攻击机制后才能实现。

### 技能
| 角色 | 技能 | 效果 |
|------|------|------|
| CATCHER | 战技 刚性阻击 | 立盾受击→反击+破防（break 路由已实现，触发条件待受击） |
| CATCHER | 连携技 即时压制 | 主控血量<40% 触发；护盾（防御力缩放） |
| EMBER | 战技 进军 | 受击→额外失衡 |
| EMBER | 连携��� 前线援护 | 主控受伤触发；护盾+治疗（意志缩放） |
| EMBER | 终结技 重燃誓约 | 全队护盾（生命值缩放） |
| SNOWSHINE | 战技 饱和性防御 | 受击→反击+寒冷附着 |
| SNOWSHINE | 连携技 极地救援 | 主控血量<60%→治疗（意志缩放） |

### 天赋
| 角色 | 天赋 | 效果 |
|------|------|------|
| EMBER | 以铁还铁 | 受击→ATK+6/9%×3层 |
| CATCHER | 全局思维 | 终结技最后一击产生冲击波 |
| FLUORITE | 捉摸不定 | 20%概率免疫法术伤害→ATK buff |

### 潜能
| 角色 | 潜能 | 效果 |
|------|------|------|
| CATCHER P1 | 多重战备 | ��技/终结技命中→额外[300+防御力×5.0]物理伤害 |
| CATCHER P5 | 无悔抉择 | 存在护盾+战技命中→返还10SP |
| EMBER P1 | 移动要塞 | 庇护+20%，命中后额外持续1.5s |
| EMBER P3 | 不屈阵线 | 连携技额外治疗最低血量队友 |
| EMBER P5 | 铁誓 | 护盾×1.2，护盾期间ATK+10% |
| SNOWSHINE P1 | 失温庇��所 | 格挡期间友方免疫法术附着 |
| SNOWSHINE P5 | 冰灾应对专家 | 反击命中→返还10SP |

---

## 依赖召唤物/区域系统

需要独立实体（位置、生命周期、伤害 tick）机制。

| 角色 | 效果 |
|------|------|
| GILBERTA | 战技引力奇点（持续拉扯+伤害+自然附着） |
| FLUORITE | 战技粘性炸弹（缓速30%+延迟爆炸+最多1个） |
| FLUORITE | 连携技连锁爆炸（2层附着条件+重新附着） |
| FLUORITE | 终结技提前引爆（增强30%） |
| SNOWSHINE | 终结技冰域（持续寒冷伤害+强制冻结） |
| YVONNE | 连携技速冻仔（3s+4段+拉扯+自爆冻结） |
| ARDELIA | 天赋朋友的身影（影子实体+触碰治疗） |

---

## 依赖终结技模式系统

临时强化状态，替换/增强普攻行为。

| 角色 | 效果 |
|------|------|
| LAEVATAIN | 终结技黄昏（300SP强化模式，强化普攻，第3段施加灼热附着） |
| YVONNE | 终结技冷冻射手（7s强化模式，暴击叠层最多10层+满层暴伤+60%） |

注: LASTRITE 临终别礼已确认为纯伤害技能，无需模式系统。

---

## 依赖其他机制

### 击杀事件
| 角色 | 效果 |
|------|------|
| ALESH | 终结技击杀回SP（有上限） |
| ANTAL P3 | 聚焦期间击杀→返还15SP |

### 概率判定
| 角色 | 效果 |
|------|------|
| ALESH | 连携技珍鳞10%概率 |
| FLUORITE | 天赋捉摸不定20%法术免疫 |

### 跨角色事件
| 角色 | 效果 |
|------|------|
| ENDMINISTRATOR | 连携技触发条件：其他干员连携技造成伤害时 |
| POGRANICHNK | 天赋战术教导：盟友终结技触发时获得士气激昂 |

---

## 潜能参数修正（potentialModifiers.ts 已实现 ✅ / 待实现）

参数修正系统已实现 (`simulation/data/potentialModifiers.ts`)，含三个注册表 + 注入点。

### 倍率提升（×N）
| 角色 | 潜能 | 效果 |
|------|------|------|
| ANTAL P1 | 术法天分 | 终结技增幅效果×1.1 | ✅ buff value ×1.1 |
| ANTAL P5 | 高规格技术测试 | 聚焦20s后脆弱+4% |
| ARCLIGHT P3 | "歌谣" | 荒野游人增伤×1.3 | ✅ bonusOverride |
| ARCLIGHT P5 | 荒野的徒从 | 荒野游人触发次数降至2次 | ✅ conditionFactory |
| AVYWENNA P5 | 恩威并施 | 雷枪命中电磁脆弱目标伤害×1.15 |
| CHENQIANYU P1 | "绝影" | 对<50%血量敌人伤害+20% |
| CHENQIANYU P3 | 双剑奇侠 | 战技/连携技/终结技倍率×1.1 | ✅ multiplierRegistry |
| ESTELLA P3 | ���后工作 | 战技首个命中伤害+40% |
| GILBERTA P5 | 特别信件 | 连携技倍率×1.3+CD-2s | ✅ multiplier+CD |
| LAEVATAIN P1 | 熔火之心 | 追加攻击倍率×1.2（SP部分已实现） |
| LAEVATAIN P3 | 往事碎片 | 燃烧持续+50%，燃烧伤害×1.5 | ✅ duration+specialZone |
| LAEVATAIN P5 | 存在的证明 | 终结技强化普攻×1.2+击杀延时 |
| LASTRITE P1 | 守��人之赠 | 低温灌注重击额外+20%伤害+5失衡 |
| LASTRITE P3 | 统御严冬 | 连携技/终结技倍率×1.15 | ✅ multiplierRegistry |
| LASTRITE P5 | 寒风再起 | 战技返还+5SP+幻影倍率×1.2 |
| TANGTANG P3 | 当家气魄 | 战技倍率×1.1+法术脆弱+5% | ✅ multiplierRegistry |
| TANGTANG P5 | 魔眼效能 | 终结技倍率×1.15+水龙卷伤害+80% | ✅ multiplierRegistry (倍率部分) |
| XAIHI P1 | 敏捷实践 | ���术增幅额外+5% |
| XAIHI P5 | 可控递归 | 终结技增幅×1.1 | ✅ buff value ×1.1 |
| ALESH P5 | 特大鳞讯 | 终结技命中<50%血量目标倍率×1.5 |

### 持续时间修正
| 角色 | 潜能 | 效果 |
|------|------|------|
| AVYWENNA P2 | 大棒悬头 | 雷枪存在时��+20s |
| DAPAN P2 | 五味调和 | 备料持续+10s，最大层数+1 | ✅ 持续部分 |
| ESTELLA P1 | 习惯性延误 | 连携技物理脆弱持续+3s | ✅ |
| PERLICA P1 | 危机处理 | 连携技导电持续+75% | ✅ |
| SNOWSHINE P3 | 极地生存指南 | 终结技冻结持续+2s | ✅ |
| ARDELIA P3 | 爆炸式喷发 | 终结技持续+1s |
| LAEVATAIN P3 | 往事碎片 | 燃烧持续+50% |
| CATCHER P3 | 不屈心锚 | 护盾持续+5s |

### 冷却修正
| 角色 | 潜能 | 效果 |
|------|------|------|
| CHENQIANYU P5 | 心兼人间 | 连携技CD-3s | ✅ |
| GILBERTA P5 | 特别信件 | 连携技CD-2s |
| POGRANICHNK P5 | 新铸剑锋 | 连携技CD-2s+SP恢复×1.2 | ✅ CD部分 |
| TANGTANG P1 | 财宝储备 | 连携技CD-2s（倍率+SP部分已实现） | ✅ |
| ARDELIA P5 | 火山蒸汽 | 连携技CD-2s+倍率×1.2+腐蚀持续+4s | ✅ 全部 |

### SP/能量相关
| 角色 | 潜能 | 效果 |
|------|------|------|
| POGRANICHNK P1 | 阵线扫荡 | 命中≥2敌人→返还15SP |
| POGRANICHNK P3 | 战旗飘扬时 | 士气激昂所需SP降至60+层数+2 |
| YVONNE P1 | 速冻帮手 | 连携技额外15终结技能量 |
| YVONNE P4 | 叛逆心情 | 战技仅命中单目标→返还10SP |
| AVYWENNA P1 | 筹码加倍 | 终结技能量+2点 |
| ESTELLA P5 | 活着就是胜利 | 冻结→5终结技能量(ICD 1s) | ✅ talentConditionalRegistry |
| GILBERTA P3 | 轻盈脚步 | 终结技充能效率+5% |

### 复合/条件效果
| 角色 | 潜能 | 效果 |
|------|------|------|
| AKEKURI P1 | 正向反馈 | 技能恢复SP后ATK+10%×5层 | ✅ talentConditionalRegistry |
| AKEKURI P3 | 全力协作 | 终结技期间全队ATK+10% |
| AKEKURI P5 | 残心节奏 | 连击在终结技结束后持续5s |
| ALESH P3 | 愿者上钩 | 连携技珍鳞→全队ATK+15%/10s |
| ARDELIA P1 | 羊的乐园 | 战技消耗腐蚀后脆弱+8% | ✅ builtinBoundEffects |
| PERLICA P3 | 监督重任 | 施加导电→ATK+20%×2层/5s | ✅ talentConditionalRegistry |
| ARDELIA P2 | 游戏奖励 | 天赋加强：额外治疗 |
| DAPAN P5 | 猛火收汁 | 单目标命中→额外破防(ICD 45s) |
| ENDMINISTRATOR P2 | 权能映射 | 自身ATK提升时队友获得一半 |
| FLUORITE P2 | 读心技巧 | 法术免疫概率+10% |
| FLUORITE P3 | 三倍惊喜 | 炸弹爆炸→缓速扩散6s |
| FLUORITE P5 | 享受混乱 | 寒冷/自然附着→连携技CD-1s(ICD 1s) |
| GILBERTA P1 | 云层之上 | 战技范���+20% |
| GILBERTA P2 | 乘风而行 | 终结技破防加成加倍+视为额外1层 | ✅ carrierConsumptionHandlers |
| LIFENG P1 | 破执 | 物理脆弱+5%+≤2层破防也触发 |
| LIFENG P5 | 不懈 | 伏魔每15s额外ATK250%+5失衡 | ✅ talentConditionalRegistry |
| PERLICA P4 | 长效导流 | 导电法术伤害提高×1.33 |
| WULFGARD P3 | 狩猎时刻 | 灼热獠牙下触发额外效果→刷新+队友获得50% | ✅ carrierConsumptionHandlers |
| WULFGARD P5 | 天生掠食者 | 终结技后刷新连携技CD | ✅ carrierConsumptionHandlers |
| XAIHI P3 | 映射节点 | 连携技弹射1次 |
| YVONNE P3 | 嘀嗒充能 | 暴击伤害+10%(寒冷)+冻结加倍 |
| SNOWSHINE P2 | 暴风雪地带 | 终结技范围+20% |

### 不可获取
| 角色 | 潜能 | 备注 |
|------|------|------|
| ENDMINISTRATOR P3-5 | ？？？ | 游戏内不可获取 |
