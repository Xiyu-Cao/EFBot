/**
 * DamageResolver — the single place where final damage numbers are produced.
 *
 * Real damage formula (v1):
 *   finalDamage = floor(
 *     ATK * skillMult
 *     * defense * crit * dmgBonus * amplify
 *     * combo * vulnerability * fragility * resistance
 *     * break * reduction * special
 *   )
 *
 * ATK is computed from the attack formula (with ability truncation + floor).
 * Each zone is an independent multiplier.
 * Within each zone, modifiers are generally additive.
 */

import { computeEffectiveAttack } from "./attackFormula";
import { aggregateAttackBonuses, aggregateCritBonuses } from "../equipment/types";
import { resolveCrit, expectedCritMultiplier, NO_CRIT, type CritResult } from "./critSystem";
import {
  computeAllZones,
  type ZoneContext,
  type ZoneResult,
} from "./multiplierZones";
import type { DamageContext, DamageResult, BreakdownEntry } from "./type";

export class DamageResolver {
  /**
   * Compute final damage for a single damage instance.
   *
   * @param ctx - damage context with source, target, multiplier, and tags
   * @returns DamageResult with finalValue and breakdown
   */
  resolve(ctx: DamageContext): DamageResult {
    const { damageTags: tags, multiplier } = ctx;

    if (!multiplier || multiplier <= 0) {
      return { baseValue: 0, finalValue: 0, breakdown: [], isCrit: false };
    }

    // Step 1: Compute effective ATK from the attack formula
    // Includes dynamic percentBonus/flatBonus from equipment buffs
    const atkBonuses = aggregateAttackBonuses(ctx.state, tags.sourceActorId);
    const atk = computeEffectiveAttack({
      baseAttack: ctx.source.stats.attack,
      primaryAbility: ctx.source.stats.primary_ability,
      secondaryAbility: ctx.source.stats.secondary_ability,
      percentBonus: atkBonuses.percentBonus,
      flatBonus: atkBonuses.flatBonus,
    });

    // Step 2: Base damage = ATK * skill/anomaly multiplier
    const baseDamage = atk * multiplier;

    // Step 3: Resolve crit
    // Aggregate base stats + runtime buff bonuses for crit
    const critBonuses = aggregateCritBonuses(ctx.state, tags.sourceActorId);
    const totalCritRate = (ctx.source.stats.crit_rate || 0) + critBonuses.critRateBonus;
    let totalCritDmg = (ctx.source.stats.crit_dmg || 0) + critBonuses.critDmgBonus;

    // YVONNE 天赋1 冰点: crit_dmg vs cold/frozen enemies
    // Base (E2): +10% cold, +20% frozen; P3 (嘀嗒充能): +20% cold, +40% frozen
    if (tags.sourceActorId === "YVONNE") {
      const activeEffects = (ctx.source.stats as any)?._activeEffects;
      // Read talent value: look for crit_dmg runtime_conditional from talent_1
      const t1 = activeEffects?.find(
        (e: any) => e.type === "stat_bonus" && e.stat === "crit_dmg" && e.scope === "runtime_conditional",
      );
      if (t1?.value) {
        const status = ctx.state.enemy.status;
        if (status.isFrozen(ctx.state.getCurrentTime())) {
          totalCritDmg += t1.value * 2; // frozen = double
        } else if (status.getMagicElement() === "cold") {
          totalCritDmg += t1.value;
        }
      }
    }

    let critResult: CritResult;
    if (ctx.critOverride) {
      critResult = ctx.critOverride;
    } else if (ctx.critMode === "expected") {
      // Expected mode: deterministic probability-weighted multiplier
      const expectedMult = expectedCritMultiplier(tags.canCrit, totalCritRate, totalCritDmg);
      critResult = { isCrit: false, multiplier: expectedMult };
    } else {
      // Real mode: binary roll
      critResult = resolveCrit(tags.canCrit, totalCritRate, totalCritDmg, ctx.rng);
    }

    // Step 4: Compute all multiplier zones
    const zoneCtx: ZoneContext = {
      source: ctx.source,
      target: ctx.target,
      state: ctx.state,
      tags,
      critResult,
    };

    const zones = computeAllZones(zoneCtx);

    // Step 5: Apply all zones multiplicatively
    let finalDamage = baseDamage;
    const breakdown: BreakdownEntry[] = [
      {
        source: `Base (ATK=${atk} × mult=${multiplier})`,
        type: "BASE",
        value: baseDamage,
        contribution: baseDamage,
      },
    ];

    for (const zone of zones) {
      if (zone.value === 1) continue; // skip identity zones for cleaner breakdown
      const prev = finalDamage;
      finalDamage *= zone.value;
      breakdown.push({
        source: zone.name + (zone.details ? ` (${zone.details})` : ""),
        type: "MULTIPLIER",
        value: zone.value,
        contribution: finalDamage - prev,
      });
    }

    // Step 6: Floor final value (damage is always a whole number)
    finalDamage = Math.floor(finalDamage);

    return {
      baseValue: baseDamage,
      finalValue: finalDamage,
      breakdown,
      isCrit: critResult.isCrit,
    };
  }
}
