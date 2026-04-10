/**
 * Event handlers for the anomaly subsystem.
 *
 * Each handler delegates to the corresponding resolver, then translates
 * ResolverOutcome[] into sim-log entries, ANOMALY_DAMAGE events, and
 * (for burn) scheduled tick events.
 *
 * The AnomalyDamageHandler routes all anomaly damage through DamageResolver
 * for real damage computation.
 */

import type { EventHandler } from "../events/EventHandler";
import type { SimulationContext } from "../engine/SimulationContext";
import type {
  ApplyMagicAttachmentEvent,
  ApplyPhysicalAnomalyEvent,
  ApplyDirectAnomalyEvent,
  AnomalyDamageEvent,
} from "./events";
import { resolveMagicAttachment } from "./MagicReactionResolver";
import { Effect } from "../effects/types";
import { resolvePhysicalAnomaly } from "./PhysicalReactionResolver";
import { applyDirectAnomaly } from "./DirectAnomalyApplier";
import { BURN_DURATION, type ResolverOutcome } from "./types";
import {
  buildDamageTags,
  magicElementToDamageType,
} from "../calculation/damageTypes";
import type { DamageTags } from "../calculation/damageTypes";
import {
  getMagicBurstMultiplier,
  getAnomalyDirectMultiplier,
  getPhysicalAnomalyMultiplier,
  getShatterMultiplier,
  getBurnTickMultiplier,
} from "../calculation/anomalyDamageCalc";
import type { AnomalyLevel } from "./types";
import { DamageResolver } from "../calculation/DamageResolver";
import type { DamageContext } from "../calculation/type";
import { NO_CRIT } from "../calculation/critSystem";
import { addOrRefreshBuff } from "../equipment/types";

// -- Helpers --

function getEnemyStatus(ctx: SimulationContext) {
  return ctx.state.enemy.status;
}

/** Safely read artsPower from actor stats. Returns 0 if actor not found. */
function getArtsPower(ctx: SimulationContext, actorId: string): number {
  try {
    return ctx.state.getActor(actorId).snapshotData.stats.originium_arts_power || 0;
  } catch {
    return 0;
  }
}

