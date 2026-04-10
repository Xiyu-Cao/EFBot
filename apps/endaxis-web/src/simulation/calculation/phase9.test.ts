/**
 * Phase 9 tests — deterministic crit, expanded skill multipliers,
 * seeded RNG reproducibility, full chain with new characters.
 */

import { describe, it, expect } from "vitest";
import type { ActorSnapshot } from "../state/types";
import type { ActorStats } from "../compiler/types";
import { createDefaultStats } from "@/utils/coreStats";
import { createEngine } from "../engine/createEngine";
import { compileTimeline } from "../compiler/compileTimeline";
import { createSeededRng, buildRng } from "../engine/rng";
import { getSkillMultiplier } from "../data/skillMultipliers";
import { DamageResolver } from "./DamageResolver";
import { buildDamageTags } from "./damageTypes";
import { NO_CRIT } from "./critSystem";
import type { DamageContext } from "./type";

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

function makeEngine(
  actors: ActorSnapshot[] = [makeActor("A")],
  enemyOverrides: Record<string, any> = {},
) {
  const timeline = compileTimeline([], []);
  return createEngine(
    { maxSp: 300, initialSp: 200, spRegenRate: 8, skillSpCostDefault: 100, linkCdReduction: 0 },
    {
      maxStagger: 100, staggerNodeCount: 0, staggerNodeDuration: 2,
      staggerBreakDuration: 10, executionRecovery: 25,
      ...enemyOverrides,
    },
    actors,
    timeline,
  );
}

// ===========================================================================
// 1. Seeded RNG determinism
// ===========================================================================

