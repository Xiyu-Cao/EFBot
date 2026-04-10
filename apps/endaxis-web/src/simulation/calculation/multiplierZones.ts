/**
 * Multiplier zone calculators for the damage formula.
 *
 * Total damage = ATK * skillMult
 *              * defense * crit * dmgBonus * amplify
 *              * combo * vulnerability * fragility * resistance
 *              * break * reduction * special
 *
 * Within each zone, modifiers are generally additive.
 * Between zones, values are multiplicative.
 */

import type { DamageTags } from "./damageTypes";
import type { CritResult } from "./critSystem";
import type { EnemyState } from "../state/EnemyState";
import type { ActorSnapshot } from "../state/types";
import type { GameState } from "../state/GameState";
import {
  aggregateDynamicBonuses,
  aggregateZoneBonuses,
  aggregateEnemyZoneBonuses,
} from "../equipment/types";
import { calcConductionDebuff } from "./anomalyDamageCalc";

// ---------------------------------------------------------------------------
// Zone context (shared by all zone functions)
// ---------------------------------------------------------------------------

export interface ZoneContext {
  source: ActorSnapshot;
  target: EnemyState;
  state: GameState;
  tags: DamageTags;
  critResult: CritResult;
}

// ---------------------------------------------------------------------------
// Zone result for breakdown tracking
// ---------------------------------------------------------------------------

export interface ZoneResult {
  name: string;
  value: number;
  details?: string;
}

// ---------------------------------------------------------------------------
// 1. Defense Zone (防御区)
// ---------------------------------------------------------------------------

/**
 * Default 0.5. Reads from enemy config if available.
 */
export function computeDefenseZone(ctx: ZoneContext): ZoneResult {
  const value = ctx.target.config.defenseMultiplier ?? 0.5;
  return { name: "Defense", value };
}

// ---------------------------------------------------------------------------
// 2. Crit Zone (暴击区)
// ---------------------------------------------------------------------------

export function computeCritZone(ctx: ZoneContext): ZoneResult {
  return {
    name: "Crit",
    value: ctx.critResult.multiplier,
    details: ctx.critResult.isCrit ? "CRIT" : "normal",
  };
}

// ---------------------------------------------------------------------------
// 3. Damage Bonus Zone (增伤区)
// ---------------------------------------------------------------------------

/**
 * Aggregates all additive damage bonuses:
 * - "造成的伤害增加" (all_dmg) — matches all damage instances
 * - School-based: 法术伤害增加 / 物理伤害增加
 * - Elemental: 灼热/寒冷/电磁/自然伤害增加
 * - Source-specific: 普通攻击 / 战技 / 连携技 / 终结技伤害增加
 * - all_skill_dmg_bonus: 所有技能伤害加成
 * - broken_dmg_bonus: 对失衡目标伤害加成 (conditional)
 * - Dynamic bonuses from equipment buffs (zone = "damageBonus" or unspecified)
 */
export function computeDamageBonusZone(ctx: ZoneContext): ZoneResult {
  const { source, tags, target, state } = ctx;
  const stats = source.stats;
  let bonus = 0;

  // School-based bonuses
  if (tags.damageSchool === "magic") {
    bonus += stats.arts_dmg || 0;
  } else if (tags.damageSchool === "physical") {
    bonus += stats.physical_dmg || 0;
  }

  // Elemental bonuses
  switch (tags.damageType) {
    case "burn":
      bonus += stats.blaze_dmg || 0;
      break;
    case "cold":
      bonus += stats.cold_dmg || 0;
      break;
    case "electro":
      bonus += stats.emag_dmg || 0;
      break;
    case "nature":
      bonus += stats.nature_dmg || 0;
      break;
  }

  // Source-specific bonuses
  if (tags.countsAsNormalAttackDamage) {
    bonus += stats.attack_dmg_bonus || 0;
  }
  if (tags.countsAsActiveSkillDamage) {
    bonus += stats.skill_dmg_bonus || 0;
  }
  if (tags.countsAsComboSkillDamage) {
    bonus += stats.link_dmg_bonus || 0;
  }
  if (tags.countsAsUltimateSkillDamage) {
    bonus += stats.ultimate_dmg_bonus || 0;
  }

  // "所有技能伤害加成" applies to all skill-based damage
  const isSkillDamage =
    tags.countsAsNormalAttackDamage ||
    tags.countsAsActiveSkillDamage ||
    tags.countsAsComboSkillDamage ||
    tags.countsAsUltimateSkillDamage;
  if (isSkillDamage) {
    bonus += stats.all_skill_dmg_bonus || 0;
  }

  // Broken target bonus (conditional)
  if (target.isBroken(state.getCurrentTime())) {
    bonus += stats.broken_dmg_bonus || 0;
  }

  // Dynamic bonuses from equipment buffs (zone = "damageBonus" or unspecified)
  bonus += aggregateDynamicBonuses(state, tags.sourceActorId, tags);

  const value = 1 + bonus / 100;
  return { name: "DamageBonus", value };
}

