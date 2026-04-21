/**
 * CD resolution for V2 characters — verifies Panel-level cooldown resolution
 * without mutating the character module.
 *
 * The module (`mod.skills`) must stay untouched after panel build, so multiple
 * runs / hot-reload / concurrent character sims don't pollute each other.
 */
import { describe, it, expect } from "vitest";
import { loadV2Module } from "./characters/adapter";
import { resolveSkillsForPanel } from "./panel";

const BASE_SKILL_LEVELS = {
  skill: { rank: 9, mastery: 3 },
  link: { rank: 9, mastery: 3 },
  ultimate: { rank: 9, mastery: 3 },
};

describe("Ultimate CD — sourced from ultimateCooldowns.json via Panel", () => {
  const cases: [string, number][] = [
    ["ARCLIGHT", 15],
    ["ENDMINISTRATOR", 10],
    ["LASTRITE", 20],
    ["LIFENG", 15],
    ["POGRANICHNK", 10],
  ];
  for (const [charId, expected] of cases) {
    it(`${charId} resolvedSkills.ultimate.cooldown = ${expected}s`, async () => {
      const mod = await loadV2Module(charId);
      const resolved = resolveSkillsForPanel(mod, BASE_SKILL_LEVELS, 0);
      expect(resolved.ultimate!.cooldown).toBe(expected);
    });
  }
});

describe("mod.skills stays unmutated across Panel builds", () => {
  it("POGRANICHNK: mod.skills.ultimate.cooldown remains the module's raw value after resolve", async () => {
    const mod = await loadV2Module("POGRANICHNK");
    const rawUltCdBefore = (Array.isArray(mod.skills.ultimate) ? mod.skills.ultimate[0] : mod.skills.ultimate).cooldown;
    // Resolve for a P5 actor with link M3 — should NOT mutate mod.skills
    resolveSkillsForPanel(mod, BASE_SKILL_LEVELS, 5);
    const rawUltCdAfter = (Array.isArray(mod.skills.ultimate) ? mod.skills.ultimate[0] : mod.skills.ultimate).cooldown;
    expect(rawUltCdAfter).toBe(rawUltCdBefore);
  });

  it("POGRANICHNK: mod.skills.link[].cooldown stays 0 (module default), even after panel resolves to real CD", async () => {
    const mod = await loadV2Module("POGRANICHNK");
    const beforeLinkCds = Array.isArray(mod.skills.link)
      ? mod.skills.link.map((s: any) => s.cooldown)
      : [mod.skills.link.cooldown];
    const resolved = resolveSkillsForPanel(mod, BASE_SKILL_LEVELS, 5);
    const afterLinkCds = Array.isArray(mod.skills.link)
      ? mod.skills.link.map((s: any) => s.cooldown)
      : [mod.skills.link.cooldown];
    expect(afterLinkCds).toEqual(beforeLinkCds); // module untouched
    // The resolved panel, on the other hand, carries the level-resolved CD (with P5's -2s applied).
    const resolvedLinkCd = Array.isArray(resolved.link) ? resolved.link[0].cooldown : resolved.link!.cooldown;
    expect(typeof resolvedLinkCd).toBe("number");
  });
});

describe("POGRANICHNK P5 link CD composition: skillData level-value minus potential flat", () => {
  it("resolvedSkills.link[].cooldown = skillData 冷却时间 at M3 − 2s (P5 effect)", async () => {
    const mod = await loadV2Module("POGRANICHNK");

    // Read the base level-value directly from skillData so the test doesn't hard-code a number.
    const row = mod.skillData?.link?.levelData?.find?.((r: any) => r?.label === "冷却时间");
    const baseAtM3 = parseFloat(String(row?.values?.[11] ?? "0").replace("s", ""));
    // Sanity: require the test corpus actually has a non-zero link CD to exercise.
    expect(baseAtM3).toBeGreaterThan(0);

    const resolvedP0 = resolveSkillsForPanel(mod, BASE_SKILL_LEVELS, 0);
    const resolvedP5 = resolveSkillsForPanel(mod, BASE_SKILL_LEVELS, 5);

    const cdP0 = Array.isArray(resolvedP0.link) ? resolvedP0.link[0].cooldown : resolvedP0.link!.cooldown;
    const cdP5 = Array.isArray(resolvedP5.link) ? resolvedP5.link[0].cooldown : resolvedP5.link!.cooldown;

    expect(cdP0).toBe(baseAtM3);
    expect(cdP5).toBe(Math.max(0, baseAtM3 - 2));
  });
});
