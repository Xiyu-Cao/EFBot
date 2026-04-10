# 未归类 Effect 全量审计报告

> 日期：2026-04-03
> 类型：全量审计 — 待人工标注清单

---

## 一、Talent Effects：runtime_conditional 已结构化但未接入 registry

现有 registry 已接入：WULFGARD / CHENQIANYU / POGRANICHNK。
以下为**有结构化数据、scope=runtime_conditional、但未注册到 talentConditionalRegistry** 的条目。

### 1.1 gauge_modifier 类（无 runtime 消费路径）

| # | 角色 | 天赋 | 效果 | 描述 | 无法归类原因 | 候选归类 | 优先级 |
|---|------|------|------|------|-------------|---------|--------|
| 1 | ALESH | 闪冻锁鲜 | gauge_modifier/ult_gauge_gain/3→4 | 附近敌人冻结或被结晶后获得终结技能量，自身冻结额外+6→8，3s ICD | mapEffectToBonus 不支持 gauge_modifier；无 gauge runtime 修改路径 | gauge / self resource | 低 |
| 2 | AVYWENNA | 高效派送 | gauge_modifier/ult_gauge_gain/3→4 | 雷枪命中获得终结技能量 | 同上 | gauge / self resource | 低 |

### 1.2 实际是"额外伤害实例"但数据标注为 stat_bonus

| # | 角色 | 天赋 | 效果 | 描述 | 无法归类原因 | 候选归类 | 优先级 |
|---|------|------|------|------|-------------|---------|--------|
| 3 | CATCHER | 全局思维 | stat_bonus/attack_percent/30→45% | 终结技最后一击产生2→3次**冲击波**，每次造成 ATK 30→45% 物理伤害 | 描述是额外伤害实例，不是 ATK% buff。数据 type 标注与语义不匹配 | extra hit / extra damage | 低 |
| 4 | LIFENG | 伏魔 | stat_bonus/attack_percent/50→100% | 造成倒地时**额外造成** ATK 50→100% 物理伤害 | 同上，是额外伤害不是 buff | extra hit / extra damage | 低 |

### 1.3 触发条件需要当前不存在的事件

| # | 角色 | 天赋 | 效果 | 描述 | 无法归类原因 | 候选归类 | 优先级 |
|---|------|------|------|------|-------------|---------|--------|
| 5 | EMBER | 以铁还铁 | stat_bonus/attack_percent/6→9% | 受到敌人伤害后 ATK+6→9%，7s，max 3 | 无 incoming damage 事件 | self buff (on-hit-received) | 中 |
| 6 | FLUORITE | 捉摸不定 | stat_bonus/attack_percent/10→20% | 20%概率免疫法术伤害后 ATK+10→20%，10s | 无 incoming damage + RNG proc | self buff (proc) | 低 |

### 1.4 触发条件涉及角色专属机制（未建模）

| # | 角色 | 天赋 | 效果 | 描述 | 无法归类原因 | 候选归类 | 优先级 |
|---|------|------|------|------|-------------|---------|--------|
| 7 | ENDMINISTRATOR | 本质瓦解 | stat_bonus/attack_percent/15→30% | 源石结晶被消耗后 ATK+15→30%，15s | endmin_debuff（结晶）未建模，无消耗事件 | self buff (on unique mechanic) | 中 |
| 8 | DAPAN | 勾芡 | damage_bonus/physical_dmg/4→6% | 每消耗1层破防后物理伤害+4→6%，10s，max 4 | DAPAN 自身不产出 armorBreak；"消耗破防层"需 conditionFactory 检测 break 清除 + consumed count 无法获取 | self buff (on break clear) | 高 |

### 1.5 涉及复杂多层机制

| # | 角色 | 天赋 | 效果 | 描述 | 无法归类原因 | 候选归类 | 优先级 |
|---|------|------|------|------|-------------|---------|--------|
| 9 | ROSSI | 斫痕 | stat_bonus/attack_percent/25→30% | 战技命中→施加爪印斫痕（DoT + 物理&灼热增伤6→12%）| DoT tick + enemy debuff + 持续时间追踪 | enemy debuff + DoT | 低 |
| 10 | ROSSI | 沸血 | stat_bonus/attack_percent/12→24% | 对爪印斫痕目标暴击时额外灼热伤害 | 需要 crit 触发 + 目标状态检查 + 额外伤害 | extra hit (conditional) | 低 |

---

## 二、Talent Effects：runtime_passive 已结构化

已由 simulator.ts 的 runtime_passive 循环处理（永久 buff）。

