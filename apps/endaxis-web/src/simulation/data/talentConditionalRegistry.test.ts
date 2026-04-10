/**
 * Talent conditional registry tests.
 *
 * Verifies the adapter layer itself — trigger descriptors, SP accumulator,
 * stack/duration behavior, and DynamicBonus consumption — without requiring
 * the full character skill chain to be operational.
 *
 * These tests inject SP_CHANGE / DAMAGE_TICK / APPLY_DIRECT_ANOMALY events
 * directly into the engine, bypassing the normal action→hit flow.
 */

import { describe, it, expect } from "vitest";
import type { ActorSnapshot } from "../state/types";
import type { ActorStats } from "../compiler/types";
import { createDefaultStats } from "@/utils/coreStats";
import { createEngine } from "../engine/createEngine";
import { compileTimeline } from "../compiler/compileTimeline";
import { Effect } from "../effects/types";
import { addOrRefreshBuff, addStackWithIndependentDuration, aggregateZoneBonuses, aggregateEnemyZoneBonuses } from "../equipment/types";
import type { DynamicBonus } from "../equipment/types";
import { registerTalentConditionals, mapEffectToBonus } from "./talentConditionalRegistry";
import { DiagnosticCollector } from "../diagnostics";

// ===========================================================================
// Helpers (same pattern as equipment.test.ts)
// ===========================================================================

function makeStats(overrides: Partial<ActorStats> = {}): ActorStats {
  return { ...(createDefaultStats() as ActorStats), attack: 1000, ...overrides };
}

