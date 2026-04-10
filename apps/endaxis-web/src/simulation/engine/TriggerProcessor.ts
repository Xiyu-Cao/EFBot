/**
 * TriggerProcessor — evaluates EffectTrigger callbacks after each SimEvent.
 *
 * After the primary handler for an event runs, the engine calls
 * `processor.process(event, ctx)`.  The processor iterates every
 * active effect on every entity (actors + enemy), and for each trigger
 * whose `event` field matches, evaluates:
 *   1. cooldown  — skip if still cooling down
 *   2. sourceMustBeWearer — skip if the event's source is not the owner
 *   3. condition — skip if the user-supplied predicate returns false
 *   4. action    — execute the callback (may enqueue new events)
 *
 * Design constraints:
 *   - Deterministic: effects are iterated in a stable order
 *     (actors by insertion order, effects by instance id)
 *   - Safe against concurrent modification: we snapshot the list of
 *     effect instances before iterating, so triggers that add/remove
 *     effects during the same pass don't cause issues
 *   - Cooldowns are tracked by cooldownId (scoped per entity)
 */

import type { SimEvent, SimEventType } from "../events/event.types";
import type { SimulationContext } from "./SimulationContext";
import type { GameState } from "../state/GameState";
import type { EffectTrigger } from "../effects/types";
import type { EffectInstance } from "../state/EffectManager";
import type { DiagnosticCollector } from "../diagnostics";

interface TriggerOwner {
  ownerId: string;        // actor id, or "boss" for enemy
  ownerType: "actor" | "enemy";
}

interface ActiveTriggerEntry {
  owner: TriggerOwner;
  instance: EffectInstance;
  trigger: EffectTrigger;
}

export class TriggerProcessor {
  /**
   * Cooldown tracking: `${ownerId}::${cooldownId}` → expiry time.
   */
  private cooldowns: Map<string, number> = new Map();

  /**
   * Scoped deferred trigger stack. Each scope corresponds to an event's
   * cascade subtree. Deferred triggers fire after the event and all its
   * children complete, not at frame end.
   *
   * push/pop by SimulationEngine around each event's cascade processing.
   */
  private deferredStack: Array<Array<{ entry: ActiveTriggerEntry; event: SimEvent; ctx: SimulationContext }>> = [];

  constructor(private diagnostics?: DiagnosticCollector) {}

  /**
   * Called by the engine after each event is handled.
   * Evaluates all active triggers that match the event.
   * Deferred triggers are collected into the current scope, not executed immediately.
   */
  process(event: SimEvent, ctx: SimulationContext): void {
    const entries = this.collectActiveTriggers(ctx.state, event.type);

    for (const entry of entries) {
      if (entry.trigger.deferred) {
        if (this.shouldFire(entry, event, ctx)) {
          const scope = this.deferredStack[this.deferredStack.length - 1];
          if (scope) {
            scope.push({ entry, event, ctx });
          }
          // If no scope (shouldn't happen), skip silently
        }
      } else {
        this.evaluateTrigger(entry, event, ctx);
      }
    }
  }

  /** Push a new deferred scope for an event's cascade subtree. */
  pushDeferredScope(): void {
    this.deferredStack.push([]);
  }

  /**
   * Pop the current deferred scope and execute its collected triggers.
   * Called after an event and all its cascading children complete.
   * Returns true if any deferred triggers were executed (caller should check for new events).
   */
  popAndFlushDeferred(): boolean {
    const scope = this.deferredStack.pop();
    if (!scope?.length) return false;

    for (const { entry, event, ctx } of scope) {
      try {
        entry.trigger.action(event, ctx);
      } catch (err) {
        this.diagnostics?.warn(
          "DEFERRED_TRIGGER_ERROR",
          `Deferred trigger action threw for effect "${entry.instance.effect.id}": ${err}`,
          { effectType: entry.instance.effect.id, actorId: entry.owner.ownerId },
        );
      }
      if (entry.trigger.cooldownId && entry.trigger.cooldownDuration) {
        const key = `${entry.owner.ownerId}::${entry.trigger.cooldownId}`;
        this.cooldowns.set(key, ctx.state.getCurrentTime() + entry.trigger.cooldownDuration);
      }
    }
    return true;
  }

