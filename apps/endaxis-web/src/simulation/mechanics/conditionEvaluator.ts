/**
 * Condition evaluator for release conditions (variant selection).
 *
 * Pure function — no side effects, no engine state dependency.
 * Ported from store's _evalConditions / _evalOp.
 *
 * Used by ActionStartHandler to select variant at runtime.
 */

import type { ReleaseCondition, ReleaseConditionEntry } from "../compiler/types";

export interface ConditionState {
  /** Current self-buff stacks: { buffPrefix: stackCount } */
  selfBuff: Record<string, number>;
  /** Whether the actor is in ultimate enhancement window */
  ultimateActive: boolean;
}

function evalOp(actual: number, op: string, expected: number): boolean {
  switch (op) {
    case ">=": return actual >= expected;
    case "<=": return actual <= expected;
    case ">":  return actual > expected;
    case "<":  return actual < expected;
    case "==": return actual === expected;
    case "!=": return actual !== expected;
    default:   return false;
  }
}

/** Evaluate a single condition against state. */
function evalCondition(cond: ReleaseCondition, state: ConditionState): boolean {
  if (cond.type === "selfBuff") {
    const stacks = state.selfBuff[cond.key || ""] ?? 0;
    return evalOp(stacks, cond.op || ">=", cond.value ?? 0);
  }
  if (cond.type === "ultimateActive") {
    return state.ultimateActive === true;
  }
  return false;
}

/** Evaluate all conditions in a group (AND logic). */
export function evalConditions(conditions: ReleaseCondition[], state: ConditionState): boolean {
  return conditions.every(c => evalCondition(c, state));
}

/**
 * Select the highest-priority matching variant from release conditions.
 *
 * @param conditions - Release condition entries sorted by priority (highest first)
 * @param state - Current condition state
 * @returns The matching result (variantId + consumeSelfBuffs), or null if no match
 */
export function selectVariant(
  conditions: ReleaseConditionEntry[],
  state: ConditionState,
): ReleaseConditionEntry["result"] | null {
  if (!conditions?.length) return null;

  const sorted = [...conditions].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  for (const entry of sorted) {
    if (evalConditions(entry.conditions, state)) {
      return entry.result;
    }
  }
  return null;
}
