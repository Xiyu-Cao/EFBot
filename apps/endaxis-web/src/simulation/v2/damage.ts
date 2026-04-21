/**
 * V2 Layer 2: Damage Calculation
 *
 * Implements the 11-zone multiplicative damage formula and crit system.
 * All functions are pure — no side effects, no state mutation.
 *
 * Formula from: reports/kernel-mechanics-audit-2026-04-09.md §1
 */

import type { DamageElement, DamageSchool, ActionType, MultiplierRef } from "./types";
import type { BuildStats } from "./characterBuild";
import { truncate1 } from "./characterBuild";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve a MultiplierRef to an actual percentage value.
 *
 * @param ref - The multiplier reference
 * @param lookupFn - Function that returns the raw value from skills.json
 *                   for a given label at the current skill level.
 *                   Should return the percentage number (e.g., 140 for 140%).
 */
export function resolveMultiplier(
  ref: MultiplierRef,
  lookupFn: (label: string) => number,
): number {
  const rawValue = lookupFn(ref.label);
  if (ref.share === "equal" && ref.equalCount && ref.equalCount > 0) {
    return rawValue / ref.equalCount;
  }
  if (typeof ref.share === "number") {
    return rawValue * ref.share;
  }
  return rawValue;
}

/** All inputs needed to resolve a single damage instance. */
export interface DamageContext {
  // Source
  source: {
    buildStats: BuildStats;
    /** Active buffs modifying stats at this moment. */
    buffModifiers: BuffModifiers;
  };
  // Target
  target: {
    defenseMultiplier: number;  // default 0.5
    /** Per-school base resist (integer). */
    resistPhysical: number;
    resistBlaze: number;
    resistEmag: number;
    resistCold: number;
    resistNature: number;
    /** Resist reduction from corrosion + talents (integer). */
    resistReduction: number;
    /** Is target in stagger state? (1.3x multiplier) */
    isStaggered: boolean;
    /** Vulnerability bonuses on target (%). */
    vulnerability: number;
    /** Fragility bonuses on target, per-school (%). */
    physicalFragility: number;
    magicFragility: number;
    /** Element-specific fragility (%). */
    elementFragility: Record<DamageElement, number>;
  };
  // Hit info
  multiplier: number;       // skill multiplier (e.g., 140 = 140%)
  element: DamageElement;
  school: DamageSchool;
  sourceType: ActionType;   // for damage bonus routing
  canCrit: boolean;
  // Crit
  critMode: "real" | "expected";
  rng: () => number;        // RNG for real mode
}

/** Active buff modifiers applied at this moment. */
export interface BuffModifiers {
  // ATK modifiers (additive within each category)
  attackFlat: number;       // extra flat ATK from buffs
  attackPercent: number;    // extra ATK% from buffs
  // Ability modifiers
  abilityFlat: Record<string, number>;  // e.g., { strength: 20 } from buff

  // Damage zone bonuses — global (all %)
  damageBonus: number;      // 增伤区 additive bonus (all damage)
  amplify: number;          // 增幅区 additive bonus
  combo: number;            // 连击区 additive bonus
  special: number;          // 特殊区 multiplicative factor (1.0 = no change)

  // Damage zone bonuses — stat-specific (only apply to matching damage)
  physicalDmg: number;      // physical school
  artsDmg: number;          // magic school
  blazeDmg: number;         // blaze element
  coldDmg: number;          // cold element
  emagDmg: number;          // emag element
  natureDmg: number;        // nature element
  attackDmgBonus: number;   // attack source type
  skillDmgBonus: number;    // skill source type
  linkDmgBonus: number;     // link source type
  ultimateDmgBonus: number; // ultimate source type
  allSkillDmgBonus: number; // skill/link/ultimate source types
  brokenDmgBonus: number;   // stagger state bonus

  // Crit modifiers
  critRateBonus: number;    // added to base crit rate
  critDamageBonus: number;  // added to base crit damage
}

/** Result of a damage calculation. */
export interface DamageResult {
  finalDamage: number;
  isCrit: boolean;
  /** Breakdown of each zone's multiplier (for debug/display). */
  zones: {
    atk: number;
    skillMult: number;
    defense: number;
    crit: number;
    damageBonus: number;
    amplify: number;
    combo: number;
    vulnerability: number;
    fragility: number;
    resistance: number;
    stagger: number;
    reduction: number;
    special: number;
  };
}

// ═══════════════════════════════════════════════════════════════════
// ATK computation (from BuildStats + buffs)
// ═══════════════════════════════════════════════════════════════════

/** Sum a StatBreakdown's flat modifiers. */
function sumFlat(bd: { base: number; flatModifiers: { value: number }[] }): number {
  return bd.base + bd.flatModifiers.reduce((s, m) => s + m.value, 0);
}

