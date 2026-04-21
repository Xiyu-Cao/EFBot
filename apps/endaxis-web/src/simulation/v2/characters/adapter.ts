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
};

export const V2_READY_IDS = new Set(Object.keys(V2_MODULES));

/** Characters that require enemy attack/HP/healing systems — not supported yet. */
export const UNSUPPORTED_IDS = new Set(["EMBER", "CATCHER", "SNOWSHINE"]);

/** Cache for loaded modules */
const moduleCache: Record<string, any> = {};

export async function loadV2Module(charId: string) {
  if (moduleCache[charId]) return moduleCache[charId];
  const loader = V2_MODULES[charId];
  if (!loader) return null;
  const mod = await loader();
  moduleCache[charId] = mod;
  return mod;
}

/** Synchronous version — returns null if not yet loaded */
export function getV2Module(charId: string) {
  return moduleCache[charId] || null;
}

/** Preload all v2 modules */
export async function preloadV2Modules() {
  await Promise.all(
    Object.keys(V2_MODULES).map(id => loadV2Module(id))
  );
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
  if (skills.link) {
    // Single link or array of variants
    const primaryLink = Array.isArray(skills.link) ? skills.link[0] : skills.link;
    const legacy = convertSkillToLegacy(primaryLink);
    char.link_duration = legacy.duration;
    char.link_damage_ticks = legacy.damageTicks;
    char.link_anomalies = [];  // V2: effects are in hit.effects
  }

  // V2 characters: clear legacy variants — V2 kernel handles variant selection internally
  char.variants = [];

  // ── Ultimate (终结技) ──
  if (skills.ultimate) {
    const animTime = mod.ultimateAnimation ?? 0;
    const legacy = convertSkillToLegacy(skills.ultimate, animTime);
    char.ultimate_duration = legacy.duration;
    char.ultimate_damage_ticks = legacy.damageTicks;
    char.ultimate_animationTime = legacy.animationTime;
    char.ultimate_gaugeCost = skills.ultimate.gaugeCost;
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
