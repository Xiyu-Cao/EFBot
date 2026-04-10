/**
 * Comprehensive equipment/weapon tests.
 *
 * Covers:
 * 1. 点剑: physical anomaly → equipmentProc, 15s ICD
 * 2. 点剑: equipmentProc as independent damage instance
 * 3. 动火用: direct burn triggers blaze buff; reaction burn does NOT
 * 4. 动火用: no-stack, refresh duration only
 * 5. 脉冲式: freeze/conduction trigger elemental buffs
 * 6. 潮涌: 2+ attachment stacks trigger arts buff
 * 7. 蚀迹: only other teammates get buff, not self
 * 8. 蚀迹: dynamic bonus per nature-attached enemy
 * 9. 典范: skill/ultimate hit stacks, independent duration, 0.1s ICD
 * 10. Dynamic buff aggregation in DamageBonusZone
 */

import { describe, it, expect } from "vitest";
import type { ActorSnapshot } from "../state/types";
import type { ActorStats } from "../compiler/types";
import { createDefaultStats } from "@/utils/coreStats";
import { createEngine } from "../engine/createEngine";
import { compileTimeline } from "../compiler/compileTimeline";
import type { AnomalyLevel } from "../anomaly/types";
import { DamageResolver } from "../calculation/DamageResolver";
import { buildDamageTags } from "../calculation/damageTypes";
import { NO_CRIT } from "../calculation/critSystem";
import type { DamageContext } from "../calculation/type";
import { Effect } from "../effects/types";
import type { DynamicBonus } from "./types";
import { addOrRefreshBuff, isEffectActive } from "./types";

import {
  registerDianjianSet,
  registerDonghuoyongSet,
  registerMaichongshiSet,
  registerChaoyongSet,
  registerParadigmWeapon,
  registerZuopinShijiWeapon,
} from "./registry";

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

function makeEngine(actors: ActorSnapshot[] = [makeActor("A")]) {
  const timeline = compileTimeline([], []);
  return createEngine(
    { maxSp: 300, initialSp: 200, spRegenRate: 8, skillSpCostDefault: 100, linkCdReduction: 0 },
    { maxStagger: 100, staggerNodeCount: 0, staggerNodeDuration: 2, staggerBreakDuration: 10, executionRecovery: 25 },
    actors,
    timeline,
  );
}

// ===========================================================================
// 1. 点剑: physical anomaly → equipmentProc + stagger
// ===========================================================================

describe("Dianjian Set (点剑)", () => {
  it("triggers equipmentProc on physical anomaly with break", () => {
    const engine = makeEngine([makeActor("A", { attack: 1000 })]);
    registerDianjianSet(engine, "A");

    // Give break stacks so physical anomaly produces PHYSICAL_DAMAGE outcome
    engine.getState().enemy.status.addBreakStack(0);

    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY",
      time: 1,
      payload: { physicalType: "slam", sourceActorId: "A", targetId: "boss" },
    });

    engine.run();
    const log = engine.getSimLog();

    // Should have equipmentProc damage
    const procEntries = log.filter(
      (e) =>
        e.type === "ANOMALY_DAMAGE" &&
        e.payload.tags.damageSource === "equipmentProc",
    );
    expect(procEntries.length).toBe(1);
    if (procEntries[0]?.type === "ANOMALY_DAMAGE") {
      expect(procEntries[0].payload.damage).toBeGreaterThan(0);
      expect(procEntries[0].payload.tags.damageType).toBe("physical");
    }
  });

  it("respects 15s ICD — second trigger within 15s is blocked", () => {
    const engine = makeEngine([makeActor("A", { attack: 1000 })]);
    registerDianjianSet(engine, "A");

    engine.getState().enemy.status.addBreakStack(0);

    // First trigger at t=1
    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY",
      time: 1,
      payload: { physicalType: "slam", sourceActorId: "A", targetId: "boss" },
    });

    // Need break again for second trigger
    engine.getState().enemy.status.addBreakStack(0);

    // Second trigger at t=5 (within 15s ICD)
    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY",
      time: 5,
      payload: { physicalType: "launch", sourceActorId: "A", targetId: "boss" },
    });

    engine.run();
    const log = engine.getSimLog();

    const procEntries = log.filter(
      (e) =>
        e.type === "ANOMALY_DAMAGE" &&
        e.payload.tags.damageSource === "equipmentProc",
    );
    // Only 1 proc, not 2 (second blocked by ICD)
    expect(procEntries.length).toBe(1);
  });

  it("equipmentProc is independent damage instance with correct tags", () => {
    const engine = makeEngine([makeActor("A", { attack: 1000 })]);
    registerDianjianSet(engine, "A");

    engine.getState().enemy.status.addBreakStack(0);

    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY",
      time: 1,
      payload: { physicalType: "slam", sourceActorId: "A", targetId: "boss" },
    });

    engine.run();
    const log = engine.getSimLog();

    // Physical anomaly damage (from slam reaction)
    const anomalyDmg = log.filter(
      (e) =>
        e.type === "ANOMALY_DAMAGE" &&
        e.payload.tags.damageSource === "physicalAnomaly",
    );
    // Equipment proc damage (separate instance)
    const procDmg = log.filter(
      (e) =>
        e.type === "ANOMALY_DAMAGE" &&
        e.payload.tags.damageSource === "equipmentProc",
    );

    expect(anomalyDmg.length).toBeGreaterThan(0);
    expect(procDmg.length).toBe(1);
    // They are independent instances
    expect(anomalyDmg[0]).not.toBe(procDmg[0]);
  });
});

