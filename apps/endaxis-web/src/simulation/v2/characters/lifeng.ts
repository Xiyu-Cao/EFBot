/**
 * LIFENG (黎风) — V2 Complete Character Data
 *
 * Element: physical
 * Weapon type: lance (长柄武器)
 * Main attribute: agility, Sub attribute: strength
 */

import type { Skill, SkillVariant, PassiveTrigger, DamageElement } from "../types";

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

const f = (frames: number) => frames / 60;

// ═══════════════════════════════════════════════════════════════════
// Part 1: Static Character Data
// ═══════════════════════════════════════════════════════════════════

export const identity = {
  id: "LIFENG",
  name: "黎风",
  nameEn: "Lifeng",
  rarity: 6,
  profession: "guard",
  element: "physical" as DamageElement,
  weaponType: "lance",
  mainAttribute: "agility" as const,
  subAttribute: "strength" as const,
  maxPotential: 5,
};

export const promotionCaps = [20, 40, 60, 80, 90];

export { default as levelStats } from "../../../data/operators/LIFENG/stats.json";
export { default as skillData } from "../../../data/operators/LIFENG/skills.json";

// ── Talents ──

export const talents = [
  {
    id: "talent_0",
    name: "顿悟",
    stages: [
      { promotion: 1, description: "每点智力和意志提供+0.10%攻击力", valuePerPoint: 0.10, zone: "attackPercent" as const, attributes: ["intellect", "will"] },
      { promotion: 2, description: "每点智力和意志提供+0.15%攻击力", valuePerPoint: 0.15, zone: "attackPercent" as const, attributes: ["intellect", "will"] },
    ],
  },
  {
    id: "talent_1",
    name: "伏魔",
    stages: [
      { promotion: 2, description: "每次倒地造成额外50%攻击力的物理伤害", damageMultiplier: 50 },
      { promotion: 3, description: "每次倒地造成额外100%攻击力的物理伤害", damageMultiplier: 100 },
    ],
  },
];

// ── Potentials ──

export const potentials = [
  {
    level: 1, name: "破执",
    description: "战技物理脆弱+5%，破防≤2层时也触发",
    effects: [
      { type: "skill_buff_enhance" as const, target: "physical_vulnerability", valueBonus: 5 },
      { type: "condition_relax" as const, description: "physical_vulnerability triggers even with ≤2 break stacks" },
    ],
  },
  {
    level: 2, name: "修身",
    description: "全能力+15",
    effects: [
      { type: "stat_bonus" as const, stat: "strength", value: 15 },
      { type: "stat_bonus" as const, stat: "agility", value: 15 },
      { type: "stat_bonus" as const, stat: "intellect", value: 15 },
      { type: "stat_bonus" as const, stat: "will", value: 15 },
    ],
  },
  {
    level: 3, name: "养性",
    description: "顿悟效果加强：每点智力和意志额外+0.05%攻击力",
    effects: [{ type: "talent_enhance" as const, talent: "talent_0", valueBonus: 0.05 }],
  },
  {
    level: 4, name: "刹那",
    description: "终结技所需能量-15%",
    effects: [{ type: "gauge_modifier" as const, stat: "ult_gauge_cost", value: -15 }],
  },
  {
    level: 5, name: "不懈",
    description: "伏魔效果加强：每15s，下次触发额外造成250%攻击力物理伤害+5失衡",
    effects: [{ type: "talent_enhance" as const, talent: "talent_1", bonusDamage: 250, bonusStagger: 5, cooldown: 15 }],
  },
];

// ═══════════════════════════════════════════════════════════════════
// Part 2: Kernel Effects (hit timing + triggers)
// ═══════════════════════════════════════════════════════════════════

// ── Attack segments ──

