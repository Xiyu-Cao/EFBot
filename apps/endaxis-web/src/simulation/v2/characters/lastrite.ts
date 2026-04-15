/**
 * LASTRITE (别礼) — V2 Complete Character Data
 *
 * Element: cold
 * Weapon type: claymore (双手剑)
 * Main attribute: strength, Sub attribute: will
 */

import type { Skill, PassiveTrigger, DamageElement } from "../types";

const f = (frames: number) => frames / 60;

// ═══════════════════════════════════════════════════════════════════
// Part 1: Static Character Data
// ═══════════════════════════════════════════════════════════════════

export const identity = {
  id: "LASTRITE",
  name: "别礼",
  nameEn: "Last Rite",
  rarity: 6,
  profession: "vanguard",
  element: "cold" as DamageElement,
  weaponType: "claym",
  mainAttribute: "strength" as const,
  subAttribute: "will" as const,
  maxPotential: 5,
};

export const promotionCaps = [20, 40, 60, 80, 90];

export { default as levelStats } from "../../../data/operators/LASTRITE/stats.json";
export { default as skillData } from "../../../data/operators/LASTRITE/skills.json";

export const talents = [
  {
    id: "talent_0",
    name: "低温症",
    stages: [
      { promotion: 1, description: "消耗法术附着后，施加寒冷脆弱=层数×2%，15s", valuePerLayer: 2, zone: "fragility" as const, duration: 15 },
      { promotion: 2, description: "消耗法术附着后，施加寒冷脆弱=层数×4%，15s", valuePerLayer: 4, zone: "fragility" as const, duration: 15 },
    ],
  },
  {
    id: "talent_1",
    name: "低温脆性",
    stages: [
      { promotion: 2, description: "终结技造成伤害时，寒冷脆弱效果视为×1.2", amplify: 1.2, zone: "fragility" as const },
      { promotion: 3, description: "终结技造成伤害时，寒冷脆弱效果视为×1.5", amplify: 1.5, zone: "fragility" as const },
    ],
  },
];

