/**
 * Seeded pseudo-random number generator for deterministic simulation.
 *
 * Uses a simple mulberry32 algorithm — fast, deterministic, good enough
 * for crit rolls and proc chances. NOT cryptographic.
 *
 * Usage:
 *   const rng = createSeededRng(42);
 *   rng(); // 0.xxx — always the same sequence for seed 42
 */

/**
 * Create a seeded PRNG returning values in [0, 1).
 * Same seed always produces the same sequence.
 */
export function createSeededRng(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simulation randomness options.
 *
 * - `seed`: number → deterministic PRNG with that seed
 * - `deterministicCrits`: "alwaysCrit" | "neverCrit" → force all crit decisions
 * - If neither is set, uses Math.random (default non-deterministic behavior)
 */
export interface SimulationRngOptions {
  /** Seed for deterministic PRNG. Overrides Math.random for all crit/proc rolls. */
  seed?: number;
  /** Force all crit decisions. Overrides seed and stats. */
  deterministicCrits?: "alwaysCrit" | "neverCrit";
}

/**
 * Build an RNG function from simulation options.
 *
 * Priority:
 * 1. deterministicCrits → returns fixed 0 (always crit) or 1 (never crit)
 * 2. seed → creates seeded PRNG
 * 3. fallback → Math.random
 */
export function buildRng(options?: SimulationRngOptions): () => number {
  if (options?.deterministicCrits === "alwaysCrit") {
    return () => 0; // always below any positive crit rate
  }
  if (options?.deterministicCrits === "neverCrit") {
    return () => 1; // always above any crit rate
  }
  if (options?.seed !== undefined) {
    return createSeededRng(options.seed);
  }
  return Math.random;
}
