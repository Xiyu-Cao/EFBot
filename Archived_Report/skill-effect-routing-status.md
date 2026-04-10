# 技能效果路由状态清单

全部 38 种效果类型，来源：`public/gamedata.json` 中所有角色的 anomaly 数组。

---

## 已路由 — 元素附着 (→ APPLY_MAGIC_ATTACHMENT)

| 类型 | 名称 | 使用角色 |
|------|------|----------|
| `blaze_attach` | 灼热附着 | WULFGARD(skill, link), AKEKURI(skill) |
| `cold_attach` | 寒冷附着 | TANGTANG(skill), XAIHI(link), SNOWSHINE(skill), ALESH(ultimate), FLUORITE(link), ESTELLA(skill) |
| `emag_attach` | 电磁附着 | ARCLIGHT(ultimate), PERLICA(skill) |
| `nature_attach` | 自然附着 | GILBERTA(skill, ultimate), FLUORITE(skill, link, ultimate) |

## 已路由 — 物理异常 (→ APPLY_PHYSICAL_ANOMALY)

| 类型 | 名称 | 使用角色 |
|------|------|----------|
| `stagger` | 击碎 | ENDMINISTRATOR(skill), DAPAN(link) |
| `knockdown` | 倒地 | LIFENG(skill, ultimate), EMBER(skill, link), DAPAN(ultimate), CATCHER(ultimate) |
| `knockup` | 击飞 | GILBERTA(link), ROSSI(skill), DAPAN(skill, ultimate), CHENQIANYU(skill, link), ESTELLA(link, ultimate) |

注: `armor_break` 在 anomaly 数组中未直接出现（通过击碎系统间接触发）。

## 已路由 — 直接异常 (→ APPLY_DIRECT_ANOMALY)

| 类型 | 名称 | 使用角色 |
|------|------|----------|
| `burning` | 燃烧 | WULFGARD(ultimate) |
| `conductive` | 导电 | ARCLIGHT(ultimate), PERLICA(link) |
| `frozen` | 冻结 | YVONNE(skill, link), SNOWSHINE(ultimate) |
| `corrosion` | 腐蚀 | ARDELIA(link) |

## 已路由 — 脆弱/易伤 (Route 2.6–2.8)

| 类型 | 名称 | 路由 | 使用角色 |
|------|------|------|----------|
| `physical_weakness` | 物理脆弱 (脆弱区) | Route 2.6.5 | LIFENG(skill) |
| `physical_vulnerable` | 破防易伤 (易伤区) | Route 2.7 | LIFENG(skill), ESTELLA(link) |
| `spell_vulnerable` | 法术脆弱 (脆弱区) | Route 2.8 | GILBERTA(ultimate) |

## 已路由 — 增幅 buff (Route 2.9, skillBuffZoneRegistry)

| 类型 | 名称 | Zone | 目标 | 使用角色 |
|------|------|------|------|----------|
| `fire_enhance` | 灼热增幅 | amplify | team | ANTAL(ultimate) |
| `pulse_enhance` | 电磁增幅 | amplify | team | ANTAL(ultimate) |
| `cryst_enhance` | 寒冷增幅 | amplify | team | XAIHI(ultimate) |
| `natural_enhance` | 自然增幅 | amplify | team | XAIHI(ultimate) |
| `spell_enhance` | 法术增幅 | amplify | source | XAIHI(skill) |

## 已路由 — 载体 buff (Route 2.9, carrierOnly)

| 类型 | 名称 | 使用角色 | 备注 |
|------|------|----------|------|
| `skill_seraph` | 支援晶体 | XAIHI(skill) | 绑定主控干员，重击→回血→满血施加法术增幅。当前简化为载体标记。 |

---

## 待处理 — 需实现路由

### 角色专属 buff — 全部已归类

无剩余待确认。

### 已路由 — 载体/脆弱 buff（本轮已完成）

