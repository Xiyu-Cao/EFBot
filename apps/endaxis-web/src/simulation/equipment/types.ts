/**
 * Equipment framework — types and helpers for equipment/set/weapon passives.
 *
 * Conventions:
 * - Equipment effects use the existing Effect + EffectTrigger system
 * - Equipment passives are registered via engine.registerPassiveEffect()
 * - Dynamic stat buffs are stored in Effect.properties.dynamicBonuses
 * - multiplierZones aggregates dynamicBonuses at damage time
 * - ICD uses TriggerProcessor's built-in cooldown (cooldownId + cooldownDuration)
 * - Target selection (self/team/others) is handled in trigger action code
 */

import { Effect } from "../effects/types";
import type { EffectManager, EffectInstance } from "../state/EffectManager";
import type { GameState } from "../state/GameState";
import type { DamageTags } from "../calculation/damageTypes";

// ---------------------------------------------------------------------------
// Dynamic bonus — stored in Effect.properties.dynamicBonuses
// ---------------------------------------------------------------------------

/**
 * Stat keys that can be used in dynamic bonuses.
 * Maps 1:1 with the evaluateDynamicBonus switch cases.
 */
export type DynamicBonusStat =
  // Elemental
  | "blaze_dmg"    // → burn damage type
  | "cold_dmg"     // → cold damage type
  | "emag_dmg"     // → electro damage type
  | "nature_dmg"   // → nature damage type
  // School
  | "physical_dmg" // → physical school
  | "arts_dmg"     // → magic school
  // Source-specific
  | "attack_dmg_bonus"   // → normal/heavy attack
  | "skill_dmg_bonus"    // → active skill
  | "link_dmg_bonus"     // → combo skill
  | "ultimate_dmg_bonus" // → ultimate skill
  // Broad
  | "all_skill_dmg_bonus" // → all skill-based damage
  | "all_dmg"             // → all damage ("造成的伤害增加")
  // Crit
  | "crit_rate"           // → crit rate bonus (percentage points)
  | "crit_dmg";           // → crit damage bonus (percentage points)

/**
 * Which multiplier zone this bonus belongs to.
 * - "damageBonus" (default) → 增伤区
 * - "amplify" → 增幅区
 * - "combo" → 连击区
 * - "vulnerability" → 易伤区
 * - "fragility" → 脆弱区
 * - "attackPercent" → attack formula percentBonus
 * - "attackFlat" → attack formula flatBonus
 */
export type DynamicBonusZone =
  | "damageBonus"
  | "amplify"
  | "combo"
  | "vulnerability"
  | "fragility"
  | "resistance"
  | "attackPercent"
  | "attackFlat"
  | "crit";

/**
 * A dynamic stat bonus contributed by an equipment buff effect.
 * Stored in Effect.properties.dynamicBonuses, aggregated by multiplierZones
 * at damage time.
 *
 * `zone` determines which multiplier zone the bonus feeds into.
 * If omitted, defaults to "damageBonus" (增伤区).
 */
export interface DynamicBonus {
  stat: DynamicBonusStat;
  value: number;
  /** Which zone this bonus belongs to. Default: "damageBonus". */
  zone?: DynamicBonusZone;
}

/**
 * Evaluate a dynamic bonus against damage tags.
 * Returns the bonus value if it applies, 0 otherwise.
 */
