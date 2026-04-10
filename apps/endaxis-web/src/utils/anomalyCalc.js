/**
 * anomalyCalc.js — UI-facing anomaly damage calculation helpers.
 *
 * IMPORTANT: Core formulas are defined in simulation/calculation/anomalyDamageCalc.ts.
 * This file re-exports them for backward compatibility with timelineStore.js.
 * Do NOT duplicate formulas here.
 */

// Re-export shared constants and functions from the single source of truth
export {
    DEFAULT_CHAR_LEVEL,
    spellLevelCoef,
    physLevelCoef,
    artsPowerDamageMult,
    artsPowerDebuffMult,
    artsPowerStaggerMult,
    calcConductionDebuff as calcElectrificationDebuff,
    calcCorrosionDebuff,
    calcBreachPhysVulnerability,
} from '@/simulation/calculation/anomalyDamageCalc'

// ---------------------------------------------------------------------------
// UI convenience wrappers that compute "raw damage" (ATK * multiplier).
// These do NOT pass through the full zone pipeline — they are for UI
// projection display only. The simulation uses DamageResolver instead.
// ---------------------------------------------------------------------------

import {
    spellLevelCoef as _slc,
    artsPowerDamageMult as _apdm,
    physLevelCoef as _plc,
    DEFAULT_CHAR_LEVEL as _DCL,
} from '@/simulation/calculation/anomalyDamageCalc'

/**
 * UI projection: raw spell burst damage (without zone pipeline).
 * artsPower defaults to 0 for backward compat with callers that omit it.
 */
export const calcSpellBurstDamage = (attack, artsPower = 0, level = _DCL) =>
    attack * 1.6 * _slc(level) * _apdm(artsPower)

/** UI projection: raw spell anomaly trigger damage. */
export const calcSpellAnomalyTriggerDamage = (attack, anomalyLevel, artsPower, level = _DCL) =>
    attack * 0.8 * (1 + anomalyLevel) * _slc(level) * _apdm(artsPower)

/** UI projection: raw burn dot tick damage. */
export const calcCombustionDotTick = (attack, anomalyLevel, artsPower, level = _DCL) =>
    attack * 0.12 * (1 + anomalyLevel) * _slc(level) * _apdm(artsPower)

/** UI projection: raw freeze shatter damage. */
export const calcFreezeConsumeDamage = (attack, anomalyLevel, artsPower, level = _DCL) =>
    attack * 1.2 * (1 + anomalyLevel) * _slc(level) * _apdm(artsPower)

/** UI projection: raw lift/knockdown damage. */
export const calcLiftKnockdownDamage = (attack, artsPower, level = _DCL) =>
    attack * 1.2 * _plc(level) * _apdm(artsPower)

/** UI projection: raw crush/slam damage. */
export const calcCrushDamage = (attack, stacks, artsPower, level = _DCL) =>
    attack * 1.5 * (1 + stacks) * _plc(level) * _apdm(artsPower)

/** UI projection: raw breach/armor-break damage. */
export const calcBreachDamage = (attack, stacks, artsPower, level = _DCL) =>
    attack * 0.5 * (1 + stacks) * _plc(level) * _apdm(artsPower)