| # | 角色 | 天赋 | 效果 | 描述 | 当前实现 | 准确性 | 候选归类 | 优先级 |
|---|------|------|------|------|---------|--------|---------|--------|
| 11 | LAEVATAIN | 灼心 | resistance_ignore/10→15→20 | 吸收4层灼热附着后无视灼热抗性，20s | 永久 resistance zone buff | **偏差**：应是条件触发（需吸收4层），当前是永久 | self buff (conditional → 永久近似) | 中 |
| 12 | ENDMINISTRATOR | 现实静滞 | damage_bonus/physical_dmg/10→20% | 附着结晶的敌人受物理伤害+10→20% | 永久 fragility zone buff | **偏差**：应仅在敌人有结晶时生效，当前永久 | enemy debuff (conditional → 永久近似) | 中 |
| 13 | XAIHI | 启动进程 | damage_bonus/cold_dmg/7→10% | 连携技命中有寒冷附着/冻结目标，寒冷伤害+7→10%，5s | 永久 fragility zone buff | **偏差**：应仅在连携技命中+目标有冷附着时触发，5s 持续 | enemy debuff (conditional → 永久近似) | 中 |

---

## 三、Talent Effects：parsed_unimplemented 全量

以下天赋阶段的 effects 数组仅含 `parsed_unimplemented`，需人工审读描述后决定归类。

### 3.1 语义比较清楚：可降级为简单 buff/debuff

| # | 角色 | 天赋 | 描述 | 语义判断 | 候选归类 | 优先级 |
|---|------|------|------|---------|---------|--------|
| 14 | PERLICA | 歼灭协议 | 对失衡敌人伤害+20→30% | 对 broken 目标增伤 | self buff (conditional on target broken) — 已有 broken_dmg_bonus stat | **高** |
| 15 | AVYWENNA | 委婉手段 | 终结技命中施加6→10%电磁脆弱，10s | 敌方电磁脆弱 debuff | enemy debuff (emag fragility) | **高** |
| 16 | FLUORITE | 落井下石爱好者 | 对缓速目标伤害+10→20% | 对缓速目标增伤 | self buff (conditional on slow) | 中 |
| 17 | YVONNE | 冰点 | 对寒冷附着目标暴击伤害+10→20%；冻结加倍 | 条件暴伤增加 | self buff (crit dmg conditional) | 中 |
| 18 | LIFENG | 顿悟 | 每点智识和意志使 ATK+0.10→0.15% | 属性缩放的攻击力加成 | self buff (static, attribute-scaling) | 中 |
| 19 | CATCHER | 坚韧防线 | 每10点意志防御力+1.0→1.2 | 属性缩放防御 | self buff (static, defensive) | 低 |

### 3.2 涉及技力/SP 返还

| # | 角色 | 天赋 | 描述 | 语义判断 | 候选归类 | 优先级 |
|---|------|------|------|---------|---------|--------|
| 20 | ESTELLA | 同病相怜 | 触发碎冰后下次战技返还7.5→15技力 | SP refund on next skill | SP modifier / self resource | 中 |
| 21 | WULFGARD | 节制准则 | 战技消耗法术异常时返还5→10技力 | SP refund on anomaly consume | SP modifier / self resource | 中 |

### 3.3 涉及治疗/庇护（防御性）

| # | 角色 | 天赋 | 描述 | 语义判断 | 候选归类 | 优先级 |
|---|------|------|------|---------|---------|--------|
| 22 | ANTAL | 即兴发挥 | 增幅状态队友技能伤害后回复 HP，30s ICD | 被动治疗 | team heal (conditional) | 低 |
| 23 | ANTAL | 下意识 | 30%概率免疫物理伤害+自愈 | 防御+治疗 proc | self buff (defensive) | 低 |
| 24 | EMBER | 陷阵之志 | 战技/连携技期间 30→50% 庇护 | 减伤 buff | self buff (during skill) | 低 |
| 25 | LAEVATAIN | 复燃 | HP<40%时 90% 庇护+每秒5%回复，120s CD | 紧急减伤+治疗 | self buff (emergency) | 低 |
| 26 | SNOWSHINE | 极地生存 | 对低 HP 目标治疗+15→25% | 治疗增幅 | self buff (healing) | 低 |
| 27 | GILBERTA | 迟来的回信 | 命中2+敌人后治疗主控 | 条件治疗 | team heal (conditional) | 低 |
| 28 | ARDELIA | 朋友的身影 | 技能生成治疗实体（多利先生影子）| 持续实体+治疗 | summon / persistent entity | 低 |

### 3.4 涉及终结技充能

