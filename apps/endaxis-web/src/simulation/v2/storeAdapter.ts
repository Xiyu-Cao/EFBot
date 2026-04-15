/**
 * V2 Store Adapter — Bridge between timelineStore state and V2 kernel inputs.
 *
 * Converts store tracks/actions/enemy into CharacterBuild[] + PlacedSkill[] +
 * EnemyConfig + KernelConfig, then runs the V2 kernel.
 *
 * Only activates when ALL tracks in the scenario have V2-ready characters.
 * Falls back to null (caller uses V1) if any character is not V2-ready.
 */

import type {
  CharacterBuild,
  Skill,
  DamageElement,
  PassiveTrigger,
} from "./types";
import type { PlacedSkill, EnemyConfig, KernelConfig } from "./kernel";
import type { CharacterInput, StatModifier } from "./characterBuild";
import { computeCharacterBuild } from "./characterBuild";
import { V2_READY_IDS, getV2Module } from "./characters/adapter";

// ═══════════════════════════════════════════════════════════════════
// Types for store data (loosely typed — store is JS)
// ═══════════════════════════════════════════════════════════════════

interface StoreTrack {
  id: string;
  actions: StoreAction[];
  weaponId?: string;
  stats?: Record<string, number>;
  growth?: {
    promotion: number;
    characterLevel: number;
    potentialLevel: number;
    skillLevels: Record<string, { rank: number; mastery: number }>;
    talentLevels?: Record<string, number>;
  };
  // Equipment slots
  equipArmorId?: string;
  equipGlovesId?: string;
  equipAccessory1Id?: string;
  equipAccessory2Id?: string;
}

interface StoreAction {
  instanceId: string;
  id: string;
  type: string; // 'attack' | 'skill' | 'link' | 'ultimate'
  kind?: string; // 'attack_segment' | 'attack_group' | 'main_control'
  startTime: number;
  duration: number;
  trackId?: string;
  isDisabled?: boolean;
  attackSegmentIndex?: number;
  attackSequenceIndex?: number;
  _v2SkillId?: string;
}

interface StoreWeapon {
  id: string;
  baseAtk?: number;
  level?: number;
  passiveStats?: Record<string, number>;
}

interface StoreSystemConstants {
  initialSp: number;
  maxStagger: number;
  staggerNodeCount: number;
  staggerNodeDuration: number;
  staggerBreakDuration: number;
  initialGaugeFull?: boolean;
}

interface StoreCharRoster {
  id: string;
  element?: string;
  rarity?: number;
  ultimate_gaugeMax?: number;
}

// ═══════════════════════════════════════════════════════════════════
// Main adapter function
// ═══════════════════════════════════════════════════════════════════

export interface V2Inputs {
  builds: CharacterBuild[];
  skills: PlacedSkill[];
  enemyConfig: EnemyConfig;
  config: KernelConfig;
  /** Passive triggers grouped by actor ID. */
  triggersByActor: Map<string, PassiveTrigger[]>;
}

/**
 * Build V2 kernel inputs from store state.
 *
 * Returns null if any track's character is not V2-ready.
 */