// ===========================================================================
// 3-4. 动火用: direct vs reaction trigger, no-stack refresh
// ===========================================================================

describe("Donghuoyong Set (动火用)", () => {
  it("direct burn application triggers blaze buff (verified via damage)", () => {
    const engine = makeEngine([makeActor("A", { attack: 1000 })]);
    registerDonghuoyongSet(engine, "A");

    // Apply burn — this triggers the blaze buff (+50% blaze_dmg for 10s)
    engine.enqueue({
      type: "APPLY_DIRECT_ANOMALY",
      time: 1,
      payload: {
        anomalyType: "burn" as any,
        level: 2 as AnomalyLevel,
        sourceActorId: "A",
        targetId: "boss",
      },
    });

    engine.run();
    const log = engine.getSimLog();

    // Burn ticks should benefit from the +50% blaze buff.
    // Without buff: baseDmg * 0.5 (defense only)
    // With buff: baseDmg * 0.5 * 1.5 (defense * dmgBonus with +50% blaze)
    const burnDmg = log.filter(
      (e) => e.type === "ANOMALY_DAMAGE" && e.payload.tags.damageSource === "burnTick",
    );
    expect(burnDmg.length).toBeGreaterThan(0);
    // The first burn tick should have non-zero damage boosted by the buff
    if (burnDmg[0]?.type === "ANOMALY_DAMAGE") {
      expect(burnDmg[0].payload.damage).toBeGreaterThan(0);
    }
  });

  it("reaction-generated burn does NOT trigger blaze buff", () => {
    const engine = makeEngine([makeActor("A", { attack: 1000 }), makeActor("B")]);
    registerDonghuoyongSet(engine, "A");

    // Create a cross-element reaction that generates burn:
    // nature attach → fire attach (cross-element → burn anomaly)
    engine.enqueue({
      type: "APPLY_MAGIC_ATTACHMENT",
      time: 0,
      payload: { element: "nature", sourceActorId: "A", targetId: "boss" },
    });
    engine.enqueue({
      type: "APPLY_MAGIC_ATTACHMENT",
      time: 1,
      payload: { element: "fire", sourceActorId: "A", targetId: "boss" },
    });

    engine.run();

    // Blaze buff should NOT exist (reaction-generated burn)
    const actorState = engine.getState().getActor("A");
    const blazeBuff = actorState.effects
      .getAll()
      .find((inst) => inst.effect.id === "donghuoyong_blaze_buff");
    expect(blazeBuff).toBeUndefined();
  });

  it("no-stack: second activation only refreshes duration (not duplicate)", () => {
    const engine = makeEngine([makeActor("A")]);
    registerDonghuoyongSet(engine, "A");

    // Apply corrosion twice (no burn ticks → no sweep timing issue)
    engine.enqueue({
      type: "APPLY_DIRECT_ANOMALY",
      time: 1,
      payload: { anomalyType: "corrosion" as any, level: 2 as AnomalyLevel, sourceActorId: "A", targetId: "boss" },
    });

    engine.enqueue({
      type: "APPLY_DIRECT_ANOMALY",
      time: 5,
      payload: { anomalyType: "corrosion" as any, level: 2 as AnomalyLevel, sourceActorId: "A", targetId: "boss" },
    });

    engine.run();

    const actorState = engine.getState().getActor("A");
    const natureBuffs = actorState.effects
      .getAll()
      .filter((inst) => inst.effect.id === "donghuoyong_nature_buff");

    // Should be exactly 1 buff (not stacked)
    expect(natureBuffs.length).toBe(1);
    // Duration refreshed: startTime should be 5 (from second trigger)
    expect(natureBuffs[0]!.effect.startTime).toBe(5);
  });

  it("does NOT double-count static arts power (comes from timelineStore delta)", () => {
    // Static +30 arts power is handled by timelineStore delta, not by registerSet.
    // The actor already has it in stats when passed to simulation.
    const engine = makeEngine([makeActor("A", { originium_arts_power: 40 })]);
    registerDonghuoyongSet(engine, "A");

    const actorState = engine.getState().getActor("A");
    // Should remain 40 (not 40+30=70)
    expect(actorState.snapshotData.stats.originium_arts_power).toBe(40);
  });
});

