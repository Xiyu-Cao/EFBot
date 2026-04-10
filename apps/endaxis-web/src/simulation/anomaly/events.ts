/**
 * New event types for the anomaly subsystem.
 *
 * These are added to the SimEvent union via AnomalyEvent.
 */

import type { MagicElement, PhysicalAnomalyType, AnomalyDebuffType, AnomalyLevel, DamageTags } from "./types";

type AnomalyBaseEvent<Name extends string, Data = {}> = {
  time: number;
  type: Name;
  payload: Data;
};

/** Apply a magic element attachment to the target. */
export type ApplyMagicAttachmentEvent = AnomalyBaseEvent<
  "APPLY_MAGIC_ATTACHMENT",
  {
    element: MagicElement;
    sourceActorId: string;
    targetId: string;
    sourceSkillId?: string;
  }
>;

/** Apply a physical anomaly to the target. */
export type ApplyPhysicalAnomalyEvent = AnomalyBaseEvent<
  "APPLY_PHYSICAL_ANOMALY",
  {
    physicalType: PhysicalAnomalyType;
    sourceActorId: string;
    targetId: string;
    sourceSkillId?: string;
    /** How many break stacks this application adds. Default 1. */
    stacks?: number;
  }
>;

/** Directly apply an anomaly debuff (no reaction damage). */
export type ApplyDirectAnomalyEvent = AnomalyBaseEvent<
  "APPLY_DIRECT_ANOMALY",
  {
    anomalyType: AnomalyDebuffType;
    level: AnomalyLevel;
    sourceActorId: string;
    targetId: string;
    sourceSkillId?: string;
    /** Override default anomaly duration (seconds). If omitted, uses system default by level. */
    durationOverride?: number;
  }
>;

/**
 * Anomaly/reaction/DOT damage event.
 *
 * Emitted by anomaly handlers. The AnomalyDamageHandler will compute
 * actual damage via DamageResolver using the multiplier and tags.
 *
 * For burn ticks, multiplier may be 0 — the handler reads current burn
 * state to determine the real multiplier at processing time.
 */
export type AnomalyDamageEvent = AnomalyBaseEvent<
  "ANOMALY_DAMAGE",
  {
    /** Anomaly-specific damage multiplier (ATK multiplier). */
    multiplier: number;
    /** Full damage classification tags. */
    tags: DamageTags;
  }
>;

export type AnomalyEvent =
  | ApplyMagicAttachmentEvent
  | ApplyPhysicalAnomalyEvent
  | ApplyDirectAnomalyEvent
  | AnomalyDamageEvent;

export type AnomalyEventType = AnomalyEvent["type"];
