/**
 * Phase 7 tests — armorBreak real vuln, controlImmunities,
 * auto-registration, buff expiry cleanup.
 */

import { describe, it, expect } from "vitest";
import type { ActorSnapshot } from "../state/types";
import type { ActorStats } from "../compiler/types";
import { createDefaultStats } from "@/utils/coreStats";
import { createEngine } from "../engine/createEngine";
import { compileTimeline } from "../compiler/compileTimeline";
import { DamageResolver } from "./DamageResolver";
import { buildDamageTags } from "./damageTypes";
import { NO_CRIT } from "./critSystem";
import type { DamageContext } from "./type";
import type { AnomalyLevel } from "../anomaly/types";
import { calcBreachPhysVulnerability } from "./anomalyDamageCalc";
import { Effect } from "../effects/types";
import { addOrRefreshBuff, type DynamicBonus } from "../equipment/types";
import { extractEquipmentConfigs, type EquipmentConfig } from "../equipment/registry";

// ===========================================================================
// Helpers
// ===========================================================================

function makeStats(overrides: Partial<ActorStats> = {}): ActorStats {
  return { ...(createDefaultStats() as ActorStats), attack: 1000, ...overrides };
}

function makeActor(id: string, overrides: Partial<ActorStats> = {}): ActorSnapshot {
  return {
    id,
    stats: makeStats(overrides),
    resources: { hp: 1000, gauge: 0 },
    cooldowns: new Map(),
    activeBuffs: new Map(),
  };
}

function makeEngine(
  actors: ActorSnapshot[] = [makeActor("A")],
  enemyOverrides: Record<string, any> = {},
) {
  const timeline = compileTimeline([], []);
  return createEngine(
    { maxSp: 300, initialSp: 200, spRegenRate: 8, skillSpCostDefault: 100, linkCdReduction: 0 },
    {
      maxStagger: 100, staggerNodeCount: 0, staggerNodeDuration: 2,
      staggerBreakDuration: 10, executionRecovery: 25,
      ...enemyOverrides,
    },
    actors,
    timeline,
  );
}

// ===========================================================================
// 1-2. armorBreak real vulnerability
// ===========================================================================

