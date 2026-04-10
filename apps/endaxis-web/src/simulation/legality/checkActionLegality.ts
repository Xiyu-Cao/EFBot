/**
 * Action legality checker — pure function that validates an action
 * against current simulation state.
 *
 * Returns a list of issues (may be empty if action is legal).
 * The caller applies the policy to determine resolution.
 *
 * Designed for extension: add new check functions here for
 * boss dodge windows, hitstun, debuff conditions, etc.
 */

import type { ActionStartEvent } from "../events/event.types";
import type { GameState } from "../state/GameState";
import type {
  LegalityIssue,
  LegalityPolicy,
  LegalitySeverity,
} from "./types";
import {
  ISSUE_SP_INSUFFICIENT,
  ISSUE_GAUGE_INSUFFICIENT,
  ISSUE_COOLDOWN_ACTIVE,
  ISSUE_CONDITION_NOT_MET,
  ISSUE_GLOBAL_ACTION_LOCK,
  resolveIssue,
} from "./types";

/**
 * Check all legality rules for an action about to execute.
 */
export function checkActionLegality(
  event: ActionStartEvent,
  state: GameState,
  policy: LegalityPolicy,
): LegalityIssue[] {
  const issues: LegalityIssue[] = [];
  const { actorId, actionId, type: actionType } = event.payload;
  const time = event.time;

  // --- SP check ---
  const spCost = event.payload.spCost ?? 0;
  if (spCost > 0) {
    const currentSp = state.team.getSp();
    if (currentSp < spCost - 0.01) {
      const severity: LegalitySeverity = "error";
      issues.push({
        time, actorId, actionId, severity,
        code: ISSUE_SP_INSUFFICIENT,
        message: `SP insufficient: need ${spCost}, have ${currentSp.toFixed(1)}`,
        resolution: resolveIssue(severity, policy),
      });
    }
  }

  // --- Gauge check (ultimate) ---
  // Ultimate requires gauge to be full (gauge >= maxGauge).
  // In-game, maxGauge equals the ultimate's energy requirement (gaugeCost).
  // They are the same value; gaugeEfficiency affects gain rate, not the cap.
  if (actionType === "ultimate") {
    try {
      const actor = state.getActor(actorId);
      const currentGauge = actor.getGauge();
      const maxGauge = actor.getMaxGauge();
      if (currentGauge < maxGauge - 0.01) {
        const severity: LegalitySeverity = "error";
        issues.push({
          time, actorId, actionId, severity,
          code: ISSUE_GAUGE_INSUFFICIENT,
          message: `Gauge not full: need ${maxGauge}, have ${currentGauge.toFixed(1)}`,
          resolution: resolveIssue(severity, policy),
        });
      }
    } catch { /* actor not found */ }
  }

  // --- Cooldown check (all action types with cooldown) ---
  try {
    const actor = state.getActor(actorId);
    const skillId = event.payload.skillId;
    if (skillId && actor.isOnCooldown(skillId, time)) {
      const expiresAt = actor.getCooldownExpiry(skillId);
      const remaining = expiresAt ? (expiresAt - time).toFixed(1) : "?";
      const severity: LegalitySeverity = "error";
      issues.push({
        time, actorId, actionId, severity,
        code: ISSUE_COOLDOWN_ACTIVE,
        message: `${actionType} on cooldown: ${remaining}s remaining`,
        resolution: resolveIssue(severity, policy),
      });
    }
  } catch { /* actor not found */ }

  // --- Link/skill condition check (allowedTypes) ---
  const allowedTypes = event.payload.allowedTypes;
  if (allowedTypes && allowedTypes.length > 0) {
    const met = checkConditionsMet(allowedTypes, state, time);
    if (!met) {
      const severity: LegalitySeverity = "error";
      issues.push({
        time, actorId, actionId, severity,
        code: ISSUE_CONDITION_NOT_MET,
        message: `Condition not met: requires [${allowedTypes.join(", ")}]`,
        resolution: resolveIssue(severity, policy),
      });
    }
  }

  // --- Channeling lock check ---
  // GILBERTA skill (秘杖·引力模式): channeled cast locks GILBERTA herself.
  // Other actors can still act normally; only GILBERTA is self-locked.
  if (actorId === "GILBERTA") {
    try {
      const gilberta = state.getActor("GILBERTA");
      const active = gilberta.getActiveAction();
      if (active && active.node.type === "skill" && active.id !== actionId) {
        const severity: LegalitySeverity = "error";
        issues.push({
          time, actorId, actionId, severity,
          code: ISSUE_GLOBAL_ACTION_LOCK,
          message: `Blocked: GILBERTA skill 秘杖·引力模式 is channeling`,
          resolution: resolveIssue(severity, policy),
        });
      }
    } catch { /* */ }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Condition resolution — maps allowedTypes strings to simulation state checks
// ---------------------------------------------------------------------------

/**
 * Check if at least one of the allowedTypes conditions is currently met.
 *
 * allowedTypes uses OR semantics: any single condition being met is sufficient.
 * This matches game behavior where link skills can trigger from multiple
 * different prerequisite states.
 */
export function checkConditionsMet(
  allowedTypes: string[],
  state: GameState,
  time: number,
): boolean {
  const enemy = state.enemy;

  for (const cond of allowedTypes) {
    if (checkSingleCondition(cond, enemy, time)) {
      return true;
    }
  }
  return false;
}

/**
 * Check a single condition string against enemy state.
 *
 * Returns true if the condition is met, false if not.
 * Unknown conditions return true (assumed met) to avoid false-blocking
 * on character-specific conditions not yet mapped.
 */
function checkSingleCondition(
  cond: string,
  enemy: GameState["enemy"],
  time: number,
): boolean {
  // --- Physical effect conditions (check enemy EffectManager tags) ---
  switch (cond) {
    case "knockup":
      return enemy.effects.getByTag("PHYSICAL_LIFT").length > 0;
    case "knockdown":
      return enemy.effects.getByTag("PHYSICAL_KNOCK_DOWN").length > 0;
    case "armor_break":
      return enemy.effects.getByTag("PHYSICAL_BREACH").length > 0;
    case "stagger":
      return enemy.effects.getByTag("PHYSICAL_CRUSH").length > 0;
    case "break":
      return enemy.status.hasBreak();
  }

  // --- Magic attachment conditions ---
  switch (cond) {
    case "cold_attach":
      return enemy.status.getMagicElement() === "cold";
    case "blaze_attach":
      return enemy.status.getMagicElement() === "fire";
    case "emag_attach":
      return enemy.status.getMagicElement() === "electro";
    case "nature_attach":
      return enemy.status.getMagicElement() === "nature";
  }

  // --- Magic burst conditions ---
  // Bursts are instantaneous; checking attachment is the closest proxy.
  // In practice, burst conditions co-occur with same-element attachment.
  switch (cond) {
    case "cold_burst":
      return enemy.status.getMagicElement() === "cold";
    case "blaze_burst":
      return enemy.status.getMagicElement() === "fire";
    case "emag_burst":
      return enemy.status.getMagicElement() === "electro";
    case "nature_burst":
      return enemy.status.getMagicElement() === "nature";
  }

  // --- Anomaly debuff conditions ---
  switch (cond) {
    case "frozen":
    case "ice_shatter":
      return enemy.status.isFrozen(time);
    case "corrosion":
      return enemy.status.corrosion !== null;
    case "burn":
    case "combustion":
      return enemy.status.burn !== null;
    case "conduction":
      return enemy.status.conduction !== null;
  }

  // --- Character-specific conditions ---
  switch (cond) {
    case "antal_buff":
      return enemy.effects.getByEffectId("antal_buff") !== undefined;
    case "endmin_debuff":
      return enemy.effects.getByEffectId("endmin_debuff") !== undefined;
    case "magma_1":
    case "magma_2":
    case "magma_3":
    case "magma_4": {
      const mgr = enemy; // actually need actor effects, but conditions check enemy
      // magma is on actor, not enemy — always return true for now
      return true;
    }
    case "combo":
      // combo is on actor effects — always return true for now
      return true;
  }

  // --- Unknown conditions ---
  // Return true to avoid false-blocking.
  // TODO: map character-specific conditions when data is available.
  return true;
}
