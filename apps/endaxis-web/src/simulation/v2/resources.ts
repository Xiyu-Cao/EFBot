/**
 * V2 Layer 2: Resource System
 *
 * Manages SP (trueSP + refundSP) and ultimate gauge.
 * Mutable state — owned by the kernel, updated per event.
 *
 * Formulas from: reports/kernel-mechanics-audit-2026-04-09.md §2
 */

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

/** SP natural regen rate (per second). */
export const SP_REGEN_RATE = 8;
/** SP cap (trueSP + refundSP combined). */
export const SP_CAP = 300;
/** Default skill SP cost. */
export const DEFAULT_SKILL_SP_COST = 100;

/** Base gauge charge per trueSP consumed: 6.5%. */
const GAUGE_CHARGE_RATE = 6.5 / 100;

// ═══════════════════════════════════════════════════════════════════
// SP State
// ═══════════════════════════════════════════════════════════════════

export class SpState {
  private trueSP: number;
  private refundSP: number;
  /** Time of last regen tick (for continuous regen). */
  private lastRegenTime: number;
  /** Is regen paused? (skill cast freezes regen briefly). */
  private regenPausedUntil: number = 0;

  constructor(initialSP: number = 200) {
    this.trueSP = initialSP;
    this.refundSP = 0;
    this.lastRegenTime = 0;
  }

  getTrueSP(): number { return this.trueSP; }
  getRefundSP(): number { return this.refundSP; }
  getTotal(): number { return this.trueSP + this.refundSP; }

  /**
   * Consume SP. Prioritizes refundSP first.
   * Returns breakdown of how much was consumed from each pool.
   */
  consume(amount: number): { trueSPConsumed: number; refundSPConsumed: number } {
    if (amount <= 0) return { trueSPConsumed: 0, refundSPConsumed: 0 };

    let remaining = amount;
    let refundConsumed = 0;
    let trueConsumed = 0;

    // Consume refundSP first
    if (this.refundSP > 0) {
      refundConsumed = Math.min(this.refundSP, remaining);
      this.refundSP -= refundConsumed;
      remaining -= refundConsumed;
    }

    // Then trueSP
    if (remaining > 0) {
      trueConsumed = Math.min(this.trueSP, remaining);
      this.trueSP -= trueConsumed;
    }

    return { trueSPConsumed: trueConsumed, refundSPConsumed: refundConsumed };
  }

  /**
   * Restore SP to the specified pool.
   * Clamped so total doesn't exceed SP_CAP.
   */
  restore(amount: number, spType: "true" | "refund"): number {
    if (amount <= 0) return 0;
    const headroom = SP_CAP - this.getTotal();
    const actual = Math.min(amount, headroom);
    if (actual <= 0) return 0;

    if (spType === "true") {
      this.trueSP += actual;
    } else {
      this.refundSP += actual;
    }
    return actual;
  }

  /**
   * Advance natural regen up to currentTime.
   * Returns amount of trueSP regenerated.
   */
  advanceRegen(currentTime: number): number {
    if (currentTime <= this.lastRegenTime) return 0;

    // Regen is paused during skill casts
    const regenStart = Math.max(this.lastRegenTime, this.regenPausedUntil);
    this.lastRegenTime = currentTime;

    if (currentTime <= regenStart) return 0;

    const dt = currentTime - regenStart;
    const regenAmount = dt * SP_REGEN_RATE;

    // Regen goes to trueSP
    const headroom = SP_CAP - this.getTotal();
    const actual = Math.min(regenAmount, headroom);
    if (actual > 0) {
      this.trueSP += actual;
    }
    return actual;
  }

  /** Pause regen until a given time. */
  pauseRegenUntil(time: number): void {
    this.regenPausedUntil = Math.max(this.regenPausedUntil, time);
  }

  /** Snapshot for event logging. */
  snapshot(): { trueSP: number; refundSP: number; total: number } {
    return { trueSP: this.trueSP, refundSP: this.refundSP, total: this.getTotal() };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Gauge State (per actor)
// ═══════════════════════════════════════════════════════════════════

export class GaugeState {
  private gauge: number;
  private readonly max: number;
  /** Block windows: gauge doesn't increase during these periods. */
  private blockWindows: { start: number; end: number }[] = [];

  constructor(initial: number, max: number) {
    this.gauge = Math.min(initial, max);
    this.max = max;
  }

  getGauge(): number { return this.gauge; }
  getMax(): number { return this.max; }
  isFull(): boolean { return this.gauge >= this.max - 0.01; }

  /** Add a block window (e.g., ultimate animation + enhancement). */
  addBlockWindow(start: number, end: number): void {
    this.blockWindows.push({ start, end });
  }

  /** Check if gauge gain is blocked at a given time. */
  isBlocked(time: number): boolean {
    return this.blockWindows.some(w => time > w.start + 0.0001 && time < w.end - 0.0001);
  }

  /**
   * Modify gauge by a signed amount.
   * Positive changes are blocked during block windows.
   * Returns actual change applied.
   */
  modify(amount: number, time: number): number {
    // Positive changes blocked during block windows
    if (amount > 0 && this.isBlocked(time)) return 0;

    const before = this.gauge;
    this.gauge = Math.max(0, Math.min(this.max, this.gauge + amount));
    return this.gauge - before;
  }

  /**
   * Consume gauge (e.g., ultimate cast). Always allowed regardless of block.
   */
  consumeForUltimate(cost: number): number {
    const actual = Math.min(this.gauge, cost);
    this.gauge -= actual;
    return actual;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Gauge charge formulas
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute base gauge charge from trueSP consumed.
 * Formula: trueSPConsumed × 6.5 / 100
 */
export function computeBaseGaugeCharge(trueSPConsumed: number): number {
  return trueSPConsumed * GAUGE_CHARGE_RATE;
}

/**
 * Apply ultimate charge efficiency to a base charge.
 * Formula: baseCharge × (ultChargeEff / 100)
 */
export function applyChargeEfficiency(baseCharge: number, ultChargeEff: number): number {
  return baseCharge * (ultChargeEff / 100);
}

/**
 * Full gauge charge from SP consumption.
 * Used when a skill consumes SP — all actors receive charge.
 */
export function computeGaugeChargeFromSP(
  trueSPConsumed: number,
  ultChargeEff: number,
): number {
  const base = computeBaseGaugeCharge(trueSPConsumed);
  return applyChargeEfficiency(base, ultChargeEff);
}

/**
 * Direct gauge gain (e.g., link gaugeGain, enhanced skill bonus).
 * Applied with efficiency.
 */
export function computeDirectGaugeGain(
  amount: number,
  ultChargeEff: number,
): number {
  return applyChargeEfficiency(amount, ultChargeEff);
}