| 类型 | 名称 | 使用角色 | 说明 |
|------|------|----------|------|
| `antal_buff` | 聚焦 | ANTAL(skill) | ✅ 电磁脆弱+灼热脆弱 (fragility, enemy, 60s) |
| `weak` | 虚弱 | CATCHER(ultimate) | ✅ 载体标记。敌方减伤 debuff (20-30%, 8秒)，模拟器不考虑敌人伤害，仅标记。 |
| `magma_1` | 熔火 | LAEVATAIN(skill, link, ult, attack) | ✅ 载体标记。被动层数 (0-4层)，无持续时间，战技消耗全部层数强化伤害。 |
| `blaze_to_magma` | 灼热→熔火 | LAEVATAIN(attack) | ✅ 载体标记。普攻重击消耗灼热附着→转换为熔火层。 |
| `comboskillwater` | 涡流 | TANGTANG(link) | ✅ 载体标记。最多2处，持续30秒，被战技消耗→生成额外水龙卷。类似熔火。 |
| `skillwater` | 水龙卷 | TANGTANG(skill) | ✅ 载体标记。持续3秒造成寒冷伤害，每段倍率待数据。类似雷枪。 |
| `ultskilldebuff` | 古老图形 | TANGTANG(ultimate) | ✅ 载体标记。封锁敌人4秒+持续寒冷伤害，巨浪收尾。 |
| `pograni_buff` | 铁誓 | POGRANICHNK(ultimate) | ✅ 载体标记。5层/30秒不刷新。物理异常或骏卫连携技消耗→袭扰/决胜。 |
| `dapan_buff` | 备料 | DAPAN(ultimate) | ✅ 载体标记。备料状态下连携技命中→恢复40%冷却并消耗一层。 |
| `endmin_debuff` | 源石结晶 | ENDMINISTRATOR(link) | ✅ 载体标记。详见下方。 |
| `lastrite_buff` | 低温灌注 | LASTRITE(skill) | ✅ 载体标记。详见下方。 |
| `skill_seraph` | 支援晶体 | XAIHI(skill) | ✅ 载体标记。详见下方。 |

#### 载体 buff 设计原则：消耗 (consumed) vs 消失 (expired) 分别处理

载体 buff 的移除有两种语义，必须区分：
- **consumed**: 触发条件满足后被主动消耗 → 触发效果（造成伤害、施加 debuff 等）
- **expired**: 持续时间到期自然消失 → 不触发效果

现有 `EFFECT_END` 事件已有 `type: "consumption" | "expiration"` 字段可区分。载体消耗应入队 `EFFECT_END { type: "consumption" }`，过期由 sweepExpired 产生 `EFFECT_END { type: "expiration" }`。天赋监听消耗事件时只响应 `consumption`。

#### `endmin_debuff` 源石结晶

- **施加**: 连携技「锁闭序列」，持续 `封印时间（秒）` (4-5s)
- **消耗条件**: 敌人被施加物理异常或破防
- **消耗效果**: 额外造成物理伤害 (`击碎结晶伤害倍率` 178%-400%)
- **到期消失**: 不触发额外伤害
- **天赋0「本质瓦解」**: 结晶被**消耗**后→自身 ATK+15/30%，15秒，不叠加
- **天赋1「现实静滞」**: 结晶存在期间→敌人受到物理伤害+10/20% (vulnerability)，结晶消失（无论消耗或到期）同步移除

#### `lastrite_buff` 低温灌注

- **施加**: 战技「塞什卡的秘传」，给主控干员，持续 15 秒
- **消耗条件**: 主控干员的第一次重击
- **消耗效果**: 生成别礼幻影追击 → 寒冷伤害 (`幻影追击伤害倍率` 142%-320%) + 寒冷附着
- **到期消失**: 不触发追击
- **天赋0「低温症」**: 别礼**消耗法术附着**后→寒冷脆弱 (消耗层数×2/4%，15秒)。注意监听的是连携技「噬冬」消耗附着，不是 lastrite_buff 消耗。
- **天赋1「低温脆性」**: 终结技伤害时，目标有寒冷脆弱→效果视为原本的 1.2/1.5 倍（乘算放大）

