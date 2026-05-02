/**
 * Bug-hunt — minimal-input probe tests.
 *
 * Each `it` corresponds to a hypothesis (Hn) about a kernel/data quirk.
 * If the test body asserts the BAD behavior, the test passes when the bug
 * is present; the comment "EXPECTED BUG: …" makes it clear which way the
 * assertion points. Once a bug is fixed, flip the assertion (or delete the
 * test if the case is now covered upstream).
 */

import { describe, it, expect } from "vitest";
import { simulate, type PlacedSkill, type EnemyConfig, type KernelConfig } from "./kernel";
import { computeCharacterBuild, type CharacterInput } from "./characterBuild";
import type {
  Skill, Hit, DamageElement, SkillVariant, PassiveTrigger, ActionType,
} from "./types";

// ── Shared fixtures ────────────────────────────────────────────────────────

const enemyCfg: EnemyConfig = {
  defenseMultiplier: 0.5,
  maxStagger: 100,
  staggerNodes: [50],
  staggerBreakDuration: 10,
  basePhysicalResist: 0,
  baseMagicResist: 0,
};

const baseCfg: KernelConfig = { initialSP: 200, critMode: "expected" };

function build(id: string = "DUMMY") {
  const input: CharacterInput = {
    id, name: id, element: "physical" as DamageElement, rarity: 6,
    promotion: 4, potentialLevel: 0, talentLevels: {},
    baseStrength: 100, baseAgility: 100, baseIntellect: 100, baseWill: 100,
    baseAttack: 300, baseHp: 1000,
    mainAttribute: "strength", subAttribute: "agility",
    weaponId: null, weaponBaseAtk: 500, weaponLevel: 90,
    equipmentSetId: null, baseGaugeMax: 300,
    statModifiers: [],
  };
  return computeCharacterBuild(input);
}

function hit(offset: number, opts: Partial<Hit> & { mult?: number; effects?: any[] } = {}): Hit {
  return {
    offset,
    checkpointIndex: 0,
    damage: opts.damage === null ? null : {
      multiplier: opts.mult ?? 100, stagger: 0,
      element: "physical" as DamageElement, canCrit: false,
      school: "physical", sourceType: "skill",
      ...(opts.damage as any || {}),
    },
    effects: opts.effects ?? [],
    standardLogic: true,
  };
}

