/**
 * POGRANICHNK (骏卫) — V2 Complete Character Data
 *
 * Element: physical
 * Weapon type: single-handed sword
 * Main attribute: will, Sub attribute: agility
 */

import type { Skill, PassiveTrigger, DamageElement } from "../types";

const f = (frames: number) => frames / 60;

// ═══════════════════════════════════════════════════════════════════
// Part 1: Static Character Data
// ═══════════════════════════════════════════════════════════════════

export const identity = {
  id: "POGRANICHNK",
  name: "骏卫",
  nameEn: "Pogranichnik",
  rarity: 6,
  profession: "pioneer",
  element: "physical" as DamageElement,
  weaponType: "sword",
  mainAttribute: "will" as const,
  subAttribute: "agility" as const,
  maxPotential: 5,
};

export const promotionCaps = [20, 40, 60, 80, 90];

export { default as levelStats } from "../../../data/operators/POGRANICHNK/stats.json";
export { default as skillData } from "../../../data/operators/POGRANICHNK/skills.json";

export const talents = [
  {
    id: "talent_0",
    name: "活着的旗帜",
    stages: [
      { promotion: 1, description: "每恢复80点技力后，获得士气激昂(ATK+4%,源石技艺+4)，20s，最多3层独立计时", value: { atkPercent: 4, artsPower: 4 }, spThreshold: 80, maxStacks: 3, duration: 20 },
      { promotion: 2, description: "每恢复80点技力后，获得士气激昂(ATK+8%,源石技艺+8)，20s，最多3层独立计时", value: { atkPercent: 8, artsPower: 8 }, spThreshold: 80, maxStacks: 3, duration: 20 },
    ],
  },
  {
    id: "talent_1",
    name: "战术教导",
    stages: [
      { promotion: 2, description: "任意干员触发铁誓后续效果后，也获得5s士气激昂", duration: 5 },
      { promotion: 3, description: "任意干员触发铁誓后续效果后，也获得10s士气激昂", duration: 10 },
    ],
  },
];

