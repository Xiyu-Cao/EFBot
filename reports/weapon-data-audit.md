# 武器数据审计 — gamedata.json

> 请逐个核对 passiveStats（第三词条）和 triggeredBuffs（触发效果）是否与游戏内一致。

## 剑 (sword)

### 熔铸火焰 (wpn_sword_0006) — 6★
- 基础攻击力: 510
- 词条1: intellect/large
- 词条2: attack/large
- **第三词条**: blaze_dmg +44.8
- **触发**: on_ultimate (嘶鸣烈火) → target=self, 20s
  - attack_dmg_bonus +210% [增伤]

### 黯色火炬 (wpn_sword_0010) — 6★
- 基础攻击力: 490
- 词条1: primary_ability/large
- 词条2: blaze_dmg/large
- **第三词条**: attack +19.6
- **触发**: condition_corrosion_on_enemy (觊觎堆叠) → target=self, 20s, 2层
  - blaze_nature_dmg +22.4% [增伤]
  - nature_dmg +22.4% [增伤]

### 扶摇 (wpn_sword_0011) — 6★
- 基础攻击力: 495
- 词条1: agility/large
- 词条2: crit_rate/large
- **第三词条**: physical_dmg +42
  - _raw: 对处于失衡状态的敌人造成的伤害+98.0%
- **触发**: (无)

### 热熔切割器 (wpn_sword_0012) — 6★
- 基础攻击力: 490
- 词条1: will/large
- 词条2: attack/large
- **第三词条**: attack +28
- **触发**: on_skill_sp_restore_or_combo (高热解放) → target=team, 20s, 2层
  - attack +14% [攻击加成]

### 显赫声名 (wpn_sword_0013) — 6★
- 基础攻击力: 490
- 词条1: agility/large
- 词条2: physical_dmg/large
- **第三词条**: attack +28
- **触发**: on_break_consume (规行矩止) → target=others, 20s
  - _raw: 装备者消耗破防层数后，自身攻击力+[14.0%+7.0%×消耗层数]，小队内其他干员获得一半的效果，持续20秒

### 白夜新星 (wpn_sword_0014) — 6★
- 基础攻击力: 505
- 词条1: intellect/large
- 词条2: originium_arts_power/large
- **第三词条**: arts_dmg +33.6
- **触发**: on_burning_or_conductive_apply (白夜新星) → target=self, 15s
  - originium_arts_power +70 [特殊系数]
  - arts_dmg +33.6% [增伤]

### 不知归 (wpn_sword_0016) — 6★
- 基础攻击力: 500
- 词条1: will/large
- 词条2: attack/large
- **第三词条**: physical_dmg +44.8
- **触发**: on_skill_sp_restore (轮回) → target=others, 30s, 5层
  - physical_dmg +14% [增伤]

### 光荣记忆 (wpn_sword_0017) — 6★
- 基础攻击力: 490
- 词条1: agility/large
- 词条2: crit_rate/large
- **第三词条**: attack +19.6
- **触发**: on_physical_anomaly → target=self, 30s, 3层
  - ultimate_dmg_bonus +33.6% [增伤]

### 宏愿 (wpn_sword_0021) — 6★
- 基础攻击力: 500
- 词条1: agility/large
- 词条2: attack/large
- **第三词条**: originium_arts_power +84
- **触发**: on_crystal_or_freeze_apply (长愿) → target=self
  - physical_dmg +100.8% [增伤]

### 狼之绯 (wpn_sword_0022) — 6★
- 基础攻击力: 495
- 词条1: agility/large
- 词条2: crit_rate/large
- **第三词条**: (无)
- **触发**: (无)

### 钢铁余音 (wpn_sword_0005) — 5★
- 基础攻击力: 411
- 词条1: agility/medium
- 词条2: physical_dmg/medium
- **第三词条**: attack +14
- **触发**: on_physical_anomaly (旧火余音) → target=self, 20s, 2层
  - attack +21% [攻击加成]

### 坚城铸造者 (wpn_sword_0007) — 5★
- 基础攻击力: 411
- 词条1: intellect/medium
- 词条2: ult_charge_eff/medium
- **第三词条**: attack +14, originium_arts_power +70
- **触发**: (无)

### 仰止 (wpn_sword_0015) — 5★
- 基础攻击力: 411
- 词条1: agility/medium
- 词条2: physical_dmg/medium
- **第三词条**: ultimate_dmg_bonus +44.8
- **触发**: on_knockup (高山仰止) → target=self, 3层
  - physical_dmg +33.6% [增伤]

