/**
 * V2 Equipment Set Definitions
 *
 * 21 equipment sets. Each has:
 * - passiveStats: 2-piece set bonus (already flows through track.stats, listed here for reference)
 * - triggers: 3-piece set trigger effects (converted to PassiveTrigger[] for V2 kernel)
 *
 * Triggers reuse the same WeaponTrigger format from weapons/types.ts.
 */

import type { WeaponTrigger } from "../weapons/types";
import type { PassiveTrigger } from "../types";
import { convertWeaponTriggers, expandTiers as t } from "../weapons/converter";

// ═══════════════════════════════════════════════════════════════════
// Equipment Set Definition
// ═══════════════════════════════════════════════════════════════════

export interface EquipmentSetDefinition {
  id: string;
  name: string;
  /** 2-piece passive stats (for reference; actual values flow via track.stats). */
  passiveStats: Record<string, number>;
  /** 3-piece triggered effects. */
  triggers: WeaponTrigger[];
}

// ═══════════════════════════════════════════════════════════════════
// Converter — reuses weapon converter infrastructure
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert equipment set triggers to V2 PassiveTrigger format.
 * Uses the same conversion logic as weapons (tier index is always max = 8).
 */
export function convertSetTriggers(setDef: EquipmentSetDefinition): PassiveTrigger[] {
  if (setDef.triggers.length === 0) return [];
  // Equipment sets always use max tier values (no per-tier scaling)
  const fakeWeapon = {
    id: setDef.id, name: setDef.name, type: "equipment", rarity: 0, baseAtk: 0,
    commonSlots: [], passiveStats: [], triggers: setDef.triggers,
  };
  return convertWeaponTriggers(fakeWeapon, 8); // tier index 8 = max tier
}

// ═══════════════════════════════════════════════════════════════════
// Set Definitions
// ═══════════════════════════════════════════════════════════════════

// ── 点剑 (Dianjian) ──
// 3pc: 施加物理异常后，额外造成自身攻击力250%物理伤害+10失衡，15s ICD
// TODO: extra damage, not a stat buff — needs custom kernel support
const dianjian: EquipmentSetDefinition = {
  id: "dianjian", name: "点剑",
  passiveStats: { physical_dmg: 28 },
  triggers: [], // TODO: extra damage (250% ATK physical) on physical_anomaly, 15s ICD
};

// ── 动火用 (Donghuoyong) ──
// 3pc: 施加燃烧→炎伤+50% 10s / 施加腐蚀→自然伤+50% 10s
const donghuoyong: EquipmentSetDefinition = {
  id: "donghuoyong", name: "动火用",
  passiveStats: { originium_arts_power: 30 },
  triggers: [
    { id: "donghuoyong_blaze", name: "动火用(炎)", listenTo: "burn_applied", target: "self",
      stat: "blaze_dmg", zone: "dmgBonus", values: t(50), duration: 10, maxStacks: 1, stackMode: "refresh", icd: 0 },
    { id: "donghuoyong_nature", name: "动火用(自然)", listenTo: "corrosion_applied", target: "self",
      stat: "nature_dmg", zone: "dmgBonus", values: t(50), duration: 10, maxStacks: 1, stackMode: "refresh", icd: 0 },
  ],
};

// ── 脉冲式 (Maichongshi) ──
// 3pc: 施加导电→电磁伤+50% 10s / 施加冻结→寒冷伤+50% 10s
const maichongshi: EquipmentSetDefinition = {
  id: "maichongshi", name: "脉冲式",
  passiveStats: { originium_arts_power: 30 },
  triggers: [
    { id: "maichongshi_emag", name: "脉冲式(电)", listenTo: "conduction_applied", target: "self",
      stat: "emag_dmg", zone: "dmgBonus", values: t(50), duration: 10, maxStacks: 1, stackMode: "refresh", icd: 0 },
    { id: "maichongshi_cold", name: "脉冲式(冷)", listenTo: "freeze_applied", target: "self",
      stat: "cold_dmg", zone: "dmgBonus", values: t(50), duration: 10, maxStacks: 1, stackMode: "refresh", icd: 0 },
  ],
};

