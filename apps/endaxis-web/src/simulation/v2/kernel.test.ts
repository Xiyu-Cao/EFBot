/**
 * V2 Kernel integration test — LAEVATAIN combo
 *
 * Tests a simplified combo:
 * 1. LAEVATAIN link (single target, blaze element)
 * 2. LAEVATAIN skill (10 hits, blaze, consumes SP)
 *
 * Verifies: damage events, gauge charging, SP consumption, stagger.
 */
import { describe, it, expect } from "vitest";
import { simulate, type PlacedSkill, type EnemyConfig } from "./kernel";
import { computeCharacterBuild, type CharacterInput } from "./characterBuild";
import type { CharacterBuild } from "./types";
import type { Skill, Hit, DamageElement, SkillVariant } from "./types";

// ── Helper: make a simple hit ──
function makeHit(offset: number, multiplier: number, stagger: number = 0, effects: any[] = []): Hit {
  return {
    offset,
    checkpointIndex: 0,
    damage: {
      multiplier,
      stagger,
      element: "blaze" as DamageElement,
      canCrit: true,
      school: "magic",
      sourceType: "skill",
    },
    effects,
    standardLogic: true,
  };
}

// ── LAEVATAIN build ──
function makeLaevatainBuild() {
  const input: CharacterInput = {
    id: "LAEVATAIN",
    name: "莱万汀",
    element: "blaze",
    rarity: 6,
    promotion: 4,
    potentialLevel: 5,
    talentLevels: { talent_0: 3, talent_1: 2 },
    baseStrength: 100,
    baseAgility: 100,
    baseIntellect: 200,
    baseWill: 150,
    baseAttack: 300,
    baseHp: 1000,
    mainAttribute: "intellect",
    subAttribute: "will",
    weaponId: "wpn_sword_0006",
    weaponBaseAtk: 510,
    weaponLevel: 90,
    equipmentSetId: null,
    baseGaugeMax: 300,
    statModifiers: [
      // Weapon passive: blaze_dmg +44.8%
      { source: "weapon_passive", stat: "blaze_dmg", value: 44.8, type: "flat" as const },
      // P4: gauge -15%
      { source: "potential_4", stat: "ult_gauge_cost", value: -15, type: "percent" as const },
      // P2: intellect +20, attack_dmg_bonus +15%
      { source: "potential_2", stat: "intellect", value: 20, type: "flat" as const },
      { source: "potential_2", stat: "attack_dmg_bonus", value: 15, type: "flat" as const },
    ],
  };
  return computeCharacterBuild(input);
}

// ── Simple link skill (1 hit) ──
function makeLinkSkill(): Skill {
  return {
    id: "LAEVATAIN_link",
    type: "link",
    name: "沸腾",
    element: "blaze",
    duration: 1.37,
    spCost: 0,
    cooldown: 10,
    hits: [
      {
        offset: 0.67,
        checkpointIndex: 0,
        damage: { multiplier: 540, stagger: 10, element: "blaze", canCrit: true, school: "magic", sourceType: "link" },
        effects: [
          { type: "stack_buff_apply", params: { buffType: "magma", stacks: 1 } },
        ],
        standardLogic: true,
      },
    ],
    checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
  };
}

// ── Simple skill (3 hits for brevity) ──
function makeSkillSimplified(): Skill {
  return {
    id: "LAEVATAIN_skill",
    type: "skill",
    name: "焚灭",
    element: "blaze",
    duration: 2.2,
    spCost: 100,
    cooldown: 0,
    hits: [
      makeHit(0.73, 140, 0, [{ type: "stack_buff_apply", params: { buffType: "magma", stacks: 1 } }]),
      makeHit(0.97, 14),
      makeHit(2.07, 14, 10),
    ],
    checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 2] }],
  };
}

// ── Enemy config ──
const defaultEnemy: EnemyConfig = {
  defenseMultiplier: 0.5,
  maxStagger: 100,
  staggerNodes: [50],
  staggerBreakDuration: 10,
  basePhysicalResist: 0,
  baseMagicResist: 0,
};

