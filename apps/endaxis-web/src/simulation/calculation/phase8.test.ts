/**
 * Phase 8 tests — weapon data adapter, pipeline plumbing, skill multipliers,
 * full integration chain.
 */

import { describe, it, expect } from "vitest";
import type { ActorSnapshot } from "../state/types";
import type { ActorStats } from "../compiler/types";
import { createDefaultStats } from "@/utils/coreStats";
import { createEngine } from "../engine/createEngine";
import { compileTimeline } from "../compiler/compileTimeline";
import {
  buildTriggerFromMetadata,
  registerWeaponFromData,
  type WeaponData,
  type WeaponTriggeredBuff,
} from "../equipment/weaponDataAdapter";
import { type DynamicBonus, addOrRefreshBuff } from "../equipment/types";
import {
  extractEquipmentConfigs,
  registerEquipmentPassives,
  registerParadigmWeapon,
} from "../equipment/registry";
import { getSkillMultiplier } from "../data/skillMultipliers";
import type { GameDatabase } from "../compiler/types";
import { DiagnosticCollector } from "../diagnostics";
import { buildRng } from "../engine/rng";

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
  enemyOverrides: Partial<import("../state/types").EnemyConfig> = {},
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
// 1. Weapon triggeredBuffs metadata from JSON
// ===========================================================================

describe("Weapon Data Adapter", () => {
  it("buildTriggerFromMetadata produces trigger with correct event and cooldown", () => {
    const buff: WeaponTriggeredBuff = {
      trigger: "on_skill_or_ultimate_hit",
      name: "TestBuff",
      target: "self",
      effects: [],
      duration: 30,
      maxStacks: 3,
      stackCooldown: 0.1,
    };

    const trigger = buildTriggerFromMetadata(buff, () => {});

    expect(trigger).not.toBeNull();
    expect(trigger!.event).toBe("DAMAGE_TICK");
    expect(trigger!.sourceMustBeWearer).toBe(true);
    expect(trigger!.cooldownId).toContain("TestBuff");
    expect(trigger!.cooldownDuration).toBe(0.1);
    expect(trigger!.condition).toBeDefined(); // skill/ultimate condition
  });

  it("buildTriggerFromMetadata returns null for unknown trigger types", () => {
    const buff: WeaponTriggeredBuff = {
      trigger: "_unknown",
      target: "self",
      effects: [],
      duration: 10,
    };

    const trigger = buildTriggerFromMetadata(buff);
    expect(trigger).toBeNull();
  });

  it("buildTriggerFromMetadata returns null when no fallback and no effects", () => {
    const buff: WeaponTriggeredBuff = {
      trigger: "on_skill_hit",
      target: "self",
      effects: [],
      duration: 10,
    };

    // No fallback action provided
    const trigger = buildTriggerFromMetadata(buff);
    expect(trigger).toBeNull();
  });

  it("registerWeaponFromData registers passive with JSON metadata + fallback action", () => {
    const engine = makeEngine([makeActor("A")]);

    const weaponData: WeaponData = {
      id: "wpn_test_001",
      name: "TestWeapon",
      triggeredBuffs: [{
        trigger: "on_physical_anomaly",
        name: "TestProc",
        target: "self",
        effects: [],
        duration: null,
      }],
    };

    registerWeaponFromData(engine, "A", weaponData, {
      0: () => {},
    });

    // Verify passive was registered (actor should have effect with triggers)
    const effects = engine.getState().getActor("A").effects.getAll();
    expect(effects.length).toBe(1);
    expect(effects[0]!.effect.id).toBe("weapon_wpn_test_001");
    expect(effects[0]!.effect.triggers.length).toBe(1);
  });
});

// ===========================================================================
// 2. 典范 weapon now uses JSON metadata
// ===========================================================================

