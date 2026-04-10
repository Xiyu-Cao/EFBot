import type { EventHandler } from "@/simulation/events/EventHandler.ts";
import type { SpRegenPauseEvent } from "@/simulation/events/event.types.ts";
import type { SimulationContext } from "@/simulation/engine/SimulationContext.ts";

export class SpRegenPauseHandler implements EventHandler<SpRegenPauseEvent> {
  handle(e: SpRegenPauseEvent, ctx: SimulationContext) {
    ctx.simLog({
      type: "SP_REGEN_PAUSE",
      time: e.time,
      payload: {
        sourceId: e.payload.sourceId,
        duration: e.payload.duration,
        sp: ctx.state.team.getSp(),
      },
    });
    ctx.state.team.pauseSpRegen(e.payload.duration);
  }
}
