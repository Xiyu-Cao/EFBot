/**
 * PhysicalReactionResolver — resolves what happens when a physical anomaly
 * is applied to an enemy.
 *
 * Rules:
 * - Any physical anomaly on a target without break → add 1 break stack
 * - If target has break:
 *   - launch / knockdown → physical damage + break +1
 *   - armorBreak → physical damage + clear break + apply physical vuln
 *   - slam → physical damage + clear break
 * - If target is frozen and receives a physical anomaly → ice shatter
 *
 * Control immunities:
 * - Control immunity does NOT prevent damage — only the control state
 * - launch/knockdown immune: damage still produced, but control skipped
 * - Break stacks still accumulate regardless of control immunity
 */

import type { EnemyStatusState } from "./EnemyStatusState";
import type {
  PhysicalAnomalyType,
  ResolverOutcome,
  AnomalyLevel,
} from "./types";
import type { ControlImmunities } from "../state/types";
import { calcBreachPhysVulnerability } from "../calculation/anomalyDamageCalc";

export function resolvePhysicalAnomaly(
  status: EnemyStatusState,
  physicalType: PhysicalAnomalyType,
  sourceActorId: string,
  time: number,
  controlImmunities?: ControlImmunities,
  artsPower: number = 0,
  incomingStacks: number = 1,
): ResolverOutcome[] {
  const outcomes: ResolverOutcome[] = [];

  // Ice shatter check (before break logic)
  // Freeze control immunity does NOT prevent shatter — the debuff is still there
  if (status.isFrozen(time)) {
    const shattered = status.tryShatter(time);
    if (shattered) {
      outcomes.push({
        type: "ICE_SHATTER_DAMAGE",
        level: status.freeze!.level as AnomalyLevel,
        sourceActorId,
      });
    }
  }

  if (!status.hasBreak()) {
    // No break → add N stacks (not affected by control immunity)
    for (let i = 0; i < incomingStacks; i++) {
      status.addBreakStack(time);
    }
    outcomes.push({
      type: "BREAK_CHANGED",
      stacks: status.getBreakStacks(),
    });
    return outcomes;
  }

  // Capture stacks BEFORE any clear — needed for slam/armorBreak damage formula
  const stacksBeforeReaction = status.getBreakStacks();

  // Check if this physical type's control is immune
  const isControlImmune =
    (physicalType === "launch" && controlImmunities?.launch) ||
    (physicalType === "knockdown" && controlImmunities?.knockdown);

  // Has break → reaction based on physical type
  switch (physicalType) {
    case "launch":
    case "knockdown": {
      // Damage always produced regardless of control immunity
      outcomes.push({
        type: "PHYSICAL_DAMAGE",
        physicalType,
        sourceActorId,
        breakStacks: stacksBeforeReaction,
      });

      // Break stacks accumulate regardless of control immunity.
      // TODO: confirm this with in-game testing — if control immune bosses
      // should NOT accumulate break stacks here, gate this behind !isControlImmune.
      for (let i = 0; i < incomingStacks; i++) {
        status.addBreakStack(time);
      }
      outcomes.push({
        type: "BREAK_CHANGED",
        stacks: status.getBreakStacks(),
      });
      break;
    }
    case "armorBreak": {
      // Damage + clear break + apply physical vuln with real value
      outcomes.push({
        type: "PHYSICAL_DAMAGE",
        physicalType,
        sourceActorId,
        breakStacks: stacksBeforeReaction,
      });
      status.clearBreak();
      outcomes.push({ type: "BREAK_CLEARED" });

      // Compute real physical vulnerability from calcBreachPhysVulnerability
      const vuln = calcBreachPhysVulnerability(stacksBeforeReaction, artsPower);
      outcomes.push({
        type: "PHYSICAL_VULN_APPLIED",
        sourceActorId,
        physVulnPercent: vuln.physicalVulnerability,
        vulnDuration: vuln.duration,
      });
      break;
    }
    case "slam": {
      // Damage + clear break
      outcomes.push({
        type: "PHYSICAL_DAMAGE",
        physicalType,
        sourceActorId,
        breakStacks: stacksBeforeReaction,
      });
      status.clearBreak();
      outcomes.push({ type: "BREAK_CLEARED" });
      break;
    }
  }

  return outcomes;
}