export function evaluateDynamicBonus(
  db: DynamicBonus,
  tags: DamageTags,
): number {
  switch (db.stat) {
    // Elemental bonuses
    case "blaze_dmg":
      return tags.damageType === "burn" ? db.value : 0;
    case "cold_dmg":
      return tags.damageType === "cold" ? db.value : 0;
    case "emag_dmg":
      return tags.damageType === "electro" ? db.value : 0;
    case "nature_dmg":
      return tags.damageType === "nature" ? db.value : 0;

    // School bonuses
    case "physical_dmg":
      return tags.damageSchool === "physical" ? db.value : 0;
    case "arts_dmg":
      return tags.damageSchool === "magic" ? db.value : 0;

    // Source-specific bonuses
    case "attack_dmg_bonus":
      return tags.countsAsNormalAttackDamage ? db.value : 0;
    case "skill_dmg_bonus":
      return tags.countsAsActiveSkillDamage ? db.value : 0;
    case "link_dmg_bonus":
      return tags.countsAsComboSkillDamage ? db.value : 0;
    case "ultimate_dmg_bonus":
      return tags.countsAsUltimateSkillDamage ? db.value : 0;

    // Broad bonuses
    case "all_skill_dmg_bonus": {
      const isSkill =
        tags.countsAsNormalAttackDamage ||
        tags.countsAsActiveSkillDamage ||
        tags.countsAsComboSkillDamage ||
        tags.countsAsUltimateSkillDamage;
      return isSkill ? db.value : 0;
    }
    case "all_dmg":
      return db.value; // applies to everything

    // Crit bonuses — always apply (no tag filtering)
    case "crit_rate":
    case "crit_dmg":
      return db.value;

    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Buff helpers
// ---------------------------------------------------------------------------

/**
 * Add or refresh a buff on an EffectManager.
 * If a buff with the same id already exists, refreshes its duration.
 * Otherwise adds a new instance. Used for "no-stack, refresh duration" buffs.
 */
export function addOrRefreshBuff(
  effects: EffectManager,
  effect: Effect,
): EffectInstance {
  const existing = effects.getByEffectId(effect.id);

  if (existing) {
    // Refresh duration
    existing.effect.startTime = effect.startTime;
    existing.effect.duration = effect.duration;
    // Update properties (in case dynamic values changed)
    existing.effect.properties = effect.properties;
    return existing;
  }

  return effects.add(effect);
}

/**
 * Add a stack with independent duration tracking.
 * Used for buffs like 典范 where each stack has its own expiry.
 *
 * Implementation: each stack is a separate Effect instance with a
 * shared `stackGroup` in properties. When maxStacks is reached,
 * the oldest stack (by startTime) is removed.
 */
export function addStackWithIndependentDuration(
  effects: EffectManager,
  effect: Effect,
  groupId: string,
  maxStacks: number,
  currentTime?: number,
): EffectInstance {
  // Collect existing stacks in this group
  const existing = effects
    .getAll()
    .filter((inst) => inst.effect.properties.stackGroup === groupId);

  // Evict expired stacks first (if currentTime provided)
  if (currentTime !== undefined) {
    for (const inst of existing) {
      if (!isEffectActive(inst.effect, currentTime)) {
        effects.remove(inst.id);
      }
    }
    // Re-collect after eviction
    const live = effects
      .getAll()
      .filter((inst) => inst.effect.properties.stackGroup === groupId);

    if (live.length >= maxStacks) {
      live.sort((a, b) => a.effect.startTime - b.effect.startTime);
      effects.remove(live[0].id);
    }
  } else {
    // No time info — just evict oldest if at cap
    if (existing.length >= maxStacks) {
      existing.sort((a, b) => a.effect.startTime - b.effect.startTime);
      effects.remove(existing[0].id);
    }
  }

  return effects.add(effect);
}

/**
 * Add an independent-duration stack but REFRESH all existing stacks' startTime.
 *
 * Use for stacking buffs where new stack addition resets the timer for ALL stacks
 * (e.g., DAPAN 勾芡, CHENQIANYU slash_edge, AKEKURI positive_feedback).
 *
 * Contrast with addStackWithIndependentDuration where each stack has its own timer.
 */
export function addStackWithRefreshDuration(
  effects: EffectManager,
  effect: Effect,
  groupId: string,
  maxStacks: number,
  currentTime: number,
): EffectInstance {
  // Evict expired stacks
  const existing = effects
    .getAll()
    .filter((inst) => inst.effect.properties.stackGroup === groupId);

  for (const inst of existing) {
    if (!isEffectActive(inst.effect, currentTime)) {
      effects.remove(inst.id);
    }
  }

  // Re-collect live stacks
  const live = effects
    .getAll()
    .filter((inst) => inst.effect.properties.stackGroup === groupId);

  // Evict oldest if at cap
  if (live.length >= maxStacks) {
    live.sort((a, b) => a.effect.startTime - b.effect.startTime);
    effects.remove(live[0].id);
  }

  // Refresh all surviving stacks' startTime to current time
  const survivors = effects
    .getAll()
    .filter((inst) => inst.effect.properties.stackGroup === groupId);
  for (const inst of survivors) {
    inst.effect.startTime = currentTime;
  }

  return effects.add(effect);
}

/**
 * Check if an effect is active at the given time.
 * Active window: [startTime, startTime + duration).
 */
export function isEffectActive(effect: Effect, currentTime: number): boolean {
  if (effect.duration === Infinity) return true;
  return currentTime >= effect.startTime && currentTime < effect.startTime + effect.duration;
}

/**
 * Aggregate dynamic bonuses from actor effects for the DamageBonus zone.
 * Only includes bonuses with zone = "damageBonus" or zone unspecified (default).
 */
export function aggregateDynamicBonuses(
  state: GameState,
  sourceActorId: string,
  tags: DamageTags,
): number {
  let total = 0;
  const currentTime = state.getCurrentTime();

  let actorState: ReturnType<GameState["getActor"]>;
  try {
    actorState = state.getActor(sourceActorId);
  } catch {
    return 0;
  }

  for (const instance of actorState.effects.getAll()) {
    const eff = instance.effect;
    if (!isEffectActive(eff, currentTime)) continue;

    const dynBonuses = eff.properties.dynamicBonuses as
      | DynamicBonus[]
      | undefined;
    if (!dynBonuses) continue;

    for (const db of dynBonuses) {
      // Only include damageBonus zone (default when zone is unspecified)
      if (db.zone && db.zone !== "damageBonus") continue;
      total += evaluateDynamicBonus(db, tags);
    }
  }

  return total;
}

/**
 * Aggregate dynamic bonuses from actor effects for a specific zone.
 *
 * Used by amplify, combo, vulnerability, fragility zones.
 * For fragility, pass tags to enable school/element matching.
 */
export function aggregateZoneBonuses(
  state: GameState,
  sourceActorId: string,
  zone: DynamicBonusZone,
  tags?: DamageTags,
): number {
  let total = 0;
  const currentTime = state.getCurrentTime();

  let actorState: ReturnType<GameState["getActor"]>;
  try {
    actorState = state.getActor(sourceActorId);
  } catch {
    return 0;
  }

  for (const instance of actorState.effects.getAll()) {
    const eff = instance.effect;
    if (!isEffectActive(eff, currentTime)) continue;

    const dynBonuses = eff.properties.dynamicBonuses as
      | DynamicBonus[]
      | undefined;
    if (!dynBonuses) continue;

    for (const db of dynBonuses) {
      if (db.zone !== zone) continue;

      // For fragility: check school/element match via evaluateDynamicBonus
      if (zone === "fragility" && tags) {
        total += evaluateDynamicBonus(db, tags);
      } else {
        // For amplify/combo/vulnerability: just add the raw value
        total += db.value;
      }
    }
  }

  return total;
}

/**
 * Aggregate dynamic bonuses from enemy effects for a specific zone (target-side).
 *
 * Mirrors aggregateZoneBonuses but reads from state.enemy.effects instead of actor.effects.
 * Used by vulnerability and fragility zones to pick up debuffs placed on the enemy.
 */
export function aggregateEnemyZoneBonuses(
  state: GameState,
  zone: DynamicBonusZone,
  tags?: DamageTags,
): number {
  let total = 0;
  const currentTime = state.getCurrentTime();

  for (const instance of state.enemy.effects.getAll()) {
    const eff = instance.effect;
    if (!isEffectActive(eff, currentTime)) continue;

    const dynBonuses = eff.properties.dynamicBonuses as
      | DynamicBonus[]
      | undefined;
    if (!dynBonuses) continue;

    for (const db of dynBonuses) {
      if (db.zone !== zone) continue;

      if (zone === "fragility" && tags) {
        total += evaluateDynamicBonus(db, tags);
      } else {
        total += db.value;
      }
    }
  }

  return total;
}

/**
 * Aggregate attack bonuses (percentBonus/flatBonus) from actor effects.
 * Returns { percentBonus, flatBonus } to feed into attackFormula.
 */
export function aggregateAttackBonuses(
  state: GameState,
  sourceActorId: string,
): { percentBonus: number; flatBonus: number } {
  let percentBonus = 0;
  let flatBonus = 0;
  const currentTime = state.getCurrentTime();

  let actorState: ReturnType<GameState["getActor"]>;
  try {
    actorState = state.getActor(sourceActorId);
  } catch {
    return { percentBonus: 0, flatBonus: 0 };
  }

  for (const instance of actorState.effects.getAll()) {
    const eff = instance.effect;
    if (!isEffectActive(eff, currentTime)) continue;

    const dynBonuses = eff.properties.dynamicBonuses as
      | DynamicBonus[]
      | undefined;
    if (!dynBonuses) continue;

    for (const db of dynBonuses) {
      if (db.zone === "attackPercent") {
        percentBonus += db.value / 100; // convert from % to decimal
      } else if (db.zone === "attackFlat") {
        flatBonus += db.value;
      }
    }
  }

  return { percentBonus, flatBonus };
}

/**
 * Aggregate crit bonuses (crit_rate / crit_dmg) from actor effects.
 * Returns bonus percentage points to add on top of base stats.
 */
export function aggregateCritBonuses(
  state: GameState,
  sourceActorId: string,
): { critRateBonus: number; critDmgBonus: number } {
  let critRateBonus = 0;
  let critDmgBonus = 0;
  const currentTime = state.getCurrentTime();

  let actorState: ReturnType<GameState["getActor"]>;
  try {
    actorState = state.getActor(sourceActorId);
  } catch {
    return { critRateBonus: 0, critDmgBonus: 0 };
  }

  for (const instance of actorState.effects.getAll()) {
    const eff = instance.effect;
    if (!isEffectActive(eff, currentTime)) continue;

    const dynBonuses = eff.properties.dynamicBonuses as
      | DynamicBonus[]
      | undefined;
    if (!dynBonuses) continue;

    for (const db of dynBonuses) {
      if (db.zone !== "crit") continue;
      if (db.stat === "crit_rate") critRateBonus += db.value;
      else if (db.stat === "crit_dmg") critDmgBonus += db.value;
    }
  }

  return { critRateBonus, critDmgBonus };
}

// ---------------------------------------------------------------------------
// Target selection helpers
// ---------------------------------------------------------------------------

export type BuffTarget = "self" | "team" | "otherTeammates";

/**
 * Apply a buff to the selected targets.
 */
export function applyBuffToTargets(
  state: GameState,
  sourceActorId: string,
  target: BuffTarget,
  createBuff: () => Effect,
): void {
  const actors =
    target === "self"
      ? [state.getActor(sourceActorId)]
      : state.getAllActors().filter((a) => {
          if (target === "otherTeammates") return a.id !== sourceActorId;
          return true; // "team" includes everyone
        });

  for (const actor of actors) {
    addOrRefreshBuff(actor.effects, createBuff());
  }
}
