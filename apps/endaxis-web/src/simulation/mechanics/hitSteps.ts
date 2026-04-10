/**
 * Hit step execution mechanism.
 *
 * A hit can consist of multiple ordered steps. The ORDER is determined
 * by the skill description, not a global rule:
 *
 * - "施加自然附着并造成伤害" → [applyAttachment, dealDamage]
 * - "造成伤害后添加法术脆弱" → [dealDamage, applyDebuff]
 * - "消耗附着并施加异常后获得资源" → [consumeAttachment, applyAnomaly, gainResource]
 *
 * The mechanism works by enqueuing events in the specified order at the
 * same timestamp. The PriorityQueue processes same-time events in FIFO
 * (enqueue order), so handlers see state changes from earlier steps.
 *
 * Backward compatibility: actions without explicit step definitions
 * use the default order (damage first, then anomaly effects).
 */

import type { SimulationContext } from "../engine/SimulationContext";
import type { SimEvent } from "../events/event.types";
import type {
  MagicElement,
  PhysicalAnomalyType,
  AnomalyDebuffType,
  AnomalyLevel,
} from "../anomaly/types";

// ---------------------------------------------------------------------------
// Step types
// ---------------------------------------------------------------------------

export type HitStepType =
  | "applyMagicAttachment"
  | "applyPhysicalAnomaly"
  | "applyDirectAnomaly"
  | "dealDamage"
  | "applyDebuff"
  | "applyBuff"
  | "consumeAttachment"
  | "gainResource";

/** Base fields for all steps. */
interface HitStepBase {
  type: HitStepType;
}

export interface ApplyMagicAttachmentStep extends HitStepBase {
  type: "applyMagicAttachment";
  element: MagicElement;
  sourceActorId: string;
  targetId: string;
  sourceSkillId?: string;
}

export interface ApplyPhysicalAnomalyStep extends HitStepBase {
  type: "applyPhysicalAnomaly";
  physicalType: PhysicalAnomalyType;
  sourceActorId: string;
  targetId: string;
  sourceSkillId?: string;
}

export interface ApplyDirectAnomalyStep extends HitStepBase {
  type: "applyDirectAnomaly";
  anomalyType: AnomalyDebuffType;
  level: AnomalyLevel;
  sourceActorId: string;
  targetId: string;
  sourceSkillId?: string;
}

export interface DealDamageStep extends HitStepBase {
  type: "dealDamage";
  /** The pre-built damage event to enqueue. */
  event: SimEvent;
}

export interface ApplyDebuffStep extends HitStepBase {
  type: "applyDebuff";
  /** The pre-built effect event to enqueue. */
  event: SimEvent;
}

export interface ApplyBuffStep extends HitStepBase {
  type: "applyBuff";
  /** The pre-built effect event to enqueue. */
  event: SimEvent;
}

export interface ConsumeAttachmentStep extends HitStepBase {
  type: "consumeAttachment";
  targetId: string;
}

export interface GainResourceStep extends HitStepBase {
  type: "gainResource";
  /** The pre-built resource event to enqueue. */
  event: SimEvent;
}

export type HitStep =
  | ApplyMagicAttachmentStep
  | ApplyPhysicalAnomalyStep
  | ApplyDirectAnomalyStep
  | DealDamageStep
  | ApplyDebuffStep
  | ApplyBuffStep
  | ConsumeAttachmentStep
  | GainResourceStep;

// ---------------------------------------------------------------------------
// Hit definition
// ---------------------------------------------------------------------------

export interface HitDefinition {
  /** Ordered steps to execute for this hit. */
  steps: HitStep[];
}

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

/**
 * Execute a hit's steps in order at the given time.
 *
 * Each step is converted to an event and enqueued. Because the PriorityQueue
 * processes same-time events in FIFO order, the execution order matches
 * the step order.
 */
export function executeHitSteps(
  hit: HitDefinition,
  time: number,
  ctx: SimulationContext,
): void {
  for (const step of hit.steps) {
    executeStep(step, time, ctx);
  }
}

function executeStep(
  step: HitStep,
  time: number,
  ctx: SimulationContext,
): void {
  switch (step.type) {
    case "applyMagicAttachment":
      ctx.queue.enqueue({
        type: "APPLY_MAGIC_ATTACHMENT",
        time,
        payload: {
          element: step.element,
          sourceActorId: step.sourceActorId,
          targetId: step.targetId,
          sourceSkillId: step.sourceSkillId,
        },
      });
      break;

    case "applyPhysicalAnomaly":
      ctx.queue.enqueue({
        type: "APPLY_PHYSICAL_ANOMALY",
        time,
        payload: {
          physicalType: step.physicalType,
          sourceActorId: step.sourceActorId,
          targetId: step.targetId,
          sourceSkillId: step.sourceSkillId,
        },
      });
      break;

    case "applyDirectAnomaly":
      ctx.queue.enqueue({
        type: "APPLY_DIRECT_ANOMALY",
        time,
        payload: {
          anomalyType: step.anomalyType,
          level: step.level,
          sourceActorId: step.sourceActorId,
          targetId: step.targetId,
          sourceSkillId: step.sourceSkillId,
        },
      });
      break;

    case "dealDamage":
    case "applyDebuff":
    case "applyBuff":
    case "gainResource":
      // These carry pre-built events; just enqueue at the right time
      ctx.queue.enqueue({ ...step.event, time });
      break;

    case "consumeAttachment":
      // Direct state mutation — consumes the current magic attachment
      ctx.state.enemy.status.clearMagicAttachment();
      ctx.simLog({
        type: "ANOMALY_STATUS_CHANGE",
        time,
        payload: { description: "magic attachment consumed" },
      });
      break;
  }
}

// ---------------------------------------------------------------------------
// Default step builder (backward compatibility)
// ---------------------------------------------------------------------------

/**
 * Build a default hit definition from legacy action data.
 *
 * Default order: damage events first, then anomaly/effect events.
 * This preserves backward compatibility for actions that don't specify
 * explicit step ordering.
 */
export function buildDefaultHitDefinition(params: {
  damageEvents?: SimEvent[];
  anomalyEvents?: SimEvent[];
}): HitDefinition {
  const steps: HitStep[] = [];

  if (params.damageEvents) {
    for (const event of params.damageEvents) {
      steps.push({ type: "dealDamage", event });
    }
  }

  if (params.anomalyEvents) {
    for (const event of params.anomalyEvents) {
      switch (event.type) {
        case "APPLY_MAGIC_ATTACHMENT":
          steps.push({
            type: "applyMagicAttachment",
            element: (event.payload as any).element,
            sourceActorId: (event.payload as any).sourceActorId,
            targetId: (event.payload as any).targetId,
            sourceSkillId: (event.payload as any).sourceSkillId,
          });
          break;
        case "APPLY_PHYSICAL_ANOMALY":
          steps.push({
            type: "applyPhysicalAnomaly",
            physicalType: (event.payload as any).physicalType,
            sourceActorId: (event.payload as any).sourceActorId,
            targetId: (event.payload as any).targetId,
          });
          break;
        case "APPLY_DIRECT_ANOMALY":
          steps.push({
            type: "applyDirectAnomaly",
            anomalyType: (event.payload as any).anomalyType,
            level: (event.payload as any).level,
            sourceActorId: (event.payload as any).sourceActorId,
            targetId: (event.payload as any).targetId,
          });
          break;
        default:
          steps.push({ type: "applyDebuff", event });
      }
    }
  }

  return { steps };
}
