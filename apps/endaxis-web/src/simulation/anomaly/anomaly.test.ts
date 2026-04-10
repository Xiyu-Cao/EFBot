import { describe, it, expect } from "vitest";
import { EnemyStatusState } from "./EnemyStatusState";
import { resolveMagicAttachment } from "./MagicReactionResolver";
import { resolvePhysicalAnomaly } from "./PhysicalReactionResolver";
import { applyDirectAnomaly } from "./DirectAnomalyApplier";
import { compileTimeline } from "../compiler/compileTimeline";
import { createEngine } from "../engine/createEngine";
import type { ActorSnapshot } from "../state/types";
import { createDefaultStats } from "@/utils/coreStats";
import type { ActorStats } from "../compiler/types";
import type { AnomalyLevel, ResolverOutcome } from "./types";

// -- Helpers --

function makeStatus() {
  return new EnemyStatusState();
}

function makeActor(id: string, statsOverrides: Partial<ActorStats> = {}): ActorSnapshot {
  return {
    id,
    stats: { ...(createDefaultStats() as ActorStats), attack: 1000, ...statsOverrides },
    resources: { hp: 1000, gauge: 0 },
    cooldowns: new Map(),
    activeBuffs: new Map(),
  };
}

function makeEngine(actors: ActorSnapshot[] = [makeActor("A")]) {
  const timeline = compileTimeline([], []);
  return createEngine(
    { maxSp: 300, initialSp: 200, spRegenRate: 8, skillSpCostDefault: 100, linkCdReduction: 0 },
    { maxStagger: 100, staggerNodeCount: 0, staggerNodeDuration: 2, staggerBreakDuration: 10, executionRecovery: 25 },
    actors,
    timeline,
  );
}

function outcomeTypes(outcomes: ResolverOutcome[]): string[] {
  return outcomes.map(o => o.type);
}

// ===========================================================================
// 1. Magic attachment: no existing → add 1 stack
// ===========================================================================
describe("MagicReactionResolver", () => {
  it("adds 1 stack when no existing attachment", () => {
    const s = makeStatus();
    const out = resolveMagicAttachment(s, "fire", "A", 0);

    expect(s.getMagicElement()).toBe("fire");
    expect(s.getMagicStacks()).toBe(1);
    expect(outcomeTypes(out)).toEqual(["ATTACHMENT_CHANGED"]);
  });

  // 2. Same element below threshold → stack only, no burst
  it("stacks same element without burst below threshold", () => {
    const s = makeStatus();
    resolveMagicAttachment(s, "cold", "A", 0);
    const out = resolveMagicAttachment(s, "cold", "A", 1);

    expect(s.getMagicStacks()).toBe(2);
    expect(outcomeTypes(out)).toContain("ATTACHMENT_CHANGED");
    expect(outcomeTypes(out)).not.toContain("MAGIC_BURST_DAMAGE");
  });

  // 2b. Same element at threshold (4 stacks) → burst, attachment stays
  it("produces burst at max stacks but keeps attachment", () => {
    const s = makeStatus();
    for (let i = 0; i < 3; i++) resolveMagicAttachment(s, "electro", "A", i);
    expect(s.getMagicStacks()).toBe(3);

    const out = resolveMagicAttachment(s, "electro", "A", 4);
    // Burst fires at 4 stacks, attachment NOT cleared
    expect(outcomeTypes(out)).toContain("MAGIC_BURST_DAMAGE");
    expect(outcomeTypes(out)).not.toContain("ATTACHMENT_CLEARED");
    expect(s.getMagicElement()).toBe("electro"); // attachment stays
    expect(s.getMagicStacks()).toBe(4);
  });

  it("refreshes duration on same-element stack", () => {
    const s = makeStatus();
    resolveMagicAttachment(s, "fire", "A", 0);
    resolveMagicAttachment(s, "fire", "A", 25);
    // Duration refreshed: expiresAt = 25 + 30 = 55
    expect(s.magicAttachment!.expiresAt).toBe(55);
  });

  // 3. Different element → clear + anomaly + reaction damage
  it("produces anomaly debuff and reaction damage on cross-element", () => {
    const s = makeStatus();
    resolveMagicAttachment(s, "fire", "A", 0);
    resolveMagicAttachment(s, "fire", "A", 1);
    expect(s.getMagicStacks()).toBe(2);

    const out = resolveMagicAttachment(s, "cold", "B", 5);

    // Attachment cleared
    expect(s.hasMagicAttachment()).toBe(false);

    // Anomaly applied (freeze from cold, level = old stacks = 2)
    expect(outcomeTypes(out)).toContain("ANOMALY_APPLIED");
    const anomaly = out.find(o => o.type === "ANOMALY_APPLIED");
    expect(anomaly).toBeDefined();
    if (anomaly && anomaly.type === "ANOMALY_APPLIED") {
      expect(anomaly.anomalyType).toBe("freeze");
      expect(anomaly.level).toBe(2);
    }

    // Reaction damage
    expect(outcomeTypes(out)).toContain("REACTION_DAMAGE");

    // Freeze state should exist
    expect(s.freeze).not.toBeNull();
    expect(s.freeze!.level).toBe(2);
  });
});