// ── 潮涌 (Chaoyong) ──
// 3pc: 法术附着层数≥2时，法术伤害+35% 15s
const chaoyong: EquipmentSetDefinition = {
  id: "chaoyong", name: "潮涌",
  passiveStats: { arts_dmg: 28 },
  triggers: [
    { id: "chaoyong_buff", name: "潮涌", listenTo: "attachment_applied", target: "self",
      condition: { type: "enemy_has_attachment_min_stacks", params: { minStacks: 2 } },
      stat: "arts_dmg", zone: "dmgBonus", values: t(35), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 },
  ],
};

// ── M.I.警用 (MI Jingyong) ──
// 3pc: 暴击时ATK+5%×5层(5s)独立计时，5层时额外暴击+5%(5s)
// TODO: complex stacking + conditional extra buff at max stacks
const mi_jingyong: EquipmentSetDefinition = {
  id: "mi_jingyong", name: "M.I.警用",
  passiveStats: { crit_rate: 5 },
  triggers: [], // TODO: crit stacking ATK + crit rate at max stacks
};

// ── 拓荒 (Tuohuang) ──
// 3pc: 通过伤害恢复SP后，全队造成的伤害+16% 15s
const tuohuang: EquipmentSetDefinition = {
  id: "tuohuang", name: "拓荒",
  passiveStats: { link_cd_reduction: 15 },
  triggers: [
    { id: "tuohuang_buff", name: "拓荒", listenTo: "sp_restored",
      condition: { type: "source_is_skill", params: {} },
      target: "team", stat: "all_dmg", zone: "dmgBonus", values: t(16), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 },
  ],
};

// ── 碾骨 (Niangu) ──
// 3pc: 连携技施放→获得层数，下次战技+30%（最多2层，消耗型）
const niangu: EquipmentSetDefinition = {
  id: "niangu", name: "碾骨",
  passiveStats: { attack_percent: 15 },
  triggers: [
    { id: "niangu_buff", name: "碾骨重压", listenTo: "link_hit", target: "self",
      stat: "all_dmg", zone: "dmgBonus", values: t(30), duration: 999, maxStacks: 2, stackMode: "independent", icd: 0,
      consumeOnSkillType: ["skill"] },
  ],
};

// ── 50式应龙 (Yinglong) ──
// 3pc: 任意队友战技施放→装备者获得层数，下次连携技+20%（最多3层，消耗型）
const yinglong: EquipmentSetDefinition = {
  id: "yinglong", name: "50式应龙",
  passiveStats: { attack_percent: 15 },
  triggers: [
    { id: "yinglong_buff", name: "应龙之锐", listenTo: "skill_hit",
      sourceMustBeOwner: false, // any ally's skill
      target: "self", stat: "all_dmg", zone: "dmgBonus", values: t(20), duration: 999, maxStacks: 3, stackMode: "independent", icd: 0,
      consumeOnSkillType: ["link"] },
  ],
};

// ── 阿伯莉遗声 (Aboli) ──
// 3pc: 战技/连携技/终结技施放 → 各自独立ATK+5% 15s
const aboli: EquipmentSetDefinition = {
  id: "aboli", name: "阿伯莉遗声",
  passiveStats: { all_skill_dmg_bonus: 24 },
  triggers: [
    { id: "aboli_skill", name: "遗声(技)", listenTo: "skill_hit", target: "self",
      stat: "all_dmg", zone: "attackPercent", values: t(5), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 },
    { id: "aboli_link", name: "遗声(连)", listenTo: "link_hit", target: "self",
      stat: "all_dmg", zone: "attackPercent", values: t(5), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 },
    { id: "aboli_ult", name: "遗声(终)", listenTo: "ultimate_hit", target: "self",
      stat: "all_dmg", zone: "attackPercent", values: t(5), duration: 15, maxStacks: 1, stackMode: "refresh", icd: 0 },
  ],
};

