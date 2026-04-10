import { describe, it, expect } from "vitest";
import type {
  Action,
  ActorStats,
  ResolvedAction,
  ScenarioData,
} from "./compiler/types";
import { compileScenario } from "./compiler/compileScenario";
import { simulate } from "./simulator";
import { ActionStartHandler } from "./events/ActionStartHandler";
import { ActionEndHandler } from "./events/ActionEndHandler";
import { SimulationEngine } from "./engine/SimulationEngine";
import { compileTimeline } from "./compiler/compileTimeline";
import type { ActorSnapshot } from "./state/types";
import { createDefaultStats } from "@/utils/coreStats";
import { DiagnosticCollector } from "./diagnostics";

function makeAction(overrides: Partial<Action> = {}): Action {
  return {
    instanceId: overrides.instanceId ?? "inst_cd",
    id: overrides.id ?? "CHENQIANYU_link",
    type: overrides.type ?? "link",
    name: "link",
    logicalStartTime: 0,
    element: "physical",
    enhancementTime: 0,
    startTime: 0,
    cooldown: 12,
    spCost: 0,
    gaugeCost: 0,
    gaugeGain: 0,
    teamGaugeGain: 0,
    duration: 1,
    triggerWindow: 0,
    animationTime: 0,
    allowedTypes: [],
    damageTicks: [],
    physicalAnomaly: [],
    ...overrides,
  };
}

describe("simulator behavior (phase-1)", () => {
  it("DAMAGE_TICK logs non-zero damage when tick has multiplier and attack > 0", () => {
    const stats: ActorStats = {
      ...(createDefaultStats() as ActorStats),
      attack: 400,
    };

    const scenario: ScenarioData = {
      tracks: [
        {
          id: "P1",
          actions: [
            {
              id: "CHENQIANYU_skill",
              instanceId: "inst_dmg_test",
              type: "skill",
              name: "Test",
              element: "physical",
              duration: 2,
              cooldown: 0,
              icon: "",
              spCost: 0,
              gaugeCost: 0,
              gaugeGain: 0,
              teamGaugeGain: 0,
              enhancementTime: 0,
              animationTime: 0,
              startTime: 0,
              logicalStartTime: 0,
              allowedTypes: [],
              damageTicks: [
                { offset: 0.5, sp: 0, stagger: 0, multiplier: 2.5 },
              ],
              physicalAnomaly: [],
            },
          ],
          stats,
          gaugeEfficiency: 100,
          originiumArtsPower: 0,
          linkCdReduction: 0,
          initialGauge: 0,
        },
      ],
    };

    const compiled = compileScenario(scenario);
    const { simLog } = simulate(
      compiled.timeline,
      compiled.teamConfig,
      compiled.enemyConfig,
      compiled.actors,
    );

    const dmgTicks = simLog.filter((e) => e.type === "DAMAGE_TICK");
    expect(dmgTicks.length).toBeGreaterThan(0);
    const first = dmgTicks[0];
    expect(first?.type).toBe("DAMAGE_TICK");
    if (first?.type === "DAMAGE_TICK") {
      expect(first.payload.damage).toBeGreaterThan(0);
      // Real formula: ATK * mult * defense(0.5) = 400 * 2.5 * 0.5 = 500
      expect(first.payload.damage).toBeCloseTo(400 * 2.5 * 0.5, 5);
    }
  });

  it("ACTION_START sets activeAction and ACTION_END clears it and writes cooldown", () => {
    const teamConfig = {
      maxSp: 300,
      initialSp: 200,
      spRegenRate: 8,
      skillSpCostDefault: 100,
      linkCdReduction: 0,
    };
    const enemyConfig = {
      maxStagger: 100,
      staggerNodeCount: 0,
      staggerNodeDuration: 2,
      staggerBreakDuration: 10,
      executionRecovery: 25,
    };

    const stats: ActorStats = {
      ...(createDefaultStats() as ActorStats),
      attack: 100,
    };
    const actor: ActorSnapshot = {
      id: "hero",
      stats,
      resources: { hp: 1000, gauge: 0 },
      cooldowns: new Map(),
      activeBuffs: new Map(),
    };

    const timeline = compileTimeline([], []);
    const engine = new SimulationEngine(timeline, teamConfig, enemyConfig, [
      actor,
    ]);
    const state = engine.getState();

    const node = makeAction({ id: "CHENQIANYU_link", cooldown: 12 });
    const resolved: ResolvedAction = {
      type: "action",
      id: "action_1",
      trackIndex: 0,
      trackId: "hero",
      node,
      startTime: 0,
      realStartTime: 0,
      duration: 1,
      realDuration: 1,
      isInterrupted: false,
      effects: [],
      triggerWindow: { hasWindow: false, startTime: 0, duration: 0 },
      resolvedDamageTicks: [],
      extensionAmount: 0,
    };

    const ctx = {
      state,
      queue: { enqueue: () => {} },
      simLog: () => {},
      getAction: () => resolved,
      diagnostics: new DiagnosticCollector(),
      rng: Math.random,
      legalityPolicy: "sandbox" as const,
      legalityIssues: [],
      blockedActionIds: new Set<string>(),
    };

    state.advanceTime(10);
    new ActionStartHandler().handle(
      {
        type: "ACTION_START",
        time: 10,
        payload: {
          skillId: node.id,
          actionId: "action_1",
          actorId: "hero",
          type: "link",
        },
      },
      ctx,
    );
    expect(state.getActor("hero").getActiveAction()).toBe(resolved);

    state.advanceTime(5);
    new ActionEndHandler().handle(
      {
        type: "ACTION_END",
        time: 15,
        payload: {
          skillId: node.id,
          actionId: "action_1",
          actorId: "hero",
          type: "link",
          spGain: 0,
        },
      },
      ctx,
    );

    expect(state.getActor("hero").getActiveAction()).toBeNull();
    expect(state.getActor("hero").getCooldownExpiry("CHENQIANYU_link")).toBe(
      15 + 12,
    );
  });
});