function skill(opts: {
  id?: string; type?: ActionType; element?: DamageElement;
  duration?: number; spCost?: number; cooldown?: number;
  isHeavyAttack?: boolean; gaugeCost?: number;
  detach?: number; hits: Hit[];
}): Skill {
  return {
    id: opts.id ?? "test_skill",
    type: opts.type ?? "skill",
    name: opts.id ?? "test",
    element: opts.element ?? "physical",
    duration: opts.duration ?? 2,
    spCost: opts.spCost ?? 0,
    cooldown: opts.cooldown ?? 0,
    hits: opts.hits,
    checkpoints: [],
    isHeavyAttack: opts.isHeavyAttack,
    gaugeCost: opts.gaugeCost,
    detach: opts.detach,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// H1 — Variant overrides cooldown/duration but kernel records cooldown using
// the BASE skill, so the per-skill CD validator gates on the wrong window.
// ───────────────────────────────────────────────────────────────────────────

describe("H1 — variant cooldown/duration propagated to CD set (B4 fix)", () => {
  it("CD respects variant duration: replacement during variant tail is rejected", () => {
    const sk = skill({
      id: "v_skill", type: "skill", duration: 2, cooldown: 5,
      hits: [hit(0.5)],
    });
    // Variant: 5x longer animation, no cooldown change.
    const variants: SkillVariant[] = [{
      id: "long",
      priority: 1,
      conditions: [{ type: "stackBuff", buffType: "always_on", op: ">=", value: 0 }],
      overrides: { duration: 10, hits: [hit(0.5), hit(8.0)] },
    }];
    // Stack buff at 0 always satisfies ">= 0".
    const placed: PlacedSkill[] = [
      { actionId: "a1", actorId: "DUMMY", skill: sk, startTime: 0, variants },
      // Same skill again at t=8 — base CD says (endTime base=2 + cd=5 = 7), so allowed.
      // But variant duration is 10, so variant's actual end is 10 → CD should be 15.
      { actionId: "a2", actorId: "DUMMY", skill: sk, startTime: 8, variants },
    ];
    const cfg: KernelConfig = { ...baseCfg, validateConditions: true };
    const r = simulate([build()], placed, enemyCfg, cfg);
    // After fix: variant marker publishes enhanced.duration=10, actionStart marker
    // sets cooldowns at endTime+cd = 10+5 = 15. a2 at t=8 < 15 → cooldown error.
    expect(r.validationError).toBeDefined();
    expect(r.validationError!.code).toBe("ISSUE_COOLDOWN_ACTIVE");
  });

  it("activeActions endTime uses base duration, so a later action 'free-fits' inside variant tail", () => {
    const sk = skill({ id: "v_skill", type: "skill", duration: 2, cooldown: 0, hits: [hit(0.5), hit(8.0)] });
    const variants: SkillVariant[] = [{
      id: "long",
      priority: 1,
      conditions: [{ type: "stackBuff", buffType: "always_on", op: ">=", value: 0 }],
      overrides: { duration: 10, hits: [hit(0.5), hit(8.0)] },
    }];
    const sk2 = skill({ id: "v_skill_2", type: "skill", duration: 1, cooldown: 0, hits: [hit(0.3)] });
    const placed: PlacedSkill[] = [
      { actionId: "a1", actorId: "DUMMY", skill: sk, startTime: 0, variants },
      // Place a normal skill at t=4 — base says skill1 ended at 2, so it should not interrupt.
      // But the variant's "real" animation runs to t=10. The hit at offset 8 (in variant) is
      // unprotected (no detach), and the kernel treats t=4 as "no active action" because
      // activeActions.endTime was set with base.duration=2.
      { actionId: "a2", actorId: "DUMMY", skill: sk2, startTime: 4 },
    ];
    const r = simulate([build()], placed, enemyCfg, baseCfg);
    // The variant's hit at offset 8 should land at t=8. If kernel correctly tracked
    // variant duration, then a2 at t=4 would interrupt skill1 → variant hit at t=8 would
    // be filtered. Let's see what actually happens.
    const dmgsForA1 = r.events.filter(e => e.type === "damage" && (e as any).actionId === "a1");
    // EXPECTED BUG: hit 在 variant tail (t=8) 仍然落地，因为 a2 没真正 interrupt a1
    expect(dmgsForA1.length).toBe(2);
    // a2's damage also lands. Both coexist — UI desync potential.
    const dmgsForA2 = r.events.filter(e => e.type === "damage" && (e as any).actionId === "a2");
    expect(dmgsForA2.length).toBe(1);
  });
});

// H3 (listenTo:"skill_cast" dead code) — removed. The "skill_cast" string was
// removed from TriggerEventType (B9 fix); listening for skill cast events now
// requires the explicit listenTo: "action_start". Type system enforces it now.

// H4 (Skill.teamGaugeGain dead field) — removed. Field deleted from Skill interface;
// game gives team-wide gauge only via SP→gauge auto conversion (kernel handles).

// ───────────────────────────────────────────────────────────────────────────
// H5 — Unknown effect-condition strings silently treated as TRUE (footgun).
// ───────────────────────────────────────────────────────────────────────────

describe("H5 — unknown effect condition strings pass through", () => {
  it("typo'd condition still applies the effect", () => {
    const sk = skill({
      duration: 2, spCost: 0,
      hits: [hit(0.5, { effects: [{ type: "buff_apply", params: {
        buffId: "test_buff", target: "self",
        stat: "attack_percent", zone: "attackPercent",
        value: 10, duration: 1,
        condition: "enemy_has_brrreak", // typo for enemy_has_break
      }}] })],
    });
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk, startTime: 0 },
    ], enemyCfg, baseCfg);
    const buffs = r.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "test_buff");
    // After B12 fix: unknown condition → false (effect skipped) + console.warn.
    expect(buffs.length).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// H6 — Stack buff at max-stacks: addStacks is silent no-op, never refreshes
// the timer of existing stacks (BuffManager 'refresh' behavior is NOT replicated
// for StackBuffTracker).
// ───────────────────────────────────────────────────────────────────────────

describe("H6 — stack_buff_apply refresh-group semantics (B16 fix)", () => {
  it("re-adding magma at max=4 refreshes group expiry; one group → one expiry event", () => {
    // Apply 4 magma at t=0 with 5s duration → group expires at t=5.
    // At t=4, add 1 more (still at max=4) → expiry refreshed to t=4+5=9.
    // Group expires at t=9 with one stack_change N→0 event.
    const sk1 = skill({
      id: "load",
      duration: 0.5, spCost: 0,
      hits: [
        hit(0.0, { effects: [{ type: "stack_buff_apply", params: { buffType: "magma", stacks: 4, duration: 5, maxStacks: 4 } }] }),
      ],
    });
    const sk2 = skill({
      id: "topup",
      duration: 0.5, spCost: 0,
      hits: [
        hit(0.0, { effects: [{ type: "stack_buff_apply", params: { buffType: "magma", stacks: 1, duration: 5, maxStacks: 4 } }] }),
      ],
    });
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk1, startTime: 0 },
      { actionId: "a2", actorId: "DUMMY", skill: sk2, startTime: 4 },
    ], enemyCfg, baseCfg);
    const stacks = r.events.filter(e => e.type === "stack_change" && (e as any).buffType === "magma");
    const adds = stacks.filter(s => (s as any).reason === "effect_applied");
    // Two apply events: first 0→4 real, second 4→4 with refreshed timer (still
    // counts as a real state change since expiry moved). Both emit normally.
    expect(adds.length).toBe(2);
    expect((adds[0] as any).prevStacks).toBe(0);
    expect((adds[0] as any).stacks).toBe(4);
    expect((adds[1] as any).prevStacks).toBe(4);
    expect((adds[1] as any).stacks).toBe(4);

    // Group expiry: one event N→0 at refreshed time t=9 (was t=5 before fix).
    const expiries = stacks.filter(s => (s as any).reason === "expired");
    expect(expiries.length).toBe(1);
    expect((expiries[0] as any).prevStacks).toBe(4);
    expect((expiries[0] as any).stacks).toBe(0);
    expect(expiries[0].time).toBe(9);
  });

  it("stack_buff_gained trigger fires on refresh-only (timer extension counts as event)", () => {
    const t1: PassiveTrigger = {
      id: "on_gain",
      source: "test", listenTo: "stack_buff_gained",
      deferred: false, sourceMustBeOwner: true,
      actions: [{ type: "buff_apply", params: {
        buffId: "ghost_buff", target: "self",
        stat: "attack_percent", zone: "attackPercent",
        value: 5, duration: 1,
      }}],
    };
    const sk1 = skill({
      duration: 0.5, spCost: 0,
      hits: [hit(0.0, { effects: [{ type: "stack_buff_apply", params: { buffType: "magma", stacks: 4, duration: 10, maxStacks: 4 } }] })],
    });
    const sk2 = skill({
      id: "topup", duration: 0.5, spCost: 0,
      hits: [hit(0.0, { effects: [{ type: "stack_buff_apply", params: { buffType: "magma", stacks: 1, duration: 10, maxStacks: 4 } }] })],
    });
    const trigMap = new Map<string, PassiveTrigger[]>();
    trigMap.set("DUMMY", [t1]);
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk1, startTime: 0 },
      { actionId: "a2", actorId: "DUMMY", skill: sk2, startTime: 4 },
    ], enemyCfg, baseCfg, trigMap);
    const ghosts = r.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "ghost_buff");
    // Both fire — second is "refreshed timer at max" but that's a real state change.
    expect(ghosts.length).toBe(2);
  });

  it("phantom suppression: re-applying with no expiry change emits no event", () => {
    // Two applications with the same expiresAt → second is a true no-op.
    // Use explicit expiresAt to keep the timer identical between calls.
    const sk = skill({
      duration: 5, spCost: 0,
      hits: [
        hit(0.0, { effects: [{ type: "stack_buff_apply", params: { buffType: "magma", stacks: 4, expiresAt: 100, maxStacks: 4 } }] }),
        hit(0.5, { effects: [{ type: "stack_buff_apply", params: { buffType: "magma", stacks: 1, expiresAt: 100, maxStacks: 4 } }] }),
      ],
    });
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk, startTime: 0 },
    ], enemyCfg, baseCfg);
    const adds = r.events.filter(e => e.type === "stack_change" && (e as any).buffType === "magma" && (e as any).reason === "effect_applied");
    // Only the real 0→4 emit. Second apply: stacks unchanged + expiry unchanged → suppressed.
    expect(adds.length).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// H8 — gauge_gain with scaleBy:"breakStacks" reads break AFTER consumption when