// ---------------------------------------------------------------------------
// 4. Amplification Zone (增幅区)
// ---------------------------------------------------------------------------

/**
 * E.g., 法术增幅. Additive within zone.
 * Aggregated from actor effects with zone = "amplify".
 */
export function computeAmplifyZone(ctx: ZoneContext): ZoneResult {
  const bonus = aggregateZoneBonuses(
    ctx.state,
    ctx.tags.sourceActorId,
    "amplify",
  );
  const value = 1 + bonus / 100;
  return { name: "Amplify", value: value !== 1 ? value : 1 };
}

// ---------------------------------------------------------------------------
// 5. Combo Zone (连击区)
// ---------------------------------------------------------------------------

/**
 * Independent multiplier for combo/chain bonuses.
 * Aggregated from actor effects with zone = "combo".
 */
export function computeComboZone(ctx: ZoneContext): ZoneResult {
  const bonus = aggregateZoneBonuses(
    ctx.state,
    ctx.tags.sourceActorId,
    "combo",
  );
  const value = 1 + bonus / 100;
  return { name: "Combo", value: value !== 1 ? value : 1 };
}

// ---------------------------------------------------------------------------
// 6. Vulnerability Zone (易伤区)
// ---------------------------------------------------------------------------

/**
 * Additive within zone. Enemy-side debuffs.
 * - Conduction (导电): magic vulnerability by level + artsPower
 * - Physical vulnerability from armorBreak
 * - Dynamic enemy-side vulnerability buffs (zone = "vulnerability")
 */
export function computeVulnerabilityZone(ctx: ZoneContext): ZoneResult {
  const { target, tags, state } = ctx;
  let bonus = 0;
  const time = state.getCurrentTime();

  // Conduction: applies magic vulnerability (with artsPower scaling)
  const conduction = target.status.conduction;
  if (conduction && time < conduction.expiresAt) {
    if (tags.damageSchool === "magic") {
      // Use the real formula with artsPower from the conduction source
      const artsPower = (() => {
        try {
          return state.getActor(conduction.sourceActorId).snapshotData.stats
            .originium_arts_power || 0;
        } catch {
          return 0;
        }
      })();
      const debuff = calcConductionDebuff(conduction.level, artsPower);
      bonus += debuff.spellVulnerability;
    }
  }

  // Physical vulnerability from armorBreak (reads real value from effect properties)
  if (tags.damageSchool === "physical") {
    for (const inst of target.effects.getByTag("PHYSICAL_VULNERABLE")) {
      const pct = inst.effect.properties.physVulnPercent;
      if (typeof pct === "number" && pct > 0) {
        bonus += pct;
      }
    }
  }

  // Dynamic vulnerability from actor effects (zone = "vulnerability", source-side)
  bonus += aggregateZoneBonuses(
    state,
    tags.sourceActorId,
    "vulnerability",
  );

  // Dynamic vulnerability from enemy effects (zone = "vulnerability", target-side)
  bonus += aggregateEnemyZoneBonuses(state, "vulnerability");

  const value = 1 + bonus / 100;
  return { name: "Vulnerability", value };
}

