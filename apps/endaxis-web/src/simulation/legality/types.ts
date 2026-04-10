/**
 * Legality system types.
 *
 * The legality system validates actions against simulation state
 * (SP, gauge, cooldowns, conditions) using a single validation pipeline.
 * The policy determines how issues are handled:
 *
 * - sandbox: issues recorded, action proceeds (for free-form planning)
 * - audit:   issues recorded, action proceeds (for timeline review / diagnostics)
 * - strict:  error-level issues block the action (for accurate simulation)
 *
 * Future extensions (boss dodge windows, hitstun, debuff conditions)
 * plug into the same issue structure via additional check functions.
 */

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export type LegalityPolicy = "sandbox" | "audit" | "strict";

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

export type LegalitySeverity = "info" | "warning" | "error";

export type LegalityResolution = "allowed" | "warned" | "blocked";

export interface LegalityIssue {
  /** Simulation time when the issue was detected. */
  time: number;
  /** Actor attempting the action. */
  actorId: string;
  /** Action instance ID. */
  actionId: string;
  /** Issue severity — error means the action is fundamentally illegal. */
  severity: LegalitySeverity;
  /** Machine-readable code for grouping / filtering. */
  code: string;
  /** Human-readable description. */
  message: string;
  /** How the policy resolved this issue. */
  resolution: LegalityResolution;
}

// ---------------------------------------------------------------------------
// Issue codes (extensible enum-like constants)
// ---------------------------------------------------------------------------

/** Resource checks */
export const ISSUE_SP_INSUFFICIENT = "SP_INSUFFICIENT";
export const ISSUE_GAUGE_INSUFFICIENT = "GAUGE_INSUFFICIENT";

/** Cooldown checks */
export const ISSUE_COOLDOWN_ACTIVE = "COOLDOWN_ACTIVE";

/** Condition checks (link/skill prerequisites) */
export const ISSUE_CONDITION_NOT_MET = "CONDITION_NOT_MET";

/** Global lock — another actor's action blocks all other actions */
export const ISSUE_GLOBAL_ACTION_LOCK = "GLOBAL_ACTION_LOCK";

/**
 * Reserved for future boss / condition checks:
 * - BOSS_DODGE_WINDOW
 * - HITSTUN_INTERRUPTED
 * - DEBUFF_BLOCKED
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve an issue's resolution based on the active policy.
 */
export function resolveIssue(
  severity: LegalitySeverity,
  policy: LegalityPolicy,
): LegalityResolution {
  if (policy === "strict" && severity === "error") {
    return "blocked";
  }
  if (policy === "audit") {
    return "warned";
  }
  // sandbox: everything allowed
  return "allowed";
}

/**
 * Whether the action should be blocked given the issues and policy.
 */
export function shouldBlockAction(
  issues: LegalityIssue[],
): boolean {
  return issues.some((i) => i.resolution === "blocked");
}
