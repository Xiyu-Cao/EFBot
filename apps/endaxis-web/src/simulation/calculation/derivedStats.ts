/**
 * Derived stat formulas — 角色派生属性公式.
 *
 * These formulas derive secondary stats from primary attributes.
 * Each function is annotated with its truth status:
 *   - working verified: confirmed in-game, safe to use
 *   - estimated: direction believed correct, needs final confirmation
 *   - placeholder: temporary value to keep the system runnable
 *
 * IMPORTANT: These derivations are NOT yet wired into processActors/compile.
 * The character data from gamedata likely already includes base-stat derivations
 * in the displayed values (e.g. stats.hp may already contain STR contribution).
 * Wiring these in requires confirming whether stats.hp is "base HP before STR"
 * or "final HP including STR". Until confirmed, these functions serve as
 * the single source of truth for the formulas themselves.
 */

// ---------------------------------------------------------------------------
// A. Strength → HP (力量 → 生命值)
// Status: working verified
// ---------------------------------------------------------------------------

/**
 * Additional HP from strength.
 *
 * 力量提供生命值 = 力量 × 5
 *
 * @param strength - character's total strength stat
 * @returns flat HP bonus from strength
 */
export function strengthToHp(strength: number): number {
  return strength * 5;
}

// ---------------------------------------------------------------------------
// B. Will → Healing Efficiency (意志 → 受治疗效率)
// Status: working verified
// ---------------------------------------------------------------------------

/**
 * Additional healing received efficiency from will.
 *
 * 意志提供受治疗效率 = 意志 × 0.1%
 *
 * @param will - character's total will stat
 * @returns healing efficiency bonus as a percentage value (e.g. 5.0 = +5.0%)
 */
export function willToHealEfficiency(will: number): number {
  return will * 0.1;
}

// ---------------------------------------------------------------------------
// C. Agility → Physical Resistance (敏捷 → 物理抗性)
// Status: placeholder — exact formula not yet confirmed
// ---------------------------------------------------------------------------

/**
 * Physical resistance contribution from agility.
 *
 * TODO: Confirm exact formula from in-game testing.
 * Current placeholder returns 0 (no contribution).
 *
 * @param _agility - character's total agility stat
 * @returns physical resistance bonus (percentage points)
 */
export function agilityToPhysicalResist(_agility: number): number {
  // placeholder: exact formula not yet confirmed
  return 0;
}

// ---------------------------------------------------------------------------
// D. Intellect → Magic Resistance (智识 → 四系法术抗性)
// Status: placeholder — exact formula not yet confirmed
// ---------------------------------------------------------------------------

/**
 * Magic resistance contribution from intellect.
 * Applies equally to all four magic types (blaze/emag/cold/nature).
 *
 * TODO: Confirm exact formula from in-game testing.
 * Current placeholder returns 0 (no contribution).
 *
 * @param _intellect - character's total intellect stat
 * @returns magic resistance bonus (percentage points)
 */
export function intellectToMagicResist(_intellect: number): number {
  // placeholder: exact formula not yet confirmed
  return 0;
}
