import { describe, it, expect } from "vitest";
import {
  applySkillMultiplierOverlay,
  getSkillMultiplier,
} from "./skillMultipliers";

describe("applySkillMultiplierOverlay", () => {
  const baseTick = {
    offset: 0.5,
    sp: 0,
    stagger: 0,
    realTime: 1,
    realOffset: 0.5,
    time: 1,
  };

  it("does not overwrite an explicit non-zero multiplier", () => {
    const out = applySkillMultiplierOverlay("ENDMINISTRATOR", "skill", 0, {
      ...baseTick,
      multiplier: 9.99,
    });
    expect(out.multiplier).toBe(9.99);
  });

  it("fills missing multiplier from SKILL_MULTIPLIERS overlay", () => {
    const out = applySkillMultiplierOverlay("ENDMINISTRATOR", "skill", 0, {
      ...baseTick,
    });
    expect(out.multiplier).toBe(getSkillMultiplier("ENDMINISTRATOR", "skill", 0));
    expect(out.multiplier).toBeGreaterThan(0);
  });

  it("fills zero multiplier from overlay (treats 0 as absent)", () => {
    const out = applySkillMultiplierOverlay("ENDMINISTRATOR", "skill", 0, {
      ...baseTick,
      multiplier: 0,
    });
    expect(out.multiplier).toBe(2.8);
  });
});