describe("Paradigm Weapon — Data-Driven", () => {
  it("registers with metadata from JSON data object", () => {
    const engine = makeEngine([makeActor("A")]);

    // Pass real JSON data (matching gamedata.json structure)
    const paradigmData: WeaponData = {
      id: "wpn_claym_0004",
      name: "典范",
      triggeredBuffs: [{
        trigger: "on_skill_or_ultimate_hit",
        name: "多层斩断",
        target: "self",
        effects: [],
        duration: 30,
        maxStacks: 3,
        stackCooldown: 0.1,
      }],
    };

    registerParadigmWeapon(engine, "A", paradigmData);

    // Should have registered a passive
    const effects = engine.getState().getActor("A").effects.getAll();
    expect(effects.length).toBe(1);
  });

  it("still works with default data when JSON not passed", () => {
    const engine = makeEngine([makeActor("A")]);

    // Call without weaponData — uses built-in defaults
    registerParadigmWeapon(engine, "A");

    const effects = engine.getState().getActor("A").effects.getAll();
    expect(effects.length).toBe(1);
  });

  it("JSON metadata duration/maxStacks are used in buff creation", () => {
    const engine = makeEngine([makeActor("A")]);

    // Custom data with different duration and maxStacks
    const customData: WeaponData = {
      id: "wpn_claym_0004",
      name: "典范",
      triggeredBuffs: [{
        trigger: "on_skill_or_ultimate_hit",
        name: "多层斩断",
        target: "self",
        effects: [],
        duration: 15, // different from default 30
        maxStacks: 2, // different from default 3
        stackCooldown: 0.2,
      }],
    };

    registerParadigmWeapon(engine, "A", customData);

    // Inject a fake action so the trigger fires
    const timeline = (engine as any).timeline as { actionMap: Map<string, any> };
    timeline.actionMap.set("s1", { node: { type: "skill" }, trackId: "A" });
    timeline.actionMap.set("s2", { node: { type: "skill" }, trackId: "A" });
    timeline.actionMap.set("s3", { node: { type: "skill" }, trackId: "A" });

    // Fire 3 hits (should cap at maxStacks=2)
    for (let i = 1; i <= 3; i++) {
      engine.enqueue({
        type: "DAMAGE_TICK",
        time: i,
        payload: {
          sourceId: "A", targetId: "boss", damage: 0, stagger: 0,
          tickData: { offset: 0, sp: 0, stagger: 0, multiplier: 1, realTime: i, realOffset: 0, time: i },
          actionId: `s${i}`,
        },
      });
    }

    engine.run();

    const stacks = engine.getState().getActor("A").effects.getAll()
      .filter(e => e.effect.properties.stackGroup === "paradigm_buff");
    // Should cap at 2 (not 3)
    expect(stacks.length).toBe(2);
    // Duration should be 15 (from custom data)
    expect(stacks[0]!.effect.duration).toBe(15);
  });
});

// ===========================================================================
// 3. Skill multiplier overlay
// ===========================================================================

describe("Skill Multiplier Overlay", () => {
  it("ENDMINISTRATOR skill multiplier is available", () => {
    const mult = getSkillMultiplier("ENDMINISTRATOR", "skill", 0);
    expect(mult).toBeDefined();
    expect(mult).toBeGreaterThan(0);
  });

  it("ENDMINISTRATOR link multiplier is available", () => {
    const mult = getSkillMultiplier("ENDMINISTRATOR", "link", 0);
    expect(mult).toBeDefined();
    expect(mult).toBeGreaterThan(0);
  });

  it("returns undefined for unknown character", () => {
    expect(getSkillMultiplier("NONEXISTENT", "skill", 0)).toBeUndefined();
  });

  it("returns undefined for unknown action type", () => {
    expect(getSkillMultiplier("ENDMINISTRATOR", "passive", 0)).toBeUndefined();
  });

  it("returns undefined for out-of-range tick index", () => {
    expect(getSkillMultiplier("ENDMINISTRATOR", "skill", 99)).toBeUndefined();
  });
});

// ===========================================================================
// 4-6. Full integration chain
// ===========================================================================

