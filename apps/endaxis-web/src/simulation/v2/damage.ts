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
  /** When true, sourceType-based bonuses are skipped (attack/skill/link/ultimate
   *  + allSkill). Used for magic anomaly trigger damage which is not considered
   *  a skill. Element and school bonuses still apply. */
  skipSourceTypeBonus?: boolean;
  // Crit
  critMode: "real" | "expected";
  rng: () => number;        // RNG for real mode
  /** Stable key identifying the crit prob event for this damage instance.
   *  Format: `crit:<actionId>:<hitIndex>:<damageIdx>`. Used to look up
   *  user-supplied probLocks. Optional — kernel only sets it when locks
   *  may apply (damage-calc page); other call sites can leave undefined. */
  critEventKey?: string;
  /** User-supplied locks: probEventKey → "yes" (force trigger) | "no" (force skip).
   *  Locks take priority over critMode; missing entries fall back to mode. */
  probLocks?: Map<string, "yes" | "no">;
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

  // ─── Enemy-side debuff aggregations ─────────────────────────────────
  // These are populated only when aggregating an enemy's BuffManager
  // (target-side debuffs like 物理脆弱/灼热脆弱/易伤). They are read by
  // EnemyState getters that combine them with baseline + hardcoded specials
  // (armor-break vuln, conduction fragility, etc.) and surface through
  // DamageContext.target.* fields. Source-side (actor) buff aggregation
  // ignores these — they're zero-valued unless explicitly applied via
  // `buff_apply target: enemy stat: X_dmg zone: vulnerability`.
  vulnerabilityAll: number;       // 易伤 (all damage) (%)
  physicalVulnerability: number;  // 物理脆弱 (%)
  artsVulnerability: number;      // 法术脆弱 (%)
  blazeVulnerability: number;     // 灼热脆弱 (%)
  coldVulnerability: number;      // 寒冷脆弱 (%)
  emagVulnerability: number;      // 电磁脆弱 (%)
  natureVulnerability: number;    // 自然脆弱 (%)
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
function getBaseDamageBonus(buildStats: BuildStats, buffMods: BuffModifiers, element: DamageElement, school: DamageSchool, sourceType: ActionType, skipSourceTypeBonus: boolean): number {
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

  if (skipSourceTypeBonus) return bonus;

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
// Probability event resolution (unified for crit + future variant locks)
// ═══════════════════════════════════════════════════════════════════

export type ProbEventOutcome =
  | { kind: "binary"; yes: boolean }   // real-mode roll OR locked outcome
  | { kind: "expected"; weight: number }; // expected-mode → caller blends

/**
 * Resolve a probability event. Lock > mode > roll.
 *
 * - If `probLocks` has the key → forced binary outcome (overrides mode).
 * - Else if mode is "expected" → return weight, caller blends both branches.
 * - Else "real" → roll once via rng.
 */
export function resolveProbEvent(
  key: string | undefined,
  weight: number,
  mode: "real" | "expected",
  rng: () => number,
  probLocks?: Map<string, "yes" | "no">,
): ProbEventOutcome {
  if (key && probLocks) {
    const locked = probLocks.get(key);
    if (locked === "yes") return { kind: "binary", yes: true };
    if (locked === "no")  return { kind: "binary", yes: false };
  }
  if (mode === "expected") {
    return { kind: "expected", weight: Math.max(0, Math.min(1, weight)) };
  }
  // Real mode
  return { kind: "binary", yes: rng() < weight };
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
  const weight = totalRate / 100;

  const outcome = resolveProbEvent(ctx.critEventKey, weight, ctx.critMode, ctx.rng, ctx.probLocks);

  if (outcome.kind === "expected") {
    // Expected mode: blend both branches by probability.
    return {
      multiplier: 1 + outcome.weight * critDmgRatio,
      isCrit: false, // no binary crit in expected mode
    };
  }
  // Binary outcome (real-roll or locked).
  return outcome.yes
    ? { multiplier: 1 + critDmgRatio, isCrit: true }
    : { multiplier: 1, isCrit: false };
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
  // Endfield 防御乘区 = 100 / (100 + DEF). 100 防御 → 0.5, 0 → 1.0, 200 → 0.333.
  // Currently `defenseMultiplier` is the pre-computed result (all enemies are
  // modelled as 100 DEF → 0.5); switch to deriving from an enemy.defense stat
  // once per-encounter defense values exist.
  const defense = target.defenseMultiplier;

  // Zone 2: Crit
  const crit = resolveCrit(ctx);

  // Zone 3: Damage Bonus (增伤区)
  const baseDmgBonus = getBaseDamageBonus(source.buildStats, source.buffModifiers, element, school, sourceType, ctx.skipSourceTypeBonus === true);
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
  // baseResist (敌人抗性) ≤ 100. resistReduction (削抗) 无上限。
  // 下限 0.1 = 90% 减伤上限（游戏机制）。上限不夹（莱万汀对 0 抗目标削抗也算正向加成）。
  const baseResist = getBaseResist(target, element, school);
  const resistanceZone = Math.max(0.1, 1 + target.resistReduction * 0.01 - baseResist * 0.01);

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
    vulnerabilityAll: 0,
    physicalVulnerability: 0,
    artsVulnerability: 0,
    blazeVulnerability: 0,
    coldVulnerability: 0,
    emagVulnerability: 0,
    natureVulnerability: 0,
  };
}
