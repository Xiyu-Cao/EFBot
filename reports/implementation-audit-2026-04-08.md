# 未实现功能审计

日期: 2026-04-08（第四轮更新后）

---

## 一、技能效果（可用现有系统实现）

旧 TODO 中 9 项，8 项已完成，1 项未完成。

### 已完成
| 角色 | 效果 | 实现位置 |
|------|------|----------|
| POGRANICHNK | 战技按破防层梯度回 SP | carrierConsumptionHandlers `registerPograniSkillBreakSp` |
| POGRANICHNK | 连携技动态段数（1-3段变体） | gamedata.json variants + releaseConditions |
| ROSSI | 连携技消耗附着层→额外伤害 | carrierConsumptionHandlers `registerRossiLinkConsume` |
| ANTAL | 连携技触发条件映射 | gamedata link_trigger + projectLinkTriggerSeries |
| ANTAL | 连携技重新施加异常 | carrierConsumptionHandlers `registerAntalLinkReapply` |
| LASTRITE | 战技幻影追击伤害+SP | carrierConsumptionHandlers `registerLastritePhantom` |
| ARCLIGHT | 终结技强制导电 | carrierConsumptionHandlers `registerArclightUltForceConduction` |
| LAEVATAIN | 天赋灼心 4 层条件 | **本轮修复** — simulator.ts 跳过无条件 passive + watcher 正确 add/remove |

### 未完成
| 角色 | 效果 | 说明 | 复杂度 |
|------|------|------|--------|
| WULFGARD | 连携技延迟爆炸 | 投掷→延迟→爆炸→灼热附着。当前单 tick@0.9s 近似处理（标准路由已生效），精确延迟机制未实现 | 中 |

---

## 二、天赋

### 已实现（通过 talentConditionalRegistry，13 个）
AKEKURI(心流时间)、ALESH(闪冻锁鲜)、ARCLIGHT(荒野游人)、AVYWENNA(高效派送+委婉手段)、CHENQIANYU(斩锋)、DAPAN(勾芡)、ESTELLA(P5活着就是胜利)、LIFENG(伏魔)、PERLICA(歼灭协议)、POGRANICHNK(活着的旗帜)、ROSSI(斫痕)、WULFGARD(灼热獠牙)、XAIHI(启动进程)

### 已实现（其他路径，7 个）
| 角色 | 天赋 | 实现方式 |
|------|------|----------|
| LAEVATAIN | 灼心 resistance_ignore | **本轮修复** — runtime_passive 跳过 + 4层熔火 watcher 条件判定 |
| ENDMIN | 现实静滞 physical_dmg fragility | runtime_passive |
| LASTRITE | 低温症 | carrierConsumptionHandlers deferred trigger |
| LASTRITE | 低温脆性 | carrierConsumptionHandlers `registerLastriteColdBrittleness` |
| ROSSI | 沸血 | carrierConsumptionHandlers `registerRossiBoilingBlood` |
| POGRANICHNK | 战术教导 | carrierConsumptionHandlers talent_1 |
| ESTELLA | 同病相怜 | **本轮新增** — ANOMALY_DAMAGE(shatter) → charge → skill SP refund |

### 已实现（multiplierZones 被动，1 个）
| 角色 | 天赋 | 实现方式 |
|------|------|----------|
| FLUORITE | 落井下石 | multiplierZones.ts Special zone（检查 affix_slow + runtime_conditional） |

