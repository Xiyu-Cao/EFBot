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
import { simulate, type PlacedSkill, type EnemyConfig, type KernelConfig } from "./kernel";
import { computeCharacterBuild, type CharacterInput } from "./characterBuild";
import type { Skill, Hit, DamageElement } from "./types";

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
import { wpn_claym_0013, wpn_sword_0016, wpn_sword_0021 } from "./weapons/definitions";

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
