/**
 * Anomaly damage formulas — single source of truth.
 *
 * These formulas are shared between the simulation engine and the UI layer.
 * The old `utils/anomalyCalc.js` should import from here to eliminate
 * the dual-truth-source problem.
 *
 * All anomaly/reaction damage still passes through DamageResolver's full
 * multiplier zone pipeline. The functions here compute the "base multiplier"
 * (equivalent to 技能倍率) that feeds into DamageResolver.
 */

import type { AnomalyLevel, PhysicalAnomalyType } from "../anomaly/types";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

export const DEFAULT_CHAR_LEVEL = 90;

// ---------------------------------------------------------------------------
// Level coefficients
// ---------------------------------------------------------------------------

/** Spell (magic) level coefficient: (level - 1) / 196 + 1 */
export function spellLevelCoef(level: number = DEFAULT_CHAR_LEVEL): number {
  return (level - 1) / 196 + 1;
}

/** Physical level coefficient: 1 + (level - 1) / 392 */
export function physLevelCoef(level: number = DEFAULT_CHAR_LEVEL): number {
  return 1 + (level - 1) / 392;
}

// ---------------------------------------------------------------------------
// Arts power multipliers
// ---------------------------------------------------------------------------

/**
 * Anomaly/reaction damage multiplier from 源石技艺强度.
 * Every 1 point of arts power adds 1% damage.
 *
 * This is an independent multiplier zone for anomaly damage.
 * Used by: burst, anomaly trigger, burn tick, shatter, physical anomaly.
 */
export function artsPowerDamageMult(artsPower: number): number {
  return 1 + (Number(artsPower) || 0) * 0.01;
}

/**
 * Debuff scaling multiplier from 源石技艺强度.
 * Formula: 1 + (2 * p) / (300 + p)
 *
 * Used by: conduction vulnerability %, corrosion resist reduction,
 * breach physical vulnerability %.
 */
export function artsPowerDebuffMult(artsPower: number): number {
  const p = Number(artsPower) || 0;
  return p > 0 ? 1 + (p * 2) / (p + 300) : 1;
}

/**
 * Stagger amplification from 源石技艺强度 for knock effects.
 * Every 1 point adds 0.5%.
 */
export function artsPowerStaggerMult(artsPower: number): number {
  return 1 + (Number(artsPower) || 0) * 0.005;
}

// ---------------------------------------------------------------------------
// Magic anomaly multipliers
// ---------------------------------------------------------------------------

/**
 * Spell burst (法术爆发) — same-element attachment trigger.
 *
 * Returns the ATK multiplier (before zone pipeline).
 * Formula: 1.6 * spellLevelCoef(level) * artsPowerDamageMult(artsPower)
 *
 * Note: confirmed that burst DOES benefit from artsPowerDamageMult.
 */
export function getMagicBurstMultiplier(
  artsPower: number,
  level: number = DEFAULT_CHAR_LEVEL,
): number {
  return 1.6 * spellLevelCoef(level) * artsPowerDamageMult(artsPower);
}

/**
 * Spell anomaly trigger (法术异常触发) — cross-element reaction instant damage.
 *
 * All four anomaly types (burn/freeze/conduction/corrosion) use the same formula.
 * Formula: 0.8 * (1 + anomalyLevel) * spellLevelCoef(level) * artsPowerDamageMult(artsPower)
 */
export function getAnomalyDirectMultiplier(
  anomalyLevel: AnomalyLevel,
  artsPower: number,
  level: number = DEFAULT_CHAR_LEVEL,
): number {
  return (
    0.8 *
    (1 + anomalyLevel) *
    spellLevelCoef(level) *
    artsPowerDamageMult(artsPower)
  );
}

/**
 * Burn tick (燃烧 DoT) — fires every second for 10 seconds.
 *
 * Formula: 0.12 * (1 + anomalyLevel) * spellLevelCoef(level) * artsPowerDamageMult(artsPower)
 */
export function getBurnTickMultiplier(
  anomalyLevel: AnomalyLevel,
  artsPower: number,
  level: number = DEFAULT_CHAR_LEVEL,
): number {
  return (
    0.12 *
    (1 + anomalyLevel) *
    spellLevelCoef(level) *
    artsPowerDamageMult(artsPower)
  );
}

/**
 * Ice shatter (碎冰) — freeze consumed by physical anomaly.
 *
 * Formula: 1.2 * (1 + anomalyLevel) * spellLevelCoef(level) * artsPowerDamageMult(artsPower)
 */
