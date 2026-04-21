/**
 * storeAdapter — attack chain detection tests
 *
 * Verifies that LASTRITE's skillInChain variant is selected
 * when the skill is placed during an attack chain.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { preloadV2Modules } from "./characters/adapter";
import { buildV2Inputs, buildAllPanels, collectPotentialCooldownMods, adjustSkillCooldowns } from "./storeAdapter";

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

describe("storeAdapter — cooldown_modifier flat-seconds application", () => {
  it("collectPotentialCooldownMods sums only active potentials (level ≤ chosen)", () => {
    const mod = {
      potentials: [
        { level: 3, effects: [{ type: "cooldown_modifier", stat: "link", value: -1 }] },
        { level: 5, effects: [{ type: "cooldown_modifier", stat: "link", value: -2 }] },
        { level: 5, effects: [{ type: "cooldown_modifier", stat: "skill", value: -3 }] },
      ],
    };
    // At P2: no potentials active
    expect(collectPotentialCooldownMods(mod, 2)).toEqual({ link: 0, skill: 0, ultimate: 0 });
    // At P3: only first applies
    expect(collectPotentialCooldownMods(mod, 3)).toEqual({ link: -1, skill: 0, ultimate: 0 });
    // At P5: all apply — link stacks (-1 + -2), skill separately
    expect(collectPotentialCooldownMods(mod, 5)).toEqual({ link: -3, skill: -3, ultimate: 0 });
  });

  it("collectPotentialCooldownMods ignores non-cooldown_modifier effects", () => {
    const mod = {
      potentials: [
        { level: 1, effects: [
          { type: "stat_bonus", stat: "will", value: 20 },
          { type: "cooldown_modifier", stat: "link", value: -1 },
        ] },
      ],
    };
    expect(collectPotentialCooldownMods(mod, 1)).toEqual({ link: -1, skill: 0, ultimate: 0 });
  });

  it("adjustSkillCooldowns: produces new skill objects with reduced cooldowns, doesn't mutate source", () => {
    const origLink = { id: "lnk", type: "link", cooldown: 10, duration: 1, hits: [] } as any;
    const origSkill = { id: "sk", type: "skill", cooldown: 8, duration: 1, hits: [] } as any;
    const origUlt = { id: "ult", type: "ultimate", cooldown: 20, duration: 1, hits: [] } as any;
    const skills = { link: origLink, skill: origSkill, ultimate: origUlt };
    const adjusted = adjustSkillCooldowns(skills, { link: -2, skill: -3, ultimate: -5 });

    expect(adjusted.link.cooldown).toBe(8);     // 10 - 2
    expect(adjusted.skill.cooldown).toBe(5);    // 8 - 3
    expect(adjusted.ultimate.cooldown).toBe(15); // 20 - 5

    // Source unchanged
    expect(origLink.cooldown).toBe(10);
    expect(origSkill.cooldown).toBe(8);
    expect(origUlt.cooldown).toBe(20);
  });

  it("adjustSkillCooldowns: flat reduction clamped at 0 (cooldown can't go negative)", () => {
    const origLink = { id: "lnk", type: "link", cooldown: 3, duration: 1, hits: [] } as any;
    const adjusted = adjustSkillCooldowns({ link: origLink }, { link: -10, skill: 0, ultimate: 0 });
    expect(adjusted.link.cooldown).toBe(0);
  });

  it("adjustSkillCooldowns: skills with cooldown=0 are left untouched (no adjustment)", () => {
    const origLink = { id: "lnk", type: "link", cooldown: 0, duration: 1, hits: [] } as any;
    const adjusted = adjustSkillCooldowns({ link: origLink }, { link: -2, skill: 0, ultimate: 0 });
    // Returns original reference (cooldown=0 skills don't need adjustment)
    expect(adjusted.link).toBe(origLink);
    expect(adjusted.link.cooldown).toBe(0);
  });

  it("adjustSkillCooldowns: handles array-valued `link` (variants)", () => {
    const origLinks = [
      { id: "l1", type: "link", cooldown: 10, duration: 1, hits: [] } as any,
      { id: "l2", type: "link", cooldown: 12, duration: 1, hits: [] } as any,
    ];
    const adjusted = adjustSkillCooldowns({ link: origLinks }, { link: -2, skill: 0, ultimate: 0 });
    expect(adjusted.link[0].cooldown).toBe(8);
    expect(adjusted.link[1].cooldown).toBe(10);
    expect(origLinks[0].cooldown).toBe(10);
  });

  it("adjustSkillCooldowns: skillInChain is adjusted by the `skill` key (shared stat bucket)", () => {
    const base = { id: "sk", type: "skill", cooldown: 6, duration: 1, hits: [] } as any;
    const chain = { id: "sk_chain", type: "skill", cooldown: 6, duration: 1, hits: [] } as any;
    const adjusted = adjustSkillCooldowns({ skill: base, skillInChain: chain }, { link: 0, skill: -2, ultimate: 0 });
    expect(adjusted.skill.cooldown).toBe(4);
    expect(adjusted.skillInChain.cooldown).toBe(4);
  });
});

describe("storeAdapter — buildAllPanels + precomputedPanels passthrough", () => {
  beforeAll(async () => {
    await preloadV2Modules();
  });

  it("buildAllPanels: returns one panel per V2-ready active track", () => {
    const tracks = [
      makeTrack("LASTRITE", [makeAction({ type: "skill", startTime: 0, duration: 1 })]),
      makeTrack("POGRANICHNK", [makeAction({ type: "link", startTime: 0, duration: 1 })]),
    ];
    const panels = buildAllPanels(tracks, [], () => null, () => 300);
    expect(panels).not.toBeNull();
    expect(panels!.length).toBe(2);
    expect(panels!.map(p => p.actorId).sort()).toEqual(["LASTRITE", "POGRANICHNK"]);
    expect(panels!.every(p => Array.isArray(p.triggers))).toBe(true);
  });

  it("buildAllPanels: returns null when any active track is not V2-ready", () => {
    const tracks = [
      makeTrack("LASTRITE", [makeAction({ type: "skill", startTime: 0, duration: 1 })]),
      makeTrack("UNKNOWN_CHAR", [makeAction({ type: "skill", startTime: 0, duration: 1 })]),
    ];
    const panels = buildAllPanels(tracks, [], () => null, () => 300);
    expect(panels).toBeNull();
  });

  it("buildV2Inputs with precomputedPanels produces equivalent kernel inputs", () => {
    const tracks = [
      makeTrack("LASTRITE", [
        makeAction({ type: "attack", startTime: 0, duration: f(55), kind: "attack_auto_placed", attackSequenceIndex: 1 }),
        makeAction({ type: "skill", startTime: f(55), duration: f(103) }),
      ]),
    ];
    const panels = buildAllPanels(tracks, [], () => null, () => 300)!;

    const fresh = buildV2Inputs(tracks as any, [], [], SYSTEM, () => null, () => 300);
    const cached = buildV2Inputs(tracks as any, [], [], SYSTEM, () => null, () => 300, undefined, undefined, panels);

    expect(fresh).not.toBeNull();
    expect(cached).not.toBeNull();

    // Same number of placed skills, same order, same resolved CDs.
    expect(cached!.skills.length).toBe(fresh!.skills.length);
    for (let i = 0; i < fresh!.skills.length; i++) {
      expect(cached!.skills[i].skill.id).toBe(fresh!.skills[i].skill.id);
      expect(cached!.skills[i].skill.cooldown).toBe(fresh!.skills[i].skill.cooldown);
    }
    // Same triggers count per actor.
    for (const actorId of fresh!.triggersByActor.keys()) {
      expect(cached!.triggersByActor.get(actorId)?.length).toBe(fresh!.triggersByActor.get(actorId)?.length);
    }
  });

  it("buildV2Inputs ignores precomputedPanels for tracks that have been removed", () => {
    const tracksFull = [makeTrack("LASTRITE", [makeAction({ type: "skill", startTime: 0, duration: 1 })])];
    const panels = buildAllPanels(tracksFull, [], () => null, () => 300)!;

    // Now call buildV2Inputs with NO active tracks but panels present.
    const empty = buildV2Inputs([] as any, [], [], SYSTEM, () => null, () => 300, undefined, undefined, panels);
    expect(empty).toBeNull(); // no active tracks → null regardless of cached panels
  });
});

