import { describe, it, expect } from "vitest";
import { DamageResolver } from "./DamageResolver";
import type { DamageContext } from "./type";
import type { ActorSnapshot } from "../state/types";
import { SimulationEngine } from "../engine/SimulationEngine";
import { compileTimeline } from "../compiler/compileTimeline";
import type { ActorStats } from "../compiler/types";
import { createDefaultStats } from "@/utils/coreStats";
import { buildDamageTags, type DamageTags } from "./damageTypes";
import { NO_CRIT, type CritResult } from "./critSystem";

function createTestContext(
  overrides: Partial<{
    attack: number;
    multiplier: number;
    damageSource: DamageTags["damageSource"];
    damageType: DamageTags["damageType"];
    skillDmgBonus: number;
    brokenDmgBonus: number;
    critOverride: CritResult;
    primaryAbility: number;
    secondaryAbility: number;
  }> = {},
): DamageContext {
  const stats: ActorStats = {
    ...(createDefaultStats() as ActorStats),
    attack: overrides.attack ?? 1000,
    skill_dmg_bonus: overrides.skillDmgBonus ?? 0,
    broken_dmg_bonus: overrides.brokenDmgBonus ?? 0,
    primary_ability: overrides.primaryAbility ?? 0,
    secondary_ability: overrides.secondaryAbility ?? 0,
  };

  const actor: ActorSnapshot = {
    id: "TEST_ACTOR",
    stats,
    resources: { hp: 1000, gauge: 0 },
    cooldowns: new Map(),
    activeBuffs: new Map(),
  };

  const emptyTimeline = compileTimeline([], []);
  const engine = new SimulationEngine(
    emptyTimeline,
    {
      maxSp: 300,
      initialSp: 200,
      spRegenRate: 8,
      skillSpCostDefault: 100,
      linkCdReduction: 0,
    },
    {
      maxStagger: 100,
      staggerNodeCount: 0,
      staggerNodeDuration: 2,
      staggerBreakDuration: 10,
      executionRecovery: 25,
    },
    [actor],
  );

  const tags = buildDamageTags({
    sourceActorId: "TEST_ACTOR",
    targetEnemyId: "boss",
    damageType: overrides.damageType ?? "physical",
    damageSource: overrides.damageSource ?? "activeSkill",
  });

  return {
    source: actor,
    target: engine.getState().enemy,
    state: engine.getState(),
    multiplier: overrides.multiplier ?? 1.5,
    damageTags: tags,
    // Force no crit by default so tests are deterministic
    critOverride: overrides.critOverride ?? NO_CRIT,
  };
}

describe("DamageResolver", () => {
  it("computes base damage = ATK * multiplier with defense zone", () => {
    const resolver = new DamageResolver();
    const ctx = createTestContext({ attack: 1000, multiplier: 1.5 });
    const result = resolver.resolve(ctx);

    // ATK = 1000 (no abilities), base = 1000 * 1.5 = 1500
    // Defense zone = 0.5 → final = 1500 * 0.5 = 750
    expect(result.baseValue).toBe(1500);
    expect(result.finalValue).toBe(750);
  });

  it("returns 0 damage when multiplier is 0", () => {
    const resolver = new DamageResolver();
    const ctx = createTestContext({ attack: 1000, multiplier: 0 });
    const result = resolver.resolve(ctx);

    expect(result.baseValue).toBe(0);
    expect(result.finalValue).toBe(0);
  });

  it("applies skill type bonus in DamageBonus zone", () => {
    const resolver = new DamageResolver();
    const ctx = createTestContext({
      attack: 1000,
      multiplier: 1.0,
      damageSource: "activeSkill",
      skillDmgBonus: 50, // +50%
    });
    const result = resolver.resolve(ctx);

    // Base = 1000 * 1.0 = 1000
    // Defense = 0.5
    // DamageBonus = 1 + 50/100 = 1.50
    // Final = 1000 * 0.5 * 1.50 = 750
    expect(result.baseValue).toBe(1000);
    expect(result.finalValue).toBe(750);
  });

  it("includes breakdown entries for non-identity zones", () => {
    const resolver = new DamageResolver();
    const ctx = createTestContext({
      attack: 2000,
      multiplier: 2.0,
      skillDmgBonus: 20,
    });
    const result = resolver.resolve(ctx);

    const baseEntry = result.breakdown[0];
    expect(baseEntry).toBeDefined();
    expect(baseEntry!.type).toBe("BASE");
    expect(baseEntry!.value).toBe(4000); // 2000 * 2.0

    // Should have Defense and DamageBonus entries
    const defenseEntry = result.breakdown.find((b) =>
      b.source.includes("Defense"),
    );
    expect(defenseEntry).toBeDefined();
    expect(defenseEntry!.type).toBe("MULTIPLIER");
    expect(defenseEntry!.value).toBe(0.5);

    const bonusEntry = result.breakdown.find((b) =>
      b.source.includes("DamageBonus"),
    );
    expect(bonusEntry).toBeDefined();
  });

  it("applies crit when critOverride says crit", () => {
    const resolver = new DamageResolver();
    const critResult: CritResult = { isCrit: true, multiplier: 1.5 };
    const ctx = createTestContext({
      attack: 1000,
      multiplier: 1.0,
      critOverride: critResult,
    });
    const result = resolver.resolve(ctx);

    // Base = 1000, Defense = 0.5, Crit = 1.5
    // Final = 1000 * 0.5 * 1.5 = 750
    expect(result.finalValue).toBe(750);
  });
});
