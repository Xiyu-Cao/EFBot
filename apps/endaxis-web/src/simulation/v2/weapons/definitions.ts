/**
 * V2 Weapon Definitions
 *
 * Each weapon has passive stats (always active) and triggered effects.
 * Common slots (1st/2nd affixes) are defined by modifierId + size;
 * actual values are configured per-character in the editor.
 *
 * Per-tier arrays: 9 entries [tier1, tier2, ..., tier8, maxTier].
 * gamedata.json stores maxTier values; weaponBuffTiers.json has descriptions per tier.
 */

import type { WeaponDefinition } from "./types";

export { extractWeaponPassiveStats, convertWeaponTriggers, expandTiers } from "./converter";
import { expandTiers as t } from "./converter";

// ═══════════════════════════════════════════════════════════════════
// 宏愿 (wpn_sword_0021) — 6★ Sword
// ENDMINISTRATOR's signature weapon
//
// Passive: 源石技艺强度 +30~84
// Trigger: 施加源石结晶或冻结 → 20s内下次战技/终结技期间，物理伤害+36~100.8% (增伤区)
// ═══════════════════════════════════════════════════════════════════

export const wpn_sword_0021: WeaponDefinition = {
  id: "wpn_sword_0021",
  name: "宏愿",
  type: "sword",
  rarity: 6,
  baseAtk: 500,
  commonSlots: [
    { modifierId: "agility", size: "large" },
    { modifierId: "attack", size: "large" },
  ],
  passiveStats: [
    { stat: "originium_arts_power", values: [30, 36, 42, 48, 54, 60, 66, 72, 84] },
  ],
  triggers: [
    {
      id: "hongyuan_buff",
      name: "长愿",
      listenTo: "anomaly_applied",
      condition: { type: "applied_anomaly_or_buff", params: { types: ["endmin_debuff", "frozen"] } },
      target: "self",
      stat: "physical_dmg",
      zone: "dmgBonus",
      values: [36, 43.2, 50.4, 57.6, 64.8, 72, 79.2, 86.4, 100.8],
      duration: 20,
      maxStacks: 1,
      stackMode: "refresh",
      icd: 0,
      consumeOnSkillType: ["skill", "ultimate"],
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════
// 不知归 (wpn_sword_0016) — 6★ Sword
// POGRANICHNK's signature weapon
//
// Passive: 物理伤害 +16~44.8%
// Trigger: 通过技能恢复技力 → 自身物理伤害+5~14%, 队友+2.5~7%
//          30s, 最多5层独立计时, 0.1s ICD
// ═══════════════════════════════════════════════════════════════════

export const wpn_sword_0016: WeaponDefinition = {
  id: "wpn_sword_0016",
  name: "不知归",
  type: "sword",
  rarity: 6,
  baseAtk: 500,
  commonSlots: [
    { modifierId: "will", size: "large" },
    { modifierId: "attack", size: "large" },
  ],
  passiveStats: [
    { stat: "physical_dmg", values: [16, 19.2, 22.4, 25.6, 28.8, 32, 35.2, 38.4, 44.8] },
  ],
  triggers: [
    // Self buff
    {
      id: "buzhigui_self",
      name: "轮回",
      listenTo: "sp_restored",
      condition: { type: "source_is_skill", params: {} },
      target: "self",
      stat: "physical_dmg",
      zone: "dmgBonus",
      values: [5, 6, 7, 8, 9, 10, 11, 12, 14],
      duration: 30,
      maxStacks: 5,
      stackMode: "independent",
      icd: 0.1,
    },
    // Team buff (others only, half value)
    {
      id: "buzhigui_team",
      name: "轮回(共享)",
      listenTo: "sp_restored",
      condition: { type: "source_is_skill", params: {} },
      target: "others",
      stat: "physical_dmg",
      zone: "dmgBonus",
      values: [2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7],
      duration: 30,
      maxStacks: 5,
      stackMode: "independent",
      icd: 0.1,
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════
// 赫拉芬格 (wpn_claym_0013) — 6★ Claymore
// LASTRITE's signature weapon
//
// Passive: 所有技能伤害 +20~56%
// Trigger1: 战技施加寒冷附着 → 寒冷伤害+10~28%, 15s
// Trigger2: 对寒冷附着敌人造成连携技伤害 → 寒冷伤害+20~56%, 15s
// ═══════════════════════════════════════════════════════════════════

export const wpn_claym_0013: WeaponDefinition = {
  id: "wpn_claym_0013",
  name: "赫拉芬格",
  type: "claym",
  rarity: 6,
  baseAtk: 505,
  commonSlots: [
    { modifierId: "strength", size: "large" },
    { modifierId: "cold_dmg", size: "large" },
  ],
  passiveStats: [
    { stat: "all_skill_dmg_bonus", values: [20, 24, 28, 32, 36, 40, 44, 48, 56] },
  ],
  triggers: [
    // Trigger 1: skill applies cold attachment
    {
      id: "helafenge_skill_cold",
      name: "切骨之寒(战技)",
      listenTo: "attachment_applied",
      condition: { type: "source_action_type_and_element", params: { actionType: "skill", element: "cold" } },
      target: "self",
      stat: "cold_dmg",
      zone: "dmgBonus",
      values: [10, 12, 14, 16, 18, 20, 22, 24, 28],
      duration: 15,
      maxStacks: 1,
      stackMode: "refresh",
      icd: 0,
    },
    // Trigger 2: link damage on cold-attached enemy
    {
      id: "helafenge_link_cold",
      name: "切骨之寒(连携)",
      listenTo: "link_hit",
      condition: { type: "enemy_has_attachment", params: { element: "cold" } },
      target: "self",
      stat: "cold_dmg",
      zone: "dmgBonus",
      values: [20, 24, 28, 32, 36, 40, 44, 48, 56],
      duration: 15,
      maxStacks: 1,
      stackMode: "refresh",
      icd: 0,
    },
  ],
};

// ═══════════════════════════════════════════════════════════════════
// Bulk weapon definitions (auto-generated from gamedata.json max-tier values)
// Trigger mapping: V1 trigger names → V2 TriggerEventType + TriggerCondition
// Weapons with unsupported triggers (HP/shield/heal/passive-condition) have triggers: []
// ═══════════════════════════════════════════════════════════════════

// ── Helper: inline weapon definition ──
function w(id: string, name: string, type: string, rarity: number, baseAtk: number,
  s0: string | null, s0s: "small" | "medium" | "large",
  s1: string | null, s1s: "small" | "medium" | "large",
  passiveStats: { stat: string; values: number[] }[],
  triggers: WeaponDefinition["triggers"],
): WeaponDefinition {
  return {
    id, name, type, rarity, baseAtk,
    commonSlots: [
      { modifierId: s0 || "", size: s0s },
      { modifierId: s1 || "", size: s1s },
    ],
    passiveStats,
    triggers,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Registry
// ═══════════════════════════════════════════════════════════════════

/** All V2 weapon definitions, keyed by weapon ID. */
export const V2_WEAPON_REGISTRY: Record<string, WeaponDefinition> = {
  // ── Hand-written (signature weapons with special mechanics) ──
  wpn_sword_0021: wpn_sword_0021, // 宏愿 (consumeOnAction)
  wpn_sword_0016: wpn_sword_0016, // 不知归 (self+others split)
  wpn_claym_0013: wpn_claym_0013, // 赫拉芬格 (compound triggers)

  // ═════════════════════════════════════════════════════════════
  // SWORD (剑)
  // ═════════════════════════════════════════════════════════════

  // 塔尔11 — 3★, no triggers
  wpn_sword_0003: w("wpn_sword_0003", "塔尔11", "sword", 3, 283, "primary_ability", "small", null, "small", [], []),

  // 钢铁余音 — 5★, on_physical_anomaly → ATK+21%
  wpn_sword_0005: w("wpn_sword_0005", "钢铁余音", "sword", 5, 411, "agility", "medium", "physical_dmg", "medium",
    [{ stat: "attack", values: t(14) }],
    [{ id: "gangtie_buff", name: "旧火余音", listenTo: "physical_anomaly", target: "self",
       stat: "all_dmg", zone: "attackPercent", values: t(21), duration: 20, maxStacks: 2, stackMode: "independent", icd: 0.1 }]),

  // 熔铸火焰 — 6★, on_ultimate → attack_dmg_bonus+210%
  wpn_sword_0006: w("wpn_sword_0006", "熔铸火焰", "sword", 6, 510, "intellect", "large", "attack", "large",
    [{ stat: "blaze_dmg", values: t(44.8) }],
    [{ id: "rongzhu_buff", name: "嘶鸣烈火", listenTo: "ultimate_hit", target: "self",
       stat: "attack_dmg_bonus", zone: "dmgBonus", values: t(210), duration: 20, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 坚城铸造者 — 5★, no triggers
  wpn_sword_0007: w("wpn_sword_0007", "坚城铸造者", "sword", 5, 411, "intellect", "medium", "ult_charge_eff", "medium",
    [{ stat: "attack", values: t(14) }, { stat: "originium_arts_power", values: t(70) }], []),

  // 显锋 — 4★, on_skill_hit → ATK+33.6%
  wpn_sword_0008: w("wpn_sword_0008", "显锋", "sword", 4, 341, "agility", "small", "physical_dmg", "small", [],
    [{ id: "xianfeng_buff", name: "应急强化", listenTo: "skill_hit", target: "self",
       stat: "all_dmg", zone: "attackPercent", values: t(33.6), duration: 20, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 浪潮 — 4★, on_link → ATK+33.6%
  wpn_sword_0009: w("wpn_sword_0009", "浪潮", "sword", 4, 341, "intellect", "small", "attack", "small", [],
    [{ id: "langchao_buff", name: "生生不息", listenTo: "link_hit", target: "self",
       stat: "all_dmg", zone: "attackPercent", values: t(33.6), duration: 20, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 黯色火炬 — 6★, condition_corrosion_on_enemy → passive condition, TODO
  wpn_sword_0010: w("wpn_sword_0010", "黯色火炬", "sword", 6, 490, "primary_ability", "large", "blaze_dmg", "large",
    [{ stat: "attack", values: t(19.6) }], []), // TODO: passive condition (corrosion on enemy)

  // 扶摇 — 6★, passive: 对失衡+98%, TODO (conditional passive)
  wpn_sword_0011: w("wpn_sword_0011", "扶摇", "sword", 6, 495, "agility", "large", "crit_rate", "large",
    [{ stat: "physical_dmg", values: t(42) }], []), // TODO: conditional passive (stagger state +98%)

  // 热熔切割器 — 6★, on_skill_sp_restore → team ATK+14%
  wpn_sword_0012: w("wpn_sword_0012", "热熔切割器", "sword", 6, 490, "will", "large", "attack", "large",
    [{ stat: "attack", values: t(28) }],
    [{ id: "rerong_buff", name: "高热解放", listenTo: "sp_restored", condition: { type: "source_is_skill", params: {} },
       target: "team", stat: "all_dmg", zone: "attackPercent", values: t(14), duration: 20, maxStacks: 2, stackMode: "independent", icd: 0 }]),

  // 显赫声名 — 6★, on_break_consume(slam/armorBreak) →
  //   self:   ATK +[14% + 7% × consumed stacks]
  //   others: ATK +[7%  + 3.5% × consumed stacks]
  //   20s, maxStacks 1 refresh
  wpn_sword_0013: w("wpn_sword_0013", "显赫声名", "sword", 6, 490, "agility", "large", "physical_dmg", "large",
    [{ stat: "attack", values: t(28) }],
    [
      { id: "xianhe_self", name: "显赫声名", listenTo: "physical_anomaly",
        condition: { type: "physical_anomaly_type", params: { physicalTypes: ["slam", "armorBreak"] } },
        target: "self", stat: "attack", zone: "attackPercent",
        values: t(7),                  // 7% per consumed stack at max tier
        valueAdditions: t(14),          // fixed 14% at max tier
        valueScaleBy: "event.stacks",
        duration: 20, maxStacks: 1, stackMode: "refresh", icd: 0 },
      { id: "xianhe_others", name: "显赫声名(共享)", listenTo: "physical_anomaly",
        condition: { type: "physical_anomaly_type", params: { physicalTypes: ["slam", "armorBreak"] } },
        target: "others", stat: "attack", zone: "attackPercent",
        values: t(3.5),
        valueAdditions: t(7),
        valueScaleBy: "event.stacks",
        duration: 20, maxStacks: 1, stackMode: "refresh", icd: 0 },
    ]),

  // 白夜新星 — 6★, on_burning_or_conductive → arts_dmg+33.6%
  wpn_sword_0014: w("wpn_sword_0014", "白夜新星", "sword", 6, 505, "intellect", "large", "originium_arts_power", "large",
    [{ stat: "arts_dmg", values: t(33.6) }],
    [
      // Trigger on burn applied
      { id: "baiye_burn", name: "白夜新星(燃烧)", listenTo: "burn_applied", target: "self",
        stat: "arts_dmg", zone: "dmgBonus", values: t(33.6), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 },
      // Trigger on conduction applied
      { id: "baiye_cond", name: "白夜新星(导电)", listenTo: "conduction_applied", target: "self",
        stat: "arts_dmg", zone: "dmgBonus", values: t(33.6), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 },
      // TODO: originium_arts_power+70 in 特殊系数 zone (not a standard buff zone)
    ]),

  // 仰止 — 5★, on_knockup → physical_dmg+33.6%
  wpn_sword_0015: w("wpn_sword_0015", "仰止", "sword", 5, 411, "agility", "medium", "physical_dmg", "medium",
    [{ stat: "ultimate_dmg_bonus", values: t(44.8) }],
    [{ id: "yangzhi_buff", name: "高山仰止", listenTo: "physical_anomaly",
       condition: { type: "physical_anomaly_type", params: { physicalTypes: ["launch"] } },
       target: "self", stat: "physical_dmg", zone: "dmgBonus", values: t(33.6), duration: 999, maxStacks: 3, stackMode: "independent", icd: 0.5 }]),

  // 光荣记忆 — 6★, on_physical_anomaly → consumeOnAction ultimate, ult_dmg+33.6% ×3
  wpn_sword_0017: w("wpn_sword_0017", "光荣记忆", "sword", 6, 490, "agility", "large", "crit_rate", "large",
    [{ stat: "attack", values: t(19.6) }],
    [{ id: "guangrong_buff", name: "光荣记忆", listenTo: "physical_anomaly", target: "self",
       stat: "ultimate_dmg_bonus", zone: "dmgBonus", values: t(33.6), duration: 30, maxStacks: 3, stackMode: "independent", icd: 0.5,
       consumeOnSkillType: ["ultimate"] }]),

  // 十二问 — 5★, on_arts_anomaly_consume → ATK+21%
  wpn_sword_0018: w("wpn_sword_0018", "十二问", "sword", 5, 411, "agility", "medium", "attack", "medium",
    [{ stat: "secondary_ability", values: t(14) }],
    [{ id: "shierwen_buff", name: "竭心诘问", listenTo: "anomaly_consumed", target: "self",
       stat: "all_dmg", zone: "attackPercent", values: t(21), duration: 20, maxStacks: 2, stackMode: "independent", icd: 0 }]),

  // O.B.J.轻芒 — 5★, on_skill_sp_restore → team blaze+emag dmg+8.4%
  wpn_sword_0019: w("wpn_sword_0019", "O.B.J.轻芒", "sword", 5, 411, "agility", "medium", "attack", "medium",
    [{ stat: "secondary_ability", values: t(14) }],
    [
      { id: "qingmang_blaze", name: "不羁锋芒(炎)", listenTo: "sp_restored", condition: { type: "source_is_skill", params: {} },
        target: "team", stat: "blaze_dmg", zone: "dmgBonus", values: t(8.4), duration: 20, maxStacks: 3, stackMode: "independent", icd: 0 },
      { id: "qingmang_emag", name: "不羁锋芒(电)", listenTo: "sp_restored", condition: { type: "source_is_skill", params: {} },
        target: "team", stat: "emag_dmg", zone: "dmgBonus", values: t(8.4), duration: 20, maxStacks: 3, stackMode: "independent", icd: 0 },
    ]),

  // 逐鳞3.0 — 5★, on_freeze_apply → enemy cold_dmg debuff
  wpn_sword_0020: w("wpn_sword_0020", "逐鳞3.0", "sword", 5, 411, "strength", "medium", "ult_charge_eff", "medium",
    [{ stat: "attack", values: t(14) }],
    [{ id: "zhulin_buff", name: "逐鳞意", listenTo: "freeze_applied", target: "enemy",
       stat: "cold_dmg", zone: "dmgBonus", values: t(19.6), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 狼之绯 — 6★, no triggers
  wpn_sword_0022: w("wpn_sword_0022", "狼之绯", "sword", 6, 495, "agility", "large", "crit_rate", "large", [], []),

  // ═════════════════════════════════════════════════════════════
  // CLAYMORE (大剑)
  // ═════════════════════════════════════════════════════════════

  // 工业零点一 — 4★, on_skill_hit → ATK+33.6%
  wpn_claym_0003: w("wpn_claym_0003", "工业零点一", "claym", 4, 341, "strength", "small", "attack", "small", [],
    [{ id: "gongye_buff", name: "应急强化", listenTo: "skill_hit", target: "self",
       stat: "all_dmg", zone: "attackPercent", values: t(33.6), duration: 20, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 典范 — 6★, on_skill_or_ultimate_hit → physical_dmg+28% ×3, TODO: complex stacking
  wpn_claym_0004: w("wpn_claym_0004", "典范", "claym", 6, 500, "strength", "large", "attack", "large",
    [{ stat: "physical_dmg", values: t(28) }],
    [
      { id: "dianfan_skill", name: "多层斩断(技)", listenTo: "skill_hit", target: "self",
        stat: "physical_dmg", zone: "dmgBonus", values: t(28), duration: 30, maxStacks: 3, stackMode: "independent", icd: 0.1 },
      { id: "dianfan_ult", name: "多层斩断(终)", listenTo: "ultimate_hit", target: "self",
        stat: "physical_dmg", zone: "dmgBonus", values: t(28), duration: 30, maxStacks: 3, stackMode: "independent", icd: 0.1 },
    ]),

  // 昔日精品 — 6★, on_shielded_ally_damaged → needs shield system, TODO
  wpn_claym_0006: w("wpn_claym_0006", "昔日精品", "claym", 6, 495, "will", "large", "hp", "large",
    [{ stat: "healing_effect", values: t(28) }], []), // TODO: shield system

  // 大雷斑 — 6★, on_link_heal → needs heal system, TODO
  wpn_claym_0007: w("wpn_claym_0007", "大雷斑", "claym", 6, 495, "strength", "large", "hp", "large",
    [{ stat: "shield_effect", values: t(67.2) }], []), // TODO: heal/shield system

  // 破碎君王 — 6★, on_heavy_attack → ATK+28%
  wpn_claym_0008: w("wpn_claym_0008", "破碎君王", "claym", 6, 490, "strength", "large", "crit_rate", "large", [],
    [{ id: "posui_buff", name: "君王威慑", listenTo: "heavy_attack_hit", target: "self",
       stat: "all_dmg", zone: "attackPercent", values: t(28), duration: 8, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 淬火者 — 4★, on_heavy_attack → ATK+33.6%
  wpn_claym_0009: w("wpn_claym_0009", "淬火者", "claym", 4, 341, "will", "small", "hp", "small", [],
    [{ id: "cuihuo_buff", name: "淬砺成兵", listenTo: "heavy_attack_hit", target: "self",
       stat: "all_dmg", zone: "attackPercent", values: t(33.6), duration: 10, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 达尔霍夫7 — 3★, no triggers
  wpn_claym_0010: w("wpn_claym_0010", "达尔霍夫7", "claym", 3, 283, "primary_ability", "small", null, "small", [], []),

  // 探骊 — 5★, on_arts_burst → ATK+16.8%
  wpn_claym_0011: w("wpn_claym_0011", "探骊", "claym", 5, 411, "strength", "medium", "ult_charge_eff", "medium",
    [{ stat: "primary_ability", values: t(14) }],
    [{ id: "tanli_buff", name: "钩玄猎秘", listenTo: "magic_burst", target: "self",
       stat: "all_dmg", zone: "attackPercent", values: t(16.8), duration: 30, maxStacks: 3, stackMode: "independent", icd: 0.1 }]),

  // 终点之声 — 5★, no triggers (passive: 连携技治疗+56%)
  wpn_claym_0012: w("wpn_claym_0012", "终点之声", "claym", 5, 411, "strength", "medium", "hp", "medium",
    [{ stat: "secondary_ability", values: t(14) }], []), // TODO: link heal bonus

  // 古渠 — 5★, on_break_consume(slam/armorBreak) →
  //   physical_dmg +[14% × consumed stacks], 20s, maxStacks 1 refresh
  wpn_claym_0014: w("wpn_claym_0014", "古渠", "claym", 5, 411, "strength", "medium", "originium_arts_power", "medium",
    [{ stat: "originium_arts_power", values: t(28) }],
    [
      { id: "guqu_buff", name: "古渠", listenTo: "physical_anomaly",
        condition: { type: "physical_anomaly_type", params: { physicalTypes: ["slam", "armorBreak"] } },
        target: "self", stat: "physical_dmg", zone: "dmgBonus",
        values: t(14),
        valueScaleBy: "event.stacks",
        duration: 20, maxStacks: 1, stackMode: "refresh", icd: 0 },
    ]),

  // O.B.J.重荷 — 5★, on_knockdown_or_weaken → defense+50.4%, TODO (defense buff)
  wpn_claym_0015: w("wpn_claym_0015", "O.B.J.重荷", "claym", 5, 411, "strength", "medium", "hp", "medium",
    [{ stat: "secondary_ability", values: t(14) }], []), // TODO: defense buff

  // ═════════════════════════════════════════════════════════════
  // LANCE (矛)
  // ═════════════════════════════════════════════════════════════

  // 寻路者道标 — 4★, condition_hp_above_80pct → TODO
  wpn_lance_0003: w("wpn_lance_0003", "寻路者道标", "lance", 4, 341, "agility", "small", "attack", "small",
    [], []), // TODO: HP system

  // 嵌合正义 — 5★, on_break_apply_no_existing → ATK+42%
  wpn_lance_0004: w("wpn_lance_0004", "嵌合正义", "lance", 5, 411, "strength", "medium", "ult_charge_eff", "medium",
    [{ stat: "crit_rate", values: t(8.4) }],
    [{ id: "qianhe_buff", name: "愤怒接合", listenTo: "break_applied",
       condition: { type: "first_break", params: {} },
       target: "self", stat: "all_dmg", zone: "attackPercent", values: t(42), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 向心之引 — 5★, on_link → emag_dmg+28%
  wpn_lance_0006: w("wpn_lance_0006", "向心之引", "lance", 5, 411, "will", "medium", "emag_dmg", "medium",
    [{ stat: "link_dmg_bonus", values: t(28) }],
    [{ id: "xiangxin_buff", name: "同心圆", listenTo: "link_hit", target: "self",
       stat: "emag_dmg", zone: "dmgBonus", values: t(28), duration: 999, maxStacks: 3, stackMode: "independent", icd: 0 }]),

  // 天使杀手 — 4★, on_skill_hit → ATK+33.6%
  wpn_lance_0008: w("wpn_lance_0008", "天使杀手", "lance", 4, 341, "will", "small", "arts_dmg", "small", [],
    [{ id: "tianshi_buff", name: "应急强化", listenTo: "skill_hit", target: "self",
       stat: "all_dmg", zone: "attackPercent", values: t(33.6), duration: 20, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 奥佩罗77 — 3★, no triggers
  wpn_lance_0009: w("wpn_lance_0009", "奥佩罗77", "lance", 3, 283, "primary_ability", "small", null, "small", [], []),

  // 骁勇 — 6★, on_physical_anomaly → extra 336% ATK damage, TODO (not a buff)
  wpn_lance_0010: w("wpn_lance_0010", "骁勇", "lance", 6, 495, "agility", "large", "physical_dmg", "large",
    [{ stat: "attack", values: t(28) }], []), // TODO: extra damage, not a stat buff

  // J.E.T. — 6★, on_skill → arts_dmg+33.6%
  wpn_lance_0011: w("wpn_lance_0011", "J.E.T.", "lance", 6, 500, "will", "large", "attack", "large",
    [{ stat: "arts_dmg", values: t(33.6) }],
    [{ id: "jet_buff", name: "太空物理学", listenTo: "skill_hit", target: "self",
       stat: "arts_dmg", zone: "dmgBonus", values: t(33.6), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 负山 — 6★, passive: 破防状态+56%, compound triggers, TODO
  wpn_lance_0012: w("wpn_lance_0012", "负山", "lance", 6, 500, "agility", "large", "physical_dmg", "large",
    [], []), // TODO: conditional passive (break state +56%) + all_ability buff triggers

  // O.B.J.尖峰 — 5★, on_freeze_consume → ATK+33.6%
  wpn_lance_0013: w("wpn_lance_0013", "O.B.J.尖峰", "lance", 5, 411, "will", "medium", "physical_dmg", "medium", [],
    [{ id: "jianfeng_buff", name: "攀越冰峰", listenTo: "anomaly_consumed",
       condition: { type: "consumed_anomaly_type", params: { anomalyType: "frozen" } },
       target: "self", stat: "all_dmg", zone: "attackPercent", values: t(33.6), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // ═════════════════════════════════════════════════════════════
  // PISTOL (枪)
  // ═════════════════════════════════════════════════════════════

  // 佩科5 — 3★, no triggers
  wpn_pistol_0001: w("wpn_pistol_0001", "佩科5", "pistol", 3, 283, "primary_ability", "small", null, "small", [], []),

  // 呼啸守卫 — 4★, on_skill_hit → ATK+33.6%
  wpn_pistol_0002: w("wpn_pistol_0002", "呼啸守卫", "pistol", 4, 341, "intellect", "small", "attack", "small", [],
    [{ id: "huxiao_buff", name: "应急强化", listenTo: "skill_hit", target: "self",
       stat: "all_dmg", zone: "attackPercent", values: t(33.6), duration: 20, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 长路 — 4★, on_link → ATK+33.6%
  wpn_pistol_0003: w("wpn_pistol_0003", "长路", "pistol", 4, 341, "strength", "small", "arts_dmg", "small", [],
    [{ id: "changlu_buff", name: "生生不息", listenTo: "link_hit", target: "self",
       stat: "all_dmg", zone: "attackPercent", values: t(33.6), duration: 20, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 理性告别 — 5★, on_burning_apply → ATK+44.8%
  wpn_pistol_0004: w("wpn_pistol_0004", "理性告别", "pistol", 5, 411, "strength", "medium", "blaze_dmg", "medium",
    [{ stat: "skill_dmg_bonus", values: t(28) }],
    [{ id: "lixing_buff", name: "旧时之援", listenTo: "burn_applied", target: "self",
       stat: "all_dmg", zone: "attackPercent", values: t(44.8), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 领航者 — 6★, condition_freeze_or_corrosion_on_field → passive condition, TODO
  wpn_pistol_0005: w("wpn_pistol_0005", "领航者", "pistol", 6, 490, "primary_ability", "large", "ult_charge_eff", "large",
    [{ stat: "crit_rate", values: t(9.8) }], []), // TODO: passive condition

  // 作品：众生 — 5★, on_arts_anomaly_apply → ATK+21%
  wpn_pistol_0006: w("wpn_pistol_0006", "作品：众生", "pistol", 5, 411, "agility", "medium", "arts_dmg", "medium",
    [{ stat: "crit_rate", values: t(8.4) }],
    [{ id: "zhongsheng_buff", name: "众生的归途", listenTo: "anomaly_applied", target: "self",
       stat: "all_dmg", zone: "attackPercent", values: t(21), duration: 20, maxStacks: 2, stackMode: "independent", icd: 0.1 }]),

  // 望乡 — 6★, on_link → cold_dmg+22.4% + nature_dmg+22.4%
  wpn_pistol_0007: w("wpn_pistol_0007", "望乡", "pistol", 6, 490, "agility", "large", "cold_dmg", "large",
    [{ stat: "attack", values: t(19.6) }],
    [
      { id: "wangxiang_cold", name: "望乡(冷)", listenTo: "link_hit", target: "self",
        stat: "cold_dmg", zone: "dmgBonus", values: t(22.4), duration: 20, maxStacks: 2, stackMode: "independent", icd: 0 },
      { id: "wangxiang_nature", name: "望乡(自然)", listenTo: "link_hit", target: "self",
        stat: "nature_dmg", zone: "dmgBonus", values: t(22.4), duration: 20, maxStacks: 2, stackMode: "independent", icd: 0 },
    ]),

  // 楔子 — 6★, on_skill → arts_dmg+22.4%, on_skill_arts_anomaly → arts_dmg+44.8%
  wpn_pistol_0008: w("wpn_pistol_0008", "楔子", "pistol", 6, 500, "intellect", "large", "attack", "large",
    [{ stat: "arts_dmg", values: t(33.6) }],
    [
      { id: "xiezi_skill", name: "文明楔子(技)", listenTo: "skill_hit", target: "self",
        stat: "arts_dmg", zone: "dmgBonus", values: t(22.4), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 },
      { id: "xiezi_anomaly", name: "文明楔子(异常)", listenTo: "anomaly_applied",
        condition: { type: "source_action_type", params: { actionType: "skill" } },
        target: "self", stat: "arts_dmg", zone: "dmgBonus", values: t(44.8), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 },
    ]),

  // 同类相食 — 6★, on_arts_anomaly_consume → enemy vulnerability, TODO (vulnerability zone)
  wpn_pistol_0009: w("wpn_pistol_0009", "同类相食", "pistol", 6, 490, "strength", "large", "attack", "large",
    [{ stat: "arts_dmg", values: t(33.6) }], []), // TODO: enemy vulnerability debuff + 25s ICD

  // 艺术暴君 — 6★, on_skill_or_link_crit → cold_dmg+39.2%
  wpn_pistol_0010: w("wpn_pistol_0010", "艺术暴君", "pistol", 6, 505, "intellect", "large", "crit_rate", "large",
    [{ stat: "cold_dmg", values: t(44.8) }],
    [
      { id: "yishu_skill_crit", name: "艺术暴论(技)", listenTo: "skill_hit",
        condition: { type: "crit_hit", params: {} },
        target: "self", stat: "cold_dmg", zone: "dmgBonus", values: t(39.2), duration: 30, maxStacks: 3, stackMode: "independent", icd: 0.1 },
      { id: "yishu_link_crit", name: "艺术暴论(连)", listenTo: "link_hit",
        condition: { type: "crit_hit", params: {} },
        target: "self", stat: "cold_dmg", zone: "dmgBonus", values: t(39.2), duration: 30, maxStacks: 3, stackMode: "independent", icd: 0.1 },
    ]),

  // 落草 — 6★, on_skill_or_ultimate_cold_attach + spell_vulnerable
  wpn_pistol_0011: w("wpn_pistol_0011", "落草", "pistol", 6, 505, null, "small", null, "small",
    [{ stat: "cold_dmg", values: t(44.8) }],
    [
      // Trigger 1: skill/ultimate cold attachment → cold_dmg+56%
      { id: "luocao_skill_cold", name: "落草(技冷)", listenTo: "attachment_applied",
        condition: { type: "source_action_type_and_element", params: { actionType: "skill", element: "cold" } },
        target: "self", stat: "cold_dmg", zone: "dmgBonus", values: t(56), duration: 20, maxStacks: 1, stackMode: "refresh", icd: 0 },
      { id: "luocao_ult_cold", name: "落草(终冷)", listenTo: "attachment_applied",
        condition: { type: "source_action_type_and_element", params: { actionType: "ultimate", element: "cold" } },
        target: "self", stat: "cold_dmg", zone: "dmgBonus", values: t(56), duration: 20, maxStacks: 1, stackMode: "refresh", icd: 0 },
      // TODO: Trigger 2: on_skill_or_ultimate_spell_vulnerable → enemy arts_dmg debuff
    ]),

  // O.B.J.迅极 — 5★, on_arts_attach_consume → dynamic formula, TODO
  wpn_pistol_0012: w("wpn_pistol_0012", "O.B.J.迅极", "pistol", 5, 411, "agility", "medium", "ult_charge_eff", "medium",
    [{ stat: "attack", values: t(14) }], []), // TODO: nature_dmg+[14%×consumed stacks]

  // ═════════════════════════════════════════════════════════════
  // FUNNEL (法杖)
  // ═════════════════════════════════════════════════════════════

  // 全自动骇新星 — 4★, condition_hp_above_80pct → TODO
  wpn_funnel_0001: w("wpn_funnel_0001", "全自动骇新星", "funnel", 4, 341, "intellect", "small", "attack", "small",
    [], []), // TODO: HP system

  // 吉米尼12 — 3★, no triggers
  wpn_funnel_0002: w("wpn_funnel_0002", "吉米尼12", "funnel", 3, 283, "primary_ability", "small", null, "small", [], []),

  // 荧光雷羽 — 4★, on_skill_hit → ATK+33.6%
  wpn_funnel_0003: w("wpn_funnel_0003", "荧光雷羽", "funnel", 4, 341, "will", "small", "attack", "small", [],
    [{ id: "yingguang_buff", name: "应急强化", listenTo: "skill_hit", target: "self",
       stat: "all_dmg", zone: "attackPercent", values: t(33.6), duration: 20, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 迷失荒野 — 5★, on_conductive_apply → team emag_dmg+22.4%
  wpn_funnel_0004: w("wpn_funnel_0004", "迷失荒野", "funnel", 5, 411, "intellect", "medium", "emag_dmg", "medium",
    [{ stat: "originium_arts_power", values: t(28) }],
    [
      { id: "mishi_emag", name: "荒芜集簇(电)", listenTo: "conduction_applied", target: "team",
        stat: "emag_dmg", zone: "dmgBonus", values: t(22.4), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 },
      { id: "mishi_phys", name: "荒芜集簇(物)", listenTo: "conduction_applied", target: "team",
        stat: "physical_dmg", zone: "dmgBonus", values: t(22.4), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 },
    ]),

  // 悼亡诗 — 5★, on_ultimate → ATK+22.4%
  wpn_funnel_0005: w("wpn_funnel_0005", "悼亡诗", "funnel", 5, 411, "intellect", "medium", "attack", "medium",
    [{ stat: "hp", values: t(56) }],
    [{ id: "daowang_buff", name: "冢火成莹", listenTo: "ultimate_hit", target: "self",
       stat: "all_dmg", zone: "attackPercent", values: t(22.4), duration: 20, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 作品：蚀迹 — 6★, on_nature_attach → others arts_dmg+14%
  wpn_funnel_0006: w("wpn_funnel_0006", "作品：蚀迹", "funnel", 6, 485, "primary_ability", "large", "attack", "large",
    [{ stat: "attack", values: t(19.6) }],
    [{ id: "shiji_buff", name: "碛岩蚀痕", listenTo: "attachment_applied",
       condition: { type: "attachment_element", params: { element: "nature" } },
       target: "others", stat: "arts_dmg", zone: "dmgBonus", values: t(14), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 莫奈何 — 5★, no triggers
  wpn_funnel_0007: w("wpn_funnel_0007", "莫奈何", "funnel", 5, 411, "will", "medium", "ult_charge_eff", "medium",
    [{ stat: "primary_ability", values: t(14) }, { stat: "originium_arts_power", values: t(70) }], []),

  // 骑士精神 — 6★, on_skill_heal → team ATK+25.2%, TODO (heal system)
  wpn_funnel_0008: w("wpn_funnel_0008", "骑士精神", "funnel", 6, 490, "will", "large", "hp", "large",
    [{ stat: "healing_effect", values: t(28) }], []), // TODO: heal system

  // 遗忘 — 6★, on_ultimate → arts_dmg+67.2%
  wpn_funnel_0009: w("wpn_funnel_0009", "遗忘", "funnel", 6, 495, "intellect", "large", "attack", "large",
    [{ stat: "crit_rate", values: t(14) }],
    [{ id: "yiwang_buff", name: "耻辱", listenTo: "ultimate_hit", target: "self",
       stat: "arts_dmg", zone: "dmgBonus", values: t(67.2), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 爆破单元 — 6★, on_arts_burst → enemy arts_dmg debuff
  wpn_funnel_0010: w("wpn_funnel_0010", "爆破单元", "funnel", 6, 485, "intellect", "large", "originium_arts_power", "large",
    [{ stat: "secondary_ability", values: t(28) }],
    [{ id: "baopo_buff", name: "侵蚀性狂热", listenTo: "magic_burst", target: "enemy",
       stat: "arts_dmg", zone: "dmgBonus", values: t(25.2), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 使命必达 — 6★, on_link_knockup → team arts_dmg+33.6%
  wpn_funnel_0011: w("wpn_funnel_0011", "使命必达", "funnel", 6, 500, "will", "large", "ult_charge_eff", "large",
    [{ stat: "nature_dmg", values: t(44.8) }],
    [{ id: "shiming_buff", name: "不辱使命", listenTo: "physical_anomaly",
       condition: { type: "physical_anomaly_type", params: { physicalTypes: ["launch"] } },
       target: "team", stat: "arts_dmg", zone: "dmgBonus", values: t(33.6), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // 布道自由 — 5★, on_skill_heal → needs heal system, TODO
  wpn_funnel_0012: w("wpn_funnel_0012", "布道自由", "funnel", 5, 411, "will", "medium", "healing_effect", "medium",
    [{ stat: "primary_ability", values: t(14) }], []), // TODO: heal system

  // 沧溟星梦 — 6★, on_corrosion_consume → enemy arts_dmg debuff
  wpn_funnel_0013: w("wpn_funnel_0013", "沧溟星梦", "funnel", 6, 495, "intellect", "large", "healing_effect", "large",
    [{ stat: "secondary_ability", values: t(44.8) }],
    [{ id: "cangming_buff", name: "潮汐低语", listenTo: "anomaly_consumed",
       condition: { type: "consumed_anomaly_type", params: { anomalyType: "corrosion" } },
       target: "enemy", stat: "arts_dmg", zone: "dmgBonus", values: t(28), duration: 25, maxStacks: 1, stackMode: "refresh", icd: 0 }]),

  // O.B.J.术识 — 5★, on_link_burst_or_physical_anomaly → team blaze+emag dmg
  wpn_funnel_0014: w("wpn_funnel_0014", "O.B.J.术识", "funnel", 5, 411, "intellect", "medium", "originium_arts_power", "medium",
    [{ stat: "hp", values: t(56) }],
    [
      // Trigger on magic_burst from link
      { id: "shushi_burst_blaze", name: "术法升华(爆炎)", listenTo: "magic_burst", target: "team",
        stat: "blaze_dmg", zone: "dmgBonus", values: t(22.4), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 },
      { id: "shushi_burst_emag", name: "术法升华(爆电)", listenTo: "magic_burst", target: "team",
        stat: "emag_dmg", zone: "dmgBonus", values: t(22.4), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 },
      // Trigger on physical_anomaly
      { id: "shushi_phys_blaze", name: "术法升华(物炎)", listenTo: "physical_anomaly", target: "team",
        stat: "blaze_dmg", zone: "dmgBonus", values: t(22.4), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 },
      { id: "shushi_phys_emag", name: "术法升华(物电)", listenTo: "physical_anomaly", target: "team",
        stat: "emag_dmg", zone: "dmgBonus", values: t(22.4), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 },
    ]),
};