/**
 * Compute effective ATK from build stats and current buffs.
 *
 * Formula:
 *   rawAtk = (baseAttack + weaponAttack + equipFlat + buffFlat) × (1 + equipPct% + buffPct%)
 *   primary = (baseAttr + mods + buffAttr) × 0.5, truncated to 1dp
 *   secondary = (baseAttr + mods + buffAttr) × 0.2, truncated to 1dp
 *   ATK = floor(rawAtk × (1 + primary/100 + secondary/100))
 */
export function computeEffectiveATK(buildStats: BuildStats, buffs: BuffModifiers): number {
  // Base + weapon + flat from equipment
  const baseRaw = buildStats.baseAttack + buildStats.weaponAttack + sumFlat(buildStats.attackFlat);
  // Add buff flat ATK
  const totalFlat = baseRaw + buffs.attackFlat;
  // Percent: equipment + buff
  const totalPercent = sumFlat(buildStats.attackPercent) + buffs.attackPercent;
  // Apply percent
  const rawAtk = totalPercent !== 0
    ? Math.floor(totalFlat * (1 + totalPercent / 100))
    : totalFlat;

  // Ability multiplier
  const mainAttr = sumFlat(buildStats[buildStats.mainAttribute]) + (buffs.abilityFlat[buildStats.mainAttribute] || 0);
  const subAttr = sumFlat(buildStats[buildStats.subAttribute]) + (buffs.abilityFlat[buildStats.subAttribute] || 0);
  const primaryPct = truncate1(mainAttr * 0.5);
  const secondaryPct = truncate1(subAttr * 0.2);

  return Math.floor(rawAtk * (1 + primaryPct / 100 + secondaryPct / 100));
}

// ═══════════════════════════════════════════════════════════════════
// Damage bonus zone routing
// ═══════════════════════════════════════════════════════════════════

/** Get the base damage bonus for a given element and action type from build stats + buff modifiers. */
function getBaseDamageBonus(buildStats: BuildStats, buffMods: BuffModifiers, element: DamageElement, school: DamageSchool, sourceType: ActionType): number {
  let bonus = 0;

  // School-based bonus
  if (school === "physical") bonus += sumFlat(buildStats.physicalDmg) + buffMods.physicalDmg;
  else bonus += sumFlat(buildStats.artsDmg) + buffMods.artsDmg;

  // Element-based bonus
  switch (element) {
    case "blaze": bonus += sumFlat(buildStats.blazeDmg) + buffMods.blazeDmg; break;
    case "cold": bonus += sumFlat(buildStats.coldDmg) + buffMods.coldDmg; break;
    case "emag": bonus += sumFlat(buildStats.emagDmg) + buffMods.emagDmg; break;
    case "nature": bonus += sumFlat(buildStats.natureDmg) + buffMods.natureDmg; break;
  }

  // Action type bonus
  switch (sourceType) {
    case "attack": bonus += sumFlat(buildStats.attackDmgBonus) + buffMods.attackDmgBonus; break;
    case "skill": bonus += sumFlat(buildStats.skillDmgBonus) + buffMods.skillDmgBonus; break;
    case "link": bonus += sumFlat(buildStats.linkDmgBonus) + buffMods.linkDmgBonus; break;
    case "ultimate": bonus += sumFlat(buildStats.ultimateDmgBonus) + buffMods.ultimateDmgBonus; break;
  }

  // All-skill bonus (applies to skill/link/ultimate, not attack)
  if (sourceType === "skill" || sourceType === "link" || sourceType === "ultimate") {
    bonus += sumFlat(buildStats.allSkillDmgBonus) + buffMods.allSkillDmgBonus;
  }

  return bonus;
}

// ═══════════════════════════════════════════════════════════════════
// Resistance zone
// ═══════════════════════════════════════════════════════════════════

