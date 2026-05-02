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

/**
 * A tracked stack buff type — refresh-group semantics.
 *
 * The tracked entity is "one buff with N stacks and one shared expiry":
 *   - 加 stack 时刷新整组到新过期时间，stacks ≤ maxStacks
 *   - 满层再叠仍刷新过期时间（stacks 不变）
 *   - 到期时整组消失（一次 stack_change 从 N → 0）
 *
 * 跟 break / 法术附着 同设计。游戏内每层独立计时的 buff 走 BuffManager 的
 * stackBehavior:"independent"，不应进 StackBuffTracker。
 */
interface StackBuffState {
  stacks: number;
  maxStacks: number;
  /** Group expiry time (null = permanent / no timer). */
  expiresAt: number | null;
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
      this.states.set(buffType, { stacks: 0, maxStacks, expiresAt: null });
    }
  }

  /**
   * Add stacks. Refreshes the group expiry to the new value (or keeps the existing
   * one when expiresAt is null).
   *
   * Returns prev/current counts AND whether the group expiry was refreshed
   * (so the caller can decide whether to emit a stack_change for "satellite"
   * cases like satlayer-at-max where stacks don't change but timer did).
   */
  addStacks(
    buffType: string,
    amount: number,
    expiresAt: number | null = null,
  ): { prev: number; current: number; refreshed: boolean } {
    let state = this.states.get(buffType);
    if (!state) {
      state = { stacks: 0, maxStacks: 4, expiresAt: null };
      this.states.set(buffType, state);
    }

    const prev = state.stacks;
    const prevExpiry = state.expiresAt;
    const toAdd = Math.min(amount, state.maxStacks - state.stacks);
    state.stacks += toAdd;
    // Refresh the group expiry. When caller passes null (permanent), leave
    // existing timer in place — re-applying a "permanent" stack should not
    // wipe the existing timer (no current callsite does this; defensive).
    if (expiresAt !== null) {
      state.expiresAt = expiresAt;
    }
    const refreshed = state.expiresAt !== prevExpiry;
    return { prev, current: state.stacks, refreshed };
  }

  /**
   * Consume all stacks. Returns prev count.
   */
  consumeAll(buffType: string): { prev: number; current: number } {
    const state = this.states.get(buffType);
    if (!state) return { prev: 0, current: 0 };
    const prev = state.stacks;
    state.stacks = 0;
    state.expiresAt = null;
    return { prev, current: 0 };
  }

  /**
   * Consume specific number of stacks. Group expiry preserved unless count → 0.
   */
  consumeStacks(buffType: string, amount: number): { prev: number; current: number } {
    const state = this.states.get(buffType);
    if (!state) return { prev: 0, current: 0 };
    const prev = state.stacks;
    const toRemove = Math.min(amount, state.stacks);
    state.stacks -= toRemove;
    if (state.stacks === 0) state.expiresAt = null;
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
   * Sweep expired groups at the given time. Each expired group emits ONE event
   * with prev=N → current=0 at the group's own expiry time (so bars close at
   * the real time, not at the next action that triggers the sweep).
   */
  sweepExpired(time: number): { buffType: string; prev: number; current: number; expiredAt: number }[] {
    const changes: { buffType: string; prev: number; current: number; expiredAt: number }[] = [];
    for (const [buffType, state] of this.states) {
      if (state.stacks === 0) continue;
      if (state.expiresAt === null) continue;
      if (state.expiresAt > time) continue;
      changes.push({
        buffType,
        prev: state.stacks,
        current: 0,
        expiredAt: state.expiresAt,
      });
      state.stacks = 0;
      state.expiresAt = null;
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
