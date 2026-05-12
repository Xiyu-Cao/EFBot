/**
 * V2 → V1 data adapter
 *
 * Converts v2 Skill objects into the legacy format consumed by
 * timelineStore.js (damage_ticks, duration, attack_segments, etc.).
 *
 * Used for v2-ready characters only. Non-v2 characters continue
 * using gamedata.json data unchanged.
 */

import type { Skill } from "../types";
import {
  applyOverridesToModule,
  getOverridesForChar,
  overridesVersion,
} from "../hitTimingOverrides";
// NOTE: Cooldown resolution (ultimate from ultimateCooldowns.json, link from
// mod.skillData levelData at actor level, plus potential `cooldown_modifier`
// flat-seconds) is owned by `simulation/v2/panel.ts#buildCharacterPanel`.
// `loadV2Module` returns the raw, unmutated module.

// ── Known v2-ready character modules ──
// Lazy-loaded to avoid importing all at startup

const V2_MODULES: Record<string, () => Promise<any>> = {
  ENDMINISTRATOR: () => import("./endministrator"),
  POGRANICHNK: () => import("./pogranichnk"),
  LASTRITE: () => import("./lastrite"),
  LIFENG: () => import("./lifeng"),
  ARCLIGHT: () => import("./arclight"),
  CHENQIANYU: () => import("./chenqianyu"),
  ROSSI: () => import("./rossi"),
};

export const V2_READY_IDS = new Set(Object.keys(V2_MODULES));

/** Characters that require enemy attack/HP/healing systems — not supported yet. */
export const UNSUPPORTED_IDS = new Set(["EMBER", "CATCHER", "SNOWSHINE"]);

/** Cache for raw, unmodified imported modules. Always immutable. */
const _rawModuleCache: Record<string, any> = {};
/** Cache for override-applied modules, keyed by charId; carries the overridesVersion it was built against. */
const _effectiveModuleCache: Record<string, { mod: any; version: number }> = {};

/** Get the raw module from cache (sync). Used internally; returns null if not yet imported. */
function _getRaw(charId: string): any | null {
  return _rawModuleCache[charId] || null;
}

/** Recompute the override-applied module for a char, caching against current overridesVersion. */
function _getEffective(charId: string): any | null {
  const raw = _getRaw(charId);
  if (!raw) return null;
  const version = overridesVersion.value;
  const cached = _effectiveModuleCache[charId];
  if (cached && cached.version === version) return cached.mod;
  const ov = getOverridesForChar(charId);
  const effective = applyOverridesToModule(raw, ov);
  _effectiveModuleCache[charId] = { mod: effective, version };
  return effective;
}

export async function loadV2Module(charId: string) {
  if (!_rawModuleCache[charId]) {
    const loader = V2_MODULES[charId];
    if (!loader) return null;
    _rawModuleCache[charId] = await loader();
  }
  return _getEffective(charId);
}

/** Synchronous version — returns null if not yet loaded */
export function getV2Module(charId: string) {
  return _getEffective(charId);
}

/** Returns the raw, override-free module if loaded. Used by the timing-tuner UI to read defaults. */
export function getRawV2Module(charId: string) {
  return _getRaw(charId);
}

/** Preload all v2 modules */
export async function preloadV2Modules() {
  await Promise.all(
    Object.keys(V2_MODULES).map(id => loadV2Module(id))
  );
}

/**
 * Re-run applyV2Overrides for every v2-ready char in a roster.
 * Call this after hit-timing overrides change so legacy fields
 * (skill_damage_ticks, attack_segments, etc.) get the new timings
 * before validateTimeline rebuilds inputs.
 */
export function reapplyV2OverridesToRoster(roster: any[]): void {
  if (!Array.isArray(roster)) return;
  for (const c of roster) {
    if (c && V2_READY_IDS.has(c.id)) applyV2Overrides(c);
  }
}

// ═══════════════════════════════════════════════════════════════════
// Conversion: v2 Skill → legacy damage_ticks + duration
// ═══════════════════════════════════════════════════════════════════

interface LegacyDamageTick {
  offset: number;
  sp: number;
  stagger: number;
  boundEffects: string[];
  multiplier?: number;
}

interface LegacySkillData {
  duration: number;
  damageTicks: LegacyDamageTick[];
  physicalAnomaly: any[][];
  animationTime?: number;
}

/** Convert a v2 Skill's hits into legacy damage_ticks format */
function convertHitsToTicks(skill: Skill): LegacyDamageTick[] {
  return skill.hits.map(hit => ({
    offset: hit.offset,
    sp: 0,  // SP restore is handled via effects, not the tick field
    stagger: hit.damage?.stagger ?? 0,
    boundEffects: [],
    multiplier: hit.damage?.multiplier ?? 0,
  }));
}

/** Convert a v2 Skill into legacy format for createBaseSkill */
export function convertSkillToLegacy(skill: Skill, animationTime?: number): LegacySkillData {
  return {
    duration: skill.duration,
    damageTicks: convertHitsToTicks(skill),
    physicalAnomaly: [],  // Effects are in hit.effects, not separate anomaly arrays
    ...(animationTime !== undefined ? { animationTime } : {}),
  };
}

/** Convert v2 attack skills array into legacy attack_segments format.
 *  Only includes normal attack segments (A1-AN), excludes execution and aerial. */