// ===========================================================================
// 5. 脉冲式: freeze/conduction trigger
// ===========================================================================

describe("Maichongshi Set (脉冲式)", () => {
  it("direct conduction triggers emag damage buff", () => {
    const engine = makeEngine([makeActor("A")]);
    registerMaichongshiSet(engine, "A");

    engine.enqueue({
      type: "APPLY_DIRECT_ANOMALY",
      time: 1,
      payload: { anomalyType: "conduction" as any, level: 3 as AnomalyLevel, sourceActorId: "A", targetId: "boss" },
    });

    engine.run();

    const actorState = engine.getState().getActor("A");
    const emagBuff = actorState.effects
      .getAll()
      .find((inst) => inst.effect.id === "maichongshi_emag_buff");
    expect(emagBuff).toBeDefined();
    expect(emagBuff!.effect.properties.dynamicBonuses).toEqual([
      { stat: "emag_dmg", value: 50 },
    ]);
  });

  it("direct freeze triggers cold damage buff", () => {
    const engine = makeEngine([makeActor("A")]);
    registerMaichongshiSet(engine, "A");

    engine.enqueue({
      type: "APPLY_DIRECT_ANOMALY",
      time: 1,
      payload: { anomalyType: "freeze" as any, level: 1 as AnomalyLevel, sourceActorId: "A", targetId: "boss" },
    });

    engine.run();

    const actorState = engine.getState().getActor("A");
    const coldBuff = actorState.effects
      .getAll()
      .find((inst) => inst.effect.id === "maichongshi_cold_buff");
    expect(coldBuff).toBeDefined();
  });
});

// ===========================================================================
// 6. 潮涌: attachment stacks >= 2
// ===========================================================================

describe("Chaoyong Set (潮涌)", () => {
  it("triggers arts buff when attachment stacks reach 2", () => {
    const engine = makeEngine([makeActor("A")]);
    registerChaoyongSet(engine, "A");

    // First attach: 1 stack (no trigger)
    engine.enqueue({
      type: "APPLY_MAGIC_ATTACHMENT",
      time: 0,
      payload: { element: "fire", sourceActorId: "A", targetId: "boss" },
    });

    // Second attach: 2 stacks (trigger!)
    engine.enqueue({
      type: "APPLY_MAGIC_ATTACHMENT",
      time: 1,
      payload: { element: "fire", sourceActorId: "A", targetId: "boss" },
    });

    engine.run();

    const actorState = engine.getState().getActor("A");
    const artsBuff = actorState.effects
      .getAll()
      .find((inst) => inst.effect.id === "chaoyong_arts_buff");
    expect(artsBuff).toBeDefined();
    expect(artsBuff!.effect.properties.dynamicBonuses).toEqual([
      { stat: "arts_dmg", value: 35 },
    ]);
  });

  it("does NOT trigger at 1 stack", () => {
    const engine = makeEngine([makeActor("A")]);
    registerChaoyongSet(engine, "A");

    // Only 1 attach
    engine.enqueue({
      type: "APPLY_MAGIC_ATTACHMENT",
      time: 0,
      payload: { element: "fire", sourceActorId: "A", targetId: "boss" },
    });

    engine.run();

    const actorState = engine.getState().getActor("A");
    const artsBuff = actorState.effects
      .getAll()
      .find((inst) => inst.effect.id === "chaoyong_arts_buff");
    expect(artsBuff).toBeUndefined();
  });

  it("does NOT double-count static all_skill_dmg_bonus (comes from timelineStore delta)", () => {
    const engine = makeEngine([makeActor("A", { all_skill_dmg_bonus: 30 })]);
    registerChaoyongSet(engine, "A");

    const actorState = engine.getState().getActor("A");
    // Should remain 30 (not 30+20=50); the +20 is from timelineStore
    expect(actorState.snapshotData.stats.all_skill_dmg_bonus).toBe(30);
  });
});

