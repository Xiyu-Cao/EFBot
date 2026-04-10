import { describe, it, expect } from "vitest";
import { checkActionLegality } from "./checkActionLegality";
import type { LegalityPolicy } from "./types";
import {
  ISSUE_SP_INSUFFICIENT,
  ISSUE_GAUGE_INSUFFICIENT,
  ISSUE_COOLDOWN_ACTIVE,
  ISSUE_CONDITION_NOT_MET,
  shouldBlockAction,
} from "./types";
import { GameState } from "../state/GameState";
import { SimulationEngine } from "../engine/SimulationEngine";
import type { ActionStartEvent } from "../events/event.types";
import type { ResolvedTimeline } from "../compiler/types";
import { Effect } from "../effects/types";

// Minimal timeline stub
const emptyTimeline: ResolvedTimeline = {
  actions: [],
  actionMap: new Map(),
  effectMap: new Map(),
  timeExtensions: [],
  timeContext: { getShiftedEndTime: (s: number, d: number) => s + d } as any,
  meta: { totalDuration: 60 },
};

const teamConfig = {
  maxSp: 300,
  initialSp: 200,
  spRegenRate: 8.5,
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

function makeEngine() {
  const engine = new SimulationEngine(
    emptyTimeline,
    teamConfig,
    enemyConfig,
    [
      {
        id: "HERO_A",
        stats: {
          primary_ability: 0, secondary_ability: 0,
          strength: 0, agility: 0, intellect: 0, will: 0,
          attack: 100, hp: 0,
          crit_rate: 5, crit_dmg: 50,
          blaze_dmg: 0, emag_dmg: 0, cold_dmg: 0, nature_dmg: 0,
          healing_effect: 0, physical_dmg: 0, arts_dmg: 0,
          attack_dmg_bonus: 0, skill_dmg_bonus: 0, link_dmg_bonus: 0,
          ultimate_dmg_bonus: 0, all_skill_dmg_bonus: 0, broken_dmg_bonus: 0,
          originium_arts_power: 0, ult_charge_eff: 100, link_cd_reduction: 0,
        },
        resources: { hp: 0, gauge: 30, maxGauge: 60 },
        cooldowns: new Map(),
        activeBuffs: new Map(),
      },
    ],
  );
  return engine;
}

function makeSkillEvent(overrides?: Partial<ActionStartEvent["payload"]>): ActionStartEvent {
  return {
    type: "ACTION_START",
    time: 1.0,
    payload: {
      skillId: "HERO_A_skill",
      actionId: "inst_1",
      spCost: 100,
      gaugeCost: 0,
      actorId: "HERO_A",
      type: "skill",
      ...overrides,
    },
  };
}

describe("checkActionLegality", () => {
  it("returns no issues when resources are sufficient", () => {
    const engine = makeEngine();
    const state = engine.getState();
    const event = makeSkillEvent({ spCost: 50 });

    const issues = checkActionLegality(event, state, "strict");
    expect(issues).toHaveLength(0);
  });

  it("detects SP_INSUFFICIENT", () => {
    const engine = makeEngine();
    const state = engine.getState();
    // initialSp = 200, cost = 250
    const event = makeSkillEvent({ spCost: 250 });

    const issues = checkActionLegality(event, state, "sandbox");
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe(ISSUE_SP_INSUFFICIENT);
    expect(issues[0].severity).toBe("error");
    expect(issues[0].resolution).toBe("allowed"); // sandbox
  });

  it("SP_INSUFFICIENT is blocked in strict mode", () => {
    const engine = makeEngine();
    const state = engine.getState();
    const event = makeSkillEvent({ spCost: 250 });

    const issues = checkActionLegality(event, state, "strict");
    expect(issues).toHaveLength(1);
    expect(issues[0].resolution).toBe("blocked");
    expect(shouldBlockAction(issues)).toBe(true);
  });

  it("SP_INSUFFICIENT is warned in audit mode", () => {
    const engine = makeEngine();
    const state = engine.getState();
    const event = makeSkillEvent({ spCost: 250 });

    const issues = checkActionLegality(event, state, "audit");
    expect(issues).toHaveLength(1);
    expect(issues[0].resolution).toBe("warned");
    expect(shouldBlockAction(issues)).toBe(false);
  });

  it("detects GAUGE_INSUFFICIENT for ultimate", () => {
    const engine = makeEngine();
    const state = engine.getState();
    // gauge = 30, cost = 60
    const event = makeSkillEvent({
      type: "ultimate",
      spCost: 0,
      gaugeCost: 60,
    });

    const issues = checkActionLegality(event, state, "strict");
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe(ISSUE_GAUGE_INSUFFICIENT);
    expect(issues[0].resolution).toBe("blocked");
  });

  it("no gauge issue when gauge is full (gauge >= maxGauge)", () => {
    const engine = makeEngine();
    const state = engine.getState();
    // Fill gauge to max (60) so ultimate can be cast
    const actor = state.getActor("HERO_A");
    actor.modifyGauge(60 - actor.getGauge()); // set to 60
    const event = makeSkillEvent({
      type: "ultimate",
      spCost: 0,
      gaugeCost: 25,
    });

    const issues = checkActionLegality(event, state, "strict");
    expect(issues).toHaveLength(0);
  });

  it("detects COOLDOWN_ACTIVE for link", () => {
    const engine = makeEngine();
    const state = engine.getState();
    // Set cooldown that expires at time 10
    const actor = state.getActor("HERO_A");
    actor.setCooldown("HERO_A_link", 10);

    const event = makeSkillEvent({
      skillId: "HERO_A_link",
      type: "link",
      spCost: 0,
      gaugeCost: 0,
    });
    // event.time = 1.0, cooldown expires at 10 → still on CD

    const issues = checkActionLegality(event, state, "strict");
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe(ISSUE_COOLDOWN_ACTIVE);
    expect(issues[0].resolution).toBe("blocked");
  });

  it("no cooldown issue after CD expires", () => {
    const engine = makeEngine();
    const state = engine.getState();
    const actor = state.getActor("HERO_A");
    actor.setCooldown("HERO_A_link", 0.5); // expires before event time

    const event = makeSkillEvent({
      skillId: "HERO_A_link",
      type: "link",
      spCost: 0,
      gaugeCost: 0,
    });

    const issues = checkActionLegality(event, state, "strict");
    expect(issues).toHaveLength(0);
  });

  it("can detect multiple issues at once", () => {
    const engine = makeEngine();
    const state = engine.getState();
    const event = makeSkillEvent({
      type: "ultimate",
      spCost: 999,
      gaugeCost: 999,
    });

    const issues = checkActionLegality(event, state, "audit");
    expect(issues.length).toBeGreaterThanOrEqual(2);
    const codes = issues.map((i) => i.code);
    expect(codes).toContain(ISSUE_SP_INSUFFICIENT);
    expect(codes).toContain(ISSUE_GAUGE_INSUFFICIENT);
  });

  // --- Cooldown applies to skill type too ---
  it("detects COOLDOWN_ACTIVE for skill (not just link)", () => {
    const engine = makeEngine();
    const state = engine.getState();
    const actor = state.getActor("HERO_A");
    actor.setCooldown("HERO_A_skill", 10);

    const event = makeSkillEvent({
      skillId: "HERO_A_skill",
      type: "skill",
      spCost: 0,
    });

    const issues = checkActionLegality(event, state, "strict");
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe(ISSUE_COOLDOWN_ACTIVE);
  });

  // --- Condition checks ---
  it("detects CONDITION_NOT_MET when link requires knockup but no effect present", () => {
    const engine = makeEngine();
    const state = engine.getState();
    const event = makeSkillEvent({
      type: "link",
      spCost: 0,
      gaugeCost: 0,
      allowedTypes: ["knockup"],
    });

    const issues = checkActionLegality(event, state, "strict");
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe(ISSUE_CONDITION_NOT_MET);
    expect(issues[0].resolution).toBe("blocked");
  });

  it("no condition issue when required effect is present", () => {
    const engine = makeEngine();
    const state = engine.getState();

    // Apply a PHYSICAL_LIFT effect to enemy
    const liftEffect = Effect.PhysicalLift().clone();
    liftEffect.startTime = 0;
    state.enemy.effects.add(liftEffect);

    const event = makeSkillEvent({
      type: "link",
      spCost: 0,
      gaugeCost: 0,
      allowedTypes: ["knockup"],
    });

    const issues = checkActionLegality(event, state, "strict");
    expect(issues).toHaveLength(0);
  });

  it("condition met if any one of allowedTypes matches (OR semantics)", () => {
    const engine = makeEngine();
    const state = engine.getState();

    // Apply cold attachment to enemy
    state.enemy.status.applyMagicAttachment("cold", 0);

    const event = makeSkillEvent({
      type: "link",
      spCost: 0,
      gaugeCost: 0,
      allowedTypes: ["knockup", "cold_attach", "frozen"],
    });

    const issues = checkActionLegality(event, state, "strict");
    expect(issues).toHaveLength(0); // cold_attach satisfied
  });

  it("unknown conditions are assumed met (no false blocking)", () => {
    const engine = makeEngine();
    const state = engine.getState();
    const event = makeSkillEvent({
      type: "link",
      spCost: 0,
      gaugeCost: 0,
      allowedTypes: ["endmin_debuff"],
    });

    const issues = checkActionLegality(event, state, "strict");
    expect(issues).toHaveLength(0); // unknown condition → assumed met
  });

  it("empty allowedTypes means no condition required", () => {
    const engine = makeEngine();
    const state = engine.getState();
    const event = makeSkillEvent({
      type: "link",
      spCost: 0,
      gaugeCost: 0,
      allowedTypes: [],
    });

    const issues = checkActionLegality(event, state, "strict");
    expect(issues).toHaveLength(0);
  });
});