// ---------------------------------------------------------------------------
// 7. Fragility Zone (脆弱区)
// ---------------------------------------------------------------------------

/**
 * Different-named fragility buffs are additive within zone.
 * - Physical fragility only applies to physical damage
 * - Magic fragility only applies to magic damage
 * - Elemental fragility applies to matching element
 * - Elemental fragility + school fragility CAN stack on same instance
 * - Physical fragility does NOT affect magic; magic fragility does NOT affect physical
 *
 * Aggregated from actor effects with zone = "fragility".
 * Each DynamicBonus with zone="fragility" is checked for school/element match.
 */
export function computeFragilityZone(ctx: ZoneContext): ZoneResult {
  // Source-side fragility (from actor effects)
  let bonus = aggregateZoneBonuses(
    ctx.state,
    ctx.tags.sourceActorId,
    "fragility",
    ctx.tags,
  );
  // Target-side fragility (from enemy effects — e.g., spell_vulnerable debuffs)
  bonus += aggregateEnemyZoneBonuses(ctx.state, "fragility", ctx.tags);

  const value = 1 + bonus / 100;
  return { name: "Fragility", value: value !== 1 ? value : 1 };
}

// ---------------------------------------------------------------------------
// 8. Resistance Zone (抗性区)
// ---------------------------------------------------------------------------

/**
 * resistance_zone = 1 + resistReduction * 0.01 - baseResist * 0.01
 *
 * baseResist from enemy config (per-school).
 * resistReduction from corrosion + other debuffs.
 */
export function computeResistanceZone(ctx: ZoneContext): ZoneResult {
  const { target, tags, state } = ctx;

  // Read base resist from enemy config (per-school)
  const baseResist =
    tags.damageSchool === "magic"
      ? (target.config.baseMagicResist ?? 0)
      : (target.config.basePhysicalResist ?? 0);

  // Corrosion adds resist reduction (accumulated over time)
  let resistReduction = target.status.getCorrosionResistDown();

  // Resist penetration from actor passive effects (e.g., talent resistance_ignore)
  resistReduction += aggregateZoneBonuses(state, tags.sourceActorId, "resistance");

  const value = 1 + resistReduction * 0.01 - baseResist * 0.01;
  return {
    name: "Resistance",
    value,
    details: `base=${baseResist}, reduction=${resistReduction.toFixed(1)}`,
  };
}

// ---------------------------------------------------------------------------
// 9. Break Zone (失衡区)
// ---------------------------------------------------------------------------

export function computeBreakZone(ctx: ZoneContext): ZoneResult {
  const { target, state } = ctx;
  const isBroken = target.isBroken(state.getCurrentTime());
  return {
    name: "Break",
    value: isBroken ? 1.3 : 1,
    details: isBroken ? "broken" : "normal",
  };
}

// ---------------------------------------------------------------------------
// 10. Damage Reduction Zone (减伤区)
// ---------------------------------------------------------------------------

export function computeReductionZone(_ctx: ZoneContext): ZoneResult {
  // TODO: enemy-specific damage reduction when data available
  return { name: "Reduction", value: 1 };
}

// ---------------------------------------------------------------------------
// 11. Special Coefficient Zone (特殊系数区)
// ---------------------------------------------------------------------------

/**
 * artsPowerDamageMult for anomaly/burst damage.
 *
 * Uses the verified formula: 1 + artsPower * 0.01
 * Only applies to anomaly-related damage sources.
 *
 * NOTE: The anomaly multiplier functions (getMagicBurstMultiplier etc.)
 * already include artsPowerDamageMult in their output. So the special zone
 * should NOT double-apply it. The special zone now only handles additional
 * special coefficients that are NOT already baked into the multiplier.
 */