| # | 角色 | 天赋 | 描述 | 语义判断 | 候选归类 | 优先级 |
|---|------|------|------|---------|---------|--------|
| 29 | GILBERTA | 信使的歌声 | 近卫/术师/辅助终结技充能效率+4→7% | 全队 gauge 加速 | team buff (gauge) | 低 |
| 30 | SNOWSHINE | 救援专家 | 格挡后获得终结技能量6→10 | gauge gain on block | gauge / self resource | 低 |

### 3.5 涉及召唤/持续实体/领域

| # | 角色 | 天赋 | 描述 | 语义判断 | 候选归类 | 优先级 |
|---|------|------|------|---------|---------|--------|
| 31 | ARDELIA | 山顶冲浪 | 战技触发额外效果后对腐蚀敌人再发动一次战技 | 额外技能发动 | extra skill activation | 低 |
| 32 | TANGTANG | 肝胆相照 | 涡流范围内友方加速+敌方缓速 | 领域 buff/debuff | AoE team buff + enemy debuff | 低 |
| 33 | TANGTANG | 呼风唤浪 | 下落攻击消耗涡流生成水龙卷，伤害+40→60% | 涡流消耗+增伤 | summon + damage amp | 低 |

### 3.6 涉及专属 mark/状态

| # | 角色 | 天赋 | 描述 | 语义判断 | 候选归类 | 优先级 |
|---|------|------|------|---------|---------|--------|
| 34 | AKEKURI | 心流时间 | 终结技期间获得连击 | 技能期间特殊状态 | self buff (during ultimate) | 低 |
| 35 | ALESH | 钓鳞老手 | 每10点智识使连携技钓起珍鳞概率+0.2→0.5% | 属性缩放 proc 概率 | self buff (proc chance) | 低 |
| 36 | AKEKURI | 胜利喝彩 | 每10点智识连携技技力恢复量+1.0→1.5% | 属性缩放 SP 恢复 | self buff (SP scaling) | 低 |
| 37 | LASTRITE | 低温症 | 消耗法术附着后施加寒冷脆弱（层数×2→4%），15s | 条件 enemy debuff | enemy debuff (cold fragility) | 中 |
| 38 | LASTRITE | 低温脆性 | 终结技对寒冷脆弱目标效果×1.2→1.5 | 条件伤害倍增 | self buff (conditional multiplier) | 中 |
| 39 | YVONNE | 科技连击 | 冻结后下次普攻变重击（+50%伤害） | 下次攻击强化 | self buff (next-attack enhance) | 低 |
| 40 | XAIHI | 协议冻结 | 终结技额外净化全队寒冷附着/冻结 | 团队净化 | team cleanse | 低 |
| 41 | CHENQIANYU | 破势 | 打断蓄力额外失衡5→10 | 条件额外失衡 | stagger bonus (conditional) | 低 |
| 42 | POGRANICHNK | 战术教导 | 队友终结技后续效果后也获得士气激昂5→10s | 团队 buff 扩展 | team buff (morale share) | 低 |
| 43 | PERLICA | 循环协议 | 连携技命中破防目标额外弹射1次 | 额外打击 | extra hit (conditional) | 低 |
| 44 | ESTELLA | 惰性使然 | 不受寒冷附着+寒冷伤害-10→20% | 免疫+减伤 | self buff (defensive/immune) | 低 |
| 45 | ARCLIGHT | 荒野游人 | 战技触发3次额外效果后全队电磁伤害+（智识×0.05→0.08%），15s | 团队增伤（属性缩放） | team buff (emag_dmg, attribute-scaling) | 中 |
| 46 | ARCLIGHT | 众生智慧 | 30→50%概率忽略法术附着 | 防御性 proc | self buff (defensive proc) | 低 |

---

## 四、Simulation 层：被跳过 / 未路由的 effect type

以下 effect type 存在于 fixture / gamedata 中，但在 simulator.ts 的路由中无 handler，会触发 UNKNOWN_EFFECT_TYPE 或被跳过。