### 未实现（22 个）
| 角色 | 天赋 | 阻塞原因 |
|------|------|----------|
| EMBER | 陷阵之志（庇护30/50%） | 受击/护盾系统 |
| EMBER | 以铁还铁（受击→ATK叠层） | 受击系统 |
| CATCHER | 坚韧防线（意志→防御） | 防御系统 |
| CATCHER | 全局思维（ATK+30/45%） | runtime_conditional 未注册 |
| SNOWSHINE | 极地生存（低HP治疗加成） | HP 系统 |
| SNOWSHINE | 救援专家（格挡→能量） | 受击系统 |
| LAEVATAIN | 复燃（低HP→庇护+回复） | HP 系统 |
| ARCLIGHT | 众生智慧（概率免疫附着） | 概率系统 |
| ANTAL | 即兴发挥（增幅→HP回复） | HP 系统 |
| ANTAL | 下意识（概率免疫物理伤害） | 概率/受击系统 |
| CHENQIANYU | 破势（打断蓄力+失衡） | 蓄力打断机制 |
| DAPAN | 尝尝咸淡（终结技→备料） | 生成端已通过标准路由工作，消耗端已实现。需验证完整流程 |
| GILBERTA | 迟来的回信（最后一击→回HP） | HP/治疗系统 |
| PERLICA | 循环协议（破防弹射+1） | 需额外 hit 生成机制 |
| TANGTANG | 肝胆相照（涡流→速度光环） | 移动系统 |
| TANGTANG | 呼风唤浪（下落攻击→水龙卷） | 下落攻击机制 |
| XAIHI | 协议冻结 | runtime_conditional 未注册 |
| YVONNE | 科技连击（冻结→自动重击） | 自动操作机制 |
| ARDELIA | 朋友的身影（影子→回HP） | 召唤物/HP 系统 |
| ARDELIA | 山顶冲浪（腐蚀→二次施放） | 复杂触发 |
| ESTELLA | 惰性使然（免疫寒冷附着） | 免疫机制 |
| FLUORITE | 捉摸不定 | runtime_conditional 未注册 |

---

## 三、潜能

### 本轮新增实现
| 角色 | 潜能 | 实现 |
|------|------|------|
| LIFENG P1 | 破执（物理脆弱+5%） | simulator.ts Route 2.7 calcBreachPhysVulnerability 后追加 |
| ENDMIN P2 | 权能映射（ATK→队友半值） | carrierConsumptionHandlers 本质瓦解 self-buff 后分享 |
| GILBERTA 天赋0 | 信使的歌声（全队终结技效率+4/7%） | SpChangeHandler.ts 充能循环前计算 |

### 本轮（第二轮）新增实现
| 角色 | 潜能/天赋 | 实现 |
|------|----------|------|
| ANTAL P5 | 高规格技术（聚焦20s→脆弱+4%） | carrierConsumptionHandlers `registerAntalP5FocusTimer` |
| AVYWENNA P1 + 天赋0 | 筹码加倍 + 高效派送（雷枪命中→gauge） | carrierConsumptionHandlers `registerAvywennaLanceGauge` |
| DAPAN P5 | 猛火收汁（单目标→额外破防，ICD 45s） | carrierConsumptionHandlers `registerDapanP5ExtraBreak`。**TODO**: 单目标判定未实现，默认 always true |
| ALESH 天赋1 + P3 | 钓鳞老手（珍鳞概率）+ 愿者上钩（团队ATK+15%） | carrierConsumptionHandlers `registerAleshLinkRareFish`。概率=10%基础+智识缩放，不硬编码 |

### 仍未实现
| 角色 | 潜能 | 阻塞原因 |
|------|------|----------|
| LAEVATAIN P5 | 存在的证明（强化普攻×1.2+击杀延时） | 终结技模式/击杀系统 |
| ANTAL P3 | 源石理论应用（聚焦击杀→15SP） | 击杀事件 |
| ALESH P5 | 特大鳞讯（HP<50%→×1.5） | HP 跟踪 |
| FLUORITE P2 | 读心技巧（法术免疫概率+10%） | 概率/受击系统 |
| CHENQIANYU P1 | 绝影（敌人<50%HP→+20%） | HP 跟踪 |
| XAIHI P3 | 映射节点（连携弹射+1） | 额外 hit 生成 |
| XAIHI P4 | 灰度发布（治疗效率+10%） | 治疗系统 |
| EMBER P1/P3/P5 | 移动要塞/不屈阵线/铁誓 | 受击/护盾系统 |
| CATCHER P1/P3/P5 | 多重战备/不屈心锚/无悔抉择 | 受击/护盾系统 |
| SNOWSHINE P1/P5 | 失温庇护所/冰灾应对专家 | 受击系统 |
| ARDELIA P2/P3 | 游戏奖励/爆炸式喷发 | HP/召唤物系统 |
| ENDMIN P3-P5 | — | 游戏内不可获取 |