function getBaseResist(target: DamageContext["target"], element: DamageElement, school: DamageSchool): number {
  if (school === "physical") return target.resistPhysical;
  switch (element) {
    case "blaze": return target.resistBlaze;
    case "cold": return target.resistCold;
    case "emag": return target.resistEmag;
    case "nature": return target.resistNature;
    default: return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Fragility zone
// ═══════════════════════════════════════════════════════════════════

function getFragility(target: DamageContext["target"], element: DamageElement, school: DamageSchool): number {
  let total = 0;
  // School-based fragility
  if (school === "physical") total += target.physicalFragility;
  else total += target.magicFragility;
  // Element-specific fragility
  total += target.elementFragility[element] || 0;
  return total;
}

// ═══════════════════════════════════════════════════════════════════
// Crit resolution
// ═══════════════════════════════════════════════════════════════════

interface CritResult {
  multiplier: number;
  isCrit: boolean;
}

function resolveCrit(ctx: DamageContext): CritResult {
  if (!ctx.canCrit) return { multiplier: 1, isCrit: false };

  const totalRate = Math.min(100, Math.max(0,
    sumFlat(ctx.source.buildStats.critRate) + ctx.source.buffModifiers.critRateBonus
  ));
  const totalDmg = sumFlat(ctx.source.buildStats.critDamage) + ctx.source.buffModifiers.critDamageBonus;
  const critDmgRatio = totalDmg / 100; // 50% → 0.5

  if (ctx.critMode === "expected") {
    return {
      multiplier: 1 + (totalRate / 100) * critDmgRatio,
      isCrit: false, // no binary crit in expected mode
    };
  }

  // Real mode: roll
  const roll = ctx.rng();
  if (roll < totalRate / 100) {
    return { multiplier: 1 + critDmgRatio, isCrit: true };
  }
  return { multiplier: 1, isCrit: false };
}

// ═══════════════════════════════════════════════════════════════════
// Main damage resolver
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve a single damage instance through all 11 zones.
 *
 * finalDamage = floor(
 *   ATK × skillMult
 *   × defense × crit × damageBonus × amplify
 *   × combo × vulnerability × fragility × resistance
 *   × stagger × reduction × special
 * )
 */
export function resolveDamage(ctx: DamageContext): DamageResult {
  const { source, target, multiplier, element, school, sourceType } = ctx;

  // ATK
  const atk = computeEffectiveATK(source.buildStats, source.buffModifiers);
  const skillMult = multiplier / 100; // 140% → 1.4

  // Zone 1: Defense
  const defense = target.defenseMultiplier;

  // Zone 2: Crit
  const crit = resolveCrit(ctx);

  // Zone 3: Damage Bonus (增伤区)
  const baseDmgBonus = getBaseDamageBonus(source.buildStats, source.buffModifiers, element, school, sourceType);
  // Add broken damage bonus if target is staggered
  const brokenBonus = target.isStaggered ? (sumFlat(source.buildStats.brokenDmgBonus) + source.buffModifiers.brokenDmgBonus) : 0;
  const damageBonusZone = 1 + (baseDmgBonus + brokenBonus + source.buffModifiers.damageBonus) / 100;

  // Zone 4: Amplify (增幅区)
  const amplifyZone = 1 + source.buffModifiers.amplify / 100;

  // Zone 5: Combo (连击区)
  const comboZone = 1 + source.buffModifiers.combo / 100;

  // Zone 6: Vulnerability (易伤区)
  const vulnerabilityZone = 1 + target.vulnerability / 100;

  // Zone 7: Fragility (脆弱区)
  const fragilityTotal = getFragility(target, element, school);
  const fragilityZone = 1 + fragilityTotal / 100;

  // Zone 8: Resistance (抗性区)
  const baseResist = getBaseResist(target, element, school);
  const resistanceZone = 1 + target.resistReduction * 0.01 - baseResist * 0.01;

  // Zone 9: Stagger (失衡区)
  const staggerZone = target.isStaggered ? 1.3 : 1;

  // Zone 10: Reduction (减伤区) — placeholder
  const reductionZone = 1;

  // Zone 11: Special (特殊区)
  const specialZone = source.buffModifiers.special || 1;

  // Final calculation
  const raw = atk * skillMult
    * defense * crit.multiplier * damageBonusZone * amplifyZone
    * comboZone * vulnerabilityZone * fragilityZone * resistanceZone
    * staggerZone * reductionZone * specialZone;

  return {
    finalDamage: Math.floor(raw),
    isCrit: crit.isCrit,
    zones: {
      atk,
      skillMult,
      defense,
      crit: crit.multiplier,
      damageBonus: damageBonusZone,
      amplify: amplifyZone,
      combo: comboZone,
      vulnerability: vulnerabilityZone,
      fragility: fragilityZone,
      resistance: resistanceZone,
      stagger: staggerZone,
      reduction: reductionZone,
      special: specialZone,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Default buff modifiers (no buffs active)
// ═══════════════════════════════════════════════════════════════════

export function emptyBuffModifiers(): BuffModifiers {
  return {
    attackFlat: 0,
    attackPercent: 0,
    abilityFlat: {},
    damageBonus: 0,
    amplify: 0,
    combo: 0,
    special: 1,
    physicalDmg: 0,
    artsDmg: 0,
    blazeDmg: 0,
    coldDmg: 0,
    emagDmg: 0,
    natureDmg: 0,
    attackDmgBonus: 0,
    skillDmgBonus: 0,
    linkDmgBonus: 0,
    ultimateDmgBonus: 0,
    allSkillDmgBonus: 0,
    brokenDmgBonus: 0,
    critRateBonus: 0,
    critDamageBonus: 0,
  };
}
