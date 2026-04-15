/**
 * ENDMINISTRATOR (管理员) — V2 Complete Character Data
 *
 * Single source of truth for this character.
 * Part 1: Static data (identity, stats, skill multipliers, talents, potentials)
 * Part 2: Kernel effects (hit timing, triggers, special mechanics)
 */

import type { Skill, PassiveTrigger, DamageElement } from "../types";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

const f = (frames: number) => frames / 60;

// ═══════════════════════════════════════════════════════════════════
// Part 1: Static Character Data
// ═══════════════════════════════════════════════════════════════════

export const identity = {
  id: "ENDMINISTRATOR",
  name: "管理员",
  nameEn: "Endministrator",
  rarity: 6,
  profession: "guard",
  element: "physical" as DamageElement,
  weaponType: "sword",
  mainAttribute: "agility" as const,
  subAttribute: "strength" as const,
  maxPotential: 2,
};

/** Promotion stage caps: [E0 max, E1 max, E2 max, E3 max, E4 max] */
export const promotionCaps = [20, 40, 60, 80, 90];

/**
 * Per-level base stats. Key = character level.
 * Only a few levels shown — full table imported from stats.json at build time.
 * Format: { strength, agility, intellect, will, attack, hp }
 */
export { default as levelStats } from "../../../data/operators/ENDMINISTRATOR/stats.json";

// ── Skill multipliers (from skills.json) ──
export { default as skillData } from "../../../data/operators/ENDMINISTRATOR/skills.json";

// ── Talents ──

export const talents = [
  {
    id: "talent_0",
    name: "本质瓦解",
    stages: [
      { promotion: 1, description: "源石结晶被消耗后，自身攻击力+15%，15s", value: 15, zone: "attackPercent" as const },
      { promotion: 2, description: "源石结晶被消耗后，自身攻击力+30%，15s", value: 30, zone: "attackPercent" as const },
    ],
  },
  {
    id: "talent_1",
    name: "现实静滞",
    stages: [
      { promotion: 2, description: "附着源石结晶的敌人受到的物理伤害+10%", value: 10, zone: "vulnerability" as const },
      { promotion: 3, description: "附着源石结晶的敌人受到的物理伤害+20%", value: 20, zone: "vulnerability" as const },
    ],
  },
];

// ── Potentials ──

export const potentials = [
  {
    level: 1, name: "最后的苏醒",
    description: "战技构成序列消耗源石结晶时，返还50点技力",
    effects: [{ type: "sp_refund" as const, trigger: "on_crystal_consume", value: 50 }],
  },
  {
    level: 2, name: "权能映射",
    description: "本质瓦解效果加强：其他友方干员获得一半的攻击力提升",
    effects: [{ type: "talent_enhance" as const, talent: "talent_0", shareToTeam: 0.5 }],
  },
];

// ═══════════════════════════════════════════════════════════════════
// Part 2: Kernel Effects (hit timing + triggers)
// ═══════════════════════════════════════════════════════════════════

// ── Attack segments ──

