import type { ActionType, ResolvedDamageTick } from "../compiler/types";

/**
 * Skill multiplier overlay — hand-entered damage multipliers for known skills.
 *
 * gamedata.json's skill_damage_ticks do NOT contain multiplier values.
 * This file provides them for the first batch of characters.
 *
 * Structure: characterId → actionType → per-tick multipliers + truth status
 *
 * Authoritative precedence: any non-zero multiplier already on the compiled
 * tick wins; this overlay only fills missing or zero multipliers.
 *
 * TRUTH STATUS:
 * - "verified"  — confirmed via in-game testing or datamine
 * - "estimated" — educated guess; needs manual verification
 *
 * When verifying: update the status to "verified" and note the source.
 */

/**
 * Truth status for a multiplier entry.
 * - "verified":  confirmed via in-game testing / datamine
 * - "estimated": educated guess, needs manual check
 */
export type MultiplierTruthStatus = "verified" | "estimated";

export interface SkillMultiplierEntry {
  /** Per-tick multipliers, indexed to match damage_ticks order */
  multipliers: number[];
  /**
   * Enhanced/conditional variant multipliers (same tick count, same indices).
   * Used when the action is in an enhanced state (e.g. triggered by a condition).
   * The split ratio between ticks is preserved; only the total changes.
   */
  enhancedMultipliers?: number[];
  /** Element override if different from character default */
  element?: string;
  /** Truth status: verified or estimated */
  status: MultiplierTruthStatus;
  /** Source of the data (e.g. "datamine v1.2", "in-game test 2025-03") */
  source?: string;
}

export type ActionMultipliers = {
  skill?: SkillMultiplierEntry;
  link?: SkillMultiplierEntry;
  ultimate?: SkillMultiplierEntry;
  execution?: SkillMultiplierEntry;
  attackSegments?: SkillMultiplierEntry[];
};

/**
 * Character ID → action multiplier data.
 *
 * Add new characters here as their multipliers are verified.
 * Always set `status` to indicate truth level.
 */
export const SKILL_MULTIPLIERS: Record<string, ActionMultipliers> = {
  // =========================================================================
  // Estimated multi-tick entries superseded by skills.json group mapping:
  //   ENDMINISTRATOR, ESTELLA — all single-tick, removed in P1
  //   CHENQIANYU:ultimate (7 tick → 2-row group map: 斩击→tick0-5, 終結→tick6)
  //   GILBERTA:skill (5 tick → 2-row group map: 牽引→tick0-3, 爆炸→tick4)
  //   POGRANICHNK:skill (2 tick → 1:1), :ultimate (6 tick → 3-row group map)
  // =========================================================================

  // POGRANICHNK: all skills now covered by skills.json.
  //   skill (2-tick 1:1), ultimate (6-tick group map), link (3-tick 1:1 default).
  //   Link enhanced variant (强化第三段 297%) is C-class — needs enhancedMultipliers in future.

  // =========================================================================
  // ALESH (阿列什) — Cold
  // =========================================================================
  // Link: 凿孔底钓术 — verified 2-hit structure.
  // Default total from wiki "伤害倍率", split 33/133 : 100/133 per hit.
  // Enhanced total from wiki "强化伤害倍率", same split ratio.
  // hit1 offset 0.32s (frame 19), hit2 offset 1.08s (frame 65).
  // =========================================================================
  // ARCLIGHT (弧光) — Emag
  // =========================================================================
  // Skill: 疾风迅雷 — verified 2-hit default + conditional 3rd hit (variant).
  // Default: 2 ticks aligned to gamedata (offset 0.63, 0.80).
  // Variant "强化战技" adds 3rd tick at offset 1.2 (追加伤害 405%).
  // 3rd tick consumes conduction buff 1 frame before damage via boundEffects.
  // Ultimate: 2 ticks aligned to gamedata.
  ARCLIGHT: {
    skill: {
      multipliers: [1.01, 1.01],
      // Enhanced variant: 3 ticks — default 2 + conditional extra hit
      enhancedMultipliers: [1.01, 1.01, 4.05],
      status: "verified",
      source: "warfarin-wiki M3 + in-game verification: 2-hit default, 3rd conditional extra on conduction consume",
    },
    ultimate: {
      multipliers: [3.5, 5.5],
      status: "verified",
      source: "warfarin-wiki M3, 2 ticks aligned to gamedata",
    },
  },

  // =========================================================================
  // ALESH (阿蕾莎) — Cold
  // =========================================================================
  ALESH: {
    link: {
      // M3 default total = 300% = 3.0 → hit1 = 3.0×33/133 ≈ 0.744, hit2 = 3.0×100/133 ≈ 2.256
      multipliers: [
        +(3.0 * 33 / 133).toFixed(4),  // 0.7444
        +(3.0 * 100 / 133).toFixed(4), // 2.2556
      ],
      // Enhanced: total = 480% = 4.8 → same 33/133 : 100/133 split, NOT an extra hit
      enhancedMultipliers: [
        +(4.8 * 33 / 133).toFixed(4),  // 1.1910
        +(4.8 * 100 / 133).toFixed(4), // 3.6090
      ],
      status: "verified",
      source: "warfarin-wiki M3 + in-game 2-hit verification, split ratio 33/133:100/133",
    },
  },
};

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Get multiplier for a specific character, action type, and tick index.
 * If useEnhanced is true and the entry has enhancedMultipliers, those are used.
 * Returns undefined if no multiplier data is available.
 */
