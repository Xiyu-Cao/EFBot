/**
 * Phase 6 comprehensive tests — formula alignment, enemy template,
 * zone completion, attack bonus path, no double-counting.
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
import {
  spellLevelCoef,
  physLevelCoef,
  artsPowerDamageMult,
  artsPowerDebuffMult,
  getMagicBurstMultiplier,
  getAnomalyDirectMultiplier,
  getBurnTickMultiplier,
  getShatterMultiplier,
  getPhysicalAnomalyMultiplier,
  calcConductionDebuff,
  calcCorrosionDebuff,
} from "./anomalyDamageCalc";
import { Effect } from "../effects/types";
import {
  addOrRefreshBuff,
  type DynamicBonus,
} from "../equipment/types";
import type { AnomalyLevel } from "../anomaly/types";
import {
  registerDonghuoyongSet,
  registerParadigmWeapon,
  registerChaoyongSet,
} from "../equipment/definitions";

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
// 1. Anomaly formula alignment with confirmed truth
// ===========================================================================

describe("Anomaly Formula Alignment", () => {
  it("spellLevelCoef at level 90 matches (90-1)/196+1", () => {
    expect(spellLevelCoef(90)).toBeCloseTo(89 / 196 + 1, 10);
  });

  it("physLevelCoef at level 90 matches 1+(90-1)/392", () => {
    expect(physLevelCoef(90)).toBeCloseTo(1 + 89 / 392, 10);
  });

  it("artsPowerDamageMult: 1 + p * 0.01", () => {
    expect(artsPowerDamageMult(0)).toBe(1);
    expect(artsPowerDamageMult(50)).toBeCloseTo(1.5, 10);
    expect(artsPowerDamageMult(100)).toBeCloseTo(2, 10);
  });

  it("magic burst = 1.6 * spellLevelCoef * artsPowerDamageMult", () => {
    const ap = 50;
    const expected = 1.6 * spellLevelCoef(90) * artsPowerDamageMult(ap);
    expect(getMagicBurstMultiplier(ap, 90)).toBeCloseTo(expected, 10);
  });

  it("anomaly direct = 0.8 * (1+level) * spellLevelCoef * artsPowerDamageMult", () => {
    const level = 3 as AnomalyLevel;
    const ap = 30;
    const expected = 0.8 * (1 + level) * spellLevelCoef(90) * artsPowerDamageMult(ap);
    expect(getAnomalyDirectMultiplier(level, ap, 90)).toBeCloseTo(expected, 10);
  });

  it("burn tick = 0.12 * (1+level) * spellLevelCoef * artsPowerDamageMult", () => {
    const level = 2 as AnomalyLevel;
    const ap = 40;
    const expected = 0.12 * (1 + level) * spellLevelCoef(90) * artsPowerDamageMult(ap);
    expect(getBurnTickMultiplier(level, ap, 90)).toBeCloseTo(expected, 10);
  });

  it("shatter = 1.2 * (1+level) * spellLevelCoef * artsPowerDamageMult", () => {
    const level = 3 as AnomalyLevel;
    const ap = 60;
    const expected = 1.2 * (1 + level) * spellLevelCoef(90) * artsPowerDamageMult(ap);
    expect(getShatterMultiplier(level, ap, 90)).toBeCloseTo(expected, 10);
  });

  it("lift/knockdown = 1.2 * physLevelCoef * artsPowerDamageMult", () => {
    const ap = 50;
    const expected = 1.2 * physLevelCoef(90) * artsPowerDamageMult(ap);
    expect(getPhysicalAnomalyMultiplier("launch", ap)).toBeCloseTo(expected, 10);
    expect(getPhysicalAnomalyMultiplier("knockdown", ap)).toBeCloseTo(expected, 10);
  });

  it("slam = 1.5 * (1+stacks) * physLevelCoef * artsPowerDamageMult", () => {
    const ap = 30;
    const stacks = 3;
    const expected = 1.5 * (1 + stacks) * physLevelCoef(90) * artsPowerDamageMult(ap);
    expect(getPhysicalAnomalyMultiplier("slam", ap, stacks)).toBeCloseTo(expected, 10);
  });

  it("breach = 0.5 * (1+stacks) * physLevelCoef * artsPowerDamageMult", () => {
    const ap = 20;
    const stacks = 2;
    const expected = 0.5 * (1 + stacks) * physLevelCoef(90) * artsPowerDamageMult(ap);
    expect(getPhysicalAnomalyMultiplier("armorBreak", ap, stacks)).toBeCloseTo(expected, 10);
  });
});

// ===========================================================================
// 2-3. artsPowerDamageMult and artsPowerDebuffMult
// ===========================================================================

describe("Arts Power Multipliers", () => {
  it("artsPowerDamageMult affects burst multiplier", () => {
    const burstNoAp = getMagicBurstMultiplier(0);
    const burstWithAp = getMagicBurstMultiplier(100);
    // With 100 artsPower: artsPowerDamageMult = 2.0, so burst should be ~2x
    expect(burstWithAp / burstNoAp).toBeCloseTo(2.0, 5);
  });

  it("artsPowerDebuffMult: 1 + 2p/(300+p)", () => {
    expect(artsPowerDebuffMult(0)).toBe(1);
    expect(artsPowerDebuffMult(300)).toBeCloseTo(1 + 600 / 600, 10); // = 2.0
    expect(artsPowerDebuffMult(100)).toBeCloseTo(1 + 200 / 400, 10); // = 1.5
  });

  it("conduction vulnerability scales with artsPowerDebuffMult", () => {
    const noAp = calcConductionDebuff(3, 0);
    const withAp = calcConductionDebuff(3, 100);
    // level 3: (3+2)*4 = 20 base. With 100 ap: 20 * 1.5 = 30
    expect(noAp.spellVulnerability).toBe(20);
    expect(withAp.spellVulnerability).toBeCloseTo(30, 5);
  });

  it("corrosion params scale with artsPowerDebuffMult", () => {
    const noAp = calcCorrosionDebuff(2, 0);
    const withAp = calcCorrosionDebuff(2, 300);
    // With 300 ap: debuffMult = 2.0
    expect(withAp.maxValue).toBeCloseTo(noAp.maxValue * 2, 5);
    expect(withAp.perSecond).toBeCloseTo(noAp.perSecond * 2, 5);
  });
});

// ===========================================================================
// 4. No static double-counting
// ===========================================================================

describe("No Static Double-Counting", () => {
  it("registration does not mutate actor stats", () => {
    const actor = makeActor("A", {
      originium_arts_power: 40,
      physical_dmg: 38,
      all_skill_dmg_bonus: 30,
    });
    const engine = makeEngine([actor]);

    // Register all sets/weapons — none should modify stats
    registerDonghuoyongSet(engine, "A");
    registerParadigmWeapon(engine, "A");
    registerChaoyongSet(engine, "A");

    const s = engine.getState().getActor("A").snapshotData.stats;
    expect(s.originium_arts_power).toBe(40);
    expect(s.physical_dmg).toBe(38);
    expect(s.all_skill_dmg_bonus).toBe(30);
  });
});

// ===========================================================================
// 6. allDamage affects all sources
// ===========================================================================

describe("All Damage (造成的伤害增加)", () => {
  it("all_dmg dynamic bonus applies to physical skill damage", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000 });
    const engine = makeEngine([actor]);

    const actorState = engine.getState().getActor("A");
    addOrRefreshBuff(
      actorState.effects,
      new Effect({
        id: "all_dmg_buff",
        tags: [],
        duration: 30,
        startTime: 0,
        properties: {
          dynamicBonuses: [{ stat: "all_dmg", value: 20 }] as DynamicBonus[],
        },
      }),
    );

    const tags = buildDamageTags({
      sourceActorId: "A",
      targetEnemyId: "boss",
      damageType: "physical",
      damageSource: "activeSkill",
    });

    const ctx: DamageContext = {
      source: actor,
      target: engine.getState().enemy,
      state: engine.getState(),
      multiplier: 1.0,
      damageTags: tags,
      critOverride: NO_CRIT,
    };

    const result = resolver.resolve(ctx);
    // ATK=1000, defense=0.5, dmgBonus = 1 + 20/100 = 1.20
    // Final = 1000 * 0.5 * 1.20 = 600
    expect(result.finalValue).toBe(600);
  });

  it("all_dmg also applies to anomaly damage (burnTick)", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000 });
    const engine = makeEngine([actor]);

    const actorState = engine.getState().getActor("A");
    addOrRefreshBuff(
      actorState.effects,
      new Effect({
        id: "all_dmg_buff",
        tags: [],
        duration: 30,
        startTime: 0,
        properties: {
          dynamicBonuses: [{ stat: "all_dmg", value: 20 }] as DynamicBonus[],
        },
      }),
    );

    const tags = buildDamageTags({
      sourceActorId: "A",
      targetEnemyId: "boss",
      damageType: "burn",
      damageSource: "burnTick",
    });

    const ctx: DamageContext = {
      source: actor,
      target: engine.getState().enemy,
      state: engine.getState(),
      multiplier: 1.0,
      damageTags: tags,
      critOverride: NO_CRIT,
    };

    const result = resolver.resolve(ctx);
    // Same: 1000 * 0.5 * 1.20 = 600
    expect(result.finalValue).toBe(600);
  });
});

// ===========================================================================
// 7. Amplification / Combo / Fragility zones
// ===========================================================================

describe("Amplify / Combo / Fragility Zones", () => {
  it("amplify zone buff multiplies damage independently from dmgBonus", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000 });
    const engine = makeEngine([actor]);

    const actorState = engine.getState().getActor("A");
    addOrRefreshBuff(
      actorState.effects,
      new Effect({
        id: "arts_amplify",
        tags: [],
        duration: 30,
        startTime: 0,
        properties: {
          dynamicBonuses: [
            { stat: "all_dmg", value: 30, zone: "amplify" },
          ] as DynamicBonus[],
        },
      }),
    );

    const tags = buildDamageTags({
      sourceActorId: "A",
      targetEnemyId: "boss",
      damageType: "cold",
      damageSource: "activeSkill",
    });

    const ctx: DamageContext = {
      source: actor,
      target: engine.getState().enemy,
      state: engine.getState(),
      multiplier: 1.0,
      damageTags: tags,
      critOverride: NO_CRIT,
    };

    const result = resolver.resolve(ctx);
    // ATK=1000, defense=0.5, amplify=1+30/100=1.30
    // Final = 1000 * 0.5 * 1.30 = 650
    expect(result.finalValue).toBe(650);
  });

  it("combo zone buff works", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000 });
    const engine = makeEngine([actor]);

    const actorState = engine.getState().getActor("A");
    addOrRefreshBuff(
      actorState.effects,
      new Effect({
        id: "combo_buff",
        tags: [],
        duration: 30,
        startTime: 0,
        properties: {
          dynamicBonuses: [
            { stat: "all_dmg", value: 20, zone: "combo" },
          ] as DynamicBonus[],
        },
      }),
    );

    const tags = buildDamageTags({
      sourceActorId: "A",
      targetEnemyId: "boss",
      damageType: "physical",
      damageSource: "activeSkill",
    });

    const ctx: DamageContext = {
      source: actor,
      target: engine.getState().enemy,
      state: engine.getState(),
      multiplier: 1.0,
      damageTags: tags,
      critOverride: NO_CRIT,
    };

    const result = resolver.resolve(ctx);
    // 1000 * 0.5 * 1.20 = 600
    expect(result.finalValue).toBe(600);
  });

  it("fragility zone: magic fragility applies to magic damage, not physical", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000 });
    const engine = makeEngine([actor]);

    const actorState = engine.getState().getActor("A");
    addOrRefreshBuff(
      actorState.effects,
      new Effect({
        id: "magic_fragility",
        tags: [],
        duration: 30,
        startTime: 0,
        properties: {
          dynamicBonuses: [
            { stat: "arts_dmg", value: 25, zone: "fragility" },
          ] as DynamicBonus[],
        },
      }),
    );

    // Magic damage — should get fragility
    const magicTags = buildDamageTags({
      sourceActorId: "A", targetEnemyId: "boss",
      damageType: "cold", damageSource: "activeSkill",
    });
    const magicResult = resolver.resolve({
      source: actor, target: engine.getState().enemy, state: engine.getState(),
      multiplier: 1.0, damageTags: magicTags, critOverride: NO_CRIT,
    });
    // 1000 * 0.5 * (1 + 25/100) = 625
    expect(magicResult.finalValue).toBe(625);

    // Physical damage — should NOT get magic fragility
    const physTags = buildDamageTags({
      sourceActorId: "A", targetEnemyId: "boss",
      damageType: "physical", damageSource: "activeSkill",
    });
    const physResult = resolver.resolve({
      source: actor, target: engine.getState().enemy, state: engine.getState(),
      multiplier: 1.0, damageTags: physTags, critOverride: NO_CRIT,
    });
    // 1000 * 0.5 = 500 (no fragility)
    expect(physResult.finalValue).toBe(500);
  });

  it("elemental fragility + school fragility stack on same instance", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000 });
    const engine = makeEngine([actor]);

    const actorState = engine.getState().getActor("A");
    // School fragility: +20% for magic
    addOrRefreshBuff(
      actorState.effects,
      new Effect({
        id: "school_fragility",
        tags: [],
        duration: 30,
        startTime: 0,
        properties: {
          dynamicBonuses: [
            { stat: "arts_dmg", value: 20, zone: "fragility" },
          ] as DynamicBonus[],
        },
      }),
    );
    // Elemental fragility: +15% for cold
    actorState.effects.add(
      new Effect({
        id: "cold_fragility",
        tags: [],
        duration: 30,
        startTime: 0,
        properties: {
          dynamicBonuses: [
            { stat: "cold_dmg", value: 15, zone: "fragility" },
          ] as DynamicBonus[],
        },
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
    // Fragility zone: 1 + (20 + 15)/100 = 1.35
    // Final = 1000 * 0.5 * 1.35 = 675
    expect(result.finalValue).toBe(675);
  });
});

// ===========================================================================
// 9. Boss template: defense / resist
// ===========================================================================

describe("Boss Template", () => {
  it("defenseMultiplier affects damage", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000 });
    const engine = makeEngine([actor], { defenseMultiplier: 0.3 });

    const tags = buildDamageTags({
      sourceActorId: "A", targetEnemyId: "boss",
      damageType: "physical", damageSource: "activeSkill",
    });
    const result = resolver.resolve({
      source: actor, target: engine.getState().enemy, state: engine.getState(),
      multiplier: 1.0, damageTags: tags, critOverride: NO_CRIT,
    });
    // 1000 * 0.3 = 300
    expect(result.finalValue).toBe(300);
  });

  it("baseMagicResist reduces magic damage", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000 });
    const engine = makeEngine([actor], { baseMagicResist: 20 });

    const tags = buildDamageTags({
      sourceActorId: "A", targetEnemyId: "boss",
      damageType: "burn", damageSource: "activeSkill",
    });
    const result = resolver.resolve({
      source: actor, target: engine.getState().enemy, state: engine.getState(),
      multiplier: 1.0, damageTags: tags, critOverride: NO_CRIT,
    });
    // defense=0.5, resist = 1 + 0 - 20*0.01 = 0.80
    // 1000 * 0.5 * 0.80 = 400
    expect(result.finalValue).toBe(400);
  });

  it("basePhysicalResist reduces physical damage but not magic", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000 });
    const engine = makeEngine([actor], { basePhysicalResist: 15 });

    const physTags = buildDamageTags({
      sourceActorId: "A", targetEnemyId: "boss",
      damageType: "physical", damageSource: "activeSkill",
    });
    const physResult = resolver.resolve({
      source: actor, target: engine.getState().enemy, state: engine.getState(),
      multiplier: 1.0, damageTags: physTags, critOverride: NO_CRIT,
    });
    // resist = 1 - 15*0.01 = 0.85. 1000 * 0.5 * 0.85 = 425
    expect(physResult.finalValue).toBe(425);

    // Magic should NOT be affected by physical resist
    const magicTags = buildDamageTags({
      sourceActorId: "A", targetEnemyId: "boss",
      damageType: "cold", damageSource: "activeSkill",
    });
    const magicResult = resolver.resolve({
      source: actor, target: engine.getState().enemy, state: engine.getState(),
      multiplier: 1.0, damageTags: magicTags, critOverride: NO_CRIT,
    });
    // Magic resist = 0 by default. 1000 * 0.5 = 500
    expect(magicResult.finalValue).toBe(500);
  });
});

// ===========================================================================
// 10-11. Control immunities
// ===========================================================================

describe("Control Immunities", () => {
  it("freeze control immune: shatter still triggers", () => {
    const actorA = makeActor("A", { attack: 800 });
    const actorB = makeActor("B", { attack: 800 });
    const engine = makeEngine([actorA, actorB], {
      controlImmunities: { freeze: true },
    });

    // Apply freeze directly (debuff still applied despite immune)
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

    // Physical anomaly triggers shatter (because freeze debuff exists)
    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY",
      time: 1,
      payload: {
        physicalType: "launch",
        sourceActorId: "B",
        targetId: "boss",
      },
    });

    engine.run();
    const log = engine.getSimLog();

    // Shatter damage should still occur
    const shatterEntries = log.filter(
      (e) =>
        e.type === "ANOMALY_DAMAGE" &&
        e.payload.tags.damageSource === "shatter",
    );
    expect(shatterEntries.length).toBe(1);
    if (shatterEntries[0]?.type === "ANOMALY_DAMAGE") {
      expect(shatterEntries[0].payload.damage).toBeGreaterThan(0);
    }
  });

  // NOTE: launch/knockdown control immunity blocking the CONTROL effect
  // (not the damage) requires changes to PhysicalReactionResolver,
  // which is out of scope for this phase. The structure is in place
  // via EnemyConfig.controlImmunities. TODO in next phase.
});

// ===========================================================================
// 12. percentBonus attack path
// ===========================================================================

describe("Attack Formula percentBonus", () => {
  it("percentBonus from dynamic buff increases ATK", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000 });
    const engine = makeEngine([actor]);

    const actorState = engine.getState().getActor("A");
    addOrRefreshBuff(
      actorState.effects,
      new Effect({
        id: "atk_pct_buff",
        tags: [],
        duration: 30,
        startTime: 0,
        properties: {
          dynamicBonuses: [
            { stat: "all_dmg", value: 19.6, zone: "attackPercent" },
          ] as DynamicBonus[],
        },
      }),
    );

    const tags = buildDamageTags({
      sourceActorId: "A", targetEnemyId: "boss",
      damageType: "physical", damageSource: "activeSkill",
    });

    const ctx: DamageContext = {
      source: actor,
      target: engine.getState().enemy,
      state: engine.getState(),
      multiplier: 1.0,
      damageTags: tags,
      critOverride: NO_CRIT,
    };

    const result = resolver.resolve(ctx);
    // ATK = floor(1000 * (1 + 0.196)) = floor(1196) = 1196
    // defense = 0.5 → final = floor(1196 * 0.5) = 598
    expect(result.finalValue).toBe(598);
  });

  it("flatBonus from dynamic buff increases ATK", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000 });
    const engine = makeEngine([actor]);

    const actorState = engine.getState().getActor("A");
    addOrRefreshBuff(
      actorState.effects,
      new Effect({
        id: "atk_flat_buff",
        tags: [],
        duration: 30,
        startTime: 0,
        properties: {
          dynamicBonuses: [
            { stat: "all_dmg", value: 200, zone: "attackFlat" },
          ] as DynamicBonus[],
        },
      }),
    );

    const tags = buildDamageTags({
      sourceActorId: "A", targetEnemyId: "boss",
      damageType: "physical", damageSource: "activeSkill",
    });

    const ctx: DamageContext = {
      source: actor,
      target: engine.getState().enemy,
      state: engine.getState(),
      multiplier: 1.0,
      damageTags: tags,
      critOverride: NO_CRIT,
    };

    const result = resolver.resolve(ctx);
    // ATK = floor((1000 * 1.0 + 200) * 1.0) = 1200
    // defense = 0.5 → final = floor(1200 * 0.5) = 600
    expect(result.finalValue).toBe(600);
  });
});
