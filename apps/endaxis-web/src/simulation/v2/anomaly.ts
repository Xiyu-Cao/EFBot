/**
 * V2 Layer 2: Anomaly System
 *
 * Handles magic attachment, reactions, physical anomalies, break,
 * stagger, and anomaly damage formulas.
 *
 * All functions are pure — they return outcomes, not mutate state.
 * The kernel processes outcomes and updates state.
 *
 * Formulas from: reports/kernel-mechanics-audit-2026-04-09.md §3
 */

import type { MagicElement, AnomalyType, PhysicalAnomalyType } from "./types";

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

export const ATTACHMENT_MAX_STACKS = 4;
export const ATTACHMENT_DURATION = 30;   // seconds
export const BREAK_MAX_STACKS = 4;
export const BREAK_DURATION = 30;        // seconds

/** Bonus stagger applied by launch/knockdown, scaled by artsPowerStaggerMult. */
export const LAUNCH_KNOCKDOWN_BONUS_STAGGER = 10;

/** Cross-element reaction: incoming element → anomaly type. */
export const CROSS_ELEMENT_ANOMALY: Record<MagicElement, AnomalyType> = {
  fire: "burning",
  cold: "frozen",
  electro: "conduction",
  nature: "corrosion",
};

/** Default anomaly durations by type (seconds). */
export const ANOMALY_DURATIONS: Record<AnomalyType, number | ((level: number) => number)> = {
  burning: 10,
  frozen: (level) => 5 + level,   // 6/7/8/9s for level 1-4
  conduction: (level) => level * 6 + 6, // 12/18/24/30s
  corrosion: 15,
};

/** Get anomaly duration for a given type and level. */
export function getAnomalyDuration(type: AnomalyType, level: number): number {
  const d = ANOMALY_DURATIONS[type];
  return typeof d === "function" ? d(level) : d;
}

// ═══════════════════════════════════════════════════════════════════
// Anomaly damage formulas
// ═══════════════════════════════════════════════════════════════════

/** Spell level coefficient. */
export function spellLevelCoef(level: number): number {
  return 1 + (level - 1) / 196;
}

/** Physical level coefficient. */
export function physLevelCoef(level: number): number {
  return 1 + (level - 1) / 392;
}

/** Arts power → damage multiplier (every 1 point = +1%). */
export function artsPowerDamageMult(artsPower: number): number {
  return 1 + artsPower * 0.01;
}

/** Arts power → debuff value multiplier. */
export function artsPowerDebuffMult(artsPower: number): number {
  return 1 + (2 * artsPower) / (300 + artsPower);
}

/**
 * Arts power → stagger multiplier for launch/knockdown bonus stagger only.
 * Every 2 points of artsPower = +1% (i.e., +0.1 stagger on the base 10).
 * Does NOT affect skill hit stagger values.
 */
export function artsPowerStaggerMult(artsPower: number): number {
  return 1 + artsPower * 0.005;
}

// ── Specific anomaly damage multipliers ──

/** Magic burst (法术爆发) damage multiplier. */
export function magicBurstMult(level: number, artsPower: number): number {
  return 1.6 * spellLevelCoef(level) * artsPowerDamageMult(artsPower);
}

/** Spell anomaly trigger (法术异常触发) damage multiplier. */
export function spellAnomalyTriggerMult(level: number, artsPower: number): number {
  return 0.8 * (1 + level) * spellLevelCoef(level) * artsPowerDamageMult(artsPower);
}

/** Burning DoT per tick (every 1s for 10s). */
export function burningTickMult(level: number, artsPower: number): number {
  return 0.12 * (1 + level) * spellLevelCoef(level) * artsPowerDamageMult(artsPower);
}

/** Ice shatter (碎冰) damage multiplier. */
export function iceShatterMult(level: number, artsPower: number): number {
  return 1.2 * (1 + level) * spellLevelCoef(level) * artsPowerDamageMult(artsPower);
}

/** Launch/knockdown (击飞/倒地) damage multiplier. */
export function launchKnockdownMult(level: number, artsPower: number): number {
  return 1.2 * physLevelCoef(level) * artsPowerDamageMult(artsPower);
}

/** Slam (猛击) damage multiplier. stacks = break stacks consumed. */
export function slamMult(stacks: number, level: number, artsPower: number): number {
  return 1.5 * (1 + stacks) * physLevelCoef(level) * artsPowerDamageMult(artsPower);
}

/** Armor break (碎甲) damage multiplier. stacks = break stacks consumed. */
export function armorBreakMult(stacks: number, level: number, artsPower: number): number {
  return 0.5 * (1 + stacks) * physLevelCoef(level) * artsPowerDamageMult(artsPower);
}

// ── Debuff value formulas ──

/** Conduction spell vulnerability (%). */
export function conductionVulnerability(level: number, artsPower: number): number {
  return (level + 2) * 4 * artsPowerDebuffMult(artsPower);
}