// ── 轻超域 (Qingchaoyu) ──
// 3pc: 施加破防层数→物理伤+8%×4层(15s)独立计时，4层时额外物理伤+16%(10s)
// TODO: conditional extra buff at 4 stacks
const qingchaoyu: EquipmentSetDefinition = {
  id: "qingchaoyu", name: "轻超域",
  passiveStats: { attack_percent: 8 },
  triggers: [
    { id: "qingchaoyu_stack", name: "超域强化", listenTo: "break_applied", target: "self",
      stat: "physical_dmg", zone: "dmgBonus", values: t(8), duration: 15, maxStacks: 4, stackMode: "independent", icd: 0 },
    // TODO: at 4 stacks → extra physical_dmg +16% for 10s
  ],
};

// ── 天灾防护 (Tianzai Fanghu) ──
// 3pc: 首次战技施放→返还50SP，全场一次
// TODO: one-time SP refund needs custom kernel support
const tianzai_fanghu: EquipmentSetDefinition = {
  id: "tianzai_fanghu", name: "天灾防护",
  passiveStats: { ult_charge_eff: 20 },
  triggers: [], // TODO: one-time 50 SP refund on first skill
};

// ── 长息 (Changxi) ──
// 3pc: 给队友施加增幅或脆弱效果时，队友造成伤害+16% 15s
const changxi: EquipmentSetDefinition = {
  id: "changxi", name: "长息",
  passiveStats: { hp: 1000 },
  triggers: [], // TODO: needs buff_applied event + check for amplify/fragility buff types
};

// ── 无触发效果的套装 ──
const wuling: EquipmentSetDefinition =          { id: "wuling", name: "武陵", passiveStats: {}, triggers: [] };
const sihaogu: EquipmentSetDefinition =          { id: "sihaogu", name: "四号谷地", passiveStats: {}, triggers: [] };
const jichengzhong: EquipmentSetDefinition =     { id: "jichengzhong", name: "集成重型", passiveStats: {}, triggers: [] };
const jichengqing: EquipmentSetDefinition =      { id: "jichengqing", name: "集成轻型", passiveStats: {}, triggers: [] };
const zhongzhuang: EquipmentSetDefinition =      { id: "zhongzhuang", name: "重装信徒", passiveStats: { strength: 50 }, triggers: [] };
const xunxing: EquipmentSetDefinition =          { id: "xunxing", name: "巡行信使", passiveStats: { agility: 50 }, triggers: [] };
const shidian_pingbi: EquipmentSetDefinition =   { id: "shidian_pingbi", name: "蚀电屏蔽", passiveStats: { intellect: 50 }, triggers: [] };
const shidian_fanghu: EquipmentSetDefinition =   { id: "shidian_fanghu", name: "蚀电防护", passiveStats: { will: 50 }, triggers: [] };
const shengwu: EquipmentSetDefinition =          { id: "shengwu", name: "生物辅助", passiveStats: { healing_effect: 20 }, triggers: [] };
// 野外生物 / 裂地者 / 天使 not in gamedata? If they exist, they also have no triggers.

// ═══════════════════════════════════════════════════════════════════
// Registry — keyed by Chinese category name (matches gamedata.json)
// ═══════════════════════════════════════════════════════════════════

export const V2_EQUIPMENT_SET_REGISTRY: Record<string, EquipmentSetDefinition> = {
  "点剑": dianjian,
  "动火用": donghuoyong,
  "脉冲式": maichongshi,
  "潮涌": chaoyong,
  "M.I.警用": mi_jingyong,
  "拓荒": tuohuang,
  "碾骨": niangu,
  "50式应龙": yinglong,
  "阿伯莉遗声": aboli,
  "轻超域": qingchaoyu,
  "天灾防护": tianzai_fanghu,
  "长息": changxi,
  "武陵": wuling,
  "四号谷地": sihaogu,
  "集成重型": jichengzhong,
  "集成轻型": jichengqing,
  "重装信徒": zhongzhuang,
  "巡行信使": xunxing,
  "蚀电屏蔽": shidian_pingbi,
  "蚀电防护": shidian_fanghu,
  "生物辅助": shengwu,
};