### 十二问 (wpn_sword_0018) — 5★
- 基础攻击力: 411
- 词条1: agility/medium
- 词条2: attack/medium
- **第三词条**: secondary_ability +14
- **触发**: on_arts_anomaly_consume (竭心诘问) → target=self, 20s, 2层
  - attack +21% [攻击加成]

### O.B.J.轻芒 (wpn_sword_0019) — 5★
- 基础攻击力: 411
- 词条1: agility/medium
- 词条2: attack/medium
- **第三词条**: secondary_ability +14
- **触发**: on_skill_sp_restore (不羁锋芒) → target=team, 20s, 3层
  - blaze_emag_dmg +8.4% [增伤]
  - emag_dmg +8.4% [增伤]

### 逐鳞3.0 (wpn_sword_0020) — 5★
- 基础攻击力: 411
- 词条1: strength/medium
- 词条2: ult_charge_eff/medium
- **第三词条**: attack +14
- **触发**: on_freeze_apply (逐鳞意) → target=enemy, 15s
  - cold_dmg +19.6% [增伤]

### 显锋 (wpn_sword_0008) — 4★
- 基础攻击力: 341
- 词条1: agility/small
- 词条2: physical_dmg/small
- **第三词条**: (无)
- **触发**: on_skill_hit (应急强化) → target=self, 20s
  - attack +33.6% [攻击加成]

### 浪潮 (wpn_sword_0009) — 4★
- 基础攻击力: 341
- 词条1: intellect/small
- 词条2: attack/small
- **第三词条**: (无)
- **触发**: on_link (生生不息) → target=self, 20s
  - attack +33.6% [攻击加成]

### 塔尔11 (wpn_sword_0003) — 3★
- 基础攻击力: 283
- 词条1: primary_ability/small
- 词条2: (无)/small
- **第三词条**: (无)
- **触发**: (无)

## 大剑 (claym)

### 典范 (wpn_claym_0004) — 6★
- 基础攻击力: 500
- 词条1: strength/large
- 词条2: attack/large
- **第三词条**: physical_dmg +28
- **触发**: on_skill_or_ultimate_hit (多层斩断) → target=self, 30s, 3层
  - _raw: 装备者的战技和终结技命中敌人时，物理伤害额外+28.0%，持续30秒

### 昔日精品 (wpn_claym_0006) — 6★
- 基础攻击力: 495
- 词条1: will/large
- 词条2: hp/large
- **第三词条**: healing_effect +28
  - _raw: 每15秒最多触发一次
- **触发**: on_shielded_ally_damaged (切碎疗法) → target=self
  - _raw: 处于庇护状态的干员受到伤害后，装备者为其回复[235+意志×1.96]点生命值

### 大雷斑 (wpn_claym_0007) — 6★
- 基础攻击力: 495
- 词条1: strength/large
- 词条2: hp/large
- **第三词条**: shield_effect +67.2
  - _raw: 15秒内最多触发一次
- **触发**: on_link_heal (塔罗斯之眼) → target=main_operator, 15s
  - _raw: 装备者通过自身连携技治疗后，额外使主控干员获得[19.6%×装备者最大生命值]的护盾，持续15秒

### 破碎君王 (wpn_claym_0008) — 6★
- 基础攻击力: 490
- 词条1: strength/large
- 词条2: crit_rate/large
- **第三词条**: (无)
- **触发**: on_heavy_attack (君王威慑) → target=self, 8s
  - attack +28% [攻击加成]

### 赫拉芬格 (wpn_claym_0013) — 6★
- 基础攻击力: 505
- 词条1: strength/large
- 词条2: cold_dmg/large
- **第三词条**: all_skill_dmg_bonus +56
- **触发**: on_skill_cold_attach (切骨之寒) → target=self, 15s
  - cold_dmg +28% [增伤]
- **触发**: on_link_hit_cold_enemy (切骨之寒) → target=self, 15s
  - cold_dmg +56% [增伤]

### 探骊 (wpn_claym_0011) — 5★
- 基础攻击力: 411
- 词条1: strength/medium
- 词条2: ult_charge_eff/medium
- **第三词条**: primary_ability +14
- **触发**: on_arts_burst (钩玄猎秘) → target=self, 30s, 3层
  - attack +16.8% [攻击加成]

### 终点之声 (wpn_claym_0012) — 5★
- 基础攻击力: 411
- 词条1: strength/medium
- 词条2: hp/medium
- **第三词条**: secondary_ability +14
  - _raw: 连携技造成的治疗效果+56.0%
