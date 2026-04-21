/**
 * ARCLIGHT variant selection integration test
 *
 * Confirms:
 *  1. With conduction active on enemy, the enhanced skill variant is selected.
 *  2. Without conduction, the base 2-hit variant is used (no hit3, no consume).
 *  3. The enhanced variant's hit3 consume_anomaly actually clears enemy conduction.
 */
import { describe, it, expect } from "vitest";
import { simulate, type PlacedSkill, type EnemyConfig, type KernelConfig } from "./kernel";
import { computeCharacterBuild, type CharacterInput } from "./characterBuild";
import { skills as arclightSkills, variants as arclightVariants, triggers as arclightTriggers } from "./characters/arclight";

function makeArclightBuild() {
  const input: CharacterInput = {
    id: "ARCLIGHT",
    name: "弧光",
    element: "emag",
    rarity: 5,
    promotion: 3,
    potentialLevel: 0,
    talentLevels: { talent_0: 1 },
    baseStrength: 50,
    baseAgility: 200,
    baseIntellect: 200,
    baseWill: 50,
    baseAttack: 250,
    baseHp: 1000,
    mainAttribute: "agility",
    subAttribute: "intellect",
    weaponId: null,
    weaponBaseAtk: 400,
    weaponLevel: 60,
    equipmentSetId: null,
    baseGaugeMax: 90,
    statModifiers: [],
  };
  return computeCharacterBuild(input);
}

const enemyConfig: EnemyConfig = {
  defenseMultiplier: 0.5,
  maxStagger: 1000,
  staggerNodes: [500],
  staggerBreakDuration: 10,
  basePhysicalResist: 0,
  baseMagicResist: 0,
};

const kernelConfig: KernelConfig = {
  initialSP: 100,
  critMode: "expected",
};

describe("ARCLIGHT skill variant selection", () => {
  it("selects enhanced variant when enemy has conduction, consumes it on hit3", () => {
    const build = makeArclightBuild();

    // Seed enemy with conduction via a pre-skill direct_anomaly hit.
    // We use a tiny scaffolding skill that emits 1-level conduction at t=0.
    const conductionSeeder: PlacedSkill = {
      actionId: "seed",
      actorId: "ARCLIGHT",
      startTime: 0,
      skill: {
        id: "seed_skill", type: "skill", name: "seed",
        element: "emag", duration: 0.01, spCost: 0, cooldown: 0,
        hits: [{
          offset: 0, checkpointIndex: 0,
          damage: null,
          effects: [{ type: "direct_anomaly", params: { anomalyType: "conduction", level: 1 } }],
          standardLogic: true,
        }],
        checkpoints: [],
      },
    };

    const skill: PlacedSkill = {
      actionId: "arclight_skill",
      actorId: "ARCLIGHT",
      skill: arclightSkills.skill,
      startTime: 0.5, // after conduction is applied
      variants: arclightVariants.skill,
    };

    const triggersByActor = new Map([["ARCLIGHT", arclightTriggers]]);
    const { events } = simulate([build], [conductionSeeder, skill], enemyConfig, kernelConfig, triggersByActor);

    // 1. condition_result event should report the enhanced variant was chosen
    const condResults = events.filter(e => e.type === "condition_result" && e.actionId === "arclight_skill");
    expect(condResults.length).toBe(1);
    expect((condResults[0] as any).variantId).toBe("arclight_skill_enhanced");

    // 2. There should be 3 damage events attributed to the skill action (enhanced has 3 hits)
    const skillDamages = events.filter(e => e.type === "damage" && (e as any).actionId === "arclight_skill");
    expect(skillDamages.length).toBe(3);

    // 3. anomaly_remove should fire for conduction after the skill (from hit3 consume_anomaly)
    const anomalyRemoves = events.filter(e =>
      e.type === "anomaly_remove" && (e as any).anomalyType === "conduction" && (e as any).time >= 0.5
    );
    expect(anomalyRemoves.length).toBeGreaterThanOrEqual(1);
  });

  it("uses base 2-hit variant when enemy has no conduction", () => {
    const build = makeArclightBuild();

    const skill: PlacedSkill = {
      actionId: "arclight_skill",
      actorId: "ARCLIGHT",
      skill: arclightSkills.skill,
      startTime: 0,
      variants: arclightVariants.skill,
    };

    const { events } = simulate([build], [skill], enemyConfig, kernelConfig);

    const condResults = events.filter(e => e.type === "condition_result" && e.actionId === "arclight_skill");
    expect(condResults.length).toBe(1);
    expect((condResults[0] as any).variantId).toBe(null);

    const skillDamages = events.filter(e => e.type === "damage" && (e as any).actionId === "arclight_skill");
    expect(skillDamages.length).toBe(2);
  });
});
