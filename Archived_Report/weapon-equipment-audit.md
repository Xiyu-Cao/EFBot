# 武器与装备效果审核清单

## 实现状态总结

- **自动映射生效**: 38 个 triggered buffs（通过 weaponDataAdapter 自动生成 action）
- **手写实现**: 2 个（典范、作品：蚀迹）
- **未映射**: 22 个（见下方详情）
- **装备套装**: 4/21 已实现

## 武器触发效果 (60个 triggered buffs, 56个武器)

### Trigger 映射状态

已映射的 trigger（现有 TRIGGER_EVENT_MAP）:
- `on_skill_or_ultimate_hit`, `on_skill_hit`, `on_heavy_attack`
- `on_physical_anomaly`, `on_burning_apply`, `on_freeze_apply`, `on_conductive_apply`
- `on_burning_or_conductive_apply`, `on_nature_attach`, `on_skill_or_ultimate_cold_attach`
- `on_link`, `on_ultimate`, `on_skill`, `on_arts_burst`, `on_knockup`, `on_link_knockup`

需要新增映射的 trigger:
- `on_arts_anomaly_consume` → 消耗法术异常（burn/conduction/freeze/corrosion）
- `on_arts_anomaly_apply` → 施加法术异常
- `on_arts_attach_consume` → 消耗魔法附着
- `on_break_consume` → 消耗破防层
- `on_break_apply_no_existing` → 对无破防敌人施加破防
- `on_skill_break_apply` → 战技施加破防
- `on_skill_physical_fragile` → 战技施加物理脆弱
- `on_skill_sp_restore` → 战技恢复SP
- `on_skill_sp_restore_or_combo` → 战技恢复SP或连击
- `on_skill_arts_anomaly_apply` → 战技施加法术异常
- `on_skill_or_link_crit` → 战技或连携技暴击
- `on_knockdown_or_weaken` → 击倒或虚弱
- `on_freeze_consume` → 消耗冻结
- `on_corrosion_consume` → 消耗腐蚀
- `on_crystal_or_freeze_apply` → 施加结晶或冻结
- `on_link_burst_or_physical_anomaly` → 连携技元素爆发或物理异常
- `condition_hp_above_80pct` → 血量>80%条件（需HP系统）
- `condition_freeze_or_corrosion_on_field` → 场上存在冻结/腐蚀（条件检测）

不可映射的 trigger:
- `_unknown` (5个武器) → 需人工确认触发条件
- `on_shielded_ally_damaged` → 需护盾+受击系统
- `on_skill_heal`, `on_link_heal` → 需治疗系统

### Zone 映射

| JSON zone | 引擎 DynamicBonusZone | 说明 |
|-----------|----------------------|------|
| 增伤 | damageBonus | 增伤区 |
| 攻击加成 | attackPercent | ATK%加成 |
| 易伤 | vulnerability | 易伤区（目标侧） |
| 暴击 | crit | 暴击率/暴击伤害 |
| 角色属性 | — | 全属性/防御力（需特殊处理） |
| 特殊系数 | — | 源石技艺强度等（需特殊处理） |

### Stat 映射

| JSON stat | 引擎 DynamicBonusStat | 说明 |
|-----------|----------------------|------|
| attack | all_dmg (zone: attackPercent) | ATK% |
| physical_dmg | physical_dmg | 物理增伤 |
| arts_dmg | arts_dmg | 法术增伤 |
| cold_dmg | cold_dmg | 寒冷增伤 |
| emag_dmg | emag_dmg | 电磁增伤 |
| nature_dmg | nature_dmg | 自然增伤 |
| attack_dmg_bonus | attack_dmg_bonus | 普攻增伤 |
| ultimate_dmg_bonus | ultimate_dmg_bonus | 终结技增伤 |
| crit_rate | crit_rate (zone: crit) | 暴击率 |
| element_dmg | ? | 全元素增伤（需拆分或新stat） |
| physical_emag_dmg | ? | 物理+电磁双增伤（拆为2个bonus） |
| blaze_emag_dmg | ? | 灼热+电磁双增伤（拆为2个bonus） |
| blaze_nature_dmg | ? | 灼热+自然双增伤 |
| cold_nature_dmg | ? | 寒冷+自然双增伤 |
| all_ability | — | 全属性+N%（需特殊处理） |
| defense | — | 防御力（需特殊处理） |
| originium_arts_power | — | 源石技艺强度（需特殊处理） |

---

## 武器逐条审核

### 可自动实现（trigger已映射 + effects简单）