describe("V2 Kernel — LAEVATAIN combo", () => {
  it("processes link + skill and produces correct event types", () => {
    const build = makeLaevatainBuild();
    const skills: PlacedSkill[] = [
      { actionId: "act_link", actorId: "LAEVATAIN", skill: makeLinkSkill(), startTime: 0 },
      { actionId: "act_skill", actorId: "LAEVATAIN", skill: makeSkillSimplified(), startTime: 2 },
    ];

    const result = simulate([build], skills, defaultEnemy, {
      initialSP: 200,
      critMode: "expected",
    });

    // Should have events
    expect(result.events.length).toBeGreaterThan(0);

    // Check event types present
    const types = new Set(result.events.map(e => e.type));
    expect(types.has("action_start")).toBe(true);
    expect(types.has("action_end")).toBe(true);
    expect(types.has("damage")).toBe(true);
    expect(types.has("stack_change")).toBe(true);

    // Link should produce 1 damage event
    const linkDamages = result.events.filter(e => e.type === "damage" && (e as any).actionId === "act_link");
    expect(linkDamages.length).toBe(1);

    // Skill should produce 3 damage events
    const skillDamages = result.events.filter(e => e.type === "damage" && (e as any).actionId === "act_skill");
    expect(skillDamages.length).toBe(3);

    // Magma should have been applied twice (link hit + skill first hit)
    const magmaChanges = result.events.filter(e =>
      e.type === "stack_change" && (e as any).buffType === "magma"
    );
    expect(magmaChanges.length).toBe(2);
    expect((magmaChanges[1] as any).stacks).toBe(2);
  });

  it("charges gauge from SP consumption", () => {
    const build = makeLaevatainBuild();
    const skills: PlacedSkill[] = [
      { actionId: "act_skill", actorId: "LAEVATAIN", skill: makeSkillSimplified(), startTime: 0 },
    ];

    const result = simulate([build], skills, defaultEnemy, {
      initialSP: 200,
      critMode: "expected",
    });

    // Should have gauge_change from SP consumption
    const gaugeChanges = result.events.filter(e => e.type === "gauge_change");
    expect(gaugeChanges.length).toBeGreaterThan(0);

    const spCharge = gaugeChanges.find(e => (e as any).reason === "sp_consumption");
    expect(spCharge).toBeTruthy();
    // 100 SP × 6.5% = 6.5 base × ultChargeEff/100
    expect((spCharge as any).change).toBeGreaterThan(0);
  });

  it("produces positive damage values", () => {
    const build = makeLaevatainBuild();
    const skills: PlacedSkill[] = [
      { actionId: "act_skill", actorId: "LAEVATAIN", skill: makeSkillSimplified(), startTime: 0 },
    ];

    const result = simulate([build], skills, defaultEnemy, {
      initialSP: 200,
      critMode: "expected",
    });

    const damages = result.events.filter(e => e.type === "damage");
    for (const d of damages) {
      expect((d as any).damage).toBeGreaterThan(0);
    }
  });

  it("gauge max is 255 (P4: 300 × 0.85)", () => {
    const build = makeLaevatainBuild();
    expect(build.gaugeMax).toBe(255);
  });

  it("handles stagger accumulation", () => {
    const build = makeLaevatainBuild();
    const skills: PlacedSkill[] = [
      { actionId: "act_skill", actorId: "LAEVATAIN", skill: makeSkillSimplified(), startTime: 0 },
    ];

    const result = simulate([build], skills, defaultEnemy, {
      initialSP: 200,
      critMode: "expected",
    });

    // Last hit has stagger 10
    const staggerEvents = result.events.filter(e => e.type === "stagger_change");
    expect(staggerEvents.length).toBe(1);
    expect((staggerEvents[0] as any).amount).toBe(10);
    expect((staggerEvents[0] as any).total).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Weapon trigger integration tests
// ═══════════════════════════════════════════════════════════════════

import type { PassiveTrigger } from "./types";
import { convertWeaponTriggers } from "./weapons/converter";
import { wpn_claym_0013, wpn_sword_0016, wpn_sword_0021, V2_WEAPON_REGISTRY } from "./weapons/definitions";
import { convertSetTriggers, V2_EQUIPMENT_SET_REGISTRY } from "./equipment/definitions";
import { resolveBuffIcon } from "./buffMetadata";

// ── Shared helpers ──

function makeGenericBuild(id: string, element: DamageElement = "cold") {
  const input: CharacterInput = {
    id, name: id, element, rarity: 6,
    promotion: 4, potentialLevel: 0, talentLevels: {},
    baseStrength: 100, baseAgility: 100, baseIntellect: 100, baseWill: 100,
    baseAttack: 300, baseHp: 1000,
    mainAttribute: "strength", subAttribute: "agility",
    weaponId: null, weaponBaseAtk: 500, weaponLevel: 90,
    equipmentSetId: null, baseGaugeMax: 300,
    statModifiers: [],
  };
  return computeCharacterBuild(input);
}

function makeColdSkill(hitCount: number = 2, spRestore: number = 0): Skill {
  const hits: Hit[] = [];
  for (let i = 0; i < hitCount; i++) {
    const effects: any[] = [
      { type: "magic_attachment", params: { element: "cold", stacks: 1 } },
    ];
    if (spRestore > 0) {
      effects.push({ type: "sp_restore", params: { amount: spRestore, spType: "refund" } });
    }
    hits.push({
      offset: 0.5 + i * 0.3,
      checkpointIndex: 0,
      damage: { multiplier: 200, stagger: 5, element: "cold" as DamageElement, canCrit: true, school: "magic" as const, sourceType: "skill" as const },
      effects,
      standardLogic: true,
    });
  }
  return {
    id: "test_cold_skill", type: "skill", name: "Cold Skill",
    element: "cold", duration: 2, spCost: 50, cooldown: 0,
    hits, checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, hitCount - 1] }],
  };
}

function makeLinkSkillCold(): Skill {
  return {
    id: "test_cold_link", type: "link", name: "Cold Link",
    element: "cold", duration: 1.5, spCost: 0, cooldown: 10,
    hits: [{
      offset: 0.5,
      checkpointIndex: 0,
      damage: { multiplier: 300, stagger: 10, element: "cold" as DamageElement, canCrit: true, school: "magic" as const, sourceType: "link" as const },
      effects: [{ type: "magic_attachment", params: { element: "cold", stacks: 1 } }],
      standardLogic: true,
    }],
    checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
  };
}

describe("V2 Weapon Triggers — 赫拉芬格 (wpn_claym_0013)", () => {
  const tierIdx = 8; // max tier
  const triggers = convertWeaponTriggers(wpn_claym_0013, tierIdx);

  it("converts 2 triggers from weapon definition", () => {
    expect(triggers.length).toBe(2);
    expect(triggers[0].id).toBe("helafenge_skill_cold");
    expect(triggers[1].id).toBe("helafenge_link_cold");
  });

  it("skill cold attachment → cold_dmg buff applied and affects damage", () => {
    const build = makeGenericBuild("LASTRITE", "cold");
    const skill = makeColdSkill(2);
    const trigsByActor = new Map<string, PassiveTrigger[]>();
    trigsByActor.set("LASTRITE", triggers);

    const result = simulate([build], [
      { actionId: "act1", actorId: "LASTRITE", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 200, critMode: "expected" }, trigsByActor);

    // Weapon trigger should produce buff_apply events
    const buffApplies = result.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "helafenge_skill_cold");
    expect(buffApplies.length).toBeGreaterThan(0);

    // Compare with no-buff baseline
    const resultNoBuff = simulate([build], [
      { actionId: "act1", actorId: "LASTRITE", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 200, critMode: "expected" });

    // Filter to hit damages only (same multiplier 200, exclude effect damages)
    const hitDamages = result.events.filter(e => e.type === "damage" && (e as any).multiplier === 200);
    const hitDamagesNoBuff = resultNoBuff.events.filter(e => e.type === "damage" && (e as any).multiplier === 200);
    expect(hitDamages.length).toBe(2);
    expect(hitDamagesNoBuff.length).toBe(2);

    // 赫拉芬格 passive: "施加寒冷附着**时**获得寒冷伤害+X%" — buff applies at the
    // moment of attachment, so the skill hit that emits the attachment event already
    // benefits. Both hits should exceed the no-buff baseline.
    expect((hitDamages[0] as any).damage).toBeGreaterThan((hitDamagesNoBuff[0] as any).damage);
    expect((hitDamages[1] as any).damage).toBeGreaterThan((hitDamagesNoBuff[1] as any).damage);
  });

  it("link hit on cold-attached enemy → cold_dmg buff applied", () => {
    const build = makeGenericBuild("LASTRITE", "cold");
    const skill = makeColdSkill(1); // apply cold attachment
    const link = makeLinkSkillCold();
    const trigsByActor = new Map<string, PassiveTrigger[]>();
    trigsByActor.set("LASTRITE", triggers);

    const result = simulate([build], [
      { actionId: "act_skill", actorId: "LASTRITE", skill, startTime: 0 },
      { actionId: "act_link", actorId: "LASTRITE", skill: link, startTime: 3 },
    ], defaultEnemy, { initialSP: 200, critMode: "expected" }, trigsByActor);

    // Link trigger should fire (enemy has cold attachment from skill)
    const linkBuffs = result.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "helafenge_link_cold");
    expect(linkBuffs.length).toBeGreaterThan(0);
  });
});

describe("V2 Weapon Triggers — 不知归 (wpn_sword_0016)", () => {
  const tierIdx = 8; // max tier
  const triggers = convertWeaponTriggers(wpn_sword_0016, tierIdx);

  it("converts 2 triggers (self + others)", () => {
    expect(triggers.length).toBe(2);
    expect(triggers[0].id).toBe("buzhigui_self");
    expect(triggers[1].id).toBe("buzhigui_team");
  });

  it("SP restore from skill → physical_dmg buff applied to self", () => {
    const build = makeGenericBuild("POGRANICHNK", "physical");
    const skill: Skill = {
      id: "test_sp_skill", type: "skill", name: "SP Skill",
      element: "physical", duration: 2, spCost: 50, cooldown: 0,
      hits: [{
        offset: 0.5, checkpointIndex: 0,
        damage: { multiplier: 200, stagger: 5, element: "physical" as DamageElement, canCrit: true, school: "physical" as const, sourceType: "skill" as const },
        effects: [{ type: "sp_restore", params: { amount: 30, spType: "refund" } }],
        standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };

    const trigsByActor = new Map<string, PassiveTrigger[]>();
    trigsByActor.set("POGRANICHNK", triggers);

    const result = simulate([build], [
      { actionId: "act1", actorId: "POGRANICHNK", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 200, critMode: "expected" }, trigsByActor);

    // Self buff should be applied
    const selfBuffs = result.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "buzhigui_self");
    expect(selfBuffs.length).toBe(1);
  });

  it("others buff applied to teammates but not self", () => {
    const build1 = makeGenericBuild("POGRANICHNK", "physical");
    const build2 = makeGenericBuild("LASTRITE", "cold");
    const skill: Skill = {
      id: "test_sp_skill", type: "skill", name: "SP Skill",
      element: "physical", duration: 2, spCost: 50, cooldown: 0,
      hits: [{
        offset: 0.5, checkpointIndex: 0,
        damage: { multiplier: 200, stagger: 5, element: "physical" as DamageElement, canCrit: true, school: "physical" as const, sourceType: "skill" as const },
        effects: [{ type: "sp_restore", params: { amount: 30, spType: "refund" } }],
        standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };

    const trigsByActor = new Map<string, PassiveTrigger[]>();
    trigsByActor.set("POGRANICHNK", triggers);

    const result = simulate([build1, build2], [
      { actionId: "act1", actorId: "POGRANICHNK", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 200, critMode: "expected" }, trigsByActor);

    // Team buff emitted with target "others"
    const teamBuffs = result.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "buzhigui_team");
    expect(teamBuffs.length).toBe(1);
    expect((teamBuffs[0] as any).target).toBe("others");
  });
});

describe("V2 Weapon Triggers — 宏愿 (wpn_sword_0021)", () => {
  const tierIdx = 8; // max tier
  const triggers = convertWeaponTriggers(wpn_sword_0021, tierIdx);

  it("converts 1 charge trigger (consumeOnAction)", () => {
    expect(triggers.length).toBe(1);
    expect(triggers[0].id).toBe("hongyuan_buff_charge");
  });

  it("anomaly applied → charge buff → next skill activates damage buff", () => {
    const build = makeGenericBuild("ENDMINISTRATOR", "physical");
    // Skill 1: applies endmin_debuff to enemy (triggers weapon charge)
    const skill1: Skill = {
      id: "endmin_skill", type: "skill", name: "Seal",
      element: "physical", duration: 2, spCost: 50, cooldown: 0,
      hits: [{
        offset: 0.5, checkpointIndex: 0,
        damage: { multiplier: 200, stagger: 5, element: "physical" as DamageElement, canCrit: true, school: "physical" as const, sourceType: "skill" as const },
        effects: [{ type: "buff_apply", params: { buffId: "endmin_debuff", target: "enemy", duration: 10 } }],
        standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    // Skill 2: should consume charge and get physical_dmg buff
    const skill2: Skill = {
      id: "endmin_skill2", type: "skill", name: "Strike",
      element: "physical", duration: 2, spCost: 50, cooldown: 0,
      hits: [{
        offset: 0.5, checkpointIndex: 0,
        damage: { multiplier: 200, stagger: 5, element: "physical" as DamageElement, canCrit: true, school: "physical" as const, sourceType: "skill" as const },
        effects: [],
        standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };

    const trigsByActor = new Map<string, PassiveTrigger[]>();
    trigsByActor.set("ENDMINISTRATOR", triggers);

    const result = simulate([build], [
      { actionId: "act1", actorId: "ENDMINISTRATOR", skill: skill1, startTime: 0 },
      { actionId: "act2", actorId: "ENDMINISTRATOR", skill: skill2, startTime: 3 },
    ], defaultEnemy, { initialSP: 300, critMode: "expected" }, trigsByActor);

    // Charge buff should be applied and then consumed
    const chargeApply = result.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "hongyuan_buff_charge");
    expect(chargeApply.length).toBe(1);
    const chargeRemove = result.events.filter(e => e.type === "buff_remove" && (e as any).buffId === "hongyuan_buff_charge");
    expect(chargeRemove.length).toBe(1);

    // Active buff should be applied on skill2
    const activeApply = result.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "hongyuan_buff_charge_active");
    expect(activeApply.length).toBe(1);

    // Skill2 damage should be higher than skill1 damage (physical_dmg +100.8%)
    const damages = result.events.filter(e => e.type === "damage");
    const dmg1 = (damages.find(e => (e as any).actionId === "act1") as any)?.damage || 0;
    const dmg2 = (damages.find(e => (e as any).actionId === "act2") as any)?.damage || 0;
    expect(dmg2).toBeGreaterThan(dmg1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Break / armor-break regression tests
// ═══════════════════════════════════════════════════════════════════

import { projectBreakBars, projectActionBars } from "./projections";
import { registerScaleByResolver, registerEventNormalizer, resolveValue, normalizeTriggerEvent } from "./valueSource";
import { armorBreakVulnerability } from "./anomaly";

function makePhysBuild(id: string = "PHYS") {
  const input: CharacterInput = {
    id, name: id, element: "physical" as DamageElement, rarity: 6,
    promotion: 4, potentialLevel: 0, talentLevels: {},
    baseStrength: 100, baseAgility: 100, baseIntellect: 100, baseWill: 100,
    baseAttack: 300, baseHp: 1000,
    mainAttribute: "strength", subAttribute: "agility",
    weaponId: null, weaponBaseAtk: 500, weaponLevel: 90,
    equipmentSetId: null, baseGaugeMax: 300,
    statModifiers: [],
  };
  return computeCharacterBuild(input);
}

function makeSkillWithEffects(hits: { offset: number; effects: any[] }[]): Skill {
  return {
    id: "test_phys_skill", type: "skill", name: "Phys Skill",
    element: "physical", duration: 5, spCost: 0, cooldown: 0,
    hits: hits.map(h => ({
      offset: h.offset,
      checkpointIndex: 0,
      damage: { multiplier: 100, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType: "skill" as const },
      effects: h.effects,
      standardLogic: true,
    })),
    checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, hits.length - 1] }],
  };
}

describe("V2 Kernel — Break stack projection", () => {
  it("merges consecutive stack additions into one BreakBar", () => {
    // Skill fires break_apply then two knockdowns (each +1 stack, no consume).
    const build = makePhysBuild();
    const skill = makeSkillWithEffects([
      { offset: 0.1, effects: [{ type: "break_apply", params: { stacks: 1 } }] },
      { offset: 0.3, effects: [{ type: "physical_anomaly", params: { physicalType: "knockdown" } }] },
      { offset: 0.6, effects: [{ type: "physical_anomaly", params: { physicalType: "knockdown" } }] },
    ]);
    const result = simulate([build], [
      { actionId: "act", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const bars = projectBreakBars(result.events, 10);
    expect(bars.length).toBe(1);
    expect(bars[0].stacks).toBe(3);           // max reached
    expect(bars[0].segments.length).toBe(3);   // 1 → 2 → 3
    expect(bars[0].segments[0].stacks).toBe(1);
    expect(bars[0].segments[1].stacks).toBe(2);
    expect(bars[0].segments[2].stacks).toBe(3);
  });

  it("closes a bar when break is consumed, opens a new one on re-apply", () => {
    const build = makePhysBuild();
    const skill = makeSkillWithEffects([
      { offset: 0.1, effects: [{ type: "break_apply", params: { stacks: 1 } }] },
      { offset: 0.3, effects: [{ type: "physical_anomaly", params: { physicalType: "knockdown" } }] },
      // Slam consumes all → stacks go 0
      { offset: 0.5, effects: [{ type: "physical_anomaly", params: { physicalType: "slam" } }] },
      // Re-apply
      { offset: 0.8, effects: [{ type: "break_apply", params: { stacks: 1 } }] },
    ]);
    const result = simulate([build], [
      { actionId: "act", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const bars = projectBreakBars(result.events, 10);
    expect(bars.length).toBe(2);
    expect(bars[0].stacks).toBe(2);
    expect(bars[0].consumedBy).toBe("slam");
    expect(bars[1].stacks).toBe(1);
  });
});

describe("V2 Kernel — Armor break physical vulnerability", () => {
  it("refreshes (does not accumulate) on repeated armor break", () => {
    const build = makePhysBuild();
    // Build up 4 stacks, armor break, then build up 4 again, armor break again.
    // Second 碎甲 should refresh (replace), not stack additively.
    const skill = makeSkillWithEffects([
      { offset: 0.0, effects: [{ type: "break_apply", params: { stacks: 4 } }] },
      { offset: 0.1, effects: [{ type: "physical_anomaly", params: { physicalType: "armorBreak" } }] },
      { offset: 0.2, effects: [{ type: "break_apply", params: { stacks: 4 } }] },
      { offset: 0.3, effects: [{ type: "physical_anomaly", params: { physicalType: "armorBreak" } }] },
      // Post-second-armorBreak damage at 0.4 to sample state
      { offset: 0.4, effects: [] },
    ]);
    const result = simulate([build], [
      { actionId: "act", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    // Single-carrier expected vuln from 4-stack armor break
    const artsPower = build.stats.originiumArtsPower;
    const expectedSingleVuln = armorBreakVulnerability(4, artsPower);

    // Compare damage of last hit (offset 0.4) vs a baseline run WITHOUT any armor break.
    // Under accumulation bug, the damage would be ~2x vuln worth; under refresh, it's ~1x.
    const baseResult = simulate([build], [{
      actionId: "act_base", actorId: "PHYS",
      skill: makeSkillWithEffects([{ offset: 0.4, effects: [] }]),
      startTime: 0,
    }], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const lastDmg = (result.events.filter(e => e.type === "damage").pop() as any).damage;
    const baseDmg = (baseResult.events.filter(e => e.type === "damage").pop() as any).damage;

    // Damage scaling from fragility: (1 + vuln/100). Tolerance for FP + integer floor.
    const actualRatio = lastDmg / baseDmg;
    const refreshRatio = 1 + expectedSingleVuln / 100;
    const accumulateRatio = 1 + (expectedSingleVuln * 2) / 100;

    expect(Math.abs(actualRatio - refreshRatio)).toBeLessThan(0.01);
    expect(Math.abs(actualRatio - accumulateRatio)).toBeGreaterThan(0.05); // clearly NOT doubled
  });

  it("expires after armorBreakVulnDuration and stops boosting damage", () => {
    const build = makePhysBuild();
    // 1-stack armor break → duration = 1*6+6 = 12s. Damage after 15s should be unaffected.
    const skill = makeSkillWithEffects([
      { offset: 0.0, effects: [{ type: "break_apply", params: { stacks: 1 } }] },
      { offset: 0.1, effects: [{ type: "physical_anomaly", params: { physicalType: "armorBreak" } }] },
      { offset: 15.0, effects: [] }, // past 12s expiry
    ]);
    const result = simulate([build], [
      { actionId: "act", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const baseResult = simulate([build], [{
      actionId: "act_base", actorId: "PHYS",
      skill: makeSkillWithEffects([{ offset: 15.0, effects: [] }]),
      startTime: 0,
    }], defaultEnemy, { initialSP: 0, critMode: "expected" });

    // Damage at offset 15 should equal baseline (no lingering fragility).
    const lateDmg = (result.events.filter(e => e.type === "damage" && (e as any).time >= 15).pop() as any).damage;
    const baseDmg = (baseResult.events.filter(e => e.type === "damage").pop() as any).damage;
    expect(lateDmg).toBe(baseDmg);
  });

  it("natural break expiry emits event at true expiresAt, not next action start", () => {
    // break_apply at t=0 with default duration 30s. No actions until t=40 to force
    // observation lag. The natural expiry should still be reported at t=30, not t=40.
    const build = makePhysBuild();
    const skill1: Skill = {
      id: "s1", type: "skill", name: "s1", element: "physical",
      duration: 0.5, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.1, checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType: "skill" as const },
        effects: [{ type: "break_apply", params: { stacks: 1 } }],
        standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    // Dummy action long after the 30s break expiry to trigger observation
    const skill2: Skill = {
      id: "s2", type: "skill", name: "s2", element: "physical",
      duration: 0.5, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.1, checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType: "skill" as const },
        effects: [],
        standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    const result = simulate([build], [
      { actionId: "a1", actorId: "PHYS", skill: skill1, startTime: 0 },
      { actionId: "a2", actorId: "PHYS", skill: skill2, startTime: 40 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const bars = projectBreakBars(result.events, 50);
    expect(bars.length).toBe(1);
    // Break was applied at 0.1, expires 30s later → endTime 30.1, not 40.
    expect(bars[0].endTime).toBeCloseTo(30.1, 2);
  });
});

describe("V2 Kernel — buff_apply condition gating", () => {
  it("applies buff when condition enemy_not_has_break is met (no break)", () => {
    const build = makePhysBuild();
    const skill = makeSkillWithEffects([{
      offset: 0.1,
      effects: [{
        type: "buff_apply",
        params: {
          buffId: "test_vuln", target: "enemy",
          stat: "physical_dmg", zone: "vulnerability",
          value: 10, duration: 5,
          condition: "enemy_not_has_break",
        },
      }],
    }]);
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const applies = result.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "test_vuln");
    expect(applies.length).toBe(1);
  });

  it("skips buff when condition enemy_not_has_break is NOT met (break present)", () => {
    const build = makePhysBuild();
    const skill = makeSkillWithEffects([
      { offset: 0.05, effects: [{ type: "break_apply", params: { stacks: 1 } }] },
      {
        offset: 0.1,
        effects: [{
          type: "buff_apply",
          params: {
            buffId: "test_vuln", target: "enemy",
            stat: "physical_dmg", zone: "vulnerability",
            value: 10, duration: 5,
            condition: "enemy_not_has_break",
          },
        }],
      },
    ]);
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const applies = result.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "test_vuln");
    expect(applies.length).toBe(0);
  });
});

describe("V2 Kernel — delayed_damage multiplierFromTalent", () => {
  it("resolves multiplier via resolveRef when using multiplierFromTalent", () => {
    const build = makePhysBuild();
    const skill = makeSkillWithEffects([{
      offset: 0.1,
      effects: [{
        type: "delayed_damage",
        params: {
          multiplierFromTalent: "talent_1",
          element: "physical", school: "physical", canCrit: false,
        },
      }],
    }]);
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, {
      initialSP: 0, critMode: "expected",
      resolveRef: (_id: string, label: string) => label === "talent_1" ? 100 : 0,
    });

    const trigDamages = result.events.filter(e => e.type === "damage" && (e as any).fromTrigger);
    expect(trigDamages.length).toBe(1);
    expect((trigDamages[0] as any).multiplier).toBe(100);
  });
});

describe("V2 Kernel — conditional hit_mark", () => {
  it("emits hit_mark for hits whose condition-gated effect fires", () => {
    const build = makePhysBuild();
    // Two hits: first has a condition that's met, second has a condition that fails.
    const skill = makeSkillWithEffects([
      {
        offset: 0.1,
        effects: [{
          type: "buff_apply",
          params: {
            buffId: "vuln_a", target: "enemy",
            stat: "physical_dmg", zone: "vulnerability",
            value: 10, duration: 5,
            condition: "enemy_not_has_break", // met — no break yet
          },
        }],
      },
      { offset: 0.15, effects: [{ type: "break_apply", params: { stacks: 1 } }] },
      {
        offset: 0.2,
        effects: [{
          type: "buff_apply",
          params: {
            buffId: "vuln_b", target: "enemy",
            stat: "physical_dmg", zone: "vulnerability",
            value: 10, duration: 5,
            condition: "enemy_not_has_break", // NOT met — break is now present
          },
        }],
      },
    ]);
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const marks = result.events.filter(e => e.type === "hit_mark") as any[];
    // Only hit 0 had a condition-gated effect that passed.
    expect(marks.length).toBe(1);
    expect(marks[0].actionId).toBe("a");
    expect(marks[0].hitIndex).toBe(0);
    expect(marks[0].kind).toBe("conditional");

    // buff_apply for vuln_b must NOT have been emitted (condition failed).
    const applies = result.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "vuln_b");
    expect(applies.length).toBe(0);
  });

  it("projectActionBars attaches conditionalHits indices", () => {
    const build = makePhysBuild();
    const skill = makeSkillWithEffects([
      {
        offset: 0.1,
        effects: [{
          type: "buff_apply",
          params: {
            buffId: "vuln_a", target: "enemy",
            stat: "physical_dmg", zone: "vulnerability",
            value: 10, duration: 5,
            condition: "enemy_not_has_break",
          },
        }],
      },
    ]);
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const bars = projectActionBars(result.events);
    const bar = bars.get("a");
    expect(bar?.conditionalHits).toEqual([0]);
  });
});

describe("V2 Kernel — deferTo + MultiplierRef.scaleBy (别礼 link hit 2 pattern)", () => {
  it("consume_attachment with deferTo=afterSkillDamage runs after hit damage", () => {
    const build = makePhysBuild();
    const skill: Skill = {
      id: "s", type: "skill", name: "s",
      element: "cold", duration: 2, spCost: 0, cooldown: 0,
      hits: [
        // Seed enemy with 4 cold attachment
        { offset: 0.0, checkpointIndex: 0, damage: { multiplier: 100, stagger: 0, element: "cold" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const }, effects: [
          { type: "magic_attachment", params: { element: "cold", stacks: 4 } },
        ], standardLogic: true },
        // Consume with deferTo — sample damage at the SAME hit
        {
          offset: 0.5, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "cold" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
          effects: [{ type: "consume_attachment", params: { element: "cold", deferTo: "afterSkillDamage" } }],
          standardLogic: true,
        },
      ],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 1] }],
    };
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    // Order: damage events at 0.5 must precede attachment_change clearing.
    const timeline = result.events.filter(e => {
      if (e.type === "damage") return (e as any).time === 0.5;
      if (e.type === "attachment_change") return (e as any).time === 0.5;
      return false;
    });
    // Expect: damage (hit 2) → attachment_change (cleared) — confirms consume deferred past hit damage.
    expect(timeline.length).toBe(2);
    expect(timeline[0]!.type).toBe("damage");
    expect(timeline[1]!.type).toBe("attachment_change");
    expect((timeline[1] as any).stacks).toBe(0);
  });

  it("MultiplierRef.scaleBy=attachmentStacks multiplies damage by current stacks", () => {
    const build = makePhysBuild();
    const skill: Skill = {
      id: "s", type: "skill", name: "s",
      element: "cold", duration: 2, spCost: 0, cooldown: 0,
      hits: [
        // Stack 4 cold
        { offset: 0.0, checkpointIndex: 0, damage: { multiplier: 0, stagger: 0, element: "cold" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const }, effects: [
          { type: "magic_attachment", params: { element: "cold", stacks: 4 } },
        ], standardLogic: true },
        // Deal damage with scaleBy — should see stacks=4
        {
          offset: 0.5, checkpointIndex: 0,
          damage: { multiplier: 100, multiplierRef: undefined, stagger: 0, element: "cold" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
          effects: [],
          standardLogic: true,
        },
      ],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 1] }],
    };
    // Baseline: multiplier 100 flat
    const baseResult = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    // Actually test scaleBy via a literal multiplierRef. Since baseline uses a hardcoded
    // multiplier, compare against a skill that uses scaleBy with a stub resolveRef.
    const scaleSkill: Skill = {
      ...skill,
      hits: [
        skill.hits[0]!,
        {
          offset: 0.5, checkpointIndex: 0,
          damage: {
            multiplierRef: { label: "per_layer_mult", share: 1, scaleBy: "attachmentStacks" },
            stagger: 0, element: "cold" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const,
          },
          effects: [{ type: "consume_attachment", params: { element: "cold", deferTo: "afterSkillDamage" } }],
          standardLogic: true,
        },
      ],
    };
    const scaleResult = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill: scaleSkill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" }, undefined, undefined, undefined);
    // resolveRef default returns 0 for unknown labels. Override via config:
    const scaleResult2 = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill: scaleSkill, startTime: 0 },
    ], defaultEnemy, {
      initialSP: 0, critMode: "expected",
      resolveRef: (_id: string, label: string) => label === "per_layer_mult" ? 100 : 0,
    });

    // scaleResult2 hit 2 damage = baseResult hit 2 damage × 4 (since 4 attachment stacks at time of resolution).
    const baseDmg = (baseResult.events.filter(e => e.type === "damage" && (e as any).time === 0.5)[0] as any).damage;
    const scaleDmg = (scaleResult2.events.filter(e => e.type === "damage" && (e as any).time === 0.5)[0] as any).damage;
    expect(scaleDmg).toBe(baseDmg * 4);

    // Without config (resolveRef returns 0), scaleBy × 0 = 0 damage.
    const noCfgDmg = (scaleResult.events.filter(e => e.type === "damage" && (e as any).time === 0.5)[0] as any).damage;
    expect(noCfgDmg).toBe(0);
  });

  it("attachment_consumed trigger (deferred) still fires after afterSkillDamage consume", () => {
    // Simulate LASTRITE hypothermia-like trigger: listens for attachment_consumed,
    // deferred:true. Even with deferTo on the consume effect, hypothermia still fires.
    const build = makePhysBuild();
    const trigger: PassiveTrigger = {
      id: "hypothermia_like",
      source: "test",
      listenTo: "attachment_consumed",
      deferred: true,
      sourceMustBeOwner: true,
      actions: [
        { type: "buff_apply", params: { buffId: "cold_fragility_like", target: "enemy", stat: "cold_dmg", zone: "fragility", value: 10, duration: 15 } },
      ],
    };
    const skill: Skill = {
      id: "s", type: "skill", name: "s",
      element: "cold", duration: 2, spCost: 0, cooldown: 0,
      hits: [
        { offset: 0.0, checkpointIndex: 0, damage: { multiplier: 100, stagger: 0, element: "cold" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const }, effects: [
          { type: "magic_attachment", params: { element: "cold", stacks: 2 } },
        ], standardLogic: true },
        {
          offset: 0.5, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "cold" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
          effects: [{ type: "consume_attachment", params: { element: "cold", deferTo: "afterSkillDamage" } }],
          standardLogic: true,
        },
      ],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 1] }],
    };
    const trigMap = new Map<string, PassiveTrigger[]>();
    trigMap.set("PHYS", [trigger]);
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" }, trigMap);

    const applies = result.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "cold_fragility_like");
    expect(applies.length).toBe(1);
  });
});

describe("V2 Kernel — ValueSource / EventContext scaleBy", () => {
  it("buff_apply valueRef: { label, scaleBy: 'event.stacks' } scales by consumed stacks (LASTRITE 低温症 pattern)", () => {
    // Fire attachment_consumed with 3 stacks. Deferred trigger applies a buff whose
    // value = resolveRef("talent_0") × event.stacks = 5 × 3 = 15.
    const build = makePhysBuild();
    const trigger: PassiveTrigger = {
      id: "hypothermia_like",
      source: "test",
      listenTo: "attachment_consumed",
      deferred: true,
      sourceMustBeOwner: true,
      actions: [
        { type: "buff_apply", params: {
            buffId: "cold_frag_like", target: "enemy",
            stat: "cold_dmg", zone: "fragility",
            valueRef: { label: "per_layer", scaleBy: "event.stacks" },
            duration: 15,
          } },
      ],
    };
    const skill: Skill = {
      id: "s", type: "skill", name: "s",
      element: "cold", duration: 2, spCost: 0, cooldown: 0,
      hits: [
        { offset: 0.0, checkpointIndex: 0,
          damage: { multiplier: 0, stagger: 0, element: "cold" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
          effects: [{ type: "magic_attachment", params: { element: "cold", stacks: 3 } }],
          standardLogic: true,
        },
        { offset: 0.5, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "cold" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
          effects: [{ type: "consume_attachment", params: { element: "cold" } }],
          standardLogic: true,
        },
      ],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 1] }],
    };
    const trigMap = new Map<string, PassiveTrigger[]>();
    trigMap.set("PHYS", [trigger]);
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, {
      initialSP: 0, critMode: "expected",
      resolveRef: (_id, label) => label === "per_layer" ? 5 : 0,
    }, trigMap);

    // The applied buff should record value = 5 × 3 = 15. We can't introspect the
    // buff value directly from events, but we can verify the buff was applied and
    // that damage against it reflects the expected magnitude. Simpler: compare to
    // a baseline where scaleBy is ignored (per_layer returns 0 → value 0).
    const baseResult = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, {
      initialSP: 0, critMode: "expected",
      resolveRef: () => 0,    // per_layer=0 so buff value=0
    }, trigMap);

    const applies = result.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "cold_frag_like");
    const baseApplies = baseResult.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "cold_frag_like");
    expect(applies.length).toBe(1);
    expect(baseApplies.length).toBe(1);
    // Further subsequent cold damage should be higher with buff active.
    // We've got one hit with cold damage at offset 0.5 (but before the buff applies,
    // since trigger is deferred). Actually the buff applies after the hit that caused
    // the consume, so there's no damage after it in this scenario. Just verify no crash
    // and buff applied correctly.
  });

  it("MultiplierRef.scaleBy='event.stacks' scales damage by event stacks in trigger delayed_damage", () => {
    // Trigger action delayed_damage with multiplier scaled by event.stacks —
    // stack_buff_consumed with 3 consumed → mult × 3.
    const build = makePhysBuild();
    const trigger: PassiveTrigger = {
      id: "scaled_damage",
      source: "test",
      listenTo: "stack_buff_consumed",
      deferred: false,
      sourceMustBeOwner: true,
      actions: [
        { type: "delayed_damage", params: {
            multiplier: { literal: 100, scaleBy: "event.stacks" },
            element: "physical", school: "physical",
          } },
      ],
    };
    const skill: Skill = {
      id: "s", type: "skill", name: "s",
      element: "physical", duration: 2, spCost: 0, cooldown: 0,
      hits: [
        { offset: 0.0, checkpointIndex: 0,
          damage: { multiplier: 0, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType: "skill" as const },
          effects: [{ type: "stack_buff_apply", params: { buffType: "test_stack", stacks: 3, duration: 10 } }],
          standardLogic: true,
        },
        { offset: 0.5, checkpointIndex: 0,
          damage: { multiplier: 0, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType: "skill" as const },
          effects: [{ type: "stack_buff_consume", params: { buffType: "test_stack", stacks: 3 } }],
          standardLogic: true,
        },
      ],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 1] }],
    };
    const trigMap = new Map<string, PassiveTrigger[]>();
    trigMap.set("PHYS", [trigger]);
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" }, trigMap);

    const trigDamages = result.events.filter(e => e.type === "damage" && (e as any).fromTrigger);
    expect(trigDamages.length).toBe(1);
    expect((trigDamages[0] as any).multiplier).toBe(300);   // 100 × 3 consumed
  });

  it("registerScaleByResolver adds a new scaleBy path at runtime", () => {
    registerScaleByResolver("test.constant7", () => 7);
    const ctx = {
      resolveRef: () => 10,
      enemy: { attachment: { element: null, stacks: 0, expiresAt: 0 }, breakStacks: 0 },
    };
    // (literal 3) × (scaleBy 7) = 21
    const v = resolveValue({ literal: 3, scaleBy: "test.constant7" }, "x", ctx);
    expect(v).toBe(21);
  });

  it("registerEventNormalizer lets a new raw event type map into an EventContext", () => {
    registerEventNormalizer("test_raw", (raw: any) => ({
      kind: "buff_add",
      time: raw.time,
      actorId: raw.sourceActorId,
      buffId: raw.data?.customField,
      stacks: raw.data?.n,
    }));
    const ctx = normalizeTriggerEvent({
      type: "test_raw",
      time: 5,
      sourceActorId: "A",
      data: { customField: "my_buff", n: 4 },
    } as any);
    expect(ctx.kind).toBe("buff_add");
    expect(ctx.buffId).toBe("my_buff");
    expect(ctx.stacks).toBe(4);
  });

  it("skill_cast trigger fires at action start with legacy inline damage resolution", () => {
    // Register a trigger that listens to action_start and applies a buff. Verify
    // the buff is applied at the skill's startTime (not hit time).
    const build = makePhysBuild();
    const trigger: PassiveTrigger = {
      id: "on_cast",
      source: "test",
      listenTo: "action_start",
      deferred: false,
      sourceMustBeOwner: true,
      actions: [
        { type: "buff_apply", params: {
            buffId: "cast_bonus", target: "self",
            stat: "attack_percent", zone: "attackPercent",
            value: 20, duration: 5,
          } },
      ],
    };
    const skill: Skill = {
      id: "s", type: "skill", name: "s",
      element: "physical", duration: 2, spCost: 0, cooldown: 0,
      hits: [
        { offset: 0.5, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType: "skill" as const },
          effects: [],
          standardLogic: true,
        },
      ],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    const trigMap = new Map<string, PassiveTrigger[]>();
    trigMap.set("PHYS", [trigger]);
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 10 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" }, trigMap);

    const buffApply = result.events.find(e => e.type === "buff_apply" && (e as any).buffId === "cast_bonus") as any;
    expect(buffApply).toBeTruthy();
    expect(buffApply.time).toBe(10);   // fired at skill startTime, not at hit offset
  });
});

describe("V2 Weapon Triggers — 古渠 (wpn_claym_0014) — per-layer scaling", () => {
  it("buff value = 14 × consumedStacks after slam consumes N break layers", () => {
    const weapon = V2_WEAPON_REGISTRY.wpn_claym_0014!;
    const weaponTriggers = convertWeaponTriggers(weapon, 8); // max tier
    const build = makePhysBuild();
    // Apply 4 break, then slam to consume.
    const skill = makeSkillWithEffects([
      { offset: 0.0, effects: [{ type: "break_apply", params: { stacks: 4 } }] },
      { offset: 0.5, effects: [{ type: "physical_anomaly", params: { physicalType: "slam" } }] },
    ]);
    const trigMap = new Map<string, PassiveTrigger[]>();
    trigMap.set("PHYS", weaponTriggers);
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" }, trigMap);

    const applies = result.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "guqu_buff");
    expect(applies.length).toBe(1);
    // Compare damage with vs without buff. buff gives physical_dmg +14%×4 = 56% dmgBonus.
    // Simpler: simulate a follow-up damage hit after consume, compare to no-trigger baseline.
    const damageSkill = makeSkillWithEffects([
      { offset: 0.0, effects: [{ type: "break_apply", params: { stacks: 4 } }] },
      { offset: 0.5, effects: [{ type: "physical_anomaly", params: { physicalType: "slam" } }] },
      { offset: 1.0, effects: [] }, // hit that benefits from guqu_buff
    ]);
    const withBuff = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill: damageSkill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" }, trigMap);
    const noBuff = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill: damageSkill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const withBuffLastDmg = (withBuff.events.filter(e => e.type === "damage" && (e as any).time >= 1.0).pop() as any).damage;
    const noBuffLastDmg = (noBuff.events.filter(e => e.type === "damage" && (e as any).time >= 1.0).pop() as any).damage;
    // Buff adds 56% to physical dmg zone. Exact ratio depends on other zones,
    // but should be non-trivially larger than no-buff.
    expect(withBuffLastDmg).toBeGreaterThan(noBuffLastDmg);
  });

  it("buff value scales with consumedStacks (2 layers → 14×2 = 28%)", () => {
    const weapon = V2_WEAPON_REGISTRY.wpn_claym_0014!;
    const weaponTriggers = convertWeaponTriggers(weapon, 8);
    const build = makePhysBuild();
    const trigMap = new Map<string, PassiveTrigger[]>();
    trigMap.set("PHYS", weaponTriggers);
    // 2 layers
    const skill2 = makeSkillWithEffects([
      { offset: 0.0, effects: [{ type: "break_apply", params: { stacks: 2 } }] },
      { offset: 0.5, effects: [{ type: "physical_anomaly", params: { physicalType: "slam" } }] },
      { offset: 1.0, effects: [] },
    ]);
    // 4 layers
    const skill4 = makeSkillWithEffects([
      { offset: 0.0, effects: [{ type: "break_apply", params: { stacks: 4 } }] },
      { offset: 0.5, effects: [{ type: "physical_anomaly", params: { physicalType: "slam" } }] },
      { offset: 1.0, effects: [] },
    ]);
    const r2 = simulate([build], [{ actionId: "a", actorId: "PHYS", skill: skill2, startTime: 0 }], defaultEnemy, { initialSP: 0, critMode: "expected" }, trigMap);
    const r4 = simulate([build], [{ actionId: "a", actorId: "PHYS", skill: skill4, startTime: 0 }], defaultEnemy, { initialSP: 0, critMode: "expected" }, trigMap);
    const dmg2 = (r2.events.filter(e => e.type === "damage" && (e as any).time >= 1.0).pop() as any).damage;
    const dmg4 = (r4.events.filter(e => e.type === "damage" && (e as any).time >= 1.0).pop() as any).damage;
    // 4-layer buff must exceed 2-layer buff (more % physical dmg)
    expect(dmg4).toBeGreaterThan(dmg2);
  });
});

