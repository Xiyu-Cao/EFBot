/**
 * Skill status registry — derives display status from existing SKILL_MULTIPLIERS.
 *
 * NOT a new truth source. Reads from the single source (skillMultipliers.ts)
 * and provides a simple lookup for UI display.
 *
 * Statuses:
 *   "supported"    — verified multiplier, runtime correct
 *   "wip"          — estimated multiplier or special mechanics pending
 *   "unsupported"  — no multiplier data (damage will be 0)
 */

import { SKILL_MULTIPLIERS, type SkillMultiplierEntry, hasSkillsJsonMultiplier } from "./skillMultipliers";

export type SkillDisplayStatus = "supported" | "wip" | "unsupported";

/**
 * Characters with special mechanics not yet fully implemented.
 * These show "处理中" even if their base multiplier is verified,
 * because conditional/enhanced effects are incomplete.
 *
 * Key: "CHARACTER_ID:actionType", value: reason string.
 */
const WIP_OVERRIDES: Record<string, string> = {
  // ALESH:link — removed: variant system confirmed end-to-end by C branch
  // ARCLIGHT:skill — removed: variant system confirmed end-to-end by C branch
  // AVYWENNA skill: lance recall damage works (damageSummary + simulation runtime).
  // Potentials (+20s lance duration) not yet in system; general persistent entity polish pending.
  "AVYWENNA:skill": "雷枪召回基础机制已可用; 潜能+20s持续时间未接入",
};

function getEntry(
  charId: string,
  actionType: string,
): SkillMultiplierEntry | undefined {
  const data = SKILL_MULTIPLIERS[charId];
  if (!data) return undefined;
  switch (actionType) {
    case "skill": return data.skill;
    case "link": return data.link;
    case "ultimate": return data.ultimate;
    case "execution": return data.execution;
    default: return undefined;
  }
}

export function getSkillDisplayStatus(
  charId: string,
  actionType: string,
): SkillDisplayStatus {
  const key = `${charId}:${actionType}`;

  // WIP override takes precedence
  if (WIP_OVERRIDES[key]) return "wip";

  const entry = getEntry(charId, actionType);
  if (!entry) {
    // No hardcoded entry — check if skills.json can provide a multiplier
    if (hasSkillsJsonMultiplier(charId, actionType)) return "wip";
    return "unsupported";
  }

  if (entry.status === "verified") return "supported";
  // estimated → wip
  return "wip";
}

/**
 * Get all skills that have a non-null status for a given character.
 * Used by UI to batch-query.
 */
export function getCharacterSkillStatuses(
  charId: string,
): Record<string, SkillDisplayStatus> {
  const result: Record<string, SkillDisplayStatus> = {};
  for (const type of ["skill", "link", "ultimate", "execution"] as const) {
    result[type] = getSkillDisplayStatus(charId, type);
  }
  return result;
}