export const potentials = [
  {
    level: 1, name: "阵线扫荡",
    description: "战技命中至少两个敌人时，返还15点技力",
    effects: [{ type: "sp_refund" as const, trigger: "skill_multi_target", value: 15 }],
  },
  {
    level: 2, name: "行军",
    description: "意志+20，物理伤害+10%",
    effects: [
      { type: "stat_bonus" as const, stat: "will", value: 20 },
      { type: "damage_bonus" as const, stat: "physical_dmg", value: 10 },
    ],
  },
  {
    level: 3, name: "战旗飘扬时",
    description: "士气激昂所需技力恢复量60点，最大叠加+2层",
    effects: [{ type: "talent_enhance" as const, talent: "talent_0", spThreshold: 60, maxStacks: 5 }],
  },
  {
    level: 4, name: "塔卫二之盾",
    description: "终结技所需能量-15%",
    effects: [{ type: "gauge_modifier" as const, stat: "ult_gauge_cost", value: -15 }],
  },
  {
    level: 5, name: "新铸剑锋",
    description: "连携技CD-2s，技力恢复量×1.2",
    effects: [
      { type: "cooldown_modifier" as const, stat: "link", value: -2 },
      { type: "sp_recovery_mult" as const, stat: "link", value: 1.2 },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
// Part 2: Kernel Effects
// ═══════════════════════════════════════════════════════════════════

// ── Attack segments ──

const a1: Skill = {
  id: "pograni_a1", type: "attack", name: "A1",
  element: "physical", duration: f(29), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(17), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第一段倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a2: Skill = {
  id: "pograni_a2", type: "attack", name: "A2",
  element: "physical", duration: f(48), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(16), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第二段倍率", share: 0.5 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(32), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第二段倍率", share: 0.5 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a3: Skill = {
  id: "pograni_a3", type: "attack", name: "A3",
  element: "physical", duration: f(49), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(18), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第三段倍率", share: 0.5 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(32), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第三段倍率", share: 0.5 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a4: Skill = {
  id: "pograni_a4", type: "attack", name: "A4",
  element: "physical", duration: f(43), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(8), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 1/6 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(12), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 1/6 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(16), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 1/6 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(24), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 1/6 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(28), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 1/6 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(33), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 1/6 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a5: Skill = {
  id: "pograni_a5", type: "attack", name: "A5（重击）", isHeavyAttack: true,
  element: "physical", duration: f(69), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(35), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第五段倍率", share: 1 }, stagger: 18, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const execution: Skill = {
  id: "pograni_execution", type: "execution", name: "处决",
  element: "physical", duration: f(140), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(16), checkpointIndex: 0, damage: { multiplierRef: { label: "处决攻击倍率", share: 0.1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(35), checkpointIndex: 0, damage: { multiplierRef: { label: "处决攻击倍率", share: 0.1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(66), checkpointIndex: 0, damage: { multiplierRef: { label: "处决攻击倍率", share: 0.8 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [{ type: "sp_restore", params: { amount: 100, isTrueSP: true, fromExecutionRecovery: true } }], standardLogic: true },
  ],
  checkpoints: [],
};

const aerialAttack: Skill = {
  id: "pograni_aerial", type: "attack", name: "下落攻击",
  element: "physical", duration: f(85), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(51), checkpointIndex: 0, damage: { multiplierRef: { label: "下落攻击倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

// ── Skill (战技: 粉碎阵线) ──
// 2 hits: hit1 stagger, hit2 stagger + armorBreak

const skill: Skill = {
  id: "pograni_skill", type: "skill", name: "粉碎阵线",
  element: "physical", duration: f(137), spCost: 100, cooldown: 0,
  hits: [
    {
      offset: f(57), checkpointIndex: 0,
      damage: { multiplierRef: { label: "第一段伤害倍率", share: 1 }, stagger: 5, element: "physical", canCrit: true, school: "physical", sourceType: "skill" },
      effects: [],
      standardLogic: true,
    },
    {
      offset: f(86), checkpointIndex: 0,
      damage: { multiplierRef: { label: "第二段伤害倍率", share: 1 }, stagger: 5, element: "physical", canCrit: true, school: "physical", sourceType: "skill" },
      effects: [{ type: "physical_anomaly", params: { physicalType: "armorBreak" } }],
      standardLogic: true,
    },
  ],
  checkpoints: [],
};

// ── Link variants (连携技: 盈月邀击) ──
// Variant depends on consumed break stacks (1-4)

const linkBreak1: Skill = {
  id: "pograni_link_1", type: "link", name: "盈月邀击·一",
  element: "physical", duration: f(108), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(47), checkpointIndex: 0, damage: { multiplierRef: { label: "第一段伤害倍率", share: 1 }, stagger: 3, element: "physical", canCrit: true, school: "physical", sourceType: "link" }, effects: [{ type: "sp_restore", params: { amountRef: "第一段技力恢复", isTrueSP: true } }], standardLogic: true },
  ],
  checkpoints: [],
};

const linkBreak2: Skill = {
  id: "pograni_link_2", type: "link", name: "盈月邀击·二",
  element: "physical", duration: f(118), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(49), checkpointIndex: 0, damage: { multiplierRef: { label: "第一段伤害倍率", share: 1 }, stagger: 3, element: "physical", canCrit: true, school: "physical", sourceType: "link" }, effects: [{ type: "sp_restore", params: { amountRef: "第一段技力恢复", isTrueSP: true } }], standardLogic: true },
    { offset: f(85), checkpointIndex: 0, damage: { multiplierRef: { label: "第二段伤害倍率", share: 1 }, stagger: 3, element: "physical", canCrit: true, school: "physical", sourceType: "link" }, effects: [{ type: "sp_restore", params: { amountRef: "第二段技力恢复", isTrueSP: true } }], standardLogic: true },
  ],
  checkpoints: [],
};

const linkBreak3: Skill = {
  id: "pograni_link_3", type: "link", name: "盈月邀击·三",
  element: "physical", duration: f(207), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(47), checkpointIndex: 0, damage: { multiplierRef: { label: "第一段伤害倍率", share: 1 }, stagger: 3, element: "physical", canCrit: true, school: "physical", sourceType: "link" }, effects: [{ type: "sp_restore", params: { amountRef: "第一段技力恢复", isTrueSP: true } }], standardLogic: true },
    { offset: f(85), checkpointIndex: 0, damage: { multiplierRef: { label: "第二段伤害倍率", share: 1 }, stagger: 3, element: "physical", canCrit: true, school: "physical", sourceType: "link" }, effects: [{ type: "sp_restore", params: { amountRef: "第二段技力恢复", isTrueSP: true } }], standardLogic: true },
    { offset: f(142), checkpointIndex: 0, damage: { multiplierRef: { label: "第三段伤害倍率", share: 1 }, stagger: 4, element: "physical", canCrit: true, school: "physical", sourceType: "link" }, effects: [{ type: "sp_restore", params: { amountRef: "第三段技力恢复", isTrueSP: true } }], standardLogic: true },
  ],
  checkpoints: [],
};

const linkBreak4: Skill = {
  id: "pograni_link_4", type: "link", name: "盈月邀击·四",
  element: "physical", duration: f(207), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(47), checkpointIndex: 0, damage: { multiplierRef: { label: "第一段伤害倍率", share: 1 }, stagger: 3, element: "physical", canCrit: true, school: "physical", sourceType: "link" }, effects: [{ type: "sp_restore", params: { amountRef: "第一段技力恢复", isTrueSP: true } }], standardLogic: true },
    { offset: f(85), checkpointIndex: 0, damage: { multiplierRef: { label: "第二段伤害倍率", share: 1 }, stagger: 3, element: "physical", canCrit: true, school: "physical", sourceType: "link" }, effects: [{ type: "sp_restore", params: { amountRef: "第二段技力恢复", isTrueSP: true } }], standardLogic: true },
    { offset: f(142), checkpointIndex: 0, damage: { multiplierRef: { label: "强化第三段伤害倍率", share: 1 }, stagger: 9, element: "physical", canCrit: true, school: "physical", sourceType: "link" }, effects: [{ type: "sp_restore", params: { amountRef: "强化第三段技力恢复", isTrueSP: true } }], standardLogic: true },
  ],
  checkpoints: [],
};

// ── Ultimate (终结技: 盾卫旗队，上前) ──
// Hit 1 is the main attack. Hits 2-6 (铁誓 consumption) are trigger-driven.

const ultimate: Skill = {
  id: "pograni_ultimate", type: "ultimate", name: "盾卫旗队，上前",
  element: "physical", duration: f(183), spCost: 0, cooldown: 0,
  hits: [
    {
      offset: f(157), checkpointIndex: 0,
      damage: { multiplierRef: { label: "进军伤害倍率", share: 1 }, stagger: 10, element: "physical", canCrit: true, school: "physical", sourceType: "ultimate" },
      effects: [
        { type: "stack_buff_apply", params: { buffType: "pograni_buff", stacks: 5, durationRef: "铁誓持续时间" } },
      ],
      standardLogic: true,
    },
  ],
  checkpoints: [],
  gaugeCost: 90,
  teamGaugeGain: 0,
};

export const ultimateAnimation = f(153);

// ── Passive Triggers ──

/**
 * 铁誓消耗 — 袭扰: triggered by physical anomaly or link damage while 铁誓 > 1.
 * 38f delay from trigger event. Deals damage + restores SP.
 */
const ironOathRaid: PassiveTrigger = {
  id: "pograni_iron_oath_raid",
  source: "铁誓_袭扰",
  listenTo: "physical_anomaly",
  deferred: false,
  sourceMustBeOwner: false,
  condition: { type: "actor_has_stack_buff", params: { buffType: "pograni_buff", op: ">", value: 1 } },
  actions: [
    { type: "stack_buff_consume", params: { buffType: "pograni_buff", stacks: 1 } },
    { type: "delayed_damage", params: { delay: f(38), multiplierRef: "袭扰伤害倍率", stagger: 0, element: "physical", school: "physical" } },
    { type: "sp_restore", params: { amountRef: "袭扰恢复技力", isTrueSP: true, delay: f(38) } },
  ],
};

/**
 * 铁誓消耗 — 决胜: triggered when last 铁誓 is consumed.
 * 72f delay from trigger event. Deals heavy damage + restores SP + stagger.
 */
const ironOathFinale: PassiveTrigger = {
  id: "pograni_iron_oath_finale",
  source: "铁誓_决胜",
  listenTo: "physical_anomaly",
  deferred: false,
  sourceMustBeOwner: false,
  condition: { type: "actor_has_stack_buff", params: { buffType: "pograni_buff", op: "==", value: 1 } },
  actions: [
    { type: "stack_buff_consume", params: { buffType: "pograni_buff", stacks: 1 } },
    { type: "delayed_damage", params: { delay: f(72), multiplierRef: "决胜伤害倍率", stagger: 15, element: "physical", school: "physical" } },
    { type: "sp_restore", params: { amountRef: "决胜恢复技力", isTrueSP: true, delay: f(72) } },
  ],
};

/**
 * 活着的旗帜 — 每恢复80点技力(P3:60)获得士气激昂，最多3层(P3:5)，20s独立计时
 */
const livingBanner: PassiveTrigger = {
  id: "pograni_living_banner",
  source: "talent_活着的旗帜",
  listenTo: "sp_restored",
  deferred: false,
  sourceMustBeOwner: true,
  actions: [
    { type: "conditional_stack_buff", params: { buffType: "pograni_talent", spThresholdRef: "talent_0", maxStacksRef: "talent_0" } },
  ],
};

/**
 * 战术教导 — 铁誓后续效果触发后，触发者也获得士气激昂
 */
const tacticalGuidance: PassiveTrigger = {
  id: "pograni_tactical_guidance",
  source: "talent_战术教导",
  listenTo: "stack_buff_consumed",
  deferred: true,
  sourceMustBeOwner: false,
  condition: { type: "consumed_buff", params: { buffId: "pograni_buff" } },
  actions: [
    { type: "buff_apply", params: { buffId: "pograni_tactical_morale", target: "trigger_source", stat: "attack_percent", zone: "attackPercent", valueRef: "talent_0", durationRef: "talent_1" } },
  ],
};

// ── Interrupt exception ──
export const interruptOverrides = {
  skillCanInterruptLink: true,  // 战技和连携可互相打断（非默认）
};

/**
 * 铁誓消耗 — 袭扰 (by link): triggered by POGRANICHNK's own link hit.
 */
const ironOathRaidByLink: PassiveTrigger = {
  ...ironOathRaid,
  id: "pograni_iron_oath_raid_link",
  listenTo: "link_hit",
  sourceMustBeOwner: true,
};

/**
 * 铁誓消耗 — 决胜 (by link): triggered when last 铁誓 consumed by link.
 */
const ironOathFinaleByLink: PassiveTrigger = {
  ...ironOathFinale,
  id: "pograni_iron_oath_finale_link",
  listenTo: "link_hit",
  sourceMustBeOwner: true,
};

// ═══════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════

export const skills = {
  attack: [a1, a2, a3, a4, a5, execution, aerialAttack],
  skill,
  link: [linkBreak1, linkBreak2, linkBreak3, linkBreak4],
  ultimate,
};

export const triggers: PassiveTrigger[] = [
  ironOathRaid,
  ironOathFinale,
  ironOathRaidByLink,
  ironOathFinaleByLink,
  livingBanner,
  tacticalGuidance,
];