export function buildV2Inputs(
  tracks: StoreTrack[],
  _characterRoster: StoreCharRoster[],
  weaponDatabase: StoreWeapon[],
  systemConstants: StoreSystemConstants,
  resolveTrackConfiguredStats: (trackId: string) => Record<string, number> | null,
  resolveGaugeMax: (trackId: string) => number,
): V2Inputs | null {
  const activeTracks = tracks.filter(t => t.id && t.actions?.length >= 0);
  if (activeTracks.length === 0) { console.log('[buildV2Inputs] no active tracks'); return null; }

  // Check all characters are V2-ready
  for (const t of activeTracks) {
    if (!V2_READY_IDS.has(t.id)) {
      console.log('[buildV2Inputs] not V2-ready:', t.id, '| V2_READY_IDS:', [...V2_READY_IDS]);
      return null;
    }
  }

  const builds: CharacterBuild[] = [];
  const allSkills: PlacedSkill[] = [];
  const triggersByActor = new Map<string, PassiveTrigger[]>();

  for (const track of activeTracks) {
    const mod = getV2Module(track.id);
    if (!mod) { console.log('[buildV2Inputs] module not loaded for:', track.id); return null; }

    // ── Build CharacterBuild ──
    const build = buildCharacter(track, mod, weaponDatabase, resolveTrackConfiguredStats, resolveGaugeMax);
    if (!build) continue;
    builds.push(build);

    // ── Map actions to PlacedSkills ──
    const placed = mapActionsToPlacedSkills(track, mod);
    allSkills.push(...placed);

    // ── Collect triggers ──
    if (mod.triggers) {
      triggersByActor.set(track.id, mod.triggers);
    }
  }

  if (builds.length === 0) return null;

  // ── Build EnemyConfig ──
  const staggerNodes = buildStaggerNodes(
    systemConstants.maxStagger,
    systemConstants.staggerNodeCount,
  );

  const enemyConfig: EnemyConfig = {
    defenseMultiplier: 1.0,
    maxStagger: systemConstants.maxStagger,
    staggerNodes,
    staggerBreakDuration: systemConstants.staggerBreakDuration,
    basePhysicalResist: 0,
    baseMagicResist: 0,
  };

  // Build ref resolver from V2 module skillData
  const skillDataByActor = new Map<string, any>();
  for (const track of activeTracks) {
    const mod = getV2Module(track.id);
    if (mod?.skillData) {
      skillDataByActor.set(track.id, mod.skillData);
    }
  }

  const resolveRef = (actorId: string, label: string): number => {
    const sd = skillDataByActor.get(actorId);
    if (!sd) return 0;
    // Search all skill sections for the label
    for (const key of Object.keys(sd)) {
      const section = sd[key];
      if (!section?.levelData) continue;
      for (const row of section.levelData) {
        if (row.label === label) {
          // Use M3 (index 11) value, parse "320%" → 320, "30" → 30
          const raw = String(row.values?.[11] ?? row.values?.[row.values.length - 1] ?? "0");
          return parseFloat(raw.replace("%", "").replace("s", "")) || 0;
        }
      }
    }
    return 0;
  };

  const config: KernelConfig = {
    initialSP: systemConstants.initialSp,
    critMode: "expected",
    resolveRef,
    initialGaugeFull: systemConstants.initialGaugeFull || false,
  };

  return { builds, skills: allSkills, enemyConfig, config, triggersByActor };
}

// ═══════════════════════════════════════════════════════════════════
// Character build
// ═══════════════════════════════════════════════════════════════════

function buildCharacter(
  track: StoreTrack,
  mod: any,
  weaponDatabase: StoreWeapon[],
  resolveTrackConfiguredStats: (trackId: string) => Record<string, number> | null,
  resolveGaugeMax: (trackId: string) => number,
): CharacterBuild | null {
  const { identity, levelStats } = mod;
  const growth = track.growth;
  if (!growth) return null;

  // Look up base stats from V2 level table
  const level = growth.characterLevel || 90;
  const baseStats = lookupLevelStats(levelStats, level);
  if (!baseStats) return null;

  // Find weapon
  const weapon = track.weaponId
    ? weaponDatabase.find(w => w.id === track.weaponId)
    : null;

  // Collect stat modifiers from store's configured stats delta
  const statModifiers = collectStatModifiers(track, resolveTrackConfiguredStats);

  const input: CharacterInput = {
    id: identity.id,
    name: identity.name,
    element: identity.element as DamageElement,
    rarity: identity.rarity,

    promotion: growth.promotion || 4,
    potentialLevel: growth.potentialLevel || 0,
    talentLevels: growth.talentLevels || {},

    baseStrength: baseStats.strength || 0,
    baseAgility: baseStats.agility || 0,
    baseIntellect: baseStats.intellect || 0,
    baseWill: baseStats.will || 0,
    baseAttack: baseStats.attack || 0,
    baseHp: baseStats.hp || 0,

    mainAttribute: identity.mainAttribute,
    subAttribute: identity.subAttribute,

    weaponId: track.weaponId || null,
    weaponBaseAtk: weapon?.baseAtk || 0,
    weaponLevel: weapon?.level || 90,

    equipmentSetId: null, // TODO: detect from equipment slots

    baseGaugeMax: resolveGaugeMax(track.id),

    statModifiers,
  };

  const result = computeCharacterBuild(input);
  return result;
}

/**
 * Look up base stats from V2 module's levelStats JSON.
 * Stats JSON format: { levels: { "1": { strength, agility, ... }, "90": { ... } } }
 */
function lookupLevelStats(
  levelStats: Record<string, any>,
  level: number,
): { strength: number; agility: number; intellect: number; will: number; attack: number; hp: number } | null {
  // stats.json wraps data in a "levels" key
  const table = levelStats.levels || levelStats;

  // Try exact match
  const exact = table[String(level)];
  if (exact) return exact;

  // Fallback to closest available level
  const levels = Object.keys(table).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
  if (levels.length === 0) return null;

  // Find closest level that doesn't exceed
  let best = levels[0];
  for (const l of levels) {
    if (l <= level) best = l;
  }
  return table[String(best)] || null;
}

/**
 * Collect stat modifiers from store's track.stats delta values.
 * These come from weapon common slots, equipment substats, etc.
 */