function emitOutcomes(
  outcomes: ResolverOutcome[],
  ctx: SimulationContext,
  time: number,
): void {
  for (const o of outcomes) {
    switch (o.type) {
      case "MAGIC_BURST_DAMAGE": {
        const artsPower = getArtsPower(ctx, o.sourceActorId);
        const tags = buildDamageTags({
          sourceActorId: o.sourceActorId,
          targetEnemyId: "boss",
          damageType: magicElementToDamageType(o.element),
          damageSource: "magicAttachmentBurst",
        });
        ctx.queue.enqueue({
          type: "ANOMALY_DAMAGE",
          time,
          payload: {
            multiplier: getMagicBurstMultiplier(artsPower),
            tags,
          },
        });
        break;
      }

      case "REACTION_DAMAGE": {
        const artsPower = getArtsPower(ctx, o.sourceActorId);
        const multiplier = getAnomalyDirectMultiplier(
          o.level,
          artsPower,
        );
        if (multiplier <= 0) break;
        const tags = buildDamageTags({
          sourceActorId: o.sourceActorId,
          targetEnemyId: "boss",
          damageType: magicElementToDamageType(o.incomingElement),
          damageSource: "magicAnomalyDirect",
        });
        ctx.queue.enqueue({
          type: "ANOMALY_DAMAGE",
          time,
          payload: { multiplier, tags },
        });
        break;
      }

      case "PHYSICAL_DAMAGE": {
        const artsPower = getArtsPower(ctx, o.sourceActorId);
        // Use stacks captured before the resolver cleared them
        const breakStacks = o.breakStacks;
        const tags = buildDamageTags({
          sourceActorId: o.sourceActorId,
          targetEnemyId: "boss",
          damageType: "physical",
          damageSource: "physicalAnomaly",
        });
        ctx.queue.enqueue({
          type: "ANOMALY_DAMAGE",
          time,
          payload: {
            multiplier: getPhysicalAnomalyMultiplier(
              o.physicalType,
              artsPower,
              breakStacks,
            ),
            tags,
          },
        });
        break;
      }

      case "ICE_SHATTER_DAMAGE": {
        const artsPower = getArtsPower(ctx, o.sourceActorId);
        const tags = buildDamageTags({
          sourceActorId: o.sourceActorId,
          targetEnemyId: "boss",
          damageType: "physical",
          damageSource: "shatter",
          canCrit: true,
        });
        ctx.queue.enqueue({
          type: "ANOMALY_DAMAGE",
          time,
          payload: {
            multiplier: getShatterMultiplier(o.level, artsPower),
            tags,
          },
        });
        ctx.simLog({
          type: "ANOMALY_STATUS_CHANGE",
          time,
          payload: {
            description: `碎冰 (ice shatter) by ${o.sourceActorId}, level ${o.level}`,
            type: "ice_shatter",
            sourceId: o.sourceActorId,
            level: o.level,
          },
        });
        break;
      }

      case "ANOMALY_APPLIED":
        ctx.simLog({
          type: "ANOMALY_STATUS_CHANGE",
          time,
          payload: {
            description: `${o.anomalyType} applied (level ${o.level})`,
            anomalyType: o.anomalyType,
            level: o.level,
            sourceActorId: o.sourceActorId,
          },
        });

        // Schedule burn tick events
        if (o.anomalyType === "burn") {
          const burnTags = buildDamageTags({
            sourceActorId: o.sourceActorId,
            targetEnemyId: "boss",
            damageType: "burn",
            damageSource: "burnTick",
          });
          for (let i = 1; i <= BURN_DURATION; i++) {
            ctx.queue.enqueue({
              type: "ANOMALY_DAMAGE",
              time: time + i,
              payload: {
                // multiplier = 0 means "determine at processing time from current burn state"
                multiplier: 0,
                tags: burnTags,
              },
            });
          }
        }
        break;

      case "ATTACHMENT_CHANGED":
        ctx.simLog({
          type: "ANOMALY_STATUS_CHANGE",
          time,
          payload: {
            description: `${o.element} attachment ${o.stacks} stacks`,
            element: o.element,
            stacks: o.stacks,
          },
        });
        break;

      case "ATTACHMENT_CLEARED":
        ctx.simLog({
          type: "ANOMALY_STATUS_CHANGE",
          time,
          payload: { description: "magic attachment cleared" },
        });
        break;

      case "BREAK_CHANGED":
        ctx.simLog({
          type: "ANOMALY_STATUS_CHANGE",
          time,
          payload: {
            description: `break ${o.stacks} stacks`,
            stacks: o.stacks,
          },
        });
        break;

      case "BREAK_CLEARED":
        ctx.simLog({
          type: "ANOMALY_STATUS_CHANGE",
          time,
          payload: { description: "break cleared" },
        });
        break;

      case "PHYSICAL_VULN_APPLIED": {
        // Apply effect with real vulnerability value to enemy EffectManager.
        // Uses addOrRefreshBuff to overwrite existing vuln (same as conduction overwrite).
        const vulnEffect = new Effect({
          id: "PHYSICAL_VULNERABLE",
          tags: ["PHYSICAL_VULNERABLE"],
          name: "Physical Vulnerability",
          duration: o.vulnDuration,
          startTime: time,
          properties: {
            physVulnPercent: o.physVulnPercent,
            sourceActorId: o.sourceActorId,
          },
        });
        addOrRefreshBuff(ctx.state.enemy.effects, vulnEffect);

        ctx.simLog({
          type: "ANOMALY_STATUS_CHANGE",
          time,
          payload: {
            description: `physical vulnerability applied (${o.physVulnPercent.toFixed(1)}%, ${o.vulnDuration}s)`,
            sourceActorId: o.sourceActorId,
            physVulnPercent: o.physVulnPercent,
            vulnDuration: o.vulnDuration,
          },
        });
        break;
      }
    }
  }
}