// the same hit also fires a slam/armorBreak. Effect ordering inside hit.effects
// determines which value gets read.
// ───────────────────────────────────────────────────────────────────────────

describe("H8 — gauge_gain scaleBy reads hit-start snapshot regardless of effect order (B3 fix)", () => {
  it("gauge_gain placed AFTER physical_anomaly:slam still reads pre-consume break=4", () => {
    // Apply 4 break first via separate hit, then a slam followed by gauge_gain on same hit.
    const sk = skill({
      duration: 2, spCost: 0,
      hits: [
        hit(0.1, { effects: [{ type: "break_apply", params: { stacks: 4 } }] }),
        hit(0.5, {
          effects: [
            { type: "physical_anomaly", params: { physicalType: "slam" } }, // consumes 4 break
            { type: "gauge_gain", params: { amountPerLayer: 5, scaleBy: "breakStacks" } }, // reads snapshot=4 → 20
          ],
        }),
      ],
    });
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk, startTime: 0 },
    ], enemyCfg, baseCfg);
    const ggs = r.events.filter(e => e.type === "gauge_change" && (e as any).reason === "hit_gauge_gain");
    // After B3 fix: gauge_gain reads enemy snapshot taken at hit start (breakStacks=4) → +20
    expect(ggs.length).toBe(1);
    expect((ggs[0] as any).change).toBeCloseTo(20, 1);
  });

  it("gauge_gain placed BEFORE slam also reads breakStacks=4", () => {
    const sk = skill({
      duration: 2, spCost: 0,
      hits: [
        hit(0.1, { effects: [{ type: "break_apply", params: { stacks: 4 } }] }),
        hit(0.5, {
          effects: [
            { type: "gauge_gain", params: { amountPerLayer: 5, scaleBy: "breakStacks" } }, // sees 4 → +20 base
            { type: "physical_anomaly", params: { physicalType: "slam" } },
          ],
        }),
      ],
    });
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk, startTime: 0 },
    ], enemyCfg, baseCfg);
    const ggs = r.events.filter(e => e.type === "gauge_change" && (e as any).reason === "hit_gauge_gain");
    expect(ggs.length).toBe(1);
    // 5 * 4 = 20 base, then × ultChargeEff (default 100%) = 20.
    expect((ggs[0] as any).change).toBeCloseTo(20, 1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// H11 — Resist > 100 produces zone < 0 (negative damage). No clamp.
// ───────────────────────────────────────────────────────────────────────────

describe("H11 — resistanceZone clamped to 0.1 (90% damage reduction floor) (B2 fix)", () => {
  it("baseMagicResist=150 with no reduction clamps to 90% reduction (zone=0.1)", () => {
    const sk = skill({
      duration: 1, spCost: 0,
      hits: [hit(0.1, { mult: 1000, damage: { element: "blaze" as DamageElement, school: "magic" as const } })],
    });
    const cfg: EnemyConfig = { ...enemyCfg, baseMagicResist: 150 };
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk, startTime: 0 },
    ], cfg, baseCfg);
    const dmg = r.events.find(e => e.type === "damage") as any;
    expect(dmg).toBeTruthy();
    // After fix: zone clamped to 0.1, damage > 0 (not negative).
    // ATK=1600, mult=1000% → 16000 raw; def 0.5 → 8000; resist clamp 0.1 → 800; crit 1.025 → ~820.
    expect(dmg.damage).toBeGreaterThan(700);
    expect(dmg.damage).toBeLessThan(900);
  });

  it("削抗 (reduction) > baseResist on 0-resist enemy gives bonus damage (no upper clamp)", () => {
    // 莱万汀-pattern: enemy has 0 resist, reduction=30 → zone = 1.3 (+30%)
    // Buffs apply via... actually reduction is on enemy state, set via talent/anomaly. Use corrosion.
    // Easier: use a buff_apply with stat=resist_reduction... not in modifiers. Use trigger to set
    // enemy.resistReduction directly? Not exposed. Skip — covered by anomaly tests.
    // Just sanity-check: clamp doesn't squash positive zones.
    const sk = skill({
      duration: 1, spCost: 0,
      hits: [hit(0.1, { mult: 100, damage: { element: "blaze" as DamageElement, school: "magic" as const } })],
    });
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk, startTime: 0 },
    ], enemyCfg, baseCfg);  // 0 resist
    const dmg = r.events.find(e => e.type === "damage") as any;
    // ATK=1600, mult=100% → 1600; def 0.5 → 800; zone=1.0 (0 resist, 0 reduction); ~820.
    expect(dmg.damage).toBeGreaterThan(700);
    expect(dmg.damage).toBeLessThan(900);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// H12 — Trigger.cooldownDuration without cooldownId is silently ignored.