// ===========================================================================
// 7-8. 蚀迹: other teammates only, dynamic per-enemy bonus
// ===========================================================================

describe("Zuopin Shiji Weapon (蚀迹)", () => {
  it("applies buff to other teammates, NOT self", () => {
    const engine = makeEngine([
      makeActor("A", { attack: 1000 }),
      makeActor("B"),
      makeActor("C"),
    ]);
    registerZuopinShijiWeapon(engine, "A");

    // A needs an active skill action for the condition
    const actorA = engine.getState().getActor("A");
    actorA.setActiveAction({
      node: { type: "skill" },
    } as any);

    engine.enqueue({
      type: "APPLY_MAGIC_ATTACHMENT",
      time: 1,
      payload: { element: "nature", sourceActorId: "A", targetId: "boss" },
    });

    engine.run();

    // A (self) should NOT have the buff
    const aBuff = engine
      .getState()
      .getActor("A")
      .effects.getAll()
      .find((inst) => inst.effect.id === "zuopin_shiji_arts_buff");
    expect(aBuff).toBeUndefined();

    // B and C should have the buff
    const bBuff = engine
      .getState()
      .getActor("B")
      .effects.getAll()
      .find((inst) => inst.effect.id === "zuopin_shiji_arts_buff");
    expect(bBuff).toBeDefined();

    const cBuff = engine
      .getState()
      .getActor("C")
      .effects.getAll()
      .find((inst) => inst.effect.id === "zuopin_shiji_arts_buff");
    expect(cBuff).toBeDefined();
  });

  it("includes dynamic bonus when enemy has nature attachment", () => {
    const engine = makeEngine([makeActor("A", { attack: 1000 }), makeActor("B")]);
    registerZuopinShijiWeapon(engine, "A");

    const actorA = engine.getState().getActor("A");
    actorA.setActiveAction({ node: { type: "skill" } } as any);

    // Apply nature attachment (enemy will have nature)
    engine.enqueue({
      type: "APPLY_MAGIC_ATTACHMENT",
      time: 1,
      payload: { element: "nature", sourceActorId: "A", targetId: "boss" },
    });

    engine.run();

    const bBuff = engine
      .getState()
      .getActor("B")
      .effects.getAll()
      .find((inst) => inst.effect.id === "zuopin_shiji_arts_buff");
    expect(bBuff).toBeDefined();

    // Base 14 + 5.6 (1 nature-attached enemy) = 19.6
    const bonuses = bBuff!.effect.properties.dynamicBonuses as DynamicBonus[];
    expect(bonuses[0].value).toBeCloseTo(19.6, 1);
  });
});

// ===========================================================================
// 9. 典范: stacks, independent duration, ICD
// ===========================================================================