| 武器ID | 名称 | trigger | target | effects | 备注 |
|--------|------|---------|--------|---------|------|
| wpn_claym_0008 | 破碎君王 | on_heavy_attack | self | ATK+28% 8s | |
| wpn_sword_0006 | 熔铸火焰 | on_ultimate | self | attack_dmg+210% 20s | |
| wpn_sword_0005 | 钢铁余音 | on_physical_anomaly | self | ATK+21%×2 20s icd:0.1 | |
| wpn_sword_0015 | 仰止 | on_knockup | self | physical+33.6%×3 dur:null icd:0.5 | dur:null=永久? |
| wpn_sword_0020 | 逐鳞3.0 | on_freeze_apply | enemy | cold+19.6% 15s | |
| wpn_sword_0008 | 应急手段 | on_skill_hit | self | ATK+33.6% 20s | |
| wpn_sword_0009 | 浪潮 | on_link | self | ATK+33.6% 20s | |
| wpn_sword_0014 | 白夜新星 | on_burning_or_conductive | self | arts_power+70+arts+33.6% 15s | arts_power需特殊处理 |
| wpn_claym_0011 | 探骊 | on_arts_burst | self | ATK+16.8%×3 30s icd:0.1 | |
| wpn_claym_0003 | 工业零点一 | on_skill_hit | self | ATK+33.6% 20s | |
| wpn_claym_0009 | 淬火者 | on_heavy_attack | self | ATK+33.6% 10s | |
| wpn_lance_0011 | J.E.T. | on_skill | self | arts+33.6% 15s | |
| wpn_lance_0006 | 向心之引 | on_link | self | emag+28%×3 dur:null | |
| wpn_lance_0008 | 天使杀手 | on_skill_hit | self | ATK+33.6% 20s | |
| wpn_pistol_0008 | 楔子(1st) | on_skill | self | arts+22.4% 15s | |
| wpn_pistol_0004 | 理性告别 | on_burning_apply | self | ATK+44.8% 15s | |
| wpn_pistol_0002 | 呼啸守卫 | on_skill_hit | self | ATK+33.6% 20s | |
| wpn_pistol_0003 | 长路 | on_link | self | ATK+33.6% 20s | |
| wpn_funnel_0004 | 迷失荒野 | on_conductive_apply | team | phys_emag+emag 22.4% 15s | 双属性需拆分 |
| wpn_funnel_0006 | 作品：蚀象 | on_nature_attach | others | arts+14% 15s | |
| wpn_funnel_0008 | 骑士精神 | on_arts_burst | enemy | arts+25.2% 15s | |
| wpn_funnel_0009 | 遗忘 | on_ultimate | self | arts+67.2% 15s | |
| wpn_funnel_0011 | 使命必达 | on_link_knockup | team | arts+33.6% 15s | |
| wpn_funnel_0005 | 悼亡诗 | on_ultimate | self | ATK+22.4% 20s | |
| wpn_funnel_0003 | 荧光雷羽 | on_skill_hit | self | ATK+33.6% 20s | |
| wpn_sword_0017 | 光荣记忆 | on_physical_anomaly | self | ult_dmg+33.6%×3 30s icd:0.5 | |
| wpn_pistol_0011 | 落草(1st) | on_cold_attach | self | cold+56% 20s | |

### 需新增trigger映射后可自动实现