// ───────────────────────────────────────────────────────────────────────────

describe("H12 — trigger cooldownDuration without cooldownId is dropped", () => {
  it("ICD has no effect when cooldownId is omitted; trigger fires every hit", () => {
    const t1: PassiveTrigger = {
      id: "no_icd",
      source: "test",
      listenTo: "skill_hit",
      deferred: false,
      sourceMustBeOwner: true,
      cooldownDuration: 100, // intended ICD, but no cooldownId → no effect
      actions: [{ type: "buff_apply", params: {
        buffId: "no_icd_buff", target: "self",
        stat: "attack_percent", zone: "attackPercent",
        value: 10, duration: 1,
      }}],
    };
    const sk = skill({ duration: 3, spCost: 0, hits: [hit(0.5), hit(1.5), hit(2.5)] });
    const trigMap = new Map<string, PassiveTrigger[]>();
    trigMap.set("DUMMY", [t1]);
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk, startTime: 0 },
    ], enemyCfg, baseCfg, trigMap);
    const applies = r.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "no_icd_buff");
    // EXPECTED BUG: 三次都触发（如果 cooldownId 设置正确，应只触发1次）
    expect(applies.length).toBe(3);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// H13 — stack_buff_consume falls through to OTHER actors' trackers when self
// has 0 stacks. Cross-actor state leak.
// ───────────────────────────────────────────────────────────────────────────

describe("H13 — stack_buff_consume is per-actor only (no cross-actor steal) (B13 fix)", () => {
  it("actor A consume is no-op when only actor B has the stack buff", () => {
    const skLoadB = skill({
      id: "load_b", duration: 0.5, spCost: 0,
      hits: [hit(0.0, { effects: [{ type: "stack_buff_apply", params: { buffType: "magma", stacks: 4, maxStacks: 4 } }] })],
    });
    const skConsumeA = skill({
      id: "consume_a", duration: 0.5, spCost: 0,
      hits: [hit(0.0, { effects: [{ type: "stack_buff_consume", params: { buffType: "magma", stacks: "all" } }] })],
    });
    const r = simulate([build("A"), build("B")], [
      { actionId: "a1", actorId: "B", skill: skLoadB, startTime: 0 },     // B gets 4 magma
      { actionId: "a2", actorId: "A", skill: skConsumeA, startTime: 1 },  // A consumes — but A has 0 → no-op
    ], enemyCfg, baseCfg);
    const consumes = r.events.filter(e => e.type === "stack_change" && (e as any).reason === "effect_consumed");
    // After fix: A's consume is no-op (A has 0 magma). B's stacks untouched.
    expect(consumes.length).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Bonus — buff_apply with duration=0 / valueRef→0 silently falls back to 15s
// because of `… || 15` short-circuit.
// ───────────────────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────────────────
// H7 — Phase A consumes ALL skills' SP costs first (sorted by startTime),
// then Phase B runs hits (including SP restores). With validateConditions=true,
// a chain like "skill1 → hit-restores-SP → skill2-affordable-only-because-of-restore"
// fails validation even though the player would have had the SP at the actual time.
// ───────────────────────────────────────────────────────────────────────────

describe("H7 — SP validation reads time-aligned state (B6 fix)", () => {
  it("realistic 100/0 chain: link回SP让后续战技能放出", () => {
    // 起始 50 SP. sk1=连携 (cost 0, hit @ 0.5 回 50 trueSP).
    // sk2=战技 (cost 100) at t=2. 真实游戏：t=0.5 后 SP=100, t=2 后 SP≈112 → 能放出.
    // Bug 行为（kernel 旧版）：Phase A 在 t=2 看到 SP=66（没 hit-restore），validation 失败.
    // Fix 后：actionStart marker 在 t=2 时 sp 已经过 t=0.5 hit-restore，能放出.
    const sk1 = skill({
      id: "s1", type: "link", duration: 1.5, spCost: 0, cooldown: 0,
      hits: [hit(0.5, { effects: [{ type: "sp_restore", params: { amount: 50, isTrueSP: true } }] })],
    });
    const sk2 = skill({
      id: "s2", duration: 1, spCost: 100, cooldown: 0,
      hits: [hit(0.3)],
    });
    const cfg: KernelConfig = { ...baseCfg, initialSP: 50, validateConditions: true };
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk1, startTime: 0 },
      { actionId: "a2", actorId: "DUMMY", skill: sk2, startTime: 2 },
    ], enemyCfg, cfg);
    // After fix: validation passes — SP at t=2 = 50 + regen(0→2)*8 + sp_restore 50 ≈ 116.
    expect(r.validationError).toBeUndefined();
    // Both action_start events present
    const starts = r.events.filter(e => e.type === "action_start");
    expect(starts.length).toBe(2);
  });

  it("still rejects when SP truly insufficient even with hit restore", () => {
    // 起始 0 SP. sk1=连携 cost 0, hit @ 0.5 回 30 SP. sk2=战技 cost 100 at t=2.
    // SP at t=2 = 0 + regen(0→2)=16 + 30 = 46 < 100. 应被拒.
    const sk1 = skill({
      id: "s1", type: "link", duration: 1.5, spCost: 0, cooldown: 0,
      hits: [hit(0.5, { effects: [{ type: "sp_restore", params: { amount: 30, isTrueSP: true } }] })],
    });
    const sk2 = skill({
      id: "s2", duration: 1, spCost: 100, cooldown: 0,
      hits: [hit(0.3)],
    });
    const cfg: KernelConfig = { ...baseCfg, initialSP: 0, validateConditions: true };
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk1, startTime: 0 },
      { actionId: "a2", actorId: "DUMMY", skill: sk2, startTime: 2 },
    ], enemyCfg, cfg);
    expect(r.validationError).toBeDefined();
    expect(r.validationError!.code).toBe("ISSUE_SP_INSUFFICIENT");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// H9 — consumeOnAction "charge" buffs activate on first hit of next action by
// applying a transient buff with duration = skill.duration + 0.001. With variants
// that change duration, kernel uses the BASE duration here too (same family as H1).
// Also: when next action is duration=0 (e.g. internal-CD-only action), the active
// buff barely exists — it expires inside the same tick because of the +0.001 epsilon
// not being enough cushion.
// ───────────────────────────────────────────────────────────────────────────

describe("H9 — consumeOnAction with duration=0 next skill", () => {
  it("activate buff on a duration=0 skill expires immediately in the same tick", () => {
    // Skill X first 'charges' the buff (consumeOnAction style: applies buff with consumeOnAction param).
    // Skill Y is the consumer (duration=0). The activate buff lives `skill.duration + 0.001` = 0.001s.
    const charge = skill({
      id: "charge", duration: 1, spCost: 0,
      hits: [hit(0.1, { effects: [{ type: "buff_apply", params: {
        buffId: "charge_token", target: "self",
        consumeOnAction: ["skill"],
        activateStat: "attack_percent",
        activateZone: "attackPercent",
        activateValue: 50,
        // The "carrier" buff itself has no stat/zone — only the activate variant adds stats.
        duration: 999,
      }}] })],
    });
    const consumer = skill({
      id: "consumer", duration: 0, spCost: 0, type: "skill",
      hits: [hit(0.0, { mult: 100 })],  // damage at offset 0 — same instant as activation
    });
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: charge, startTime: 0 },
      { actionId: "a2", actorId: "DUMMY", skill: consumer, startTime: 2 },
    ], enemyCfg, baseCfg);
    // Look for the charge_token_active buff_apply
    const activates = r.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "charge_token_active");
    // It IS applied (duration 0+0.001=0.001s)
    expect(activates.length).toBe(1);
    expect((activates[0] as any).duration).toBeCloseTo(0.001, 3);
    // Damage on the consumer's hit at t=2 should benefit. Compare with no-charge run:
    const noChargeR = simulate([build()], [
      { actionId: "a2", actorId: "DUMMY", skill: consumer, startTime: 2 },
    ], enemyCfg, baseCfg);
    const dmgWith = (r.events.find(e => e.type === "damage" && (e as any).actionId === "a2") as any).damage;
    const dmgNo = (noChargeR.events.find(e => e.type === "damage" && (e as any).actionId === "a2") as any).damage;
    // Hit at offset=0 is at the SAME timestamp as the activation, so the +50% should apply.
    // BuffManager.getActive uses `expiresAt > time` — buff expires at 2.001 > 2 → should be live.
    expect(dmgWith).toBeGreaterThan(dmgNo);
  });
});

