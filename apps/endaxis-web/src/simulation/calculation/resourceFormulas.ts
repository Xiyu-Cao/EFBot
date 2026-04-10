/**
 * Resource system formulas — 技力与终结技充能公式.
 *
 * Truth status annotations:
 *   - working verified: confirmed in-game
 *   - estimated: direction believed correct, pending final confirmation
 *   - placeholder: temporary value to keep the system runnable
 *
 * These formulas are the single source of truth for resource mechanics.
 * Runtime integration status is noted per section.
 */

// ===========================================================================
// SP (技力) Constants
// ===========================================================================

/** Natural SP regen rate (技力自然回复速率): +8.5 per second.
 *  Uses float, no rounding.
 *  Status: working verified */
export const SP_REGEN_RATE = 8.5;

/** SP cap (技力上限).
 *  Status: working verified */
export const SP_CAP = 300;

/** Default skill SP cost (战技默认技力消耗).
 *  Status: working verified */
export const DEFAULT_SKILL_SP_COST = 100;

// ===========================================================================
// SP Recovery — placeholder values
// ===========================================================================

/** Heavy attack SP recovery (重击回复技力).
 *  Status: placeholder — needs in-game verification */
export const HEAVY_ATTACK_SP_GAIN = 15;

/** Dodge SP recovery (闪避回复技力).
 *  Status: placeholder — needs in-game verification */
export const DODGE_SP_GAIN = 7.4;

// ===========================================================================
// Refund SP (返还技力) Rules
// ===========================================================================

/**
 * Refund SP rules — 返还技力规则.
 *
 * NOT YET IMPLEMENTED in simulation engine (TeamState uses a single SP pool).
 * Documented here as the single source of truth for future implementation.
 *
 * Rules (working verified):
 * 1. After skill cast, refund SP enters the shared SP pool.
 * 2. Next skill cast consumes refund SP first.
 * 3. Consuming refund SP does NOT generate ultimate charge.
 * 4. If total SP reaches 300 and pool still contains refundSP,
 *    natural regen gradually converts refundSP to trueSP until 300 trueSP.
 *
 * Implementation note: requires splitting TeamState.sp into
 * { trueSP: number, refundSP: number } with total = trueSP + refundSP <= SP_CAP.
 * SP consumption order: refundSP first, then trueSP.
 * Only trueSP consumption feeds into ultimate charge formula.
 */

// ===========================================================================
// Ultimate Charge (终结技充能) Formulas
// ===========================================================================

/**
 * ult_charge_eff 语义统一说明:
 *
 * 字段含义: 终结技充能效率的"总倍率百分数"
 * - 100 = 1.0x (基础，无加成)
 * - 120 = 1.2x (+20% 充能效率)
 * - 82.8 = 0.828x (-17.2% 充能效率)
 *
 * 使用方式: actualCharge = baseCharge × (ult_charge_eff / 100)
 *
 * 同名效果叠加规则: 所有同名效果直接加算到 ult_charge_eff 字段上。
 * 例: base 100 + 武器 +20 + 套装 +10 → ult_charge_eff = 130 → 1.3x
 *
 * 一致性:
 * - coreStats.js default: 100
 * - SpChangeHandler: applyUltChargeEfficiency(base, eff) = base * eff / 100
 * - timelineStore: efficiency = (gaugeEfficiency ?? 100) / 100
 * - 三处语义一致，无冲突。
 *
 * 录入提示: 如果游戏面板显示"+82.8%充能效率"，录入值应为 100 + 82.8 = 182.8。
 */

/**
 * Base ultimate charge from SP consumption (战技消耗技力→全队充能).
 *
 * 基础终结技充能 = 实际消耗的 trueSP × 6.5 / 100
 *
 * Note: only trueSP consumption generates charge, not refundSP.
 * Status: working verified
 *
 * @param trueSPConsumed - amount of trueSP consumed (NOT refundSP)
 * @returns base ultimate charge gained (before efficiency modifier)
 */
export function computeBaseUltCharge(trueSPConsumed: number): number {
  return (trueSPConsumed * 6.5) / 100;
}

/**
 * Apply ultimate charge efficiency modifier (终结技充能效率加成).
 *
 * 实际获得终结技充能 = 基础获得量 × (终结技充能效率 / 100)
 *
 * ult_charge_eff uses percentage representation: 100 = 1.0x (base).
 * All same-name bonuses are additive within this stat
 * (e.g. base 100 + 20% bonus → ult_charge_eff = 120 → 1.2x).
 *
 * Status: working verified (formula), integrated in UI projection (timelineStore).
 * NOT YET integrated in simulation engine (SpChangeHandler does not compute gauge).
 *
 * @param baseCharge - base charge from computeBaseUltCharge()
 * @param ultChargeEff - ult_charge_eff stat value (default 100 = 1.0x)
 * @returns actual ultimate charge gained
 */
export function applyUltChargeEfficiency(
  baseCharge: number,
  ultChargeEff: number = 100,
): number {
  return baseCharge * (ultChargeEff / 100);
}

/**
 * Link skill fixed gauge gain (连携技固定充能).
 *
 * 连携技释放时，该角色自身获得 +10 终结技能量.
 * Special per-character gauge effects are separate.
 *
 * Status: working verified */
export const LINK_SKILL_SELF_GAUGE_GAIN = 10;