describe("armorBreak Real Vulnerability", () => {
  it("armorBreak writes real physVulnPercent into enemy effect", () => {
    const engine = makeEngine([makeActor("A", { originium_arts_power: 0 })]);

    // Give 2 break stacks
    engine.getState().enemy.status.addBreakStack(0);
    engine.getState().enemy.status.addBreakStack(0);

    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY",
      time: 1,
      payload: { physicalType: "armorBreak", sourceActorId: "A", targetId: "boss" },
    });

    engine.run();

    // Check that enemy has PHYSICAL_VULNERABLE effect with real value
    const vulnEffects = engine.getState().enemy.effects.getByTag("PHYSICAL_VULNERABLE");
    expect(vulnEffects.length).toBe(1);

    const vuln = vulnEffects[0]!.effect;
    // calcBreachPhysVulnerability(stacks=2, artsPower=0):
    // physicalVulnerability = (2 + 2) * 4 * 1 = 16
    // duration = 2 * 6 + 6 = 18
    expect(vuln.properties.physVulnPercent).toBeCloseTo(16, 5);
    expect(vuln.duration).toBe(18);
  });

  it("armorBreak vuln scales with artsPower via artsPowerDebuffMult", () => {
    const engine = makeEngine([makeActor("A", { originium_arts_power: 100 })]);

    engine.getState().enemy.status.addBreakStack(0);
    engine.getState().enemy.status.addBreakStack(0);
    engine.getState().enemy.status.addBreakStack(0);

    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY",
      time: 1,
      payload: { physicalType: "armorBreak", sourceActorId: "A", targetId: "boss" },
    });

    engine.run();

    const vulnEffects = engine.getState().enemy.effects.getByTag("PHYSICAL_VULNERABLE");
    expect(vulnEffects.length).toBe(1);

    // stacks=3, artsPower=100: debuffMult = 1 + 200/400 = 1.5
    // physVuln = (3+2)*4 * 1.5 = 30
    const expected = calcBreachPhysVulnerability(3, 100);
    expect(vulnEffects[0]!.effect.properties.physVulnPercent).toBeCloseTo(expected.physicalVulnerability, 5);
  });

  it("armorBreak vuln enters multiplierZones vulnerability zone", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000 });
    const engine = makeEngine([actor]);

    // Simulate armorBreak result: add PHYSICAL_VULNERABLE effect manually
    const vuln = calcBreachPhysVulnerability(2, 0);
    engine.getState().enemy.effects.add(
      new Effect({
        id: "PHYSICAL_VULNERABLE",
        tags: ["PHYSICAL_VULNERABLE"],
        duration: vuln.duration,
        startTime: 0,
        properties: { physVulnPercent: vuln.physicalVulnerability },
      }),
    );

    const tags = buildDamageTags({
      sourceActorId: "A", targetEnemyId: "boss",
      damageType: "physical", damageSource: "activeSkill",
    });

    const result = resolver.resolve({
      source: actor, target: engine.getState().enemy, state: engine.getState(),
      multiplier: 1.0, damageTags: tags, critOverride: NO_CRIT,
    });

    // ATK=1000, defense=0.5, vulnerability = 1 + 16/100 = 1.16
    // Final = floor(1000 * 0.5 * 1.16) = 580
    expect(result.finalValue).toBe(580);
  });

  it("second armorBreak overwrites existing vuln (not stacks), matching conduction behavior", () => {
    const engine = makeEngine([makeActor("A", { originium_arts_power: 0 })]);

    // First armorBreak: 1 break stack → vuln = (1+2)*4 = 12%, dur = 1*6+6 = 12
    engine.getState().enemy.status.addBreakStack(0);
    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY",
      time: 1,
      payload: { physicalType: "armorBreak", sourceActorId: "A", targetId: "boss" },
    });
    // After first armorBreak processes: break cleared, vuln(12%) applied.

    // Use physical anomaly events to rebuild break stacks for second armorBreak.
    // APPLY_PHYSICAL_ANOMALY on no-break target → adds 1 stack.
    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY",
      time: 2.0,
      payload: { physicalType: "launch", sourceActorId: "A", targetId: "boss" },
    });
    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY",
      time: 2.1,
      payload: { physicalType: "launch", sourceActorId: "A", targetId: "boss" },
    });
    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY",
      time: 2.2,
      payload: { physicalType: "launch", sourceActorId: "A", targetId: "boss" },
    });
    // Now has 3 break stacks (added 1 each at t=2.0, 2.1, 2.2)

    // Second armorBreak: 3 break stacks → vuln = (3+2)*4 = 20%, dur = 3*6+6 = 24
    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY",
      time: 3,
      payload: { physicalType: "armorBreak", sourceActorId: "A", targetId: "boss" },
    });

    engine.run();

    // Should have exactly 1 PHYSICAL_VULNERABLE effect (overwritten, not 2)
    const vulnEffects = engine.getState().enemy.effects.getByTag("PHYSICAL_VULNERABLE");
    expect(vulnEffects.length).toBe(1);
    // The value should be from the second armorBreak (20%, not 12%)
    expect(vulnEffects[0]!.effect.properties.physVulnPercent).toBeCloseTo(20, 5);
    expect(vulnEffects[0]!.effect.duration).toBe(24);
  });

  it("armorBreak vuln does NOT affect magic damage", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000 });
    const engine = makeEngine([actor]);

    engine.getState().enemy.effects.add(
      new Effect({
        id: "PHYSICAL_VULNERABLE",
        tags: ["PHYSICAL_VULNERABLE"],
        duration: 30,
        startTime: 0,
        properties: { physVulnPercent: 16 },
      }),
    );

    const tags = buildDamageTags({
      sourceActorId: "A", targetEnemyId: "boss",
      damageType: "cold", damageSource: "activeSkill",
    });

    const result = resolver.resolve({
      source: actor, target: engine.getState().enemy, state: engine.getState(),
      multiplier: 1.0, damageTags: tags, critOverride: NO_CRIT,
    });

    // No physical vuln for magic damage → just defense 0.5
    expect(result.finalValue).toBe(500);
  });
});

// ===========================================================================
// 3-4. controlImmunities
// ===========================================================================

