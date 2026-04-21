/**
 * V2 Layer 2: Effect System
 *
 * Manages all buffs, debuffs, stack buffs (special layers),
 * and variant condition evaluation.
 *
 * Design:
 * - BuffManager: tracks active buffs with duration/stacks
 * - StackBuffTracker: tracks special layer buffs (magma, vortex, etc.)
 * - VariantSelector: evaluates conditions at skill cast time
 * - All state changes produce event records for the kernel to emit
 */

import type {
  BuffTarget,
  VariantCondition,
  SkillVariant,
  Skill,
  BuffEvent,
  StackBuffEvent,
  ConditionResultEvent,
} from "./types";
import type { BuffModifiers } from "./damage";

// ═══════════════════════════════════════════════════════════════════
// Buff definition
// ═══════════════════════════════════════════════════════════════════

/** How a buff handles reapplication. */
export type StackBehavior = "refresh" | "independent" | "replace";

/** A buff definition (template). */
export interface BuffDef {
  id: string;
  name: string;
  target: BuffTarget;
  duration: number;           // seconds (0 or Infinity = permanent)
  maxStacks: number;
  stackBehavior: StackBehavior;
  /** Which stat zones this buff modifies. */
  modifiers: BuffModifierDef[];
}

/** A single stat modifier within a buff. */
export interface BuffModifierDef {
  /** Which BuffModifiers field to affect. */
  zone: keyof BuffModifiers;
  /** Modifier value per stack. */
  valuePerStack: number;
}

// ═══════════════════════════════════════════════════════════════════
// Active buff instance
// ═══════════════════════════════════════════════════════════════════

/** A single active buff instance (may be one of multiple stacks). */
export interface ActiveBuff {
  defId: string;
  name: string;
  target: BuffTarget;
  sourceActorId: string;
  /** Time this instance was applied. */
  startTime: number;
  /** When this instance expires (startTime + duration). */
  expiresAt: number;
  /** Modifiers from the buff def. */
  modifiers: BuffModifierDef[];
}

// ═══════════════════════════════════════════════════════════════════
// Buff Manager
// ═══════════════════════════════════════════════════════════════════

/**
 * Manages active buffs on a single target (actor or enemy).
 * Handles stacking, refresh, expiration.
 */
export class BuffManager {
  private buffs: ActiveBuff[] = [];

  /**
   * Apply a buff. Returns events describing what happened.
   */
  apply(
    def: BuffDef,
    sourceActorId: string,
    time: number,
  ): { added: ActiveBuff | null; removed: ActiveBuff[] } {
    const expiresAt = def.duration > 0 ? time + def.duration : Infinity;
    const existing = this.buffs.filter(b => b.defId === def.id);
    const removed: ActiveBuff[] = [];

    if (def.stackBehavior === "replace") {
      // Remove all existing, add new
      for (const b of existing) removed.push(b);
      this.buffs = this.buffs.filter(b => b.defId !== def.id);
    } else if (def.stackBehavior === "refresh") {
      if (existing.length >= def.maxStacks) {
        // At max: refresh all durations, don't add new
        for (const b of existing) {
          b.expiresAt = expiresAt;
          b.startTime = time;
        }
        return { added: null, removed: [] };
      }
      // Under max: refresh existing durations + add new
      for (const b of existing) {
        b.expiresAt = expiresAt;
      }
    } else if (def.stackBehavior === "independent") {
      if (existing.length >= def.maxStacks) {
        // At max: remove oldest, add new
        const oldest = existing.sort((a, b) => a.startTime - b.startTime)[0];
        if (oldest) {
          removed.push(oldest);
          this.buffs = this.buffs.filter(b => b !== oldest);
        }
      }
      // Each stack has independent timer
    }

    const instance: ActiveBuff = {
      defId: def.id,
      name: def.name,
      target: def.target,
      sourceActorId,
      startTime: time,
      expiresAt,
      modifiers: [...def.modifiers],
    };
    this.buffs.push(instance);

    return { added: instance, removed };
  }

