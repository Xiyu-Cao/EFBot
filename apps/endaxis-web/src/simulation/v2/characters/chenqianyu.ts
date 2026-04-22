/**
 * CHENQIANYU (陈千语) — V2 Complete Character Data
 *
 * Element: physical
 * Weapon type: sword
 * Main attribute: agility, Sub attribute: strength
 */

import type { Skill, PassiveTrigger, DamageElement } from "../types";

const f = (frames: number) => frames / 60;

// ═══════════════════════════════════════════════════════════════════
// Part 1: Static Character Data
// ═══════════════════════════════════════════════════════════════════

export const identity = {
  id: "CHENQIANYU",
  name: "陈千语",
  nameEn: "Chen Qianyu",
  rarity: 5,
  profession: "guard",
  element: "physical" as DamageElement,
  weaponType: "sword",
  mainAttribute: "agility" as const,
  subAttribute: "strength" as const,
  maxPotential: 5,
};

export const promotionCaps = [20, 40, 60, 80, 90];

export { default as levelStats } from "../../../data/operators/CHENQIANYU/stats.json";
export { default as skillData } from "../../../data/operators/CHENQIANYU/skills.json";

// ── Talents ──

export const talents = [
  {
    id: "talent_0",
    name: "斩锋",
    stages: [
      { promotion: 1, description: "技能每次命中敌人后，攻击力+4%，持续10秒，最多叠加5层", value: 4, duration: 10, maxStacks: 5, zone: "attackPercent" as const },
      { promotion: 2, description: "技能每次命中敌人后，攻击力+8%，持续10秒，最多叠加5层", value: 8, duration: 10, maxStacks: 5, zone: "attackPercent" as const },
    ],
  },
  {
    id: "talent_1",
    name: "破势",
    stages: [
      // TODO: 需要敌人"蓄力"状态建模，当前 kernel 未建模敌人行为。
      // 实装后应监听 skill_hit / link_hit / ultimate_hit + condition: enemy_charging
      // 然后追加 stagger（通过 direct_stagger 或类似 action）。
      { promotion: 2, description: "技能打断敌人蓄力时，额外造成5点失衡", value: 5, unimplemented: true as const, reason: "enemy_charging_state_not_modeled" },
      { promotion: 3, description: "技能打断敌人蓄力时，额外造成10点失衡", value: 10, unimplemented: true as const, reason: "enemy_charging_state_not_modeled" },
    ],
  },
];

// ── Potentials ──

export const potentials = [
  {
    level: 1, name: "绝影",
    description: "对生命值少于50%的敌人造成的伤害+20%",
    // TODO: 敌人 HP 系统未建模，无法判定 <50% 条件。实装后应作为 conditional damage_bonus。
    effects: [],
  },
  {
    level: 2, name: "家传武学",
    description: "敏捷+15，造成的物理伤害+8%",
    effects: [
      { type: "stat_bonus" as const, stat: "agility", value: 15 },
      { type: "damage_bonus" as const, stat: "physical_dmg", value: 8 },
    ],
  },
  {
    level: 3, name: "双剑奇侠",
    description: "战技归穹宇、连携技见天河和终结技冽风霜的伤害倍率提升至原本的1.1倍",
    effects: [{ type: "multiplier_scaling" as const, skills: ["skill", "link", "ultimate"], value: 1.1 }],
  },
  {
    level: 4, name: "自研赤霄剑",
    description: "终结技冽风霜所需的终结技能量-15%",
    effects: [{ type: "gauge_modifier" as const, stat: "ult_gauge_cost", value: -15 }],
  },
  {
    level: 5, name: "心兼人间",
    description: "连携技见天河的冷却时间-3秒",
    effects: [{ type: "cooldown_modifier" as const, stat: "link", value: -3 }],
  },
];

// ═══════════════════════════════════════════════════════════════════
// Part 2: Kernel Effects (hit timing + triggers)
// ═══════════════════════════════════════════════════════════════════

// ── Attack segments ──

