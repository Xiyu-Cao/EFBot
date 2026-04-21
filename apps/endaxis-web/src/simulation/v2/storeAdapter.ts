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
import { V2_WEAPON_REGISTRY, extractWeaponPassiveStats, convertWeaponTriggers } from "./weapons/definitions";
import { V2_EQUIPMENT_SET_REGISTRY, convertSetTriggers } from "./equipment/definitions";
import { canInterrupt, isPostLastHit } from "./interrupts";

// ═══════════════════════════════════════════════════════════════════
// Types for store data (loosely typed — store is JS)
// ═══════════════════════════════════════════════════════════════════

interface StoreTrack {
  id: string;
  actions: StoreAction[];
  weaponId?: string;
  weaponBuffTier?: number; // 1-9, weapon trigger tier
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
  kind?: string; // 'attack_segment' | 'attack_group' | 'main_control' | 'aerial'
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
  /** Recalculated attack segment indices (1-based). Map<actionInstanceId, segIdx>. */
  attackSegmentMap: Map<string, number>;
  /** Execution skill per actor (for auto-conversion during stagger). */
  executionSkillByActor: Map<string, Skill>;
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
  /** Returns active equipment set categories for a track (e.g., ["点剑"]). */
  resolveActiveSetCategories?: (trackId: string) => string[],
  /**
   * Second-pass override: heavy attacks interrupted before their hit1 in the
   * prior simulation pass. Map<actionInstanceId, interruptTime>. Combo resolver
   * keeps `comboIdx` on 重击 after these so the next attack re-casts heavy.
   */
  pendingHeavyInfo?: Map<string, number>,
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
  const attackSegmentMap = new Map<string, number>();
  const executionSkillByActor = new Map<string, Skill>();