describe("Full Integration Chain", () => {
  it("ENDMINISTRATOR skill with real multiplier + boss template → real damage", () => {
    const actor = makeActor("ENDMINISTRATOR", {
      attack: 1000,
      physical_dmg: 28, // as if 典范 passiveStats already in stats
    });

    const engine = makeEngine([actor], {
      defenseMultiplier: 0.5,
      basePhysicalResist: 0,
    });
    engine.rng = buildRng({ deterministicCrits: "neverCrit" });

    // Inject a skill action into timeline
    const timeline = (engine as any).timeline as { actionMap: Map<string, any> };
    timeline.actionMap.set("endm_skill_1", {
      node: { type: "skill", id: "ENDMINISTRATOR_skill", element: "physical" },
      trackId: "ENDMINISTRATOR",
    });

    // The multiplier overlay should provide the skill multiplier
    const mult = getSkillMultiplier("ENDMINISTRATOR", "skill", 0);
    expect(mult).toBeDefined();

    // Enqueue a damage tick with the multiplier from overlay
    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 1,
      payload: {
        sourceId: "ENDMINISTRATOR",
        targetId: "boss",
        damage: 0,
        stagger: 10,
        tickData: {
          offset: 0.37, sp: 0, stagger: 10,
          multiplier: mult!, // from skill multiplier overlay
          realTime: 1, realOffset: 0.37, time: 1,
        },
        actionId: "endm_skill_1",
      },
    });

    engine.run();
    const log = engine.getSimLog();

    const dmgTicks = log.filter(e => e.type === "DAMAGE_TICK");
    expect(dmgTicks.length).toBe(1);

    if (dmgTicks[0]?.type === "DAMAGE_TICK") {
      const damage = dmgTicks[0].payload.damage;
      // ATK = 1000 (no primary/secondary ability)
      // Multiplier = 2.8 (from ENDMINISTRATOR skill)
      // Defense = 0.5
      // DamageBonus = 1 + 28/100 = 1.28 (physical_dmg from 典范 static)
      // Expected = floor(1000 * 2.8 * 0.5 * 1.28) = floor(1792) = 1792
      expect(damage).toBe(1792);
    }
  });

  it("full chain: character + boss resist + equipment passive + reaction", () => {
    const actor = makeActor("ENDMINISTRATOR", {
      attack: 1000,
      physical_dmg: 28,
      originium_arts_power: 0,
    });

    const engine = makeEngine([actor], {
      defenseMultiplier: 0.5,
      basePhysicalResist: 10, // 10% phys resist
    });
    engine.rng = buildRng({ deterministicCrits: "neverCrit" });

    // Register 典范 weapon passive (triggered buff)
    registerParadigmWeapon(engine, "ENDMINISTRATOR");

    // Inject skill action
    const timeline = (engine as any).timeline as { actionMap: Map<string, any> };
    timeline.actionMap.set("skill_1", {
      node: { type: "skill", id: "ENDMINISTRATOR_skill", element: "physical" },
      trackId: "ENDMINISTRATOR",
    });

    // Skill hit → triggers 典范 +28% physical_dmg buff (stack 1)
    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 1,
      payload: {
        sourceId: "ENDMINISTRATOR",
        targetId: "boss",
        damage: 0,
        stagger: 10,
        tickData: {
          offset: 0.37, sp: 0, stagger: 10,
          multiplier: 2.8,
          realTime: 1, realOffset: 0.37, time: 1,
        },
        actionId: "skill_1",
      },
    });

    // Second skill hit 0.5s later → triggers another stack
    timeline.actionMap.set("skill_2", {
      node: { type: "skill", id: "ENDMINISTRATOR_skill", element: "physical" },
      trackId: "ENDMINISTRATOR",
    });
    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 1.5,
      payload: {
        sourceId: "ENDMINISTRATOR",
        targetId: "boss",
        damage: 0,
        stagger: 10,
        tickData: {
          offset: 0.37, sp: 0, stagger: 10,
          multiplier: 2.8,
          realTime: 1.5, realOffset: 0.37, time: 1.5,
        },
        actionId: "skill_2",
      },
    });

    engine.run();
    const log = engine.getSimLog();

    const dmgTicks = log.filter(e => e.type === "DAMAGE_TICK");
    expect(dmgTicks.length).toBe(2);

    // First hit: no 典范 buff yet (trigger fires AFTER handler)
    // ATK=1000, mult=2.8, defense=0.5, resist=1-10*0.01=0.90
    // DmgBonus: physical_dmg=28 → 1 + 28/100 = 1.28
    // = floor(1000 * 2.8 * 0.5 * 0.90 * 1.28) = floor(1612.8) = 1612
    if (dmgTicks[0]?.type === "DAMAGE_TICK") {
      expect(dmgTicks[0].payload.damage).toBe(1612);
    }

    // Second hit: after first trigger, 典范 has 1 stack (+28% physical_dmg as dynamic buff)
    // DmgBonus: base 28 + dynamic 28 = 56 → 1 + 56/100 = 1.56
    // = floor(1000 * 2.8 * 0.5 * 0.90 * 1.56) = floor(1965.6) = 1965
    if (dmgTicks[1]?.type === "DAMAGE_TICK") {
      expect(dmgTicks[1].payload.damage).toBe(1965);
    }
  });
});