  /** Check if a trigger should fire (condition + cooldown), without executing. */
  private shouldFire(entry: ActiveTriggerEntry, event: SimEvent, ctx: SimulationContext): boolean {
    const { owner, trigger } = entry;

    if (trigger.cooldownId) {
      const key = `${owner.ownerId}::${trigger.cooldownId}`;
      const expiresAt = this.cooldowns.get(key);
      if (expiresAt !== undefined && ctx.state.getCurrentTime() < expiresAt - 0.0001) {
        return false;
      }
    }

    if (trigger.sourceMustBeWearer) {
      const eventSourceId = this.extractSourceId(event);
      if (eventSourceId !== owner.ownerId) return false;
    }

    if (trigger.condition) {
      try {
        if (!trigger.condition(event, ctx)) return false;
      } catch {
        return false;
      }
    }

    return true;
  }

  /**
   * Collect all active triggers that listen to the given event type.
   * Returns a snapshot (array copy) for safe iteration.
   */
  /**
   * TODO: If a trigger removes another effect instance that was already
   * collected in `entries`, that instance may still run in this pass.
   * Revisit if cross-trigger removal becomes common.
   */
  private collectActiveTriggers(
    state: GameState,
    eventType: SimEventType,
  ): ActiveTriggerEntry[] {
    const result: ActiveTriggerEntry[] = [];

    // Actors (stable order: Map insertion order)
    for (const actor of state.getAllActors()) {
      const instances = actor.effects.getAll();
      for (const instance of instances) {
        for (const trigger of instance.effect.triggers) {
          if (trigger.event === eventType) {
            result.push({
              owner: { ownerId: actor.id, ownerType: "actor" },
              instance,
              trigger,
            });
          }
        }
      }
    }

    // Enemy
    const enemyInstances = state.enemy.effects.getAll();
    for (const instance of enemyInstances) {
      for (const trigger of instance.effect.triggers) {
        if (trigger.event === eventType) {
          result.push({
            owner: { ownerId: "boss", ownerType: "enemy" },
            instance,
            trigger,
          });
        }
      }
    }

    return result;
  }

  private evaluateTrigger(
    entry: ActiveTriggerEntry,
    event: SimEvent,
    ctx: SimulationContext,
  ): void {
    const { owner, trigger } = entry;

    // 1. Cooldown check
    if (trigger.cooldownId) {
      const key = `${owner.ownerId}::${trigger.cooldownId}`;
      const expiresAt = this.cooldowns.get(key);
      if (expiresAt !== undefined && ctx.state.getCurrentTime() < expiresAt - 0.0001) {
        return; // still on cooldown
      }
    }

    // 2. sourceMustBeWearer check
    if (trigger.sourceMustBeWearer) {
      const eventSourceId = this.extractSourceId(event);
      if (eventSourceId !== owner.ownerId) {
        return;
      }
    }

    // 3. Condition check
    if (trigger.condition) {
      try {
        if (!trigger.condition(event, ctx)) {
          return;
        }
      } catch (err) {
        this.diagnostics?.warn(
          "TRIGGER_CONDITION_ERROR",
          `Trigger condition threw for effect "${entry.instance.effect.id}": ${err}`,
          { effectType: entry.instance.effect.id, actorId: owner.ownerId },
        );
        return;
      }
    }

    // 4. Execute action
    try {
      trigger.action(event, ctx);
    } catch (err) {
      this.diagnostics?.warn(
        "TRIGGER_ACTION_ERROR",
        `Trigger action threw for effect "${entry.instance.effect.id}": ${err}`,
        { effectType: entry.instance.effect.id, actorId: owner.ownerId },
      );
      return;
    }

    // 5. Set cooldown if configured
    if (trigger.cooldownId && trigger.cooldownDuration) {
      const key = `${owner.ownerId}::${trigger.cooldownId}`;
      this.cooldowns.set(key, ctx.state.getCurrentTime() + trigger.cooldownDuration);
    }
  }

  /**
   * Extract the "source actor id" from an event payload.
   * Different event types use different field names.
   */
  private extractSourceId(event: SimEvent): string | undefined {
    const p = event.payload as Record<string, unknown>;
    return (p.actorId ?? p.sourceId ?? p.sourceActorId ?? undefined) as
      | string
      | undefined;
  }
}