| # | Effect Type | 所属角色 | 语义 | 当前状态 | 候选归类 | 优先级 |
|---|-------------|---------|------|---------|---------|--------|
| 47 | `endmin_debuff` | ENDMINISTRATOR | 源石结晶（角色专属附着，物理异常/终结技消耗后额外伤害）| UNKNOWN_EFFECT_TYPE → 跳过 | character-specific mark / seal | 中 |
| 48 | `physical_weakness` | LIFENG | 物理脆弱（战技施加）| UNKNOWN_EFFECT_TYPE → 跳过 | enemy debuff (physical fragility) | **高** |
| 49 | `prep_ingredients` | DAPAN | 备料状态（终结技后获得，连携技消耗恢复 CD）| UNKNOWN_EFFECT_TYPE → 跳过 | self buff / mark | 低 |
| 50 | `blaze_burst` | 多角色 | 灼热爆裂条件（allowedTypes 出现）| 仅 legality 条件检查，无 effect 路由 | condition marker (非 effect) | 低 |
| 51 | `cold_burst` | 多角色 | 寒冷爆裂条件 | 同上 | condition marker | 低 |
| 52 | `emag_burst` | 多角色 | 电磁爆裂条件 | 同上 | condition marker | 低 |
| 53 | `nature_burst` | 多角色 | 自然爆裂条件 | 同上 | condition marker | 低 |
| 54 | `break` | 多角色 | 失衡/break 条件 | 仅 legality 条件检查 + physicalAnomaly 触发方式 | condition marker | 低 |
| 55 | `ice_shatter` | 多角色 | 碎冰条件 | 仅 legality 条件检查 + 异常反应自动触发 | condition marker | 低 |

---

## 五、Potentials：已结构化但 scope 不明确

大部分 potentials 的 effects 为空。已结构化的条目主要分两类：

### 5.1 静态属性加成（scope=static，已消费）

大量角色的潜能 2/4 包含 `stat_bonus` 类型（strength/agility/intellect/will/defense 等 flat 加成）和 `gauge_modifier/ult_gauge_cost` 减少。这些已被 store 的 `resolveTrackConfiguredStats` 消费。**无需关注。**

### 5.2 有描述但 effects 为空（需人工判断）

| # | 角色 | 潜能 | 描述 | 语义判断 | 候选归类 | 优先级 |
|---|------|------|------|---------|---------|--------|
| 56 | DAPAN | P1 | 终结技翻面伤害+30% | 技能增伤 | self buff (damage_bonus on ultimate variant) | 中 |
| 57 | CHENQIANYU | P1 "绝影" | 对 HP<50% 敌人伤害+20% | 条件增伤 | self buff (conditional, target HP) | 中 |
| 58 | PERLICA | P5 | crit_rate +30%（已结构化） | 静态暴击加成 | self buff (static) — 但无 scope 标注 | 中 |
| 59 | YVONNE | P5 | crit_dmg +30%（已结构化，但缺 ATK+10%） | 部分结构化 | self buff (static) — 数据不完整 | 低 |
| 60 | LAEVATAIN | P2 | attack_dmg_bonus: 15%（已结构化） | 普攻伤害加成 | self buff (static) | 中 |
| 61 | LASTRITE | P3 | 连携技/终结技倍率×1.15 | 倍率提升 | multiplier override | 低 |
| 62 | ENDMINISTRATOR | P1-3 | 仅 3 级，P3 为乱码占位 | 数据不完整 | 需补数据 | 低 |

---

## 六、Runtime Passive 临时近似汇总

以下条目当前用"永久 buff"近似实现，但原始语义是条件性的。

| # | 角色 | 天赋 | 当前近似 | 正确语义 | 偏差程度 |
|---|------|------|---------|---------|---------|
| 11 | LAEVATAIN | 灼心 | 永久 resistance zone | 吸收4层灼热附着后触发，20s 持续 | 中（永久 vs 条件触发+持续时间） |
| 12 | ENDMINISTRATOR | 现实静滞 | 永久 fragility zone | 仅在敌人有结晶时生效 | 高（结晶未建模，永久 vs 条件） |
| 13 | XAIHI | 启动进程 | 永久 fragility zone | 连携技命中+目标有冷附着时触发，5s | 高（永久 vs 命中触发+5s 持续） |

---

# 汇总表 1：按 effect type / mechanic type 分组

