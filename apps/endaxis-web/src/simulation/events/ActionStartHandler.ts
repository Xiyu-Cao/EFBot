import type { EventHandler } from "@/simulation/events/EventHandler.ts";
import type { ActionStartEvent } from "@/simulation/events/event.types.ts";
import type { SimulationContext } from "@/simulation/engine/SimulationContext.ts";
import { checkActionLegality } from "../legality/checkActionLegality";
import { shouldBlockAction } from "../legality/types";
import { selectVariant } from "../mechanics/conditionEvaluator";

// ── TEMPORARY: block overlapping actions on the same track ──
// Remove this flag (and the check below) when the timeline supports
// concurrent same-track actions again.
const BLOCK_SAME_TRACK_OVERLAP = true;

export class ActionStartHandler implements EventHandler<ActionStartEvent> {
  handle(e: ActionStartEvent, ctx: SimulationContext) {
    // --- Temporary: block if actor already has an active action ---
    if (BLOCK_SAME_TRACK_OVERLAP) {
      const actor = ctx.state.getActor(e.payload.actorId);
      const active = actor.getActiveAction();
      if (active && active.id !== e.payload.actionId) {
        ctx.blockedActionIds.add(e.payload.actionId);
        return;
      }
    }

    // --- Legality check ---
    const issues = checkActionLegality(e, ctx.state, ctx.legalityPolicy);

    if (issues.length > 0) {
      // Record all issues
      for (const issue of issues) {
        ctx.legalityIssues.push(issue);
        ctx.simLog({
          type: "LEGALITY_ISSUE",
          time: e.time,
          payload: {
            actorId: issue.actorId,
            actionId: issue.actionId,
            code: issue.code,
            severity: issue.severity,
            message: issue.message,
            resolution: issue.resolution,
          },
        });
      }

      // In strict mode, block the action entirely
      if (shouldBlockAction(issues)) {
        ctx.blockedActionIds.add(e.payload.actionId);
        ctx.diagnostics.warn(
          "ACTION_BLOCKED",
          `Action ${e.payload.skillId} blocked by legality check: ${issues.map((i) => i.code).join(", ")}`,
          { actionId: e.payload.actionId, actorId: e.payload.actorId },
        );
        return; // Skip all execution (no SP cost, no gauge cost, no regen pause)
      }
    }

    // --- Normal execution (sandbox/audit: proceed despite issues) ---
    ctx.simLog({
      type: "ACTION_START",
      time: e.time,
      payload: {
        skillId: e.payload.skillId,
        actionId: e.payload.actionId,
        type: e.payload.type,
        spCost: e.payload.spCost,
      },
    });

    // --- Track active action on the actor ---
    const action = ctx.getAction(e.payload.actionId);
    if (action) {
      const actor = ctx.state.getActor(e.payload.actorId);
      actor.setActiveAction(action);
    }

    const spFreezeDuration = this.getSpFreezeDuration(e);
    if (spFreezeDuration > 0) {
      ctx.queue.enqueue({
        type: "SP_REGEN_PAUSE",
        time: ctx.state.getCurrentTime(),
        payload: {
          sourceId: e.payload.actorId,
          duration: spFreezeDuration,
        },
      });
    }

    if (e.payload.spCost && e.payload.spCost > 0) {
      ctx.queue.enqueue({
        type: "SP_CHANGE",
        time: ctx.state.getCurrentTime(),
        payload: {
          actorId: e.payload.actorId,
          spChange: -e.payload.spCost,
          reason: "skill",
          sourceId: e.payload.actionId,
          parent: e,
        },
      });
    }

    // --- Gauge consumption (ultimate) ---
    if (e.payload.gaugeCost && e.payload.gaugeCost > 0) {
      const actor = ctx.state.getActor(e.payload.actorId);
      actor.modifyGauge(-e.payload.gaugeCost);

      ctx.simLog({
        type: "GAUGE_CHANGE",
        time: e.time,
        payload: {
          actorId: e.payload.actorId,
          change: -e.payload.gaugeCost,
          gauge: actor.getGauge(),
          reason: "ultimate_cast",
        },
      });
    }

    // --- Phase 2: Deferred variant selection + effect enqueue ---
    if (ctx.deferredActions?.has(e.payload.actionId) && ctx.enqueueActionEffects) {
      const deferredAction = ctx.deferredActions.get(e.payload.actionId);
      if (deferredAction) {
        const actionNode = deferredAction.node;
        const conditions = actionNode.releaseConditions;
        if (conditions?.length) {
          // Build condition state from actor's self-buff stacks
          const actor = ctx.state.getActor(e.payload.actorId);
          const selfBuff = actor.getAllSelfBuffStacks();
          // Check if ultimate is active (actor has an active ultimate action)
          const ultimateActive = (() => {
            const active = actor.getActiveAction();
            return active?.node?.type === "ultimate" || (active?.node as any)?.enhancementTime > 0;
          })();

          const result = selectVariant(conditions, { selfBuff, ultimateActive });

          ctx.simLog({
            type: "CONDITION_RESULT",
            time: e.time,
            payload: {
              actorId: e.payload.actorId,
              actionId: e.payload.actionId,
              variantId: result?.variantId ?? null,
              consumedBuffs: result?.consumeSelfBuffs,
            },
          });

          // Consume self-buffs if required by the selected variant
          if (result?.consumeSelfBuffs?.length) {
            for (const consume of result.consumeSelfBuffs) {
              const { prev, current } = actor.consumeSelfBuff(consume.key);
              if (prev > 0) {
                ctx.simLog({
                  type: "SELF_BUFF_CHANGE",
                  time: e.time,
                  payload: {
                    actorId: e.payload.actorId,
                    buffType: consume.key,
                    stacks: current,
                    prevStacks: prev,
                    reason: "condition_consumed",
                  },
                });
              }
            }
          }

          if (result?.variantId) {
            // Find the variant and swap action data
            const variantSuffix = result.variantId.replace(`${e.payload.actorId}_variant_`, "");
            const variant = actionNode.variants?.find((v: any) => v.id === variantSuffix);
            if (variant) {
              // Apply variant overrides to the deferred action
              if (variant.damageTicks) deferredAction.resolvedDamageTicks = variant.damageTicks.map((t: any, i: number) => ({
                ...t,
                realTime: deferredAction.realStartTime + (t.offset || 0),
                realOffset: t.offset || 0,
                time: deferredAction.realStartTime + (t.offset || 0),
              }));
              if (variant.physicalAnomaly) {
                // Recompile effects from variant's physicalAnomaly
                deferredAction.effects = []; // Clear, will be rebuilt by enqueue
              }
              if (variant.duration !== undefined) deferredAction.realDuration = variant.duration;
              if (variant.gaugeGain !== undefined) deferredAction.node = { ...deferredAction.node, gaugeGain: variant.gaugeGain };
              if (variant.spCost !== undefined) deferredAction.node = { ...deferredAction.node, spCost: variant.spCost };
            }
          }
        }

        // Enqueue effects and damage ticks (with variant data if selected)
        ctx.enqueueActionEffects(deferredAction);
        ctx.deferredActions.delete(e.payload.actionId);
      }
    }
  }

  private getSpFreezeDuration(e: ActionStartEvent) {
    if (e.payload.type === "skill") {
      return 0.5;
    }
    if (e.payload.type === "ultimate" || e.payload.type === "link") {
      return e.payload.freezeDuration ?? 1.5;
    }
    return 0;
  }
}