describe("Control Immunities", () => {
  it("freeze immune: freeze debuff retained, shatter still triggers", () => {
    const actorA = makeActor("A", { attack: 800 });
    const actorB = makeActor("B", { attack: 800 });
    const engine = makeEngine([actorA, actorB], {
      controlImmunities: { freeze: true },
    });

    // Apply freeze directly — debuff still applied despite immune
    engine.enqueue({
      type: "APPLY_DIRECT_ANOMALY",
      time: 0,
      payload: {
        anomalyType: "freeze" as any,
        level: 3 as AnomalyLevel,
        sourceActorId: "A",
        targetId: "boss",
      },
    });

    // Physical anomaly triggers shatter
    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY",
      time: 1,
      payload: { physicalType: "launch", sourceActorId: "B", targetId: "boss" },
    });

    engine.run();
    const log = engine.getSimLog();

    // Shatter damage should still occur
    const shatter = log.filter(
      (e) => e.type === "ANOMALY_DAMAGE" && e.payload.tags.damageSource === "shatter",
    );
    expect(shatter.length).toBe(1);
    if (shatter[0]?.type === "ANOMALY_DAMAGE") {
      expect(shatter[0].payload.damage).toBeGreaterThan(0);
    }
  });

  it("launch immune: damage still produced", () => {
    const engine = makeEngine([makeActor("A", { attack: 1000 })], {
      controlImmunities: { launch: true },
    });

    engine.getState().enemy.status.addBreakStack(0);

    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY",
      time: 1,
      payload: { physicalType: "launch", sourceActorId: "A", targetId: "boss" },
    });

    engine.run();
    const log = engine.getSimLog();

    // Physical anomaly damage should still be produced
    const physDmg = log.filter(
      (e) => e.type === "ANOMALY_DAMAGE" && e.payload.tags.damageSource === "physicalAnomaly",
    );
    expect(physDmg.length).toBeGreaterThan(0);
    if (physDmg[0]?.type === "ANOMALY_DAMAGE") {
      expect(physDmg[0].payload.damage).toBeGreaterThan(0);
    }
  });

  it("knockdown immune: damage still produced", () => {
    const engine = makeEngine([makeActor("A", { attack: 1000 })], {
      controlImmunities: { knockdown: true },
    });

    engine.getState().enemy.status.addBreakStack(0);

    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY",
      time: 1,
      payload: { physicalType: "knockdown", sourceActorId: "A", targetId: "boss" },
    });

    engine.run();
    const log = engine.getSimLog();

    const physDmg = log.filter(
      (e) => e.type === "ANOMALY_DAMAGE" && e.payload.tags.damageSource === "physicalAnomaly",
    );
    expect(physDmg.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 5. Auto-registration from ScenarioTrack
// ===========================================================================

describe("Auto-registration", () => {
  it("extractEquipmentConfigs builds configs from scenario tracks", () => {
    const scenario = {
      tracks: [
        {
          id: "ACTOR_A",
          actions: [],
          stats: createDefaultStats() as ActorStats,
          gaugeEfficiency: 100,
          originiumArtsPower: 0,
          linkCdReduction: 0,
          initialGauge: 0,
          weaponId: "wpn_claym_0004", // 典范
          equipArmorId: "item_equip_t4_suit_phy01_body_02",  // 点剑
          equipGlovesId: "item_equip_t4_suit_phy01_hand_01", // 点剑
          equipAccessory1Id: "item_equip_t4_suit_phy01_edc_03", // 点剑
        },
      ],
    };

    const equipDb = [
      { id: "item_equip_t4_suit_phy01_body_02", category: "点剑" },
      { id: "item_equip_t4_suit_phy01_hand_01", category: "点剑" },
      { id: "item_equip_t4_suit_phy01_edc_03", category: "点剑" },
    ];

    const configs = extractEquipmentConfigs(scenario as any, equipDb);

    expect(configs.length).toBe(1);
    expect(configs[0].actorId).toBe("ACTOR_A");
    expect(configs[0].setId).toBe("dianjian");
    expect(configs[0].weaponId).toBe("paradigm");
  });

  it("no set bonus when fewer than 3 items from same category", () => {
    const scenario = {
      tracks: [
        {
          id: "ACTOR_A",
          actions: [],
          stats: createDefaultStats() as ActorStats,
          gaugeEfficiency: 100,
          originiumArtsPower: 0,
          linkCdReduction: 0,
          initialGauge: 0,
          equipArmorId: "item_a",
          equipGlovesId: "item_b",
        },
      ],
    };

    const equipDb = [
      { id: "item_a", category: "点剑" },
      { id: "item_b", category: "动火用" },
    ];

    const configs = extractEquipmentConfigs(scenario as any, equipDb);

    // No set bonus (only 1 of each category)
    expect(configs.length).toBe(0);
  });
});

// ===========================================================================
// 7. Buff expiry cleanup
// ===========================================================================

describe("Buff Expiry Cleanup", () => {
  it("sweepExpired removes expired effects from EffectManager", () => {
    const engine = makeEngine();
    const actor = engine.getState().getActor("A");

    // Add a buff that expires at t=5
    addOrRefreshBuff(
      actor.effects,
      new Effect({
        id: "temp_buff", tags: [], duration: 5, startTime: 0,
        properties: { dynamicBonuses: [{ stat: "blaze_dmg", value: 50 }] as DynamicBonus[] },
      }),
    );

    expect(actor.effects.getAll().length).toBe(1);

    // Advance past expiry
    engine.getState().advanceTime(6);

    // Buff should have been swept by ActorState.advanceTime → sweepExpired
    expect(actor.effects.getAll().length).toBe(0);
  });

  it("infinite-duration effects are NOT swept", () => {
    const engine = makeEngine();
    const actor = engine.getState().getActor("A");

    addOrRefreshBuff(
      actor.effects,
      new Effect({ id: "permanent", tags: [], duration: Infinity, startTime: 0, }),
    );

    engine.getState().advanceTime(99999);

    expect(actor.effects.getAll().length).toBe(1);
  });

  it("enemy effects are also swept on advanceTime", () => {
    const engine = makeEngine();

    engine.getState().enemy.effects.add(
      new Effect({
        id: "PHYSICAL_VULNERABLE",
        tags: ["PHYSICAL_VULNERABLE"],
        duration: 10,
        startTime: 0,
        properties: { physVulnPercent: 16 },
      }),
    );

    expect(engine.getState().enemy.effects.hasTag("PHYSICAL_VULNERABLE")).toBe(true);

    engine.getState().advanceTime(11);

    expect(engine.getState().enemy.effects.hasTag("PHYSICAL_VULNERABLE")).toBe(false);
  });
});