| 分组 | 数量 | 代表角色 | 适合直接标为 buff/debuff？ |
|------|------|---------|-------------------------|
| **runtime_conditional 未注册 registry** | 10 条 | DAPAN, ENDMINISTRATOR, EMBER, FLUORITE, CATCHER, LIFENG, ROSSI, ALESH, AVYWENNA | 部分可以（DAPAN）；大部分因事件/系统缺失不行 |
| **parsed_unimplemented（语义清楚可降级）** | 6 条 | PERLICA, AVYWENNA, FLUORITE, YVONNE, LIFENG, CATCHER | **是** — 最适合人工拍板 |
| **parsed_unimplemented（SP/gauge 相关）** | 4 条 | ESTELLA, WULFGARD, GILBERTA, SNOWSHINE | 部分可以（SP 返还可近似） |
| **parsed_unimplemented（治疗/防御）** | 7 条 | ANTAL, EMBER, LAEVATAIN, SNOWSHINE, GILBERTA, ARDELIA, ESTELLA | 否 — 伤害模拟器不需要 |
| **parsed_unimplemented（团队 buff）** | 3 条 | ARCLIGHT, POGRANICHNK, TANGTANG | 部分（ARCLIGHT 全队电磁增伤有价值） |
| **parsed_unimplemented（额外伤害/额外打击）** | 4 条 | CATCHER, LIFENG, PERLICA, ROSSI | 否 — 需要额外伤害系统 |
| **parsed_unimplemented（专属 mark/seal/状态）** | 6 条 | ALESH, AKEKURI, YVONNE, LASTRITE, DAPAN, ARDELIA | 否 — 角色专属机制 |
| **Simulation 跳过的 effect type** | 3 条（不含 condition marker） | ENDMINISTRATOR, LIFENG, DAPAN | physical_weakness 可以；其余需要新状态 |
| **runtime_passive 永久近似** | 3 条 | LAEVATAIN, ENDMINISTRATOR, XAIHI | 已近似运行中，精确化需条件系统 |
| **Potentials 缺结构化** | 3~5 条有价值 | DAPAN P1, CHENQIANYU P1, PERLICA P5, LAEVATAIN P2 | 部分可以直接标为 static buff |
| **gauge_modifier（无 runtime 路径）** | 2 条 | ALESH, AVYWENNA | 否 — 需 gauge runtime |

---

# 汇总表 2：最适合"直接降级成 buff/debuff 处理"的候选 shortlist

筛选标准：语义清楚 + 不需新系统 + 人工拍板后可快速归类 + ROI 高

| 排序 | 角色 | 条目 | 当前状态 | 建议归类 | 动作 | ROI |
|------|------|------|---------|---------|------|-----|
| **1** | **PERLICA** | 歼灭协议：对失衡目标伤害+20→30% | parsed_unimplemented | self buff → `broken_dmg_bonus` stat（已存在于增伤区） | 结构化 effect → resolveTrackConfiguredStats 消费为 runtime_passive | **极高** — 已有 stat，0 新系统 |
| **2** | **AVYWENNA** | 委婉手段：终结技命中施加 6→10% 电磁脆弱 | parsed_unimplemented | enemy debuff → emag fragility（fragility zone 已支持 emag_dmg） | 结构化 effect + simulator 路由添加 | **高** — fragility zone 已有 |
| **3** | **LIFENG (physical_weakness)** | 战技施加物理脆弱 | effect type 被跳过 | enemy debuff → physical fragility（类似 physical_vulnerable 路由） | 添加 physical_weakness → physical fragility 路由 | **高** — 类似现有 physical_vulnerable |
| **4** | **LIFENG** | 顿悟：每点智识+意志 → ATK+0.10→0.15% | parsed_unimplemented | self buff (static, attribute-scaling) | 结构化 effect → store 侧属性缩放公式 | **中** — 需属性缩放计算 |
| **5** | **LASTRITE** | 低温症：消耗法术附着→寒冷脆弱（层数×2→4%），15s | parsed_unimplemented | enemy debuff (cold fragility, variable value) | 结构化 effect → APPLY_MAGIC_ATTACHMENT 触发条件 + 变量 value | **中** — 需消耗检测+变量值 |
| **6** | **DAPAN** | 勾芡（已结构化）| runtime_conditional 未注册 | self buff (physical_dmg on break clear) | conditionFactory + 语义近似决策 | **中** — 可行但需设计 |
| **7** | **FLUORITE** | 落井下石爱好者：对缓速目标伤害+10→20% | parsed_unimplemented | self buff (all_dmg, conditional on slow) | 结构化 effect → 但需"缓速"状态检测 | **中** — 需缓速状态 |
| **8** | **YVONNE** | 冰点：对寒冷附着目标暴伤+10→20% | parsed_unimplemented | self buff (crit_dmg conditional) | 结构化 → 需目标状态检测 | **中** |

---

## 附录：数据完整性问题

| 问题 | 位置 | 说明 |
|------|------|------|
| ENDMINISTRATOR potentials 仅 3 级 | potentials.json | P3 含乱码"？？？"，P4-5 缺失 |
| ROSSI potentials 完全为空 | potentials.json | `"potentials": []` |
| XAIHI P4 缺治疗效率结构化 | potentials.json | 描述提到 +10% 治疗效率但 effects 未收录 |
| YVONNE P5 缺 ATK+10% 结构化 | potentials.json | 描述提到 +10% 攻击力但 effects 仅含 crit_dmg |
| DAPAN P1 描述含条件增伤 | potentials.json | "翻面伤害+30%"已结构化为 damage_bonus/physical_dmg/30%，但 scope 不明 |
