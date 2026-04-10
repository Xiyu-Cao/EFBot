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
    teamGaugeGain: 25,
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
