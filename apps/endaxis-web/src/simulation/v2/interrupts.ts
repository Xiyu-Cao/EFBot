/**
 * Interrupt matrix & priority helpers.
 *
 * Single source of truth for "can action X interrupt active action Y?".
 * Consumed by:
 *   - kernel.ts (runtime simulation)
 *   - storeAdapter.ts (validation-time attack chain resolver)
 *   - timelineStore.js (placement-time overlap snap)
 *
 * Override mechanism:
 *   - `Skill.interruptibleBy` on a specific skill overrides the default matrix
 *     (used for character exceptions, e.g. pogranichnk where skill⇄link are
 *     mutually interruptible).
 *   - When porting a new character, check the "打断例外" section in
 *     reports/v2-skill-hit-template.md and add `interruptibleBy` on the
 *     relevant skills.
 */
import type { ActionType } from "./types";

export type SkillCategory =
  | "regular_attack"
  | "heavy_attack"
  | "execution"
  | "aerial"
  | "skill"
  | "link"
  | "dodge"
  | "ultimate";

/** Minimal shape needed to determine interrupt behavior (works for Skill and placed action). */
export interface InterruptSkillLike {
  type: string;
  id?: string;
  isHeavyAttack?: boolean;
  kind?: string;
  interruptibleBy?: ActionType[];
}

export function getSkillCategory(skill: InterruptSkillLike): SkillCategory {
  if (skill.type === "execution") return "execution";
  if (skill.type === "attack") {
    if (skill.isHeavyAttack) return "heavy_attack";
    if (skill.kind === "aerial" || (skill.id && skill.id.includes("aerial"))) return "aerial";
    return "regular_attack";
  }
  return skill.type as SkillCategory;
}

/**
 * Default priority matrix: for each ACTIVE category, the set of INCOMING
 * categories that can interrupt it.
 *
 * Ordering implied by the matrix:
 *   ultimate > dodge > link > skill > {regular_attack ≈ heavy_attack ≈ execution ≈ aerial}
 *
 * execution / aerial are intentionally only interruptible by ultimate (game-accurate).
 */
export const DEFAULT_INTERRUPTIBLE_BY: Record<SkillCategory, ReadonlySet<SkillCategory>> = {
  regular_attack: new Set(["skill", "link", "dodge", "ultimate"]),
  heavy_attack:   new Set(["link", "dodge", "ultimate"]),
  execution:      new Set(["ultimate"]),
  aerial:         new Set(["ultimate"]),
  skill:          new Set(["link", "dodge", "ultimate"]),
  link:           new Set(["dodge", "ultimate"]),
  dodge:          new Set(["ultimate"]),
  ultimate:       new Set(),
};

/**
 * Can the incoming action interrupt the currently active one?
 *
 * `postLastHit=true` enables the 后摇 relaxed rule — after the active skill's
 * last hit and before its duration end, any action whose category is not a
 * basic attack may interrupt (aerial counts as non-basic-attack for this
 * purpose since its "takeoff" subaction is not a basic attack). Per-skill
 * override and default matrix are bypassed in this mode.
 */
export function canInterrupt(
  active: InterruptSkillLike,
  incoming: InterruptSkillLike,
  postLastHit?: boolean,
): boolean {
  if (postLastHit) {
    const c = getSkillCategory(incoming);
    return c !== "regular_attack" && c !== "heavy_attack";
  }
  // Per-skill override takes precedence (character exceptions).
  if (active.interruptibleBy) {
    return active.interruptibleBy.includes(incoming.type as ActionType);
  }
  return DEFAULT_INTERRUPTIBLE_BY[getSkillCategory(active)].has(getSkillCategory(incoming));
}

/**
 * Convenience: is `time` past the active skill's last hit offset (relative to
 * its startTime)? Actions with no hits are never in 后摇 state.
 */
export function isPostLastHit(
  active: { hits?: { offset: number }[] },
  activeStartTime: number,
  time: number,
): boolean {
  const hits = active.hits;
  if (!hits || hits.length === 0) return false;
  let maxOffset = 0;
  for (const h of hits) {
    if (h.offset > maxOffset) maxOffset = h.offset;
  }
  return time >= activeStartTime + maxOffset;
}

/**
 * Whether this action requires the actor to be the main control character.
 * Matches kernel.ts:needsMainControl — kept here so JS callers (store) can
 * derive the same answer without reaching into the kernel.
 */
export function needsMainControl(skill: InterruptSkillLike): boolean {
  return skill.type === "attack" || skill.type === "execution" || skill.type === "dodge";
}