---

## 四、武器

总计 66 把，56 把有触发效果。

| 分类 | 数量 |
|------|------|
| 手写实现 | 6（典范/蚀迹/显赫声名/古渠/骁勇/迅极） |
| 自动注册成功 | 39 |
| **触发类型缺失（静默失效）** | **6**（本轮修复 1 把） |
| **stat/zone 映射失败** | **4**（本轮修复 bug，白夜新星 arts_dmg 不再被丢弃） |
| 无触发效果（纯属性） | 10 |

### 本轮修复
- **白夜新星 mapJsonEffects bug**: `return null` → `continue`，不可映射的 stat 不再导致整个数组丢弃。白夜新星的 `arts_dmg +33.6%` 现在正常生效
- **领航者 wpn_pistol_0005**: 新增 `condition_freeze_or_corrosion_on_field` trigger 映射（冻结/腐蚀条件检查）

### 仍有问题的触发类型（6 把）
| 武器 | 缺失触发 | 阻塞 |
|------|----------|------|
| 昔日精品 wpn_claym_0006 | `on_shielded_ally_damaged` | 护盾系统 |
| 大雷斑 wpn_claym_0007 | `on_link_heal` | 治疗系统 |
| 寻路者道标 wpn_lance_0003 | `condition_hp_above_80pct` | HP 系统 |
| 全自动骇新星 wpn_funnel_0001 | `condition_hp_above_80pct` | HP 系统 |
| 爆破单元 wpn_funnel_0010 | `on_skill_heal` | 治疗系统 |
| 布道自由 wpn_funnel_0012 | `on_skill_heal` | 治疗系统 |

### stat/zone 仍不可映射（3 把，白夜新星已修复）
| 武器 | 问题 |
|------|------|
| 负山 wpn_lance_0012 | `all_ability`（角色属性）不在 DynamicBonusStat |
| 同类相食 wpn_pistol_0009 | `element_dmg`（易伤）不在 DynamicBonusStat |
| O.B.J.重荷 wpn_claym_0015 | `defense`（角色属性）不在 DynamicBonusStat |

---

## 五、装备套装

21 套中已实现 12 套（57%）。

### 已实现（12 套）
| 套装 | 触发效果 | 备注 |
|------|----------|------|
| 点剑 | 物理异常→ATK×250%伤害+10失衡(ICD15s) | |
| 动火用 | 燃烧→灼热+50%；腐蚀→自然+50% | |
| 脉冲式 | 导电→电磁+50%；冻结→寒冷+50% | |
| 潮涌 | 附着≥2层→法术伤害+35%,15s | |
| M.I.警用 | 暴击→ATK+5%×5层,5s；满层额外暴击+5% | **本轮新增** |
| 拓荒 | SP恢复→全队伤害+16%,15s | **本轮新增** |
| 碾骨 | 连携技→下次战技+30%,最多2层(消耗) | **本轮新增** |
| 50式应龙 | 任意战技→连携+20%,最多3层(消耗) | **本轮新增** |
| 阿伯莉遗声 | 战技/连携/终结各+5%ATK,15s独立 | **本轮新增** |
| 轻超域 | 破防→物理+8%×4层,15s；4层破防额外+16%,10s | **本轮新增** |
| 天灾防护 | 战技→返50SP(每场1次) | **本轮新增** |
| 长息 | 施加增幅/脆弱→队友伤害+16%,15s | **本轮新增**(庇护/虚弱触发待系统) |

### 未实现（5 套，需 HP/治疗/受击系统）
| 套装 | 触发条件 | 阻塞 |
|------|----------|------|
| 蚀电屏蔽 | HP>80%→法术伤害+20% | HP 系统 |
| 巡行信使 | HP>80%→物理伤害+20% | HP 系统 |
| 重装信徒 | HP<50%→受伤-30% | HP+受伤系统 |
| 蚀电防护 | HP<50%→治疗+30% | HP+治疗系统 |
| 生物辅助 | 治疗后→目标受伤-15/30% | 治疗+受伤系统 |