/** Armor break → physical vulnerability (%). */
export function armorBreakVulnerability(stacks: number, artsPower: number): number {
  return (stacks + 2) * 4 * artsPowerDebuffMult(artsPower);
}

/** Armor break → physical vulnerability duration (seconds). */
export function armorBreakVulnDuration(stacks: number): number {
  return stacks * 6 + 6;
}

/** Corrosion resist reduction values. */
export function corrosionParams(level: number, artsPower: number): {
  immediate: number;
  perSecond: number;
  maxValue: number;
  duration: number;
} {
  const mult = artsPowerDebuffMult(artsPower);
  return {
    immediate: (level * 1.2 + 2.4) * mult,
    perSecond: (level * 0.28 + 0.56) * mult,
    maxValue: (level * 4 + 8) * mult,
    duration: 15,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Magic attachment outcomes
// ═══════════════════════════════════════════════════════════════════

export type AttachmentOutcome =
  | { type: "stacked"; element: MagicElement; newStacks: number }
  | { type: "burst"; element: MagicElement; stacks: number }
  | { type: "reaction"; consumed: MagicElement; consumedStacks: number; anomaly: AnomalyType; anomalyLevel: number };

/**
 * Resolve magic attachment application.
 * Returns outcomes (may be multiple: stack + burst).
 */
export function resolveMagicAttachment(
  incoming: MagicElement,
  existing: MagicElement | null,
  existingStacks: number,
): AttachmentOutcome[] {
  const outcomes: AttachmentOutcome[] = [];

  // Case 1: No existing attachment
  if (!existing) {
    outcomes.push({ type: "stacked", element: incoming, newStacks: 1 });
    return outcomes;
  }

  // Case 2: Same element → stack
  if (existing === incoming) {
    const newStacks = Math.min(ATTACHMENT_MAX_STACKS, existingStacks + 1);
    outcomes.push({ type: "stacked", element: incoming, newStacks });
    // Every same-element application triggers burst
    outcomes.push({ type: "burst", element: incoming, stacks: newStacks });
    return outcomes;
  }

  // Case 3: Different element → reaction
  const anomalyLevel = existingStacks; // level = consumed stacks
  const anomaly = CROSS_ELEMENT_ANOMALY[incoming];
  outcomes.push({
    type: "reaction",
    consumed: existing,
    consumedStacks: existingStacks,
    anomaly,
    anomalyLevel,
  });

  return outcomes;
}

// ═══════════════════════════════════════════════════════════════════
// Physical anomaly outcomes
// ═══════════════════════════════════════════════════════════════════

export type PhysicalAnomalyOutcome =
  | { type: "break_applied"; newStacks: number }
  | { type: "launch"; breakStacksBefore: number }
  | { type: "knockdown"; breakStacksBefore: number }
  | { type: "slam"; breakStacksConsumed: number }
  | { type: "armorBreak"; breakStacksConsumed: number };

/**
 * Resolve physical anomaly application.
 *
 * Rule: if no break stacks exist, any physical anomaly
 * instead applies 1 break stack.
 */
export function resolvePhysicalAnomaly(
  physicalType: PhysicalAnomalyType,
  currentBreakStacks: number,
): PhysicalAnomalyOutcome {
  // No break → apply 1 break stack instead
  if (currentBreakStacks <= 0) {
    return { type: "break_applied", newStacks: 1 };
  }

  switch (physicalType) {
    case "launch":
      return { type: "launch", breakStacksBefore: currentBreakStacks };
    case "knockdown":
      return { type: "knockdown", breakStacksBefore: currentBreakStacks };
    case "slam":
      return { type: "slam", breakStacksConsumed: currentBreakStacks };
    case "armorBreak":
      return { type: "armorBreak", breakStacksConsumed: currentBreakStacks };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Stagger outcomes
// ═══════════════════════════════════════════════════════════════════

export interface StaggerOutcome {
  newTotal: number;
  nodeReached: boolean;
  nodeIndex?: number;
  isFullStagger: boolean;
}

/**
 * Resolve stagger value addition.
 */
export function resolveStagger(
  amount: number,
  currentTotal: number,
  maxStagger: number,
  nodeThresholds: number[], // ascending thresholds
): StaggerOutcome {
  const newTotal = Math.min(maxStagger, currentTotal + amount);

  // Check nodes
  let nodeReached = false;
  let nodeIndex: number | undefined;
  for (let i = 0; i < nodeThresholds.length; i++) {
    if (currentTotal < nodeThresholds[i] && newTotal >= nodeThresholds[i]) {
      nodeReached = true;
      nodeIndex = i;
      // Don't break — report the highest node reached
    }
  }

  const isFullStagger = currentTotal < maxStagger && newTotal >= maxStagger;

  return { newTotal, nodeReached, nodeIndex, isFullStagger };
}
