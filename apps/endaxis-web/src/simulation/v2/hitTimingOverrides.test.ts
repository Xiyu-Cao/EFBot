/**
 * hitTimingOverrides — unit tests (开发中, feature/hit-timing-override 分支)
 */

import { beforeEach, describe, expect, test } from "vitest";
import type { Skill } from "./types";
import {
  applyOverrideToSkill,
  applyOverridesToModule,
  clearAllOverrides,
  exportOverridesJSON,
  getAllOverrides,
  getSkillTimingWarnings,
  importOverridesJSON,
  isValidTimingValue,
  setHitOffsetOverride,
  setSkillDetachOverride,
  setSkillDurationOverride,
} from "./hitTimingOverrides";

const f = (n: number) => n / 60;

const makeSkill = (id: string, hits: number[], duration: number, detach?: number): Skill => ({
  id,
  type: "attack",
  name: id,
  element: "physical",
  duration,
  spCost: 0,
  cooldown: 0,
  hits: hits.map((offset, i) => ({
    offset,
    checkpointIndex: 0,
    damage: { multiplier: 1, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" },
    effects: [],
    standardLogic: true,
  })),
  checkpoints: [],
  ...(detach !== undefined ? { detach } : {}),
});

beforeEach(() => {
  // Clean slate per test (storage is shared via module singleton).
  if (typeof localStorage !== "undefined") localStorage.clear();
  clearAllOverrides();
});

describe("applyOverrideToSkill", () => {
  test("returns same skill when no override given", () => {
    const sk = makeSkill("s1", [f(10), f(20)], f(30));
    expect(applyOverrideToSkill(sk, null)).toBe(sk);
    expect(applyOverrideToSkill(sk, undefined)).toBe(sk);
  });

  test("applies hit offset override per index", () => {
    const sk = makeSkill("s1", [f(10), f(20)], f(30));
    const out = applyOverrideToSkill(sk, { hitOffsets: { 0: f(12) } });
    expect(out).not.toBe(sk);
    expect(out.hits[0].offset).toBe(f(12));
    expect(out.hits[1].offset).toBe(f(20));
    // Original is untouched
    expect(sk.hits[0].offset).toBe(f(10));
  });

  test("applies duration and detach overrides", () => {
    const sk = makeSkill("s1", [f(10)], f(30), f(25));
    const out = applyOverrideToSkill(sk, { duration: f(33), detach: f(28) });
    expect(out.duration).toBe(f(33));
    expect(out.detach).toBe(f(28));
    expect(sk.duration).toBe(f(30));
  });

  test("non-overridden hits keep their original reference", () => {
    const sk = makeSkill("s1", [f(10), f(20)], f(30));
    const out = applyOverrideToSkill(sk, { hitOffsets: { 1: f(22) } });
    expect(out.hits[0]).toBe(sk.hits[0]);
    expect(out.hits[1]).not.toBe(sk.hits[1]);
  });
});

describe("applyOverridesToModule", () => {
  test("rewrites skills.attack[i] / skill / link / ultimate", () => {
    const mod = {
      identity: { id: "TEST" },
      skills: {
        attack: [makeSkill("a1", [f(10)], f(20)), makeSkill("a2", [f(15)], f(25))],
        skill: makeSkill("sk1", [f(30)], f(60)),
        link: makeSkill("lk1", [f(40)], f(50)),
        ultimate: makeSkill("ult1", [f(70)], f(120)),
      },
      triggers: [],
    };

    const overridden = applyOverridesToModule(mod, {
      a1: { hitOffsets: { 0: f(11) } },
      sk1: { duration: f(70) },
      ult1: { hitOffsets: { 0: f(72) }, duration: f(125) },
    });

    expect(overridden).not.toBe(mod);
    expect(overridden.skills.attack[0].hits[0].offset).toBe(f(11));
    expect(overridden.skills.attack[1].hits[0].offset).toBe(f(15));
    expect(overridden.skills.skill.duration).toBe(f(70));
    expect(overridden.skills.link.hits[0].offset).toBe(f(40));
    expect(overridden.skills.ultimate.hits[0].offset).toBe(f(72));
    expect(overridden.skills.ultimate.duration).toBe(f(125));

    // Original module untouched.
    expect(mod.skills.attack[0].hits[0].offset).toBe(f(10));
    expect(mod.skills.skill.duration).toBe(f(60));
  });

  test("handles array link variants", () => {
    const mod = {
      skills: {
        link: [makeSkill("lk0", [f(10)], f(20)), makeSkill("lk1", [f(15)], f(20))],
      },
      triggers: [],
    };
    const out = applyOverridesToModule(mod, { lk1: { hitOffsets: { 0: f(17) } } });
    expect(out.skills.link[0].hits[0].offset).toBe(f(10));
    expect(out.skills.link[1].hits[0].offset).toBe(f(17));
  });

  test("returns same module reference when no overrides", () => {
    const mod = { skills: { skill: makeSkill("s", [f(1)], f(2)) }, triggers: [] };
    expect(applyOverridesToModule(mod, null)).toBe(mod);
    expect(applyOverridesToModule(mod, {})).toBe(mod);
  });
});

describe("setters + storage", () => {
  test("setHitOffsetOverride writes and reads back", () => {
    expect(setHitOffsetOverride("CHAR", "skA", 0, f(15))).toBe(null);
    const all = getAllOverrides();
    expect(all.CHAR.skA.hitOffsets?.[0]).toBe(f(15));
  });

  test("setting null clears the entry", () => {
    setHitOffsetOverride("CHAR", "skA", 0, f(15));
    setHitOffsetOverride("CHAR", "skA", 0, null);
    const all = getAllOverrides();
    // Whole branch removed since it's empty now.
    expect(all.CHAR).toBeUndefined();
  });

  test("multiple setters coexist", () => {
    setHitOffsetOverride("CHAR", "skA", 0, f(15));
    setSkillDurationOverride("CHAR", "skA", f(40));
    setSkillDetachOverride("CHAR", "skA", f(35));
    const all = getAllOverrides();
    expect(all.CHAR.skA).toEqual({
      hitOffsets: { 0: f(15) },
      duration: f(40),
      detach: f(35),
    });
  });
});

describe("input validation (hard reject)", () => {
  test("isValidTimingValue rejects non-numeric / NaN / Infinity / negative", () => {
    expect(isValidTimingValue(0)).toBe(true);
    expect(isValidTimingValue(0.5)).toBe(true);
    expect(isValidTimingValue(NaN)).toBe(false);
    expect(isValidTimingValue(Infinity)).toBe(false);
    expect(isValidTimingValue(-Infinity)).toBe(false);
    expect(isValidTimingValue(-0.1)).toBe(false);
    expect(isValidTimingValue("0.5" as any)).toBe(false);
    expect(isValidTimingValue(null as any)).toBe(false);
    expect(isValidTimingValue(undefined as any)).toBe(false);
  });

  test("setters return error message and skip write on invalid input", () => {
    expect(setHitOffsetOverride("CHAR", "skA", 0, NaN)).toMatch(/NaN/);
    expect(setHitOffsetOverride("CHAR", "skA", 0, Infinity)).toMatch(/Infinity/);
    expect(setHitOffsetOverride("CHAR", "skA", 0, -1)).toMatch(/不能为负/);
    expect(setHitOffsetOverride("CHAR", "skA", 0, 9999)).toMatch(/不合理/);
    expect(setHitOffsetOverride("CHAR", "skA", -1, 0.5)).toMatch(/hitIndex/);
    expect(setSkillDurationOverride("CHAR", "skA", -1)).toMatch(/不能为负/);
    expect(setSkillDetachOverride("CHAR", "skA", NaN)).toMatch(/NaN/);
    // None of the above should have written anything.
    expect(getAllOverrides()).toEqual({});
  });

  test("import rejects Infinity and out-of-range values", () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      overrides: {
        X: {
          sX: {
            duration: 9999,
            detach: 1e308,
            hitOffsets: { "0": 0.5, "1": -0.1 },
          },
        },
      },
    });
    const result = importOverridesJSON(json);
    expect(result.ok).toBe(true);
    expect(result.errors.some(e => /duration 非法/.test(e))).toBe(true);
    expect(result.errors.some(e => /detach 非法/.test(e))).toBe(true);
    expect(result.errors.some(e => /hitOffsets\[1\]/.test(e))).toBe(true);
    // Only the legit hit[0] survives.
    expect(getAllOverrides().X.sX).toEqual({ hitOffsets: { 0: 0.5 } });
  });
});