const a1: Skill = {
  id: "lifeng_a1", type: "attack", name: "A1",
  element: "physical", duration: f(54), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(20), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第一段倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(38), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第一段倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a2: Skill = {
  id: "lifeng_a2", type: "attack", name: "A2",
  element: "physical", duration: f(40), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(10), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第二段倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a3: Skill = {
  id: "lifeng_a3", type: "attack", name: "A3",
  element: "physical", duration: f(42), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(25), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第三段倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a4: Skill = {
  id: "lifeng_a4", type: "attack", name: "A4（重击）", isHeavyAttack: true,
  element: "physical", duration: f(84), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(28), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(50), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 1 }, stagger: 19, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const execution: Skill = {
  id: "lifeng_execution", type: "execution", name: "处决",
  element: "physical", duration: f(123), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(13), checkpointIndex: 0, damage: { multiplierRef: { label: "处决攻击倍率", share: 0.1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(67), checkpointIndex: 0, damage: { multiplierRef: { label: "处决攻击倍率", share: 0.9 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [{ type: "sp_restore", params: { amount: 100, isTrueSP: true, fromExecutionRecovery: true } }], standardLogic: true },
  ],
  checkpoints: [],
};

const aerialAttack: Skill = {
  id: "lifeng_aerial", type: "attack", name: "下落攻击",
  element: "physical", duration: f(85), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(49), checkpointIndex: 0, damage: { multiplierRef: { label: "下落攻击倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

// ── Skill (战技: 荡浊身) ──
// 3 hits: 2 spear swings + ground slam with knockdown
// Hit3: always applies knockdown; additionally applies physical vulnerability if enemy has no break state
// Physical vulnerability condition checked BEFORE knockdown is applied

const skill: Skill = {
  id: "lifeng_skill", type: "skill", name: "荡浊身",
  element: "physical", duration: f(156), spCost: 100, cooldown: 0,
  hits: [
    { offset: f(16), checkpointIndex: 0, damage: { multiplierRef: { label: "第一段伤害倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "skill" }, effects: [], standardLogic: true },
    { offset: f(49), checkpointIndex: 0, damage: { multiplierRef: { label: "第二段伤害倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "skill" }, effects: [], standardLogic: true },
    {
      offset: f(123), checkpointIndex: 0,
      damage: { multiplierRef: { label: "第三段伤害倍率", share: 1 }, stagger: 10, element: "physical", canCrit: true, school: "physical", sourceType: "skill" },
      effects: [
        // Order matters: vulnerability check before knockdown application
        { type: "buff_apply", params: { buffId: "lifeng_physical_vulnerability", target: "enemy", stat: "physical_dmg", zone: "vulnerability", valueRef: "物理脆弱效果", durationRef: "物理脆弱持续时间（秒）", condition: "enemy_not_has_break" } },
        { type: "physical_anomaly", params: { physicalType: "knockdown" } },
      ],
      standardLogic: true,
    },
  ],
  checkpoints: [],
};

// ── Link (连携技: 忿怒相) ──
// Triggered when main control heavy-attacks enemy in physical vulnerability or break state
// Hit2: stagger + grants combo buff (20s, modeled as stack buff for variant system)

const link: Skill = {
  id: "lifeng_link", type: "link", name: "忿怒相",
  element: "physical", duration: f(132), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(40), checkpointIndex: 0, damage: { multiplierRef: { label: "第一段伤害倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "link" }, effects: [], standardLogic: true },
    {
      offset: f(98), checkpointIndex: 0,
      damage: { multiplierRef: { label: "第二段伤害倍率", share: 1 }, stagger: 10, element: "physical", canCrit: true, school: "physical", sourceType: "link" },
      effects: [
        { type: "stack_buff_apply", params: { buffType: "lifeng_combo", stacks: 1, duration: 20 } },
      ],
      standardLogic: true,
    },
  ],
  checkpoints: [],
};

// ── Ultimate (终结技: 不动心) ──
// Normal version: 2 hits with knockdown
// After hit1, all remaining hits cannot be interrupted (detach at hit1)

const ultimate: Skill = {
  id: "lifeng_ultimate", type: "ultimate", name: "不动心",
  element: "physical", duration: f(150), spCost: 0, cooldown: 0,
  detach: f(130),
  hits: [
    {
      offset: f(130), checkpointIndex: 0,
      damage: { multiplierRef: { label: "第一段伤害倍率", share: 1 }, stagger: 5, element: "physical", canCrit: true, school: "physical", sourceType: "ultimate" },
      effects: [{ type: "physical_anomaly", params: { physicalType: "knockdown" } }],
      standardLogic: true,
    },
    {
      offset: f(250), checkpointIndex: 0,
      damage: { multiplierRef: { label: "第二段伤害倍率", share: 1 }, stagger: 5, element: "physical", canCrit: true, school: "physical", sourceType: "ultimate" },
      effects: [{ type: "physical_anomaly", params: { physicalType: "knockdown" } }],
      standardLogic: true,
    },
  ],
  checkpoints: [],
  gaugeCost: 90,
  teamGaugeGain: 0,
};

export const ultimateAnimation = f(111);

// ── Ultimate variant: consume combo for hit3 ──

export const ultimateVariants: SkillVariant[] = [
  {
    id: "lifeng_ult_combo",
    priority: 1,
    conditions: [{ type: "stackBuff", buffType: "lifeng_combo", op: ">=", value: 1 }],
    overrides: {
      hits: [
        {
          offset: f(130), checkpointIndex: 0,
          damage: { multiplierRef: { label: "第一段伤害倍率", share: 1 }, stagger: 5, element: "physical", canCrit: true, school: "physical", sourceType: "ultimate" },
          effects: [{ type: "physical_anomaly", params: { physicalType: "knockdown" } }],
          standardLogic: true,
        },
        {
          offset: f(250), checkpointIndex: 0,
          damage: { multiplierRef: { label: "第二段伤害倍率", share: 1 }, stagger: 5, element: "physical", canCrit: true, school: "physical", sourceType: "ultimate" },
          effects: [{ type: "physical_anomaly", params: { physicalType: "knockdown" } }],
          standardLogic: true,
        },
        {
          offset: f(360), checkpointIndex: 0,
          damage: { multiplierRef: { label: "追加伤害倍率", share: 1 }, stagger: 5, element: "physical", canCrit: true, school: "physical", sourceType: "ultimate" },
          effects: [],
          standardLogic: true,
        },
      ],
    },
    consumeBuffs: [{ buffType: "lifeng_combo", stacks: "all" }],
  },
];

// ── Passive Triggers ──

/**
 * 伏魔 — each knockdown deals additional physical damage
 * Stage 1: 50% ATK, Stage 2: 100% ATK
 * Fires on any knockdown applied by this actor.
 */
const demonSubduer: PassiveTrigger = {
  id: "lifeng_demon_subduer",
  source: "talent_伏魔",
  listenTo: "physical_anomaly",
  deferred: false,
  sourceMustBeOwner: true,
  condition: { type: "physical_anomaly_type", params: { physicalType: "knockdown" } },
  actions: [
    { type: "delayed_damage", params: { multiplierFromTalent: "talent_1", element: "physical", school: "physical", canCrit: true } },
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
  demonSubduer,
];