| 武器ID | 名称 | trigger | target | effects | 需新增映射 |
|--------|------|---------|--------|---------|-----------|
| wpn_sword_0018 | 十二问 | on_arts_anomaly_consume | self | ATK+21%×2 20s | 消耗异常事件 |
| wpn_pistol_0009 | 同类相食 | on_arts_anomaly_consume | enemy | element+28%易伤 15s icd:25 | 消耗异常+element_dmg映射 |
| wpn_sword_0016 | 不知归 | on_skill_sp_restore | others | physical+14%×5 30s icd:0.1 | SP恢复事件 |
| wpn_sword_0019 | O.B.J.轻芒 | on_skill_sp_restore | team | blaze_emag+emag 8.4%×3 20s | SP恢复+双属性 |
| wpn_lance_0004 | 嵌合正义 | on_break_apply_no_existing | self | ATK+42% 15s | 破防条件 |
| wpn_lance_0013 | O.B.J.尖峰 | on_freeze_consume | self | ATK+33.6% 15s | 消耗冻结 |
| wpn_pistol_0006 | 作品：众生 | on_arts_anomaly_apply | self | ATK+21%×2 20s icd:0.1 | 施加异常 |
| wpn_pistol_0008 | 楔子(2nd) | on_skill_arts_anomaly_apply | self | arts+44.8% 15s | 战技施加异常 |
| wpn_pistol_0010 | 艺术暴君 | on_skill_or_link_crit | self | cold+39.2%×3 30s icd:0.1 | 暴击事件 |
| wpn_funnel_0013 | 沧溟星梦 | on_corrosion_consume | enemy | arts+28% 25s | 消耗腐蚀 |
| wpn_funnel_0014 | O.B.J.术识 | on_link_burst_or_physical_anomaly | team | blaze_emag+emag 22.4% 15s | 复合条件 |
| wpn_claym_0015 | O.B.J.重荷 | on_knockdown_or_weaken | self | defense+50.4 15s | 击倒/虚弱+防御stat |
| wpn_lance_0012 | 负山 | on_skill_break/fragile | self | all_ability+22.4% 15s | 破防/脆弱+属性 |
| wpn_sword_0012 | 热熔切割器 | on_skill_sp_restore_or_combo | team | ATK+14%×2 20s | SP恢复/连击 |
| wpn_sword_0021 | 宏愿 | on_crystal_or_freeze_apply | self | physical+100.8% dur:null | 结晶/冻结 |
| wpn_pistol_0005 | 领航者 | condition_freeze_or_corrosion | self | cold_nature+nature+crit 15s | 场上条件检测 |

### 需特殊处理或暂不可实现

| 武器ID | 名称 | 原因 |
|--------|------|------|
| wpn_sword_0010 | 黯色火炬 | _unknown trigger |
| wpn_sword_0013 | 显赫声名 | on_break_consume + empty effects (复杂逻辑) |
| wpn_claym_0006 | 昔日精品 | on_shielded_ally_damaged (需护盾+受击系统) |
| wpn_claym_0007 | 大雷斑 | on_link_heal (需治疗系统) |
| wpn_claym_0013 | 赫拉芬格 | _unknown trigger ×2 |
| wpn_claym_0014 | 古渠 | on_break_consume + empty effects |
| wpn_pistol_0007 | 望乡 | _unknown trigger |
| wpn_pistol_0011 | 落草(2nd) | _unknown trigger |
| wpn_pistol_0012 | O.B.J.迅极 | on_arts_attach_consume + empty effects |
| wpn_funnel_0010 | 爆破单元 | on_skill_heal (需治疗系统) |
| wpn_funnel_0012 | 布道自由 | on_skill_heal (需治疗系统) |
| wpn_lance_0003 | 寻路者道标 | condition_hp_above_80pct (需HP系统) |
| wpn_funnel_0001 | 全自动骇新星 | condition_hp_above_80pct (需HP系统) |
| wpn_lance_0010 | 骁勇 | on_physical_anomaly + empty effects (复杂逻辑) |
| wpn_lance_0012 | 负山 | all_ability stat (需属性加成处理) |

---

## 装备套装 (21个分类，4个已实现)

### 已实现
- 点剑 (dianjian): 物理异常后额外伤害+失衡
- 动火用 (donghuoyong): 施加燃烧/腐蚀后+50%灼热/自然增伤
- 脉冲式 (maichongshi): 施加导电/冻结后+50%电磁/寒冷增伤
- 潮涌 (chaoyong): 附着≥2层后+35%法术增伤

### 未实现（需人工确认3件套效果后实现）

以下套装在 gamedata.json 中没有 set bonus 数据库条目。需要手动补充 3 件套效果描述后才能实现。

| 分类 | 推测3件套效果 | 状态 |
|------|-------------|------|
| 长息 | ? | 需确认 |
| 天灾防护 | ? | 需确认 |
| M.I.警用 | ? | 需确认 |
| 武陵 | ? | 需确认 |
| 生物辅助 | ? | 需确认 |
| 蚀电屏蔽 | ? | 需确认 |
| 蚀电防护 | ? | 需确认 |
| 轻超域 | ? | 需确认 |
| 重装信徒 | ? | 需确认 |
| 50式应龙 | ? | 需确认 |
| 四号谷地 | ? | 需确认 |
| 巡行信使 | ? | 需确认 |
| 拓荒 | ? | 需确认 |
| 碾骨 | ? | 需确认 |
| 野外生物 | ? | 需确认 |
| 阿伯莉遗声 | ? | 需确认 |
| 集成轻型 | ? | 需确认 |
| 集成重型 | ? | 需确认 |
| 沧贼 | ? | 需确认 |
