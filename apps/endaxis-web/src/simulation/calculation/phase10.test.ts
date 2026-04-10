/**
 * Phase 10 tests — truth status, set bonus auto-detection,
 * runSimulation rng options, overlay boundaries.
 */

import { describe, it, expect } from "vitest";
import type { ActorStats } from "../compiler/types";
import { createDefaultStats } from "@/utils/coreStats";
import {
  getSkillMultiplier,
  getSkillMultiplierEntry,
  getEntriesByStatus,
  applySkillMultiplierOverlay,
  SKILL_MULTIPLIERS,
  type MultiplierTruthStatus,
} from "../data/skillMultipliers";
import { extractEquipmentConfigs } from "../equipment/registry";
import { runSimulation } from "../runSimulation";

// ===========================================================================
// 1. Truth status on skill multipliers
// ===========================================================================

describe("Skill Multiplier Truth Status", () => {
  it("all entries have a status field", () => {
    for (const [charId, actions] of Object.entries(SKILL_MULTIPLIERS)) {
      for (const [actionType, entry] of Object.entries(actions)) {
        if (entry && "multipliers" in entry) {
          expect(
            (entry as any).status,
            `${charId}.${actionType} missing status`,
          ).toBeDefined();
        }
      }
    }
  });

  it("getEntriesByStatus('estimated') returns all current entries", () => {
    const estimated = getEntriesByStatus("estimated");
    // All 5 characters × ~3 action types = ~15 entries, all estimated
    expect(estimated.length).toBeGreaterThanOrEqual(15);
    for (const e of estimated) {
      expect(e.entry.status).toBe("estimated");
    }
  });

  it("getEntriesByStatus('verified') returns verified entries", () => {
    const verified = getEntriesByStatus("verified");
    expect(verified.length).toBeGreaterThanOrEqual(1);
    expect(verified.some(e => e.characterId === "ALESH" && e.actionType === "link")).toBe(true);
  });

  it("getSkillMultiplierEntry returns entry with status", () => {
    const entry = getSkillMultiplierEntry("ENDMINISTRATOR", "skill");
    expect(entry).toBeDefined();
    expect(entry!.status).toBe("estimated");
    expect(entry!.multipliers).toEqual([2.8]);
  });
});

// ===========================================================================
// 2. Set bonus auto-detection via extractEquipmentConfigs
// ===========================================================================

describe("Set Bonus Auto-Detection", () => {
  it("detects set bonus when 3+ items from same category", () => {
    const scenario = {
      tracks: [{
        id: "A",
        actions: [],
        stats: createDefaultStats() as ActorStats,
        gaugeEfficiency: 100,
        originiumArtsPower: 0,
        linkCdReduction: 0,
        initialGauge: 0,
        equipArmorId: "eq1",
        equipGlovesId: "eq2",
        equipAccessory1Id: "eq3",
      }],
    };

    const eqDb = [
      { id: "eq1", category: "点剑" },
      { id: "eq2", category: "点剑" },
      { id: "eq3", category: "点剑" },
    ];

    const configs = extractEquipmentConfigs(scenario as any, eqDb);
    expect(configs.length).toBe(1);
    expect(configs[0]!.setId).toBe("dianjian");
  });

  it("no set bonus when fewer than 3 from same category", () => {
    const scenario = {
      tracks: [{
        id: "A",
        actions: [],
        stats: createDefaultStats() as ActorStats,
        gaugeEfficiency: 100,
        originiumArtsPower: 0,
        linkCdReduction: 0,
        initialGauge: 0,
        equipArmorId: "eq1",
        equipGlovesId: "eq2",
      }],
    };

    const eqDb = [
      { id: "eq1", category: "点剑" },
      { id: "eq2", category: "动火用" },
    ];

    const configs = extractEquipmentConfigs(scenario as any, eqDb);
    expect(configs.length).toBe(0); // no weapon, no set
  });

  it("graceful skip when equipmentDatabase is missing", () => {
    const scenario = {
      tracks: [{
        id: "A",
        actions: [],
        stats: createDefaultStats() as ActorStats,
        gaugeEfficiency: 100,
        originiumArtsPower: 0,
        linkCdReduction: 0,
        initialGauge: 0,
        equipArmorId: "eq1",
        equipGlovesId: "eq2",
        equipAccessory1Id: "eq3",
      }],
    };

    // No eqDb → no set detection, no crash
    const configs = extractEquipmentConfigs(scenario as any, undefined);
    expect(configs.length).toBe(0);
  });

  it("weapon + set bonus combined in same config", () => {
    const scenario = {
      tracks: [{
        id: "A",
        actions: [],
        stats: createDefaultStats() as ActorStats,
        gaugeEfficiency: 100,
        originiumArtsPower: 0,
        linkCdReduction: 0,
        initialGauge: 0,
        weaponId: "wpn_claym_0004",
        equipArmorId: "eq1",
        equipGlovesId: "eq2",
        equipAccessory1Id: "eq3",
      }],
    };

    const eqDb = [
      { id: "eq1", category: "潮涌" },
      { id: "eq2", category: "潮涌" },
      { id: "eq3", category: "潮涌" },
    ];

    const configs = extractEquipmentConfigs(scenario as any, eqDb);
    expect(configs.length).toBe(1);
    expect(configs[0]!.setId).toBe("chaoyong");
    expect(configs[0]!.weaponId).toBe("paradigm");
  });
});