#### `skill_seraph` 支援晶体

- **施加**: 战技，给主控干员，切换主控时跟随
- **消耗条件**: 主控干员的重击
- **消耗效果**: 恢复生命值；满血则施加法术增幅 (`spell_enhance`)
- **到期消失**: 不触发效果
- **当前简化**: 无血量系统，默认触发法术增幅

### 角色模式/机制标记

| 类型 | 名称 | 使用角色 | 说明 | 优先级 |
|------|------|----------|------|--------|
| ~~`magma_1`~~ | ~~熔火~~ | ~~LAEVATAIN~~ | ✅ 已移至载体 buff | — |
| ~~`blaze_to_magma`~~ | ~~灼热→熔火~~ | ~~LAEVATAIN~~ | ✅ 已移至载体 buff | — |
| ~~`combo`~~ | ~~连击~~ | ~~LIFENG, AKEKURI~~ | ✅ 已路由。combo zone，全队战技+30%/终结技+20%，一次性消耗。当前简化固定30%。 | — |
| `combo_skill_aurora` | 极光连携 | SNOWSHINE(link) | 连携技特殊连击状态 | P2 |
| ~~`comboskillwater`~~ | ~~涡流~~ | ~~TANGTANG~~ | ✅ 已移至载体 buff | — |
| ~~`skillwater`~~ | ~~水龙卷~~ | ~~TANGTANG~~ | ✅ 已移至载体 buff | — |
| ~~`ultskilldebuff`~~ | ~~古老图形~~ | ~~TANGTANG~~ | ✅ 已移至载体 buff | — |
| ~~`Thunderlances`~~ | ~~雷枪~~ | ~~AVYWENNA(link)~~ | ✅ 重构为载体 buff + EffectManager 管理，战技回收时从 EffectManager 读取 | — |
| ~~`Thunderlances EX`~~ | ~~强雷枪~~ | ~~AVYWENNA(ultimate)~~ | ✅ 同上 | — |

### 战斗机制效果

| 类型 | 名称 | 使用角色 | 说明 | 优先级 |
|------|------|----------|------|--------|
| ~~`ice_shatter`~~ | ~~碎冰~~ | ~~ESTELLA(link)~~ | ✅ 已由 PhysicalReactionResolver 自动处理（冻结+物理异常→碎冰伤害），anomaly 数组中仅作 allowedTypes 声明 | — |
| `break` | 直接破防 | CATCHER(skill) | ✅ 直接施加破防层数（不触发物理异常），效果已路由。整个战技依赖受击触发，暂缓 | 暂缓 |
| `blaze_burst` | 灼热附着 | ROSSI(ultimate) | ✅ burst 类型统一路由为对应元素附着 (fire/cold/electro/nature) | — |
| `blaze_burst` | 灼热爆发 | ROSSI(ultimate) | 终结技灼热爆发反应，legacy EFFECT_START 路径可能处理但未测试 | P2 |
| ~~`affix_slow`~~ | ~~缓速~~ | ~~GILBERTA(ultimate)~~ | ✅ 载体标记。通用控制 debuff，无伤害乘区，可触发其他角色天赋事件 | — |

---

## 统计

| 分类 | 数量 |
|------|------|
| 已路由（元素/物理/异常/脆弱） | 16 |
| 已路由（增幅 buff） | 5 |
| 已路由（载体/脆弱 buff） | 11 (含 `comboskillwater`, `skillwater`, `ultskilldebuff` 等) |
| 已路由（角色专属 buff） | 全部归类完成 |
| 待处理 — 模式/机制标记 | 1 (`combo_skill_aurora` 暂缓，受击相关) |
| 待处理 — 战斗机制 | 0 |
| **合计** | **38** |

## 建议优先级

1. **P1**: `break` — 影响伤害计算；`endmin_debuff` 消耗触发+linked debuff 需后续实现
2. **P2**: `combo_skill_aurora` + `blaze_burst` — 需确认效果
3. `blaze_burst` 等 burst 类型已统一路由为元素附着