export const potentials = [
  {
    level: 1, name: "守墓人之赠",
    description: "低温灌注下，重击额外+20%伤害(增伤区)+5失衡",
    effects: [
      { type: "heavy_attack_buff" as const, dmgBonus: 20, stagger: 5, condition: "low_temp_infusion" },
    ],
  },
  {
    level: 2, name: "零度武装",
    description: "力量+20，寒冷伤害+10%",
    effects: [
      { type: "stat_bonus" as const, stat: "strength", value: 20 },
      { type: "damage_bonus" as const, stat: "cold_dmg", value: 10 },
    ],
  },
  {
    level: 3, name: "统御严冬",
    description: "连携技和终结技倍率×1.15",
    effects: [{ type: "multiplier_scaling" as const, skills: ["link", "ultimate"], value: 1.15 }],
  },
  {
    level: 4, name: "诚挚告别",
    description: "终结技所需能量-15%",
    effects: [{ type: "gauge_modifier" as const, stat: "ult_gauge_cost", value: -15 }],
  },
  {
    level: 5, name: "寒风再起",
    description: "战技返还技力+5，幻影追击倍率×1.2",
    effects: [
      { type: "sp_bonus" as const, stat: "skill", value: 5 },
      { type: "multiplier_scaling" as const, skills: ["phantom"], value: 1.2 },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
// Part 2: Kernel Effects
// ═══════════════════════════════════════════════════════════════════

// ── Attack segments ──

const a1: Skill = {
  id: "lastrite_a1", type: "attack", name: "A1",
  element: "cold", duration: f(55), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(25), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第一段倍率", share: 1 }, stagger: 0, element: "cold", canCrit: true, school: "magic", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a2: Skill = {
  id: "lastrite_a2", type: "attack", name: "A2",
  element: "cold", duration: f(67), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(19), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第二段倍率", share: 0.5 }, stagger: 0, element: "cold", canCrit: true, school: "magic", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(52), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第二段倍率", share: 0.5 }, stagger: 0, element: "cold", canCrit: true, school: "magic", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a3: Skill = {
  id: "lastrite_a3", type: "attack", name: "A3",
  element: "cold", duration: f(100), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(19), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第三段倍率", share: 0.5 }, stagger: 0, element: "cold", canCrit: true, school: "magic", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(66), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第三段倍率", share: 0.5 }, stagger: 0, element: "cold", canCrit: true, school: "magic", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a4: Skill = {
  id: "lastrite_a4", type: "attack", name: "A4（重击）", isHeavyAttack: true,
  element: "cold", duration: f(130), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(45), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 1 }, stagger: 25, element: "cold", canCrit: true, school: "magic", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const execution: Skill = {
  id: "lastrite_execution", type: "execution", name: "处决",
  element: "cold", duration: f(135), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(82), checkpointIndex: 0, damage: { multiplierRef: { label: "处决攻击倍率", share: 1 }, stagger: 0, element: "cold", canCrit: true, school: "magic", sourceType: "attack" }, effects: [{ type: "sp_restore", params: { amount: 100, isTrueSP: true, fromExecutionRecovery: true } }], standardLogic: true },
  ],
  checkpoints: [],
};

const aerialAttack: Skill = {
  id: "lastrite_aerial", type: "attack", name: "下落攻击",
  element: "cold", duration: f(88), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(50), checkpointIndex: 0, damage: { multiplierRef: { label: "下落攻击倍率", share: 1 }, stagger: 0, element: "cold", canCrit: true, school: "magic", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

// ── Skill (战技: 塞什卡的秘传) ──
// Buff-type skill with 3 modes: normal, in-attack-chain, non-mc

const skill: Skill = {
  id: "lastrite_skill", type: "skill", name: "塞什卡的秘传",
  element: "cold", duration: f(103), spCost: 100, cooldown: 0,
  hits: [
    {
      offset: f(71), checkpointIndex: 0,
      damage: null, // no damage, pure buff
      effects: [
        { type: "sp_restore", params: { amountRef: "返还技力", isTrueSP: false } },
        { type: "buff_apply", params: { buffId: "lastrite_low_temp_infusion", target: "mainControl", durationRef: "持续时间（秒）" } },
      ],
      standardLogic: true,
    },
  ],
  checkpoints: [],
};

// Skill special properties
export const skillModes = {
  /** 主控非普攻连段: duration=103f, detach=14f, buff at 71f */
  normal: { duration: f(103), detachOffset: f(14) },
  /** 主控普攻连段中: duration=0f, buff immediately */
  inAttackChain: { duration: 0, detachOffset: 0 },
  /** 非主控: duration=125f, buff immediately */
  nonMainControl: { duration: f(125), detachOffset: 0 },
  /** 内置CD: 主控70f, 非主控125f */
  internalCooldown: { mainControl: f(70), nonMainControl: f(125) },
};

// ── Link (连携技: 噬冬) ──

const link: Skill = {
  id: "lastrite_link", type: "link", name: "噬冬",
  element: "cold", duration: f(202), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(28), checkpointIndex: 0, damage: { multiplierRef: { label: "伤害倍率", share: 1 }, stagger: 0, element: "cold", canCrit: true, school: "magic", sourceType: "link" }, effects: [], standardLogic: true },
    {
      offset: f(128), checkpointIndex: 0,
      damage: { multiplierRef: { label: "消耗每层附着额外伤害倍率", share: 1 }, stagger: 15, element: "cold", canCrit: true, school: "magic", sourceType: "link" },
      effects: [
        { type: "consume_attachment", params: { element: "cold" } },
      ],
      standardLogic: false, // custom: damage multiplied by consumed layers, consumption after damage
    },
  ],
  checkpoints: [],
};

// ── Ultimate (终结技: 临终别礼) ──

const ultimate: Skill = {
  id: "lastrite_ultimate", type: "ultimate", name: "临终别礼",
  element: "cold", duration: f(343), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(175), checkpointIndex: 0, damage: { multiplierRef: { label: "第一段伤害倍率", share: 1 }, stagger: 5, element: "cold", canCrit: true, school: "magic", sourceType: "ultimate" }, effects: [], standardLogic: true },
    { offset: f(212), checkpointIndex: 0, damage: { multiplierRef: { label: "第二段伤害倍率", share: 1 }, stagger: 5, element: "cold", canCrit: true, school: "magic", sourceType: "ultimate" }, effects: [], standardLogic: true },
    { offset: f(271), checkpointIndex: 0, damage: { multiplierRef: { label: "第三段伤害倍率", share: 1 }, stagger: 10, element: "cold", canCrit: true, school: "magic", sourceType: "ultimate" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
  gaugeCost: 300,
  teamGaugeGain: 0,
};

export const ultimateAnimation = f(171);

// ── Passive Triggers ──

/**
 * 低温症 — 消耗法术附着后施加寒冷脆弱 (fragility zone)
 * Deferred: fires after damage that consumed the attachment.
 */
const hypothermia: PassiveTrigger = {
  id: "lastrite_hypothermia",
  source: "talent_低温症",
  listenTo: "attachment_consumed",
  deferred: true,
  sourceMustBeOwner: true,
  actions: [
    { type: "buff_apply", params: { buffId: "lastrite_cold_fragility", target: "enemy", stat: "cold_dmg", zone: "fragility", valuePerLayerRef: "talent_0", duration: 15 } },
  ],
};

/**
 * 低温脆性 — 终结技伤害时寒冷脆弱效果放大 (×1.2/1.5)
 * Applied as damage modifier during ultimate hits only.
 */
const coldFragility: PassiveTrigger = {
  id: "lastrite_cold_fragility_amp",
  source: "talent_低温脆性",
  listenTo: "ultimate_hit",
  deferred: false,
  sourceMustBeOwner: true,
  condition: { type: "enemy_has_buff", params: { buffId: "lastrite_cold_fragility" } },
  actions: [
    { type: "fragility_amplify", params: { stat: "cold_dmg", amplifyRef: "talent_1" } },
  ],
};

/**
 * 低温灌注 — 重击命中后 19f 触发幻影追击 (寒冷伤害 + 寒冷附着)
 * P1: 重击增伤区+20%, 失衡+5 (applied to heavy attack, not phantom)
 */
const coldInfusionPhantom: PassiveTrigger = {
  id: "lastrite_phantom",
  source: "低温灌注_幻影追击",
  listenTo: "heavy_attack_hit",
  deferred: true,
  sourceMustBeOwner: false, // triggers on main control's heavy attack
  condition: { type: "actor_has_buff", params: { buffId: "lastrite_low_temp_infusion" } },
  actions: [
    { type: "delayed_damage", params: { delay: f(19), multiplierRef: "幻影追击伤害倍率", stagger: 0, element: "cold", school: "magic" } },
    { type: "magic_attachment", params: { element: "cold", stacks: 1, delay: f(19) } },
    { type: "buff_consume", params: { buffId: "lastrite_low_temp_infusion", stacks: 1 } },
  ],
};

// ═══════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════

export const skills = {
  attack: [a1, a2, a3, a4, execution, aerialAttack],
  skill,
  link,
  ultimate,
};

export const triggers: PassiveTrigger[] = [
  hypothermia,
  coldFragility,
  coldInfusionPhantom,
];