function collectStatModifiers(
  track: StoreTrack,
  _resolveTrackConfiguredStats: (trackId: string) => Record<string, number> | null,
): StatModifier[] {
  const modifiers: StatModifier[] = [];
  const stats = track.stats;
  if (!stats) return modifiers;

  // Map store stat field names to V2 stat names
  const STAT_MAP: Record<string, { stat: string; type: "flat" | "percent" }> = {
    attack_percent: { stat: "attack_percent", type: "flat" },
    crit_rate: { stat: "crit_rate", type: "flat" },
    crit_dmg: { stat: "crit_damage", type: "flat" },
    physical_dmg: { stat: "physical_dmg", type: "flat" },
    blaze_dmg: { stat: "blaze_dmg", type: "flat" },
    emag_dmg: { stat: "emag_dmg", type: "flat" },
    cold_dmg: { stat: "cold_dmg", type: "flat" },
    nature_dmg: { stat: "nature_dmg", type: "flat" },
    arts_dmg: { stat: "arts_dmg", type: "flat" },
    attack_dmg_bonus: { stat: "attack_dmg_bonus", type: "flat" },
    skill_dmg_bonus: { stat: "skill_dmg_bonus", type: "flat" },
    link_dmg_bonus: { stat: "link_dmg_bonus", type: "flat" },
    ultimate_dmg_bonus: { stat: "ultimate_dmg_bonus", type: "flat" },
    all_skill_dmg_bonus: { stat: "all_skill_dmg_bonus", type: "flat" },
    broken_dmg_bonus: { stat: "broken_dmg_bonus", type: "flat" },
    originium_arts_power: { stat: "originium_arts_power", type: "flat" },
    link_cd_reduction: { stat: "link_cd_reduction", type: "flat" },
    ult_charge_eff: { stat: "ult_charge_eff", type: "flat" },
  };

  for (const [field, mapping] of Object.entries(STAT_MAP)) {
    const value = Number(stats[field]) || 0;
    if (value !== 0) {
      modifiers.push({
        source: "equipment",
        stat: mapping.stat,
        value,
        type: mapping.type,
      });
    }
  }

  return modifiers;
}

// ═══════════════════════════════════════════════════════════════════
// Action → PlacedSkill mapping
// ═══════════════════════════════════════════════════════════════════

function mapActionsToPlacedSkills(track: StoreTrack, mod: any): PlacedSkill[] {
  const { skills, variants } = mod;
  const result: PlacedSkill[] = [];

  for (const action of track.actions) {
    if (action.isDisabled) continue;

    const skill = resolveSkillForAction(action, skills, track.id);
    if (!skill) continue;

    // Look up variants for this skill type
    const variantList = variants?.[action.type] || undefined;

    result.push({
      actionId: action.instanceId,
      actorId: track.id,
      skill,
      startTime: action.startTime,
      variants: variantList,
    });
  }

  return result;
}

/**
 * Resolve the V2 Skill object for a store action.
 */
function resolveSkillForAction(action: StoreAction, skills: any, _trackId: string): Skill | null {
  const actionType = action.type;

  if (actionType === "skill") {
    return skills.skill || null;
  }
  if (actionType === "link") {
    // Link may be a single skill or array of variants
    if (Array.isArray(skills.link)) return skills.link[0];
    return skills.link || null;
  }
  if (actionType === "ultimate") {
    return skills.ultimate || null;
  }
  if (actionType === "execution") {
    if (!Array.isArray(skills.attack)) return null;
    return skills.attack.find((s: Skill) => s.type === "execution") || null;
  }
  if (actionType === "attack") {
    if (!Array.isArray(skills.attack)) return null;

    // If the action has a v2 skill ID, use it directly
    if (action._v2SkillId) {
      const found = skills.attack.find((s: Skill) => s.id === action._v2SkillId);
      if (found) return found;
    }

    // Map by segment index (1-based in store, 0-based in array)
    // Only use normal attack segments (filter out execution/aerial)
    const normalAttacks = skills.attack.filter(
      (s: Skill) => s.type === "attack" && !s.id.includes("execution") && !s.id.includes("aerial")
    );

    const segIdx = (action.attackSegmentIndex || action.attackSequenceIndex || 1) - 1;
    if (segIdx >= 0 && segIdx < normalAttacks.length) {
      return normalAttacks[segIdx];
    }

    return null;
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════
// Stagger nodes
// ═══════════════════════════════════════════════════════════════════

function buildStaggerNodes(maxStagger: number, nodeCount: number): number[] {
  if (nodeCount <= 0 || maxStagger <= 0) return [];
  const nodes: number[] = [];
  for (let i = 1; i <= nodeCount; i++) {
    nodes.push(Math.round(maxStagger * i / (nodeCount + 1)));
  }
  return nodes;
}