### 无套装效果（4 套，无需实现）
武陵、四号谷地、集成轻型、集成重型

---

## 六、阻塞系统汇总

| 阻塞系统 | 阻塞项数 | 说明 |
|----------|---------|------|
| 受击/护盾/防御 | ~22 | EMBER/CATCHER/SNOWSHINE 全部机制 + 多个天赋/潜能/武器 |
| HP 跟踪 | ~5 | CHENQIANYU P1、ALESH P5、XAIHI P4 等 |
| 终结技模式 | ~2 | LAEVATAIN P5、YVONNE 科技连击 |
| 击杀事件 | ~2 | ANTAL P3、ALESH 终结技 |
| 概率系统 | ~1 | FLUORITE P2 |
| 召唤物/区域 | ~3 | ARDELIA 影子、TANGTANG 水龙卷 |
| 跨角色效果 | ~1 | GILBERTA 迟来的回信 |
| 额外 hit 生成 | ~2 | XAIHI P3、PERLICA 循环协议 |
| 装备套装(HP/治疗) | 5 套 | 蚀电屏蔽/巡行信使/重装信徒/蚀电防护/生物辅助 |

---

## 七、本轮完成项目汇总

### 第一轮
| 项目 | 变更文件 |
|------|----------|
| LAEVATAIN 灼心 4 层条件修复 | simulator.ts + carrierConsumptionHandlers.ts |
| FLUORITE 落井下石 | 已在 multiplierZones.ts 中实现（确认无需修改） |
| LIFENG P1 破执 +5% | simulator.ts Route 2.7 |
| GILBERTA 信使的歌声 +4/7% | SpChangeHandler.ts |
| ENDMIN P2 权能映射 | carrierConsumptionHandlers.ts |
| ESTELLA 同病相怜 | AnomalyHandlers.ts + carrierConsumptionHandlers.ts |
| 白夜新星 mapJsonEffects bug | weaponDataAdapter.ts |
| 领航者 trigger | weaponDataAdapter.ts |
| WULFGARD 连携技 | 已通过标准路由工作（确认无需修改） |
| DAPAN 备料 | 已通过标准路由+消耗 handler 工作（确认无需修改） |

### 第二轮
| 项目 | 变更文件 | 备注 |
|------|----------|------|
| ANTAL P5 高规格技术 | carrierConsumptionHandlers.ts | 聚焦 20s → 脆弱 +4% |
| AVYWENNA 天赋0 高效派送 + P1 | carrierConsumptionHandlers.ts | 雷枪命中 → gauge 3/4(+P1 2) |
| DAPAN P5 猛火收汁 | carrierConsumptionHandlers.ts | **TODO**: 单目标判定默认 true |
| ALESH 天赋1 钓鳞老手 + P3 愿者上钩 | carrierConsumptionHandlers.ts | 概率=10%+智识缩放，不硬编码 |

### 第三轮（装备套装触发效果）
| 项目 | 变更文件 |
|------|----------|
| M.I.警用 | definitions.ts + registry.ts |
| 拓荒 | definitions.ts + registry.ts |
| 碾骨 | definitions.ts + registry.ts |
| 50式应龙 | definitions.ts + registry.ts |
| 阿伯莉遗声 | definitions.ts + registry.ts |
| 轻超域 | definitions.ts + registry.ts |
| 天灾防护 | definitions.ts + registry.ts |
| 长息（部分） | definitions.ts + registry.ts（庇护/虚弱触发待系统） |

### 第四轮（套装常驻属性自动注入）
| 项目 | 变更文件 |
|------|----------|
| 全 21 套 passiveStats 数据 | gamedata.json equipmentCategoryConfigs |
| 套装常驻属性自动注入逻辑 | timelineStore.js resolveTrackConfiguredStats |
