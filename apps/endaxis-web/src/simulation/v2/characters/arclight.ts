/**
 * ARCLIGHT (弧光) — V2 Complete Character Data
 *
 * Element: emag
 * Weapon type: sword
 * Main attribute: agility, Sub attribute: intellect
 */

import type { Skill, SkillVariant, PassiveTrigger, DamageElement } from "../types";

const f = (frames: number) => frames / 60;

// ═══════════════════════════════════════════════════════════════════
// Part 1: Static Character Data
// ═══════════════════════════════════════════════════════════════════

export const identity = {
  id: "ARCLIGHT",
  name: "弧光",
  nameEn: "Arclight",
  rarity: 5,
  profession: "pioneer",
  element: "emag" as DamageElement,
  weaponType: "sword",
  mainAttribute: "agility" as const,
  subAttribute: "intellect" as const,
  maxPotential: 5,
};

export const promotionCaps = [20, 40, 60, 80, 90];

export { default as levelStats } from "../../../data/operators/ARCLIGHT/stats.json";
export { default as skillData } from "../../../data/operators/ARCLIGHT/skills.json";

// ── Talents ──

export const talents = [
  {
    id: "talent_0",
    name: "荒野游人",
    stages: [
      { promotion: 1, description: "使用战技疾风迅雷成功触发3次额外效果后，根据自身的智识，提升全队造成的电磁伤害，每点智识+0.05%，持续15秒，该效果无法叠加", valuePerIntellect: 0.05, triggerCount: 3, duration: 15, zone: "damage_bonus" as const, stat: "emag_dmg" },
      { promotion: 2, description: "使用战技疾风迅雷成功触发3次额外效果后，根据自身的智识，提升全队造成的电磁伤害，每点智识+0.08%，持续15秒，该效果无法叠加", valuePerIntellect: 0.08, triggerCount: 3, duration: 15, zone: "damage_bonus" as const, stat: "emag_dmg" },
    ],
  },
  {
    id: "talent_1",
    name: "众生智慧",
    stages: [
      { promotion: 2, description: "被施加法术附着时，有30%的概率忽略该效果", probability: 0.30 },
      { promotion: 3, description: "被施加法术附着时，有50%的概率忽略该效果", probability: 0.50 },
    ],
  },
];

// ── Potentials ──

export const potentials = [
  {
    level: 1, name: "风暴中的孩子使用",
    description: "战技疾风迅雷成功触发额外效果后，额外恢复10点技力",
    effects: [{ type: "sp_refund" as const, trigger: "on_consume_conduction", value: 10 }],
  },
  {
    level: 2, name: "速战速决",
    description: "敏捷+15，智识+15",
    effects: [
      { type: "stat_bonus" as const, stat: "agility", value: 15 },
      { type: "stat_bonus" as const, stat: "intellect", value: 15 },
    ],
  },
  {
    level: 3, name: "歌谣",
    description: "荒野游人伤害提升效果×1.3",
    effects: [{ type: "talent_enhance" as const, talent: "talent_0", valueBonus: 1.3 }],
  },
  {
    level: 4, name: "师者教诲",
    description: "终结技轰雷掣电所需的终结技能量-15%",
    effects: [{ type: "gauge_modifier" as const, stat: "ult_gauge_cost", value: -15 }],
  },
  {
    level: 5, name: "荒野的徒从",
    description: "荒野游人触发所需次数降低至2次",
    effects: [{ type: "talent_enhance" as const, talent: "talent_0", triggerCount: 2 }],
  },
];

// ═══════════════════════════════════════════════════════════════════
// Part 2: Kernel Effects (hit timing + variants + triggers)
// ═══════════════════════════════════════════════════════════════════

// ── Attack segments ──