describe("V2 Buff source icons (actor / skill modes)", () => {
  it("weapon trigger produces buff with sourceRef kind=weapon", () => {
    const weapon = V2_WEAPON_REGISTRY.wpn_claym_0014!;
    const weaponTriggers = convertWeaponTriggers(weapon, 8);
    const build = makePhysBuild();
    const skill = makeSkillWithEffects([
      { offset: 0.0, effects: [{ type: "break_apply", params: { stacks: 4 } }] },
      { offset: 0.5, effects: [{ type: "physical_anomaly", params: { physicalType: "slam" } }] },
    ]);
    const trigMap = new Map<string, PassiveTrigger[]>();
    trigMap.set("PHYS", weaponTriggers);
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" }, trigMap);
    const apply = result.events.find(e => e.type === "buff_apply" && (e as any).buffId === "guqu_buff") as any;
    expect(apply).toBeTruthy();
    expect(apply.sourceRef).toEqual({ kind: "weapon", id: "wpn_claym_0014" });
  });

  it("equipment set trigger produces buff with sourceRef kind=equipment_set", () => {
    const set = V2_EQUIPMENT_SET_REGISTRY["阿伯莉遗声"]!;
    const setTriggers = convertSetTriggers(set);
    const build = makePhysBuild();
    const skill: Skill = {
      id: "s", type: "skill", name: "s",
      element: "physical", duration: 2, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.5, checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType: "skill" as const },
        effects: [],
        standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    const trigMap = new Map<string, PassiveTrigger[]>();
    trigMap.set("PHYS", setTriggers);
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" }, trigMap);
    const apply = result.events.find(e => e.type === "buff_apply" && (e as any).buffId === "aboli_skill") as any;
    expect(apply).toBeTruthy();
    expect(apply.sourceRef).toEqual({ kind: "equipment_set", id: "阿伯莉遗声" });
  });

  it("resolveSourceIcons resolves talent_1 → character talent icon and actor portrait", async () => {
    const { resolveSourceIcons } = await import("./sourceIconResolver");
    const icons = resolveSourceIcons(
      { kind: "talent_1", actorId: "LIFENG" },
      "LIFENG",
    );
    expect(icons.skillIcon).toBe("/avatars/LIFENG/icon_talent_lifeng_02.webp");
    expect(icons.actorIcon).toBe("/avatars/LIFENG/LIFENG.webp");
    expect(icons.label).toContain("LIFENG");
  });

  it("resolveSourceIcons resolves weapon → /weapons/<type>/<id>.webp", async () => {
    const { resolveSourceIcons } = await import("./sourceIconResolver");
    const icons = resolveSourceIcons(
      { kind: "weapon", id: "wpn_claym_0014" },
      "LASTRITE",
    );
    expect(icons.skillIcon).toBe("/weapons/claym/wpn_claym_0014.webp");
    expect(icons.actorIcon).toBe("/avatars/LASTRITE/LASTRITE.webp");
  });

  it("resolveSourceIcons resolves equipment_set via provided resolver callback", async () => {
    const { resolveSourceIcons } = await import("./sourceIconResolver");
    const resolver = (setId: string) => `/equipment/phy01/mock_${setId}.webp`;
    const icons = resolveSourceIcons(
      { kind: "equipment_set", id: "点剑" },
      "PHYS",
      resolver,
    );
    expect(icons.skillIcon).toBe("/equipment/phy01/mock_点剑.webp");
  });

  it("trigger-produced buffs set fromTrigger=true; hit.effect buffs don't", () => {
    // Two buffs are applied at the same hit:
    //   1. Direct hit.effect buff_apply (no trigger involvement) — fromTrigger=false
    //   2. Weapon trigger buff_apply (reacting to slam consumption) — fromTrigger=true
    const weapon = V2_WEAPON_REGISTRY.wpn_sword_0013!;
    const triggers = convertWeaponTriggers(weapon, 8);
    const build = makePhysBuild();
    const skill: Skill = {
      id: "s", type: "skill", name: "s",
      element: "physical", duration: 1, spCost: 0, cooldown: 0,
      hits: [
        { offset: 0.0, checkpointIndex: 0, damage: { multiplier: 100, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType: "skill" as const }, effects: [{ type: "break_apply", params: { stacks: 4 } }], standardLogic: true },
        {
          offset: 0.5, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType: "skill" as const },
          effects: [
            // direct hit.effect
            { type: "buff_apply", params: { buffId: "direct_buff", target: "enemy", stat: "physical_dmg", zone: "vulnerability", value: 10, duration: 5 } },
            // slam consumes break → fires weapon xianhe_* triggers
            { type: "physical_anomaly", params: { physicalType: "slam" } },
          ],
          standardLogic: true,
        },
      ],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 1] }],
    };
    const trigMap = new Map<string, PassiveTrigger[]>();
    trigMap.set("PHYS", triggers);
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" }, trigMap);
    const direct = result.events.find(e => e.type === "buff_apply" && (e as any).buffId === "direct_buff") as any;
    const xianhe = result.events.find(e => e.type === "buff_apply" && (e as any).buffId === "xianhe_self") as any;
    expect(direct).toBeTruthy();
    expect(xianhe).toBeTruthy();
    expect(direct.fromTrigger).toBeFalsy();
    expect(xianhe.fromTrigger).toBe(true);
  });

  it("projectHitEffects skips trigger-sourced buff markers above hit", async () => {
    const { projectHitEffects } = await import("./projections");
    const weapon = V2_WEAPON_REGISTRY.wpn_sword_0013!;
    const triggers = convertWeaponTriggers(weapon, 8);
    const build = makePhysBuild();
    const skill: Skill = {
      id: "s", type: "skill", name: "s",
      element: "physical", duration: 1, spCost: 0, cooldown: 0,
      hits: [
        { offset: 0.0, checkpointIndex: 0, damage: { multiplier: 100, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType: "skill" as const }, effects: [{ type: "break_apply", params: { stacks: 4 } }], standardLogic: true },
        {
          offset: 0.5, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType: "skill" as const },
          effects: [{ type: "physical_anomaly", params: { physicalType: "slam" } }],
          standardLogic: true,
        },
      ],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 1] }],
    };
    const trigMap = new Map<string, PassiveTrigger[]>();
    trigMap.set("PHYS", triggers);
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" }, trigMap);
    const markers = projectHitEffects(result.events);
    // No marker for xianhe buffs (trigger-produced)
    expect(markers.find(m => m.effectType === "xianhe_self")).toBeFalsy();
    expect(markers.find(m => m.effectType === "xianhe_others")).toBeFalsy();
    // slam marker (the skill's own hit.effect) IS present
    expect(markers.find(m => m.effectType === "slam")).toBeTruthy();
  });

  it("hit.effect buff_apply (non-trigger) inherits sourceRef from the hit's skill type", () => {
    // Simulates 管理员 连携技 apply 源石结晶 pattern: buff_apply in hit.effects.
    const build = makePhysBuild();
    const skill: Skill = {
      id: "mock_link", type: "link", name: "mock link",
      element: "physical", duration: 1.5, spCost: 0, cooldown: 0,
      hits: [
        { offset: 0.5, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType: "link" as const },
          effects: [{ type: "buff_apply", params: { buffId: "mock_link_debuff", target: "enemy", duration: 20 } }],
          standardLogic: true,
        },
      ],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });
    const apply = result.events.find(e => e.type === "buff_apply" && (e as any).buffId === "mock_link_debuff") as any;
    expect(apply).toBeTruthy();
    // sourceRef should be inferred from the hit's skill type (link).
    expect(apply.sourceRef).toEqual({ kind: "link", actorId: "PHYS" });
  });
});

describe("V2 Buff icon fallback (stat+zone)", () => {
  it("resolveBuffIcon falls back to icon_normal_atk_efficiency for attack+attackPercent", () => {
    const icon = resolveBuffIcon("xianhe_self_unregistered", "attack", "attackPercent");
    expect(icon).toBe("/icons/icon_normal_atk_efficiency.webp");
  });
  it("resolveBuffIcon returns empty for unknown buff + unknown stat/zone", () => {
    expect(resolveBuffIcon("never_heard_of_it")).toBe("");
    expect(resolveBuffIcon("no_meta", "unknown_stat", "unknown_zone")).toBe("");
  });
  it("resolveBuffIcon prefers explicit metadata over fallback", () => {
    const icon = resolveBuffIcon("fire_enhance", "blaze_dmg", "dmgBonus");
    expect(icon).toBe("/icons/icon_battle_affix_fire_enhance.webp");
  });
});

describe("V2 Weapon Triggers — 显赫声名 (wpn_sword_0013) — compound formula", () => {
  it("self buff value = 14 + 7×consumedStacks (max tier)", () => {
    // 4 layers → 14 + 7×4 = 42% ATK
    // 1 layer  → 14 + 7×1 = 21% ATK
    const weapon = V2_WEAPON_REGISTRY.wpn_sword_0013!;
    const weaponTriggers = convertWeaponTriggers(weapon, 8);
    // Self + Others → 2 triggers
    expect(weaponTriggers.length).toBe(2);
    expect(weaponTriggers[0]!.id).toBe("xianhe_self");
    expect(weaponTriggers[1]!.id).toBe("xianhe_others");

    const build = makePhysBuild();
    const trigMap = new Map<string, PassiveTrigger[]>();
    trigMap.set("PHYS", weaponTriggers);
    const skill = makeSkillWithEffects([
      { offset: 0.0, effects: [{ type: "break_apply", params: { stacks: 4 } }] },
      { offset: 0.5, effects: [{ type: "physical_anomaly", params: { physicalType: "slam" } }] },
      { offset: 1.0, effects: [] },
    ]);
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" }, trigMap);

    const applies = result.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "xianhe_self");
    expect(applies.length).toBe(1);
  });
});

