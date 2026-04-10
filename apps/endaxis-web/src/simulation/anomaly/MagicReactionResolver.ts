/**
 * MagicReactionResolver — resolves what happens when a magic attachment
 * is applied to an enemy.
 *
 * Three cases:
 * 1. No existing attachment → add 1 stack, no extra effect
 * 2. Same element → stack +1, refresh, produce burst damage
 * 3. Different element → clear both, produce anomaly debuff + reaction damage
 */

import type { EnemyStatusState } from "./EnemyStatusState";
import {
  type MagicElement,
  type AnomalyLevel,
  type ResolverOutcome,
  CROSS_ELEMENT_ANOMALY,
  MAGIC_ATTACHMENT_MAX_STACKS,
} from "./types";

export function resolveMagicAttachment(
  status: EnemyStatusState,
  incomingElement: MagicElement,
  sourceActorId: string,
  time: number,
): ResolverOutcome[] {
  const outcomes: ResolverOutcome[] = [];
  const existing = status.getMagicElement();

  if (!existing) {
    // Case 1: no existing attachment
    status.applyMagicAttachment(incomingElement, time);
    outcomes.push({
      type: "ATTACHMENT_CHANGED",
      element: incomingElement,
      stacks: 1,
    });
    return outcomes;
  }

  if (existing === incomingElement) {
    // Case 2: same element → stack; burst only at max stacks (4)
    status.applyMagicAttachment(incomingElement, time);
    const newStacks = status.getMagicStacks();

    if (newStacks >= MAGIC_ATTACHMENT_MAX_STACKS) {
      // Threshold reached → burst damage only, attachment stacks UNCHANGED
      // 法术爆发不清空附着。清空附着的只有物理异常和法术异常。
      outcomes.push({
        type: "ATTACHMENT_CHANGED",
        element: incomingElement,
        stacks: newStacks,
      });
      outcomes.push({
        type: "MAGIC_BURST_DAMAGE",
        element: incomingElement,
        stacks: newStacks,
        sourceActorId,
      });
    } else {
      // Below threshold → just stack, no burst
      outcomes.push({
        type: "ATTACHMENT_CHANGED",
        element: incomingElement,
        stacks: newStacks,
      });
    }
    return outcomes;
  }

  // Case 3: different element → reaction
  const oldStacks = status.getMagicStacks();
  const anomalyLevel = Math.max(1, Math.min(4, oldStacks)) as AnomalyLevel;
  const anomalyType = CROSS_ELEMENT_ANOMALY[incomingElement];

  // Clear both attachments
  status.clearMagicAttachment();
  outcomes.push({ type: "ATTACHMENT_CLEARED" });

  if (anomalyType) {
    // Apply anomaly debuff
    applyAnomalyDebuff(status, anomalyType, anomalyLevel, sourceActorId, time);
    outcomes.push({
      type: "ANOMALY_APPLIED",
      anomalyType,
      level: anomalyLevel,
      sourceActorId,
    });

    // Reaction instant damage
    outcomes.push({
      type: "REACTION_DAMAGE",
      anomalyType,
      level: anomalyLevel,
      sourceActorId,
      incomingElement,
    });
  }

  return outcomes;
}

/**
 * Apply an anomaly debuff to the status state.
 * Shared by MagicReactionResolver and DirectAnomalyApplier.
 */
export function applyAnomalyDebuff(
  status: EnemyStatusState,
  anomalyType: string,
  level: AnomalyLevel,
  sourceActorId: string,
  time: number,
  durationOverride?: number,
): void {
  switch (anomalyType) {
    case "burn":
      status.applyBurn(level, sourceActorId, time, durationOverride);
      break;
    case "freeze":
      status.applyFreeze(level, sourceActorId, time, durationOverride);
      break;
    case "conduction":
      status.applyConduction(level, sourceActorId, time, durationOverride);
      break;
    case "corrosion":
      status.applyCorrosion(level, sourceActorId, time, durationOverride);
      break;
  }
}