- **触发**: (无)

### 古渠 (wpn_claym_0014) — 5★
- 基础攻击力: 411
- 词条1: strength/medium
- 词条2: originium_arts_power/medium
- **第三词条**: originium_arts_power +28
- **触发**: on_break_consume (千秋旧土) → target=self, 20s
  - _raw: 装备者消耗破防层数后，物理伤害+[14.0%×消耗层数]，持续20秒

### O.B.J.重荷 (wpn_claym_0015) — 5★
- 基础攻击力: 411
- 词条1: strength/medium
- 词条2: hp/medium
- **第三词条**: secondary_ability +14
- **触发**: on_knockdown_or_weaken (坚韧心性) → target=self, 15s
  - defense +50.4% [角色属性]

### 工业零点一 (wpn_claym_0003) — 4★
- 基础攻击力: 341
- 词条1: strength/small
- 词条2: attack/small
- **第三词条**: (无)
- **触发**: on_skill_hit (应急强化) → target=self, 20s
  - attack +33.6% [攻击加成]

### 淬火者 (wpn_claym_0009) — 4★
- 基础攻击力: 341
- 词条1: will/small
- 词条2: hp/small
- **第三词条**: (无)
- **触发**: on_heavy_attack (淬砺成兵) → target=self, 10s
  - attack +33.6% [攻击加成]

### 达尔霍夫7 (wpn_claym_0010) — 3★
- 基础攻击力: 283
- 词条1: primary_ability/small
- 词条2: (无)/small
- **第三词条**: (无)
- **触发**: (无)

## 矛 (lance)

### 骁勇 (wpn_lance_0010) — 6★
- 基础攻击力: 495
- 词条1: agility/large
- 词条2: physical_dmg/large
- **第三词条**: attack +28
- **触发**: on_physical_anomaly (美德盈利) → target=self
  - _raw: 装备者造成物理异常后，额外造成自身攻击力336.0%的物理伤害

### J.E.T. (wpn_lance_0011) — 6★
- 基础攻击力: 500
- 词条1: will/large
- 词条2: attack/large
- **第三词条**: arts_dmg +33.6
- **触发**: on_skill (太空物理学) → target=self, 15s
  - arts_dmg +33.6% [增伤]

### 负山 (wpn_lance_0012) — 6★
- 基础攻击力: 500
- 词条1: agility/large
- 词条2: physical_dmg/large
- **第三词条**: (无)
  - _raw: 装备者对处于破防状态的敌人造成的伤害+56.0%
- **触发**: on_skill_break_apply → target=self, 15s
  - all_ability +22.4% [角色属性]
- **触发**: on_skill_physical_fragile → target=self, 15s
  - all_ability +22.4% [角色属性]

### 嵌合正义 (wpn_lance_0004) — 5★
- 基础攻击力: 411
- 词条1: strength/medium
- 词条2: ult_charge_eff/medium
- **第三词条**: crit_rate +8.4
- **触发**: on_break_apply_no_existing (愤怒接合) → target=self, 15s
  - attack +42% [攻击加成]

### 向心之引 (wpn_lance_0006) — 5★
- 基础攻击力: 411
- 词条1: will/medium
- 词条2: emag_dmg/medium
- **第三词条**: link_dmg_bonus +28
- **触发**: on_link (同心圆) → target=self, 3层
  - emag_dmg +28% [增伤]

### O.B.J.尖峰 (wpn_lance_0013) — 5★
- 基础攻击力: 411
- 词条1: will/medium
- 词条2: physical_dmg/medium
- **第三词条**: (无)
- **触发**: on_freeze_consume (攀越冰峰) → target=self, 15s
  - attack +33.6% [攻击加成]

### 寻路者道标 (wpn_lance_0003) — 4★
- 基础攻击力: 341
- 词条1: agility/small
- 词条2: attack/small
- **第三词条**: (无)
- **触发**: condition_hp_above_80pct (远途起始) → target=self
  - attack +42% [攻击加成]

### 天使杀手 (wpn_lance_0008) — 4★
- 基础攻击力: 341
- 词条1: will/small
- 词条2: arts_dmg/small
- **第三词条**: (无)
- **触发**: on_skill_hit (应急强化) → target=self, 20s
  - attack +33.6% [攻击加成]

### 奥佩罗77 (wpn_lance_0009) — 3★
- 基础攻击力: 283
- 词条1: primary_ability/small
- 词条2: (无)/small
- **第三词条**: (无)
- **触发**: (无)

