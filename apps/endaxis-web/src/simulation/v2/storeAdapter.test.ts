/**
 * storeAdapter — attack chain detection tests
 *
 * Verifies that LASTRITE's skillInChain variant is selected
 * when the skill is placed during an attack chain.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { preloadV2Modules } from "./characters/adapter";
import { buildV2Inputs } from "./storeAdapter";

// ── Helper: minimal track with actions ──
function makeTrack(id: string, actions: any[]) {
  return {
    id,
    actions,
    weaponId: undefined,
    stats: {},
    growth: {
      promotion: 4,
      characterLevel: 90,
      potentialLevel: 0,
      skillLevels: {},
      talentLevels: {},
    },
  };
}

function makeAction(overrides: any) {
  return {
    instanceId: `inst_${Math.random().toString(36).slice(2, 8)}`,
    id: overrides.id || "test",
    type: overrides.type || "attack",
    startTime: overrides.startTime || 0,
    duration: overrides.duration || 1,
    isDisabled: false,
    ...overrides,
  };
}

const SYSTEM = {
  initialSp: 500,
  maxStagger: 1000,
  staggerNodeCount: 3,
  staggerNodeDuration: 5,
  staggerBreakDuration: 10,
};

const f = (frames: number) => frames / 60;

describe("storeAdapter — attack chain detection", () => {
  beforeAll(async () => {
    await preloadV2Modules();
  });

  it("selects skillInChain when skill follows attacks in combo window", () => {
    const track = makeTrack("LASTRITE", [
      makeAction({ type: "attack", startTime: 0, duration: f(55), kind: "attack_auto_placed", attackSequenceIndex: 1 }),
      makeAction({ type: "attack", startTime: f(55), duration: f(67), kind: "attack_auto_placed", attackSequenceIndex: 2 }),
      makeAction({ type: "attack", startTime: f(55 + 67), duration: f(100), kind: "attack_auto_placed", attackSequenceIndex: 3 }),
      makeAction({ type: "skill", startTime: f(55 + 67 + 100), duration: f(103) }),
    ]);

    const result = buildV2Inputs(
      [track], [], [], SYSTEM,
      () => null,
      () => 300,
    );

    expect(result).not.toBeNull();
    const skillAction = result!.skills.find(s => s.skill.type === "skill");
    expect(skillAction).toBeDefined();
    // Should select in-chain variant (duration=0, id contains "chain")
    expect(skillAction!.skill.id).toBe("lastrite_skill_chain");
    expect(skillAction!.skill.duration).toBe(0);
  });

  it("selects normal skill when no preceding attacks", () => {
    const track = makeTrack("LASTRITE", [
      makeAction({ type: "skill", startTime: 0, duration: f(103) }),
    ]);

    const result = buildV2Inputs(
      [track], [], [], SYSTEM,
      () => null,
      () => 300,
    );

    expect(result).not.toBeNull();
    const skillAction = result!.skills.find(s => s.skill.type === "skill");
    expect(skillAction).toBeDefined();
    expect(skillAction!.skill.id).toBe("lastrite_skill");
    expect(skillAction!.skill.duration).toBe(f(103));
  });

  it("selects normal skill when combo expired (gap > 0.5s)", () => {
    const track = makeTrack("LASTRITE", [
      makeAction({ type: "attack", startTime: 0, duration: f(55), kind: "attack_auto_placed", attackSequenceIndex: 1 }),
      // 2 second gap → combo expired
      makeAction({ type: "skill", startTime: f(55) + 2, duration: f(103) }),
    ]);

    const result = buildV2Inputs(
      [track], [], [], SYSTEM,
      () => null,
      () => 300,
    );

    expect(result).not.toBeNull();
    const skillAction = result!.skills.find(s => s.skill.type === "skill");
    expect(skillAction!.skill.id).toBe("lastrite_skill");
  });

  it("re-evaluates attack segment indices based on position", () => {
    // Two attacks with a gap → combo resets, second attack should be A1
    const track = makeTrack("LASTRITE", [
      makeAction({ type: "attack", startTime: 0, duration: f(55), kind: "attack_auto_placed", attackSequenceIndex: 1 }),
      // Large gap → combo expired
      makeAction({ type: "attack", startTime: 5, duration: f(55), kind: "attack_auto_placed", attackSequenceIndex: 2 }),
    ]);

    const result = buildV2Inputs(
      [track], [], [], SYSTEM,
      () => null,
      () => 300,
    );

    expect(result).not.toBeNull();
    const attacks = result!.skills.filter(s => s.skill.type === "attack");
    expect(attacks).toHaveLength(2);
    // Both should be A1 (combo expired before second attack)
    expect(attacks[0].skill.id).toBe("lastrite_a1");
    expect(attacks[1].skill.id).toBe("lastrite_a1");
  });

  it("correctly assigns A4 (heavy attack) as 4th consecutive segment", () => {
    const track = makeTrack("LASTRITE", [
      makeAction({ type: "attack", startTime: 0, duration: f(55), kind: "attack_auto_placed" }),
      makeAction({ type: "attack", startTime: f(55), duration: f(67), kind: "attack_auto_placed" }),
      makeAction({ type: "attack", startTime: f(55 + 67), duration: f(100), kind: "attack_auto_placed" }),
      makeAction({ type: "attack", startTime: f(55 + 67 + 100), duration: f(130), kind: "attack_auto_placed" }),
    ]);

    const result = buildV2Inputs(
      [track], [], [], SYSTEM,
      () => null,
      () => 300,
    );

    expect(result).not.toBeNull();
    const attacks = result!.skills.filter(s => s.skill.type === "attack");
    expect(attacks).toHaveLength(4);
    expect(attacks[0].skill.id).toBe("lastrite_a1");
    expect(attacks[1].skill.id).toBe("lastrite_a2");
    expect(attacks[2].skill.id).toBe("lastrite_a3");
    expect(attacks[3].skill.id).toBe("lastrite_a4");
    expect(attacks[3].skill.isHeavyAttack).toBe(true);
  });
});