// ===========================================================================
// 4. Direct anomaly → debuff only, no reaction damage
// ===========================================================================
describe("DirectAnomalyApplier", () => {
  it("applies anomaly debuff without reaction damage", () => {
    const s = makeStatus();
    const out = applyDirectAnomaly(s, "conduction", 3, "A", 0);

    expect(s.conduction).not.toBeNull();
    expect(s.conduction!.level).toBe(3);
    expect(outcomeTypes(out)).toEqual(["ANOMALY_APPLIED"]);
    // No REACTION_DAMAGE in outcomes
    expect(outcomeTypes(out)).not.toContain("REACTION_DAMAGE");
  });

  it("applies freeze directly", () => {
    const s = makeStatus();
    applyDirectAnomaly(s, "freeze", 2, "A", 0);
    expect(s.freeze).not.toBeNull();
    expect(s.freeze!.level).toBe(2);
    expect(s.freeze!.expiresAt).toBe(7); // level 2 = 7 seconds
  });
});

// ===========================================================================
// 5. Freeze + physical → ice shatter
// ===========================================================================
describe("PhysicalReactionResolver — ice shatter", () => {
  it("shatters freeze on physical anomaly", () => {
    const s = makeStatus();
    applyDirectAnomaly(s, "freeze", 3, "CASTER", 0);
    // Give it break so physical anomaly goes through the "has break" path
    s.addBreakStack(0);

    const out = resolvePhysicalAnomaly(s, "slam", "ATTACKER", 1);

    expect(outcomeTypes(out)).toContain("ICE_SHATTER_DAMAGE");
    const shatter = out.find(o => o.type === "ICE_SHATTER_DAMAGE");
    expect(shatter).toBeDefined();
    if (shatter && shatter.type === "ICE_SHATTER_DAMAGE") {
      expect(shatter.sourceActorId).toBe("ATTACKER"); // attributed to physical attacker
      expect(shatter.level).toBe(3);
    }
    expect(s.freeze!.shattered).toBe(true);
  });

  it("only shatters once per freeze", () => {
    const s = makeStatus();
    applyDirectAnomaly(s, "freeze", 1, "C", 0);
    s.addBreakStack(0);

    resolvePhysicalAnomaly(s, "launch", "A1", 1);
    const out2 = resolvePhysicalAnomaly(s, "knockdown", "A2", 2);

    expect(outcomeTypes(out2)).not.toContain("ICE_SHATTER_DAMAGE");
  });
});