// ===========================================================================
// 7. extractEquipmentConfigs with real data
// ===========================================================================

describe("Pipeline Data Plumbing", () => {
  it("extractEquipmentConfigs maps weapon ID from gamedata", () => {
    const scenario = {
      tracks: [{
        id: "ENDMINISTRATOR",
        actions: [],
        stats: createDefaultStats() as ActorStats,
        gaugeEfficiency: 100, originiumArtsPower: 0, linkCdReduction: 0,
        initialGauge: 0,
        weaponId: "wpn_claym_0004", // 典范
      }],
    };

    const configs = extractEquipmentConfigs(scenario as any);
    expect(configs.length).toBe(1);
    expect(configs[0]!.weaponId).toBe("paradigm");
    expect(configs[0]!.actorId).toBe("ENDMINISTRATOR");
    expect(configs[0]!.weaponDatabaseId).toBe("wpn_claym_0004");
  });

  it("registerEquipmentPassives passes gamedata weapon row into paradigm (duration)", () => {
    const engine = makeEngine([makeActor("ENDMINISTRATOR")]);
    const db: GameDatabase = {
      weaponDatabase: [
        {
          id: "wpn_claym_0004",
          name: "典范",
          triggeredBuffs: [
            {
              trigger: "on_skill_or_ultimate_hit",
              name: "多层斩断",
              target: "self",
              effects: [],
              duration: 7,
              maxStacks: 2,
              stackCooldown: 0.1,
            },
          ],
        },
      ],
    };

    registerEquipmentPassives(
      engine,
      [
        {
          actorId: "ENDMINISTRATOR",
          weaponId: "paradigm",
          weaponDatabaseId: "wpn_claym_0004",
        },
      ],
      { db },
    );

    const timeline = (engine as unknown as { timeline: { actionMap: Map<string, unknown> } }).timeline;
    timeline.actionMap.set("s1", { node: { type: "skill" }, trackId: "ENDMINISTRATOR" });

    engine.enqueue({
      type: "DAMAGE_TICK",
      time: 1,
      payload: {
        sourceId: "ENDMINISTRATOR",
        targetId: "boss",
        damage: 0,
        stagger: 0,
        tickData: {
          offset: 0,
          sp: 0,
          stagger: 0,
          multiplier: 1,
          realTime: 1,
          realOffset: 0,
          time: 1,
        },
        actionId: "s1",
      },
    });

    engine.run();

    const stacks = engine
      .getState()
      .getActor("ENDMINISTRATOR")
      .effects.getAll()
      .filter((e) => e.effect.properties.stackGroup === "paradigm_buff");
    expect(stacks.length).toBe(1);
    expect(stacks[0]!.effect.duration).toBe(7);
  });

  it("emits WEAPON_TRIGGER_UNKNOWN when JSON trigger string is unknown", () => {
    const diagnostics = new DiagnosticCollector();
    const engine = makeEngine([makeActor("A")]);
    registerWeaponFromData(
      engine,
      "A",
      {
        id: "wpn_bad",
        name: "Bad",
        triggeredBuffs: [
          {
            trigger: "not_a_real_trigger",
            target: "self",
            effects: [],
            duration: 10,
          },
        ],
      },
      undefined,
      diagnostics,
    );
    expect(
      diagnostics.getAll().some((d) => d.code === "WEAPON_TRIGGER_UNKNOWN"),
    ).toBe(true);
  });
});
