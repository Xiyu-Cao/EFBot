/**
 * TEMP DEBUG TOOL — NOT IN PRODUCTION FLOW — SAFE TO DELETE AFTER DAMAGE VALIDATION
 *
 * Types for the standalone damage debug calculator.
 */

export interface DamageCalcInput {
  // --- Base panel ---
  baseAttack: number;
  percentAttackBonus: number; // decimal, e.g. 0.15 = 15%
  flatAttackBonus: number;
  primaryAbility: number;
  secondaryAbility: number;

  /** Override: if set, skip ATK formula and use this directly. */
  attackOverride: number | null;

  // --- Hit ---
  skillMultiplier: number; // e.g. 2.03 = 203%
  hitNote: string;
  hitCount: number;

  // --- Crit ---
  isCrit: boolean;
  critRate: number; // percentage, e.g. 25 = 25%
  critDmg: number; // percentage, e.g. 150 = +150% → 2.5x

  // --- Multiplier zones (all final multipliers, no auto +1) ---
  damageBonusZone: number; // default 1
  vulnerabilityZone: number; // default 1
  amplificationZone: number; // default 1
  resistanceZone: number; // default 1
  defenseZone: number; // default 0.5
  breakZone: number; // default 1
  otherZone: number; // default 1
}

export interface DamageCalcBreakdownStep {
  label: string;
  value: number | string;
  formula?: string;
}

export interface DamageCalcResult {
  usedAttack: number;
  baseDamage: number;
  nonCritDamage: number;
  critDamage: number;
  critMultiplier: number;
  expectedDamage: number;
  totalDamage: number; // expected × hitCount
  breakdown: DamageCalcBreakdownStep[];
}

export function createDefaultInput(): DamageCalcInput {
  return {
    baseAttack: 500,
    percentAttackBonus: 0,
    flatAttackBonus: 0,
    primaryAbility: 0,
    secondaryAbility: 0,
    attackOverride: null,
    skillMultiplier: 1.0,
    hitNote: "",
    hitCount: 1,
    isCrit: false,
    critRate: 5,
    critDmg: 50,
    damageBonusZone: 1,
    vulnerabilityZone: 1,
    amplificationZone: 1,
    resistanceZone: 1,
    defenseZone: 0.5,
    breakZone: 1,
    otherZone: 1,
  };
}