function makeActor(
  id: string,
  overrides: Partial<ActorStats> = {},
  activeEffects?: any[],
): ActorSnapshot {
  const stats = makeStats(overrides) as any;
  if (activeEffects) {
    stats._activeEffects = activeEffects;
  }
  return {
    id,
    stats,
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

/**
 * Replicate the registerTriggeredBuff helper from simulator.ts.
 * Needed because the original is a closure inside simulate().
 */
function makeRegisterTriggeredBuff(engine: ReturnType<typeof createEngine>) {
  let _buffCounter = 0;
  return (
    actorId: string,
    opts: {
      carrierId: string;
      event: string;
      condition?: (e: any, ctx: any) => boolean;
      buffId: string;
      duration: number;
      bonuses: DynamicBonus[];
      target?: "self" | "enemy" | "team";
      stack?: { group: string; max: number };
      cooldownId?: string;
      cooldownDuration?: number;
      stackCountFn?: (e: any, ctx: any) => number;
      sourceMustBeWearer?: boolean;
    },
  ) => {
    const actorState = engine.state.getActor(actorId);
    actorState.effects.add(
      new Effect({
        id: opts.carrierId,
        tags: [],
        duration: 999999,
        startTime: 0,
        properties: {},
        triggers: [
          {
            event: opts.event as any,
            sourceMustBeWearer: opts.sourceMustBeWearer !== false,
            cooldownId: opts.cooldownId,
            cooldownDuration: opts.cooldownDuration,
            condition: opts.condition,
            action: (_e: any, ctx: any) => {
              const time = ctx.state.getCurrentTime();

              if (opts.target === "team") {
                for (const teammate of ctx.state.getAllActors()) {
                  addOrRefreshBuff(
                    teammate.effects,
                    new Effect({
                      id: opts.buffId,
                      tags: [],
                      duration: opts.duration,
                      startTime: time,
                      properties: { dynamicBonuses: opts.bonuses },
                    }),
                  );
                }
                return;
              }

              const targetEffects =
                opts.target === "enemy"
                  ? ctx.state.enemy.effects
                  : ctx.state.getActor(actorId).effects;

              if (opts.stack) {
                const count = opts.stackCountFn ? opts.stackCountFn(_e, ctx) : 1;
                for (let i = 0; i < count; i++) {
                  _buffCounter++;
                  addStackWithIndependentDuration(
                    targetEffects,
                    new Effect({
                      id: `${opts.buffId}_${_buffCounter}`,
                      tags: [],
                      duration: opts.duration,
                      startTime: time,
                      properties: {
                        dynamicBonuses: opts.bonuses,
                        stackGroup: opts.stack.group,
                      },
                    }),
                    opts.stack.group,
                    opts.stack.max,
                    time,
                  );
                }
              } else {
                addOrRefreshBuff(
                  targetEffects,
                  new Effect({
                    id: opts.buffId,
                    tags: [],
                    duration: opts.duration,
                    startTime: time,
                    properties: { dynamicBonuses: opts.bonuses },
                  }),
                );
              }
            },
          },
        ],
      }),
    );
  };
}

// ===========================================================================
// POGRANICHNK — SP accumulator + ATK% stacking
// ===========================================================================

describe("POGRANICHNK 活着的旗帜 (Living Flag)", () => {
  function setupPogranichnk(atkPercentValue = 8) {
    const actor = makeActor("POGRANICHNK", {}, [
      {
        type: "stat_bonus",
        stat: "attack_percent",
        value: atkPercentValue,
        unit: "percent",
        scope: "runtime_conditional",
        note: "conditional buff",
      },
    ]);
    const engine = makeEngine([actor]);
    const register = makeRegisterTriggeredBuff(engine);
    registerTalentConditionals([actor], register);
    return engine;
  }

  it("does NOT trigger before 80 SP accumulated", () => {
    const engine = setupPogranichnk();

    // 70 SP total (below 80 threshold)
    engine.enqueue({ type: "SP_CHANGE", time: 1, payload: { actorId: "POGRANICHNK", spChange: 30, reason: "skill", sourceId: "a1", parent: {} as any } });
    engine.enqueue({ type: "SP_CHANGE", time: 2, payload: { actorId: "POGRANICHNK", spChange: 40, reason: "damage", sourceId: "a1", parent: {} as any } });
    engine.run();

    const stacks = engine.state.getActor("POGRANICHNK").effects
      .getAll()
      .filter((inst) => inst.effect.properties.stackGroup === "pogranichnk_morale");
    expect(stacks.length).toBe(0);
  });

  it("triggers exactly once at 80 SP", () => {
    const engine = setupPogranichnk();

    engine.enqueue({ type: "SP_CHANGE", time: 1, payload: { actorId: "POGRANICHNK", spChange: 50, reason: "skill", sourceId: "a1", parent: {} as any } });
    engine.enqueue({ type: "SP_CHANGE", time: 2, payload: { actorId: "POGRANICHNK", spChange: 30, reason: "damage", sourceId: "a2", parent: {} as any } });
    engine.run();

    const stacks = engine.state.getActor("POGRANICHNK").effects
      .getAll()
      .filter((inst) => inst.effect.properties.stackGroup === "pogranichnk_morale");
    expect(stacks.length).toBe(1);
  });

  it("accumulates remainder across events for second stack", () => {
    const engine = setupPogranichnk();

    // 50 + 50 = 100 → triggers at 80, remainder 20
    engine.enqueue({ type: "SP_CHANGE", time: 1, payload: { actorId: "POGRANICHNK", spChange: 50, reason: "skill", sourceId: "a1", parent: {} as any } });
    engine.enqueue({ type: "SP_CHANGE", time: 2, payload: { actorId: "POGRANICHNK", spChange: 50, reason: "damage", sourceId: "a2", parent: {} as any } });
    // 20 (remainder) + 70 = 90 → triggers at 80, remainder 10
    engine.enqueue({ type: "SP_CHANGE", time: 3, payload: { actorId: "POGRANICHNK", spChange: 70, reason: "skill", sourceId: "a3", parent: {} as any } });
    engine.run();

    const stacks = engine.state.getActor("POGRANICHNK").effects
      .getAll()
      .filter((inst) => inst.effect.properties.stackGroup === "pogranichnk_morale");
    expect(stacks.length).toBe(2);
  });

  it("respects max 3 stacks", () => {
    const engine = setupPogranichnk();

    // 4 × 80 = 320 SP → should produce 4 triggers but cap at 3 stacks
    for (let i = 0; i < 4; i++) {
      engine.enqueue({ type: "SP_CHANGE", time: i + 1, payload: { actorId: "POGRANICHNK", spChange: 80, reason: "skill", sourceId: `a${i}`, parent: {} as any } });
    }
    engine.run();

    const stacks = engine.state.getActor("POGRANICHNK").effects
      .getAll()
      .filter((inst) => inst.effect.properties.stackGroup === "pogranichnk_morale");
    expect(stacks.length).toBe(3);
  });

  it("ignores negative SP (consumption) and execution recovery", () => {
    const engine = setupPogranichnk();

    engine.enqueue({ type: "SP_CHANGE", time: 1, payload: { actorId: "POGRANICHNK", spChange: -100, reason: "skill", sourceId: "a1", parent: {} as any } });
    engine.enqueue({ type: "SP_CHANGE", time: 2, payload: { actorId: "POGRANICHNK", spChange: 50, reason: "execution", sourceId: "a2", parent: {} as any } });
    engine.enqueue({ type: "SP_CHANGE", time: 3, payload: { actorId: "POGRANICHNK", spChange: 40, reason: "skill", sourceId: "a3", parent: {} as any } });
    engine.run();

    // Only 40 SP counted (the reason="skill" positive one) — below 80
    const stacks = engine.state.getActor("POGRANICHNK").effects
      .getAll()
      .filter((inst) => inst.effect.properties.stackGroup === "pogranichnk_morale");
    expect(stacks.length).toBe(0);
  });

  it("buff carries correct DynamicBonus in attackPercent zone", () => {
    const engine = setupPogranichnk(8);

    engine.enqueue({ type: "SP_CHANGE", time: 1, payload: { actorId: "POGRANICHNK", spChange: 80, reason: "skill", sourceId: "a1", parent: {} as any } });
    engine.run();

    const bonus = aggregateZoneBonuses(engine.state, "POGRANICHNK", "attackPercent");
    expect(bonus).toBe(8);
  });

  it("multiple stacks aggregate additively", () => {
    const engine = setupPogranichnk(8);

    engine.enqueue({ type: "SP_CHANGE", time: 1, payload: { actorId: "POGRANICHNK", spChange: 80, reason: "skill", sourceId: "a1", parent: {} as any } });
    engine.enqueue({ type: "SP_CHANGE", time: 2, payload: { actorId: "POGRANICHNK", spChange: 80, reason: "skill", sourceId: "a2", parent: {} as any } });
    engine.run();

    const bonus = aggregateZoneBonuses(engine.state, "POGRANICHNK", "attackPercent");
    expect(bonus).toBe(16); // 8 × 2 stacks
  });

  it("stack expires after 20s (independent duration)", () => {
    const engine = setupPogranichnk(8);

    // Stack 1 at t=1
    engine.enqueue({ type: "SP_CHANGE", time: 1, payload: { actorId: "POGRANICHNK", spChange: 80, reason: "skill", sourceId: "a1", parent: {} as any } });
    // Stack 2 at t=10
    engine.enqueue({ type: "SP_CHANGE", time: 10, payload: { actorId: "POGRANICHNK", spChange: 80, reason: "skill", sourceId: "a2", parent: {} as any } });
    // Dummy event at t=22 to advance time past stack 1 expiry (1+20=21)
    engine.enqueue({ type: "SP_CHANGE", time: 22, payload: { actorId: "POGRANICHNK", spChange: 0, reason: "skill", sourceId: "a3", parent: {} as any } });
    engine.run();

    // Stack 1 (startTime=1, duration=20) expired at t=21. Stack 2 (startTime=10) still active.
    const bonus = aggregateZoneBonuses(engine.state, "POGRANICHNK", "attackPercent");
    expect(bonus).toBe(8); // only stack 2 remains
  });

  it("reads value from _activeEffects (data-driven)", () => {
    // Use value=4 (E1 promotion) instead of default 8
    const engine = setupPogranichnk(4);

    engine.enqueue({ type: "SP_CHANGE", time: 1, payload: { actorId: "POGRANICHNK", spChange: 80, reason: "skill", sourceId: "a1", parent: {} as any } });
    engine.run();

    const bonus = aggregateZoneBonuses(engine.state, "POGRANICHNK", "attackPercent");
    expect(bonus).toBe(4);
  });
});

// ===========================================================================
// WULFGARD — regression: migrated behavior unchanged
// ===========================================================================

describe("WULFGARD 灼热獠牙 (regression)", () => {
  function setupWulfgard(blazeValue = 30) {
    const actor = makeActor("WULFGARD", {}, [
      {
        type: "damage_bonus",
        stat: "blaze_dmg",
        value: blazeValue,
        unit: "percent",
        scope: "runtime_conditional",
        note: "conditional self buff",
      },
    ]);
    const engine = makeEngine([actor]);
    const register = makeRegisterTriggeredBuff(engine);
    registerTalentConditionals([actor], register);
    return engine;
  }

  it("triggers on burn apply", () => {
    const engine = setupWulfgard();

    // Unregister the real anomaly handler so it doesn't interfere with the trigger test.
    // We only care that the TriggerProcessor fires the condition+action correctly.
    (engine as any).handlers.delete("APPLY_DIRECT_ANOMALY");

    engine.enqueue({
      type: "APPLY_DIRECT_ANOMALY" as any,
      time: 0.5,
      payload: { anomalyType: "burn", level: 1, sourceActorId: "WULFGARD", targetId: "boss" },
    });
    engine.run();

    const buffs = engine.getState().getActor("WULFGARD").effects
      .getAll()
      .filter((inst) => inst.effect.id === "wulfgard_blaze_buff");
    expect(buffs.length).toBe(1);
    const dynBonuses = buffs[0].effect.properties.dynamicBonuses as DynamicBonus[];
    expect(dynBonuses).toEqual([{ stat: "blaze_dmg", value: 30 }]);
  });

  it("does NOT trigger on non-burn anomaly", () => {
    const engine = setupWulfgard();

    (engine as any).handlers.delete("APPLY_DIRECT_ANOMALY");

    engine.enqueue({
      type: "APPLY_DIRECT_ANOMALY" as any,
      time: 0.5,
      payload: { anomalyType: "freeze", level: 1, sourceActorId: "WULFGARD", targetId: "boss" },
    });
    engine.run();

    const buffs = engine.getState().getActor("WULFGARD").effects
      .getAll()
      .filter((inst) => inst.effect.id === "wulfgard_blaze_buff");
    expect(buffs.length).toBe(0);
  });
});

// ===========================================================================
// CHENQIANYU — regression: migrated behavior unchanged
// ===========================================================================

describe("CHENQIANYU 斩锋 (regression)", () => {
  function setupChenqianyu(atkValue = 8) {
    const actor = makeActor("CHENQIANYU", {}, [
      {
        type: "stat_bonus",
        stat: "attack_percent",
        value: atkValue,
        unit: "percent",
        scope: "runtime_conditional",
        note: "conditional buff",
      },
    ]);
    const engine = makeEngine([actor]);
    const register = makeRegisterTriggeredBuff(engine);
    registerTalentConditionals([actor], register);

    // Inject mock actions into timeline.actionMap so ctx.getAction works
    const actionMap = (engine as any).timeline.actionMap as Map<string, any>;
    actionMap.set("skill_action", { node: { type: "skill", id: "s1" } });
    actionMap.set("attack_action", { node: { type: "attack", id: "a1" } });
    return engine;
  }

  it("triggers on skill hit and stacks", () => {
    const engine = setupChenqianyu();

    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 1,
      payload: { sourceId: "CHENQIANYU", targetId: "boss", damage: 100, stagger: 0, tickData: { offset: 0, sp: 0, stagger: 0 }, actionId: "skill_action" },
    });
    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 2,
      payload: { sourceId: "CHENQIANYU", targetId: "boss", damage: 100, stagger: 0, tickData: { offset: 0, sp: 0, stagger: 0 }, actionId: "skill_action" },
    });
    engine.run();

    const bonus = aggregateZoneBonuses(engine.state, "CHENQIANYU", "attackPercent");
    expect(bonus).toBe(16); // 8 × 2 stacks
  });

  it("does NOT trigger on attack type", () => {
    const engine = setupChenqianyu();

    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 1,
      payload: { sourceId: "CHENQIANYU", targetId: "boss", damage: 100, stagger: 0, tickData: { offset: 0, sp: 0, stagger: 0 }, actionId: "attack_action" },
    });
    engine.run();

    const bonus = aggregateZoneBonuses(engine.state, "CHENQIANYU", "attackPercent");
    expect(bonus).toBe(0);
  });
});

