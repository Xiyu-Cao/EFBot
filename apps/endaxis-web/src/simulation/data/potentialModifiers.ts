/**
 * Potential Parameter Modifier Registry.
 *
 * Static lookup tables for potential-driven parameter modifications.
 * Three registries:
 *   1. Multiplier — skill tick multiplier × factor
 *   2. Cooldown  — action cooldown - flat seconds
 *   3. Duration  — effect/anomaly duration + flat or × factor
 *
 * Buff value modifiers and logic overrides are handled inline at their
 * respective injection sites (talentConditionalRegistry, simulator Route 2.9, etc.)
 */

import type { ActionType } from "../compiler/types";

// ── 1. Tick Multiplier Registry ──────────────────────────────────────────────

interface MultiplierModifier {
  potentialLevel: number;
  actionTypes: ActionType[];
  /** Multiplicative factor applied to base multiplier. */
  factor: number;
  /** "all" = every tick; "first" = only tickIndex === 0 */
  tickFilter: "all" | "first";
}

/**
 * Tick multiplier modifiers keyed by actorId.
 *
 * These multiply the resolved DamageTick.multiplier AFTER
 * applySkillMultiplierOverlay has set the base value.
 *
 * Entries with tickFilter="extra_attack" or conditional gating
 * are handled inline in carrierConsumptionHandlers (LAEVATAIN P1, LASTRITE P5).
 */
const MULTIPLIER_MODIFIERS: Record<string, MultiplierModifier[]> = {
  // P3 双剑奇侠: 战技/连携技/终结技倍率×1.1
  CHENQIANYU: [
    { potentialLevel: 3, actionTypes: ["skill", "link", "ultimate"], factor: 1.1, tickFilter: "all" },
  ],
  // P5 特别信件: 连携技倍率×1.3
  GILBERTA: [
    { potentialLevel: 5, actionTypes: ["link"], factor: 1.3, tickFilter: "all" },
  ],
  // P3 统御严冬: 连携技/终结技倍率×1.15
  LASTRITE: [
    { potentialLevel: 3, actionTypes: ["link", "ultimate"], factor: 1.15, tickFilter: "all" },
  ],
  // P3 当家气魄: 战技倍率×1.1; P5 魔眼效能: 终结技倍率×1.15
  TANGTANG: [
    { potentialLevel: 3, actionTypes: ["skill"], factor: 1.1, tickFilter: "all" },
    { potentialLevel: 5, actionTypes: ["ultimate"], factor: 1.15, tickFilter: "all" },
  ],
  // P5 火山蒸汽: 连携技倍率×1.2
  ARDELIA: [
    { potentialLevel: 5, actionTypes: ["link"], factor: 1.2, tickFilter: "all" },
  ],
  // P3 延后工作: 战技首个命中伤害+40% (first tick only)
  ESTELLA: [
    { potentialLevel: 3, actionTypes: ["skill"], factor: 1.4, tickFilter: "first" },
  ],
};

/**
 * Get the combined multiplier factor for a damage tick.
 * Returns 1.0 if no modifier applies.
 */
export function getMultiplierFactor(
  actorId: string,
  potentialLevel: number,
  actionType: ActionType,
  tickIndex: number,
): number {
  if (potentialLevel <= 0) return 1;
  const entries = MULTIPLIER_MODIFIERS[actorId];
  if (!entries) return 1;

  let factor = 1;
  for (const m of entries) {
    if (potentialLevel < m.potentialLevel) continue;
    if (!m.actionTypes.includes(actionType)) continue;
    if (m.tickFilter === "first" && tickIndex !== 0) continue;
    factor *= m.factor;
  }
  return factor;
}

// ── 2. Cooldown Registry ─────────────────────────────────────────────────────

interface CooldownModifier {
  potentialLevel: number;
  actionType: ActionType;
  /** Seconds to subtract (positive number). */
  reduction: number;
}

/**
 * Cooldown reduction modifiers keyed by actorId.
 * Applied in ActionEndHandler before setCooldown.
 */
