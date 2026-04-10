import type { EventHandler } from "@/simulation/events/EventHandler.ts";
import type { DamageTickEvent } from "@/simulation/events/event.types.ts";
import type { SimulationContext } from "@/simulation/engine/SimulationContext.ts";
import { DamageResolver } from "@/simulation/calculation/DamageResolver";
import type { DamageContext, DamageResult } from "@/simulation/calculation/type";
import {
  buildDamageTags,
  actionElementToDamageType,
  actionTypeToDamageSource,
} from "@/simulation/calculation/damageTypes";
import { registerBuiltinBoundEffects } from "./builtinBoundEffects";
import { getSegmentIndex } from "@/simulation/compiler/compileTimeline";

// ---------------------------------------------------------------------------
// Bound-effect registry — maps tag strings to handler functions.
// Pre-damage handlers run BEFORE DamageResolver; post-damage handlers run AFTER.
// ---------------------------------------------------------------------------

export type BoundEffectHandler = (
  e: DamageTickEvent,
  ctx: SimulationContext,
) => void;

/** Pre-damage: applied before DamageResolver.resolve() so the hit benefits from the change. */
export const preDamageRegistry = new Map<string, BoundEffectHandler>();

/** Post-damage: applied after DamageResolver.resolve(); same-frame consumption. */
export const postDamageRegistry = new Map<string, BoundEffectHandler>();

// Register built-in bound effects (consume_conduction, consume_corrosion_apply_vuln)
// via the declarative ops system.
registerBuiltinBoundEffects();

// ---------------------------------------------------------------------------
// Set of ALL known bound-effect tags (union of both registries).
// Used to warn about unrecognised tags during development.
// ---------------------------------------------------------------------------

/** Computed dynamically so externally registered tags are included. */
function isKnownBoundEffectTag(tag: string): boolean {
  return preDamageRegistry.has(tag) || postDamageRegistry.has(tag);
}

// ---------------------------------------------------------------------------
// DamageHandler
// ---------------------------------------------------------------------------

export class DamageHandler implements EventHandler<DamageTickEvent> {
  private resolver = new DamageResolver();

  handle(e: DamageTickEvent, ctx: SimulationContext) {
    if (ctx.blockedActionIds.has(e.payload.actionId)) return;
    const tick = e.payload.tickData;

    // Skip ticks in cancelled segments (dodge interruption)
    const action = ctx.getAction(e.payload.actionId);
    if (action?.isInterrupted && action.cancelledFromSegment !== undefined) {
      const checkpoints = action.node.checkpoints || [];
      const tickSegment = getSegmentIndex(tick.offset, checkpoints);
      if (tickSegment >= action.cancelledFromSegment) return;
    }

    // --- Pre-damage bound effects (must apply BEFORE damage resolution) ---
    if (tick.boundEffects) {
      for (const tag of tick.boundEffects) {
        const handler = preDamageRegistry.get(tag);
        if (handler) handler(e, ctx);
      }
    }

    // --- Damage calculation ---
    let damage = e.payload.damage; // may already be pre-computed

    if (tick.multiplier && tick.multiplier > 0) {
      const actor = ctx.state.getActor(e.payload.sourceId);
      const action = ctx.getAction(e.payload.actionId);

      const actionType = action?.node.type ?? "attack";
      const element = action?.node.element ?? "physical";

      const damageTags = buildDamageTags({
        sourceActorId: e.payload.sourceId,
        targetEnemyId: e.payload.targetId,
        damageType: actionElementToDamageType(element),
        damageSource: actionTypeToDamageSource(actionType),
        sourceSkillId: action?.node.id,
      });

      const damageCtx: DamageContext = {
        source: actor.snapshotData,
        target: ctx.state.enemy,
        state: ctx.state,
        multiplier: tick.multiplier,
        damageTags,
        rng: ctx.rng,
        critMode: ctx.critMode,
      };

      const result: DamageResult = this.resolver.resolve(damageCtx);
      damage = result.finalValue;
      // Expose crit result on the event for downstream triggers (e.g., ROSSI 沸血)
      (e.payload as any)._isCrit = result.isCrit;
    }

    // --- Post-damage bound effects (same frame, after resolution) ---
    if (tick.boundEffects) {
      for (const tag of tick.boundEffects) {
        const handler = postDamageRegistry.get(tag);
        if (handler) handler(e, ctx);

        // Warn about unrecognised bound-effect tags (dev aid; not an error).
        // Tags that are plain effect-binding IDs from the editor (e.g., "dblcris")
        // are expected to be unknown here — the warning helps catch typos in
        // tags that were INTENDED to be handled.
        if (!isKnownBoundEffectTag(tag) && !handler) {
          ctx.diagnostics.warn(
            "UNKNOWN_BOUND_EFFECT",
            `Bound effect tag "${tag}" is not registered in pre/post damage registry`,
            { actionId: e.payload.actionId, effectType: tag },
          );
        }
      }
    }

    ctx.simLog({
      type: "DAMAGE_TICK",
      time: e.time,
      payload: {
        targetId: e.payload.targetId,
        sourceId: e.payload.sourceId,
        damage,
        stagger: tick.stagger,
        tickData: tick,
        actionId: e.payload.actionId,
      },
    });

    if (tick.stagger > 0) {
      ctx.queue.enqueue({
        type: "STAGGER_CHANGE",
        time: ctx.state.getCurrentTime(),
        payload: {
          stagger: tick.stagger,
          actorId: e.payload.sourceId,
          actionId: e.payload.actionId,
          targetId: e.payload.targetId,
        },
      });
    }

    if (tick.sp > 0) {
      ctx.queue.enqueue({
        type: "SP_CHANGE",
        time: ctx.state.getCurrentTime(),
        payload: {
          actorId: e.payload.sourceId,
          spChange: tick.sp,
          reason: "damage",
          sourceId: e.payload.actionId,
          parent: e,
        },
      });
    }
  }
}
