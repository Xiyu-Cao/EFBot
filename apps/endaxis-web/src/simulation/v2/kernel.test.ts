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

    // First hit should be equal (no buff yet), second should be higher
    expect((hitDamages[0] as any).damage).toBe((hitDamagesNoBuff[0] as any).damage);
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