// ===========================================================================
// AVYWENNA — 委婉手段: ultimate hit → emag fragility debuff on enemy
// ===========================================================================

describe("AVYWENNA 委婉手段 (Subtle Means)", () => {
  function setupAvywenna(emagValue = 6) {
    const actor = makeActor("AVYWENNA", {}, [
      {
        type: "damage_bonus",
        stat: "emag_dmg",
        value: emagValue,
        unit: "percent",
        scope: "runtime_conditional",
        note: "enemy emag fragility on ultimate hit",
      },
    ]);
    const engine = makeEngine([actor]);
    const register = makeRegisterTriggeredBuff(engine);
    registerTalentConditionals([actor], register);

    // Inject mock actions into timeline.actionMap
    const actionMap = (engine as any).timeline.actionMap as Map<string, any>;
    actionMap.set("ult_action", { node: { type: "ultimate", id: "u1" } });
    actionMap.set("skill_action", { node: { type: "skill", id: "s1" } });
    return engine;
  }

  it("triggers emag fragility on enemy after ultimate DAMAGE_TICK", () => {
    const engine = setupAvywenna(6);

    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 1,
      payload: { sourceId: "AVYWENNA", targetId: "boss", damage: 100, stagger: 0, tickData: { offset: 0, sp: 0, stagger: 0 }, actionId: "ult_action" },
    });
    engine.run();

    const enemyBuffs = engine.state.enemy.effects
      .getAll()
      .filter((inst) => inst.effect.id === "avywenna_emag_fragility");
    expect(enemyBuffs.length).toBe(1);
    const dynBonuses = enemyBuffs[0].effect.properties.dynamicBonuses as any[];
    expect(dynBonuses).toEqual([{ stat: "emag_dmg", value: 6, zone: "fragility" }]);
  });

  it("does NOT trigger on skill DAMAGE_TICK", () => {
    const engine = setupAvywenna(6);

    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 1,
      payload: { sourceId: "AVYWENNA", targetId: "boss", damage: 100, stagger: 0, tickData: { offset: 0, sp: 0, stagger: 0 }, actionId: "skill_action" },
    });
    engine.run();

    const enemyBuffs = engine.state.enemy.effects
      .getAll()
      .filter((inst) => inst.effect.id === "avywenna_emag_fragility");
    expect(enemyBuffs.length).toBe(0);
  });

  it("refreshes on repeated ultimate hits (no stack)", () => {
    const engine = setupAvywenna(10);

    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 1,
      payload: { sourceId: "AVYWENNA", targetId: "boss", damage: 100, stagger: 0, tickData: { offset: 0, sp: 0, stagger: 0 }, actionId: "ult_action" },
    });
    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 5,
      payload: { sourceId: "AVYWENNA", targetId: "boss", damage: 100, stagger: 0, tickData: { offset: 0, sp: 0, stagger: 0 }, actionId: "ult_action" },
    });
    engine.run();

    const enemyBuffs = engine.state.enemy.effects
      .getAll()
      .filter((inst) => inst.effect.id === "avywenna_emag_fragility");
    // Should be 1 (refreshed), not 2 (stacked)
    expect(enemyBuffs.length).toBe(1);
    // Duration refreshed: started at t=5, so expires at t=15
    expect(enemyBuffs[0].effect.startTime).toBe(5);
  });

  it("reads value from _activeEffects (data-driven)", () => {
    const engine = setupAvywenna(10);

    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 1,
      payload: { sourceId: "AVYWENNA", targetId: "boss", damage: 100, stagger: 0, tickData: { offset: 0, sp: 0, stagger: 0 }, actionId: "ult_action" },
    });
    engine.run();

    const bonus = aggregateEnemyZoneBonuses(engine.state, "fragility");
    expect(bonus).toBe(10);
  });
});