const a1: Skill = {
  id: "chenqianyu_a1", type: "attack", name: "A1",
  element: "physical", duration: f(33), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(17), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第一段倍率", share: 1 / 3 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(24), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第一段倍率", share: 2 / 3 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a2: Skill = {
  id: "chenqianyu_a2", type: "attack", name: "A2",
  element: "physical", duration: f(21), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(12), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第二段倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a3: Skill = {
  id: "chenqianyu_a3", type: "attack", name: "A3",
  element: "physical", duration: f(36), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(18), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第三段倍率", share: 1 / 3 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(24), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第三段倍率", share: 2 / 3 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a4: Skill = {
  id: "chenqianyu_a4", type: "attack", name: "A4",
  element: "physical", duration: f(45), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(10), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 0.5 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(21), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 0.5 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a5: Skill = {
  id: "chenqianyu_a5", type: "attack", name: "A5（重击）", isHeavyAttack: true,
  element: "physical", duration: f(71), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(33), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第五段倍率", share: 1 }, stagger: 16, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const execution: Skill = {
  id: "chenqianyu_execution", type: "execution", name: "处决",
  element: "physical", duration: f(133), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(12), checkpointIndex: 0, damage: { multiplierRef: { label: "处决攻击倍率", share: 0.2 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(72), checkpointIndex: 0, damage: { multiplierRef: { label: "处决攻击倍率", share: 0.8 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [{ type: "sp_restore", params: { amount: 100, isTrueSP: true, fromExecutionRecovery: true } }], standardLogic: true },
  ],
  checkpoints: [],
};

const aerialAttack: Skill = {
  id: "chenqianyu_aerial", type: "attack", name: "下落攻击",
  element: "physical", duration: f(84), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(47), checkpointIndex: 0, damage: { multiplierRef: { label: "下落攻击倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

// ── Skill (战技: 归穹宇) ──
// 1 hit physical launch + stagger (失衡值=10).

const skill: Skill = {
  id: "chenqianyu_skill", type: "skill", name: "归穹宇",
  element: "physical", duration: f(117), spCost: 100, cooldown: 0,
  hits: [
    {
      offset: f(27), checkpointIndex: 0,
      damage: { multiplierRef: { label: "伤害倍率", section: "skill", share: 1 }, stagger: 10, element: "physical", canCrit: true, school: "physical", sourceType: "skill" },
      effects: [{ type: "physical_anomaly", params: { physicalType: "launch" } }],
      standardLogic: true,
    },
  ],
  checkpoints: [],
};

// ── Link (连携技: 见天河) ──
// 1 hit physical launch + 10 ultimate gauge gain (not documented in skills.json).
// NOTE: skills.json link section 的 label "伤害倍率" 与 skill section 同名，用
// MultiplierRef.section="link" 锁定到 link section 以避免命中战技的值。

const link: Skill = {
  id: "chenqianyu_link", type: "link", name: "见天河",
  element: "physical", duration: f(128), spCost: 0, cooldown: 0,
  hits: [
    {
      offset: f(35), checkpointIndex: 0,
      damage: { multiplierRef: { label: "伤害倍率", section: "link", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "link" },
      effects: [
        { type: "physical_anomaly", params: { physicalType: "launch" } },
        { type: "gauge_gain", params: { amount: 10 } },
      ],
      standardLogic: true,
    },
  ],
  checkpoints: [],
};

// ── Ultimate (终结技: 冽风霜) ──
// 7 hits. hits 1-6 use "斩击伤害倍率" each at ×1 (not shared). hit7 uses
// "终结一击伤害倍率". hit1 stagger=15 (第一击失衡值), hit7 stagger=20 (终结一击失衡值).

const ultimate: Skill = {
  id: "chenqianyu_ultimate", type: "ultimate", name: "冽风霜",
  element: "physical", duration: f(277), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(116), checkpointIndex: 0, damage: { multiplierRef: { label: "斩击伤害倍率", share: 1 }, stagger: 15, element: "physical", canCrit: true, school: "physical", sourceType: "ultimate" }, effects: [], standardLogic: true },
    { offset: f(128), checkpointIndex: 0, damage: { multiplierRef: { label: "斩击伤害倍率", share: 1 }, stagger: 0,  element: "physical", canCrit: true, school: "physical", sourceType: "ultimate" }, effects: [], standardLogic: true },
    { offset: f(137), checkpointIndex: 0, damage: { multiplierRef: { label: "斩击伤害倍率", share: 1 }, stagger: 0,  element: "physical", canCrit: true, school: "physical", sourceType: "ultimate" }, effects: [], standardLogic: true },
    { offset: f(146), checkpointIndex: 0, damage: { multiplierRef: { label: "斩击伤害倍率", share: 1 }, stagger: 0,  element: "physical", canCrit: true, school: "physical", sourceType: "ultimate" }, effects: [], standardLogic: true },
    { offset: f(153), checkpointIndex: 0, damage: { multiplierRef: { label: "斩击伤害倍率", share: 1 }, stagger: 0,  element: "physical", canCrit: true, school: "physical", sourceType: "ultimate" }, effects: [], standardLogic: true },
    { offset: f(161), checkpointIndex: 0, damage: { multiplierRef: { label: "斩击伤害倍率", share: 1 }, stagger: 0,  element: "physical", canCrit: true, school: "physical", sourceType: "ultimate" }, effects: [], standardLogic: true },
    { offset: f(207), checkpointIndex: 0, damage: { multiplierRef: { label: "终结一击伤害倍率", share: 1 }, stagger: 20, element: "physical", canCrit: true, school: "physical", sourceType: "ultimate" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
  gaugeCost: 70,
  teamGaugeGain: 0,
};

export const ultimateAnimation = f(109);

// ── Passive Triggers ──

/**
 * 斩锋 (talent_0) — each skill/link/ultimate hit grants ATK+4%/+8% for 10s, max 5 stacks.
 * "技能" 指战技/连携/终结技（不含普攻），所以分别监听三个 *_hit 事件。
 * 所有层共享持续时间：每次新增一层时刷新全部层的 expiresAt（refresh 语义）。
 */
const talentZhanFengBase: Omit<PassiveTrigger, "id" | "listenTo"> = {
  source: "talent_斩锋",
  deferred: false,
  sourceMustBeOwner: true,
  actions: [
    {
      type: "buff_apply",
      params: {
        buffId: "chenqianyu_zhanfeng",
        target: "self",
        stat: "attack_percent",
        zone: "attackPercent",
        valueRef: "talent_0",
        duration: 10,
        maxStacks: 5,
        stackBehavior: "refresh",
      },
    },
  ],
  sourceRef: { kind: "talent_0", actorId: "CHENQIANYU" },
};

const talentZhanFengOnSkill: PassiveTrigger = { ...talentZhanFengBase, id: "chenqianyu_talent_zhanfeng_skill", listenTo: "skill_hit" };
const talentZhanFengOnLink:  PassiveTrigger = { ...talentZhanFengBase, id: "chenqianyu_talent_zhanfeng_link",  listenTo: "link_hit" };
const talentZhanFengOnUlt:   PassiveTrigger = { ...talentZhanFengBase, id: "chenqianyu_talent_zhanfeng_ult",   listenTo: "ultimate_hit" };

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
  talentZhanFengOnSkill,
  talentZhanFengOnLink,
  talentZhanFengOnUlt,
];