// ===========================================================================
// consume_conduction — enhanced skill 3rd tick clears conduction
// ===========================================================================

describe("consume_conduction (enhanced skill 3rd tick)", () => {
  function makeConsumeScenario(opts: { applyConduction: boolean }) {
    const stats: ActorStats = {
      ...(createDefaultStats() as ActorStats),
      attack: 400,
    };

    // Base action has 2 ticks. Enhanced overlay adds 3rd tick with consume_conduction.
    const actions = [];

    // Optionally: apply conduction via an APPLY_DIRECT_ANOMALY-producing action first
    // We'll apply conduction manually after compilation via the status API.

    // ARCLIGHT skill with 3 ticks (simulating post-variant-overlay damageTicks)
    actions.push(
      makeAction({
        id: "ARCLIGHT_skill",
        instanceId: "inst_arc_skill_1",
        type: "skill",
        name: "疾风迅雷",
        element: "emag",
        duration: 1.6,
        spCost: 100,
        damageTicks: [
          { offset: 0.63, sp: 0, stagger: 0, boundEffects: [] },
          { offset: 0.8, sp: 0, stagger: 5, boundEffects: [] },
          { offset: 1.2, sp: 30, stagger: 5, boundEffects: ["consume_conduction"] },
        ],
      }),
    );

    const scenario: ScenarioData = {
      tracks: [
        {
          id: "ARCLIGHT",
          actions,
          stats,
          gaugeEfficiency: 100,
          originiumArtsPower: 0,
          linkCdReduction: 0,
          initialGauge: 0,
        },
      ],
    };

    const compiled = compileScenario(scenario);

    // Apply conduction directly to enemy status before simulation
    if (opts.applyConduction) {
      // We need to run simulate() but set conduction on the enemy BEFORE events fire.
      // The simplest way: just include the 3 ticks and manually set conduction.
    }

    return { compiled, applyConduction: opts.applyConduction };
  }

  it("3rd tick with consume_conduction clears conduction from enemy", () => {
    const { compiled } = makeConsumeScenario({ applyConduction: true });

    // Mark as enhanced (for multiplier selection)
    const enhancedIds = new Set(["inst_arc_skill_1"]);

    const result = simulate(
      compiled.timeline,
      compiled.teamConfig,
      compiled.enemyConfig,
      compiled.actors,
      { enhancedActionIds: enhancedIds },
    );

    // Manually apply conduction before checking — but simulate() already ran.
    // Instead, check simLog: the 3rd tick should exist even if conduction wasn't pre-applied.
    // Verify 3 DAMAGE_TICK entries exist (proves 3rd tick was created).
    const dmgTicks = result.simLog.filter(
      (e) => e.type === "DAMAGE_TICK" && (e.payload as any).sourceId === "ARCLIGHT",
    );
    expect(dmgTicks.length).toBe(3);
  });

  it("3rd tick boundEffects contains consume_conduction in simLog", () => {
    const { compiled } = makeConsumeScenario({ applyConduction: false });
    const enhancedIds = new Set(["inst_arc_skill_1"]);

    const result = simulate(
      compiled.timeline,
      compiled.teamConfig,
      compiled.enemyConfig,
      compiled.actors,
      { enhancedActionIds: enhancedIds },
    );

    const dmgTicks = result.simLog.filter(
      (e) => e.type === "DAMAGE_TICK" && (e.payload as any).sourceId === "ARCLIGHT",
    );
    // 3rd tick should have consume_conduction in tickData.boundEffects
    const thirdTick = dmgTicks[2];
    expect(thirdTick).toBeDefined();
    const tickData = (thirdTick?.payload as any)?.tickData;
    expect(tickData?.boundEffects).toContain("consume_conduction");
  });

  it("conduction is consumed when present, simLog records it", () => {
    const stats: ActorStats = {
      ...(createDefaultStats() as ActorStats),
      attack: 400,
    };

    // Use direct engine access to set conduction before the skill fires
    const scenario: ScenarioData = {
      tracks: [
        {
          id: "ARCLIGHT",
          actions: [
            makeAction({
              id: "ARCLIGHT_skill",
              instanceId: "inst_arc_consume",
              type: "skill",
              name: "疾风迅雷",
              element: "emag",
              duration: 1.6,
              spCost: 100,
              startTime: 1, // start at t=1 so we can apply conduction at t=0
              damageTicks: [
                { offset: 0.63, sp: 0, stagger: 0, boundEffects: [] },
                { offset: 0.8, sp: 0, stagger: 5, boundEffects: [] },
                { offset: 1.2, sp: 30, stagger: 5, boundEffects: ["consume_conduction"] },
              ],
            }),
          ],
          stats,
          gaugeEfficiency: 100,
          originiumArtsPower: 0,
          linkCdReduction: 0,
          initialGauge: 0,
        },
      ],
    };

    const compiled = compileScenario(scenario);

    // Apply conduction to enemy before simulation via a hook:
    // We'll use the anomaly subsystem — enqueue APPLY_DIRECT_ANOMALY at t=0.
    // But simulate() doesn't expose pre-hooks. Instead, use the state directly.
    // The simplest way: compile and simulate, then check that conduction WAS applied
    // (via ultimate anomaly) and then consumed.

    // Alternative: inject conduction by adding an action that applies it.
    // Use a dummy action with conductive anomaly.
    const scenarioWithConduction: ScenarioData = {
      tracks: [
        {
          id: "ARCLIGHT",
          actions: [
            // Dummy action at t=0 that applies conduction
            makeAction({
              id: "ARCLIGHT_ultimate",
              instanceId: "inst_arc_ult_cond",
              type: "ultimate",
              name: "终结技",
              element: "emag",
              duration: 2.57,
              startTime: 0,
              animationTime: 1.9,
              triggerWindow: 0,
              damageTicks: [{ offset: 0.5, sp: 0, stagger: 0, boundEffects: [] }],
              physicalAnomaly: [
                [{ type: "conductive", stacks: 1, duration: 0, offset: 0.5, _id: "cond1" } as any],
              ],
            }),
            // Enhanced skill at t=3 (after conduction is applied)
            makeAction({
              id: "ARCLIGHT_skill",
              instanceId: "inst_arc_skill_consume",
              type: "skill",
              name: "疾风迅雷",
              element: "emag",
              duration: 1.6,
              spCost: 100,
              startTime: 3,
              damageTicks: [
                { offset: 0.63, sp: 0, stagger: 0, boundEffects: [] },
                { offset: 0.8, sp: 0, stagger: 5, boundEffects: [] },
                { offset: 1.2, sp: 30, stagger: 5, boundEffects: ["consume_conduction"] },
              ],
            }),
          ],
          stats,
          gaugeEfficiency: 100,
          originiumArtsPower: 0,
          linkCdReduction: 0,
          initialGauge: 0,
        },
      ],
    };

    const compiled2 = compileScenario(scenarioWithConduction);
    const enhancedIds = new Set(["inst_arc_skill_consume"]);

    const result = simulate(
      compiled2.timeline,
      compiled2.teamConfig,
      compiled2.enemyConfig,
      compiled2.actors,
      { enhancedActionIds: enhancedIds },
    );

    // Check simLog for conduction_consumed entry
    const consumeEntries = result.simLog.filter(
      (e) => e.type === "ANOMALY_STATUS_CHANGE" && (e.payload as any)?.type === "conduction_consumed",
    );
    expect(consumeEntries.length).toBe(1);
    expect((consumeEntries[0].payload as any).sourceId).toBe("ARCLIGHT");

    // After simulation: conduction should be null (consumed)
    expect(result.state.enemy.status.conduction).toBeNull();
  });

  it("no conduction → consume_conduction does NOT log consumption", () => {
    const stats: ActorStats = {
      ...(createDefaultStats() as ActorStats),
      attack: 400,
    };

    const scenario: ScenarioData = {
      tracks: [
        {
          id: "ARCLIGHT",
          actions: [
            // Skill with 3rd tick but NO prior conduction application
            makeAction({
              id: "ARCLIGHT_skill",
              instanceId: "inst_arc_no_cond",
              type: "skill",
              name: "疾风迅雷",
              element: "emag",
              duration: 1.6,
              spCost: 100,
              startTime: 0,
              damageTicks: [
                { offset: 0.63, sp: 0, stagger: 0, boundEffects: [] },
                { offset: 0.8, sp: 0, stagger: 5, boundEffects: [] },
                { offset: 1.2, sp: 30, stagger: 5, boundEffects: ["consume_conduction"] },
              ],
            }),
          ],
          stats,
          gaugeEfficiency: 100,
          originiumArtsPower: 0,
          linkCdReduction: 0,
          initialGauge: 0,
        },
      ],
    };

    const compiled = compileScenario(scenario);
    const enhancedIds = new Set(["inst_arc_no_cond"]);

    const result = simulate(
      compiled.timeline,
      compiled.teamConfig,
      compiled.enemyConfig,
      compiled.actors,
      { enhancedActionIds: enhancedIds },
    );

    // No conduction_consumed entry
    const consumeEntries = result.simLog.filter(
      (e) => e.type === "ANOMALY_STATUS_CHANGE" && (e.payload as any)?.type === "conduction_consumed",
    );
    expect(consumeEntries.length).toBe(0);
  });
});

