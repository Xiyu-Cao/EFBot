import type { EventHandler } from "@/simulation/events/EventHandler.ts";
import type { SpChangeEvent } from "@/simulation/events/event.types.ts";
import type { SimulationContext } from "@/simulation/engine/SimulationContext.ts";
import {
  computeBaseUltCharge,
  applyUltChargeEfficiency,
} from "@/simulation/calculation/resourceFormulas";

export class SpChangeHandler implements EventHandler<SpChangeEvent> {
  handle(e: SpChangeEvent, ctx: SimulationContext) {
    const { spChange, reason, actorId } = e.payload;

    if (spChange < 0) {
      // --- SP consumption ---
      const result = ctx.state.team.consumeSp(-spChange);

      ctx.simLog({
        type: "SP_CHANGE",
        time: e.time,
        payload: {
          sp: result.totalSP,
          change: spChange,
          sourceId: e.payload.sourceId,
          reason,
          trueSP: ctx.state.team.getTrueSP(),
          refundSP: ctx.state.team.getRefundSP(),
        },
      });

      // Generate ultimate charge from trueSP consumed (skill consumption only)
      if (reason === "skill" && result.trueSPConsumed > 0) {
        const baseCharge = computeBaseUltCharge(result.trueSPConsumed);

        // Apply to all actors with their respective ult_charge_eff
        // GILBERTA 天赋0 (信使的歌声): team ult charge efficiency +4% (P2 upgrade: +7%)
        let gilbertaTalentBonus = 0;
        const gilberta = ctx.state.getAllActors().find(a => a.id === "GILBERTA");
        if (gilberta) {
          const promotion = (gilberta.snapshotData.stats as any)?._promotionStage ?? 1;
          gilbertaTalentBonus = promotion >= 2 ? 7 : 4;
        }

        for (const actor of ctx.state.getAllActors()) {
          let eff = actor.snapshotData.stats.ult_charge_eff ?? 100;
          // GILBERTA 信使的歌声: apply team bonus
          eff += gilbertaTalentBonus;
          // GILBERTA P3 (轻盈脚步): personal ult charge efficiency +5%
          if (actor.id === "GILBERTA") {
            const pLevel = (actor.snapshotData.stats as any)?._potentialLevel ?? 0;
            if (pLevel >= 3) eff += 5;
          }
          const actualCharge = applyUltChargeEfficiency(baseCharge, eff);
          if (actualCharge > 0) {
            actor.modifyGauge(actualCharge);

            ctx.simLog({
              type: "GAUGE_CHANGE",
              time: e.time,
              payload: {
                actorId: actor.id,
                change: actualCharge,
                gauge: actor.getGauge(),
                reason: "sp_consumption",
              },
            });
          }
        }
      }
    } else if (spChange > 0) {
      // --- SP gain ---
      if (reason === "skill") {
        // Skill SP gain = refund SP (返还技力)
        ctx.state.team.addRefundSp(spChange);
      } else {
        // Execution recovery, hit SP, etc. = true SP
        ctx.state.team.addTrueSp(spChange);
      }

      ctx.simLog({
        type: "SP_CHANGE",
        time: e.time,
        payload: {
          sp: ctx.state.team.getSp(),
          change: spChange,
          sourceId: e.payload.sourceId,
          reason,
          trueSP: ctx.state.team.getTrueSP(),
          refundSP: ctx.state.team.getRefundSP(),
        },
      });
    }
  }
}
