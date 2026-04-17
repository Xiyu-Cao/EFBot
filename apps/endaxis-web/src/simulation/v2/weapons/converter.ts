/**
 * V2 Weapon Converter
 *
 * Converts WeaponDefinition → PassiveTrigger[] for the V2 kernel.
 * Also extracts passive stats as StatModifier[].
 *
 * Tier index: 0-based (tier 1 = index 0, max tier = index 8).
 */

import type { PassiveTrigger, HitEffect } from "../types";
import type { StatModifier } from "../characterBuild";
import type { WeaponDefinition, WeaponTrigger } from "./types";

// ═══════════════════════════════════════════════════════════════════
// Tier expansion — generate 9 per-tier values from max tier value
// Formula: maxValue / 14 × [5, 6, 7, 8, 9, 10, 11, 12, 14]
// ═══════════════════════════════════════════════════════════════════

const TIER_MULTIPLIERS = [5, 6, 7, 8, 9, 10, 11, 12, 14];

/** Expand a max-tier value into all 9 tier values. */
export function expandTiers(maxValue: number): number[] {
  const step = maxValue / 14;
  return TIER_MULTIPLIERS.map(m => {
    const v = step * m;
    // Round to avoid floating point noise (max 2 decimal places)
    return Math.round(v * 100) / 100;
  });
}

// ═══════════════════════════════════════════════════════════════════
// Passive stat extraction
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract weapon passive stats as StatModifiers.
 * @param weapon - Weapon definition
 * @param tierIndex - 0-based tier index (0..8)
 */
export function extractWeaponPassiveStats(
  weapon: WeaponDefinition,
  tierIndex: number,
): StatModifier[] {
  const modifiers: StatModifier[] = [];
  for (const ps of weapon.passiveStats) {
    const value = ps.values[tierIndex] ?? ps.values[ps.values.length - 1] ?? 0;
    if (value === 0) continue;
    modifiers.push({
      source: `weapon_${weapon.id}`,
      stat: ps.stat,
      value,
      type: "flat",
    });
  }
  return modifiers;
}

// ═══════════════════════════════════════════════════════════════════
// Trigger conversion
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert all weapon triggers to V2 PassiveTrigger format.
 * @param weapon - Weapon definition
 * @param tierIndex - 0-based tier index (0..8)
 */
export function convertWeaponTriggers(
  weapon: WeaponDefinition,
  tierIndex: number,
): PassiveTrigger[] {
  const results: PassiveTrigger[] = [];
  for (const wt of weapon.triggers) {
    const value = wt.values[tierIndex] ?? wt.values[wt.values.length - 1] ?? 0;
    if (value === 0) continue;

    if (wt.consumeOnSkillType?.length) {
      // Stored buff: charge trigger + consume-on-action trigger
      results.push(...convertStoredBuff(weapon, wt, value));
    } else {
      results.push(convertSimpleTrigger(weapon, wt, value));
    }
  }
  return results;
}

// ── Simple trigger: event → buff_apply ──

function convertSimpleTrigger(
  weapon: WeaponDefinition,
  wt: WeaponTrigger,
  value: number,
): PassiveTrigger {
  const actions: HitEffect[] = [{
    type: "buff_apply",
    params: {
      buffId: wt.id,
      target: wt.target,
      stat: wt.stat,
      zone: wt.zone,
      value,
      duration: wt.duration,
      maxStacks: wt.maxStacks,
      stackBehavior: wt.stackMode,
    },
  }];

  return {
    id: wt.id,
    source: `weapon_${weapon.name}`,
    listenTo: wt.listenTo,
    deferred: false,
    sourceMustBeOwner: wt.sourceMustBeOwner !== false,
    cooldownId: wt.icd > 0 ? `${wt.id}_icd` : undefined,
    cooldownDuration: wt.icd > 0 ? wt.icd : undefined,
    condition: wt.condition,
    actions,
  };
}

// ── Stored buff: charge on event → activate on matching action ──
// Produces TWO triggers:
//   1. Charge trigger: on original event → apply marker buff (no modifiers)
//   2. The marker buff is tagged with consumeOnAction in its params.
//      Kernel Phase A picks it up when matching action starts.

function convertStoredBuff(
  weapon: WeaponDefinition,
  wt: WeaponTrigger,
  value: number,
): PassiveTrigger[] {
  const chargeBuffId = `${wt.id}_charge`;

  // Charge trigger: on original event → apply charge marker
  const chargeTrigger: PassiveTrigger = {
    id: `${wt.id}_charge`,
    source: `weapon_${weapon.name}`,
    listenTo: wt.listenTo,
    deferred: false,
    sourceMustBeOwner: wt.sourceMustBeOwner !== false,
    cooldownId: wt.icd > 0 ? `${wt.id}_icd` : undefined,
    cooldownDuration: wt.icd > 0 ? wt.icd : undefined,
    condition: wt.condition,
    actions: [{
      type: "buff_apply",
      params: {
        buffId: chargeBuffId,
        target: "self",
        duration: wt.duration,
        maxStacks: 1,
        stackBehavior: "refresh",
        // Tag for kernel Phase A to detect
        consumeOnAction: wt.consumeOnSkillType,
        // The actual buff to apply when consumed
        activateStat: wt.stat,
        activateZone: wt.zone,
        activateValue: value,
      },
    }],
  };

  return [chargeTrigger];
}