describe("Seeded RNG", () => {
  it("same seed produces same sequence", () => {
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it("different seeds produce different sequences", () => {
    const rng1 = createSeededRng(1);
    const rng2 = createSeededRng(2);
    let same = 0;
    for (let i = 0; i < 20; i++) {
      if (rng1() === rng2()) same++;
    }
    // Extremely unlikely all 20 match
    expect(same).toBeLessThan(20);
  });

  it("values are in [0, 1)", () => {
    const rng = createSeededRng(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ===========================================================================
// 2. buildRng options
// ===========================================================================

describe("buildRng", () => {
  it("deterministicCrits: neverCrit always returns 1", () => {
    const rng = buildRng({ deterministicCrits: "neverCrit" });
    for (let i = 0; i < 10; i++) {
      expect(rng()).toBe(1);
    }
  });

  it("deterministicCrits: alwaysCrit always returns 0", () => {
    const rng = buildRng({ deterministicCrits: "alwaysCrit" });
    for (let i = 0; i < 10; i++) {
      expect(rng()).toBe(0);
    }
  });

  it("seed option creates seeded rng", () => {
    const rng1 = buildRng({ seed: 99 });
    const rng2 = buildRng({ seed: 99 });
    for (let i = 0; i < 10; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it("no options returns a function (Math.random)", () => {
    const rng = buildRng();
    expect(typeof rng).toBe("function");
  });
});

// ===========================================================================
// 3. Deterministic crit in DamageResolver
// ===========================================================================

describe("Deterministic Crit in DamageResolver", () => {
  it("neverCrit RNG produces consistent no-crit damage", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000, crit_rate: 95 }); // 100% crit rate normally
    const engine = makeEngine([actor]);

    const neverCritRng = buildRng({ deterministicCrits: "neverCrit" });

    const tags = buildDamageTags({
      sourceActorId: "A", targetEnemyId: "boss",
      damageType: "physical", damageSource: "activeSkill",
    });

    const ctx: DamageContext = {
      source: actor, target: engine.getState().enemy, state: engine.getState(),
      multiplier: 2.0, damageTags: tags,
      rng: neverCritRng,
    };

    const result = resolver.resolve(ctx);
    // No crit despite 100% crit rate: 1000 * 2.0 * 0.5 = 1000
    expect(result.finalValue).toBe(1000);
  });

  it("alwaysCrit RNG produces consistent crit damage", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000, crit_rate: 0, crit_dmg: 0 });
    const engine = makeEngine([actor]);

    const alwaysCritRng = buildRng({ deterministicCrits: "alwaysCrit" });

    const tags = buildDamageTags({
      sourceActorId: "A", targetEnemyId: "boss",
      damageType: "physical", damageSource: "activeSkill",
    });

    const ctx: DamageContext = {
      source: actor, target: engine.getState().enemy, state: engine.getState(),
      multiplier: 2.0, damageTags: tags,
      rng: alwaysCritRng,
    };

    const result = resolver.resolve(ctx);
    // Crit: 1000 * 2.0 * 0.5 * 1.5 (base crit dmg) = 1500
    expect(result.finalValue).toBe(1500);
  });

  it("seeded RNG produces reproducible results", () => {
    const resolver = new DamageResolver();
    const actor = makeActor("A", { attack: 1000, crit_rate: 50 }); // 55% effective
    const engine = makeEngine([actor]);

    const tags = buildDamageTags({
      sourceActorId: "A", targetEnemyId: "boss",
      damageType: "physical", damageSource: "activeSkill",
    });

    const results1: number[] = [];
    const results2: number[] = [];

    for (let run = 0; run < 2; run++) {
      const rng = buildRng({ seed: 777 });
      const results = run === 0 ? results1 : results2;
      for (let i = 0; i < 10; i++) {
        const ctx: DamageContext = {
          source: actor, target: engine.getState().enemy, state: engine.getState(),
          multiplier: 2.0, damageTags: tags, rng,
        };
        results.push(resolver.resolve(ctx).finalValue);
      }
    }

    // Same seed → same sequence of results
    expect(results1).toEqual(results2);
  });
});

// ===========================================================================
// 4. Expanded skill multipliers
// ===========================================================================

describe("Expanded Skill Multipliers", () => {
  it("GILBERTA has 5-tick skill multipliers", () => {
    for (let i = 0; i < 5; i++) {
      const m = getSkillMultiplier("GILBERTA", "skill", i);
      expect(m).toBeDefined();
      expect(m).toBeGreaterThan(0);
    }
    // Out of range
    expect(getSkillMultiplier("GILBERTA", "skill", 5)).toBeUndefined();
  });

  it("ESTELLA has skill/link/ultimate multipliers", () => {
    expect(getSkillMultiplier("ESTELLA", "skill", 0)).toBeDefined();
    expect(getSkillMultiplier("ESTELLA", "link", 0)).toBeDefined();
    expect(getSkillMultiplier("ESTELLA", "ultimate", 0)).toBeDefined();
  });

  it("POGRANICHNK has multi-tick skill and link", () => {
    expect(getSkillMultiplier("POGRANICHNK", "skill", 0)).toBeDefined();
    expect(getSkillMultiplier("POGRANICHNK", "skill", 1)).toBeDefined();
    expect(getSkillMultiplier("POGRANICHNK", "link", 0)).toBeDefined();
    expect(getSkillMultiplier("POGRANICHNK", "link", 1)).toBeDefined();
    expect(getSkillMultiplier("POGRANICHNK", "link", 2)).toBeDefined();
  });
});

// ===========================================================================
// 5. Full chain with new character + boss + deterministic crit
// ===========================================================================

describe("Full Chain — Deterministic", () => {
  it("ESTELLA cold skill with boss magic resist and neverCrit", () => {
    const actor = makeActor("ESTELLA", { attack: 800, cold_dmg: 15 });
    const engine = makeEngine([actor], { baseMagicResist: 10 });
    engine.rng = buildRng({ deterministicCrits: "neverCrit" });

    const timeline = (engine as any).timeline as { actionMap: Map<string, any> };
    timeline.actionMap.set("estella_skill_1", {
      node: { type: "skill", id: "ESTELLA_skill", element: "cold" },
      trackId: "ESTELLA",
    });

    const mult = getSkillMultiplier("ESTELLA", "skill", 0)!;
    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 1,
      payload: {
        sourceId: "ESTELLA", targetId: "boss", damage: 0, stagger: 10,
        tickData: {
          offset: 0.7, sp: 0, stagger: 10, multiplier: mult,
          realTime: 1, realOffset: 0.7, time: 1,
        },
        actionId: "estella_skill_1",
      },
    });

    engine.run();
    const log = engine.getSimLog();
    const dmg = log.filter(e => e.type === "DAMAGE_TICK");
    expect(dmg.length).toBe(1);

    if (dmg[0]?.type === "DAMAGE_TICK") {
      // ATK=800, mult=3.0, defense=0.5
      // DmgBonus: cold_dmg=15 → 1 + 15/100 = 1.15
      // Resist: baseMagicResist=10 → 1 - 10*0.01 = 0.90
      // No crit.
      // = floor(800 * 3.0 * 0.5 * 1.15 * 0.90) = floor(1242) = 1242
      expect(dmg[0].payload.damage).toBe(1242);
    }
  });

  it("GILBERTA multi-tick skill with neverCrit", () => {
    const actor = makeActor("GILBERTA", { attack: 600 });
    const engine = makeEngine([actor]);
    engine.rng = buildRng({ deterministicCrits: "neverCrit" });

    const timeline = (engine as any).timeline as { actionMap: Map<string, any> };
    timeline.actionMap.set("gilb_skill", {
      node: { type: "skill", id: "GILBERTA_skill", element: "nature" },
      trackId: "GILBERTA",
    });

    // Enqueue all 5 ticks
    const mults = [0.8, 0.8, 0.8, 0.8, 2.4];
    for (let i = 0; i < 5; i++) {
      engine.enqueue({
        type: "DAMAGE_TICK",
        time: 1 + i * 0.5,
        payload: {
          sourceId: "GILBERTA", targetId: "boss", damage: 0, stagger: i === 4 ? 10 : 0,
          tickData: {
            offset: i * 0.5, sp: 0, stagger: i === 4 ? 10 : 0, multiplier: mults[i],
            realTime: 1 + i * 0.5, realOffset: i * 0.5, time: 1 + i * 0.5,
          },
          actionId: "gilb_skill",
        },
      });
    }

    engine.run();
    const log = engine.getSimLog();
    const dmgTicks = log.filter(e => e.type === "DAMAGE_TICK");
    expect(dmgTicks.length).toBe(5);

    // First 4 ticks: 600 * 0.8 * 0.5 = 240 each
    for (let i = 0; i < 4; i++) {
      if (dmgTicks[i]?.type === "DAMAGE_TICK") {
        expect(dmgTicks[i].payload.damage).toBe(240);
      }
    }
    // Last tick: 600 * 2.4 * 0.5 = 720
    if (dmgTicks[4]?.type === "DAMAGE_TICK") {
      expect(dmgTicks[4].payload.damage).toBe(720);
    }
  });
});

// ===========================================================================
// 6. Engine RNG wiring
// ===========================================================================

describe("Engine RNG Wiring", () => {
  it("engine.rng is used by DamageHandler via SimulationContext", () => {
    const actor = makeActor("A", { attack: 1000, crit_rate: 95 }); // 100% crit normally
    const engine = makeEngine([actor]);
    // Force neverCrit via engine rng
    engine.rng = buildRng({ deterministicCrits: "neverCrit" });

    const timeline = (engine as any).timeline as { actionMap: Map<string, any> };
    timeline.actionMap.set("s1", {
      node: { type: "skill", id: "test", element: "physical" },
      trackId: "A",
    });

    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 1,
      payload: {
        sourceId: "A", targetId: "boss", damage: 0, stagger: 0,
        tickData: {
          offset: 0, sp: 0, stagger: 0, multiplier: 2.0,
          realTime: 1, realOffset: 0, time: 1,
        },
        actionId: "s1",
      },
    });

    engine.run();
    const log = engine.getSimLog();
    const dmg = log.find(e => e.type === "DAMAGE_TICK");

    if (dmg?.type === "DAMAGE_TICK") {
      // No crit despite 100% rate → 1000 * 2.0 * 0.5 = 1000
      expect(dmg.payload.damage).toBe(1000);
    }
  });
});