const a1: Skill = {
  id: "arclight_a1", type: "attack", name: "A1",
  element: "physical", duration: f(20), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(11), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第一段倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a2: Skill = {
  id: "arclight_a2", type: "attack", name: "A2",
  element: "physical", duration: f(25), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(11), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第二段倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

// A3 hit1 伤害与 A2 hit1 一致（实测多等级均相同）；hit2 = 普攻第三段倍率 − 普攻第二段倍率
const a3: Skill = {
  id: "arclight_a3", type: "attack", name: "A3",
  element: "physical", duration: f(43), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(13), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第二段倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(24), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第三段倍率", share: 1, subtractLabel: "普攻第二段倍率", subtractShare: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a4: Skill = {
  id: "arclight_a4", type: "attack", name: "A4",
  element: "physical", duration: f(52), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(10), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: "equal", equalCount: 3 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(12), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: "equal", equalCount: 3 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(16), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: "equal", equalCount: 3 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a5: Skill = {
  id: "arclight_a5", type: "attack", name: "A5（重击）", isHeavyAttack: true,
  element: "physical", duration: f(64), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(26), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第五段倍率", share: 1 }, stagger: 16, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const execution: Skill = {
  id: "arclight_execution", type: "execution", name: "处决",
  element: "physical", duration: f(152), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(32), checkpointIndex: 0, damage: { multiplierRef: { label: "处决攻击倍率", share: 0.05 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(48), checkpointIndex: 0, damage: { multiplierRef: { label: "处决攻击倍率", share: 0.05 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(78), checkpointIndex: 0, damage: { multiplierRef: { label: "处决攻击倍率", share: 0.9 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [{ type: "sp_restore", params: { amount: 100, isTrueSP: true, fromExecutionRecovery: true } }], standardLogic: true },
  ],
  checkpoints: [],
};

const aerialAttack: Skill = {
  id: "arclight_aerial", type: "attack", name: "下落攻击",
  element: "physical", duration: f(95), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(49), checkpointIndex: 0, damage: { multiplierRef: { label: "下落攻击倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

// ── Skill (战技: 疾风迅雷) ──
// Base = 2-hit physical version. Variant fires when enemy has conduction at cast time.

const skill: Skill = {
  id: "arclight_skill", type: "skill", name: "疾风迅雷",
  element: "emag", duration: f(86), spCost: 100, cooldown: 0,
  hits: [
    { offset: f(39), checkpointIndex: 0, damage: { multiplierRef: { label: "第一段伤害倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "skill" }, effects: [], standardLogic: true },
    { offset: f(54), checkpointIndex: 0, damage: { multiplierRef: { label: "第二段伤害倍率", share: 1 }, stagger: 5, element: "physical", canCrit: true, school: "physical", sourceType: "skill" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

// Enhanced variant: enemy has conduction → 3 hits (2 physical + 1 emag追加 that consumes conduction).
// Hit3 effects: refund SP, then consume conduction (deferred so scaleBy/stat reads happen on pre-consume state).
// Note: hit3 起手 hit 相对普通战技整体略慢 (hit1 +4f, hit2 +6f), 原因未知，按实测录入。
export const skillVariants: SkillVariant[] = [
  {
    id: "arclight_skill_enhanced",
    priority: 1,
    conditions: [{ type: "enemyAnomaly", anomalyType: "conduction", present: true }],
    overrides: {
      duration: f(187),
      hits: [
        { offset: f(43), checkpointIndex: 0, damage: { multiplierRef: { label: "第一段伤害倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "skill" }, effects: [], standardLogic: true },
        { offset: f(60), checkpointIndex: 0, damage: { multiplierRef: { label: "第二段伤害倍率", share: 1 }, stagger: 5, element: "physical", canCrit: true, school: "physical", sourceType: "skill" }, effects: [], standardLogic: true },
        {
          offset: f(139), checkpointIndex: 0,
          damage: { multiplierRef: { label: "追加伤害倍率", share: 1 }, stagger: 5, element: "emag", canCrit: true, school: "magic", sourceType: "skill" },
          effects: [
            { type: "sp_restore", params: { amountRef: "恢复技力", isTrueSP: false } },
            { type: "consume_anomaly", params: { anomalyType: "conduction", deferTo: "afterSkillDamage" } },
          ],
          standardLogic: true,
        },
      ],
    },
  },
];

// ── Link (连携技: 鸣雷) ──
// 3 hits sharing "伤害倍率" equally. Hit1 grants combo gauge + SP + stagger.

const link: Skill = {
  id: "arclight_link", type: "link", name: "鸣雷",
  element: "physical", duration: f(93), spCost: 0, cooldown: 0,
  hits: [
    {
      offset: f(37), checkpointIndex: 0,
      damage: { multiplierRef: { label: "伤害倍率", share: "equal", equalCount: 3 }, stagger: 5, element: "physical", canCrit: true, school: "physical", sourceType: "link" },
      effects: [
        { type: "sp_restore", params: { amountRef: "恢复技力", isTrueSP: true } },
        { type: "gauge_gain", params: { amount: 10 } },
      ],
      standardLogic: true,
    },
    { offset: f(52), checkpointIndex: 0, damage: { multiplierRef: { label: "伤害倍率", share: "equal", equalCount: 3 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "link" }, effects: [], standardLogic: true },
    { offset: f(108), checkpointIndex: 0, damage: { multiplierRef: { label: "伤害倍率", share: "equal", equalCount: 3 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "link" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

// ── Ultimate (终结技: 轰雷掣电) ──
// hit1 施加电磁附着。hit2 延迟引爆 (@f(241) > duration=f(171)): 消耗电磁附着 + 强制施加 1 级导电。
// duration 结束前不可打断（含闪避）；终结技不受默认打断矩阵影响，hit2 即便在 duration 外也按 offset 执行。
// Stagger 值: M0 为 7, M1+ 为 10；当前写死 M0 基础值。

const ultimate: Skill = {
  id: "arclight_ultimate", type: "ultimate", name: "轰雷掣电",
  element: "emag", duration: f(171), spCost: 0, cooldown: 0,
  hits: [
    {
      offset: f(129), checkpointIndex: 0,
      damage: { multiplierRef: { label: "第一段伤害倍率", share: 1 }, stagger: 7, element: "emag", canCrit: true, school: "magic", sourceType: "ultimate" },
      // magic_attachment.element uses DamageElement ("emag"), not MagicElement.
      effects: [{ type: "magic_attachment", params: { element: "emag", stacks: 1 } }],
      standardLogic: true,
    },
    {
      offset: f(241), checkpointIndex: 0,
      damage: { multiplierRef: { label: "第二段伤害倍率", share: 1 }, stagger: 7, element: "emag", canCrit: true, school: "magic", sourceType: "ultimate" },
      // consume_attachment.element uses MagicElement ("electro"). If there is no electro
      // attachment the consume is a no-op; the PassiveTrigger below watches for a successful
      // consume and only then applies 1-level conduction.
      effects: [
        { type: "consume_attachment", params: { element: "electro", deferTo: "afterSkillDamage" } },
      ],
      standardLogic: true,
    },
  ],
  checkpoints: [],
  gaugeCost: 90,
  teamGaugeGain: 0,
};

export const ultimateAnimation = f(152);

// ── Passive Triggers ──
// 荒野游人 (talent_0) and 风暴中的孩子使用 (P1) both fire on conduction consumption.
// 荒野游人 requires accumulating 3 (P1/P2) or 2 (P5) consume events before applying the team buff;
// the accumulator + team emag buff have to be modeled separately (counter-driven buff not yet
// supported by current PassiveTrigger spec). Leave TODO.

// P1 额外恢复 10 点技力 (refund SP) on conduction consume.
// sourceMustBeOwner 保证仅自身消耗导电触发; 弧光只在强化战技 hit3 消耗导电, 故不需 anomaly type 细筛。
const potentialP1SpRefund: PassiveTrigger = {
  id: "arclight_p1_sp_refund",
  source: "potential_风暴中的孩子使用",
  listenTo: "anomaly_consumed",
  deferred: false,
  sourceMustBeOwner: true,
  actions: [
    { type: "sp_restore", params: { amount: 10, isTrueSP: false } },
  ],
};

// 终结技 hit2: 消耗电磁附着 → 强制施加 1 级导电 (仅在消耗成功后)。
// sourceMustBeOwner + consumed_element=electro 保证仅当自己的电磁附着消耗触发时施加导电；
// 若 hit2 时敌人无电磁附着, attachment_consumed 事件不会发出, 触发器不执行, 导电不施加。
const ultimateHit2Conduction: PassiveTrigger = {
  id: "arclight_ultimate_hit2_conduction",
  source: "ultimate_轰雷掣电",
  listenTo: "attachment_consumed",
  deferred: false,
  sourceMustBeOwner: true,
  condition: { type: "consumed_element", params: { element: "electro" } },
  actions: [
    { type: "direct_anomaly", params: { anomalyType: "conduction", level: 1 } },
  ],
  sourceRef: { kind: "ultimate", actorId: "ARCLIGHT" },
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

export const variants = {
  skill: skillVariants,
};

export const triggers: PassiveTrigger[] = [
  potentialP1SpRefund,
  ultimateHit2Conduction,
];