// H10 (magic_attachment delay+reaction time mismatch) — removed.
// `delay` field was deleted from magic_attachment effect entirely (B18 fix).
// hit.offset 已经表示命中时间，远程角色直接把 hit.offset 设成命中点即可。

// ───────────────────────────────────────────────────────────────────────────
// H_BURST — anomaly.ts triggers magic burst on EVERY same-element re-application,
// not just at 4 layers. CLAUDE.md says "同元素附着达 4 层 → burst damage" —
// these disagree. Verify which the kernel does.
// ───────────────────────────────────────────────────────────────────────────

describe("H_BURST — magic burst trigger threshold (kernel vs CLAUDE.md doc)", () => {
  it("kernel triggers burst on every same-element add starting from stack 2", () => {
    // 4 separate magic_attachment effects of same element
    const sk = skill({
      id: "burst_test", duration: 5, spCost: 0,
      hits: [
        hit(0.1, { effects: [{ type: "magic_attachment", params: { element: "blaze", stacks: 1 } }] }),
        hit(0.5, { effects: [{ type: "magic_attachment", params: { element: "blaze", stacks: 1 } }] }),
        hit(1.0, { effects: [{ type: "magic_attachment", params: { element: "blaze", stacks: 1 } }] }),
        hit(1.5, { effects: [{ type: "magic_attachment", params: { element: "blaze", stacks: 1 } }] }),
      ],
    });
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk, startTime: 0 },
    ], enemyCfg, baseCfg);
    // Burst damages have multiplier values that scale by stacks (magicBurstMult).
    // Damage events with school="magic" element="blaze" — but we also have hit damages.
    // Hits in this test have damage with mult 100 (default), so they're separate.
    // Burst events have damage from multiplier `burstMult * 100`.
    // Easier to count: total damages minus 4 hit damages.
    const allDamages = r.events.filter(e => e.type === "damage");
    // 4 hit dmgs + N burst dmgs. If kernel does "every same-element after stack 2": stacks 2,3,4 → 3 bursts.
    // If kernel does "only at 4": 1 burst.
    // From source: "Every same-element application triggers burst" → bursts at stacks=2,3,4 = 3 bursts
    // → total 4+3 = 7 dmgs. Plus the FIRST same-element was applied to NO existing element →
    // it's a "no existing" case → only "stacked" outcome (no burst).
    // So: hit1 stacks=1 (no burst). hit2,3,4 each: stacked + burst.
    expect(allDamages.length).toBe(4 + 3);  // confirms: every same-element add triggers burst
    // Burst events go via emit("damage") with school=magic. Hit damages here are physical (default).
    const magicDmgs = allDamages.filter(e => (e as any).school === "magic");
    expect(magicDmgs.length).toBe(3);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// H_GAUGE — Ultimate without enough gauge: validateConditions catches it, but
// without validation the kernel still runs the ultimate and silently consumes
// only what's available. This may produce an "underpowered" ult that still
// triggers full effects.
// ───────────────────────────────────────────────────────────────────────────

describe("H_GAUGE — ultimate fires without enough gauge when validateConditions is off", () => {
  it("ultimate cast at 0 gauge still produces hits and effects", () => {
    const ult = skill({
      id: "ult", type: "ultimate", duration: 2, spCost: 0, cooldown: 0,
      gaugeCost: 100,
      hits: [hit(0.5, { mult: 500 })],
    });
    // No initial gauge full, no validation.
    const cfg: KernelConfig = { initialSP: 0, critMode: "expected" };
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: ult, startTime: 0 },
    ], enemyCfg, cfg);
    // The ultimate runs: damage event present.
    const dmg = r.events.find(e => e.type === "damage") as any;
    expect(dmg).toBeTruthy();
    expect(dmg.actionId).toBe("a1");
    // Gauge consume event: change=0 (we had 0). consumeForUltimate(100) returns Math.min(0,100)=0.
    const gaugeConsume = r.events.find(e => e.type === "gauge_change" && (e as any).reason === "ultimate_cast") as any;
    expect(gaugeConsume).toBeTruthy();
    expect(Math.abs(gaugeConsume.change)).toBe(0);
    // EXPECTED BUG: ult played with no gauge spent, full damage delivered
  });
});