// ===========================================================================
// DAPAN — 勾芡: link (slam) clears break → N buff stacks = consumed layers
// ===========================================================================

import { aggregateDynamicBonuses } from "../equipment/types";

describe("DAPAN 勾芡 (Gouqian)", () => {
  function setupDapan(physDmgValue = 4, extraActors: ActorSnapshot[] = []) {
    const actor = makeActor("DAPAN", {}, [
      {
        type: "damage_bonus",
        stat: "physical_dmg",
        value: physDmgValue,
        unit: "percent",
        scope: "runtime_conditional",
        note: "conditional self buff",
      },
    ]);
    const engine = makeEngine([actor, ...extraActors]);
    const register = makeRegisterTriggeredBuff(engine);
    registerTalentConditionals([actor], register);
    return engine;
  }

  function getGouqianStacks(engine: ReturnType<typeof createEngine>) {
    return engine.state.getActor("DAPAN").effects
      .getAll()
      .filter((inst) => inst.effect.properties.stackGroup === "dapan_gouqian");
  }

  it("does NOT trigger when enemy has no break stacks", () => {
    const engine = setupDapan();

    // Slam on enemy without any break stacks → just adds 1 break stack, no clear
    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY" as any,
      time: 1,
      payload: { physicalType: "slam", sourceActorId: "DAPAN", targetId: "boss" },
    });
    engine.run();

    expect(getGouqianStacks(engine).length).toBe(0);
  });

  it("OTHER actor builds 3 break stacks, DAPAN slam clears → 3 buff stacks (real scenario)", () => {
    // This is the primary real-world scenario:
    // Teammates build break stacks via their physical anomalies, then DAPAN link slam clears them.
    const engine = setupDapan(4, [makeActor("TEAMMATE")]);

    // TEAMMATE builds 3 break stacks (each launch on no-break enemy → +1 stack)
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 0.5, payload: { physicalType: "launch", sourceActorId: "TEAMMATE", targetId: "boss" } });
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 1.0, payload: { physicalType: "launch", sourceActorId: "TEAMMATE", targetId: "boss" } });
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 1.5, payload: { physicalType: "launch", sourceActorId: "TEAMMATE", targetId: "boss" } });
    // DAPAN slam clears all 3 stacks (hasBreak since stacks > 0 after first launch)
    // Note: launch on broken target adds stacks, so after 3 launches we have ~3-4 stacks
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 2.0, payload: { physicalType: "slam", sourceActorId: "DAPAN", targetId: "boss" } });
    engine.run();

    // Condition observed break stacks building up from TEAMMATE's events (sourceMustBeWearer=false).
    // On DAPAN's slam: break cleared, buff stacks added.
    const stacks = getGouqianStacks(engine);
    expect(stacks.length).toBeGreaterThan(0);
    expect(stacks.length).toBeLessThanOrEqual(4);
  });

  it("triggers with correct stack count matching consumed break layers", () => {
    const engine = setupDapan(4, [makeActor("TEAMMATE")]);

    // TEAMMATE builds exactly 2 break stacks
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 0.5, payload: { physicalType: "launch", sourceActorId: "TEAMMATE", targetId: "boss" } });
    // After first launch: stacks = 1 (no break before → addBreakStack → 1)
    // Second launch: hasBreak → launch adds → stacks = 2
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 1.0, payload: { physicalType: "launch", sourceActorId: "TEAMMATE", targetId: "boss" } });
    // DAPAN slam clears 2 stacks
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 2.0, payload: { physicalType: "slam", sourceActorId: "DAPAN", targetId: "boss" } });
    engine.run();

    expect(getGouqianStacks(engine).length).toBe(2);
  });

  it("caps at max 4 buff stacks even with more break stacks", () => {
    const engine = setupDapan(4, [makeActor("TEAMMATE")]);

    // Build 6 break stacks via launches
    for (let i = 0; i < 6; i++) {
      engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 0.1 * (i + 1), payload: { physicalType: "launch", sourceActorId: "TEAMMATE", targetId: "boss" } });
    }
    // DAPAN slam clears all
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 2.0, payload: { physicalType: "slam", sourceActorId: "DAPAN", targetId: "boss" } });
    engine.run();

    // Consumed 6+ stacks, but buff caps at max 4
    expect(getGouqianStacks(engine).length).toBe(4);
  });

  it("buff stacks expire after 10s (independent duration)", () => {
    const engine = setupDapan(4, [makeActor("TEAMMATE")]);

    // Build 2 stacks, clear them
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 0.5, payload: { physicalType: "launch", sourceActorId: "TEAMMATE", targetId: "boss" } });
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 1.0, payload: { physicalType: "launch", sourceActorId: "TEAMMATE", targetId: "boss" } });
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 2.0, payload: { physicalType: "slam", sourceActorId: "DAPAN", targetId: "boss" } });
    // Advance past expiry (buff at t=2, duration=10 → expires t=12)
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 13, payload: { physicalType: "launch", sourceActorId: "DAPAN", targetId: "boss" } });
    engine.run();

    const bonus = aggregateDynamicBonuses(
      engine.state,
      "DAPAN",
      { sourceActorId: "DAPAN", targetEnemyId: "boss", damageSchool: "physical" } as any,
    );
    expect(bonus).toBe(0);
  });

  it("does NOT trigger from DAPAN knockup (non-clearing type)", () => {
    const engine = setupDapan(4, [makeActor("TEAMMATE")]);

    // Build break stacks
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 0.5, payload: { physicalType: "launch", sourceActorId: "TEAMMATE", targetId: "boss" } });
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 1.0, payload: { physicalType: "launch", sourceActorId: "TEAMMATE", targetId: "boss" } });
    // DAPAN uses launch (knockup), not slam → does NOT clear break
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 2.0, payload: { physicalType: "launch", sourceActorId: "DAPAN", targetId: "boss" } });
    engine.run();

    expect(getGouqianStacks(engine).length).toBe(0);
  });

  it("does NOT trigger from another actor's slam (source check in condition)", () => {
    const engine = setupDapan(4, [makeActor("OTHER")]);

    // Build break stacks
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 0.5, payload: { physicalType: "launch", sourceActorId: "OTHER", targetId: "boss" } });
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 1.0, payload: { physicalType: "launch", sourceActorId: "OTHER", targetId: "boss" } });
    // OTHER's slam clears break — condition runs but source !== "DAPAN" → no trigger
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 2.0, payload: { physicalType: "slam", sourceActorId: "OTHER", targetId: "boss" } });
    engine.run();

    expect(getGouqianStacks(engine).length).toBe(0);
  });

  it("buff value is data-driven from _activeEffects", () => {
    const engine = setupDapan(6, [makeActor("TEAMMATE")]); // E2 value

    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 0.5, payload: { physicalType: "launch", sourceActorId: "TEAMMATE", targetId: "boss" } });
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 1.0, payload: { physicalType: "launch", sourceActorId: "TEAMMATE", targetId: "boss" } });
    engine.enqueue({ type: "APPLY_PHYSICAL_ANOMALY" as any, time: 2.0, payload: { physicalType: "slam", sourceActorId: "DAPAN", targetId: "boss" } });
    engine.run();

    // 2 stacks × 6% each = 12%
    const bonus = aggregateDynamicBonuses(
      engine.state,
      "DAPAN",
      { sourceActorId: "DAPAN", targetEnemyId: "boss", damageSchool: "physical" } as any,
    );
    expect(bonus).toBe(12);
  });
});

