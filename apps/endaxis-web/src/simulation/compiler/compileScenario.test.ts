import { describe, it, expect } from "vitest";
import { scenario } from "./fixture/scenario-2";
import { normalizeScenario } from "./compileScenario";

describe("normalizeScenario", () => {
  it("should normalize a scenario", () => {
    const result = normalizeScenario(scenario);

    expect(result).toBeDefined();
    expect(result.tracks).toBeDefined();
    expect(result.actions).toMatchSnapshot();
    expect(result.actors).toBeDefined();
  });
});
