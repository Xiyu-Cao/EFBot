/**
 * DirectAnomalyApplier — applies an anomaly debuff directly, without
 * triggering reaction instant damage.
 *
 * Used for skills / talents that directly inflict freeze, conduction, etc.
 * If the caller also wants to deal damage, it should emit a separate
 * DAMAGE_TICK event.
 */

import type { EnemyStatusState } from "./EnemyStatusState";
import { applyAnomalyDebuff } from "./MagicReactionResolver";
import type { AnomalyDebuffType, AnomalyLevel, ResolverOutcome } from "./types";

export function applyDirectAnomaly(
  status: EnemyStatusState,
  anomalyType: AnomalyDebuffType,
  level: AnomalyLevel,
  sourceActorId: string,
  time: number,
  durationOverride?: number,
): ResolverOutcome[] {
  applyAnomalyDebuff(status, anomalyType, level, sourceActorId, time, durationOverride);

  return [
    {
      type: "ANOMALY_APPLIED",
      anomalyType,
      level,
      sourceActorId,
    },
  ];
}