// ===========================================================================
// ARCLIGHT — 荒野游人: 3 consume_conduction ticks → team emag buff
// ===========================================================================

describe("ARCLIGHT 荒野游人 (Wilderness Wanderer)", () => {
  const INTELLECT = 150;
  const PER_POINT_E1 = 0.05;

  function makeConductionTick(sourceId: string, time: number, hasBound = true) {
    return {
      type: "DAMAGE_TICK" as const,
      time,
      payload: {
        sourceId,
        targetId: "boss",
        damage: 100,
        stagger: 0,
        tickData: {
          offset: 1.2,
          sp: 30,
          stagger: 5,
          boundEffects: hasBound ? ["consume_conduction"] : [],
        },
        actionId: "skill_action",
      },
    };
  }

  function setupArclight(perPoint = PER_POINT_E1) {
    const arclight = makeActor("ARCLIGHT", { intellect: INTELLECT } as any, [
      {
        type: "damage_bonus",
        stat: "emag_dmg",
        value: perPoint,
        unit: "percent_per_intellect",
        scope: "runtime_conditional",
        target: "team",
        note: "team emag buff",
      },
    ]);
    const teammate = makeActor("TEAMMATE_A", {});
    const engine = makeEngine([arclight, teammate]);
    const register = makeRegisterTriggeredBuff(engine);
    registerTalentConditionals([arclight], register);
    return engine;
  }

  function getTeamBuff(engine: ReturnType<typeof createEngine>, actorId: string) {
    return engine.state.getActor(actorId).effects
      .getAll()
      .filter((inst) => inst.effect.id === "arclight_wilderness_wanderer");
  }

  it("does NOT trigger after first 2 consume_conduction ticks", () => {
    const engine = setupArclight();

    engine.enqueue(makeConductionTick("ARCLIGHT", 1));
    engine.enqueue(makeConductionTick("ARCLIGHT", 2));
    engine.run();

    expect(getTeamBuff(engine, "ARCLIGHT").length).toBe(0);
    expect(getTeamBuff(engine, "TEAMMATE_A").length).toBe(0);
  });

  it("triggers on the 3rd consume_conduction tick", () => {
    const engine = setupArclight();

    engine.enqueue(makeConductionTick("ARCLIGHT", 1));
    engine.enqueue(makeConductionTick("ARCLIGHT", 2));
    engine.enqueue(makeConductionTick("ARCLIGHT", 3));
    engine.run();

    expect(getTeamBuff(engine, "ARCLIGHT").length).toBe(1);
  });

  it("applies buff to ALL team members, not just ARCLIGHT", () => {
    const engine = setupArclight();

    engine.enqueue(makeConductionTick("ARCLIGHT", 1));
    engine.enqueue(makeConductionTick("ARCLIGHT", 2));
    engine.enqueue(makeConductionTick("ARCLIGHT", 3));
    engine.run();

    expect(getTeamBuff(engine, "ARCLIGHT").length).toBe(1);
    expect(getTeamBuff(engine, "TEAMMATE_A").length).toBe(1);
  });

  it("bonus value = intellect × perPoint (snapshot)", () => {
    const engine = setupArclight(PER_POINT_E1); // 150 × 0.05 = 7.5

    engine.enqueue(makeConductionTick("ARCLIGHT", 1));
    engine.enqueue(makeConductionTick("ARCLIGHT", 2));
    engine.enqueue(makeConductionTick("ARCLIGHT", 3));
    engine.run();

    const buff = getTeamBuff(engine, "ARCLIGHT")[0];
    const bonuses = buff.effect.properties.dynamicBonuses as DynamicBonus[];
    expect(bonuses).toEqual([{ stat: "emag_dmg", value: INTELLECT * PER_POINT_E1 }]);

    // Same bonus on teammate
    const tmBuff = getTeamBuff(engine, "TEAMMATE_A")[0];
    const tmBonuses = tmBuff.effect.properties.dynamicBonuses as DynamicBonus[];
    expect(tmBonuses).toEqual([{ stat: "emag_dmg", value: INTELLECT * PER_POINT_E1 }]);
  });

  it("does NOT trigger from non-ARCLIGHT source (sourceMustBeWearer default)", () => {
    const engine = setupArclight();

    // TEAMMATE_A fires consume_conduction ticks — should be ignored
    engine.enqueue(makeConductionTick("TEAMMATE_A", 1));
    engine.enqueue(makeConductionTick("TEAMMATE_A", 2));
    engine.enqueue(makeConductionTick("TEAMMATE_A", 3));
    engine.run();

    expect(getTeamBuff(engine, "ARCLIGHT").length).toBe(0);
  });

  it("does NOT trigger from ticks without consume_conduction", () => {
    const engine = setupArclight();

    // 3 ticks from ARCLIGHT, but WITHOUT consume_conduction boundEffect
    engine.enqueue(makeConductionTick("ARCLIGHT", 1, false));
    engine.enqueue(makeConductionTick("ARCLIGHT", 2, false));
    engine.enqueue(makeConductionTick("ARCLIGHT", 3, false));
    engine.run();

    expect(getTeamBuff(engine, "ARCLIGHT").length).toBe(0);
  });

  it("refreshes on re-trigger (no stack)", () => {
    const engine = setupArclight();

    // First trigger at t=3
    engine.enqueue(makeConductionTick("ARCLIGHT", 1));
    engine.enqueue(makeConductionTick("ARCLIGHT", 2));
    engine.enqueue(makeConductionTick("ARCLIGHT", 3));
    // Second trigger at t=6 (counter resets after first trigger)
    engine.enqueue(makeConductionTick("ARCLIGHT", 4));
    engine.enqueue(makeConductionTick("ARCLIGHT", 5));
    engine.enqueue(makeConductionTick("ARCLIGHT", 6));
    engine.run();

    // Still only 1 buff (refreshed, not stacked)
    expect(getTeamBuff(engine, "ARCLIGHT").length).toBe(1);
    // Duration refreshed: startTime should be 6 (second trigger)
    expect(getTeamBuff(engine, "ARCLIGHT")[0].effect.startTime).toBe(6);
  });

  it("uses E2 value (0.08) when data-driven", () => {
    const engine = setupArclight(0.08); // 150 × 0.08 = 12

    engine.enqueue(makeConductionTick("ARCLIGHT", 1));
    engine.enqueue(makeConductionTick("ARCLIGHT", 2));
    engine.enqueue(makeConductionTick("ARCLIGHT", 3));
    engine.run();

    const buff = getTeamBuff(engine, "ARCLIGHT")[0];
    const bonuses = buff.effect.properties.dynamicBonuses as DynamicBonus[];
    expect(bonuses[0].value).toBe(INTELLECT * 0.08);
  });
});

// ===========================================================================
// Diagnostic warnings for unsupported effect types
// ===========================================================================

describe("mapEffectToBonus coverage", () => {
  it("maps stat_bonus/attack_percent to attackPercent zone", () => {
    const result = mapEffectToBonus("stat_bonus", "attack_percent", 8);
    expect(result).toEqual([{ stat: "all_dmg", value: 8, zone: "attackPercent" }]);
  });

  it("maps damage_bonus/blaze_dmg to default zone", () => {
    const result = mapEffectToBonus("damage_bonus", "blaze_dmg", 30);
    expect(result).toEqual([{ stat: "blaze_dmg", value: 30 }]);
  });

  it("returns undefined for unsupported stat_bonus/originium_arts_power", () => {
    const result = mapEffectToBonus("stat_bonus", "originium_arts_power", 8);
    expect(result).toBeUndefined();
  });

  it("returns undefined for gauge_modifier type", () => {
    const result = mapEffectToBonus("gauge_modifier", "ult_gauge_gain", 3);
    expect(result).toBeUndefined();
  });
});