  for (const track of activeTracks) {
    const mod = getV2Module(track.id);
    if (!mod) { console.log('[buildV2Inputs] module not loaded for:', track.id); return null; }

    // ── Build CharacterBuild ──
    const build = buildCharacter(track, mod, weaponDatabase, resolveTrackConfiguredStats, resolveGaugeMax);
    if (!build) continue;
    builds.push(build);

    // ── Map actions to PlacedSkills (with combo re-evaluation) ──
    const { placed, segMap } = mapActionsToPlacedSkills(track, mod, pendingHeavyInfo);
    allSkills.push(...placed);
    for (const [id, idx] of segMap) attackSegmentMap.set(id, idx);

    // ── Collect execution skill for this actor ──
    const execSkill = Array.isArray(mod.skills?.attack)
      ? mod.skills.attack.find((s: Skill) => s.type === "execution")
      : null;
    if (execSkill) executionSkillByActor.set(track.id, execSkill);

    // ── Collect triggers (character + weapon) ──
    const triggers: PassiveTrigger[] = mod.triggers ? [...mod.triggers] : [];

    // Weapon triggers
    if (track.weaponId) {
      const weaponDef = V2_WEAPON_REGISTRY[track.weaponId];
      if (weaponDef) {
        const tierIdx = Math.max(0, Math.min(8, (track.weaponBuffTier || 9) - 1));
        triggers.push(...convertWeaponTriggers(weaponDef, tierIdx));
      }
    }

    // Equipment set triggers
    if (resolveActiveSetCategories) {
      const categories = resolveActiveSetCategories(track.id);
      for (const cat of categories) {
        const setDef = V2_EQUIPMENT_SET_REGISTRY[cat];
        if (setDef) {
          triggers.push(...convertSetTriggers(setDef));
        }
      }
    }

    if (triggers.length > 0) {
      triggersByActor.set(track.id, triggers);
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

  // Pre-resolve talent values per actor: talentId → numeric value for the actor's
  // current talent level. Picks the highest-promotion stage with promotion <= level.
  // Used by `valueRef: "talent_X"` / `multiplierFromTalent: "talent_X"` style refs.
  const talentValueByActor = new Map<string, Map<string, number>>();
  for (const track of activeTracks) {
    const mod = getV2Module(track.id);
    const talentLevels = track.growth?.talentLevels || {};
    if (!mod?.talents) continue;
    const map = new Map<string, number>();
    for (const talent of mod.talents) {
      const level = Number(talentLevels[talent.id]) || 0;
      if (level <= 0 || !Array.isArray(talent.stages)) continue;
      const stage = [...talent.stages].reverse().find((s: any) => Number(s.promotion) <= level);
      if (!stage) continue;
      const value = stage.value ?? stage.damageMultiplier ?? stage.valuePerPoint ?? 0;
      map.set(talent.id, Number(value) || 0);
    }
    talentValueByActor.set(track.id, map);
  }

  const resolveRef = (actorId: string, label: string): number => {
    // Talent refs (e.g. "talent_0", "talent_1") — resolved from character module.
    const talentMap = talentValueByActor.get(actorId);
    if (talentMap?.has(label)) return talentMap.get(label) || 0;

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

  return { builds, skills: allSkills, enemyConfig, config, triggersByActor, attackSegmentMap, executionSkillByActor };
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
  if (mod.gaugeFromSelfOnly) result.gaugeFromSelfOnly = true;
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

function mapActionsToPlacedSkills(
  track: StoreTrack,
  mod: any,
  pendingHeavyInfo?: Map<string, number>,
): { placed: PlacedSkill[]; segMap: Map<string, number> } {
  const { skills, variants } = mod;
  const result: PlacedSkill[] = [];
  const segMap = new Map<string, number>(); // actionInstanceId → recalculated 1-based segment index

  // Sort actions by start time for combo & attack chain detection
  const sorted = [...track.actions].sort((a, b) => a.startTime - b.startTime);

  // Count normal attack segments for combo wrapping
  const normalAttacks = Array.isArray(skills.attack)
    ? skills.attack.filter((s: Skill) => s.type === "attack" && !s.id.includes("execution") && !s.id.includes("aerial"))
    : [];
  const totalSegs = normalAttacks.length;

  // ── Combo tracking: re-evaluate attack segment indices at validation time ──
  let comboIdx = 0;       // next segment to use (0-based)
  let lastAtkEnd = -Infinity;
  let lastDodgeEnd = -Infinity;
  let cumulOtherTime = 0;

  // ── Push rule: track the currently-active (last resolved) skill so we can
  // shift the next action to its end when the incoming can't interrupt it.
  // Matches kernel's canInterrupt semantics (default matrix + per-skill override
  // + 后摇 relaxed rule once past the last-hit offset).
  let runningSkill: Skill | null = null;
  let runningStart = -Infinity;
  let runningEnd = -Infinity;

  for (let i = 0; i < sorted.length; i++) {
    const action = sorted[i];
    if (action.isDisabled) continue;

    // ── 0. Apply push rule based on previously-resolved running skill ──
    let aStart = action.startTime || 0;
    if (runningSkill && aStart < runningEnd) {
      // Incoming category probe: type is sufficient for the matrix lookup
      // (isHeavyAttack only matters for active-side categorization).
      const incoming = { type: action.type, kind: action.kind, id: action._v2SkillId } as any;
      const postLastHit = isPostLastHit(runningSkill, runningStart, aStart);
      if (!canInterrupt(runningSkill, incoming, postLastHit)) {
        aStart = runningEnd;
      }
      // else: incoming interrupts running → aStart stays, kernel will truncate running
    }

    // ── 1. Resolve skill (determines V2 Skill with correct duration) ──
    let skill: Skill | null;
    let segIdx = -1;

    if (action.type === "attack" && action.kind !== "aerial") {
      // Re-evaluate combo segment index using effective start
      const refTime = Math.max(lastAtkEnd, lastDodgeEnd);
      const idleTime = (aStart - refTime) - cumulOtherTime;

      if (comboIdx > 0 && comboIdx < totalSegs && idleTime < 0.5) {
        segIdx = comboIdx;
      } else {
        segIdx = 0;
      }

      skill = resolveSkillForAction(action, skills, track.id, false, segIdx);
    } else {
      const inAttackChain = action.type === "skill" && isInAttackChain(sorted, i);
      skill = resolveSkillForAction(action, skills, track.id, inAttackChain);
    }

    if (!skill) continue;

    // ── 2. Update combo state using V2 Skill's duration ──
    const v2Dur = skill.duration;

    if (action.type === "attack" && action.kind !== "aerial") {
      // pendingHeavy: if the prior pass said this heavy was interrupted BEFORE
      // hit1, the swing didn't land — keep comboIdx at heavy so the next attack
      // is resolved as 重击 again. lastAtkEnd uses the interrupt time so the
      // idle window for the next attack is measured from the aborted end.
      const pendingInterruptT = pendingHeavyInfo?.get(action.instanceId);
      if (pendingInterruptT !== undefined && segIdx === totalSegs - 1) {
        comboIdx = totalSegs - 1;
        lastAtkEnd = pendingInterruptT;
      } else {
        comboIdx = (segIdx >= totalSegs - 1) ? 0 : segIdx + 1;
        lastAtkEnd = aStart + v2Dur;
      }
      cumulOtherTime = 0;
      segMap.set(action.instanceId, segIdx + 1);
    } else if (action.type === "dodge") {
      lastDodgeEnd = aStart + v2Dur;
      cumulOtherTime = 0;
    } else {
      // Skills, ultimate, link, execution (处决), aerial (下落攻击) and all
      // non-combo actions pause the combo timer but neither advance nor
      // reset the combo counter. (Matches the placement-side logic in
      // timelineStore.js.)
      const refTime = Math.max(lastAtkEnd, lastDodgeEnd);
      if (aStart >= refTime) cumulOtherTime += v2Dur;
    }

    // ── 3. Update running skill for push rule ──
    runningSkill = skill;
    runningStart = aStart;
    runningEnd = aStart + v2Dur;

    // ── 4. Emit PlacedSkill with push-adjusted start time ──
    const variantList = variants?.[action.type] || undefined;
    // Pass through triggerData captured by the front-end at trigger time
    // (e.g. POGRANICHNK link: { consumedBreakStacks } set when the slam/armor_break
    // window opened). Kernel reads this during variant selection.
    const triggerData = (action as { triggerData?: Record<string, unknown> }).triggerData;
    result.push({
      actionId: action.instanceId, actorId: track.id, skill, startTime: aStart,
      variants: variantList,
      ...(triggerData ? { triggerData } : {}),
    });
  }

  return { placed: result, segMap };
}

/** Check if a skill action is placed during an attack chain (preceded by an attack segment within combo window). */
function isInAttackChain(sorted: StoreAction[], index: number): boolean {
  const skillStart = sorted[index].startTime || 0;
  for (let j = index - 1; j >= 0; j--) {
    const prev = sorted[j];
    if (prev.isDisabled) continue;
    if (prev.type === "attack") {
      // Attack must end within 0.5s combo window (or overlap with the skill)
      const prevEnd = (prev.startTime || 0) + (Number(prev.duration) || 0);
      return (skillStart - prevEnd) < 0.5;
    }
    // Previous action is something else → not in chain
    return false;
  }
  return false;
}

/**
 * Resolve the V2 Skill object for a store action.
 */
function resolveSkillForAction(action: StoreAction, skills: any, _trackId: string, inAttackChain: boolean = false, overrideSegIdx?: number): Skill | null {
  const actionType = action.type;

  if (actionType === "skill") {
    if (inAttackChain && skills.skillInChain) return skills.skillInChain;
    return skills.skill || null;
  }
  if (actionType === "link") {
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

    // Aerial attack
    if (action.kind === "aerial") {
      return skills.attack.find((s: Skill) => s.id.includes("aerial")) || null;
    }

    // If the action has a v2 skill ID, use it directly
    if (action._v2SkillId) {
      const found = skills.attack.find((s: Skill) => s.id === action._v2SkillId);
      if (found) return found;
    }

    // Only use normal attack segments (filter out execution/aerial)
    const normalAttacks = skills.attack.filter(
      (s: Skill) => s.type === "attack" && !s.id.includes("execution") && !s.id.includes("aerial")
    );

    // Use combo-recalculated index (from mapActionsToPlacedSkills) or fallback to store index
    const segIdx = overrideSegIdx ?? ((action.attackSegmentIndex || action.attackSequenceIndex || 1) - 1);
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