## 枪 (pistol)

### 领航者 (wpn_pistol_0005) — 6★
- 基础攻击力: 490
- 词条1: primary_ability/large
- 词条2: ult_charge_eff/large
- **第三词条**: crit_rate +9.8
  - _raw: 若由装备者触发该效果，提升的数值翻倍
- **触发**: condition_freeze_or_corrosion_on_field (远影孤帆) → target=self, 15s
  - cold_nature_dmg +9.8% [增伤]
  - nature_dmg +9.8% [增伤]
  - crit_rate +5.6% [暴击]

### 望乡 (wpn_pistol_0007) — 6★
- 基础攻击力: 490
- 词条1: agility/large
- 词条2: cold_dmg/large
- **第三词条**: attack +19.6
- **触发**: on_link → target=self, 20s, 2层
  - cold_dmg +22.4% [增伤]
  - nature_dmg +22.4% [增伤]

### 楔子 (wpn_pistol_0008) — 6★
- 基础攻击力: 500
- 词条1: intellect/large
- 词条2: attack/large
- **第三词条**: arts_dmg +33.6
- **触发**: on_skill (文明楔子) → target=self, 15s
  - arts_dmg +22.4% [增伤]
- **触发**: on_skill_arts_anomaly_apply (文明楔子) → target=self, 15s
  - arts_dmg +44.8% [增伤]

### 同类相食 (wpn_pistol_0009) — 6★
- 基础攻击力: 490
- 词条1: strength/large
- 词条2: attack/large
- **第三词条**: arts_dmg +33.6
- **触发**: on_arts_anomaly_consume → target=enemy, 15s
  - element_dmg +28% [易伤]

### 艺术暴君 (wpn_pistol_0010) — 6★
- 基础攻击力: 505
- 词条1: intellect/large
- 词条2: crit_rate/large
- **第三词条**: cold_dmg +44.8
- **触发**: on_skill_or_link_crit (艺术暴论) → target=self, 30s, 3层
  - cold_dmg +39.2% [增伤]

### 落草 (wpn_pistol_0011) — 6★
- 基础攻击力: 505
- 词条1: (无)/small
- 词条2: (无)/small
- **第三词条**: cold_dmg +44.8
- **触发**: on_skill_or_ultimate_cold_attach → target=self, 20s
  - cold_dmg +56% [增伤]
- **触发**: on_skill_or_ultimate_spell_vulnerable → target=enemy, 20s
  - arts_dmg +16.8% [增伤]

### 理性告别 (wpn_pistol_0004) — 5★
- 基础攻击力: 411
- 词条1: strength/medium
- 词条2: blaze_dmg/medium
- **第三词条**: skill_dmg_bonus +28
- **触发**: on_burning_apply (旧时之援) → target=self, 15s
  - attack +44.8% [攻击加成]

### 作品：众生 (wpn_pistol_0006) — 5★
- 基础攻击力: 411
- 词条1: agility/medium
- 词条2: arts_dmg/medium
- **第三词条**: crit_rate +8.4
- **触发**: on_arts_anomaly_apply (众生的归途) → target=self, 20s, 2层
  - attack +21% [攻击加成]

### O.B.J.迅极 (wpn_pistol_0012) — 5★
- 基础攻击力: 411
- 词条1: agility/medium
- 词条2: ult_charge_eff/medium
- **第三词条**: attack +14
- **触发**: on_arts_attach_consume (迅击) → target=self, 20s
  - _raw: 装备者消耗法术附着后，自然伤害+[14.0%×消耗层数]，持续20秒

### 呼啸守卫 (wpn_pistol_0002) — 4★
- 基础攻击力: 341
- 词条1: intellect/small
- 词条2: attack/small
- **第三词条**: (无)
- **触发**: on_skill_hit (应急强化) → target=self, 20s
  - attack +33.6% [攻击加成]

### 长路 (wpn_pistol_0003) — 4★
- 基础攻击力: 341
- 词条1: strength/small
- 词条2: arts_dmg/small
- **第三词条**: (无)
- **触发**: on_link (生生不息) → target=self, 20s
  - attack +33.6% [攻击加成]

### 佩科5 (wpn_pistol_0001) — 3★
- 基础攻击力: 283
- 词条1: primary_ability/small
- 词条2: (无)/small
- **第三词条**: (无)
- **触发**: (无)

## 法杖 (funnel)

