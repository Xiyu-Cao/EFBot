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
  PassiveTrigger,
} from "./types";
import type { PlacedSkill, EnemyConfig, KernelConfig } from "./kernel";
import type { StatModifier } from "./characterBuild";
import { computeCharacterBuild } from "./characterBuild";
import { V2_READY_IDS, getV2Module } from "./characters/adapter";
import { V2_WEAPON_REGISTRY, convertWeaponTriggers } from "./weapons/definitions";
import { V2_EQUIPMENT_SET_REGISTRY, convertSetTriggers } from "./equipment/definitions";
import { canInterrupt, isPostLastHit } from "./interrupts";
import {
  type CharacterPanel,
  type ResolvedSkills,
  buildCharacterPanel,
  buildEnemyPanel,
  makeLabelResolver,
} from "./panel";
// Re-exports so existing tests targeting these helpers via storeAdapter keep working.
export { collectPotentialCooldownMods, adjustSkillCooldowns } from "./panel";

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
 * Build CharacterPanels for every V2-ready track, including external triggers
 * (character module triggers + weapon tier triggers + equipment set triggers).
 *
 * This function is pure — identical inputs produce identical output. Callers
 * that want automatic caching wrap it in a Vue `computed` (see
 * `timelineStore.js#v2PanelByActor`); panels invalidate when a track's
 * `stats` / `weaponId` / `equip*` / `growth` fields change.
 *
 * Returns null if any active track is not V2-ready or its module isn't loaded.
 */
export function buildAllPanels(
  tracks: StoreTrack[],
  weaponDatabase: StoreWeapon[],
  resolveTrackConfiguredStats: (trackId: string) => Record<string, number> | null,
  resolveGaugeMax: (trackId: string) => number,
  resolveActiveSetCategories?: (trackId: string) => string[],
): CharacterPanel[] | null {
  const activeTracks = tracks.filter(t => t.id && t.actions?.length >= 0);
  if (activeTracks.length === 0) return null;

  for (const t of activeTracks) {
    if (!V2_READY_IDS.has(t.id)) return null;
  }

  const panels: CharacterPanel[] = [];
  for (const track of activeTracks) {
    const mod = getV2Module(track.id);
    if (!mod) return null;

    const panel = buildCharacterPanel(
      track as any,
      mod,
      weaponDatabase,
      (t: any) => collectStatModifiers(t as StoreTrack, resolveTrackConfiguredStats),
      resolveGaugeMax,
    );
    if (!panel) continue;

    // Append triggers that live outside the character module (weapon tiers, equipment sets).
    panel.triggers.push(...(mod.triggers ? [...mod.triggers] : []));
    if (track.weaponId) {
      const weaponDef = V2_WEAPON_REGISTRY[track.weaponId];
      if (weaponDef) {
        const tierIdx = Math.max(0, Math.min(8, (track.weaponBuffTier || 9) - 1));
        panel.triggers.push(...convertWeaponTriggers(weaponDef, tierIdx));
      }
    }
    if (resolveActiveSetCategories) {
      for (const cat of resolveActiveSetCategories(track.id)) {
        const setDef = V2_EQUIPMENT_SET_REGISTRY[cat];
        if (setDef) panel.triggers.push(...convertSetTriggers(setDef));
      }
    }

    panels.push(panel);
  }

  return panels.length > 0 ? panels : null;
}

/**
 * Build V2 kernel inputs from store state.
 *
 * Returns null if any track's character is not V2-ready.
 *
 * When a caller has already built per-track panels (typically via the store's
 * cached `v2PanelByActor` computed) they can pass them through `precomputedPanels`
 * to skip the per-call panel-build pass.
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
  /** Pre-built per-track panels (from store-level cache). Falls back to a fresh
   *  build when omitted. */
  precomputedPanels?: CharacterPanel[],
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

  // ── 1. Use caller-supplied panels when available, otherwise build fresh ──
  const panels: CharacterPanel[] = precomputedPanels
    ? precomputedPanels.filter(p => activeTracks.some(t => t.id === p.actorId))
    : (buildAllPanels(tracks, weaponDatabase, resolveTrackConfiguredStats, resolveGaugeMax, resolveActiveSetCategories) ?? []);

  if (panels.length === 0) return null;

  // ── 2. Derive kernel inputs from panels ──
  const panelByActor = new Map<string, CharacterPanel>();
  for (const p of panels) panelByActor.set(p.actorId, p);

  const builds: CharacterBuild[] = [];
  const allSkills: PlacedSkill[] = [];
  const triggersByActor = new Map<string, PassiveTrigger[]>();
  const attackSegmentMap = new Map<string, number>();
  const executionSkillByActor = new Map<string, Skill>();

  for (const panel of panels) {
    const build = computeCharacterBuild(panel.input);
    if (panel.gaugeFromSelfOnly) build.gaugeFromSelfOnly = true;
    builds.push(build);

    // Find this panel's store track (needed for action list + kind/type fields).
    const track = activeTracks.find(t => t.id === panel.actorId);
    if (!track) continue;

    const { placed, segMap } = mapActionsToPlacedSkills(
      track, panel.resolvedSkills, panel.variants, pendingHeavyInfo,
    );
    allSkills.push(...placed);
    for (const [id, idx] of segMap) attackSegmentMap.set(id, idx);

    if (panel.execSkill) executionSkillByActor.set(panel.actorId, panel.execSkill);
    if (panel.triggers.length > 0) triggersByActor.set(panel.actorId, panel.triggers);
  }

  // ── 3. Build enemy panel + kernel resolver ──
  const enemyPanel = buildEnemyPanel({
    maxStagger: systemConstants.maxStagger,
    staggerNodeCount: systemConstants.staggerNodeCount,
    staggerNodeDuration: systemConstants.staggerNodeDuration,
    staggerBreakDuration: systemConstants.staggerBreakDuration,
  });
  const enemyConfig: EnemyConfig = enemyPanel.config;

  // Per-panel label resolver, dispatched by actor id.
  const resolverByActor = new Map<string, (label: string) => number>();
  for (const panel of panels) resolverByActor.set(panel.actorId, makeLabelResolver(panel));
  const resolveRef = (actorId: string, label: string): number => {
    const fn = resolverByActor.get(actorId);
    return fn ? fn(label) : 0;
  };

  const config: KernelConfig = {
    initialSP: systemConstants.initialSp,
    critMode: "expected",
    resolveRef,
    initialGaugeFull: systemConstants.initialGaugeFull || false,
  };

  // Keep panelByActor accessible via closure if downstream code wants it later.
  void panelByActor;

  return { builds, skills: allSkills, enemyConfig, config, triggersByActor, attackSegmentMap, executionSkillByActor };
}

// ═══════════════════════════════════════════════════════════════════
// Stat modifier collection (from track.stats delta)
// ═══════════════════════════════════════════════════════════════════

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
  skills: ResolvedSkills,
  variants: any,
  pendingHeavyInfo?: Map<string, number>,
): { placed: PlacedSkill[]; segMap: Map<string, number> } {
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