  /**
   * Remove all instances of a buff by id.
   * Returns removed instances.
   */
  removeById(defId: string): ActiveBuff[] {
    const removed = this.buffs.filter(b => b.defId === defId);
    this.buffs = this.buffs.filter(b => b.defId !== defId);
    return removed;
  }

  /**
   * Sweep expired buffs at the given time.
   * Returns removed instances.
   */
  sweepExpired(time: number): ActiveBuff[] {
    const expired = this.buffs.filter(b => b.expiresAt <= time);
    this.buffs = this.buffs.filter(b => b.expiresAt > time);
    return expired;
  }

  /**
   * Get all active buffs (not expired).
   */
  getActive(time: number): ActiveBuff[] {
    return this.buffs.filter(b => b.expiresAt > time);
  }

  /**
   * Count active stacks of a buff at a given time.
   */
  getStacks(defId: string, time: number): number {
    return this.buffs.filter(b => b.defId === defId && b.expiresAt > time).length;
  }

  /**
   * Aggregate all active buff modifiers into BuffModifiers.
   * Each active stack contributes its valuePerStack.
   */
  aggregateModifiers(time: number): Partial<BuffModifiers> {
    const result: Record<string, number> = {};
    for (const buff of this.buffs) {
      if (buff.expiresAt <= time) continue;
      for (const mod of buff.modifiers) {
        const key = mod.zone as string;
        result[key] = (result[key] || 0) + mod.valuePerStack;
      }
    }
    return result as Partial<BuffModifiers>;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Stack Buff Tracker (special layers: magma, vortex, etc.)
// ═══════════════════════════════════════════════════════════════════

/** A tracked stack buff type. */
interface StackBuffState {
  stacks: number;
  maxStacks: number;
  /** Per-stack expiry times (for time-limited stacks). null = no expiry. */
  expiryTimes: (number | null)[];
}

/**
 * Tracks special layer buffs per actor.
 * These are distinct from regular buffs — they're special counters
 * (like magma layers) that affect variant selection and skill behavior.
 */
export class StackBuffTracker {
  private states: Map<string, StackBuffState> = new Map();

  /**
   * Register a stack buff type with its max stacks.
   */
  register(buffType: string, maxStacks: number): void {
    if (!this.states.has(buffType)) {
      this.states.set(buffType, { stacks: 0, maxStacks, expiryTimes: [] });
    }
  }

  /**
   * Add stacks. Returns prev and current count.
   */
  addStacks(
    buffType: string,
    amount: number,
    expiresAt: number | null = null,
  ): { prev: number; current: number } {
    let state = this.states.get(buffType);
    if (!state) {
      state = { stacks: 0, maxStacks: 4, expiryTimes: [] };
      this.states.set(buffType, state);
    }

    const prev = state.stacks;
    const toAdd = Math.min(amount, state.maxStacks - state.stacks);
    state.stacks += toAdd;
    for (let i = 0; i < toAdd; i++) {
      state.expiryTimes.push(expiresAt);
    }
    return { prev, current: state.stacks };
  }

  /**
   * Consume all stacks. Returns prev count.
   */
  consumeAll(buffType: string): { prev: number; current: number } {
    const state = this.states.get(buffType);
    if (!state) return { prev: 0, current: 0 };
    const prev = state.stacks;
    state.stacks = 0;
    state.expiryTimes = [];
    return { prev, current: 0 };
  }

  /**
   * Consume specific number of stacks.
   */
  consumeStacks(buffType: string, amount: number): { prev: number; current: number } {
    const state = this.states.get(buffType);
    if (!state) return { prev: 0, current: 0 };
    const prev = state.stacks;
    const toRemove = Math.min(amount, state.stacks);
    state.stacks -= toRemove;
    // Remove oldest stacks
    state.expiryTimes.splice(0, toRemove);
    return { prev, current: state.stacks };
  }

  /**
   * Get current stacks.
   */
  getStacks(buffType: string): number {
    return this.states.get(buffType)?.stacks || 0;
  }

  /**
   * Get all stack counts (for condition evaluation).
   */
  getAllStacks(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [key, state] of this.states) {
      result[key] = state.stacks;
    }
    return result;
  }

  /**
   * Sweep expired stacks at the given time.
   * Returns list of { buffType, prev, current } for changed types.
   */
  sweepExpired(time: number): { buffType: string; prev: number; current: number }[] {
    const changes: { buffType: string; prev: number; current: number }[] = [];
    for (const [buffType, state] of this.states) {
      const prev = state.stacks;
      // Remove expired stacks
      const kept: (number | null)[] = [];
      let removedCount = 0;
      for (const exp of state.expiryTimes) {
        if (exp !== null && exp <= time) {
          removedCount++;
        } else {
          kept.push(exp);
        }
      }
      if (removedCount > 0) {
        state.expiryTimes = kept;
        state.stacks -= removedCount;
        changes.push({ buffType, prev, current: state.stacks });
      }
    }
    return changes;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Variant Selector
// ═══════════════════════════════════════════════════════════════════

/** State available for condition evaluation. */
export interface ConditionState {
  stackBuffs: Record<string, number>;
  ultimateActive: boolean;
  /** Enemy's currently active magic anomalies (by type → active bool). Optional for back-compat. */
  enemyAnomalies?: Partial<Record<import("./types").AnomalyType, boolean>>;
  /** One-shot trigger-time data passed from the placed action (e.g. pogranichnk link: consumedBreakStacks). */
  triggerData?: Record<string, unknown>;
}

/**
 * Evaluate a single variant condition.
 */
function evalCondition(cond: VariantCondition, state: ConditionState): boolean {
  if (cond.type === "stackBuff") {
    const stacks = state.stackBuffs[cond.buffType || ""] ?? 0;
    const op = cond.op || ">=";
    const value = cond.value ?? 0;
    switch (op) {
      case ">=": return stacks >= value;
      case "<=": return stacks <= value;
      case ">":  return stacks > value;
      case "<":  return stacks < value;
      case "==": return stacks === value;
      case "!=": return stacks !== value;
      default: return false;
    }
  }
  if (cond.type === "ultimateActive") {
    return state.ultimateActive;
  }
  if (cond.type === "enemyAnomaly") {
    if (!cond.anomalyType) return false;
    const active = state.enemyAnomalies?.[cond.anomalyType] === true;
    const want = cond.present ?? true;
    return active === want;
  }
  if (cond.type === "triggerData") {
    if (!cond.field) return false;
    const raw = state.triggerData?.[cond.field];
    const value = typeof raw === "number" ? raw : 0;
    const target = cond.value ?? 0;
    const op = cond.op || ">=";
    switch (op) {
      case ">=": return value >= target;
      case "<=": return value <= target;
      case ">":  return value > target;
      case "<":  return value < target;
      case "==": return value === target;
      case "!=": return value !== target;
      default: return false;
    }
  }
  return false;
}

/**
 * Select the highest-priority matching variant for a skill.
 *
 * @param variants - Available variants, will be sorted by priority descending
 * @param state - Current condition state
 * @returns The matched variant, or null if no conditions met
 */
export function selectVariant(
  variants: SkillVariant[],
  state: ConditionState,
): SkillVariant | null {
  if (!variants?.length) return null;

  const sorted = [...variants].sort((a, b) => b.priority - a.priority);
  for (const variant of sorted) {
    if (variant.conditions.every(c => evalCondition(c, state))) {
      return variant;
    }
  }
  return null;
}

/**
 * Apply a variant's overrides to a skill, producing the effective skill.
 */
export function applyVariant(baseSkill: Skill, variant: SkillVariant): Skill {
  return {
    ...baseSkill,
    ...variant.overrides,
    // Preserve id from base, use variant id separately
    id: baseSkill.id,
  };
}