export function convertAttackToSegments(attackSkills: Skill[]): any[] {
  return attackSkills
    .filter(s => s.type === "attack" && !s.id.includes("execution") && !s.id.includes("aerial"))
    .map(skill => ({
      duration: skill.duration,
      gaugeGain: 0,
      damage_ticks: convertHitsToTicks(skill),
      anomalies: [],
      allowed_types: [],
      element: skill.element,
      _v2SkillId: skill.id,
      _v2SkillName: skill.name,
    }));
}

/** Convert a v2 Skill into a legacy variant entry (for char.variants[]).
 *  Used for `skills.link[1..]` — secondary link skills exposed as user-placeable
 *  alternates in the timeline editor (e.g. ROSSI 连携技第二段 二次施放). */
export function convertSkillToLegacyVariant(skill: Skill): any {
  return {
    id: skill.id,
    name: skill.name,
    type: skill.type,
    duration: skill.duration,
    icon: "",
    allowedTypes: [],
    physicalAnomaly: [],
    damageTicks: convertHitsToTicks(skill),
    cooldown: skill.cooldown ?? 0,
    gaugeGain: 0,
    // Carry the requiresPreviousAction field through for placement validation
    // (timelineStore will read this when validating action placement).
    ...(skill.requiresPreviousAction ? { requiresPreviousAction: skill.requiresPreviousAction } : {}),
    _v2SkillId: skill.id,
  };
}

/**
 * Apply v2 data overrides to a characterRoster entry (mutates in place).
 * Call this after characterRoster is loaded but before the skill library is built.
 */
export function applyV2Overrides(char: any): boolean {
  const mod = getV2Module(char.id);
  if (!mod) return false;

  const { skills } = mod;

  // ── Skill (战技) ──
  if (skills.skill) {
    const legacy = convertSkillToLegacy(skills.skill);
    char.skill_duration = legacy.duration;
    char.skill_damage_ticks = legacy.damageTicks;
    char.skill_spCost = skills.skill.spCost || char.skill_spCost;
    char.skill_anomalies = [];  // V2: effects are in hit.effects, not anomaly arrays
  }

  // ── Link (连携技) ──
  // skills.link can be a single Skill or Skill[] (multi-link variants).
  //   - skills.link[0] (or single) = primary link, exposed via char.link_*
  //   - skills.link[1..] = additional placeable variants, written to char.variants[]
  const linkVariants: any[] = [];
  if (skills.link) {
    const linkArray = Array.isArray(skills.link) ? skills.link : [skills.link];
    const primaryLink = linkArray[0];
    const legacy = convertSkillToLegacy(primaryLink);
    char.link_duration = legacy.duration;
    char.link_damage_ticks = legacy.damageTicks;
    char.link_anomalies = [];  // V2: effects are in hit.effects
    // Carry V2 skill id through to the legacy base skill — front-end (e.g.
    // ActionItem placement-window indicator) and storeAdapter's per-segment
    // chain resolution both look up by `_v2SkillId`.
    char.link_v2SkillId = primaryLink.id;
    // Push each non-primary as a placeable variant (e.g., ROSSI 第二段)
    for (let i = 1; i < linkArray.length; i++) {
      linkVariants.push(convertSkillToLegacyVariant(linkArray[i]));
    }
  }

  // V2 characters: kernel handles condition-based variant selection internally,
  // but multi-skill arrays (e.g., link[]) become placeable variants here.
  char.variants = linkVariants;

  // ── Ultimate (终结技) ──
  if (skills.ultimate) {
    const animTime = mod.ultimateAnimation ?? 0;
    const legacy = convertSkillToLegacy(skills.ultimate, animTime);
    char.ultimate_duration = legacy.duration;
    char.ultimate_damage_ticks = legacy.damageTicks;
    char.ultimate_animationTime = legacy.animationTime;
    char.ultimate_gaugeCost = skills.ultimate.gaugeCost;
    // Ultimate gauge cost == gauge max for this character: the bar fills to the
    // cost, then a cast empties it. Override the legacy gamedata.json value
    // (which can be stale or post-P4-discounted) so V2 module is the single
    // source of truth. potential `gauge_modifier` (e.g. P4 -15%) is applied
    // on top by timelineStore.resolveGaugeMax / characterBuild.gaugeMax.
    char.ultimate_gaugeMax = skills.ultimate.gaugeCost;
    char.ultimate_anomalies = [];  // V2: effects are in hit.effects
  }

  // ── Attack segments (普攻 A1-AN only) ──
  if (skills.attack) {
    const segments = convertAttackToSegments(skills.attack);
    char.attack_segments = segments;
    const totalDur = segments.reduce((sum: number, s: any) => sum + (Number(s.duration) || 0), 0);
    char.attack_duration = totalDur;

    // ── Execution (处决) — separate from attack segments ──
    const execSkill = skills.attack.find((s: Skill) => s.type === "execution");
    if (execSkill) {
      const execLegacy = convertSkillToLegacy(execSkill);
      char.execution_duration = execLegacy.duration;
      char.execution_damage_ticks = execLegacy.damageTicks;
    }

    // ── Aerial attack (下落攻击) — separate from attack segments ──
    const aerialSkill = skills.attack.find((s: Skill) => s.id.includes("aerial"));
    if (aerialSkill) {
      char.aerial_duration = aerialSkill.duration;
      char.aerial_damage_ticks = convertHitsToTicks(aerialSkill);
    }
  }

  return true;
}