const COOLDOWN_MODIFIERS: Record<string, CooldownModifier[]> = {
  // P5 心兼人间: 连携技CD-3s
  CHENQIANYU: [{ potentialLevel: 5, actionType: "link", reduction: 3 }],
  // P5 特别信件: 连携技CD-2s
  GILBERTA: [{ potentialLevel: 5, actionType: "link", reduction: 2 }],
  // P5 新铸剑锋: 连携技CD-2s
  POGRANICHNK: [{ potentialLevel: 5, actionType: "link", reduction: 2 }],
  // P1 财宝储备: 连携技CD-2s
  TANGTANG: [{ potentialLevel: 1, actionType: "link", reduction: 2 }],
  // P5 火山蒸汽: 连携技CD-2s
  ARDELIA: [{ potentialLevel: 5, actionType: "link", reduction: 2 }],
};

/**
 * Get total cooldown reduction in seconds.
 * Returns 0 if no modifier applies.
 */
export function getCooldownReduction(
  actorId: string,
  potentialLevel: number,
  actionType: ActionType,
): number {
  if (potentialLevel <= 0) return 0;
  const entries = COOLDOWN_MODIFIERS[actorId];
  if (!entries) return 0;

  let total = 0;
  for (const m of entries) {
    if (potentialLevel < m.potentialLevel) continue;
    if (m.actionType !== actionType) continue;
    total += m.reduction;
  }
  return total;
}

// ── 3. Duration Registry ─────────────────────────────────────────────────────

interface DurationModifier {
  potentialLevel: number;
  /** Target identifier: anomaly type ("burn","freeze","conduction","corrosion"),
   *  buff type ("physical_vulnerable","dapan_buff","Thunderlances"), etc. */
  targetId: string;
  /** "flat" = add seconds; "factor" = multiply base duration */
  mode: "flat" | "factor";
  /** flat: seconds to add; factor: multiplier (1.5 = +50%) */
  value: number;
}

/**
 * Duration modifiers keyed by actorId.
 * Applied at anomaly/buff creation time.
 */
const DURATION_MODIFIERS: Record<string, DurationModifier[]> = {
  // P1 习惯性延误: 连携技物理脆弱持续+3s
  ESTELLA: [{ potentialLevel: 1, targetId: "physical_vulnerable", mode: "flat", value: 3 }],
  // P2 五味调和: 备料持续+10s
  DAPAN: [{ potentialLevel: 2, targetId: "dapan_buff", mode: "flat", value: 10 }],
  // P3 极地生存指南: 终结技冻结持续+2s
  SNOWSHINE: [{ potentialLevel: 3, targetId: "freeze", mode: "flat", value: 2 }],
  // P3 往事碎片: 燃烧持续+50%
  LAEVATAIN: [{ potentialLevel: 3, targetId: "burn", mode: "factor", value: 1.5 }],
  // P1 危机处理: 连携技导电持续+75%
  PERLICA: [{ potentialLevel: 1, targetId: "conduction", mode: "factor", value: 1.75 }],
  // P5 火山蒸汽: 施加的腐蚀持续+4s
  ARDELIA: [{ potentialLevel: 5, targetId: "corrosion", mode: "flat", value: 4 }],
  // P2 大棒悬头: 雷枪存在时间+20s
  AVYWENNA: [{ potentialLevel: 2, targetId: "Thunderlances", mode: "flat", value: 20 }],
};

/**
 * Apply duration modifiers and return the modified duration.
 * If no modifier matches, returns baseDuration unchanged.
 */
export function applyDurationModifier(
  baseDuration: number,
  actorId: string,
  potentialLevel: number,
  targetId: string,
): number {
  if (potentialLevel <= 0) return baseDuration;
  const entries = DURATION_MODIFIERS[actorId];
  if (!entries) return baseDuration;

  let duration = baseDuration;
  for (const m of entries) {
    if (potentialLevel < m.potentialLevel) continue;
    if (m.targetId !== targetId) continue;
    if (m.mode === "flat") {
      duration += m.value;
    } else {
      duration *= m.value;
    }
  }
  return duration;
}