const a1: Skill = {
  id: "endmin_a1", type: "attack", name: "A1",
  element: "physical", duration: f(23), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(12), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第一段倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a2: Skill = {
  id: "endmin_a2", type: "attack", name: "A2",
  element: "physical", duration: f(27), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(11), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第二段倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a3: Skill = {
  id: "endmin_a3", type: "attack", name: "A3",
  element: "physical", duration: f(49), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(13), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第三段倍率", share: 0.5 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(30), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第三段倍率", share: 0.5 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a4: Skill = {
  id: "endmin_a4", type: "attack", name: "A4",
  element: "physical", duration: f(78), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(14), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 0.25 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(20), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 0.25 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(42), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 0.25 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(47), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 0.25 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a5: Skill = {
  id: "endmin_a5", type: "attack", name: "A5（重击）", isHeavyAttack: true,
  element: "physical", duration: f(69), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(38), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第五段倍率", share: 1 }, stagger: 18, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const execution: Skill = {
  id: "endmin_execution", type: "execution", name: "处决",
  element: "physical", duration: f(126), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(19), checkpointIndex: 0, damage: { multiplierRef: { label: "处决攻击倍率", share: 0.1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(63), checkpointIndex: 0, damage: { multiplierRef: { label: "处决攻击倍率", share: 0.9 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [{ type: "sp_restore", params: { amount: 100, isTrueSP: true, fromExecutionRecovery: true } }], standardLogic: true },
  ],
  checkpoints: [],
};

const aerialAttack: Skill = {
  id: "endmin_aerial", type: "attack", name: "下落攻击",
  element: "physical", duration: f(85), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(49), checkpointIndex: 0, damage: { multiplierRef: { label: "下落攻击倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

// ── Skill (战技: 构成序列) ──

const skill: Skill = {
  id: "endmin_skill", type: "skill", name: "构成序列",
  element: "physical", duration: f(76), spCost: 100, cooldown: 0,
  hits: [
    {
      offset: f(25), checkpointIndex: 0,
      damage: { multiplierRef: { label: "伤害倍率", share: 1 }, stagger: 10, element: "physical", canCrit: true, school: "physical", sourceType: "skill" },
      effects: [{ type: "physical_anomaly", params: { physicalType: "slam" } }],
      standardLogic: true,
    },
  ],
  checkpoints: [],
};

// ── Link (连携技: 锁闭序列) ──

const link: Skill = {
  id: "endmin_link", type: "link", name: "锁闭序列",
  element: "physical", duration: f(75), spCost: 0, cooldown: 0,
  hits: [
    {
      offset: f(50), checkpointIndex: 0,
      damage: { multiplierRef: { label: "伤害倍率", share: 1 }, stagger: 10, element: "physical", canCrit: true, school: "physical", sourceType: "link" },
      effects: [{ type: "buff_apply", params: { buffId: "endmin_debuff", target: "enemy", durationRef: "封印时间（秒）" } }],
      standardLogic: true,
    },
  ],
  checkpoints: [],
};

// ── Ultimate (终结技: 轰击序列) ──

const ultimate: Skill = {
  id: "endmin_ultimate", type: "ultimate", name: "轰击序列",
  element: "physical", duration: f(118), spCost: 0, cooldown: 0,
  hits: [
    {
      offset: f(102), checkpointIndex: 0,
      damage: { multiplierRef: { label: "伤害倍率", share: 1 }, stagger: 25, element: "physical", canCrit: true, school: "physical", sourceType: "ultimate" },
      effects: [],
      standardLogic: true,
    },
  ],
  checkpoints: [],
  gaugeCost: 300,
  teamGaugeGain: 0,
};

export const ultimateAnimation = f(91);

// ── Passive Triggers ──

const essenceDissolve: PassiveTrigger = {
  id: "endmin_essence_dissolve",
  source: "talent_本质瓦解",
  listenTo: "stack_buff_consumed",
  deferred: true,
  sourceMustBeOwner: false,
  condition: { type: "consumed_buff", params: { buffId: "endmin_debuff" } },
  actions: [
    { type: "buff_apply", params: { buffId: "endmin_essence_dissolve_atk", target: "self", stat: "all_dmg", zone: "attackPercent", valueRef: "talent_0", duration: 15 } },
  ],
};

const realityStasis: PassiveTrigger = {
  id: "endmin_reality_stasis",
  source: "talent_现实静滞",
  listenTo: "buff_applied",
  deferred: false,
  sourceMustBeOwner: true,
  condition: { type: "applied_buff", params: { buffId: "endmin_debuff" } },
  actions: [
    { type: "buff_apply", params: { buffId: "endmin_reality_stasis", target: "enemy", stat: "physical_dmg", zone: "vulnerability", valueRef: "talent_1", duration: 999999 } },
  ],
};

/**
 * 源石结晶消耗 — 物理异常/破防触发
 * 碎晶伤害来源 = 触发源的技能类型（如战技猛击触发 → sourceType=skill）
 * 常规碎晶由物理异常触发，伤害来源视为连携技（结晶由连携技施加）
 */
const crystalConsumptionByAnomaly: PassiveTrigger = {
  id: "endmin_crystal_consumption_anomaly",
  source: "endmin_debuff_消耗(物理异常)",
  listenTo: "physical_anomaly",
  deferred: false,
  sourceMustBeOwner: false,
  condition: { type: "enemy_has_buff", params: { buffId: "endmin_debuff" } },
  actions: [
    { type: "buff_consume", params: { buffId: "endmin_debuff", stacks: "all" } },
    // 碎晶伤害 sourceType 继承触发源，但倍率引用连携技的"击碎结晶伤害倍率"
  ],
};

/**
 * 源石结晶消耗 — 终结技命中触发
 * 碎晶伤害来源 = ultimate（终结技增伤生效）
 */
const crystalConsumptionByUltimate: PassiveTrigger = {
  id: "endmin_crystal_consumption_ultimate",
  source: "endmin_debuff_消耗(终结技)",
  listenTo: "ultimate_hit",
  deferred: false,
  sourceMustBeOwner: true,
  condition: { type: "enemy_has_buff", params: { buffId: "endmin_debuff" } },
  actions: [
    { type: "buff_consume", params: { buffId: "endmin_debuff", stacks: "all" } },
    // 碎晶伤害 sourceType = "ultimate"，吃终结技增伤
  ],
};

// ═══════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════

export const skills = {
  attack: [a1, a2, a3, a4, a5, execution, aerialAttack],
  skill,
  link,
  ultimate,
};

export const triggers: PassiveTrigger[] = [
  essenceDissolve,
  realityStasis,
  crystalConsumptionByAnomaly,
  crystalConsumptionByUltimate,
];