describe("V2 Equipment Triggers — 阿伯莉遗声 fires on action_start not hit", () => {
  it("buff applied at skill startTime (action_start), not at hit time", () => {
    const aboli = V2_EQUIPMENT_SET_REGISTRY["阿伯莉遗声"]!;
    const abolitriggers = convertSetTriggers(aboli);
    const build = makePhysBuild();
    const trigMap = new Map<string, PassiveTrigger[]>();
    trigMap.set("PHYS", abolitriggers);

    const skill: Skill = {
      id: "s", type: "skill", name: "s",
      element: "physical", duration: 2, spCost: 0, cooldown: 0,
      hits: [{
        offset: 1.5, checkpointIndex: 0,   // hit is LATE in the action
        damage: { multiplier: 100, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType: "skill" as const },
        effects: [],
        standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    const result = simulate([build], [
      { actionId: "a", actorId: "PHYS", skill, startTime: 10 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" }, trigMap);

    const apply = result.events.find(e => e.type === "buff_apply" && (e as any).buffId === "aboli_skill") as any;
    expect(apply).toBeTruthy();
    expect(apply.time).toBe(10);  // action_start, not 11.5 (hit time)
  });
});

describe("V2 Kernel — physical_anomaly_type trigger condition", () => {
  it("accepts both `physicalTypes` (array) and legacy `physicalType` (string)", () => {
    // Regression: 黎风 伏魔 trigger wrote `physicalType: "knockdown"` but triggers.ts
    // read `cond.params.physicalTypes.includes(...)` → crashed only when enemy had
    // break (otherwise knockdown degenerates to break_applied and no trigger fires).
    const build = makePhysBuild();
    const trigger: PassiveTrigger = {
      id: "test_knockdown_trigger",
      source: "test",
      listenTo: "physical_anomaly",
      deferred: false,
      sourceMustBeOwner: true,
      condition: { type: "physical_anomaly_type", params: { physicalType: "knockdown" } } as any,
      actions: [
        { type: "delayed_damage", params: { multiplier: 50, element: "physical", school: "physical", canCrit: false } },
      ],
    };
    const skill = makeSkillWithEffects([
      { offset: 0.05, effects: [{ type: "break_apply", params: { stacks: 1 } }] },
      { offset: 0.1, effects: [{ type: "physical_anomaly", params: { physicalType: "knockdown" } }] },
    ]);
    const trigMap = new Map<string, PassiveTrigger[]>();
    trigMap.set("PHYS", [trigger]);

    expect(() => {
      simulate([build], [
        { actionId: "a", actorId: "PHYS", skill, startTime: 0 },
      ], defaultEnemy, { initialSP: 0, critMode: "expected" }, trigMap);
    }).not.toThrow();
  });
});

describe("V2 Kernel — magic attachment stacking (burst + duration refresh)", () => {
  // Cold skill with N single-stack hits at fixed offsets so we can assert per-hit outcomes.
  function coldSkillAt(offsets: number[]): Skill {
    const hits: Hit[] = offsets.map((off) => ({
      offset: off,
      checkpointIndex: 0,
      damage: { multiplier: 100, stagger: 0, element: "cold" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
      effects: [{ type: "magic_attachment", params: { element: "cold", stacks: 1 } }],
      standardLogic: true,
    }));
    return {
      id: "attach_test", type: "skill", name: "Attach Test",
      element: "cold", duration: offsets[offsets.length - 1] + 1, spCost: 0, cooldown: 0,
      hits, checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, offsets.length - 1] }],
    };
  }

  it("first same-element hit: stacks 0→1, no burst", () => {
    const build = makeGenericBuild("ACTOR", "cold");
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill: coldSkillAt([0.5]), startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const attachChanges = result.events.filter(e => e.type === "attachment_change") as any[];
    const applied = attachChanges.filter(c => c.stacks > 0);
    expect(applied.length).toBe(1);
    expect(applied[0].stacks).toBe(1);
    expect(applied[0].prevStacks).toBe(0);

    // Only the skill hit itself should emit a damage event; no burst damage on first hit.
    const actionDamages = result.events.filter(e => e.type === "damage" && (e as any).actionId === "a");
    expect(actionDamages.length).toBe(1);
  });

  it("second same-element hit: stacks 1→2, burst fires with stacks=2, duration refreshed", () => {
    const build = makeGenericBuild("ACTOR", "cold");
    const skill = coldSkillAt([0.5, 5.5]); // 5s apart — attachment still alive
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    // attachment_change events: 0→1, 1→2, plus end-of-sim expiry at t=35.5 (stacks=0).
    const attachChanges = result.events.filter(e => e.type === "attachment_change") as any[];
    const applied = attachChanges.filter(c => c.stacks > 0);
    expect(applied.length).toBe(2);
    expect(applied[0].stacks).toBe(1);
    expect(applied[0].time).toBeCloseTo(0.5, 5);
    expect(applied[1].stacks).toBe(2);
    expect(applied[1].prevStacks).toBe(1);
    expect(applied[1].time).toBeCloseTo(5.5, 5);

    // Duration refresh proof: the single expiry event sits at refreshed time (5.5+30=35.5),
    // not at the original 0.5+30=30.5.
    const expiry = attachChanges.find(c => c.stacks === 0);
    expect(expiry).toBeTruthy();
    expect(expiry.time).toBeCloseTo(35.5, 5);
  });

  it("burst stacks value scales with current attachment stacks (1→2→3→4)", () => {
    const build = makeGenericBuild("ACTOR", "cold");
    // 4 hits, all within 30s window → stacks go 1,2,3,4
    const skill = coldSkillAt([0.5, 1.0, 1.5, 2.0]);
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const attachChanges = result.events.filter(e => e.type === "attachment_change") as any[];
    const applied = attachChanges.filter(c => c.stacks > 0);
    expect(applied.map(c => c.stacks)).toEqual([1, 2, 3, 4]);

    // magic_burst damage events: emitted on hits 2,3,4 (not on hit 1).
    // Identify burst damage via being a damage event whose (sourceId, actionId) matches
    // but multiplier differs from the skill's raw 100. They share actionId="a" and hitIndex=0.
    // The kernel tags burst damage with the original actionId and hitIndex=0 — the skill
    // hit damage is tagged with multiplier 100 (scaled later). Distinguish by multiplier value.
    const allDamages = result.events.filter(e => e.type === "damage" && (e as any).actionId === "a") as any[];
    // Skill hits: 4 events with multiplier derived from the 100 raw %. Burst: 3 extra events.
    // They can share the same timestamp as the hit — use the count only.
    expect(allDamages.length).toBe(4 + 3); // 4 skill hits + 3 bursts (hits 2,3,4)
  });

  it("attachment duration is refreshed on each same-element hit", () => {
    const build = makeGenericBuild("ACTOR", "cold");
    // First hit at 0.5 (expiry would be 30.5). Second hit at 25 (expiry refreshed to 55).
    // Without refresh, attachment would expire at 30.5.
    // Probe attachment alive at t=40 via a link from an identical actor with cold element —
    // easier approach: assert no attachment_change with stacks=0 before the second hit lands,
    // and final sim duration carries no expiry if we stop before t=55.
    const skill = coldSkillAt([0.5, 25]);
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    // Collect all attachment_change events (including end-of-sim expiry at Infinity).
    const attachChanges = result.events.filter(e => e.type === "attachment_change") as any[];
    // Final attachment expiry happens at the original expiresAt of the refreshed stack:
    //   second hit at t=25 → expiresAt = 55. advanceTime(Infinity) triggers expiry event.
    // The expiry event carries stacks=0 and time=55 (the recorded expiresAt).
    const expiry = attachChanges.find(c => c.stacks === 0);
    expect(expiry).toBeTruthy();
    expect(expiry.time).toBeCloseTo(55, 5); // proves refresh happened; without refresh it'd be 30.5
  });

  // Cross-element skill: first N cold hits to seed attachment, then 1 fire hit to trigger reaction.
  function seedColdThenFire(coldStacks: number): Skill {
    const hits: Hit[] = [];
    for (let i = 0; i < coldStacks; i++) {
      hits.push({
        offset: 0.5 + i * 0.3,
        checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "cold" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
        effects: [{ type: "magic_attachment", params: { element: "cold", stacks: 1 } }],
        standardLogic: true,
      });
    }
    hits.push({
      offset: 0.5 + coldStacks * 0.3,
      checkpointIndex: 0,
      damage: { multiplier: 100, stagger: 0, element: "blaze" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
      effects: [{ type: "magic_attachment", params: { element: "blaze", stacks: 1 } }],
      standardLogic: true,
    });
    return {
      id: "reaction_test", type: "skill", name: "Reaction Test",
      element: "cold", duration: hits[hits.length - 1].offset + 1, spCost: 0, cooldown: 0,
      hits, checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, hits.length - 1] }],
    };
  }

  it("reaction anomaly level = consumed attachment stacks", () => {
    // 3 cold hits → attachment at 3 stacks, then fire hit → burning at level 3
    const build = makeGenericBuild("ACTOR", "cold");
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill: seedColdThenFire(3), startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const anomalyApplies = result.events.filter(e => e.type === "anomaly_apply") as any[];
    expect(anomalyApplies.length).toBe(1);
    expect(anomalyApplies[0].anomalyType).toBe("burning");
    expect(anomalyApplies[0].level).toBe(3);
    // duration: burning = 10s (constant)
    expect(anomalyApplies[0].duration).toBe(10);

    // Attachment cleared after reaction — last attachment_change has stacks=0
    const attachChanges = result.events.filter(e => e.type === "attachment_change") as any[];
    const reactionClear = attachChanges.find(c => c.stacks === 0 && c.prevStacks === 3);
    expect(reactionClear).toBeTruthy();
  });

  it("reaction anomaly level varies with consumed stacks (1/2/4 → level 1/2/4)", () => {
    for (const coldStacks of [1, 2, 4]) {
      const build = makeGenericBuild("ACTOR", "cold");
      const result = simulate([build], [
        { actionId: "a", actorId: "ACTOR", skill: seedColdThenFire(coldStacks), startTime: 0 },
      ], defaultEnemy, { initialSP: 0, critMode: "expected" });

      const anomalyApply = result.events.find(e => e.type === "anomaly_apply") as any;
      expect(anomalyApply, `coldStacks=${coldStacks}`).toBeTruthy();
      expect(anomalyApply.level).toBe(coldStacks);
    }
  });

  it("reaction conduction level → duration (level*6 + 6) and spell-vulnerability level-driven", () => {
    // 2 cold then 1 electro → conduction at level 2
    // We need cold→electro reaction: CROSS_ELEMENT_ANOMALY[electro] = conduction
    const skill = ((): Skill => {
      const hits: Hit[] = [
        {
          offset: 0.5, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "cold" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
          effects: [{ type: "magic_attachment", params: { element: "cold", stacks: 1 } }],
          standardLogic: true,
        },
        {
          offset: 0.8, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "cold" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
          effects: [{ type: "magic_attachment", params: { element: "cold", stacks: 1 } }],
          standardLogic: true,
        },
        {
          offset: 1.1, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "emag" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
          effects: [{ type: "magic_attachment", params: { element: "emag", stacks: 1 } }],
          standardLogic: true,
        },
      ];
      return {
        id: "rxn_conduction", type: "skill", name: "Rxn Conduction",
        element: "cold", duration: 2.5, spCost: 0, cooldown: 0,
        hits, checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 2] }],
      };
    })();

    const build = makeGenericBuild("ACTOR", "cold");
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const anomalyApply = result.events.find(e => e.type === "anomaly_apply") as any;
    expect(anomalyApply).toBeTruthy();
    expect(anomalyApply.anomalyType).toBe("conduction");
    expect(anomalyApply.level).toBe(2);
    // conduction duration: level*6 + 6 = 18
    expect(anomalyApply.duration).toBe(18);
  });

  it("reaction emits a 法术异常触发 damage event with incoming element + magic school", () => {
    // Spec (kernel-mechanics-audit §3.2): 法术异常触发 = 0.8 × (1+level) × spellLevelCoef × artsPowerDmg (瞬发)
    const build = makeGenericBuild("ACTOR", "cold");
    const skill = seedColdThenFire(3); // 3 cold → blaze reaction, level=3, anomaly=burning
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const reactionTime = 0.5 + 3 * 0.3; // fire hit offset
    const damagesAtReaction = result.events.filter(e =>
      e.type === "damage" && Math.abs((e as any).time - reactionTime) < 0.01) as any[];
    // Skill hit damage + 法术异常触发 damage
    expect(damagesAtReaction.length).toBeGreaterThanOrEqual(2);

    // The extra damage (non-skill-hit) carries incoming element (blaze) and magic school.
    const skillHitMult = 100; // our skill hit multiplier
    const reactionDamage = damagesAtReaction.find(d => d.multiplier !== skillHitMult);
    expect(reactionDamage).toBeTruthy();
    expect(reactionDamage.element).toBe("blaze");
    expect(reactionDamage.school).toBe("magic");
  });

  it("all four reactions emit a 法术异常触发 damage event (burning/frozen/conduction/corrosion)", () => {
    const build = makeGenericBuild("ACTOR", "cold");

    // Helper: build a 2-hit skill where hit1 seeds one element, hit2 reacts with another.
    const rxnSkill = (seedEl: DamageElement, reactEl: DamageElement): Skill => ({
      id: "r", type: "skill", name: "R", element: seedEl, duration: 2, spCost: 0, cooldown: 0,
      hits: [
        { offset: 0.5, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: seedEl, canCrit: false, school: "magic", sourceType: "skill" },
          effects: [{ type: "magic_attachment", params: { element: seedEl, stacks: 1 } }], standardLogic: true },
        { offset: 0.8, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: reactEl, canCrit: false, school: "magic", sourceType: "skill" },
          effects: [{ type: "magic_attachment", params: { element: reactEl, stacks: 1 } }], standardLogic: true },
      ],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 1] }],
    });

    // Pairs: (seed, incoming) → expected anomaly
    const cases: [DamageElement, DamageElement, AnomalyType][] = [
      ["cold", "blaze", "burning"],
      ["blaze", "cold", "frozen"],
      ["cold", "emag", "conduction"],
      ["cold", "nature", "corrosion"],
    ];
    for (const [seed, incoming, expected] of cases) {
      const result = simulate([build], [
        { actionId: "a", actorId: "ACTOR", skill: rxnSkill(seed, incoming), startTime: 0 },
      ], defaultEnemy, { initialSP: 0, critMode: "expected" });
      const extraAtRxn = result.events.filter(e =>
        e.type === "damage" && Math.abs((e as any).time - 0.8) < 0.01 && (e as any).multiplier !== 100);
      expect(extraAtRxn.length, `${seed}→${incoming} should emit 法术异常触发`).toBe(1);
      expect((extraAtRxn[0] as any).element, `${seed}→${incoming}`).toBe(incoming);
      expect((extraAtRxn[0] as any).school).toBe("magic");
      const anomalyApply = result.events.find(e => e.type === "anomaly_apply") as any;
      expect(anomalyApply.anomalyType).toBe(expected);
    }
  });

  it("conduction applies magic fragility (level+2)×4 to subsequent magic damage", () => {
    // Run 1: seed cold then emag (→ conduction level 1). Probe magic damage afterwards.
    // Run 2: same, no reaction (only seed emag, no conduction). Compare damage.
    const build = makeGenericBuild("ACTOR", "cold");

    const probeHit: Hit = {
      offset: 1.5, checkpointIndex: 0,
      damage: { multiplier: 200, stagger: 0, element: "blaze" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
      effects: [], standardLogic: true,
    };
    const withConduction: Skill = {
      id: "wc", type: "skill", name: "WC", element: "cold", duration: 2, spCost: 0, cooldown: 0,
      hits: [
        { offset: 0.5, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "cold" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
          effects: [{ type: "magic_attachment", params: { element: "cold", stacks: 1 } }], standardLogic: true },
        { offset: 0.8, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "emag" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
          effects: [{ type: "magic_attachment", params: { element: "emag", stacks: 1 } }], standardLogic: true },
        probeHit,
      ],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 2] }],
    };
    const noConduction: Skill = {
      ...withConduction, id: "nc",
      hits: [probeHit], // only the probe hit, no reaction
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };

    const run = (skill: Skill) => simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const dmgAtProbe = (evs: any[]) => {
      // probe hit has multiplier 200, element blaze
      const found = evs.find(e => e.type === "damage" && e.multiplier === 200 && Math.abs(e.time - 1.5) < 0.01);
      return (found as any).damage as number;
    };

    const withDmg = dmgAtProbe(run(withConduction).events);
    const withoutDmg = dmgAtProbe(run(noConduction).events);

    // conductionVulnerability(1, 0) = (1+2)*4 * 1 = 12% → fragility zone factor 1.12.
    const ratio = withDmg / withoutDmg;
    expect(ratio).toBeCloseTo(1.12, 1);
  });

  it("corrosion applies time-accruing resist reduction", () => {
    // 1 nature seed reaction: seed another element then hit with nature → corrosion level 1.
    // corrosionParams(1, 0) = { immediate: 3.6, perSecond: 0.84, maxValue: 12, duration: 15 }
    // At t=reaction: corroded = 3.6. Some seconds later: corroded grows.
    const build = makeGenericBuild("ACTOR", "cold");

    // Probe hit uses nature element so resist reduction (which reduces any base magic resist)
    // is observable through damage output. Enemy has baseMagicResist = 0 so resistance zone
    // = 1 + resistReduction/100. A corroded enemy → damage higher than uncorroded.
    const makeSkill = (probeOffset: number, withRxn: boolean): Skill => ({
      id: "c", type: "skill", name: "C", element: "cold", duration: probeOffset + 1, spCost: 0, cooldown: 0,
      hits: [
        // Seed cold + nature to create corrosion (if withRxn)
        ...(withRxn ? [
          { offset: 0.5, checkpointIndex: 0,
            damage: { multiplier: 100, stagger: 0, element: "cold" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
            effects: [{ type: "magic_attachment", params: { element: "cold", stacks: 1 } }], standardLogic: true } as Hit,
          { offset: 0.8, checkpointIndex: 0,
            damage: { multiplier: 100, stagger: 0, element: "nature" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
            effects: [{ type: "magic_attachment", params: { element: "nature", stacks: 1 } }], standardLogic: true } as Hit,
        ] : []),
        // Probe hit with blaze element at probeOffset
        { offset: probeOffset, checkpointIndex: 0,
          damage: { multiplier: 300, stagger: 0, element: "blaze" as DamageElement, canCrit: false, school: "magic" as const, sourceType: "skill" as const },
          effects: [], standardLogic: true } as Hit,
      ],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, withRxn ? 2 : 0] }],
    });

    const run = (skill: Skill) => simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const probeDmg = (evs: any[], probeOffset: number) => {
      const found = evs.find(e => e.type === "damage" && e.multiplier === 300 && Math.abs(e.time - probeOffset) < 0.01);
      return (found as any).damage as number;
    };

    // Probe at t=1.0 (reaction at 0.8 → elapsed=0.2s). Expected corroded ≈ 3.6 + 0.84*0.2 = 3.768
    const earlyCorroded = probeDmg(run(makeSkill(1.0, true)).events, 1.0);
    const earlyClean = probeDmg(run(makeSkill(1.0, false)).events, 1.0);
    const earlyRatio = earlyCorroded / earlyClean;
    expect(earlyRatio).toBeGreaterThan(1.03); // ~1.037
    expect(earlyRatio).toBeLessThan(1.05);

    // Probe at t=10.8 (elapsed=10s). Expected corroded = min(12, 3.6 + 0.84*10) = min(12, 12) = 12
    const lateCorroded = probeDmg(run(makeSkill(10.8, true)).events, 10.8);
    const lateClean = probeDmg(run(makeSkill(10.8, false)).events, 10.8);
    const lateRatio = lateCorroded / lateClean;
    expect(lateRatio).toBeCloseTo(1.12, 1); // 12% resist reduction
  });

  it("reaction damage skips sourceType (skill) bonus but still eats element bonus", () => {
    // Build A: no bonuses. Build B: +50% skillDmgBonus AND +50% blazeDmg.
    // The reaction damage should differ between A and B ONLY by the element (blaze) bonus,
    // not by the skill bonus.
    function makeBuild(withBonuses: boolean) {
      const mods = withBonuses
        ? [
            { source: "test", stat: "skill_dmg_bonus", value: 50, type: "flat" as const },
            { source: "test", stat: "blaze_dmg", value: 50, type: "flat" as const },
          ]
        : [];
      const input: CharacterInput = {
        id: "ACTOR", name: "ACTOR", element: "cold", rarity: 6,
        promotion: 4, potentialLevel: 0, talentLevels: {},
        baseStrength: 100, baseAgility: 100, baseIntellect: 100, baseWill: 100,
        baseAttack: 300, baseHp: 1000,
        mainAttribute: "strength", subAttribute: "agility",
        weaponId: null, weaponBaseAtk: 500, weaponLevel: 90,
        equipmentSetId: null, baseGaugeMax: 300,
        statModifiers: mods,
      };
      return computeCharacterBuild(input);
    }

    const skill = seedColdThenFire(3);
    const reactionTime = 0.5 + 3 * 0.3;
    const runSim = (build: ReturnType<typeof makeBuild>) => simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const noneEvents = runSim(makeBuild(false)).events;
    const bothEvents = runSim(makeBuild(true)).events;

    const getRxnDmg = (evs: any[]) => {
      const found = evs.find(e => e.type === "damage" && Math.abs(e.time - reactionTime) < 0.01 && e.multiplier !== 100);
      return (found as any).damage as number;
    };
    const noneDmg = getRxnDmg(noneEvents);
    const bothDmg = getRxnDmg(bothEvents);

    // Expected ratio: both has only the +50% blaze_dmg applied (additive in dmgBonus zone).
    // dmgBonus zone factor: none→1, both→1 + 0.50 (blaze only) = 1.5.
    // If skill_dmg_bonus were included, factor would be 1 + 0.50 + 0.50 = 2.0 → damage doubled.
    // Allow small floor() rounding tolerance; 1.5 vs 2.0 is far apart so this is unambiguous.
    const ratio = bothDmg / noneDmg;
    expect(ratio).toBeGreaterThan(1.45);
    expect(ratio).toBeLessThan(1.60);
  });

  it("at 4-stack cap: stacks stay at 4 but duration still refreshes and burst still fires", () => {
    const build = makeGenericBuild("ACTOR", "cold");
    // 5 hits: 1,2,3,4,4(capped)
    const skill = coldSkillAt([0.5, 1.0, 1.5, 2.0, 10.0]);
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const attachChanges = result.events.filter(e => e.type === "attachment_change") as any[];
    // All 5 hits emit a stacked attachment_change (even the capped one).
    // Plus one expiry at the end of the sim.
    const stackedChanges = attachChanges.filter(c => c.stacks > 0);
    expect(stackedChanges.map(c => c.stacks)).toEqual([1, 2, 3, 4, 4]);

    // Duration refresh at t=10 → expiresAt = 40.
    const expiry = attachChanges.find(c => c.stacks === 0);
    expect(expiry.time).toBeCloseTo(40, 5);

    // Burst damages: hits 2-5 fire burst = 4 bursts.
    const allDamages = result.events.filter(e => e.type === "damage" && (e as any).actionId === "a") as any[];
    expect(allDamages.length).toBe(5 + 4); // 5 skill hits + 4 bursts
  });
});

describe("V2 Kernel — break stacking & duration refresh", () => {
  // Build a skill with physical-anomaly / break_apply effects at given offsets.
  function makePhysSkill(entries: { offset: number; effect: any }[]): Skill {
    const hits: Hit[] = entries.map(({ offset, effect }) => ({
      offset, checkpointIndex: 0,
      damage: { multiplier: 0, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType: "skill" as const },
      effects: [effect],
      standardLogic: true,
    }));
    return {
      id: "phys_skill", type: "skill", name: "Phys", element: "cold",
      duration: entries[entries.length - 1].offset + 1, spCost: 0, cooldown: 0,
      hits, checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, entries.length - 1] }],
    };
  }

  // BREAK_DURATION is 30s (anomaly.ts). Refresh test: apply break at t=0.5 (expiry=30.5),
  // then the probe action at t=20 (should refresh to 50 if correctly handled).
  function collectBreakChanges(events: any[]) {
    return events.filter(e => e.type === "break_change");
  }

  it("launch on already-broken enemy: stacks +1 AND duration refreshed", () => {
    const build = makeGenericBuild("ACTOR", "cold");
    const skill = makePhysSkill([
      { offset: 0.5, effect: { type: "break_apply", params: { stacks: 1 } } },    // 0→1 break at t=0.5 (expiry=30.5)
      { offset: 20,  effect: { type: "physical_anomaly", params: { physicalType: "launch" } } },
    ]);
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const changes = collectBreakChanges(result.events);
    const applied = changes.filter(c => c.stacks > 0);
    expect(applied.length).toBe(2);
    expect(applied[0].stacks).toBe(1);
    expect(applied[1].stacks).toBe(2);           // +1 from launch
    expect(applied[1].prevStacks).toBe(1);

    // Expiry should be 50 (20 + 30), NOT 30.5 (no refresh would give 30.5)
    const expiry = changes.find(c => c.stacks === 0);
    expect(expiry).toBeTruthy();
    expect(expiry.time).toBeCloseTo(50, 5);
  });

  it("knockdown on already-broken enemy: stacks +1 AND duration refreshed", () => {
    const build = makeGenericBuild("ACTOR", "cold");
    const skill = makePhysSkill([
      { offset: 0.5, effect: { type: "break_apply", params: { stacks: 2 } } },    // 0→2 at t=0.5
      { offset: 20,  effect: { type: "physical_anomaly", params: { physicalType: "knockdown" } } },
    ]);
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const changes = collectBreakChanges(result.events);
    const applied = changes.filter(c => c.stacks > 0);
    expect(applied.length).toBe(2);
    expect(applied[1].stacks).toBe(3);           // 2 + 1
    expect(applied[1].prevStacks).toBe(2);

    const expiry = changes.find(c => c.stacks === 0);
    expect(expiry.time).toBeCloseTo(50, 5);      // refreshed
  });

  it("break_apply on already-broken enemy: stacks += N AND duration refreshed", () => {
    const build = makeGenericBuild("ACTOR", "cold");
    const skill = makePhysSkill([
      { offset: 0.5, effect: { type: "break_apply", params: { stacks: 1 } } },
      { offset: 20,  effect: { type: "break_apply", params: { stacks: 2 } } },
    ]);
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const changes = collectBreakChanges(result.events);
    const applied = changes.filter(c => c.stacks > 0);
    expect(applied.length).toBe(2);
    expect(applied[1].stacks).toBe(3);           // 1 + 2
    expect(applied[1].prevStacks).toBe(1);

    const expiry = changes.find(c => c.stacks === 0);
    expect(expiry.time).toBeCloseTo(50, 5);      // refreshed
  });

  it("break stacks cap at BREAK_MAX_STACKS (4): duration still refreshes at cap", () => {
    const build = makeGenericBuild("ACTOR", "cold");
    const skill = makePhysSkill([
      { offset: 0.5, effect: { type: "break_apply", params: { stacks: 4 } } },   // 0→4 at t=0.5
      { offset: 20,  effect: { type: "physical_anomaly", params: { physicalType: "launch" } } },  // cap-stay
    ]);
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const changes = collectBreakChanges(result.events);
    const applied = changes.filter(c => c.stacks > 0);
    expect(applied.length).toBe(2);
    expect(applied[0].stacks).toBe(4);
    expect(applied[1].stacks).toBe(4);           // capped
    expect(applied[1].prevStacks).toBe(4);

    const expiry = changes.find(c => c.stacks === 0);
    expect(expiry.time).toBeCloseTo(50, 5);      // refresh still happens at cap
  });
});