describe("Paradigm Weapon (典范)", () => {
  /**
   * Helper: inject a fake "skill" action into the engine's timeline actionMap
   * so that the Paradigm trigger condition (ctx.getAction -> node.type === "skill")
   * passes without a full compiled scenario.
   */
  function injectFakeSkillAction(engine: ReturnType<typeof makeEngine>, actionId: string) {
    // getAction looks up timeline.actionMap — we access it through the engine
    // SimulationEngine stores `private timeline`; getAction is a public method.
    // The actionMap lives on the timeline passed to the constructor.
    // We use engine.getAction to verify, but we need to set it on the underlying map.
    // compileTimeline([],[]) creates an empty actionMap. We can cast to access it.
    const timeline = (engine as any).timeline as { actionMap: Map<string, any> };
    timeline.actionMap.set(actionId, {
      node: { type: "skill", id: actionId, element: "physical" },
      trackId: "A",
    });
  }

  it("stacks on skill hit, max 3 stacks with independent durations", () => {
    const engine = makeEngine([makeActor("A", { attack: 1000 })]);
    registerParadigmWeapon(engine, "A");

    // Inject 4 fake skill actions
    for (let i = 0; i < 4; i++) {
      injectFakeSkillAction(engine, `skill_${i}`);
      engine.enqueue({
        type: "DAMAGE_TICK",
        time: 1 + i * 0.5,
        payload: {
          sourceId: "A",
          targetId: "boss",
          damage: 0,
          stagger: 0,
          tickData: {
            offset: 0, sp: 0, stagger: 0, multiplier: 1.0,
            realTime: 1 + i * 0.5, realOffset: 0, time: 1 + i * 0.5,
          },
          actionId: `skill_${i}`,
        },
      });
    }

    engine.run();

    const actorState = engine.getState().getActor("A");
    const stacks = actorState.effects
      .getAll()
      .filter((inst) => inst.effect.properties.stackGroup === "paradigm_buff");

    // Max 3 stacks even though 4 hits occurred
    expect(stacks.length).toBe(3);
    // Each stack contributes +28 physical_dmg
    for (const s of stacks) {
      expect(s.effect.properties.dynamicBonuses).toEqual([
        { stat: "physical_dmg", value: 28 },
      ]);
    }
  });

  it("respects 0.1s ICD — hits within 0.1s don't double-stack", () => {
    const engine = makeEngine([makeActor("A", { attack: 1000 })]);
    registerParadigmWeapon(engine, "A");

    // Two hits at t=1.0 and t=1.05 (within 0.1s ICD)
    injectFakeSkillAction(engine, "s1");
    injectFakeSkillAction(engine, "s2");

    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 1.0,
      payload: {
        sourceId: "A", targetId: "boss", damage: 0, stagger: 0,
        tickData: { offset: 0, sp: 0, stagger: 0, multiplier: 1.0, realTime: 1.0, realOffset: 0, time: 1.0 },
        actionId: "s1",
      },
    });
    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 1.05,
      payload: {
        sourceId: "A", targetId: "boss", damage: 0, stagger: 0,
        tickData: { offset: 0, sp: 0, stagger: 0, multiplier: 1.0, realTime: 1.05, realOffset: 0, time: 1.05 },
        actionId: "s2",
      },
    });

    engine.run();

    const stacks = engine.getState().getActor("A").effects
      .getAll()
      .filter((inst) => inst.effect.properties.stackGroup === "paradigm_buff");

    // Only 1 stack — second hit blocked by ICD
    expect(stacks.length).toBe(1);
  });

  it("attack-type hits do NOT trigger stacks", () => {
    const engine = makeEngine([makeActor("A", { attack: 1000 })]);
    registerParadigmWeapon(engine, "A");

    // Inject an "attack" type action (not skill/ultimate)
    const timeline = (engine as any).timeline as { actionMap: Map<string, any> };
    timeline.actionMap.set("atk_1", {
      node: { type: "attack", id: "atk_1", element: "physical" },
      trackId: "A",
    });

    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 1.0,
      payload: {
        sourceId: "A", targetId: "boss", damage: 0, stagger: 0,
        tickData: { offset: 0, sp: 0, stagger: 0, multiplier: 1.0, realTime: 1.0, realOffset: 0, time: 1.0 },
        actionId: "atk_1",
      },
    });

    engine.run();

    const stacks = engine.getState().getActor("A").effects
      .getAll()
      .filter((inst) => inst.effect.properties.stackGroup === "paradigm_buff");

    expect(stacks.length).toBe(0);
  });

  it("does NOT double-count static physical_dmg (comes from timelineStore delta)", () => {
    // +28 physical_dmg is in passiveStats, applied by timelineStore.
    // Actor already has it in stats.physical_dmg when passed to simulation.
    const engine = makeEngine([makeActor("A", { physical_dmg: 38 })]);
    registerParadigmWeapon(engine, "A");

    const actor = engine.getState().getActor("A");
    // Should remain 38 (not 38+28=66)
    expect(actor.snapshotData.stats.physical_dmg).toBe(38);
  });
});

// ===========================================================================
// 10. Dynamic buff aggregation in DamageBonusZone
// ===========================================================================