// ===========================================================================
// 6. No break → physical anomaly adds 1 break
// ===========================================================================
describe("PhysicalReactionResolver — break logic", () => {
  it("adds 1 break stack when no existing break", () => {
    const s = makeStatus();
    const out = resolvePhysicalAnomaly(s, "launch", "A", 0);

    expect(s.getBreakStacks()).toBe(1);
    expect(outcomeTypes(out)).toContain("BREAK_CHANGED");
    // No damage when target had no break
    expect(outcomeTypes(out)).not.toContain("PHYSICAL_DAMAGE");
  });

  // 7. Has break: launch/knockdown add stack + damage
  it("launch adds stack and produces damage when break exists", () => {
    const s = makeStatus();
    s.addBreakStack(0); // 1 stack
    const out = resolvePhysicalAnomaly(s, "launch", "A", 1);

    expect(s.getBreakStacks()).toBe(2);
    expect(outcomeTypes(out)).toContain("PHYSICAL_DAMAGE");
    expect(outcomeTypes(out)).toContain("BREAK_CHANGED");
  });

  it("knockdown adds stack and produces damage when break exists", () => {
    const s = makeStatus();
    s.addBreakStack(0);
    const out = resolvePhysicalAnomaly(s, "knockdown", "A", 1);

    expect(s.getBreakStacks()).toBe(2);
    expect(outcomeTypes(out)).toContain("PHYSICAL_DAMAGE");
  });

  // armorBreak clears break + applies physical vuln
  it("armorBreak clears break and applies physical vuln", () => {
    const s = makeStatus();
    s.addBreakStack(0);
    s.addBreakStack(0);
    expect(s.getBreakStacks()).toBe(2);

    const out = resolvePhysicalAnomaly(s, "armorBreak", "A", 1);

    expect(s.hasBreak()).toBe(false);
    expect(outcomeTypes(out)).toContain("PHYSICAL_DAMAGE");
    expect(outcomeTypes(out)).toContain("BREAK_CLEARED");
    expect(outcomeTypes(out)).toContain("PHYSICAL_VULN_APPLIED");
  });

  // slam clears break, no vuln
  it("slam clears break without physical vuln", () => {
    const s = makeStatus();
    s.addBreakStack(0);
    const out = resolvePhysicalAnomaly(s, "slam", "A", 1);

    expect(s.hasBreak()).toBe(false);
    expect(outcomeTypes(out)).toContain("PHYSICAL_DAMAGE");
    expect(outcomeTypes(out)).toContain("BREAK_CLEARED");
    expect(outcomeTypes(out)).not.toContain("PHYSICAL_VULN_APPLIED");
  });
});

// ===========================================================================
// 8. Burn overwrite logic
// ===========================================================================
describe("Burn", () => {
  it("low level overwrites high level burn", () => {
    const s = makeStatus();
    s.applyBurn(4, "A", 0);
    expect(s.burn!.level).toBe(4);

    s.applyBurn(1, "B", 5);
    expect(s.burn!.level).toBe(1);
    expect(s.burn!.sourceActorId).toBe("B");
    expect(s.burn!.expiresAt).toBe(15); // 5 + 10
  });
});

// ===========================================================================
// 9. Corrosion refresh logic (currentResistDown does not regress)
// ===========================================================================
describe("Corrosion", () => {
  it("preserves currentResistDown when reapplied", () => {
    const s = makeStatus();
    s.applyCorrosion(4, "A", 0);
    // Simulate some time passing to build up resistDown
    s.advanceCorrosion(5, 5); // 5s * 3.0/s = 15
    expect(s.corrosion!.currentResistDown).toBe(15);

    // Reapply at lower level
    s.applyCorrosion(1, "B", 5);
    // currentResistDown should NOT have gone down
    expect(s.corrosion!.currentResistDown).toBe(15);
    // But timer refreshed
    expect(s.corrosion!.expiresAt).toBe(20); // 5 + 15
    // Level updated
    expect(s.corrosion!.level).toBe(1);
  });

  it("maxResistDown only increases, not decreases", () => {
    const s = makeStatus();
    s.applyCorrosion(4, "A", 0); // max = 30
    expect(s.corrosion!.maxResistDown).toBe(30);

    s.applyCorrosion(1, "B", 1); // max for level 1 = 15, but existing 30 stays
    expect(s.corrosion!.maxResistDown).toBe(30);
  });
});