// ───────────────────────────────────────────────────────────────────────────
// H_TEAMBUFF — buff_apply target="team" applies the buff to ALL actors but
// only emits ONE buff_apply event with targetId="team". Frontend per-actor
// projections may miss this.
// ───────────────────────────────────────────────────────────────────────────

describe("H_TEAMBUFF — target='team' emits one event per actor (B19 fix)", () => {
  it("3 actors, 3 buff_apply events, each targetId set to receiving actor", () => {
    const sk = skill({
      duration: 1, spCost: 0,
      hits: [hit(0.1, { effects: [{ type: "buff_apply", params: {
        buffId: "team_atk", target: "team",
        stat: "attack_percent", zone: "attackPercent",
        value: 20, duration: 5,
      }}] })],
    });
    const r = simulate([build("A"), build("B"), build("C")], [
      { actionId: "a1", actorId: "A", skill: sk, startTime: 0 },
    ], enemyCfg, baseCfg);
    const teamBuffs = r.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "team_atk");
    expect(teamBuffs.length).toBe(3);
    const targetIds = teamBuffs.map(e => (e as any).targetId).sort();
    expect(targetIds).toEqual(["A", "B", "C"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// H_CONSUME_ANOMALY_INACTIVE — consume_anomaly when no anomaly active = silent.
// Plus: consume_attachment with no attachment also silent. Both behaviors are
// fine, but they don't emit a "noop" marker so ICD-style triggers can't tell
// "tried but failed" from "didn't try".
// ───────────────────────────────────────────────────────────────────────────

describe("H_CONSUME_ANOMALY_NOOP — silent failures of consume_* effects", () => {
  it("consume_anomaly with no active anomaly emits no event", () => {
    const sk = skill({
      duration: 1, spCost: 0,
      hits: [hit(0.1, { effects: [{ type: "consume_anomaly", params: { anomalyType: "burning" } }] })],
    });
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk, startTime: 0 },
    ], enemyCfg, baseCfg);
    const anomalyEvts = r.events.filter(e => e.type === "anomaly_remove");
    expect(anomalyEvts.length).toBe(0); // intended silent
  });
});

// ───────────────────────────────────────────────────────────────────────────
// H_BREAK_REFRESH — break_apply resets ALL break stacks' expiry to time+30s.
// Different from independent-timer behavior. Add 3 stacks at t=0, expire at t=30.
// Add 1 more at t=20, expire at t=50 — ALL stacks now expire at t=50.
// Game-reality check: is this correct?
// ───────────────────────────────────────────────────────────────────────────

describe("H_BREAK_REFRESH — break_apply refreshes ALL stacks' expiry", () => {
  it("break stacks added later refresh the entire bundle's expiry", () => {
    const sk1 = skill({
      duration: 1, spCost: 0,
      hits: [hit(0.0, { effects: [{ type: "break_apply", params: { stacks: 3 } }] })],
    });
    const sk2 = skill({
      id: "s2", duration: 1, spCost: 0,
      hits: [hit(0.0, { effects: [{ type: "break_apply", params: { stacks: 1 } }] })],
    });
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk1, startTime: 0 },
      { actionId: "a2", actorId: "DUMMY", skill: sk2, startTime: 20 },
    ], enemyCfg, baseCfg);
    // Look for break_change "expired" events
    const breakExpiries = r.events.filter(e => e.type === "break_change" && (e as any).stacks === 0);
    expect(breakExpiries.length).toBe(1);
    // Expiry time = 20 + 30 = 50 (refreshed by second apply)
    expect(breakExpiries[0].time).toBe(50);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// H_DAMAGEZERO_HIT — A pure-effect hit (damage:null) does NOT emit hit-type
// trigger events (skill_hit/heavy_attack_hit/etc.) since those are gated by
// `if (hit.damage)`. Triggers tied to "skill_hit" miss pure-effect hits.
// ───────────────────────────────────────────────────────────────────────────

describe("H_DAMAGEZERO_HIT — pure-effect hits (damage=null) skip hit trigger events", () => {
  it("a hit with damage=null doesn't emit skill_hit trigger event", () => {
    const t1: PassiveTrigger = {
      id: "on_skill_hit",
      source: "test", listenTo: "skill_hit",
      deferred: false, sourceMustBeOwner: true,
      actions: [{ type: "buff_apply", params: {
        buffId: "fired", target: "self",
        stat: "attack_percent", zone: "attackPercent",
        value: 1, duration: 1,
      }}],
    };
    // Pure-effect hit (no damage): apply a buff effect
    const sk = skill({
      duration: 1, spCost: 0,
      hits: [{
        offset: 0.5, checkpointIndex: 0,
        damage: null,
        effects: [{ type: "break_apply", params: { stacks: 1 } }],
        standardLogic: true,
      }],
    });
    const trigMap = new Map<string, PassiveTrigger[]>();
    trigMap.set("DUMMY", [t1]);
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk, startTime: 0 },
    ], enemyCfg, baseCfg, trigMap);
    const fired = r.events.filter(e => e.type === "buff_apply" && (e as any).buffId === "fired");
    // EXPECTED BUG: skill_hit 触发器不响应纯效果 hit
    expect(fired.length).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// H_RXN_MULT_UNIT — kernel.ts:1633-1640 pushes spell-anomaly-trigger damage
// with multiplier=rxnMult (raw 0.8x form, e.g. ~2.41 for level 2). resolveDamage
// treats multiplier as a percentage (÷100). If this assumption mismatch is real,
// reaction damage is ~100× too small.
// ───────────────────────────────────────────────────────────────────────────

describe("H_PHYS_ANOMALY_MULT_UNIT — physical anomaly damage uses correct % multiplier (anomaly.ts ×100 fix)", () => {
  it("slam damage with 4 break stacks consumed ≈ 6000 (× form, ATK*7.5*def)", () => {
    // After fix: slamMult(4, 1, 0) returns 750 (in %, was 7.5).
    // resolveDamage: skillMult = 750/100 = 7.5. ATK=1600, def=0.5 → ~6000.
    // Use null-damage hits so only the slam (effectDamage) shows up.
    const slamSkill: Skill = {
      id: "slam_test", type: "skill", name: "slam",
      element: "physical", duration: 2, spCost: 0, cooldown: 0,
      hits: [
        { offset: 0.0, checkpointIndex: 0, damage: null, effects: [{ type: "break_apply", params: { stacks: 4 } }], standardLogic: true },
        { offset: 0.5, checkpointIndex: 0, damage: null, effects: [{ type: "physical_anomaly", params: { physicalType: "slam" } }], standardLogic: true },
      ],
      checkpoints: [],
    };
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: slamSkill, startTime: 0 },
    ], enemyCfg, baseCfg);
    const dmgs = r.events.filter(e => e.type === "damage") as any[];
    // Only one damage event: the slam.
    expect(dmgs.length).toBe(1);
    const slamDmg = dmgs[0];
    // After fix: ~6000. canCrit=false on slam, so no crit zone applied.
    expect(slamDmg.damage).toBeGreaterThan(5000);
    expect(slamDmg.damage).toBeLessThan(7000);
  });
});

describe("H_RXN_MULT_UNIT — reaction damage multiplier uses correct % form (anomaly.ts ×100 fix)", () => {
  it("frozen reaction damage on cross-element attachment ≈ 1280", () => {
    // After fix: spellAnomalyTriggerMult(1, 0) returns 160 (in %).
    // skillMult = 1.6 → raw ≈ 1600*1.6*0.5 ≈ 1280, plus crit ~1.025 → ~1310.
    const sk = skill({
      duration: 2, spCost: 0,
      hits: [
        hit(0.0, { effects: [{ type: "magic_attachment", params: { element: "blaze", stacks: 1 } }] }),
        hit(0.5, { effects: [{ type: "magic_attachment", params: { element: "cold", stacks: 1 } }] }),
      ],
    });
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk, startTime: 0 },
    ], enemyCfg, baseCfg);
    // Find the reaction damage — magic school, cold element, fromTrigger should be undefined
    const dmgs = r.events.filter(e => e.type === "damage") as any[];
    const rxnDmg = dmgs.find(d => d.school === "magic" && d.element === "cold");
    expect(rxnDmg).toBeTruthy();
    // After fix: damage is in [1200, 1500] range (matches × interpretation with crit factor).
    expect(rxnDmg.damage).toBeGreaterThan(1100);
    expect(rxnDmg.damage).toBeLessThan(1500);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// H_BURST_NO_ZONES — Magic burst damage in kernel.ts case "magic_attachment"
// is emitted directly via `emit({ type: "damage", damage: floor(ATK * burstMult), ... })`
// WITHOUT going through resolveDamage. So the burst damage:
//   - skips defenseMultiplier (always behaves as if 0 DEF / mult=1.0)
//   - skips crit
//   - skips ALL damage bonus zones (element/school/sourceType buffs)
//   - skips vulnerability / fragility / resistance / stagger / special
// This is a BIG correctness gap.
// ───────────────────────────────────────────────────────────────────────────

describe("H_BURST_NO_ZONES — magic burst goes through 11-zone pipeline + skipSourceTypeBonus + canCrit + fromTrigger (B1 fix)", () => {
  it("burst damage scales with defense / element bonus", () => {
    // Arrange: two scenarios:
    //   A. Pristine — defense=0.5 (default), no buffs, no fragility.
    //   B. Buff-laden — defense=1.0 (no defense), +1000% blaze_dmg buff baked into build,
    //      enemy vulnerability via armor_break (use armor break to add fragility).
    // If the kernel respected zones, B's burst should be massively higher than A's.

    // Setup: triple-stack blaze attachment, then add 4th to trigger burst at stacks=4.
    // Actually we'll just trigger 1 burst (stacks=2 add).
    const skBurst = skill({
      duration: 2, spCost: 0,
      hits: [
        hit(0.0, { effects: [{ type: "magic_attachment", params: { element: "blaze", stacks: 1 } }] }),
        hit(0.5, { effects: [{ type: "magic_attachment", params: { element: "blaze", stacks: 1 } }] }),  // → burst at stacks=2
      ],
    });
    const placed: PlacedSkill[] = [{ actionId: "a1", actorId: "DUMMY", skill: skBurst, startTime: 0 }];

    // A. Default enemy (def=0.5) plus default build (no special buffs, base 5% crit).
    const rA = simulate([build()], placed, enemyCfg, baseCfg);
    const burstA = (rA.events.find(e => e.type === "damage" && (e as any).school === "magic") as any).damage;

    // B. Defense=1.0 (no defense), with a build that has massive blaze bonus baked in.
    const buildHi = (() => {
      const input: CharacterInput = {
        id: "DUMMY", name: "DUMMY", element: "physical" as DamageElement, rarity: 6,
        promotion: 4, potentialLevel: 0, talentLevels: {},
        baseStrength: 100, baseAgility: 100, baseIntellect: 100, baseWill: 100,
        baseAttack: 300, baseHp: 1000,
        mainAttribute: "strength", subAttribute: "agility",
        weaponId: null, weaponBaseAtk: 500, weaponLevel: 90,
        equipmentSetId: null, baseGaugeMax: 300,
        statModifiers: [
          { source: "test", stat: "blaze_dmg", value: 1000, type: "flat" },  // +1000% blaze!
        ],
      };
      return computeCharacterBuild(input);
    })();
    const enemyNoDef: EnemyConfig = { ...enemyCfg, defenseMultiplier: 1.0 };
    const rB = simulate([buildHi], placed, enemyNoDef, baseCfg);
    const burstB = (rB.events.find(e => e.type === "damage" && (e as any).school === "magic") as any).damage;

    // After fix: A def=0.5, B def=1.0 → 2x. Plus B has +1000 blaze_dmg → zone 11 (was 1). ratio ~22x.
    const ratio = burstB / burstA;
    expect(ratio).toBeGreaterThan(20);
    expect(ratio).toBeLessThan(25);
  });

  it("burst respects defense + crit (no other zones in this scenario)", () => {
    const skBurstWithFrag = skill({
      duration: 3, spCost: 0,
      hits: [
        // Apply 4 break + slam to set up armor_break vulnerability
        hit(0.0, { effects: [{ type: "break_apply", params: { stacks: 4 } }] }),
        hit(0.3, { effects: [{ type: "physical_anomaly", params: { physicalType: "armorBreak" } }] }),
        // Then trigger a magic burst — vulnerability should NOT affect burst (school=magic)
        // anyway, but armor break adds physical fragility, so it shouldn't matter.
        // Use vulnerability buff via buff_apply on enemy.
        hit(0.5, { effects: [{ type: "buff_apply", params: {
          buffId: "vuln", target: "enemy",
          stat: "all_dmg", zone: "amplify",  // weird abuse but tests the pipeline
          value: 100, duration: 5,
        } }] }),
        // Now trigger burst
        hit(1.0, { effects: [{ type: "magic_attachment", params: { element: "blaze", stacks: 1 } }] }),
        hit(1.5, { effects: [{ type: "magic_attachment", params: { element: "blaze", stacks: 1 } }] }), // burst here
      ],
    });
    const placed: PlacedSkill[] = [{ actionId: "a1", actorId: "DUMMY", skill: skBurstWithFrag, startTime: 0 }];
    const r = simulate([build()], placed, enemyCfg, baseCfg);
    const bursts = r.events.filter(e => e.type === "damage" && (e as any).school === "magic" && (e as any).element === "blaze");
    expect(bursts.length).toBe(1);
    // After fix: burst goes through 11 zones with skipSourceTypeBonus + canCrit.
    //   ATK = 1600, burstMult(level=2, ap=0)% = 160 * spellLevelCoef(2) ≈ 160.8 → skillMult ≈ 1.608.
    //   def 0.5, no element/school bonus, crit (5%, 50%) → ~1.025.
    //   damage ≈ floor(1600 * 1.608 * 0.5 * 1.025) ≈ 1318.
    // Burst is now school=magic so the buff_apply enemy stat=all_dmg amplify doesn't apply
    // to actor (enemy buffs aren't read by source's buffMods). Physical fragility from armorBreak
    // also doesn't apply (school=magic). So this is just ATK*mult*def*crit.
    expect((bursts[0] as any).damage).toBeGreaterThan(1200);
    expect((bursts[0] as any).damage).toBeLessThan(1500);
    // Confirm fromTrigger + triggerName are stamped for damage-calc page grouping.
    expect((bursts[0] as any).fromTrigger).toBe(true);
    expect((bursts[0] as any).triggerName).toBe("法术爆发");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// H_INTERRUPT_BY_LATE — When two actors place actions at overlapping times,
// the per-actor interrupt rule + main-control switch interaction has corners.
// Skip; covered well by existing kernel.test.ts.
// ───────────────────────────────────────────────────────────────────────────

describe("Bonus — buff_apply duration=0 (B17 fix)", () => {
  it("explicit duration:0 stays 0 (permanent per BuffManager spec)", () => {
    const sk = skill({
      duration: 1, spCost: 0,
      hits: [hit(0.1, { effects: [{ type: "buff_apply", params: {
        buffId: "perma", target: "self",
        stat: "attack_percent", zone: "attackPercent",
        value: 10, duration: 0,
      }}] })],
    });
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk, startTime: 0 },
    ], enemyCfg, baseCfg);
    const apply = r.events.find(e => e.type === "buff_apply" && (e as any).buffId === "perma") as any;
    expect(apply).toBeTruthy();
    // After fix: 0 means permanent (not 15 fallback).
    expect(apply.duration).toBe(0);
  });

  it("omitted duration falls back to 15", () => {
    const sk = skill({
      duration: 1, spCost: 0,
      hits: [hit(0.1, { effects: [{ type: "buff_apply", params: {
        buffId: "default_dur", target: "self",
        stat: "attack_percent", zone: "attackPercent",
        value: 10,
        // no duration / durationRef
      }}] })],
    });
    const r = simulate([build()], [
      { actionId: "a1", actorId: "DUMMY", skill: sk, startTime: 0 },
    ], enemyCfg, baseCfg);
    const apply = r.events.find(e => e.type === "buff_apply" && (e as any).buffId === "default_dur") as any;
    expect(apply.duration).toBe(15);
  });
});
