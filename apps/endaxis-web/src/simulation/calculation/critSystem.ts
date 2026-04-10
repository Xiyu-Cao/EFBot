/**
 * Critical hit system v1.
 *
 * Base crit rate: 5%
 * Base crit damage: 50% (total multiplier on crit = 1.5)
 *
 * CritScope:
 * - "shared": one roll per skill instance / hit group (default)
 * - "perHit": each hit rolls independently
 *
 * Rules:
 * - Burn DoT cannot crit (canCrit = false)
 * - All other damage can crit by default
 * - Shared scope: caller pre-rolls once and passes critOverride to all hits
 * - PerHit scope: each DamageResolver.resolve() call rolls independently
 */

export const BASE_CRIT_RATE = 5; // 5%
export const BASE_CRIT_DAMAGE = 50; // 50% → multiplier 1.5

export interface CritResult {
  isCrit: boolean;
  /** 1.0 if no crit, (1 + totalCritDmg%) if crit. */
  multiplier: number;
}

export const NO_CRIT: CritResult = Object.freeze({
  isCrit: false,
  multiplier: 1,
});

/**
 * Resolve a single crit roll.
 *
 * @param canCrit   - false for burn DoT etc.
 * @param bonusCritRate   - additional crit rate from stats (percentage points, e.g. 10 = +10%)
 * @param bonusCritDamage - additional crit damage from stats (percentage points, e.g. 20 = +20%)
 * @param rng - random function returning [0, 1). Provide deterministic fn for tests.
 */
export function resolveCrit(
  canCrit: boolean,
  bonusCritRate: number,
  bonusCritDamage: number,
  rng: () => number = Math.random,
): CritResult {
  if (!canCrit) return NO_CRIT;

  const totalRate = Math.max(0, Math.min(100, BASE_CRIT_RATE + bonusCritRate));
  const roll = rng();

  if (roll >= totalRate / 100) return NO_CRIT;

  const totalCritDmg = BASE_CRIT_DAMAGE + bonusCritDamage;
  return {
    isCrit: true,
    multiplier: 1 + totalCritDmg / 100,
  };
}

/**
 * Compute the expected (average) crit multiplier for DPS display.
 *
 * E(crit) = 1 + rate * critDmgRatio
 */
export function expectedCritMultiplier(
  canCrit: boolean,
  bonusCritRate: number,
  bonusCritDamage: number,
): number {
  if (!canCrit) return 1;

  const rate =
    Math.max(0, Math.min(100, BASE_CRIT_RATE + bonusCritRate)) / 100;
  const dmgRatio = (BASE_CRIT_DAMAGE + bonusCritDamage) / 100;
  return 1 + rate * dmgRatio;
}