export function getSkillMultiplier(
  characterId: string,
  actionType: string,
  tickIndex: number,
  useEnhanced: boolean = false,
): number | undefined {
  const entry = getSkillMultiplierEntry(characterId, actionType);
  if (!entry) return undefined;
  const arr = (useEnhanced && entry.enhancedMultipliers) ? entry.enhancedMultipliers : entry.multipliers;
  return arr[tickIndex];
}

/**
 * Get the full entry (including status) for a character action.
 */
export function getSkillMultiplierEntry(
  characterId: string,
  actionType: string,
): SkillMultiplierEntry | undefined {
  const charData = SKILL_MULTIPLIERS[characterId];
  if (!charData) return undefined;

  switch (actionType) {
    case "skill":
      return charData.skill;
    case "link":
      return charData.link;
    case "ultimate":
      return charData.ultimate;
    case "execution":
      return charData.execution;
    default:
      return undefined;
  }
}

/**
 * Get all entries that have a specific truth status.
 * Useful for auditing: "show me all estimated values that need checking".
 */
export function getEntriesByStatus(
  status: MultiplierTruthStatus,
): Array<{ characterId: string; actionType: string; entry: SkillMultiplierEntry }> {
  const results: Array<{ characterId: string; actionType: string; entry: SkillMultiplierEntry }> = [];
  for (const [charId, actions] of Object.entries(SKILL_MULTIPLIERS)) {
    for (const [actionType, entry] of Object.entries(actions)) {
      if (entry && "status" in entry && (entry as SkillMultiplierEntry).status === status) {
        results.push({ characterId: charId, actionType, entry: entry as SkillMultiplierEntry });
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Per-level multiplier from operator folder skills.json
// ---------------------------------------------------------------------------
// Vite static glob — must use import.meta.glob() directly (not via cast) for build-time transform
const _skillsDataModules: Record<string, any> = import.meta.glob(
  '../../data/operators/*/skills.json',
  { eager: true }
);
function _getSkillsDataModules(): Record<string, any> {
  return _skillsDataModules;
}

// Exclude conditional/extra/enhanced damage rows from default multiplier matching
const EXCLUDE_PATTERNS = ['击碎', '额外', '提前', '追加', '强化', '终结技期间', '消耗'];

/**
 * Get all non-conditional damage multiplier rows from skills.json for a skill.
 */
function _getMultiplierRows(characterId: string, actionType: string): Array<{ label: string; values: string[] }> {
  const modules = _getSkillsDataModules();
  const key = `../../data/operators/${characterId}/skills.json`;
  const mod = modules[key];
  const skillsData = mod?.default || mod;
  if (!skillsData) return [];

  const skillKey = actionType === 'attack' ? 'attack'
    : actionType === 'skill' ? 'skill'
    : actionType === 'link' ? 'link'
    : actionType === 'ultimate' ? 'ultimate'
    : null;
  if (!skillKey) return [];

  const skill = skillsData[skillKey];
  if (!skill?.levelData?.length) return [];

  return skill.levelData.filter((row: any) => {
    const label = row.label || '';
    if (!label.includes('倍率')) return false;
    if (!row.values?.some((v: any) => String(v).includes('%'))) return false;
    if (EXCLUDE_PATTERNS.some(p => label.includes(p))) return false;
    return true;
  });
}

/**
 * Look up damage multiplier from skills.json at a given unified level and tick index.
 *
 * Matching rules:
 *   1. "每段" uniform row → all ticks get the same per-level value
 *   2. Row count === tick count → direct 1:1 tick-to-row mapping
 *   3. Single/few rows, tickIndex 0 → best-match primary multiplier
 *   4. Otherwise → undefined (fall through to SKILL_MULTIPLIERS)
 *
 * Returns multiplier as decimal (350% → 3.5), or undefined.
 */
function getSkillMultiplierFromData(
  characterId: string,
  actionType: string,
  unifiedLevel: number,
  tickIndex: number = 0,
  tickCount: number = 1,
): number | undefined {
  const rows = _getMultiplierRows(characterId, actionType);
  if (rows.length === 0) return undefined;

  const levelIdx = Math.max(0, Math.min(11, unifiedLevel - 1));

  function parseRow(row: { values: string[] }): number | undefined {
    const val = String(row.values[levelIdx]);
    const parsed = parseFloat(val.replace('%', ''));
    return Number.isFinite(parsed) ? parsed / 100 : undefined;
  }

  // Case 1: "每段" uniform row — all ticks get the same value
  if (rows.length === 1 && rows[0].label.includes('每段')) {
    return parseRow(rows[0]);
  }

  // Case 2: row count === tick count → 1:1 mapping
  if (rows.length === tickCount && tickIndex < rows.length) {
    return parseRow(rows[tickIndex]);
  }

  // Case 3: single row, multiple ticks, NOT "每段" → treat as total, distribute uniformly
  // Most skills with a single "伤害倍率" row use it as total damage, not per-tick.
  if (rows.length === 1 && tickCount > 1) {
    const v = parseRow(rows[0]);
    return v !== undefined ? v / tickCount : undefined;
  }

  // Case 4: group mapping (rows < ticks) — known patterns:
  // 2 rows + N ticks: first row → early ticks, last row → final tick(s)
  // 3 rows + N ticks: first → tick0, middle → middle ticks (均分), last → final tick
  if (rows.length >= 2 && rows.length < tickCount) {
    if (rows.length === 2) {
      // Pattern: "斩击/牵引" (first N-1 ticks) + "终结/爆炸" (last tick)
      if (tickIndex < tickCount - 1) {
        // First row split among first (tickCount-1) ticks
        const v = parseRow(rows[0]);
        return v !== undefined ? v / (tickCount - 1) : undefined;
      } else {
        return parseRow(rows[1]);
      }
    }
    if (rows.length === 3) {
      // Pattern: "进军" (tick0) + "袭扰" (middle ticks 均分) + "决胜" (last tick)
      if (tickIndex === 0) return parseRow(rows[0]);
      if (tickIndex === tickCount - 1) return parseRow(rows[2]);
      // Middle ticks: second row ÷ number of middle ticks
      const middleCount = tickCount - 2;
      const v = parseRow(rows[1]);
      return v !== undefined && middleCount > 0 ? v / middleCount : undefined;
    }
  }

  // Case 5: primary multiplier for tickIndex 0 (catch-all)
  if (tickIndex === 0) {
    let best: number | undefined;
    let bestPriority = 99;
    for (const row of rows) {
      const label = row.label || '';
      const priority = label.endsWith('伤害倍率') ? 0 : 1;
      if (priority < bestPriority) {
        const v = parseRow(row);
        if (v !== undefined) { best = v; bestPriority = priority; }
      }
    }
    return best;
  }

  return undefined;
}

/**
 * Probe: does skills.json have a usable primary damage multiplier row for this skill?
 * Used by skillStatusRegistry to distinguish "wip" (has data) from "unsupported" (no data).
 */
/**
 * Read a specific named row from skills.json levelData as a multiplier array (12 entries, decimal).
 * Used by AVYWENNA lance recall to get 雷枪伤害倍率 / 强雷枪伤害倍率 without hardcoding.
 */
export function getSkillsJsonRowByLabel(
  characterId: string,
  actionType: string,
  label: string,
): number[] | undefined {
  const modules = _getSkillsDataModules();
  const key = `../../data/operators/${characterId}/skills.json`;
  const mod = modules[key];
  const skillsData = mod?.default || mod;
  if (!skillsData) return undefined;

  const skillKey = actionType === 'attack' ? 'attack'
    : actionType === 'skill' ? 'skill'
    : actionType === 'link' ? 'link'
    : actionType === 'ultimate' ? 'ultimate'
    : null;
  if (!skillKey) return undefined;

  const skill = skillsData[skillKey];
  if (!skill?.levelData?.length) return undefined;

  const row = skill.levelData.find((r: any) => r.label === label);
  if (!row?.values) return undefined;

  return row.values.map((v: any) => {
    const parsed = parseFloat(String(v).replace('%', ''));
    return Number.isFinite(parsed) ? parsed / 100 : 0;
  });
}

export function hasSkillsJsonMultiplier(characterId: string, actionType: string): boolean {
  return getSkillMultiplierFromData(characterId, actionType, 12, 0, 1) !== undefined;
}

/**
 * Apply skill multiplier overlay with per-level support.
 * Priority:
 *   1. Non-zero multiplier already on the tick (from compiler) → keep
 *   2. Per-level data from skills.json (if available) → use at current level
 *   3. Hardcoded SKILL_MULTIPLIERS fallback → use as-is
 */
export function applySkillMultiplierOverlay(
  trackId: string,
  actionType: ActionType,
  tickIndex: number,
  tick: ResolvedDamageTick,
  useEnhanced: boolean = false,
  unifiedLevel: number = 12,
  tickCount: number = 1,
): ResolvedDamageTick {
  const tickData = { ...tick };
  if (!tickData.multiplier || tickData.multiplier === 0) {
    // Priority 1: per-level data from skills.json (supports single + multi-tick)
    const fromData = getSkillMultiplierFromData(trackId, actionType, unifiedLevel, tickIndex, tickCount);
    if (fromData !== undefined) {
      tickData.multiplier = fromData;
      return tickData;
    }

    // Priority 2: hardcoded SKILL_MULTIPLIERS, scaled by level ratio if possible
    const overlay = getSkillMultiplier(trackId, actionType, tickIndex, useEnhanced);
    if (overlay !== undefined) {
      const m3FromData = getSkillMultiplierFromData(trackId, actionType, 12, 0, tickCount);
      if (m3FromData !== undefined && unifiedLevel < 12) {
        const currentFromData = getSkillMultiplierFromData(trackId, actionType, unifiedLevel, 0, tickCount);
        if (currentFromData !== undefined) {
          const ratio = currentFromData / m3FromData;
          tickData.multiplier = overlay * ratio;
          return tickData;
        }
      }
      tickData.multiplier = overlay;
    }
  }
  return tickData;
}
