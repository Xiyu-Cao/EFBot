import type { EventHandler } from "@/simulation/events/EventHandler.ts";
import type { ActionEndEvent } from "@/simulation/events/event.types.ts";
import type { SimulationContext } from "@/simulation/engine/SimulationContext.ts";
import { getCooldownReduction } from "@/simulation/data/potentialModifiers.ts";
import { applyUltChargeEfficiency, computeBaseUltCharge } from "@/simulation/calculation/resourceFormulas";
import ultimateCooldowns from "@/data/operators/ultimateCooldowns.json";

export class ActionEndHandler implements EventHandler<ActionEndEvent> {
  handle(e: ActionEndEvent, ctx: SimulationContext) {
    if (ctx.blockedActionIds.has(e.payload.actionId)) return;
    ctx.simLog({
      type: "ACTION_END",
      time: e.time,
      payload: {
        skillId: e.payload.skillId,
        actionId: e.payload.actionId,
        type: e.payload.type,
        spGain: e.payload.spGain,
      },
    });

    // --- Clear active action and set cooldown ---
    const actor = ctx.state.getActor(e.payload.actorId);
    actor.clearActiveAction();

    const action = ctx.getAction(e.payload.actionId);
    // Resolve cooldown: use action.node.cooldown, or for ultimates fall back to data file
    let baseCooldown = action?.node?.cooldown ?? 0;
    if (action && action.node.type === "ultimate" && baseCooldown <= 0) {
      const ultData = (ultimateCooldowns as Record<string, { cooldown: number }>)[e.payload.actorId];
      if (ultData?.cooldown > 0) baseCooldown = ultData.cooldown;
    }
    if (action && baseCooldown > 0) {
      const currentTime = ctx.state.getCurrentTime();
      const pLevel = (actor.snapshotData.stats as any)?._potentialLevel ?? 0;
      const reduction = getCooldownReduction(e.payload.actorId, pLevel, action.node.type);
      const effectiveCd = Math.max(0, baseCooldown - reduction);
      if (effectiveCd > 0) {
        actor.setCooldown(action.node.id, currentTime + effectiveCd);
      }
    }

    // --- SP gain (skipped for interrupted actions — skill didn't fully complete) ---
    if (action?.isInterrupted) return;

    // LASTRITE P5 (寒风再起): skill spGain +5
    let spGain = e.payload.spGain ?? 0;
    if (e.payload.actorId === "LASTRITE" && e.payload.type === "skill") {
      const pLevel = (actor.snapshotData.stats as any)?._potentialLevel ?? 0;
      if (pLevel >= 5) spGain += 5;
    }
    // YVONNE P4 (叛逆心情): skill hit single target → +10 SP refund
    // Current simulation is single-boss only, so always triggers
    if (e.payload.actorId === "YVONNE" && e.payload.type === "skill") {
      const pLevel = (actor.snapshotData.stats as any)?._potentialLevel ?? 0;
      if (pLevel >= 4) spGain += 10;
    }
    if (spGain > 0) {
      ctx.queue.enqueue({
        type: "SP_CHANGE",
        time: ctx.state.getCurrentTime(),
        payload: {
          actorId: e.payload.actorId,
          spChange: spGain,
          reason: "skill",
          sourceId: e.payload.actionId,
          parent: e,
        },
      });
    } else if (e.payload.type === "execution") {
      ctx.queue.enqueue({
        type: "SP_CHANGE",
        time: ctx.state.getCurrentTime(),
        payload: {
          actorId: e.payload.actorId,
          spChange: ctx.state.enemy.config.maxStagger,
          reason: "execution",
          sourceId: e.payload.actionId,
          parent: e,
        },
      });
    }

    // --- Direct gauge gain from action ---
    // SP-based charge is already handled by SpChangeHandler (for ALL actors).
    // Here we only apply the EXCESS gaugeGain beyond what SP consumption provides.
    // Formula: SP consumption gives computeBaseUltCharge(spCost) = spCost * 6.5 / 100
    // So extra = gaugeGain - (spCost * 6.5 / 100)
    // For links (spCost=0): extra = full gaugeGain
    // For normal skills: extra = 0 (SP charge already covers it)
    // For enhanced skill: extra = 100 (the bonus beyond SP charge)
    // teamGaugeGain is NOT applied here — SP charge already distributes to all actors.
    if (action?.isInterrupted) return;
    const gaugeGain = action?.node?.gaugeGain ?? 0;
    const spCost = action?.node?.spCost ?? 0;
    const spBasedCharge = computeBaseUltCharge(spCost);
    const extraGauge = gaugeGain - spBasedCharge;

    if (extraGauge > 0.01) {
      const eff = actor.snapshotData.stats.ult_charge_eff ?? 100;
      const charge = applyUltChargeEfficiency(extraGauge, eff);
      if (charge > 0) {
        actor.modifyGauge(charge);
        ctx.simLog({
          type: "GAUGE_CHANGE",
          time: ctx.state.getCurrentTime(),
          payload: {
            actorId: e.payload.actorId,
            change: charge,
            gauge: actor.getGauge(),
            reason: "action_gauge_gain",
          },
        });
      }
    }
  }
}