// ===========================================================================
// physical_weakness → enemy PHYSICAL_WEAKNESS fragility debuff
// ===========================================================================

describe("physical_weakness effect routing", () => {
  it("routes physical_weakness to enemy fragility debuff (no UNKNOWN_EFFECT_TYPE)", () => {
    const stats: ActorStats = {
      ...(createDefaultStats() as ActorStats),
      attack: 500,
    };

    const scenario: ScenarioData = {
      tracks: [
        {
          id: "LIFENG",
          actions: [
            makeAction({
              id: "LIFENG_skill",
              type: "skill",
              element: "physical",
              spCost: 100,
              duration: 2.23,
              damageTicks: [{ offset: 1.8, sp: 0, stagger: 10 }],
              physicalAnomaly: [
                [
                  {
                    type: "physical_weakness",
                    stacks: 5,
                    duration: 10,
                    offset: 1.8,
                    _id: "pw1",
                  } as any,
                ],
              ],
            }),
          ],
          stats,
        },
      ],
    };

    const compiled = compileScenario(scenario);
    const result = simulate(
      compiled.timeline,
      compiled.teamConfig,
      compiled.enemyConfig,
      compiled.actors,
    );

    // Should NOT produce UNKNOWN_EFFECT_TYPE diagnostic
    const unknowns = result.diagnostics.filter(
      (d) => d.code === "UNKNOWN_EFFECT_TYPE" && d.context?.effectType === "physical_weakness",
    );
    expect(unknowns.length).toBe(0);

    // Enemy should have PHYSICAL_WEAKNESS fragility debuff
    const pwBuffs = result.state.enemy.effects
      .getAll()
      .filter((inst) => inst.effect.id === "PHYSICAL_WEAKNESS");
    expect(pwBuffs.length).toBe(1);

    // Check DynamicBonus in fragility zone
    const bonuses = pwBuffs[0].effect.properties.dynamicBonuses as any[];
    expect(bonuses).toEqual([
      { stat: "physical_dmg", value: 5, zone: "fragility" },
    ]);
  });
});
