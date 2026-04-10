/**
 * Attribute-scaling talent effect tests.
 *
 * Verifies the scaling computation for talents like LIFENG 顿悟:
 *   attack_percent += (intellect + will) × perPoint
 *
 * These tests validate the data format and the formula independently
 * of the full store (which has too many dependencies for unit testing).
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Pure scaling formula (mirrors the logic in resolveTrackConfiguredStats)
// ---------------------------------------------------------------------------

function computeAttributeScaling(
  effect: { stat: string; scaling: { from: string[]; perPoint: number } },
  attributes: Record<string, number>,
): number {
  const { from, perPoint } = effect.scaling;
  let attrSum = 0;
  for (const attr of from) {
    attrSum += attributes[attr] || 0;
  }
  return attrSum * perPoint;
}

// ---------------------------------------------------------------------------
// LIFENG 顿悟 — attribute-scaling ATK%
// ---------------------------------------------------------------------------

describe("LIFENG 顿悟 (Enlightenment) — attribute-scaling ATK%", () => {
  const lowTier = {
    stat: "attack_percent",
    scaling: { from: ["intellect", "will"], perPoint: 0.10 },
  };

  const highTier = {
    stat: "attack_percent",
    scaling: { from: ["intellect", "will"], perPoint: 0.15 },
  };

  it("low tier: intellect=100, will=50 → +15% attack_percent", () => {
    const result = computeAttributeScaling(lowTier, { intellect: 100, will: 50 });
    expect(result).toBeCloseTo(15, 5);
  });

  it("high tier: intellect=100, will=50 → +22.5% attack_percent", () => {
    const result = computeAttributeScaling(highTier, { intellect: 100, will: 50 });
    expect(result).toBeCloseTo(22.5, 5);
  });

  it("low tier: intellect=200, will=100 → +30% attack_percent", () => {
    const result = computeAttributeScaling(lowTier, { intellect: 200, will: 100 });
    expect(result).toBeCloseTo(30, 5);
  });

  it("high tier: intellect=200, will=100 → +45% attack_percent", () => {
    const result = computeAttributeScaling(highTier, { intellect: 200, will: 100 });
    expect(result).toBeCloseTo(45, 5);
  });

  it("zero attributes → 0% bonus", () => {
    const result = computeAttributeScaling(lowTier, { intellect: 0, will: 0 });
    expect(result).toBe(0);
  });

  it("missing attributes → 0% bonus", () => {
    const result = computeAttributeScaling(lowTier, {});
    expect(result).toBe(0);
  });

  it("only one attribute present → scales from that attribute only", () => {
    const result = computeAttributeScaling(highTier, { intellect: 200 });
    // 200 × 0.15 = 30
    expect(result).toBeCloseTo(30, 5);
  });
});

// ---------------------------------------------------------------------------
// Talent data format validation
// ---------------------------------------------------------------------------

describe("LIFENG talents.json data format", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let talents: any;

  it("loads LIFENG talents.json", async () => {
    const mod = await import("../../data/operators/LIFENG/talents.json");
    talents = mod.default || mod;
    expect(talents).toBeDefined();
  });

  it("顿悟 has two stages with scaling effects", () => {
    const dunwu = talents.talents.find((t: any) => t.id === "talent_0");
    expect(dunwu).toBeDefined();
    expect(dunwu.stages.length).toBe(2);

    // Stage 1 (low tier)
    const s1 = dunwu.stages[0];
    expect(s1.effects[0].type).toBe("stat_bonus");
    expect(s1.effects[0].stat).toBe("attack_percent");
    expect(s1.effects[0].scope).toBe("static");
    expect(s1.effects[0].scaling).toEqual({ from: ["intellect", "will"], perPoint: 0.10 });

    // Stage 2 (high tier)
    const s2 = dunwu.stages[1];
    expect(s2.effects[0].scaling).toEqual({ from: ["intellect", "will"], perPoint: 0.15 });
  });
});