export function computeSpecialZone(ctx: ZoneContext): ZoneResult {
  // artsPowerDamageMult is already included in the anomaly multiplier functions
  // (getMagicBurstMultiplier, getAnomalyDirectMultiplier, etc.)
  // No additional special zone scaling needed for anomaly sources.

  let value = 1;
  const pLevel = (ctx.source.stats as any)?._potentialLevel ?? 0;

  // LAEVATAIN P3 (往事碎片): burn damage ×1.5 — independent zone
  if (ctx.tags.sourceActorId === "LAEVATAIN" && pLevel >= 3 && ctx.tags.countsAsBurnDamage) {
    value *= 1.5;
  }

  // AVYWENNA P5 (恩威并施): hit on emag-fragile enemy ×1.15
  if (ctx.tags.sourceActorId === "AVYWENNA" && pLevel >= 5) {
    const time = ctx.state.getCurrentTime();
    let hasEmagFragility = false;
    for (const inst of ctx.target.effects.getAll()) {
      if (time >= inst.effect.startTime + inst.effect.duration) continue;
      const bonuses = inst.effect.properties.dynamicBonuses as any[];
      if (bonuses?.some((b: any) => b.stat === "emag_dmg" && b.zone === "fragility")) {
        hasEmagFragility = true;
        break;
      }
    }
    if (hasEmagFragility) value *= 1.15;
  }

  // FLUORITE 终结技 bomb detonation: if enemy has fluorite_bomb → ult damage +30%
  if (ctx.tags.sourceActorId === "FLUORITE" && ctx.tags.countsAsUltimateSkillDamage) {
    const time = ctx.state.getCurrentTime();
    for (const inst of ctx.target.effects.getAll()) {
      if (inst.effect.id === "fluorite_bomb" && time < inst.effect.startTime + inst.effect.duration) {
        value *= 1.3;
        break;
      }
    }
  }

  // FLUORITE 天赋0 (落井下石爱好者): damage vs slowed target +10/20%
  if (ctx.tags.sourceActorId === "FLUORITE") {
    const time = ctx.state.getCurrentTime();
    let hasSlowDebuff = false;
    for (const inst of ctx.target.effects.getAll()) {
      if (inst.effect.id === "affix_slow" && time < inst.effect.startTime + inst.effect.duration) {
        hasSlowDebuff = true;
        break;
      }
    }
    if (hasSlowDebuff) {
      // Read talent value from _activeEffects
      const talentEffects = (ctx.source.stats as any)?._activeEffects;
      const t0 = talentEffects?.find(
        (e: any) => e.type === "damage_bonus" && e.stat === "all_dmg" && e.scope === "runtime_conditional",
      );
      const bonusPct = t0?.value ?? 10; // default 10%, upgrade 20%
      value *= 1 + bonusPct / 100;
    }
  }

  // PERLICA 天赋0 歼灭协议: damage vs staggered (失衡) enemy +20/30%
  if (ctx.tags.sourceActorId === "PERLICA") {
    // Check if enemy is staggered (has physical anomaly stagger effects)
    const enemyBroken = ctx.state.enemy.status.hasBreak();
    // "失衡" in game terms = enemy has been staggered/broken
    if (enemyBroken) {
      const talentEffects = (ctx.source.stats as any)?._activeEffects;
      const t0 = talentEffects?.find(
        (e: any) => e.type === "damage_bonus" && e.stat === "all_dmg" && e.scope === "runtime_conditional",
      );
      if (t0?.value) {
        value *= 1 + t0.value / 100;
      }
    }
  }

  return { name: "Special", value, details: value !== 1 ? "potential" : undefined };
}

// ---------------------------------------------------------------------------
// Aggregate all zones
// ---------------------------------------------------------------------------

export function computeAllZones(ctx: ZoneContext): ZoneResult[] {
  return [
    computeDefenseZone(ctx),
    computeCritZone(ctx),
    computeDamageBonusZone(ctx),
    computeAmplifyZone(ctx),
    computeComboZone(ctx),
    computeVulnerabilityZone(ctx),
    computeFragilityZone(ctx),
    computeResistanceZone(ctx),
    computeBreakZone(ctx),
    computeReductionZone(ctx),
    computeSpecialZone(ctx),
  ];
}