describe("semantic warnings (soft)", () => {
  // Clean baseline: detach lines up with the last hit, all offsets inside duration, in order.
  const baseSkill = (): Skill => makeSkill("s1", [f(10), f(20), f(30)], f(60), f(30));

  test("clean override has no warnings", () => {
    const sk = baseSkill();
    expect(getSkillTimingWarnings(sk, null)).toEqual([]);
    expect(getSkillTimingWarnings(sk, { hitOffsets: { 0: f(12) } })).toEqual([]);
  });

  test("offset > duration warns", () => {
    const sk = baseSkill();
    const warnings = getSkillTimingWarnings(sk, { hitOffsets: { 2: f(80) } });
    expect(warnings.some(w => /Hit #2 offset.*> duration/.test(w))).toBe(true);
  });

  test("out-of-order hits warn", () => {
    const sk = baseSkill();
    const warnings = getSkillTimingWarnings(sk, { hitOffsets: { 1: f(5) } });
    expect(warnings.some(w => /早于 Hit #0/.test(w))).toBe(true);
  });

  test("detach > duration warns", () => {
    const sk = baseSkill();
    const warnings = getSkillTimingWarnings(sk, { detach: f(70) });
    expect(warnings.some(w => /detach.*> duration/.test(w))).toBe(true);
  });

  test("detach beyond last hit warns", () => {
    const sk = baseSkill();
    // Push detach beyond the last hit (f(30)) but within duration (f(60))
    const warnings = getSkillTimingWarnings(sk, { detach: f(45) });
    expect(warnings.some(w => /没有 hit 受保护/.test(w))).toBe(true);
  });
});

describe("JSON round-trip", () => {
  test("export → import preserves overrides", () => {
    setHitOffsetOverride("CHAR_A", "skA", 0, f(15));
    setHitOffsetOverride("CHAR_A", "skA", 1, f(20));
    setSkillDurationOverride("CHAR_A", "skA", f(40));
    setSkillDetachOverride("CHAR_B", "skB", f(50));

    const json = exportOverridesJSON();
    clearAllOverrides();
    expect(getAllOverrides()).toEqual({});

    const result = importOverridesJSON(json);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(getAllOverrides()).toEqual({
      CHAR_A: { skA: { hitOffsets: { 0: f(15), 1: f(20) }, duration: f(40) } },
      CHAR_B: { skB: { detach: f(50) } },
    });
  });

  test("rejects malformed JSON", () => {
    const result = importOverridesJSON("{ not valid");
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/JSON 解析失败/);
  });

  test("warns on unknown schemaVersion but still imports", () => {
    const json = JSON.stringify({
      schemaVersion: 99,
      exportedAt: "2026-01-01",
      overrides: { X: { sX: { duration: 1 } } },
    });
    const result = importOverridesJSON(json);
    expect(result.ok).toBe(true);
    expect(result.errors.some(e => /schemaVersion/i.test(e))).toBe(true);
    expect(getAllOverrides().X.sX.duration).toBe(1);
  });

  test("ignores invalid fields with warnings", () => {
    const json = JSON.stringify({
      schemaVersion: 1,
      overrides: {
        X: {
          sX: {
            duration: "bad",
            detach: -1,
            hitOffsets: { "0": 1.5, "bad": 2, "1": -3 },
          },
        },
      },
    });
    const result = importOverridesJSON(json);
    expect(result.ok).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(getAllOverrides().X.sX).toEqual({ hitOffsets: { 0: 1.5 } });
  });
});
