import type { BaseGameState } from "@/simulation/state/BaseGameState.ts";
import type { TeamSnapshot, TeamConfig } from "@/simulation/state/types.ts";
import type { SimulationEngine } from "../engine/SimulationEngine";

/**
 * Result of an SP consumption operation.
 * Tracks how much was consumed from each pool.
 */
export interface SpConsumptionResult {
  /** Amount consumed from trueSP (generates ultimate charge). */
  trueSPConsumed: number;
  /** Amount consumed from refundSP (does NOT generate ultimate charge). */
  refundSPConsumed: number;
  /** Total SP after consumption. */
  totalSP: number;
}

/**
 * Team-level shared state — SP dual pool + regen.
 *
 * SP is split into two pools:
 * - trueSP: natural regen, execution recovery, hit SP. Generates ultimate charge on consumption.
 * - refundSP: returned by skills after cast. Consumed first. Does NOT generate ultimate charge.
 *
 * Total SP = trueSP + refundSP, capped at config.maxSp.
 * All values are float (no integer truncation).
 *
 * Natural regen rules when at cap:
 * - If total >= cap and refundSP > 0, regen converts refundSP → trueSP
 *   (effectively replacing refundSP with trueSP until the entire pool is trueSP).
 */
export class TeamState implements BaseGameState<TeamSnapshot> {
  private trueSP: number;
  private refundSP: number = 0;
  private isSpRegenPaused: boolean = false;
  private spRegenPauseDuration: number = 0;

  constructor(
    readonly config: TeamConfig,
    _engine: SimulationEngine,
  ) {
    this.trueSP = config.initialSp || 0;
  }

  advanceTime(dt: number, _currentTime: number) {
    this.regenSp(dt);
  }

  snapshot(): TeamSnapshot {
    return {
      sp: this.trueSP + this.refundSP,
      trueSP: this.trueSP,
      refundSP: this.refundSP,
      spRegenRate: this.config.spRegenRate,
      maxSp: this.config.maxSp,
      isSpRegenPaused: this.isSpRegenPaused,
      spRegenPauseDuration: this.spRegenPauseDuration,
    };
  }

  /** Total SP (trueSP + refundSP). */
  getSp(): number {
    return this.trueSP + this.refundSP;
  }

  getTrueSP(): number {
    return this.trueSP;
  }

  getRefundSP(): number {
    return this.refundSP;
  }

  /**
   * Consume SP from the pool. Consumes refundSP first, then trueSP.
   * Returns breakdown of how much came from each pool.
   */
  consumeSp(amount: number): SpConsumptionResult {
    if (amount <= 0) {
      return { trueSPConsumed: 0, refundSPConsumed: 0, totalSP: this.getSp() };
    }

    let remaining = amount;

    // Consume refundSP first
    const fromRefund = Math.min(this.refundSP, remaining);
    this.refundSP -= fromRefund;
    remaining -= fromRefund;

    // Then consume trueSP
    const fromTrue = Math.min(this.trueSP, remaining);
    this.trueSP -= fromTrue;

    return {
      trueSPConsumed: fromTrue,
      refundSPConsumed: fromRefund,
      totalSP: this.getSp(),
    };
  }

  /**
   * Add refund SP (returned by skills after cast).
   * Capped so total does not exceed maxSp.
   */
  addRefundSp(amount: number): number {
    if (amount <= 0) return this.getSp();
    const room = this.config.maxSp - this.getSp();
    this.refundSP += Math.min(amount, Math.max(0, room));
    return this.getSp();
  }

  /**
   * Add true SP (from regen, execution, hit recovery, etc.).
   * Capped so total does not exceed maxSp.
   */
  addTrueSp(amount: number): number {
    if (amount <= 0) return this.getSp();
    const room = this.config.maxSp - this.getSp();
    this.trueSP += Math.min(amount, Math.max(0, room));
    return this.getSp();
  }

  /**
   * Legacy API: modify SP by a signed amount.
   * Positive amounts go to trueSP; negative amounts consume via consumeSp.
   * Callers that need refund semantics should use addRefundSp/consumeSp directly.
   */
  modifySp(amount: number): number {
    if (amount === 0) return this.getSp();
    if (amount > 0) {
      return this.addTrueSp(amount);
    }
    this.consumeSp(-amount);
    return this.getSp();
  }

  pauseSpRegen(duration: number) {
    this.isSpRegenPaused = true;
    this.spRegenPauseDuration += duration;
  }

  private regenSp(dt: number) {
    const total = this.getSp();
    if (total >= this.config.maxSp && this.refundSP <= 0) {
      // Fully capped with all trueSP — nothing to do
      return;
    }

    let effectiveDuration = dt;

    if (this.isSpRegenPaused) {
      if (dt < this.spRegenPauseDuration) {
        this.spRegenPauseDuration -= dt;
        return;
      }

      effectiveDuration -= this.spRegenPauseDuration;
      this.isSpRegenPaused = false;
      this.spRegenPauseDuration = 0;
    }

    if (effectiveDuration <= 0) return;

    const gain = effectiveDuration * this.config.spRegenRate;

    if (total >= this.config.maxSp) {
      // At cap but has refundSP: convert refundSP → trueSP
      const convert = Math.min(this.refundSP, gain);
      this.refundSP -= convert;
      this.trueSP += convert;
    } else {
      // Below cap: add trueSP, capped at maxSp
      const room = this.config.maxSp - total;
      const actualGain = Math.min(gain, room);
      this.trueSP += actualGain;
    }
  }
}