### 作品：蚀迹 (wpn_funnel_0006) — 6★
- 基础攻击力: 485
- 词条1: primary_ability/large
- 词条2: attack/large
- **第三词条**: attack +19.6
- **触发**: on_nature_attach (碛岩蚀痕) → target=others, 15s
  - arts_dmg +14% [增伤]

### 骑士精神 (wpn_funnel_0008) — 6★
- 基础攻击力: 490
- 词条1: will/large
- 词条2: hp/large
- **第三词条**: secondary_ability +28
- **触发**: on_arts_burst (侵蚀性狂热) → target=enemy, 15s
  - arts_dmg +25.2% [增伤]

### 遗忘 (wpn_funnel_0009) — 6★
- 基础攻击力: 495
- 词条1: intellect/large
- 词条2: attack/large
- **第三词条**: crit_rate +14
- **触发**: on_ultimate (耻辱) → target=self, 15s
  - arts_dmg +67.2% [增伤]

### 爆破单元 (wpn_funnel_0010) — 6★
- 基础攻击力: 485
- 词条1: intellect/large
- 词条2: originium_arts_power/large
- **第三词条**: healing_effect +28
- **触发**: on_skill_heal (冠军威赫) → target=team, 15s
  - attack +25.2% [攻击加成]

### 使命必达 (wpn_funnel_0011) — 6★
- 基础攻击力: 500
- 词条1: will/large
- 词条2: ult_charge_eff/large
- **第三词条**: nature_dmg +44.8
- **触发**: on_link_knockup (不辱使命) → target=team, 15s
  - arts_dmg +33.6% [增伤]

### 沧溟星梦 (wpn_funnel_0013) — 6★
- 基础攻击力: 495
- 词条1: intellect/large
- 词条2: healing_effect/large
- **第三词条**: secondary_ability +44.8
- **触发**: on_corrosion_consume (潮汐低语) → target=enemy, 25s
  - arts_dmg +28% [增伤]

### 迷失荒野 (wpn_funnel_0004) — 5★
- 基础攻击力: 411
- 词条1: intellect/medium
- 词条2: emag_dmg/medium
- **第三词条**: originium_arts_power +28
- **触发**: on_conductive_apply (荒芜集簇) → target=team, 15s
  - physical_emag_dmg +22.4% [增伤]
  - emag_dmg +22.4% [增伤]

### 悼亡诗 (wpn_funnel_0005) — 5★
- 基础攻击力: 411
- 词条1: intellect/medium
- 词条2: attack/medium
- **第三词条**: hp +56
- **触发**: on_ultimate (冢火成莹) → target=self, 20s
  - attack +22.4% [攻击加成]

### 莫奈何 (wpn_funnel_0007) — 5★
- 基础攻击力: 411
- 词条1: will/medium
- 词条2: ult_charge_eff/medium
- **第三词条**: primary_ability +14, originium_arts_power +70
- **触发**: (无)

### 布道自由 (wpn_funnel_0012) — 5★
- 基础攻击力: 411
- 词条1: will/medium
- 词条2: healing_effect/medium
- **第三词条**: primary_ability +14
  - _raw: 每15秒最多触发一次
- **触发**: on_skill_heal (信仰救赎) → target=main_operator
  - _raw: 装备者通过自身战技治疗后，为主控干员额外回复[168+意志×1.4]点生命值

### O.B.J.术识 (wpn_funnel_0014) — 5★
- 基础攻击力: 411
- 词条1: intellect/medium
- 词条2: originium_arts_power/medium
- **第三词条**: hp +56
- **触发**: on_link_burst_or_physical_anomaly (术法升华) → target=team, 15s
  - blaze_emag_dmg +22.4% [增伤]
  - emag_dmg +22.4% [增伤]

### 全自动骇新星 (wpn_funnel_0001) — 4★
- 基础攻击力: 341
- 词条1: intellect/small
- 词条2: attack/small
- **第三词条**: (无)
- **触发**: condition_hp_above_80pct (远途起始) → target=self
  - attack +42% [攻击加成]

### 荧光雷羽 (wpn_funnel_0003) — 4★
- 基础攻击力: 341
- 词条1: will/small
- 词条2: attack/small
- **第三词条**: (无)
- **触发**: on_skill_hit (应急强化) → target=self, 20s
  - attack +33.6% [攻击加成]

### 吉米尼12 (wpn_funnel_0002) — 3★
- 基础攻击力: 283
- 词条1: primary_ability/small
- 词条2: (无)/small
- **第三词条**: (无)
- **触发**: (无)