export function getShatterMultiplier(
  anomalyLevel: AnomalyLevel,
  artsPower: number,
  level: number = DEFAULT_CHAR_LEVEL,
): number {
  return (
    1.2 *
    (1 + anomalyLevel) *
    spellLevelCoef(level) *
    artsPowerDamageMult(artsPower)
  );
}

// ---------------------------------------------------------------------------
// Physical anomaly multipliers
// ---------------------------------------------------------------------------

/**
 * Launch / Knockdown (击飞 / 倒地).
 *
 * Formula: 1.2 * physLevelCoef(level) * artsPowerDamageMult(artsPower)
 */
export function getLiftKnockdownMultiplier(
  artsPower: number,
  level: number = DEFAULT_CHAR_LEVEL,
): number {
  return 1.2 * physLevelCoef(level) * artsPowerDamageMult(artsPower);
}

/**
 * Slam / Crush (猛击) — consumes all break stacks.
 *
 * Formula: 1.5 * (1 + stacks) * physLevelCoef(level) * artsPowerDamageMult(artsPower)
 */
export function getCrushMultiplier(
  stacks: number,
  artsPower: number,
  level: number = DEFAULT_CHAR_LEVEL,
): number {
  return (
    1.5 * (1 + stacks) * physLevelCoef(level) * artsPowerDamageMult(artsPower)
  );
}

/**
 * Armor Break (碎甲) — consumes break + applies physical vulnerability.
 *
 * Formula: 0.5 * (1 + stacks) * physLevelCoef(level) * artsPowerDamageMult(artsPower)
 */
export function getBreachMultiplier(
  stacks: number,
  artsPower: number,
  level: number = DEFAULT_CHAR_LEVEL,
): number {
  return (
    0.5 * (1 + stacks) * physLevelCoef(level) * artsPowerDamageMult(artsPower)
  );
}

/**
 * Get the physical anomaly damage multiplier by type.
 *
 * Uses the PhysicalReactionResolver's outcome data (physicalType, stacks)
 * plus the source actor's artsPower.
 */
export function getPhysicalAnomalyMultiplier(
  physicalType: PhysicalAnomalyType,
  artsPower: number,
  stacks: number = 0,
  level: number = DEFAULT_CHAR_LEVEL,
): number {
  switch (physicalType) {
    case "launch":
    case "knockdown":
      return getLiftKnockdownMultiplier(artsPower, level);
    case "slam":
      return getCrushMultiplier(stacks, artsPower, level);
    case "armorBreak":
      return getBreachMultiplier(stacks, artsPower, level);
  }
}

// ---------------------------------------------------------------------------
// Debuff value calculators (for conduction / corrosion / breach vuln)
// ---------------------------------------------------------------------------

/**
 * Conduction (导电) vulnerability values.
 *
 * spellVulnerability = (anomalyLevel + 2) * 4 * artsPowerDebuffMult(artsPower)
 * duration = anomalyLevel * 6 + 6
 */
export function calcConductionDebuff(
  anomalyLevel: AnomalyLevel,
  artsPower: number,
): { spellVulnerability: number; duration: number } {
  return {
    spellVulnerability:
      (anomalyLevel + 2) * 4 * artsPowerDebuffMult(artsPower),
    duration: anomalyLevel * 6 + 6,
  };
}

/**
 * Corrosion (腐蚀) resist reduction values.
 *
 * Reduces both physical and magic resistance.
 */
export function calcCorrosionDebuff(
  anomalyLevel: AnomalyLevel,
  artsPower: number,
): {
  immediate: number;
  perSecond: number;
  maxValue: number;
  duration: number;
} {
  const mult = artsPowerDebuffMult(artsPower);
  return {
    immediate: (anomalyLevel * 1.2 + 2.4) * mult,
    perSecond: (anomalyLevel * 0.28 + 0.56) * mult,
    maxValue: (anomalyLevel * 4 + 8) * mult,
    duration: 15,
  };
}

/**
 * Breach (碎甲) physical vulnerability values.
 * Same formula as conduction but uses break stacks as level.
 */
export function calcBreachPhysVulnerability(
  stacks: number,
  artsPower: number,
): { physicalVulnerability: number; duration: number } {
  return {
    physicalVulnerability:
      (stacks + 2) * 4 * artsPowerDebuffMult(artsPower),
    duration: stacks * 6 + 6,
  };
}