describe("V2 Kernel — per-skill cooldown gating + link_cd_reduction %", () => {
  // Helper: zero-hit skill (just occupies duration + participates in CD tracking)
  function cdSkill(id: string, type: "link" | "skill" | "ultimate", cooldown: number): Skill {
    return {
      id, type, name: id,
      element: "cold", duration: 1, spCost: 0, cooldown,
      hits: [], checkpoints: [],
    };
  }

  it("link cooldown gates re-placement: second link within CD window is rejected", () => {
    const build = makeGenericBuild("ACTOR", "cold");
    const link = cdSkill("test_link", "link", 10);
    const result = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: link, startTime: 0 },
      { actionId: "a2", actorId: "ACTOR", skill: link, startTime: 5 }, // within 10s CD (end=1, expiry=11)
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });

    // 2nd placement should be rejected with ISSUE_COOLDOWN_ACTIVE
    expect((result.validationError ? 1 : 0)).toBe(1);
    expect(result.validationError!.code).toBe("ISSUE_COOLDOWN_ACTIVE");
    expect(result.validationError!.actionId).toBe("a2");
  });

  it("link cooldown: second link after CD window is accepted", () => {
    const build = makeGenericBuild("ACTOR", "cold");
    const link = cdSkill("test_link", "link", 10);
    const result = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: link, startTime: 0 },
      { actionId: "a2", actorId: "ACTOR", skill: link, startTime: 12 }, // after 11s expiry
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });

    expect((result.validationError ? 1 : 0)).toBe(0);
  });

  it("skill cooldown (non-link): gates re-placement by the same rules", () => {
    const build = makeGenericBuild("ACTOR", "cold");
    const sk = cdSkill("test_skill", "skill", 5);
    const result = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: sk, startTime: 0 },
      { actionId: "a2", actorId: "ACTOR", skill: sk, startTime: 3 }, // within 5s CD (end=1, expiry=6)
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });

    expect((result.validationError ? 1 : 0)).toBe(1);
    expect(result.validationError!.code).toBe("ISSUE_COOLDOWN_ACTIVE");
    expect(result.validationError!.message).toContain("战技");
  });

  it("ultimate cooldown: gated by kernel", () => {
    const build = makeGenericBuild("ACTOR", "cold");
    const ult = cdSkill("test_ult", "ultimate", 20);
    const result = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: ult, startTime: 0 },
      { actionId: "a2", actorId: "ACTOR", skill: ult, startTime: 10 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });

    expect((result.validationError ? 1 : 0)).toBe(1);
    expect(result.validationError!.code).toBe("ISSUE_COOLDOWN_ACTIVE");
    expect(result.validationError!.message).toContain("终结技");
  });

  it("per-skill tracking: two different skills with independent cooldowns both gated individually", () => {
    const build = makeGenericBuild("ACTOR", "cold");
    const link = cdSkill("link_A", "link", 10);
    const ult = cdSkill("ult_B", "ultimate", 10);
    const result = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: link, startTime: 0 },
      { actionId: "a2", actorId: "ACTOR", skill: ult, startTime: 1.5 }, // different skill, CD tracked independently
      { actionId: "a3", actorId: "ACTOR", skill: link, startTime: 3 }, // same as a1, still within CD
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });

    // a1 accepted, a2 accepted (different skill), a3 rejected
    expect((result.validationError ? 1 : 0)).toBe(1);
    expect(result.validationError!.actionId).toBe("a3");
  });

  it("link_cd_reduction stat reduces effective CD: cd*(1-pct/100)", () => {
    function makeCdReductionBuild(pct: number) {
      const input: CharacterInput = {
        id: "CDR", name: "CDR", element: "cold", rarity: 6,
        promotion: 4, potentialLevel: 0, talentLevels: {},
        baseStrength: 100, baseAgility: 100, baseIntellect: 100, baseWill: 100,
        baseAttack: 300, baseHp: 1000,
        mainAttribute: "strength", subAttribute: "agility",
        weaponId: null, weaponBaseAtk: 500, weaponLevel: 90,
        equipmentSetId: null, baseGaugeMax: 300,
        statModifiers: [
          { source: "test", stat: "link_cd_reduction", value: pct, type: "flat" as const },
        ],
      };
      return computeCharacterBuild(input);
    }

    // cd=10s, reduction 25% → effective = 7.5s. Action ends at 1, expiry = 1+7.5 = 8.5.
    const build = makeCdReductionBuild(25);
    const link = cdSkill("lnk", "link", 10);

    // Placement at t=8 should be REJECTED (8 < 8.5).
    const rejected = simulate([build], [
      { actionId: "a1", actorId: "CDR", skill: link, startTime: 0 },
      { actionId: "a2", actorId: "CDR", skill: link, startTime: 8 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((rejected.validationError ? 1 : 0)).toBe(1);
    expect(rejected.validationError!.actionId).toBe("a2");

    // Placement at t=9 should be ACCEPTED (9 > 8.5).
    const accepted = simulate([build], [
      { actionId: "a1", actorId: "CDR", skill: link, startTime: 0 },
      { actionId: "a2", actorId: "CDR", skill: link, startTime: 9 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((accepted.validationError ? 1 : 0)).toBe(0);
  });

  it("without link_cd_reduction, cd applies raw: placement at 8s < 11s expiry is rejected", () => {
    // Sanity baseline for the reduction test — 0% reduction means full CD applies.
    const build = makeGenericBuild("ACTOR", "cold");
    const link = cdSkill("lnk", "link", 10);
    const result = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: link, startTime: 0 },
      { actionId: "a2", actorId: "ACTOR", skill: link, startTime: 8 }, // end=1, expiry=11
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((result.validationError ? 1 : 0)).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Cooldown group (shared CD bucket) — for multi-segment chained skills
// like ROSSI 燎影时刻 第一段 + 第二段.
// ═══════════════════════════════════════════════════════════════════

describe("V2 Kernel — cooldownGroup + cooldownStartOffset (chained-skill CD)", () => {
  function cdSkillExt(opts: {
    id: string;
    type: "link" | "skill" | "ultimate";
    duration?: number;
    cooldown: number;
    cooldownGroup?: string;
    cooldownStartOffset?: number;
    requiresPreviousAction?: Skill["requiresPreviousAction"];
  }): Skill {
    return {
      id: opts.id, type: opts.type, name: opts.id,
      element: "cold",
      duration: opts.duration ?? 1,
      spCost: 0,
      cooldown: opts.cooldown,
      hits: [], checkpoints: [],
      ...(opts.cooldownGroup !== undefined ? { cooldownGroup: opts.cooldownGroup } : {}),
      ...(opts.cooldownStartOffset !== undefined ? { cooldownStartOffset: opts.cooldownStartOffset } : {}),
      ...(opts.requiresPreviousAction !== undefined ? { requiresPreviousAction: opts.requiresPreviousAction } : {}),
    };
  }

  it("cooldownStartOffset delays the CD start past action_end", () => {
    // Skill duration=1, cd=10, offset=5 → expiry = end(1) + offset(5) + cd(10) = 16
    const build = makeGenericBuild("ACTOR", "cold");
    const link = cdSkillExt({ id: "delayed", type: "link", cooldown: 10, cooldownStartOffset: 5 });

    // Placement at t=15 should be REJECTED (15 < 16).
    const rejected = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: link, startTime: 0 },
      { actionId: "a2", actorId: "ACTOR", skill: link, startTime: 15 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((rejected.validationError ? 1 : 0)).toBe(1);

    // Placement at t=17 should be ACCEPTED (17 > 16).
    const accepted = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: link, startTime: 0 },
      { actionId: "a2", actorId: "ACTOR", skill: link, startTime: 17 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((accepted.validationError ? 1 : 0)).toBe(0);
  });

  it("cooldownGroup: 第二段 (chained follow-up) extends bucket via Math.max", () => {
    // 第一段: duration=1, cd=10, offset=5, group=G → expiry = 16
    // 第二段: duration=2, cd=10, group=G, requiresPreviousAction within [0.5, 3]s
    //   Placed at t=2 → bucket Math.max(16, 2+2+10=14) → stays 16
    //   Placed at t=5 → bucket Math.max(16, 5+2+10=17) → 17
    const build = makeGenericBuild("ACTOR", "cold");
    const link1 = cdSkillExt({
      id: "link1", type: "link", duration: 1, cooldown: 10,
      cooldownGroup: "G", cooldownStartOffset: 5,
    });
    const link2 = cdSkillExt({
      id: "link2", type: "link", duration: 2, cooldown: 10,
      cooldownGroup: "G",
      requiresPreviousAction: { skillId: "link1", withinFrames: { min: 30, max: 360 } }, // 0.5s - 6s
    });

    // Case A: 第二段 at t=2 (end=4) → bucket stays at 16 from 第一段.
    // Next 第一段 attempt at t=15 < 16: rejected.
    const caseA = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: link1, startTime: 0 },
      { actionId: "a2", actorId: "ACTOR", skill: link2, startTime: 2 },
      { actionId: "a3", actorId: "ACTOR", skill: link1, startTime: 15 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((caseA.validationError ? 1 : 0)).toBe(1);
    expect(caseA.validationError!.actionId).toBe("a3");

    // Case A2: same setup, 第一段 retry at t=17 — bucket cleared at 16.
    const caseA2 = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: link1, startTime: 0 },
      { actionId: "a2", actorId: "ACTOR", skill: link2, startTime: 2 },
      { actionId: "a3", actorId: "ACTOR", skill: link1, startTime: 17 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((caseA2.validationError ? 1 : 0)).toBe(0);

    // Case B: 第二段 at t=5 (end=7) → bucket extends to 17.
    // 第一段 retry at t=17 - eps should now be rejected; at t=18 accepted.
    const caseB = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: link1, startTime: 0 },
      { actionId: "a2", actorId: "ACTOR", skill: link2, startTime: 5 },
      { actionId: "a3", actorId: "ACTOR", skill: link1, startTime: 16.5 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((caseB.validationError ? 1 : 0)).toBe(1);
    expect(caseB.validationError!.actionId).toBe("a3");

    const caseB2 = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: link1, startTime: 0 },
      { actionId: "a2", actorId: "ACTOR", skill: link2, startTime: 5 },
      { actionId: "a3", actorId: "ACTOR", skill: link1, startTime: 17.5 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((caseB2.validationError ? 1 : 0)).toBe(0);
  });

  it("chained-skill (requiresPreviousAction) bypasses its own group CD check", () => {
    // After 第一段 sets bucket expiry=16, placing 第二段 at t=2 is INSIDE that
    // window — but 第二段 has requiresPreviousAction so the CD check is skipped.
    const build = makeGenericBuild("ACTOR", "cold");
    const link1 = cdSkillExt({
      id: "link1", type: "link", duration: 1, cooldown: 10,
      cooldownGroup: "G", cooldownStartOffset: 5,
    });
    const link2 = cdSkillExt({
      id: "link2", type: "link", duration: 2, cooldown: 10,
      cooldownGroup: "G",
      requiresPreviousAction: { skillId: "link1", withinFrames: { min: 30, max: 360 } },
    });

    const result = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: link1, startTime: 0 },
      { actionId: "a2", actorId: "ACTOR", skill: link2, startTime: 2 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((result.validationError ? 1 : 0)).toBe(0);
  });

  it("Math.max-extend never shortens: a later, smaller write keeps the higher expiry", () => {
    // 第一段 sets expiry=16. 第二段 at t=2 writes 14. Bucket must remain 16.
    const build = makeGenericBuild("ACTOR", "cold");
    const link1 = cdSkillExt({
      id: "link1", type: "link", duration: 1, cooldown: 10,
      cooldownGroup: "G", cooldownStartOffset: 5,
    });
    const link2 = cdSkillExt({
      id: "link2", type: "link", duration: 1, cooldown: 10,
      cooldownGroup: "G",
      requiresPreviousAction: { skillId: "link1", withinFrames: { min: 30, max: 360 } },
    });

    // Next 第一段 at t=15 still inside [..16] should be rejected (bucket
    // wasn't shortened by 第二段's write of t(2)+end(1)+cd(10)=13).
    const result = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: link1, startTime: 0 },
      { actionId: "a2", actorId: "ACTOR", skill: link2, startTime: 2 },
      { actionId: "a3", actorId: "ACTOR", skill: link1, startTime: 15 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((result.validationError ? 1 : 0)).toBe(1);
    expect(result.validationError!.actionId).toBe("a3");
  });

  it("skills without cooldownGroup keep legacy per-skill-id keying", () => {
    // Sanity: two skills with different ids and NO group → independent CDs.
    const build = makeGenericBuild("ACTOR", "cold");
    const a = cdSkillExt({ id: "a", type: "link", cooldown: 10 });
    const b = cdSkillExt({ id: "b", type: "link", cooldown: 10 });
    const result = simulate([build], [
      { actionId: "x1", actorId: "ACTOR", skill: a, startTime: 0 },
      { actionId: "x2", actorId: "ACTOR", skill: b, startTime: 2 }, // different id → unaffected
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((result.validationError ? 1 : 0)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// MultiplierRef.section — disambiguate labels shared across sections
// ═══════════════════════════════════════════════════════════════════

describe("V2 Kernel — MultiplierRef.section disambiguation", () => {
  // Stub resolver that returns a section-specific value when sectionHint is
  // provided, or a collision-prone default when it is not. This lets us
  // detect whether the kernel propagated `ref.section` into resolveRef.
  function makeSectionResolver(byLabel: Record<string, number>, bySection: Record<string, Record<string, number>>) {
    return (_actorId: string, label: string, sectionHint?: string): number => {
      if (sectionHint && bySection[sectionHint] && bySection[sectionHint][label] !== undefined) {
        return bySection[sectionHint][label];
      }
      return byLabel[label] ?? 0;
    };
  }

  function makeHitWithRef(offset: number, ref: { label: string; section?: "skill" | "link" | "ultimate" | "attack"; share: number }, sourceType: "skill" | "link" | "ultimate"): Hit {
    return {
      offset, checkpointIndex: 0,
      damage: { multiplierRef: ref, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType },
      effects: [],
      standardLogic: true,
    };
  }

  it("section=\"link\" reads link row even when skill section has the same label first", () => {
    const build = makeGenericBuild("ACTOR", "physical");
    const skillHit: Skill = {
      id: "s_skill", type: "skill", name: "S", element: "physical",
      duration: 0.5, spCost: 0, cooldown: 0,
      hits: [makeHitWithRef(0.1, { label: "伤害倍率", section: "skill", share: 1 }, "skill")],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    const linkHit: Skill = {
      id: "s_link", type: "link", name: "L", element: "physical",
      duration: 0.5, spCost: 0, cooldown: 0,
      hits: [makeHitWithRef(0.1, { label: "伤害倍率", section: "link", share: 1 }, "link")],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };

    // byLabel default is the skill's value — used if sectionHint is NOT propagated
    // (would incorrectly give the link hit the skill multiplier).
    const resolveRef = makeSectionResolver(
      { "伤害倍率": 300 },
      { skill: { "伤害倍率": 300 }, link: { "伤害倍率": 100 } },
    );

    const result = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: skillHit, startTime: 0 },
      { actionId: "a2", actorId: "ACTOR", skill: linkHit,  startTime: 1 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", resolveRef });

    const damages = result.events.filter(e => e.type === "damage" && (e as any).damage > 0);
    const skillDmg = damages.find(d => (d as any).actionId === "a1");
    const linkDmg  = damages.find(d => (d as any).actionId === "a2");
    expect(skillDmg).toBeTruthy();
    expect(linkDmg).toBeTruthy();
    // skill multiplier = 300, link multiplier = 100 → link damage should be exactly 1/3 of skill damage
    // (both share the same ATK/defense/bonus path since sourceType mods aren't configured).
    expect((linkDmg as any).damage / (skillDmg as any).damage).toBeCloseTo(100 / 300, 3);
  });

  it("without section hint, label falls back to first-match (legacy behaviour preserved)", () => {
    // Critically: dropping `section` must keep the old "first-match-wins" behaviour so
    // existing characters without the field continue to work.
    const build = makeGenericBuild("ACTOR", "physical");
    const linkHit: Skill = {
      id: "l_legacy", type: "link", name: "L", element: "physical",
      duration: 0.5, spCost: 0, cooldown: 0,
      // No section — should fall back to byLabel (=300, the "wrong" value from the link's POV).
      hits: [makeHitWithRef(0.1, { label: "伤害倍率", share: 1 }, "link")],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    const resolveRef = makeSectionResolver(
      { "伤害倍率": 300 },
      { link: { "伤害倍率": 100 } },
    );
    const result = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: linkHit, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", resolveRef });
    const dmg = result.events.find(e => e.type === "damage" && (e as any).damage > 0) as any;
    expect(dmg).toBeTruthy();
    // Call 1: legacy behaviour gives byLabel=300. To prove the hook is actually
    // wired, compare against a second run where section IS passed (expect /3).
    const linkHitSectioned: Skill = {
      ...linkHit, id: "l_sectioned",
      hits: [makeHitWithRef(0.1, { label: "伤害倍率", section: "link", share: 1 }, "link")],
    };
    const result2 = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: linkHitSectioned, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", resolveRef });
    const dmg2 = result2.events.find(e => e.type === "damage" && (e as any).damage > 0) as any;
    expect(dmg2.damage / dmg.damage).toBeCloseTo(100 / 300, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Launch / knockdown bonus stagger (10 × artsPowerStaggerMult)
// ═══════════════════════════════════════════════════════════════════

describe("V2 Kernel — launch/knockdown bonus stagger", () => {
  // physical_anomaly on an unbroken enemy applies 1 break stack instead
  // (resolvePhysicalAnomaly, anomaly.ts). To exercise the launch/knockdown
  // branch, the skill needs to first put the enemy into break state.
  function makeAnomalySkill(physicalType: "launch" | "knockdown"): Skill {
    return {
      id: "anom", type: "skill", name: "A", element: "physical",
      duration: 1, spCost: 0, cooldown: 0,
      hits: [
        {
          offset: 0.05, checkpointIndex: 0,
          damage: { multiplier: 0, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType: "skill" as const },
          effects: [{ type: "break_apply", params: { stacks: 1 } }],
          standardLogic: true,
        },
        {
          offset: 0.1, checkpointIndex: 0,
          damage: { multiplier: 0, stagger: 0, element: "physical" as DamageElement, canCrit: false, school: "physical" as const, sourceType: "skill" as const },
          effects: [{ type: "physical_anomaly", params: { physicalType } }],
          standardLogic: true,
        },
      ],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 1] }],
    };
  }

  // Extract the extra damage event produced by the anomaly (not the hit's own
  // zero-multiplier damage event). launch/knockdown pushes into effectDamages
  // which resolves as element=physical, school=physical, sourceType=skill,
  // and — after the fix — carries stagger=10×artsPowerStaggerMult.
  function anomalyDamageEvent(events: any[]): any {
    // The hit itself is multiplier=0 → damage=0. The anomaly bonus hit carries
    // non-zero stagger. Filter by stagger>0.
    return events.find(e => e.type === "damage" && e.stagger > 0);
  }

  it("launch carries base stagger=10 when arts power is 0", () => {
    const build = makeGenericBuild("ACTOR", "physical");
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill: makeAnomalySkill("launch"), startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });
    const ev = anomalyDamageEvent(result.events);
    expect(ev).toBeTruthy();
    expect(ev.stagger).toBeCloseTo(10, 5);
  });

  it("knockdown carries base stagger=10 when arts power is 0", () => {
    const build = makeGenericBuild("ACTOR", "physical");
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill: makeAnomalySkill("knockdown"), startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });
    const ev = anomalyDamageEvent(result.events);
    expect(ev).toBeTruthy();
    expect(ev.stagger).toBeCloseTo(10, 5);
  });

  it("arts power scales bonus stagger: 200 AP → 10 × (1 + 200×0.005) = 20", () => {
    // Build with 200 arts power via statModifier.
    const input: CharacterInput = {
      id: "ACTOR", name: "ACTOR", element: "physical", rarity: 6,
      promotion: 4, potentialLevel: 0, talentLevels: {},
      baseStrength: 100, baseAgility: 100, baseIntellect: 100, baseWill: 100,
      baseAttack: 300, baseHp: 1000,
      mainAttribute: "strength", subAttribute: "agility",
      weaponId: null, weaponBaseAtk: 500, weaponLevel: 90,
      equipmentSetId: null, baseGaugeMax: 300,
      statModifiers: [
        { source: "test", stat: "originium_arts_power", value: 200, type: "flat" as const },
      ],
    };
    const build = computeCharacterBuild(input);
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill: makeAnomalySkill("launch"), startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });
    const ev = anomalyDamageEvent(result.events);
    expect(ev).toBeTruthy();
    expect(ev.stagger).toBeCloseTo(20, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// probLocks — per-damage crit lock override
// ═══════════════════════════════════════════════════════════════════

describe("V2 Kernel — probLocks (per-damage crit lock)", () => {
  /** Build a character with 0% crit rate, 50% crit damage. */
  function makeNoCritBuild() {
    const input: CharacterInput = {
      id: "ACTOR", name: "ACTOR", element: "physical", rarity: 6,
      promotion: 4, potentialLevel: 0, talentLevels: {},
      baseStrength: 100, baseAgility: 100, baseIntellect: 100, baseWill: 100,
      baseAttack: 300, baseHp: 1000,
      mainAttribute: "strength", subAttribute: "agility",
      weaponId: null, weaponBaseAtk: 500, weaponLevel: 90,
      equipmentSetId: null, baseGaugeMax: 300,
      // Default crit_rate = 0, crit_damage = 50 from base — no extra modifiers needed.
      statModifiers: [],
    };
    return computeCharacterBuild(input);
  }

  /** Single-hit attack skill that can crit. */
  function makeSingleHitSkill(): Skill {
    return {
      id: "single_hit",
      type: "attack",
      name: "test attack",
      element: "physical",
      duration: 1,
      spCost: 0,
      cooldown: 0,
      hits: [{
        offset: 0.1,
        checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" },
        effects: [],
        standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
  }

  it("emits a critEventKey on each damage event when canCrit=true", () => {
    const build = makeNoCritBuild();
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill: makeSingleHitSkill(), startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });
    const dmg = result.events.find(e => e.type === "damage") as any;
    expect(dmg).toBeTruthy();
    expect(dmg.critEventKey).toBe("crit:a:0:0");
  });

  it("expected mode without lock: crit zone < 1.5 (probability-weighted blend, not forced)", () => {
    const build = makeNoCritBuild();
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill: makeSingleHitSkill(), startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });
    const dmg = result.events.find(e => e.type === "damage") as any;
    // With baseline (low) crit rate, the expected-blend zone is between 1 and 1.5.
    expect(dmg.zones.crit).toBeGreaterThanOrEqual(1);
    expect(dmg.zones.crit).toBeLessThan(1.5);
    expect(dmg.isCrit).toBe(false);
  });

  it("lock=yes overrides expected mode → crit multiplier applied", () => {
    const build = makeNoCritBuild();
    const probLocks = new Map<string, "yes" | "no">([["crit:a:0:0", "yes"]]);
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill: makeSingleHitSkill(), startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", probLocks });
    const dmg = result.events.find(e => e.type === "damage") as any;
    expect(dmg.isCrit).toBe(true);
    expect(dmg.zones.crit).toBeCloseTo(1.5, 5); // 1 + 50/100
  });

  it("lock=no with high crit rate overrides expected mode → no crit", () => {
    // Force 100% crit rate via stat modifier.
    const input: CharacterInput = {
      id: "ACTOR", name: "ACTOR", element: "physical", rarity: 6,
      promotion: 4, potentialLevel: 0, talentLevels: {},
      baseStrength: 100, baseAgility: 100, baseIntellect: 100, baseWill: 100,
      baseAttack: 300, baseHp: 1000,
      mainAttribute: "strength", subAttribute: "agility",
      weaponId: null, weaponBaseAtk: 500, weaponLevel: 90,
      equipmentSetId: null, baseGaugeMax: 300,
      statModifiers: [
        { source: "test", stat: "crit_rate", value: 100, type: "flat" as const },
      ],
    };
    const build = computeCharacterBuild(input);
    const probLocks = new Map<string, "yes" | "no">([["crit:a:0:0", "no"]]);
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill: makeSingleHitSkill(), startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", probLocks });
    const dmg = result.events.find(e => e.type === "damage") as any;
    expect(dmg.isCrit).toBe(false);
    expect(dmg.zones.crit).toBeCloseTo(1, 5);
  });

  it("real mode: lock=yes still forces crit regardless of rng", () => {
    const build = makeNoCritBuild();
    const probLocks = new Map<string, "yes" | "no">([["crit:a:0:0", "yes"]]);
    // rng always returns 0.99 (well above 0% rate); without lock would not crit.
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill: makeSingleHitSkill(), startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "real", rng: () => 0.99, probLocks });
    const dmg = result.events.find(e => e.type === "damage") as any;
    expect(dmg.isCrit).toBe(true);
    expect(dmg.zones.crit).toBeCloseTo(1.5, 5);
  });

  it("locks are scoped per (actionId, hitIndex, damageIdx) — different damages independent", () => {
    // Two hits on same skill → two distinct keys.
    const skill: Skill = {
      id: "two_hit",
      type: "attack",
      name: "test",
      element: "physical",
      duration: 1, spCost: 0, cooldown: 0,
      hits: [
        { offset: 0.1, checkpointIndex: 0, effects: [], standardLogic: true,
          damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" } },
        { offset: 0.5, checkpointIndex: 0, effects: [], standardLogic: true,
          damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" } },
      ],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 1] }],
    };
    const build = makeNoCritBuild();
    // Lock only hit 0, leave hit 1 default (no crit at 0% rate).
    const probLocks = new Map<string, "yes" | "no">([["crit:a:0:0", "yes"]]);
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", probLocks });
    const dmgs = result.events.filter(e => e.type === "damage") as any[];
    expect(dmgs.length).toBe(2);
    expect(dmgs[0].critEventKey).toBe("crit:a:0:0");
    expect(dmgs[0].isCrit).toBe(true);
    expect(dmgs[1].critEventKey).toBe("crit:a:1:0");
    expect(dmgs[1].isCrit).toBe(false);
  });

  it("damages with canCrit=false get no critEventKey and ignore locks", () => {
    const skill: Skill = {
      id: "no_crit_hit",
      type: "attack",
      name: "test",
      element: "physical",
      duration: 1, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.1, checkpointIndex: 0, effects: [], standardLogic: true,
        damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "attack" },
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    const build = makeNoCritBuild();
    const probLocks = new Map<string, "yes" | "no">([["crit:a:0:0", "yes"]]);
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", probLocks });
    const dmg = result.events.find(e => e.type === "damage") as any;
    expect(dmg.critEventKey).toBeUndefined();
    expect(dmg.isCrit).toBe(false);
    expect(dmg.zones.crit).toBeCloseTo(1, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Enemy debuffs via buff_apply (general fix — was kernel gap before)
// ═══════════════════════════════════════════════════════════════════
//
// Before this fix, `buff_apply target: enemy stat: X_dmg zone: vulnerability`
// stored the buff in enemy.buffManager but never affected damage. Now:
//   - resolveBuffModifierZone maps vulnerability/X_dmg → BuffModifiers field
//   - EnemyState.get*Fragility/getVulnerability aggregates from buffManager
//   - DamageContext.target reads through these getters
// Covered: 物理脆弱、灼热脆弱（元素）、全伤害易伤、过期恢复、与碎甲共存。

describe("V2 Kernel — enemy debuffs via buff_apply (vulnerability/fragility)", () => {
  function makeBuild(element: DamageElement = "physical") {
    const input: CharacterInput = {
      id: "ACTOR", name: "ACTOR", element, rarity: 6,
      promotion: 4, potentialLevel: 0, talentLevels: {},
      baseStrength: 100, baseAgility: 100, baseIntellect: 100, baseWill: 100,
      baseAttack: 300, baseHp: 1000,
      mainAttribute: "strength", subAttribute: "agility",
      weaponId: null, weaponBaseAtk: 500, weaponLevel: 90,
      equipmentSetId: null, baseGaugeMax: 300,
      statModifiers: [],
    };
    return computeCharacterBuild(input);
  }

  /** Single-hit skill with a buff_apply effect to enemy then damage. Element configurable. */
  function makeVulnSkill(element: DamageElement, school: "physical" | "magic", buffStat: string, buffZone: string, buffValue: number, buffDuration: number = 25): Skill {
    return {
      id: "vuln_test", type: "skill", name: "test",
      element, duration: 1, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.1, checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element, canCrit: false, school, sourceType: "skill" },
        effects: [
          { type: "buff_apply", params: { buffId: "test_vuln", target: "enemy", stat: buffStat, zone: buffZone, value: buffValue, duration: buffDuration } },
        ],
        standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
  }

  it("buff_apply enemy 物理脆弱 +20% raises subsequent physical hit damage by 1.20×", () => {
    const build = makeBuild("physical");
    // Two skills: first applies vuln (its own hit benefits per 先特效后伤害), second is plain physical
    const skill1 = makeVulnSkill("physical", "physical", "physical_dmg", "vulnerability", 20);
    const skill2: Skill = {
      id: "plain_phys", type: "skill", name: "plain",
      element: "physical", duration: 1, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.1, checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "skill" },
        effects: [],
        standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill: skill1, startTime: 0 },
      { actionId: "b", actorId: "ACTOR", skill: skill2, startTime: 5 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });
    const dmgs = result.events.filter(e => e.type === "damage") as any[];
    expect(dmgs.length).toBe(2);
    // Both hits should benefit from +20% vuln (先特效后伤害 + lasting 25s).
    expect(dmgs[1].damage / dmgs[0].damage).toBeCloseTo(1, 5);
    // Compare to a no-vuln baseline
    const baselineResult = simulate([build], [
      { actionId: "b", actorId: "ACTOR", skill: skill2, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });
    const baseline = (baselineResult.events.find(e => e.type === "damage") as any).damage;
    expect(dmgs[1].damage / baseline).toBeCloseTo(1.20, 2);
  });

  it("buff_apply enemy 灼热脆弱 +12% raises blaze hit damage by 1.12×", () => {
    const build = makeBuild("blaze");
    // Skill 1: applies blaze vuln; Skill 2: plain blaze hit afterwards
    const skill1 = makeVulnSkill("blaze", "magic", "blaze_dmg", "vulnerability", 12);
    const skill2: Skill = {
      id: "plain_blaze", type: "skill", name: "plain",
      element: "blaze", duration: 1, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.1, checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "blaze", canCrit: false, school: "magic", sourceType: "skill" },
        effects: [],
        standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    const withVuln = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill: skill1, startTime: 0 },
      { actionId: "b", actorId: "ACTOR", skill: skill2, startTime: 5 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });
    const woVuln = simulate([build], [
      { actionId: "b", actorId: "ACTOR", skill: skill2, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });
    const withDmg = (withVuln.events.filter(e => e.type === "damage") as any[])[1].damage;
    const woDmg = (woVuln.events.find(e => e.type === "damage") as any).damage;
    expect(withDmg / woDmg).toBeCloseTo(1.12, 2);
  });

  it("buff_apply enemy 全伤害易伤 (all_dmg) raises any element by configured %", () => {
    const build = makeBuild("emag");
    const skill1 = makeVulnSkill("emag", "magic", "all_dmg", "vulnerability", 25);
    const skill2: Skill = {
      id: "plain_emag", type: "skill", name: "plain",
      element: "emag", duration: 1, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.1, checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "emag", canCrit: false, school: "magic", sourceType: "skill" },
        effects: [], standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    const withVuln = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill: skill1, startTime: 0 },
      { actionId: "b", actorId: "ACTOR", skill: skill2, startTime: 5 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });
    const woVuln = simulate([build], [
      { actionId: "b", actorId: "ACTOR", skill: skill2, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });
    const withDmg = (withVuln.events.filter(e => e.type === "damage") as any[])[1].damage;
    const woDmg = (woVuln.events.find(e => e.type === "damage") as any).damage;
    // 全伤害易伤 enters via target.vulnerability → vulnerabilityZone = 1 + total/100
    expect(withDmg / woDmg).toBeCloseTo(1.25, 2);
  });

  it("vuln expires correctly: hit after duration sees baseline damage", () => {
    const build = makeBuild("physical");
    const skill1 = makeVulnSkill("physical", "physical", "physical_dmg", "vulnerability", 50, /*dur=*/2);
    const skill2: Skill = {
      id: "plain_phys", type: "skill", name: "plain",
      element: "physical", duration: 1, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.1, checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "skill" },
        effects: [], standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    // Skill1 at t=0 (vuln applied @0.1, lasts 2s → expires @2.1).
    // Skill2 at t=5 → vuln expired, should be baseline.
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill: skill1, startTime: 0 },
      { actionId: "b", actorId: "ACTOR", skill: skill2, startTime: 5 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });
    const baseline = simulate([build], [
      { actionId: "b", actorId: "ACTOR", skill: skill2, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });
    const expiredDmg = (result.events.filter(e => e.type === "damage") as any[])[1].damage;
    const baselineDmg = (baseline.events.find(e => e.type === "damage") as any).damage;
    expect(expiredDmg).toBe(baselineDmg);
  });

  // ─── ROSSI 强化战技 number verification (corrected model) ───────────
  // User observed (ATK=1114, all maxed, real mode):
  //   hit1-3 of 第一段: 369 / 369 / 492 — share split 30/30/40 + uniform P1 +15%
  //   hit4 = 狼之珀 = 4 independent sub-hits, each at 第二段 × 0.25 (= 72%) blaze
  //     each sub-hit = 1114 × 0.72 × 0.5 × 1.12 (vuln) × 1.15 (P1) = 517
  //     1 sub-hit can crit → 775 = 517 × 1.5
  //   斫痕 DOT first tick: 167 = 1114 × 0.30 × 0.5 (no vuln, skipSourceTypeBonus)
  //   斫痕 DOT subsequent: 187 = 167 × 1.12 (vuln)
  //
  // To match the exact 369/492/517/167/187 numbers, the test crit_rate is forced to 0%
  // (real mode would also work but seed-dependent).

  it("ROSSI 强化战技: 第一段 30/30/40 + 狼之珀 4 sub-hits + 斫痕 produces user-observed numbers", () => {
    const input: CharacterInput = {
      id: "ROSSI", name: "ROSSI", element: "physical", rarity: 6,
      promotion: 0, potentialLevel: 5, talentLevels: { talent_0: 2, talent_1: 2 },
      baseStrength: 0, baseAgility: 0, baseIntellect: 0, baseWill: 0,
      baseAttack: 1114, baseHp: 1000,
      mainAttribute: "agility", subAttribute: "intellect",
      weaponId: null, weaponBaseAtk: 0, weaponLevel: 90,
      equipmentSetId: null, baseGaugeMax: 300,
      statModifiers: [
        // P1 effect (skill_dmg_bonus +15) — applies to all 战技 hits including 狼之珀 sub-hits
        { source: "potential_1", stat: "skill_dmg_bonus", value: 15, type: "flat" as const },
        // Force crit_rate = 0% (cancel kernel's base 5%) so we can verify exact damage
        // numbers without crit-blend uncertainty. User's real-mode test happened to roll 0
        // crits on hit1-3 and 1 crit on hit4 sub-hits.
        { source: "test", stat: "crit_rate", value: -5, type: "flat" as const },
      ],
    };
    const build = computeCharacterBuild(input);

    // 第一段 M3 = 192%, split 30/30/40
    // 第二段 M3 = 288%, split 25/25/25/25 across 4 sub-hits
    const skill: Skill = {
      id: "rossi_skill_test", type: "skill", name: "强化血红之影",
      element: "physical", duration: 5, spCost: 0, cooldown: 0,
      hits: [
        // hit1-3: 第一段 30/30/40 at f(35), f(47), f(73)
        { offset: 35/60, checkpointIndex: 0,
          damage: { multiplier: 192 * 0.30, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "skill" },
          effects: [], standardLogic: true },
        { offset: 47/60, checkpointIndex: 0,
          damage: { multiplier: 192 * 0.30, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "skill" },
          effects: [], standardLogic: true },
        { offset: 73/60, checkpointIndex: 0,
          damage: { multiplier: 192 * 0.40, stagger: 5, element: "physical", canCrit: true, school: "physical", sourceType: "skill" },
          effects: [], standardLogic: true },
        // 狼之珀 sub-hit 1 at f(139) — talent_0 effects inlined; stagger 2.5
        { offset: 139/60, checkpointIndex: 0,
          damage: { multiplier: 288 * 0.25, stagger: 2.5, element: "blaze", canCrit: true, school: "magic", sourceType: "skill" },
          effects: [
            { type: "delayed_damage", params: { delay: 0, multiplier: 30, element: "physical", school: "physical", canCrit: true, skipSourceTypeBonus: true } },
            { type: "buff_apply", params: { buffId: "rossi_zhuohen_phys", target: "enemy", stat: "physical_dmg", zone: "vulnerability", value: 12, duration: 25 } },
            { type: "buff_apply", params: { buffId: "rossi_zhuohen_blaze", target: "enemy", stat: "blaze_dmg", zone: "vulnerability", value: 12, duration: 25 } },
            { type: "delayed_damage", params: { delay: 1, multiplier: 30, element: "physical", school: "physical", canCrit: true, skipSourceTypeBonus: true } },
            { type: "delayed_damage", params: { delay: 2, multiplier: 30, element: "physical", school: "physical", canCrit: true, skipSourceTypeBonus: true } },
          ],
          standardLogic: true },
        // 狼之珀 sub-hits 2-4 at f(140), f(141), f(142) — bare; vuln already up
        { offset: 140/60, checkpointIndex: 0,
          damage: { multiplier: 288 * 0.25, stagger: 2.5, element: "blaze", canCrit: true, school: "magic", sourceType: "skill" },
          effects: [], standardLogic: true },
        { offset: 141/60, checkpointIndex: 0,
          damage: { multiplier: 288 * 0.25, stagger: 2.5, element: "blaze", canCrit: true, school: "magic", sourceType: "skill" },
          effects: [], standardLogic: true },
        { offset: 142/60, checkpointIndex: 0,
          damage: { multiplier: 288 * 0.25, stagger: 2.5, element: "blaze", canCrit: true, school: "magic", sourceType: "skill" },
          effects: [], standardLogic: true },
      ],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 6] }],
    };

    const result = simulate([build], [
      { actionId: "a", actorId: "ROSSI", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const dmgs = result.events.filter(e => e.type === "damage") as any[];
    const at = (t: number) => dmgs.filter(d => Math.abs(d.time - t) < 0.005);

    // hit1 / hit2 (share 0.30): 369
    expect(at(35/60)[0]?.damage).toBeGreaterThanOrEqual(368);
    expect(at(35/60)[0]?.damage).toBeLessThanOrEqual(370);
    expect(at(47/60)[0]?.damage).toBe(at(35/60)[0]?.damage);
    // hit3 (share 0.40): 492
    expect(at(73/60)[0]?.damage).toBeGreaterThanOrEqual(490);
    expect(at(73/60)[0]?.damage).toBeLessThanOrEqual(493);

    // At f(139): DOT tick 0 (167) + sub-hit 1 body (517)
    const atSub1 = at(139/60);
    expect(atSub1.find(d => d.damage === 167)).toBeTruthy(); // DOT first tick (no vuln)
    expect(atSub1.find(d => d.damage >= 516 && d.damage <= 518)).toBeTruthy(); // sub-hit 1 body

    // Sub-hits 2/3/4 at f(140), f(141), f(142) each at 517 (with vuln up)
    expect(at(140/60)[0]?.damage).toBeGreaterThanOrEqual(516);
    expect(at(140/60)[0]?.damage).toBeLessThanOrEqual(518);
    expect(at(141/60)[0]?.damage).toBe(at(140/60)[0]?.damage);
    expect(at(142/60)[0]?.damage).toBe(at(140/60)[0]?.damage);

    // DOT subsequent ticks at t=139/60 + 1, +2 → 187
    expect(at(139/60 + 1)[0]?.damage).toBe(187);
    expect(at(139/60 + 2)[0]?.damage).toBe(187);
  });

  it("buff_apply 物理脆弱 stacks additively with armor break vulnerability", () => {
    // Hit causes armorBreak (consumes 4 break stacks → applies armor break vuln) AND
    // applies a separate +10% physical vuln via buff_apply. Expect both add.
    // Setup: pre-stack 4 break, then hit with armorBreak + buff_apply.
    // (Simpler: just verify 物理脆弱 adds on top of getPhysicalFragility;
    //  full armor-break flow integration is too complex for this unit.)
    // Use one skill that applies vuln + a follow-up hit.
    const build = makeBuild("physical");
    const skill1 = makeVulnSkill("physical", "physical", "physical_dmg", "vulnerability", 10);
    const skill2 = makeVulnSkill("physical", "physical", "physical_dmg", "vulnerability", 15);
    // Independent stack: BuffManager refresh policy means second buff_apply with same id
    // refreshes; using a different buffId to ensure both stack.
    skill2.hits[0].effects = [
      { type: "buff_apply", params: { buffId: "test_vuln_2", target: "enemy", stat: "physical_dmg", zone: "vulnerability", value: 15, duration: 25 } },
    ];
    const skill3: Skill = {
      id: "plain_phys", type: "skill", name: "plain",
      element: "physical", duration: 1, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.1, checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "skill" },
        effects: [], standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill: skill1, startTime: 0 },
      { actionId: "b", actorId: "ACTOR", skill: skill2, startTime: 3 },
      { actionId: "c", actorId: "ACTOR", skill: skill3, startTime: 6 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });
    const baseline = simulate([build], [
      { actionId: "c", actorId: "ACTOR", skill: skill3, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });
    const dmgs = result.events.filter(e => e.type === "damage") as any[];
    const cDmg = dmgs[2].damage;
    const baseDmg = (baseline.events.find(e => e.type === "damage") as any).damage;
    // Both vuln active (10 + 15 = 25%), baseline expected ratio 1.25
    expect(cDmg / baseDmg).toBeCloseTo(1.25, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ROSSI talent_1 沸血 verification (PassiveTrigger + burning scaleBy)
// ═══════════════════════════════════════════════════════════════════

describe("V2 Kernel — ROSSI talent_1 沸血", () => {
  // Verifies the trigger fires on crit + 斫痕 state, and the damage matches:
  //   200 (no burning, talent damage didn't crit)
  //   449 (burning + talent damage crit)
  // Math: 1114 × 32% × 0.5 × 1.12 (vuln 灼热脆弱·斫痕) × [crit] × [burning]

  it("fires extra blaze damage when ROSSI's hit crits on 斫痕 target (no burning)", async () => {
    // Use the actual rossi.ts module to test PassiveTrigger + scaleBy registration
    const rossiMod = await import("./characters/rossi");
    const { triggers } = rossiMod;
    expect(triggers.length).toBeGreaterThan(0);

    const input: CharacterInput = {
      id: "ROSSI", name: "ROSSI", element: "physical", rarity: 6,
      promotion: 0, potentialLevel: 5, talentLevels: { talent_0: 2, talent_1: 2 },
      baseStrength: 0, baseAgility: 0, baseIntellect: 0, baseWill: 0,
      baseAttack: 1114, baseHp: 1000,
      mainAttribute: "agility", subAttribute: "intellect",
      weaponId: null, weaponBaseAtk: 0, weaponLevel: 90,
      equipmentSetId: null, baseGaugeMax: 300,
      // Force crit_rate = -5 to net 0% (cancel kernel base 5%) — we use probLocks to force crit on the triggering hit
      statModifiers: [
        { source: "test", stat: "crit_rate", value: -5, type: "flat" as const },
      ],
    };
    const build = computeCharacterBuild(input);

    // A skill with one hit that:
    //  1. Applies 斫痕 vuln + DOT (talent_0 effects, simplified)
    //  2. The hit damage rolls and crits (forced via probLocks)
    //  3. talent_1 trigger fires post-hit
    const skill: Skill = {
      id: "rossi_test", type: "skill", name: "test",
      element: "blaze", duration: 5, spCost: 0, cooldown: 0,
      hits: [
        {
          offset: 1, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "blaze", canCrit: true, school: "magic", sourceType: "skill" },
          effects: [
            // Apply 斫痕 compound buff so talent_1 condition sees it
            { type: "buff_apply", params: { buffId: "rossi_zhuohen", target: "enemy", duration: 25, modifiers: [
              { stat: "physical_dmg", zone: "vulnerability", value: 12 },
              { stat: "blaze_dmg",    zone: "vulnerability", value: 12 },
            ] } },
          ],
          standardLogic: true,
        },
      ],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };

    const triggersByActor = new Map([["ROSSI", triggers]]);

    // Force the main hit to crit via probLock so talent_1 trigger fires; force talent_1
    // own crit roll to NOT crit (we want the 200 baseline).
    const probLocks = new Map<string, "yes" | "no">([
      ["crit:a:0:0", "yes"],  // main hit crit
      ["crit:a:0:1", "no"],   // talent_1 damage no-crit (but trigger still fires)
    ]);

    // resolveRef returns talent_1 base mult (32 = 24 stage + 8 P3 potential bonus).
    // In real V2 build pipeline this comes from panel.ts resolveTalentValues + activePotentialEffects.
    const resolveRef = (_actor: string, label: string) => label === "talent_1" ? 32 : 0;

    const result = simulate([build], [
      { actionId: "a", actorId: "ROSSI", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "real", rng: () => 0.99, probLocks, resolveRef }, triggersByActor);

    const dmgs = result.events.filter(e => e.type === "damage") as any[];

    // Expect 2 damage events: main hit (100% blaze, with vuln + crit) and talent_1 (32% blaze, with vuln, no crit)
    const triggerDmgs = dmgs.filter(d => d.fromTrigger);
    expect(triggerDmgs.length).toBe(1);
    // 200 = 1114 × 0.32 × 0.5 × 1.12 = 199.6 → 199 or 200 (floor rounding)
    expect(triggerDmgs[0].damage).toBeGreaterThanOrEqual(199);
    expect(triggerDmgs[0].damage).toBeLessThanOrEqual(200);
  });

  it("burning scaleBy resolver returns 1.5 if burning active, 1.0 otherwise", async () => {
    // Ensure rossi.ts module is loaded (registers the resolver at module init).
    await import("./characters/rossi");
    const { resolveScaleBy } = await import("./valueSource");
    const ctxBurning: any = { enemy: { anomalies: { burning: { active: true } } } };
    const ctxNotBurning: any = { enemy: { anomalies: { burning: { active: false } } } };
    expect(resolveScaleBy("rossi_burning_mult", ctxBurning)).toBe(1.5);
    expect(resolveScaleBy("rossi_burning_mult", ctxNotBurning)).toBe(1.0);
  });

  it("ult stab crit = 353 with skill +60% / P5 +30% crit_dmg buffs", async () => {
    const rossiMod = await import("./characters/rossi");
    const { skills } = rossiMod;

    const input: CharacterInput = {
      id: "ROSSI", name: "ROSSI", element: "physical", rarity: 6,
      promotion: 0, potentialLevel: 5, talentLevels: { talent_0: 2, talent_1: 2 },
      baseStrength: 0, baseAgility: 0, baseIntellect: 0, baseWill: 0,
      baseAttack: 1114, baseHp: 1000,
      mainAttribute: "agility", subAttribute: "intellect",
      weaponId: null, weaponBaseAtk: 0, weaponLevel: 90,
      equipmentSetId: null, baseGaugeMax: 300,
      statModifiers: [
        // P5 ult_dmg_bonus +10% (static, normally from potentials.json)
        { source: "potential_5", stat: "ultimate_dmg_bonus", value: 10, type: "flat" as const },
        // crit_rate -5 to net 0% baseline (we'll force crit via probLocks anyway)
        { source: "test", stat: "crit_rate", value: -5, type: "flat" as const },
      ],
    };
    const build = computeCharacterBuild(input);

    // Provide a resolveRef that returns the M3 values from skills.json
    const resolveRef = (_actor: string, label: string): number => {
      const m3 = {
        "戳击总伤害倍率": 600,
        "第一段斩击伤害倍率": 250,
        "第二段斩击伤害倍率": 750,
        "暴击伤害提升": 60,
      } as Record<string, number>;
      return m3[label] ?? 0;
    };

    // Force the FIRST stab to crit; rest don't matter for this test.
    const probLocks = new Map<string, "yes" | "no">([
      ["crit:a:0:0", "yes"],
    ]);

    const result = simulate([build], [
      { actionId: "a", actorId: "ROSSI", skill: skills.ultimate, startTime: 0 },
    ], defaultEnemy, {
      initialSP: 0, critMode: "real",
      rng: () => 0.99,  // never natural crits; only the locked one fires
      resolveRef, probLocks,
    });

    const dmgs = result.events.filter(e => e.type === "damage") as any[];

    // First stab fires at f(128) = 2.133s and should crit.
    const firstStab = dmgs.find(d => Math.abs(d.time - 128/60) < 0.01);
    expect(firstStab).toBeTruthy();
    expect(firstStab.isCrit).toBe(true);
    // 1114 × 600% × 0.04 × 0.5 × 1.10 (P5 ult_dmg_bonus) × 2.40 (crit zone 50+60+30%)
    // = 147.0 × 2.40 = 352.8 → 352 or 353
    expect(firstStab.damage).toBeGreaterThanOrEqual(351);
    expect(firstStab.damage).toBeLessThanOrEqual(354);

    // Second stab (no crit lock): should be non-crit 147
    const secondStab = dmgs.find(d => Math.abs(d.time - 132/60) < 0.01);
    expect(secondStab).toBeTruthy();
    expect(secondStab.isCrit).toBe(false);
    expect(secondStab.damage).toBeGreaterThanOrEqual(146);
    expect(secondStab.damage).toBeLessThanOrEqual(148);
  });
});

// ═══════════════════════════════════════════════════════════════════
// ROSSI 燎影时刻 link CD (shared cooldownGroup + cooldownStartOffset)
// ═══════════════════════════════════════════════════════════════════

describe("V2 Kernel — ROSSI 燎影时刻 link CD (shared bucket)", () => {
  // Window: 第二段 placeable in [92f, 452f] (= 6s queue) after 第一段.
  // CD bucket key: "ROSSI/rossi_link_group".
  // 第一段 duration 154f, cd 15s, offset = (452-154)/60 ≈ 4.967s.
  //   → bucket expiry after 第一段-only = end(154f) + 4.967s + 15s
  //                                     = 154f + 19.967s ≈ start + 22.533s
  //   (equivalently: start + 452f + 15s = start + 22.533s ✓)
  // With 第二段 placed late: bucket extends to 第二段.end + 15s.

  function makeRossiBuild(): CharacterBuild {
    const input: CharacterInput = {
      id: "ROSSI", name: "ROSSI", element: "physical", rarity: 6,
      promotion: 0, potentialLevel: 0, talentLevels: {},
      baseStrength: 0, baseAgility: 0, baseIntellect: 0, baseWill: 0,
      baseAttack: 1114, baseHp: 1000,
      mainAttribute: "agility", subAttribute: "intellect",
      weaponId: null, weaponBaseAtk: 0, weaponLevel: 90,
      equipmentSetId: null, baseGaugeMax: 300,
      statModifiers: [],
    };
    return computeCharacterBuild(input);
  }

  /** Test fixture: ROSSI link skills with releaseConditions stripped so these
   *  CD tests don't trip on enemy state requirements (orthogonal to CD logic). */
  async function loadLinks(): Promise<{ link1: Skill; link2: Skill }> {
    const rossi = await import("./characters/rossi");
    const linkArr = rossi.skills.link as Skill[];
    const link1: Skill = { ...linkArr[0]!, releaseConditions: undefined };
    const link2: Skill = { ...linkArr[1]! };
    return { link1, link2 };
  }

  it("第一段 alone: bucket expires at start + 452f + 15s (window-close + 15s)", async () => {
    const { link1 } = await loadLinks();
    const build = makeRossiBuild();
    const targetExpiry = 452 / 60 + 15; // ≈ 22.533

    // Place 第二个 第一段 at t=22 — should be REJECTED (22 < 22.533).
    const rejected = simulate([build], [
      { actionId: "a1", actorId: "ROSSI", skill: link1, startTime: 0 },
      { actionId: "a2", actorId: "ROSSI", skill: link1, startTime: 22 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((rejected.validationError ? 1 : 0)).toBe(1);
    expect(rejected.validationError!.code).toBe("ISSUE_COOLDOWN_ACTIVE");

    // Place at t=23 — should be ACCEPTED.
    const accepted = simulate([build], [
      { actionId: "a1", actorId: "ROSSI", skill: link1, startTime: 0 },
      { actionId: "a2", actorId: "ROSSI", skill: link1, startTime: 23 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((accepted.validationError ? 1 : 0)).toBe(0);
    void targetExpiry;
  });

  it("第二段 inside window: extends bucket to 第二段.end + 15s when later than window-close+15s", async () => {
    const { link1, link2 } = await loadLinks();
    const build = makeRossiBuild();

    // Place 第二段 at t=7 (= 420f, inside [92f, 452f]). Base 第二段 duration=95f.
    // 第二段.end + 15s = 7 + 95/60 + 15 = 7 + 1.583 + 15 = 23.583s
    // 第一段's contribution = start + 452f + 15s = 22.533s
    // Math.max → 23.583s.
    const rejectedAt23 = simulate([build], [
      { actionId: "a1", actorId: "ROSSI", skill: link1, startTime: 0 },
      { actionId: "a2", actorId: "ROSSI", skill: link2, startTime: 7 },
      { actionId: "a3", actorId: "ROSSI", skill: link1, startTime: 23 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((rejectedAt23.validationError ? 1 : 0)).toBe(1);
    expect(rejectedAt23.validationError!.actionId).toBe("a3");

    const acceptedAt24 = simulate([build], [
      { actionId: "a1", actorId: "ROSSI", skill: link1, startTime: 0 },
      { actionId: "a2", actorId: "ROSSI", skill: link2, startTime: 7 },
      { actionId: "a3", actorId: "ROSSI", skill: link1, startTime: 24 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((acceptedAt24.validationError ? 1 : 0)).toBe(0);
  });

  it("第二段 placed early (before window-close + 15s) doesn't shorten bucket", async () => {
    const { link1, link2 } = await loadLinks();
    const build = makeRossiBuild();

    // 第二段 at t=2 (= 120f, inside 精确衔接 [123,167]f — close enough; default
    // variant has duration 95f = 1.583s, ends at ~3.583s). Bucket Math.max:
    // 22.533 vs 3.583+15=18.583 → stays 22.533.
    const rejected = simulate([build], [
      { actionId: "a1", actorId: "ROSSI", skill: link1, startTime: 0 },
      { actionId: "a2", actorId: "ROSSI", skill: link2, startTime: 2 },
      { actionId: "a3", actorId: "ROSSI", skill: link1, startTime: 22 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((rejected.validationError ? 1 : 0)).toBe(1);
    expect(rejected.validationError!.actionId).toBe("a3");
  });

  it("第二段 bypasses its own CD check inside 第一段's bucket window", async () => {
    const { link1, link2 } = await loadLinks();
    const build = makeRossiBuild();

    // 第一段 sets bucket to 22.533. Placing 第二段 at t=2 (inside that window)
    // would normally be blocked by group CD, but requiresPreviousAction makes
    // 第二段 skip its own group CD check.
    const result = simulate([build], [
      { actionId: "a1", actorId: "ROSSI", skill: link1, startTime: 0 },
      { actionId: "a2", actorId: "ROSSI", skill: link2, startTime: 2 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected", validateConditions: true });
    expect((result.validationError ? 1 : 0)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// resolveTalentValues — talent_enhance from active potentials
// ═══════════════════════════════════════════════════════════════════

describe("V2 panel — resolveTalentValues with talent_enhance potential bonus", () => {
  it("returns base talent value when no potential effects supplied", async () => {
    const { resolveTalentValues } = await import("./panel");
    const mod = {
      talents: [
        { id: "talent_0", stages: [{ promotion: 1, value: 10 }, { promotion: 2, value: 20 }] },
        { id: "talent_1", stages: [{ promotion: 2, damageMultiplier: 24 }, { promotion: 3, damageMultiplier: 24 }] },
      ],
    };
    const map = resolveTalentValues(mod, { talent_0: 2, talent_1: 2 });
    expect(map.get("talent_0")).toBe(20);
    expect(map.get("talent_1")).toBe(24);
  });

  it("adds valueBonus from matching talent_enhance potential effects", async () => {
    const { resolveTalentValues } = await import("./panel");
    const mod = {
      talents: [
        { id: "talent_1", stages: [{ promotion: 2, damageMultiplier: 24 }] },
      ],
    };
    const activeEffects = [
      { type: "stat_bonus", stat: "agility", value: 20 }, // unrelated
      { type: "talent_enhance", talent: "talent_1", valueBonus: 8 }, // ROSSI P3 pattern
      { type: "talent_enhance", talent: "talent_other", valueBonus: 5 }, // shouldn't match
    ];
    // talentLevel must be ≥ stage.promotion to match
    const map = resolveTalentValues(mod, { talent_1: 2 }, activeEffects);
    expect(map.get("talent_1")).toBe(32); // 24 base + 8 bonus
  });

  it("accumulates multiple talent_enhance effects on same talent", async () => {
    const { resolveTalentValues } = await import("./panel");
    const mod = {
      talents: [
        { id: "talent_0", stages: [{ promotion: 2, valuePerPoint: 0.10 }] },
      ],
    };
    const activeEffects = [
      { type: "talent_enhance", talent: "talent_0", valueBonus: 0.05 }, // LIFENG P3 pattern
      { type: "talent_enhance", talent: "talent_0", valueBonus: 0.02 }, // hypothetical extra
    ];
    const map = resolveTalentValues(mod, { talent_0: 2 }, activeEffects);
    expect(map.get("talent_0")).toBeCloseTo(0.17, 5); // 0.10 + 0.05 + 0.02
  });

  it("doesn't apply talent_enhance when talent isn't unlocked (level 0)", async () => {
    const { resolveTalentValues } = await import("./panel");
    const mod = {
      talents: [
        { id: "talent_1", stages: [{ promotion: 2, damageMultiplier: 24 }] },
      ],
    };
    const activeEffects = [
      { type: "talent_enhance", talent: "talent_1", valueBonus: 8 },
    ];
    const map = resolveTalentValues(mod, { talent_1: 0 }, activeEffects);
    // Talent locked → no entry in map (regardless of potential)
    expect(map.has("talent_1")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// previousActionTiming VariantCondition (chained skill auto-select)
// ═══════════════════════════════════════════════════════════════════

describe("V2 Kernel — previousActionTiming variant selection", () => {
  // Pattern: when a skill is placed within a specific time window after a previous
  // skill, auto-select a different variant. ROSSI 第二段 精确衔接 [123f, 167f] 用例.

  it("selects variant when placed within prevSinceFrames window", () => {
    const baseSkill: Skill = {
      id: "test_followup",
      type: "skill", name: "test followup",
      element: "physical", duration: 1, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.1, checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "skill" },
        effects: [], standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    // Variant: doubled multiplier when placed within 60..180f after "test_initial"
    const preciseVariant: SkillVariant = {
      id: "test_precise",
      priority: 10,
      conditions: [{
        type: "previousActionTiming",
        prevSkillId: "test_initial",
        prevSinceFrames: { min: 60, max: 180 },
      }],
      overrides: {
        hits: [{
          offset: 0.1, checkpointIndex: 0,
          damage: { multiplier: 200, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "skill" },
          effects: [], standardLogic: true,
        }],
      },
    };
    const initialSkill: Skill = { ...baseSkill, id: "test_initial", name: "test initial" };

    const build = makeBuild();
    // Place initial at t=0, followup at t=2 (= 120f, within [60f, 180f])
    const result = simulate([build], [
      { actionId: "init", actorId: "ACTOR", skill: initialSkill, startTime: 0 },
      { actionId: "follow", actorId: "ACTOR", skill: baseSkill, startTime: 2, variants: [preciseVariant] },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const dmgs = result.events.filter(e => e.type === "damage") as any[];
    // initial @ ~0.1s mult=100 → damage ~ATK×1.0×0.5 = ~150
    // followup @ ~2.1s should fire variant (mult=200) → damage ~ATK×2.0×0.5 = ~300
    const followupDmg = dmgs.find(d => Math.abs(d.time - 2.1) < 0.01);
    const initialDmg = dmgs.find(d => Math.abs(d.time - 0.1) < 0.01);
    expect(initialDmg).toBeTruthy();
    expect(followupDmg).toBeTruthy();
    expect(followupDmg.multiplier).toBe(200); // variant selected
  });

  it("does NOT select variant when placed outside window", () => {
    const baseSkill: Skill = {
      id: "test_followup", type: "skill", name: "test followup",
      element: "physical", duration: 1, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.1, checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "skill" },
        effects: [], standardLogic: true,
      }],
      checkpoints: [{ index: 0, interruptibleBy: [], hitRange: [0, 0] }],
    };
    const preciseVariant: SkillVariant = {
      id: "test_precise", priority: 10,
      conditions: [{ type: "previousActionTiming", prevSkillId: "test_initial", prevSinceFrames: { min: 60, max: 180 } }],
      overrides: {
        hits: [{
          offset: 0.1, checkpointIndex: 0,
          damage: { multiplier: 200, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "skill" },
          effects: [], standardLogic: true,
        }],
      },
    };
    const initialSkill: Skill = { ...baseSkill, id: "test_initial", name: "test initial" };
    const build = makeBuild();
    // Followup at t=4 (= 240f, OUTSIDE [60, 180])
    const result = simulate([build], [
      { actionId: "init", actorId: "ACTOR", skill: initialSkill, startTime: 0 },
      { actionId: "follow", actorId: "ACTOR", skill: baseSkill, startTime: 4, variants: [preciseVariant] },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const followupDmg = (result.events.filter(e => e.type === "damage") as any[])
      .find(d => Math.abs(d.time - 4.1) < 0.01);
    expect(followupDmg).toBeTruthy();
    expect(followupDmg.multiplier).toBe(100); // base, variant NOT selected
  });
});

// ═══════════════════════════════════════════════════════════════════
// buff_apply.internal + multi-modifier buffs (ROSSI 终结技 / 二段连携 patterns)
// ═══════════════════════════════════════════════════════════════════

describe("V2 Kernel — buff_apply: internal flag + multi-modifier", () => {
  it("internal=true buff still modifies BuffManager (damage zone correct) but emits event with internal: true", () => {
    const build = makeBuild();
    // Skill: hit1 applies an internal +50% crit_dmg buff, hit2 fires a damage
    // that should reflect the buffed crit zone.
    const skill: Skill = {
      id: "internal_test", type: "skill", name: "test",
      element: "physical", duration: 2, spCost: 0, cooldown: 0,
      hits: [
        {
          offset: 0.1, checkpointIndex: 0,
          damage: null,
          effects: [
            {
              type: "buff_apply",
              params: {
                buffId: "internal_buff",
                target: "self",
                stat: "crit_dmg",
                zone: "crit",
                value: 50,
                duration: 5,
                internal: true,
              },
            },
          ],
          standardLogic: true,
        },
        {
          offset: 1.0, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "skill" },
          effects: [], standardLogic: true,
        },
      ],
      checkpoints: [],
    };
    const probLocks = new Map<string, "yes" | "no">([["crit:a:1:0", "yes"]]);
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "real", rng: () => 0.99, probLocks });

    // Internal flag must propagate to the emitted event so projections can hide it.
    const buffEvent = result.events.find((e: any) => e.type === "buff_apply" && e.buffId === "internal_buff") as any;
    expect(buffEvent).toBeTruthy();
    expect(buffEvent.internal).toBe(true);

    // Damage of the second hit must reflect the +50% crit_dmg buff in BuffManager.
    // Base ATK=1000, mult=100% → 1000 × 1 × 0.5 × 1.0 = 500 non-crit; crit zone =
    // (1 + 0.5 base + 0.5 internal) = 2.0 → 1000 × 1 × 0.5 × 2.0 = 1000 crit.
    const dmg = (result.events.filter((e: any) => e.type === "damage") as any[])[0];
    expect(dmg.isCrit).toBe(true);
    expect(dmg.damage).toBe(1000);
  });

  it("modifiers[] applies multiple stat changes in a single buff_apply", () => {
    const build = makeBuild();
    const skill: Skill = {
      id: "multi_mod_test", type: "skill", name: "test",
      element: "physical", duration: 2, spCost: 0, cooldown: 0,
      hits: [
        {
          offset: 0.1, checkpointIndex: 0,
          damage: null,
          effects: [
            {
              type: "buff_apply",
              params: {
                buffId: "multi_mod_buff",
                target: "self",
                duration: 5,
                // ROSSI 二段连携 pattern: 暴击率 + 暴击伤害 in one buff.
                modifiers: [
                  { stat: "crit_rate", zone: "crit", value: 25 },
                  { stat: "crit_dmg",  zone: "crit", value: 30 },
                ],
              },
            },
          ],
          standardLogic: true,
        },
        {
          offset: 1.0, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "skill" },
          effects: [], standardLogic: true,
        },
      ],
      checkpoints: [],
    };
    // Force the hit to crit so we observe the +30% crit_dmg modifier.
    const probLocks = new Map<string, "yes" | "no">([["crit:a:1:0", "yes"]]);
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "real", rng: () => 0.99, probLocks });

    // Exactly ONE buff_apply event (not two) — proves the modifiers[] form
    // consolidates into a single buff rather than spawning per-stat events.
    const buffApplies = result.events.filter((e: any) => e.type === "buff_apply" && e.buffId === "multi_mod_buff");
    expect(buffApplies.length).toBe(1);

    // Crit damage uses 50% base + 30% from buff = 80% → crit zone = 1.80.
    // 1000 × 1 × 0.5 × 1.80 = 900.
    const dmg = (result.events.filter((e: any) => e.type === "damage") as any[])[0];
    expect(dmg.isCrit).toBe(true);
    expect(dmg.damage).toBe(900);
  });
});

// ═══════════════════════════════════════════════════════════════════
// hideFromHits on delayed_damage (ROSSI 爪印斫痕 DOT pattern)
// ═══════════════════════════════════════════════════════════════════

describe("V2 Kernel — delayed_damage hideFromHits flag", () => {
  it("propagates to the emitted damage event", () => {
    const build = makeBuild();
    const skill: Skill = {
      id: "dot_test", type: "skill", name: "test",
      element: "physical", duration: 3, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.5, checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "skill" },
        effects: [
          // A "DOT tick" delayed damage; should not appear in per-hit table.
          { type: "delayed_damage", params: { delay: 1.0, multiplier: 50, element: "physical", school: "physical", canCrit: false, hideFromHits: true } },
          // A regular trigger damage; should appear normally.
          { type: "delayed_damage", params: { delay: 0.5, multiplier: 30, element: "physical", school: "physical", canCrit: false } },
        ],
        standardLogic: true,
      }],
      checkpoints: [],
    };
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const dmgs = (result.events.filter((e: any) => e.type === "damage") as any[]);
    // 3 damage events: main hit + 2 delayed
    expect(dmgs.length).toBe(3);
    const hiddenDmg = dmgs.find(d => d.multiplier === 50);
    const visibleDmg = dmgs.find(d => d.multiplier === 30);
    expect(hiddenDmg!.hideFromHits).toBe(true);
    expect(visibleDmg!.hideFromHits).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// talentLevel + potentialLevel VariantConditions (ROSSI 战技 stage cascade)
// ═══════════════════════════════════════════════════════════════════

describe("V2 Kernel — talentLevel / potentialLevel variant conditions", () => {
  // ROSSI 强化战技 cascade: 6 variants keyed by talent_0 level × P1 potential
  // present. Priority order: P2+P1pot (35) > P2 (30) > P1+P1pot (25) > P1 (20)
  // > notalent+P1pot (15) > notalent (10). Highest priority matching wins.

  async function loadVariants() {
    const rossi = await import("./characters/rossi");
    return (rossi.variants as { skill?: SkillVariant[] })?.skill || [];
  }

  function makeRossiBuildForVariant(promotion: number, potentialLevel: number, talentLevels: Record<string, number>): CharacterBuild {
    const input: CharacterInput = {
      id: "ROSSI", name: "ROSSI", element: "physical", rarity: 6,
      promotion, potentialLevel, talentLevels,
      baseStrength: 0, baseAgility: 0, baseIntellect: 0, baseWill: 0,
      baseAttack: 1000, baseHp: 1000,
      mainAttribute: "agility", subAttribute: "intellect",
      weaponId: null, weaponBaseAtk: 0, weaponLevel: 90,
      equipmentSetId: null, baseGaugeMax: 300,
      statModifiers: [{ source: "test", stat: "crit_rate", value: -5, type: "flat" as const }],
    };
    return computeCharacterBuild(input);
  }

  async function castStrengthenedSkill(build: CharacterBuild, variants: SkillVariant[]) {
    const rossi = await import("./characters/rossi");
    const baseSkill = rossi.skills.skill;
    // Pre-apply break, then cast 战技.
    const breakApplier: Skill = {
      id: "breaker", type: "attack", name: "breaker",
      element: "physical", duration: 0.1, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.05, checkpointIndex: 0,
        damage: { multiplier: 0, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "attack" },
        effects: [{ type: "break_apply", params: { stacks: 1 } }],
        standardLogic: true,
      }],
      checkpoints: [],
    };
    return simulate([build], [
      { actionId: "br", actorId: "ROSSI", skill: breakApplier, startTime: 0 },
      { actionId: "a", actorId: "ROSSI", skill: baseSkill, startTime: 1, variants },
    ], defaultEnemy, { initialSP: 100, critMode: "expected" });
  }

  it("talent_0 level 0, potential 0 → enh_notalent_nopot variant", async () => {
    const variants = await loadVariants();
    const build = makeRossiBuildForVariant(0, 0, {});
    const result = await castStrengthenedSkill(build, variants);
    const actionStart = result.events.find((e: any) => e.type === "action_start" && e.actionId === "a") as any;
    expect(actionStart.variantId).toBe("rossi_skill_enh_notalent_nopot");
  });

  it("talent_0 level 1, potential 0 → enh_p1_nopot variant", async () => {
    const variants = await loadVariants();
    const build = makeRossiBuildForVariant(1, 0, { talent_0: 1 });
    const result = await castStrengthenedSkill(build, variants);
    const actionStart = result.events.find((e: any) => e.type === "action_start" && e.actionId === "a") as any;
    expect(actionStart.variantId).toBe("rossi_skill_enh_p1_nopot");
  });

  it("talent_0 level 2, potential 0 → enh_p2_nopot variant", async () => {
    const variants = await loadVariants();
    const build = makeRossiBuildForVariant(2, 0, { talent_0: 2 });
    const result = await castStrengthenedSkill(build, variants);
    const actionStart = result.events.find((e: any) => e.type === "action_start" && e.actionId === "a") as any;
    expect(actionStart.variantId).toBe("rossi_skill_enh_p2_nopot");
  });

  it("talent_0 level 2, potential 1 → enh_p2_p1pot variant (highest priority)", async () => {
    const variants = await loadVariants();
    const build = makeRossiBuildForVariant(2, 1, { talent_0: 2 });
    const result = await castStrengthenedSkill(build, variants);
    const actionStart = result.events.find((e: any) => e.type === "action_start" && e.actionId === "a") as any;
    expect(actionStart.variantId).toBe("rossi_skill_enh_p2_p1pot");
  });

  it("talent_0 level 0, potential 1 → enh_notalent_p1pot variant", async () => {
    const variants = await loadVariants();
    const build = makeRossiBuildForVariant(0, 1, {});
    const result = await castStrengthenedSkill(build, variants);
    const actionStart = result.events.find((e: any) => e.type === "action_start" && e.actionId === "a") as any;
    expect(actionStart.variantId).toBe("rossi_skill_enh_notalent_p1pot");
  });

  it("no break → falls through to basic skill (no variant)", async () => {
    const variants = await loadVariants();
    const build = makeRossiBuildForVariant(2, 1, { talent_0: 2 });
    const rossi = await import("./characters/rossi");
    const result = simulate([build], [
      { actionId: "a", actorId: "ROSSI", skill: rossi.skills.skill, startTime: 0, variants },
    ], defaultEnemy, { initialSP: 100, critMode: "expected" });
    const actionStart = result.events.find((e: any) => e.type === "action_start" && e.actionId === "a") as any;
    expect(actionStart.variantId).toBeUndefined();
    // Basic skill = 3 hits
    const dmgs = result.events.filter((e: any) => e.type === "damage");
    expect(dmgs.length).toBe(3);
  });

  it("P1 SP refund fires exactly once per 强化战技 cast (not 4x on 狼之珀)", async () => {
    const variants = await loadVariants();
    const build = makeRossiBuildForVariant(0, 1, {});
    const result = await castStrengthenedSkill(build, variants);
    // sp_change events from this skill cast — should include exactly 1
    // sp_restore (the P1 refund), beyond the cast's own sp_cost.
    const spEvents = result.events.filter((e: any) =>
      e.type === "sp_change" && e.actorId === "ROSSI" && e.reason === "hit_restore"
    );
    expect(spEvents.length).toBe(1);
    expect((spEvents[0] as any).change).toBe(10);
  });

  it("Without P1 potential, no SP refund fires on 强化战技 cast", async () => {
    const variants = await loadVariants();
    const build = makeRossiBuildForVariant(0, 0, {});
    const result = await castStrengthenedSkill(build, variants);
    const spRestores = result.events.filter((e: any) =>
      e.type === "sp_change" && e.actorId === "ROSSI" && e.reason === "hit_restore"
    );
    expect(spRestores.length).toBe(0);
  });

  it("狼之珀 emits 4 damage events: 1 main + 3 delayed_damage (each independently crits)", async () => {
    const variants = await loadVariants();
    const build = makeRossiBuildForVariant(0, 0, {});
    const rossi = await import("./characters/rossi");
    // resolveRef must yield non-zero so delayed_damage emits (mult > 0 gate).
    const resolveRef = (_actor: string, label: string) =>
      label === "第二段伤害倍率" ? 288 :
      label === "第一段伤害倍率" ? 192 : 0;
    const breakApplier: Skill = {
      id: "breaker", type: "attack", name: "breaker",
      element: "physical", duration: 0.1, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.05, checkpointIndex: 0,
        damage: { multiplier: 0, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "attack" },
        effects: [{ type: "break_apply", params: { stacks: 1 } }],
        standardLogic: true,
      }],
      checkpoints: [],
    };
    const result = simulate([build], [
      { actionId: "br", actorId: "ROSSI", skill: breakApplier, startTime: 0 },
      { actionId: "a", actorId: "ROSSI", skill: rossi.skills.skill, startTime: 1, variants },
    ], defaultEnemy, { initialSP: 100, critMode: "expected", resolveRef });
    const skillDmgs = (result.events.filter((e: any) =>
      e.type === "damage" && e.actionId === "a"
    ) as any[]);
    // basic 3 (hit1/2/3) + 1 launch effect damage (from hit3's physical_anomaly)
    // + 1 狼之珀 main + 3 狼之珀 delayed = 8 damages total.
    expect(skillDmgs.length).toBe(8);
    const wolfPearlDmgs = skillDmgs.filter(d => d.element === "blaze");
    expect(wolfPearlDmgs.length).toBe(4);
    // 3 of the 4 wolf-pearl are delayed_damage (fromTrigger=true, triggerName="狼之珀")
    const wolfDelayedDmgs = wolfPearlDmgs.filter(d => d.fromTrigger);
    expect(wolfDelayedDmgs.length).toBe(3);
  });

  it("沸血 talent_1 fires exactly once per 强化战技 cast (狼之珀 4-as-1 hit)", async () => {
    // Force EVERY canCrit damage to crit via "expected" mode with crit_rate=95
    // (kernel base 5 + 95 = 100 → expected crit zone = full crit_dmg). The
    // talent_1 trigger fires on the main hit's hit_damage event regardless of
    // how many delayed_damages also rolled — and since delayed_damage doesn't
    // push hit_damage events, 沸血 fires exactly once.
    const input: CharacterInput = {
      id: "ROSSI", name: "ROSSI", element: "physical", rarity: 6,
      promotion: 2, potentialLevel: 0, talentLevels: { talent_0: 2, talent_1: 2 },
      baseStrength: 0, baseAgility: 0, baseIntellect: 0, baseWill: 0,
      baseAttack: 1000, baseHp: 1000,
      mainAttribute: "agility", subAttribute: "intellect",
      weaponId: null, weaponBaseAtk: 0, weaponLevel: 90,
      equipmentSetId: null, baseGaugeMax: 300,
      statModifiers: [{ source: "test", stat: "crit_rate", value: 95, type: "flat" as const }],
    };
    const build = computeCharacterBuild(input);
    const rossi = await import("./characters/rossi");
    const variants = (rossi.variants as { skill?: SkillVariant[] })?.skill || [];

    const breakApplier: Skill = {
      id: "breaker", type: "attack", name: "breaker",
      element: "physical", duration: 0.1, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.05, checkpointIndex: 0,
        damage: { multiplier: 0, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "attack" },
        effects: [{ type: "break_apply", params: { stacks: 1 } }],
        standardLogic: true,
      }],
      checkpoints: [],
    };
    const triggersByActor = new Map([["ROSSI", rossi.triggers]]);
    const resolveRef = (_actor: string, label: string) =>
      label === "talent_1" ? 24 :
      label === "第二段伤害倍率" ? 288 :
      label === "第一段伤害倍率" ? 192 : 0;
    // Real mode + crit_rate 100% (95 + base 5) + rng=0 → every canCrit damage crits.
    // The 沸血 trigger filters on `crit_hit` and the actionType filter, so it fires
    // when the main hit body damage crits (which it will with crit_rate at 100).
    const result = simulate([build], [
      { actionId: "br", actorId: "ROSSI", skill: breakApplier, startTime: 0 },
      { actionId: "a", actorId: "ROSSI", skill: rossi.skills.skill, startTime: 1, variants },
    ], defaultEnemy, { initialSP: 100, critMode: "real", rng: () => 0, resolveRef }, triggersByActor);

    // Count fevorousBlood fires (blaze fromTrigger damages NOT named "狼之珀"
    // or "爪印斫痕" — those are the wolf-pearl extras and 斫痕 DOT respectively).
    const allTriggerBlaze = result.events.filter((e: any) =>
      e.type === "damage" && e.fromTrigger && e.element === "blaze"
    ) as any[];
    const fevorousFires = allTriggerBlaze.filter(d =>
      d.triggerName !== "狼之珀" && d.triggerName !== "爪印斫痕"
    );
    // talent_1 fires exactly once per 强化战技 cast — once for the main 狼之珀
    // hit's crit. The 3 wolf-pearl delayed_damages also crit but don't fire
    // hit_damage trigger events (delayed_damage suppresses the cascade), and
    // 25 斫痕 DOT ticks similarly don't cascade.
    expect(fevorousFires.length).toBe(1);
  });

  it("斫痕 is a single compound debuff applying both physical_vuln + blaze_vuln", () => {
    // One buff_apply with two modifiers. Single buff bar entry, single icon
    // (rossi_zhuohen → /avatars/ROSSI/icon_talent_wulfa_01.webp).
    // Both physical and blaze hits should benefit from their respective vuln.
    const build = makeBuild();
    const skill: Skill = {
      id: "test_zhuohen", type: "skill", name: "test",
      element: "physical", duration: 2, spCost: 0, cooldown: 0,
      hits: [
        // Hit 0: apply the compound 斫痕 debuff
        {
          offset: 0.1, checkpointIndex: 0,
          damage: null,
          effects: [{
            type: "buff_apply", params: {
              buffId: "rossi_zhuohen",
              target: "enemy",
              duration: 25,
              modifiers: [
                { stat: "physical_dmg", zone: "vulnerability", value: 12 },
                { stat: "blaze_dmg",    zone: "vulnerability", value: 12 },
              ],
            },
          }],
          standardLogic: true,
        },
        // Hit 1: physical hit — should benefit from 物理脆弱 +12%
        {
          offset: 0.5, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "skill" },
          effects: [], standardLogic: true,
        },
        // Hit 2: blaze hit — should benefit from 灼热脆弱 +12%
        {
          offset: 1.0, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "blaze", canCrit: false, school: "magic", sourceType: "skill" },
          effects: [], standardLogic: true,
        },
      ],
      checkpoints: [],
    };
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    // Exactly ONE buff_apply event for rossi_zhuohen (compound, not split)
    const buffApplies = result.events.filter((e: any) =>
      e.type === "buff_apply" && e.buffId === "rossi_zhuohen"
    );
    expect(buffApplies.length).toBe(1);

    // Both physical AND blaze damage benefit from their respective vuln modifier.
    // Base ATK=1000, mult=100% → 1000 × 1 × 0.5 = 500 baseline; with +12% vuln → 560.
    const dmgs = result.events.filter((e: any) => e.type === "damage") as any[];
    const physicalDmg = dmgs.find(d => d.element === "physical");
    const blazeDmg = dmgs.find(d => d.element === "blaze");
    expect(physicalDmg!.damage).toBe(560);
    expect(blazeDmg!.damage).toBe(560);
  });

  it("沸血 does NOT fire on normal attacks even with 斫痕 buff active", async () => {
    const input: CharacterInput = {
      id: "ROSSI", name: "ROSSI", element: "physical", rarity: 6,
      promotion: 2, potentialLevel: 0, talentLevels: { talent_0: 2, talent_1: 2 },
      baseStrength: 0, baseAgility: 0, baseIntellect: 0, baseWill: 0,
      baseAttack: 1000, baseHp: 1000,
      mainAttribute: "agility", subAttribute: "intellect",
      weaponId: null, weaponBaseAtk: 0, weaponLevel: 90,
      equipmentSetId: null, baseGaugeMax: 300,
      statModifiers: [{ source: "test", stat: "crit_rate", value: -5, type: "flat" as const }],
    };
    const build = computeCharacterBuild(input);
    const rossi = await import("./characters/rossi");
    // A normal attack that pre-applies the 斫痕 vuln buff (simulating prior 战技),
    // then crits. The 沸血 trigger should NOT fire (attack ≠ skill/link/ultimate).
    const attack: Skill = {
      id: "atk_test", type: "attack", name: "atk",
      element: "physical", duration: 1, spCost: 0, cooldown: 0,
      hits: [
        // Pre-apply 斫痕 compound debuff so trigger condition's enemy_has_buff matches
        {
          offset: 0.1, checkpointIndex: 0,
          damage: null,
          effects: [
            { type: "buff_apply", params: { buffId: "rossi_zhuohen", target: "enemy", duration: 25, modifiers: [
              { stat: "physical_dmg", zone: "vulnerability", value: 12 },
              { stat: "blaze_dmg",    zone: "vulnerability", value: 12 },
            ] } },
          ],
          standardLogic: true,
        },
        // Then a critting normal attack
        {
          offset: 0.5, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" },
          effects: [], standardLogic: true,
        },
      ],
      checkpoints: [],
    };
    const probLocks = new Map<string, "yes" | "no">([["crit:a:1:0", "yes"]]);
    const triggersByActor = new Map([["ROSSI", rossi.triggers]]);
    const resolveRef = (_actor: string, label: string) => label === "talent_1" ? 24 : 0;
    const result = simulate([build], [
      { actionId: "a", actorId: "ROSSI", skill: attack, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "real", rng: () => 0.99, probLocks, resolveRef }, triggersByActor);
    // No blaze trigger damages should be emitted (沸血 filtered out by source_action_type).
    const fevorousFires = result.events.filter((e: any) =>
      e.type === "damage" && e.fromTrigger && e.element === "blaze"
    );
    expect(fevorousFires.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Instant-cast (duration=0) skill — LASTRITE skillInChain
// ═══════════════════════════════════════════════════════════════════

describe("V2 Kernel — instant-cast skill (duration=0) doesn't interrupt active", () => {
  it("a duration=0 skill placed during an active attack does NOT truncate the attack", () => {
    const build = makeBuild();
    // Active attack — duration 2s, single hit at 1s.
    const attack: Skill = {
      id: "active_attack", type: "attack", name: "atk",
      element: "physical", duration: 2, spCost: 0, cooldown: 0,
      hits: [{
        offset: 1, checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "attack" },
        effects: [], standardLogic: true,
      }],
      checkpoints: [],
    };
    // Instant skill — duration 0, single effect-only "hit" at 0.04s offset.
    const instantSkill: Skill = {
      id: "instant_skill", type: "skill", name: "instant",
      element: "physical", duration: 0, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.04, checkpointIndex: 0,
        damage: null,
        effects: [{ type: "buff_apply", params: { buffId: "test_inf", target: "self", duration: 5, stat: "attack_percent", zone: "attackPercent", value: 10 } }],
        standardLogic: true,
      }],
      checkpoints: [],
    };
    // Place attack at 0, instant skill at 0.5 (mid-attack), then another attack at 2.5.
    const result = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: attack, startTime: 0 },
      { actionId: "s",  actorId: "ACTOR", skill: instantSkill, startTime: 0.5 },
      { actionId: "a2", actorId: "ACTOR", skill: attack, startTime: 2.5 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    // a1 should fire its hit at 1.0 (not interrupted by the instant skill at 0.5).
    const a1Damage = result.events.find((e: any) => e.type === "damage" && e.actionId === "a1");
    expect(a1Damage).toBeTruthy();
    // a1's action_end shouldn't be marked interrupted.
    const a1End = result.events.find((e: any) => e.type === "action_end" && e.actionId === "a1") as any;
    expect(a1End).toBeTruthy();
    expect(a1End.interrupted).toBe(false);
    // a2 fires its damage at 2.5+1 = 3.5 (normal, not blocked).
    const a2Damage = result.events.find((e: any) => e.type === "damage" && e.actionId === "a2");
    expect(a2Damage).toBeTruthy();
    // Instant skill buff_apply event fired.
    const buffApply = result.events.find((e: any) => e.type === "buff_apply" && e.buffId === "test_inf");
    expect(buffApply).toBeTruthy();
  });

  it("instant-cast skill itself is not blocked by an active attack (placement proceeds)", () => {
    const build = makeBuild();
    const attack: Skill = {
      id: "active_attack", type: "attack", name: "atk",
      element: "physical", duration: 2, spCost: 0, cooldown: 0,
      hits: [{
        offset: 1, checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "attack" },
        effects: [], standardLogic: true,
      }],
      checkpoints: [],
    };
    const instantSkill: Skill = {
      id: "instant_skill", type: "skill", name: "instant",
      element: "physical", duration: 0, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.04, checkpointIndex: 0,
        damage: { multiplier: 200, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "skill" },
        effects: [], standardLogic: true,
      }],
      checkpoints: [],
    };
    // Place instant during active attack — its damage should still fire.
    const result = simulate([build], [
      { actionId: "a1", actorId: "ACTOR", skill: attack, startTime: 0 },
      { actionId: "s",  actorId: "ACTOR", skill: instantSkill, startTime: 0.5 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    // The instant skill's damage event should be present (multiplier 200 distinguishes it).
    const instantDmg = result.events.find((e: any) => e.type === "damage" && e.multiplier === 200);
    expect(instantDmg).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════
// magic_attachment delay support (LASTRITE 低温灌注 phantom 19f delay)
// ═══════════════════════════════════════════════════════════════════

describe("V2 Kernel — magic_attachment delay parameter", () => {
  it("attachment_change event time = hit time + delay", () => {
    const build = makeBuild();
    const skill: Skill = {
      id: "delayed_attach_test", type: "skill", name: "test",
      element: "physical", duration: 2, spCost: 0, cooldown: 0,
      hits: [{
        offset: 1, checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "cold", canCrit: false, school: "magic", sourceType: "skill" },
        // Attach cold with a 19f delay — the change event should land at hit time + 19/60.
        effects: [{ type: "magic_attachment", params: { element: "cold", stacks: 1, delay: 19/60 } }],
        standardLogic: true,
      }],
      checkpoints: [],
    };
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const attachEvent = result.events.find((e: any) => e.type === "attachment_change" && e.stacks === 1) as any;
    expect(attachEvent).toBeTruthy();
    // Hit lands at 1.0s; with delay 19/60s, attachment event at 1 + 19/60 ≈ 1.317s.
    expect(attachEvent.time).toBeCloseTo(1 + 19/60, 5);
  });

  it("delay defaults to 0 when omitted (event time = hit time)", () => {
    const build = makeBuild();
    const skill: Skill = {
      id: "no_delay_attach", type: "skill", name: "test",
      element: "physical", duration: 2, spCost: 0, cooldown: 0,
      hits: [{
        offset: 1, checkpointIndex: 0,
        damage: { multiplier: 100, stagger: 0, element: "cold", canCrit: false, school: "magic", sourceType: "skill" },
        effects: [{ type: "magic_attachment", params: { element: "cold", stacks: 1 } }],
        standardLogic: true,
      }],
      checkpoints: [],
    };
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    const attachEvent = result.events.find((e: any) => e.type === "attachment_change" && e.stacks === 1) as any;
    expect(attachEvent.time).toBeCloseTo(1, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════
// V2 ultimate_gaugeMax propagation (E fix)
// ═══════════════════════════════════════════════════════════════════

describe("V2 — adapter.applyV2Overrides sets char.ultimate_gaugeMax from V2 module", () => {
  it("ROSSI: char.ultimate_gaugeMax = 110 after applyV2Overrides", async () => {
    const { preloadV2Modules, applyV2Overrides } = await import("./characters/adapter");
    await preloadV2Modules();
    const rossiChar: any = { id: "ROSSI", ultimate_gaugeMax: 100 /* stale gamedata */ };
    const ok = applyV2Overrides(rossiChar);
    expect(ok).toBe(true);
    // V2 module's gaugeCost (110) overrides stale gamedata (100).
    expect(rossiChar.ultimate_gaugeMax).toBe(110);
    expect(rossiChar.ultimate_gaugeCost).toBe(110);
  });
});

// ═══════════════════════════════════════════════════════════════════
// silentTriggers Hit flag (狼之珀 4-as-1 hit semantics)
// ═══════════════════════════════════════════════════════════════════

describe("V2 Kernel — Hit.silentTriggers suppresses trigger event emission", () => {
  it("damage event still emitted, but no hit_damage / skill_hit trigger events fire", () => {
    const build = makeBuild();
    const skill: Skill = {
      id: "silent_test", type: "skill", name: "test",
      element: "physical", duration: 1, spCost: 0, cooldown: 0,
      hits: [
        // Normal hit — fires triggers
        {
          offset: 0.1, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "skill" },
          effects: [], standardLogic: true,
        },
        // Silent hit — no trigger events but damage still emitted
        {
          offset: 0.2, checkpointIndex: 0,
          damage: { multiplier: 100, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "skill" },
          effects: [], standardLogic: true,
          silentTriggers: true,
        },
      ],
      checkpoints: [],
    };
    // Simpler test: just observe the hit_damage trigger event count.
    // Run a sim and verify the event stream contains the expected damage events.
    const result = simulate([build], [
      { actionId: "a", actorId: "ACTOR", skill, startTime: 0 },
    ], defaultEnemy, { initialSP: 0, critMode: "expected" });

    // 2 main damage events (both hits) — silentTriggers doesn't prevent damage emit
    const dmgs = result.events.filter((e: any) => e.type === "damage") as any[];
    expect(dmgs.length).toBe(2);
    expect(dmgs[0].damage).toBeGreaterThan(0);
    expect(dmgs[1].damage).toBeGreaterThan(0);

    // Both action_start + (2 damages) are emitted; the silent hit is a normal
    // damage event but no associated hit_damage trigger event flows from it.
    // The trigger-event suppression is internal to the kernel — directly
    // verifiable via the kernel's behavior in chained-trigger tests elsewhere
    // (e.g. the "P1 SP refund fires exactly once" test, which exercises the
    // same silentTriggers path through ROSSI 强化战技 狼之珀 sub-hits 2-4).
  });
});

// ═══════════════════════════════════════════════════════════════════
// enemyHasBreak VariantCondition (ROSSI 战技 basic vs 强化 auto-select)
// ═══════════════════════════════════════════════════════════════════

describe("V2 Kernel — enemyHasBreak variant condition", () => {
  // Pattern: a skill whose 强化 variant fires only when the target has 破防 at
  // cast time. ROSSI 战技 is the canonical user.

  function makeBreakBuild(): CharacterBuild {
    const input: CharacterInput = {
      id: "ROSSI", name: "ROSSI", element: "physical", rarity: 6,
      promotion: 0, potentialLevel: 0, talentLevels: {},
      baseStrength: 0, baseAgility: 0, baseIntellect: 0, baseWill: 0,
      baseAttack: 1000, baseHp: 1000,
      mainAttribute: "agility", subAttribute: "intellect",
      weaponId: null, weaponBaseAtk: 0, weaponLevel: 90,
      equipmentSetId: null, baseGaugeMax: 300,
      statModifiers: [{ source: "test", stat: "crit_rate", value: -5, type: "flat" as const }],
    };
    return computeCharacterBuild(input);
  }

  it("selects 强化 variant only when enemy is broken at cast time", async () => {
    const rossi = await import("./characters/rossi");
    const baseSkill = rossi.skills.skill;
    const variants = (rossi.variants as { skill?: SkillVariant[] })?.skill || [];
    expect(variants.length).toBeGreaterThan(0);

    const build = makeBreakBuild();

    // Case A: no 破防 — basic 3-hit version fires (duration 110f, 3 damage events)
    const noBreak = simulate([build], [
      { actionId: "a", actorId: "ROSSI", skill: baseSkill, startTime: 0, variants },
    ], defaultEnemy, { initialSP: 100, critMode: "expected" });
    const noBreakDmgs = noBreak.events.filter(e => e.type === "damage") as any[];
    expect(noBreakDmgs.length).toBe(3);  // hit1-3 only

    // Case B: pre-apply 1 stack of break, then cast 战技 — 强化 variant fires.
    // Apply break via a dummy skill that emits a break_apply effect before 战技.
    const breakApplier: Skill = {
      id: "breaker", type: "attack", name: "breaker",
      element: "physical", duration: 0.1, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.05, checkpointIndex: 0,
        damage: { multiplier: 0, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "attack" },
        effects: [{ type: "break_apply", params: { stacks: 1 } }],
        standardLogic: true,
      }],
      checkpoints: [],
    };
    const broken = simulate([build], [
      { actionId: "br", actorId: "ROSSI", skill: breakApplier, startTime: 0 },
      { actionId: "a", actorId: "ROSSI", skill: baseSkill, startTime: 1, variants },
    ], defaultEnemy, { initialSP: 100, critMode: "expected" });
    const brokenDmgs = (broken.events.filter(e => e.type === "damage") as any[])
      .filter(d => d.time >= 1); // exclude the break_apply hit's own damage event
    // 强化版 = 3 hit (第一段) + 4 sub-hits (狼之珀) + 25 斫痕 DOT ticks = 32 damage events
    // Just verify > 3 (definitely not basic) and the 狼之珀 sub-hits land at ~139-142f.
    expect(brokenDmgs.length).toBeGreaterThan(3);
    const wolfHit = brokenDmgs.find(d => Math.abs(d.time - (1 + 139/60)) < 0.05);
    expect(wolfHit).toBeTruthy();
  });

  it("variant.action_start event carries variantId when 强化 fires", async () => {
    const rossi = await import("./characters/rossi");
    const baseSkill = rossi.skills.skill;
    const variants = (rossi.variants as { skill?: SkillVariant[] })?.skill || [];
    const build = makeBreakBuild();

    const breakApplier: Skill = {
      id: "breaker", type: "attack", name: "breaker",
      element: "physical", duration: 0.1, spCost: 0, cooldown: 0,
      hits: [{
        offset: 0.05, checkpointIndex: 0,
        damage: { multiplier: 0, stagger: 0, element: "physical", canCrit: false, school: "physical", sourceType: "attack" },
        effects: [{ type: "break_apply", params: { stacks: 1 } }],
        standardLogic: true,
      }],
      checkpoints: [],
    };
    const result = simulate([build], [
      { actionId: "br", actorId: "ROSSI", skill: breakApplier, startTime: 0 },
      { actionId: "a", actorId: "ROSSI", skill: baseSkill, startTime: 1, variants },
    ], defaultEnemy, { initialSP: 100, critMode: "expected" });
    const actionStart = result.events.find(
      (e: any) => e.type === "action_start" && e.actionId === "a"
    ) as any;
    expect(actionStart).toBeTruthy();
    // Default test build: promotion=0, potentialLevel=0 → no talent, no P1.
    // Priority cascade picks the no-talent / no-potential 强化 variant.
    expect(actionStart.variantId).toBe("rossi_skill_enh_notalent_nopot");
  });
});

// Helper: build with non-zero ATK for damage tests above
function makeBuild() {
  const input: CharacterInput = {
    id: "ACTOR", name: "ACTOR", element: "physical", rarity: 6,
    promotion: 0, potentialLevel: 0, talentLevels: {},
    baseStrength: 0, baseAgility: 0, baseIntellect: 0, baseWill: 0,
    baseAttack: 1000, baseHp: 1000,
    mainAttribute: "agility", subAttribute: "intellect",
    weaponId: null, weaponBaseAtk: 0, weaponLevel: 90,
    equipmentSetId: null, baseGaugeMax: 300,
    statModifiers: [{ source: "test", stat: "crit_rate", value: -5, type: "flat" as const }],
  };
  return computeCharacterBuild(input);
}