// ===========================================================================
// 10. Integration: old data without anomaly events doesn't break
// ===========================================================================
describe("Integration — backward compatibility", () => {
  it("engine runs without any anomaly events", () => {
    const engine = makeEngine();

    engine.enqueue({
      type: "ACTION_START",
      time: 1.0,
      payload: { skillId: "s", actionId: "i1", spCost: 0, actorId: "A", type: "skill" },
    });

    const state = engine.run();
    expect(state).toBeDefined();
    // Enemy status should be clean
    expect(state.enemy.status.hasMagicAttachment()).toBe(false);
    expect(state.enemy.status.hasBreak()).toBe(false);
  });

  it("processes anomaly events alongside regular events", () => {
    const engine = makeEngine();

    engine.enqueue({
      type: "ACTION_START",
      time: 0,
      payload: { skillId: "s", actionId: "i1", spCost: 0, actorId: "A", type: "skill" },
    });

    engine.enqueue({
      type: "APPLY_MAGIC_ATTACHMENT",
      time: 0.5,
      payload: { element: "fire", sourceActorId: "A", targetId: "boss" },
    });

    engine.enqueue({
      type: "APPLY_MAGIC_ATTACHMENT",
      time: 1.0,
      payload: { element: "fire", sourceActorId: "A", targetId: "boss" },
    });

    const state = engine.run();
    const log = engine.getSimLog();

    // Fire attachment at 2 stacks — below threshold, no burst
    expect(state.enemy.status.getMagicElement()).toBe("fire");
    expect(state.enemy.status.getMagicStacks()).toBe(2);

    // No burst damage at 2 stacks (threshold is 4)
    const dmgEntries = log.filter(e => e.type === "ANOMALY_DAMAGE");
    expect(dmgEntries.length).toBe(0);
  });

  it("full cross-element reaction produces debuff and damage", () => {
    const engine = makeEngine([makeActor("A"), makeActor("B")]);

    engine.enqueue({
      type: "APPLY_MAGIC_ATTACHMENT",
      time: 0,
      payload: { element: "fire", sourceActorId: "A", targetId: "boss" },
    });
    engine.enqueue({
      type: "APPLY_MAGIC_ATTACHMENT",
      time: 0.1,
      payload: { element: "fire", sourceActorId: "A", targetId: "boss" },
    });
    // Now 2 stacks fire. Apply cold → reaction
    engine.enqueue({
      type: "APPLY_MAGIC_ATTACHMENT",
      time: 1,
      payload: { element: "cold", sourceActorId: "B", targetId: "boss" },
    });

    const state = engine.run();
    const log = engine.getSimLog();

    // Fire attachment cleared, freeze applied at level 2
    expect(state.enemy.status.hasMagicAttachment()).toBe(false);
    expect(state.enemy.status.freeze).not.toBeNull();
    expect(state.enemy.status.freeze!.level).toBe(2);

    // Only cross-element reaction damage (no burst from 2-stack same-fire)
    const dmgEntries = log.filter(e => e.type === "ANOMALY_DAMAGE");
    expect(dmgEntries.length).toBe(1);
    if (dmgEntries[0]?.type === "ANOMALY_DAMAGE") {
      expect(dmgEntries[0].payload.damage).toBeGreaterThan(0);
    }
  });

  it("physical anomaly + frozen → shatter via integration", () => {
    const engine = makeEngine([makeActor("A"), makeActor("B")]);

    // Direct freeze
    engine.enqueue({
      type: "APPLY_DIRECT_ANOMALY",
      time: 0,
      payload: { anomalyType: "freeze", level: 3 as AnomalyLevel, sourceActorId: "A", targetId: "boss" },
    });

    // Physical anomaly at t=1
    engine.enqueue({
      type: "APPLY_PHYSICAL_ANOMALY",
      time: 1,
      payload: { physicalType: "launch", sourceActorId: "B", targetId: "boss" },
    });

    const state = engine.run();
    const log = engine.getSimLog();

    // Shatter should have occurred
    expect(state.enemy.status.freeze!.shattered).toBe(true);

    // Log should have shatter damage
    const dmgEntries = log.filter(e => e.type === "ANOMALY_DAMAGE");
    const shatterDmg = dmgEntries.find(
      e => e.type === "ANOMALY_DAMAGE" && e.payload.tags.damageSource === "shatter",
    );
    expect(shatterDmg).toBeDefined();
    expect(shatterDmg!.payload.tags.canCrit).toBe(true);
    expect(shatterDmg!.payload.tags.sourceActorId).toBe("B");
    // Shatter damage should be non-zero
    expect(shatterDmg!.payload.damage).toBeGreaterThan(0);
  });
});