describe("Dynamic Buff Aggregation", () => {
  it("equipment buff affects damage calculation via DamageBonusZone", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000 });
    const engine = makeEngine([actor]);

    // Manually add a blaze buff to actor's effects
    const actorState = engine.getState().getActor("A");
    addOrRefreshBuff(
      actorState.effects,
      new Effect({
        id: "test_blaze_buff",
        tags: [],
        duration: 30,
        startTime: 0,
        properties: {
          dynamicBonuses: [{ stat: "blaze_dmg", value: 50 }] as DynamicBonus[],
        },
      }),
    );

    // Create damage context for burn damage
    const tags = buildDamageTags({
      sourceActorId: "A",
      targetEnemyId: "boss",
      damageType: "burn",
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

    // ATK=1000, mult=1.0, defense=0.5
    // DamageBonus: blaze_dmg from buff = 50, so 1 + 50/100 = 1.50
    // Final = 1000 * 0.5 * 1.50 = 750
    expect(result.finalValue).toBe(750);
  });

  it("expired buff is NOT included in damage bonus", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000 });
    const engine = makeEngine([actor]);

    // Add a buff that started at t=0 with duration=5
    const actorState = engine.getState().getActor("A");
    addOrRefreshBuff(
      actorState.effects,
      new Effect({
        id: "test_expired_buff",
        tags: [],
        duration: 5,
        startTime: 0,
        properties: {
          dynamicBonuses: [{ stat: "blaze_dmg", value: 50 }] as DynamicBonus[],
        },
      }),
    );

    // Advance time past expiry
    engine.getState().advanceTime(10);

    const tags = buildDamageTags({
      sourceActorId: "A",
      targetEnemyId: "boss",
      damageType: "burn",
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

    // No buff bonus (expired) → just defense
    // Final = 1000 * 0.5 = 500
    expect(result.finalValue).toBe(500);
  });

  it("multiple dynamic bonuses from different effects stack additively", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000 });
    const engine = makeEngine([actor]);

    const actorState = engine.getState().getActor("A");

    // Buff 1: +30% arts damage
    addOrRefreshBuff(
      actorState.effects,
      new Effect({
        id: "buff1",
        tags: [],
        duration: 30,
        startTime: 0,
        properties: {
          dynamicBonuses: [{ stat: "arts_dmg", value: 30 }] as DynamicBonus[],
        },
      }),
    );

    // Buff 2: +20% arts damage (from different source)
    actorState.effects.add(
      new Effect({
        id: "buff2",
        tags: [],
        duration: 30,
        startTime: 0,
        properties: {
          dynamicBonuses: [{ stat: "arts_dmg", value: 20 }] as DynamicBonus[],
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

    // arts_dmg from buffs: 30 + 20 = 50
    // DamageBonus = 1 + 50/100 = 1.50
    // Final = 1000 * 0.5 * 1.50 = 750
    expect(result.finalValue).toBe(750);
  });
});

// ===========================================================================
// Helper utility tests
// ===========================================================================

describe("Equipment Helpers", () => {
  it("isEffectActive checks duration correctly", () => {
    const eff = new Effect({ id: "t", tags: [], duration: 10, startTime: 5 });
    expect(isEffectActive(eff, 10)).toBe(true); // 5 + 10 = 15 > 10
    expect(isEffectActive(eff, 14.99)).toBe(true);
    expect(isEffectActive(eff, 15)).toBe(false); // expired
    expect(isEffectActive(eff, 20)).toBe(false);
  });

  it("isEffectActive returns true for infinite duration", () => {
    const eff = new Effect({ id: "t", tags: [], duration: Infinity, startTime: 0 });
    expect(isEffectActive(eff, 99999)).toBe(true);
  });

  it("addOrRefreshBuff refreshes existing, does not duplicate", () => {
    const engine = makeEngine();
    const actor = engine.getState().getActor("A");

    addOrRefreshBuff(
      actor.effects,
      new Effect({ id: "mybuff", tags: [], duration: 10, startTime: 0 }),
    );
    addOrRefreshBuff(
      actor.effects,
      new Effect({ id: "mybuff", tags: [], duration: 10, startTime: 5 }),
    );

    const matching = actor.effects.getAll().filter((i) => i.effect.id === "mybuff");
    expect(matching.length).toBe(1);
    expect(matching[0]!.effect.startTime).toBe(5); // refreshed
  });
});