// ===========================================================================
// 3. runSimulation rng options
// ===========================================================================

describe("runSimulation rng options", () => {
  it("accepts rng options and produces deterministic results", () => {
    // Minimal scenario with one action that has a multiplier
    const scenario = {
      tracks: [{
        id: "TEST",
        actions: [{
          id: "TEST_skill",
          instanceId: "inst_1",
          type: "skill",
          name: "Test",
          element: "physical",
          duration: 1,
          cooldown: 0,
          spCost: 0,
          gaugeCost: 0,
          gaugeGain: 0,
          teamGaugeGain: 0,
          enhancementTime: 0,
          animationTime: 0,
          startTime: 0,
          logicalStartTime: 0,
          allowedTypes: [],
          damageTicks: [{ offset: 0.5, sp: 0, stagger: 0, multiplier: 2.0 }],
          physicalAnomaly: [],
        }],
        stats: { ...(createDefaultStats() as ActorStats), attack: 500, crit_rate: 50 },
        gaugeEfficiency: 100,
        originiumArtsPower: 0,
        linkCdReduction: 0,
        initialGauge: 0,
      }],
    };

    // Run twice with same seed
    const r1 = runSimulation(scenario as any, { rng: { seed: 42 } });
    const r2 = runSimulation(scenario as any, { rng: { seed: 42 } });

    const dmg1 = r1.simLog.filter(e => e.type === "DAMAGE_TICK");
    const dmg2 = r2.simLog.filter(e => e.type === "DAMAGE_TICK");

    expect(dmg1.length).toBe(1);
    expect(dmg2.length).toBe(1);
    if (dmg1[0]?.type === "DAMAGE_TICK" && dmg2[0]?.type === "DAMAGE_TICK") {
      // Same seed → same crit outcome → same damage
      expect(dmg1[0].payload.damage).toBe(dmg2[0].payload.damage);
    }
  });

  it("neverCrit via runSimulation produces no-crit damage", () => {
    const scenario = {
      tracks: [{
        id: "TEST",
        actions: [{
          id: "TEST_skill",
          instanceId: "inst_1",
          type: "skill",
          name: "Test",
          element: "physical",
          duration: 1,
          cooldown: 0,
          spCost: 0,
          gaugeCost: 0,
          gaugeGain: 0,
          teamGaugeGain: 0,
          enhancementTime: 0,
          animationTime: 0,
          startTime: 0,
          logicalStartTime: 0,
          allowedTypes: [],
          damageTicks: [{ offset: 0.5, sp: 0, stagger: 0, multiplier: 2.0 }],
          physicalAnomaly: [],
        }],
        stats: { ...(createDefaultStats() as ActorStats), attack: 1000, crit_rate: 95 },
        gaugeEfficiency: 100,
        originiumArtsPower: 0,
        linkCdReduction: 0,
        initialGauge: 0,
      }],
    };

    const result = runSimulation(scenario as any, {
      rng: { deterministicCrits: "neverCrit" },
    });

    const dmg = result.simLog.filter(e => e.type === "DAMAGE_TICK");
    expect(dmg.length).toBe(1);
    if (dmg[0]?.type === "DAMAGE_TICK") {
      // No crit despite 100% rate: 1000 * 2.0 * 0.5 (defense) = 1000
      expect(dmg[0].payload.damage).toBe(1000);
    }
  });
});

// ===========================================================================
// 4. Overlay boundary clarity
// ===========================================================================

describe("Overlay Boundary Clarity", () => {
  it("overlay does NOT overwrite explicit non-zero multiplier from timeline", () => {
    const tick = {
      offset: 0, sp: 0, stagger: 0,
      multiplier: 5.0, // explicit from timeline
      realTime: 1, realOffset: 0, time: 1,
    };

    const result = applySkillMultiplierOverlay("ENDMINISTRATOR", "skill", 0, tick);
    // Should keep 5.0, not replace with 2.8
    expect(result.multiplier).toBe(5.0);
  });

  it("overlay fills zero/missing multiplier", () => {
    const tick = {
      offset: 0, sp: 0, stagger: 0,
      multiplier: 0,
      realTime: 1, realOffset: 0, time: 1,
    };

    const result = applySkillMultiplierOverlay("ENDMINISTRATOR", "skill", 0, tick);
    expect(result.multiplier).toBe(2.8);
  });

  it("unknown character returns tick unchanged", () => {
    const tick = {
      offset: 0, sp: 0, stagger: 0,
      multiplier: 0,
      realTime: 1, realOffset: 0, time: 1,
    };

    const result = applySkillMultiplierOverlay("UNKNOWN_CHAR", "skill" as any, 0, tick);
    expect(result.multiplier).toBe(0);
  });
});
