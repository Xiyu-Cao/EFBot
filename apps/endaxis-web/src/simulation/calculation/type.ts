import type { ActorSnapshot } from "@/simulation/state/types.ts";
import type { EnemyState } from "../state/EnemyState";
import type { GameState } from "../state/GameState";
import type { DamageTags } from "./damageTypes";
import type { CritResult } from "./critSystem";

export interface StaggerContext {
  source: ActorSnapshot;
  target: EnemyState;
  baseValue: number;
  tags: string[];
  state: GameState;
}

/**
 * Context passed to the DamageResolver for a single damage instance.
 *
 * Every damage instance (skill hit, anomaly, burn tick, equipment proc)
 * goes through DamageResolver with this context.
 */
export interface DamageContext {
  /** The actor dealing damage. */
  source: ActorSnapshot;
  /** Enemy state (for resistance, broken status, anomaly debuffs, etc.). */
  target: EnemyState;
  /** Full game state for cross-references. */
  state: GameState;

  /** The damage multiplier (skill 倍率, anomaly multiplier, etc.). */
  multiplier: number;

  /** Full damage classification tags. */
  damageTags: DamageTags;

  /**
   * Pre-resolved crit for shared scope.
   * If provided, overrides the crit roll inside DamageResolver.
   * Use this when multiple hits share one crit decision.
   */
  critOverride?: CritResult;

  /**
   * RNG function for crit roll. Returns [0, 1).
   * Default: Math.random.
   * Provide a deterministic function for tests.
   */
  rng?: () => number;

  /**
   * Crit calculation mode:
   * - "real": roll each hit independently (default) — binary crit/no-crit
   * - "expected": use probability-weighted expected multiplier — deterministic
   */
  critMode?: "real" | "expected";
}

export interface CalculationResult {
  baseValue: number;
  finalValue: number;
  breakdown: BreakdownEntry[];
  /** Whether this hit was a crit (real mode) or false (expected mode). */
  isCrit: boolean;
}

/** Alias for damage pipeline output; same shape as {@link CalculationResult}. */
export type DamageResult = CalculationResult;

export interface BreakdownEntry {
  source: string;
  type: "BASE" | "FLAT" | "MULTIPLIER";
  value: number;
  contribution: number;
}
