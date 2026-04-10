import type { EventHandler } from "@/simulation/events/EventHandler.ts";
import type { EffectEndEvent } from "@/simulation/events/event.types.ts";
import type { SimulationContext } from "@/simulation/engine/SimulationContext.ts";

export class EffectEndHandler implements EventHandler<EffectEndEvent> {
  handle(event: EffectEndEvent, ctx: SimulationContext) {
    const { effectInstanceId } = event.payload;

    // Try removing from enemy first, then from each actor.
    // This supports both boss-targeted and actor-targeted effects.
    let removed = ctx.state.enemy.effects.remove(effectInstanceId);

    if (!removed) {
      // Check actors
      for (const actor of ctx.state.getAllActors()) {
        removed = actor.effects.remove(effectInstanceId);
        if (removed) break;
      }
    }

    if (!removed) {
      // Already removed by a prior event (e.g. consumption)
      return;
    }

    ctx.simLog({
      type: "EFFECT_END",
      time: event.time,
      payload: {
        effectId: removed.effect.id,
        targetId: event.payload.targetId ?? "",
        type: event.payload.type,
      },
    });
  }
}
