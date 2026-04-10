import { describe, it, expect } from "vitest";
import { compileTimeline } from "../compiler/compileTimeline";
import { createEngine } from "./createEngine";
import { Effect } from "../effects/types";
import type { ActorSnapshot } from "../state/types";
import type { ActionStartEvent, SimEvent } from "../events/event.types";
import { createDefaultStats } from "@/utils/coreStats";
import type { ActorStats } from "../compiler/types";
import { DiagnosticCollector } from "../diagnostics";

function makeActor(id: string): ActorSnapshot {
  return {
    id,
    stats: createDefaultStats() as ActorStats,
    resources: { hp: 1000, gauge: 0 },
    cooldowns: new Map(),
    activeBuffs: new Map(),
  };
}

function makeMinimalEngine(actors: ActorSnapshot[], diagnostics?: DiagnosticCollector) {
  const timeline = compileTimeline([], []);
  return createEngine(
    { maxSp: 300, initialSp: 200, spRegenRate: 8, skillSpCostDefault: 100, linkCdReduction: 0 },
    { maxStagger: 100, staggerNodeCount: 0, staggerNodeDuration: 2, staggerBreakDuration: 10, executionRecovery: 25 },
    actors,
    timeline,
    diagnostics,
  );
}

describe("TriggerProcessor", () => {
  it("should fire a trigger when a matching event occurs", () => {
    const actors = [makeActor("HERO_A")];
    const engine = makeMinimalEngine(actors);

    let triggered = false;

    const passiveEffect = new Effect({
      id: "test_passive",
      tags: [],
      duration: Infinity,
      triggers: [
        {
          event: "ACTION_START",
          action: () => { triggered = true; },
        },
      ],
    });

    engine.registerPassiveEffect("HERO_A", passiveEffect);

    engine.enqueue({
      type: "ACTION_START",
      time: 1.0,
      payload: {
        skillId: "HERO_A_skill",
        actionId: "inst_1",
        spCost: 100,
        actorId: "HERO_A",
        type: "skill",
      },
    });

    engine.run();
    expect(triggered).toBe(true);
  });

  it("should NOT fire a trigger for a non-matching event type", () => {
    const actors = [makeActor("HERO_A")];
    const engine = makeMinimalEngine(actors);

    let triggered = false;

    const passiveEffect = new Effect({
      id: "test_passive",
      tags: [],
      duration: Infinity,
      triggers: [
        {
          event: "DAMAGE_TICK",
          action: () => { triggered = true; },
        },
      ],
    });

    engine.registerPassiveEffect("HERO_A", passiveEffect);

    engine.enqueue({
      type: "ACTION_START",
      time: 1.0,
      payload: {
        skillId: "HERO_A_skill",
        actionId: "inst_1",
        spCost: 0,
        actorId: "HERO_A",
        type: "skill",
      },
    });

    engine.run();
    expect(triggered).toBe(false);
  });

  it("should respect sourceMustBeWearer", () => {
    const actors = [makeActor("HERO_A"), makeActor("HERO_B")];
    const engine = makeMinimalEngine(actors);

    const calls: string[] = [];

    const passiveEffect = new Effect({
      id: "owned_passive",
      tags: [],
      duration: Infinity,
      triggers: [
        {
          event: "ACTION_START",
          sourceMustBeWearer: true,
          action: (_e, _ctx) => { calls.push("fired"); },
        },
      ],
    });

    engine.registerPassiveEffect("HERO_A", passiveEffect);

    // HERO_B fires an action — should NOT trigger HERO_A's passive
    engine.enqueue({
      type: "ACTION_START",
      time: 1.0,
      payload: { skillId: "B_skill", actionId: "inst_b1", spCost: 0, actorId: "HERO_B", type: "skill" },
    });

    // HERO_A fires an action — SHOULD trigger
    engine.enqueue({
      type: "ACTION_START",
      time: 2.0,
      payload: { skillId: "A_skill", actionId: "inst_a1", spCost: 0, actorId: "HERO_A", type: "skill" },
    });

    engine.run();
    expect(calls).toEqual(["fired"]);
  });

  it("should respect cooldown", () => {
    const actors = [makeActor("HERO_A")];
    const engine = makeMinimalEngine(actors);

    let fireCount = 0;

    const passiveEffect = new Effect({
      id: "cd_passive",
      tags: [],
      duration: Infinity,
      triggers: [
        {
          event: "ACTION_START",
          cooldownId: "cd_passive_trigger",
          cooldownDuration: 5,
          action: () => { fireCount++; },
        },
      ],
    });

    engine.registerPassiveEffect("HERO_A", passiveEffect);

    // Three actions at t=1, t=3, t=8
    engine.enqueue({
      type: "ACTION_START",
      time: 1.0,
      payload: { skillId: "s", actionId: "i1", spCost: 0, actorId: "HERO_A", type: "skill" },
    });
    engine.enqueue({
      type: "ACTION_START",
      time: 3.0,
      payload: { skillId: "s", actionId: "i2", spCost: 0, actorId: "HERO_A", type: "skill" },
    });
    engine.enqueue({
      type: "ACTION_START",
      time: 8.0,
      payload: { skillId: "s", actionId: "i3", spCost: 0, actorId: "HERO_A", type: "skill" },
    });

    engine.run();
    // t=1 fires (cd until t=6), t=3 skipped (cd), t=8 fires (cd expired)
    expect(fireCount).toBe(2);
  });

  it("should respect condition predicate", () => {
    const actors = [makeActor("HERO_A")];
    const engine = makeMinimalEngine(actors);

    let fireCount = 0;

    const passiveEffect = new Effect({
      id: "conditional_passive",
      tags: [],
      duration: Infinity,
      triggers: [
        {
          event: "ACTION_START",
          condition: (e: SimEvent) => {
            return (e as ActionStartEvent).payload.type === "ultimate";
          },
          action: () => { fireCount++; },
        },
      ],
    });

    engine.registerPassiveEffect("HERO_A", passiveEffect);

    engine.enqueue({
      type: "ACTION_START",
      time: 1.0,
      payload: { skillId: "s", actionId: "i1", spCost: 0, actorId: "HERO_A", type: "skill" },
    });
    engine.enqueue({
      type: "ACTION_START",
      time: 2.0,
      payload: { skillId: "u", actionId: "i2", spCost: 0, actorId: "HERO_A", type: "ultimate" },
    });

    engine.run();
    expect(fireCount).toBe(1);
  });

  it("should allow a trigger to enqueue new events", () => {
    const actors = [makeActor("HERO_A")];
    const engine = makeMinimalEngine(actors);

    const passiveEffect = new Effect({
      id: "event_producing_passive",
      tags: [],
      duration: Infinity,
      triggers: [
        {
          event: "ACTION_START",
          action: (_e, ctx) => {
            ctx.queue.enqueue({
              type: "SP_CHANGE",
              time: ctx.state.getCurrentTime(),
              payload: {
                actorId: "HERO_A",
                spChange: 50,
                reason: "passive_trigger",
                sourceId: "event_producing_passive",
                parent: _e,
              },
            });
          },
        },
      ],
    });

    engine.registerPassiveEffect("HERO_A", passiveEffect);

    engine.enqueue({
      type: "ACTION_START",
      time: 1.0,
      payload: { skillId: "s", actionId: "i1", spCost: 100, actorId: "HERO_A", type: "skill" },
    });

    const state = engine.run();
    // Initial 200 - 100 (skill cost) + 50 (trigger) + regen
    const sp = state.team.getSp();
    expect(sp).toBeGreaterThan(150);
  });

  it("should report diagnostics when trigger condition throws", () => {
    const diagnostics = new DiagnosticCollector();
    const actors = [makeActor("HERO_A")];
    const engine = makeMinimalEngine(actors, diagnostics);

    const badEffect = new Effect({
      id: "bad_condition_passive",
      tags: [],
      duration: Infinity,
      triggers: [
        {
          event: "ACTION_START",
          condition: () => {
            throw new Error("cond fail");
          },
          action: () => {},
        },
      ],
    });

    engine.registerPassiveEffect("HERO_A", badEffect);

    engine.enqueue({
      type: "ACTION_START",
      time: 1.0,
      payload: { skillId: "s", actionId: "i1", spCost: 0, actorId: "HERO_A", type: "skill" },
    });

    engine.run();

    const warns = diagnostics.getAll().filter((d) => d.code === "TRIGGER_CONDITION_ERROR");
    expect(warns.length).toBe(1);
  });

  it("should report diagnostics when trigger action throws", () => {
    const diagnostics = new DiagnosticCollector();
    const actors = [makeActor("HERO_A")];
    const engine = makeMinimalEngine(actors, diagnostics);

    const badEffect = new Effect({
      id: "broken_passive",
      tags: [],
      duration: Infinity,
      triggers: [
        {
          event: "ACTION_START",
          action: () => { throw new Error("oops"); },
        },
      ],
    });

    engine.registerPassiveEffect("HERO_A", badEffect);

    engine.enqueue({
      type: "ACTION_START",
      time: 1.0,
      payload: { skillId: "s", actionId: "i1", spCost: 0, actorId: "HERO_A", type: "skill" },
    });

    engine.run(); // should not throw

    const errors = diagnostics.getAll().filter(d => d.code === "TRIGGER_ACTION_ERROR");
    expect(errors.length).toBe(1);
    expect(errors[0]!.context?.effectType).toBe("broken_passive");
  });

  it("activeBuffs should reflect effects on actors", () => {
    const actors = [makeActor("HERO_A")];
    const engine = makeMinimalEngine(actors);

    const buff = new Effect({
      id: "atk_up",
      tags: [],
      name: "ATK Up",
      duration: Infinity,
      properties: { value: 50 },
    });

    engine.registerPassiveEffect("HERO_A", buff);

    engine.enqueue({
      type: "ACTION_START",
      time: 0.1,
      payload: { skillId: "s", actionId: "i1", spCost: 0, actorId: "HERO_A", type: "skill" },
    });

    const state = engine.run();
    const actor = state.getActor("HERO_A");
    const snap = actor.snapshot();

    expect(snap.activeBuffs.size).toBe(1);
    const entries = [...snap.activeBuffs.entries()];
    expect(entries[0]).toBeDefined();
    const buffSnap = entries[0]![1];
    expect(buffSnap.id).toBe("atk_up");
    expect(buffSnap.properties.value).toBe(50);
  });

  it("should produce deterministic results across multiple runs", () => {
    function runOnce() {
      const actors = [makeActor("HERO_A")];
      const engine = makeMinimalEngine(actors);

      let counter = 0;
      const passiveEffect = new Effect({
        id: "det_passive",
        tags: [],
        duration: Infinity,
        triggers: [
          {
            event: "ACTION_START",
            action: () => { counter++; },
          },
        ],
      });

      engine.registerPassiveEffect("HERO_A", passiveEffect);

      for (let i = 0; i < 5; i++) {
        engine.enqueue({
          type: "ACTION_START",
          time: i * 2.0,
          payload: { skillId: "s", actionId: `i${i}`, spCost: 0, actorId: "HERO_A", type: "skill" },
        });
      }

      const state = engine.run();
      return { counter, sp: state.team.getSp() };
    }

    const r1 = runOnce();
    const r2 = runOnce();
    const r3 = runOnce();

    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });
});