// -- Handlers --

export class ApplyMagicAttachmentHandler
  implements EventHandler<ApplyMagicAttachmentEvent>
{
  handle(e: ApplyMagicAttachmentEvent, ctx: SimulationContext): void {
    const status = getEnemyStatus(ctx);
    const outcomes = resolveMagicAttachment(
      status,
      e.payload.element,
      e.payload.sourceActorId,
      e.time,
    );
    emitOutcomes(outcomes, ctx, e.time);
  }
}

export class ApplyPhysicalAnomalyHandler
  implements EventHandler<ApplyPhysicalAnomalyEvent>
{
  handle(e: ApplyPhysicalAnomalyEvent, ctx: SimulationContext): void {
    const status = getEnemyStatus(ctx);
    const artsPower = getArtsPower(ctx, e.payload.sourceActorId);
    const outcomes = resolvePhysicalAnomaly(
      status,
      e.payload.physicalType,
      e.payload.sourceActorId,
      e.time,
      ctx.state.enemy.config.controlImmunities,
      artsPower,
      e.payload.stacks || 1,
    );
    emitOutcomes(outcomes, ctx, e.time);
  }
}

export class ApplyDirectAnomalyHandler
  implements EventHandler<ApplyDirectAnomalyEvent>
{
  handle(e: ApplyDirectAnomalyEvent, ctx: SimulationContext): void {
    const status = getEnemyStatus(ctx);
    const outcomes = applyDirectAnomaly(
      status,
      e.payload.anomalyType,
      e.payload.level,
      e.payload.sourceActorId,
      e.time,
      e.payload.durationOverride,
    );
    emitOutcomes(outcomes, ctx, e.time);
  }
}

/**
 * AnomalyDamageHandler — routes all anomaly damage through DamageResolver.
 *
 * For burn ticks: reads current burn state at processing time (real-time),
 * uses advanceBurn() for natural deduplication of scheduled tick events.
 *
 * For other anomaly damage: uses the multiplier from the event.
 */
export class AnomalyDamageHandler
  implements EventHandler<AnomalyDamageEvent>
{
  private resolver = new DamageResolver();

  handle(e: AnomalyDamageEvent, ctx: SimulationContext): void {
    const tags = e.payload.tags;
    const status = ctx.state.enemy.status;

    let multiplier = e.payload.multiplier;
    let sourceActorId = tags.sourceActorId;

    // -- Burn tick special handling --
    if (tags.damageSource === "burnTick") {
      const burnInfo = status.burn
        ? { level: status.burn.level, sourceActorId: status.burn.sourceActorId }
        : null;

      const ticks = status.advanceBurn(e.time);
      if (ticks <= 0 || !burnInfo) return;

      const artsPower = getArtsPower(ctx, burnInfo.sourceActorId);
      multiplier = getBurnTickMultiplier(
        burnInfo.level as AnomalyLevel,
        artsPower,
      );
      sourceActorId = burnInfo.sourceActorId;
    }

    if (multiplier <= 0) return;

    let actor;
    try {
      actor = ctx.state.getActor(sourceActorId);
    } catch {
      ctx.diagnostics.warn(`AnomalyDamage: actor ${sourceActorId} not found`);
      return;
    }

    const resolvedTags: DamageTags = { ...tags, sourceActorId };

    const damageCtx: DamageContext = {
      source: actor.snapshotData,
      target: ctx.state.enemy,
      state: ctx.state,
      multiplier,
      damageTags: resolvedTags,
      critOverride: resolvedTags.canCrit ? undefined : NO_CRIT,
      rng: ctx.rng,
      critMode: ctx.critMode,
    };

    const result = this.resolver.resolve(damageCtx);

    ctx.simLog({
      type: "ANOMALY_DAMAGE",
      time: e.time,
      payload: {
        damage: result.finalValue,
        tags: resolvedTags,
      },
    });
  }
}
