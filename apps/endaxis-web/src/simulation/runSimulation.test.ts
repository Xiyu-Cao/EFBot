import { describe, it, expect } from "vitest";
import { runSimulation } from "./runSimulation";
import { compileScenario } from "./compiler/compileScenario";
import { simulate } from "./simulator";
import { simulatorFixture1 } from "./fixture/simulator.fixture";

describe("runSimulation", () => {
  it("should return compiled, state, simLog, and diagnostics", () => {
    const result = runSimulation(simulatorFixture1.scenario);

    expect(result.compiled).toBeDefined();
    expect(result.compiled.timeline).toBeDefined();
    expect(result.compiled.actors.length).toBeGreaterThan(0);
    expect(result.state).toBeDefined();
    expect(result.simLog).toBeDefined();
    expect(Array.isArray(result.diagnostics)).toBe(true);
  });

  it("should produce UNKNOWN_EFFECT_TYPE diagnostics for unmapped types", () => {
    // The fixture contains "endmin_debuff" and "frozen" and "ice_shatter"
    // which are not in SCNEARIO_EFFECT_TYPE_MAP
    const result = runSimulation(simulatorFixture1.scenario);

    const unknowns = result.diagnostics.filter(
      (d) => d.code === "UNKNOWN_EFFECT_TYPE",
    );

    // "endmin_debuff", "frozen", "ice_shatter", "break" are not in the map
    expect(unknowns.length).toBeGreaterThan(0);

    // Each diagnostic should have context
    for (const d of unknowns) {
      expect(d.severity).toBe("warning");
      expect(d.context?.effectType).toBeDefined();
      expect(d.context?.actionId).toBeDefined();
    }
  });

  it("should still produce valid SP and stagger simulation", () => {
    const result = runSimulation(simulatorFixture1.scenario);

    // Should have ACTION_START / ACTION_END / SP_CHANGE / STAGGER entries
    const types = new Set(result.simLog.map((e) => e.type));
    expect(types.has("ACTION_START")).toBe(true);
    expect(types.has("ACTION_END")).toBe(true);
    expect(types.has("SP_CHANGE")).toBe(true);
    expect(types.has("STAGGER")).toBe(true);
  });

  it("merges compile-stage and simulate-stage diagnostics in order", () => {
    const scenario = simulatorFixture1.scenario;
    const compiled = compileScenario(scenario);
    const { diagnostics: simulateDiagnostics } = simulate(
      compiled.timeline,
      compiled.teamConfig,
      compiled.enemyConfig,
      compiled.actors,
    );
    const merged = [...compiled.diagnostics, ...simulateDiagnostics];

    const result = runSimulation(scenario);
    expect(result.diagnostics).toEqual(merged);
  });
});
