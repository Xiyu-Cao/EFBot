/**
 * V2 Layer 2: Trigger Processor
 *
 * After each hit's effects and damage are resolved, the kernel
 * runs registered triggers. Triggers listen to specific event types
 * and may fire additional effects.
 *
 * Supports:
 * - Immediate triggers: fire right after the event
 * - Deferred triggers: fire after the entire hit completes
 *   (effects + damage + immediate triggers all done)
 * - ICD (internal cooldown) per trigger
 * - Source ownership check (only fire if event source is owner)
 * - Condition evaluation
 */

import type {
  PassiveTrigger,
  TriggerEventType,
  TriggerCondition,
  HitEffect,
  MagicElement,
  AnomalyType,
  ActionType,
} from "./types";

// ═══════════════════════════════════════════════════════════════════
// Trigger event — produced by the kernel during hit processing
// ═══════════════════════════════════════════════════════════════════

/** Context passed to trigger evaluation. */
export interface TriggerEvent {
  type: TriggerEventType;
  time: number;
  sourceActorId: string;
  /** Additional data depending on event type. */
  data: Record<string, unknown>;
}

/** State available for condition evaluation. */
export interface TriggerState {
  enemy: {
    attachmentElement: MagicElement | null;
    attachmentStacks: number;
    breakStacks: number;
    isStaggered: boolean;
    anomalies: Record<AnomalyType, boolean>;
    /** Active buff IDs on enemy (from BuffManager). */
    activeBuffIds: Set<string>;
  };
  actor: {
    stackBuffs: Record<string, number>;
    /** Active buff IDs on any actor (from BuffManager). */
    activeBuffIds: Set<string>;
  };
  /** The event that triggered this evaluation. */
  event: TriggerEvent;
}

// ═══════════════════════════════════════════════════════════════════
// Registered trigger instance
// ═══════════════════════════════════════════════════════════════════

interface RegisteredTrigger {
  ownerId: string;
  trigger: PassiveTrigger;
}

// ═══════════════════════════════════════════════════════════════════
// Trigger Processor
// ═══════════════════════════════════════════════════════════════════

export class TriggerProcessor {
  private triggers: RegisteredTrigger[] = [];
  private cooldowns: Map<string, number> = new Map();
  private deferredQueue: { trigger: RegisteredTrigger; event: TriggerEvent; state: TriggerState }[] = [];

  /**
   * Register a passive trigger for an actor.
   */
  register(ownerId: string, trigger: PassiveTrigger): void {
    this.triggers.push({ ownerId, trigger });
  }

  /**
   * Register multiple triggers for an actor.
   */
  registerAll(ownerId: string, triggers: PassiveTrigger[]): void {
    for (const t of triggers) {
      this.register(ownerId, t);
    }
  }

  /**
   * Process an event — evaluate all matching triggers.
   * Immediate triggers fire now and return their effects.
   * Deferred triggers are queued for later.
   */
  processEvent(event: TriggerEvent, state: TriggerState): HitEffect[] {
    const immediateEffects: HitEffect[] = [];

    for (const reg of this.triggers) {
      if (!this.matches(reg, event, state)) continue;

      if (reg.trigger.deferred) {
        this.deferredQueue.push({ trigger: reg, event, state });
      } else {
        immediateEffects.push(...reg.trigger.actions);
        this.applyCooldown(reg, event.time);
      }
    }

    return immediateEffects;
  }

  /**
   * Flush deferred triggers — call after a hit's full processing completes.
   * Returns all deferred effects that should now execute.
   */
  flushDeferred(): HitEffect[] {
    const effects: HitEffect[] = [];
    for (const { trigger: reg, event } of this.deferredQueue) {
      effects.push(...reg.trigger.actions);
      this.applyCooldown(reg, event.time);
    }
    this.deferredQueue = [];
    return effects;
  }

  /**
   * Check if any deferred triggers are pending.
   */
  hasPendingDeferred(): boolean {
    return this.deferredQueue.length > 0;
  }

  // ── Internal ──

  private matches(reg: RegisteredTrigger, event: TriggerEvent, state: TriggerState): boolean {
    const { trigger } = reg;

    // Event type match
    if (trigger.listenTo !== event.type) return false;

    // Source ownership
    if (trigger.sourceMustBeOwner !== false) {
      if (event.sourceActorId !== reg.ownerId) return false;
    }

    // ICD check
    if (trigger.cooldownId) {
      const key = `${reg.ownerId}::${trigger.cooldownId}`;
      const expiresAt = this.cooldowns.get(key);
      if (expiresAt !== undefined && event.time < expiresAt - 0.0001) {
        return false;
      }
    }

    // Condition check
    if (trigger.condition) {
      if (!this.evalCondition(trigger.condition, state)) return false;
    }

    return true;
  }

  private applyCooldown(reg: RegisteredTrigger, time: number): void {
    const { trigger } = reg;
    if (trigger.cooldownId && trigger.cooldownDuration) {
      const key = `${reg.ownerId}::${trigger.cooldownId}`;
      this.cooldowns.set(key, time + trigger.cooldownDuration);
    }
  }

  private evalCondition(cond: TriggerCondition, state: TriggerState): boolean {
    switch (cond.type) {
      case "enemy_has_attachment": {
        const el = cond.params.element as MagicElement | undefined;
        if (el) return state.enemy.attachmentElement === el;
        return state.enemy.attachmentElement !== null;
      }
      case "enemy_has_anomaly": {
        const at = cond.params.anomalyType as AnomalyType;
        return !!state.enemy.anomalies[at];
      }
      case "enemy_has_break":
        return state.enemy.breakStacks > 0;
      case "enemy_is_staggered":
        return state.enemy.isStaggered;
      case "actor_has_stack_buff": {
        const buffType = cond.params.buffType as string;
        const op = (cond.params.op as string) || ">=";
        const value = (cond.params.value as number) || 0;
        const stacks = state.actor.stackBuffs[buffType] || 0;
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
      case "actor_has_buff": {
        const buffId = cond.params.buffId as string;
        return state.actor.activeBuffIds.has(buffId);
      }
      case "enemy_has_buff": {
        const buffId = cond.params.buffId as string;
        return state.enemy.activeBuffIds.has(buffId);
      }
      case "consumed_buff": {
        const buffId = cond.params.buffId as string;
        return (state.event.data.consumedBuffType as string) === buffId;
      }
      case "consumed_element": {
        const el = cond.params.element as MagicElement;
        return (state.event.data.consumedElement as string) === el;
      }
      case "source_action_type": {
        const at = cond.params.actionType as ActionType;
        return (state.event.data.actionType as string) === at;
      }
      default:
        return false;
    }
  }
}
