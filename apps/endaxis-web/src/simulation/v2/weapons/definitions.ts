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
