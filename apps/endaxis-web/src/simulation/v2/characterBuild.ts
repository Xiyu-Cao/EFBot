/**
 * V2 Layer 1: Character Build Computation
 *
 * Outputs raw stat components (base values + modifier breakdowns),
 * NOT final computed values like ATK or HP.
 *
 * Final values are computed by Layer 2 at runtime, because buffs
 * can modify any component (ATK%, flat ATK, ability values, etc.).
 *
 * All formulas from: reports/kernel-mechanics-audit-2026-04-09.md
 */

import type { CharacterBuild, DamageElement } from "./types";

// ═══════════════════════════════════════════════════════════════════
// Input types (raw data from game/editor)
// ═══════════════════════════════════════════════════════════════════

/** Raw character data before build computation. */
export interface CharacterInput {
  id: string;
  name: string;
  element: DamageElement;
  rarity: number;

  // Growth
  promotion: number;
  potentialLevel: number;
  talentLevels: Record<string, number>;

  // Base stats from level lookup (immutable per level)
  baseStrength: number;
  baseAgility: number;
  baseIntellect: number;
  baseWill: number;
  baseAttack: number;
  baseHp: number;

  // Main/sub attribute identifiers
  mainAttribute: "strength" | "agility" | "intellect" | "will";
  subAttribute: "strength" | "agility" | "intellect" | "will";

  // Weapon
  weaponId: string | null;
  weaponBaseAtk: number;
  weaponLevel: number;

  // Equipment set
  equipmentSetId: string | null;

  // Gauge
  baseGaugeMax: number;

  // All stat modifiers from weapon/equipment/talents/potentials
  statModifiers: StatModifier[];
}

/** A single stat modifier from any source. */
export interface StatModifier {
  /** Where this modifier comes from. */
  source: string;
  /** Which stat this modifies. */
  stat: string;
  /** The modifier value. */
  value: number;
  /** Flat additive or percentage. */
  type: "flat" | "percent";
}

// ═══════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════

/** Talent row 1 cumulative bonuses per promotion stage. */
const TALENT_ROW1_BONUSES = [0, 10, 15, 15, 20];

// ═══════════════════════════════════════════════════════════════════
// Utility formulas (exported for Layer 2 to use)
// ═══════════════════════════════════════════════════════════════════

/** Truncate to 1 decimal place (floor, not round). */
export function truncate1(v: number): number {
  return Math.floor(v * 10) / 10;
}

/** Compute weapon ATK at a given level. */
export function computeWeaponAtk(baseAtk: number, level: number): number {
  if (!baseAtk || !level) return 0;
  const ratio = 0.25 + 0.75 * (Math.max(1, Math.min(90, level)) - 1) / 89;
  return Math.floor(baseAtk * ratio);
}

/** Compute resistance from attribute value (returns integer). */
export function computeResistance(attributeValue: number): number {
  if (attributeValue <= 0) return 0;
  return Math.round(attributeValue / (attributeValue + 1000) * 100);
}

/** Compute talent row 1 cumulative bonus for a promotion level. */
export function computeTalentRow1Bonus(promotion: number): number {
  let total = 0;
  for (let i = 1; i <= Math.min(promotion, TALENT_ROW1_BONUSES.length - 1); i++) {
    total += TALENT_ROW1_BONUSES[i];
  }
  return total;
}

// ═══════════════════════════════════════════════════════════════════
// Build output — raw components, not final values
// ═══════════════════════════════════════════════════════════════════

/**
 * Stat breakdown: base value + all modifiers, grouped by stat.
 * Layer 2 uses these to compute final values at runtime,
 * accounting for dynamic buffs.
 */
export interface StatBreakdown {
  base: number;
  flatModifiers: { source: string; value: number }[];
  percentModifiers: { source: string; value: number }[];
}

/** All stat breakdowns for a character. */
export interface BuildStats {
  // Base attributes (can be modified by buffs like 负山's ability buff)
  strength: StatBreakdown;
  agility: StatBreakdown;
  intellect: StatBreakdown;
  will: StatBreakdown;

  // Attack components (NOT pre-computed into final ATK)
  baseAttack: number;        // character base attack (from level)
  weaponAttack: number;      // weapon ATK at current level
  attackFlat: StatBreakdown;  // flat ATK bonuses from equipment/buffs
  attackPercent: StatBreakdown; // ATK% bonuses from equipment/buffs

  // HP base (final HP = base + strength × 5, computed at runtime)
  baseHp: number;

  // Main/sub attribute identifiers (for ATK ability multiplier)
  mainAttribute: "strength" | "agility" | "intellect" | "will";
  subAttribute: "strength" | "agility" | "intellect" | "will";

  // Combat stats
  critRate: StatBreakdown;     // base 5% + modifiers
  critDamage: StatBreakdown;   // base 50% + modifiers
  ultChargeEff: StatBreakdown; // base 100 + modifiers

  // Damage bonuses (all %)
  physicalDmg: StatBreakdown;
  blazeDmg: StatBreakdown;
  emagDmg: StatBreakdown;
  coldDmg: StatBreakdown;
  natureDmg: StatBreakdown;
  artsDmg: StatBreakdown;
  attackDmgBonus: StatBreakdown;
  skillDmgBonus: StatBreakdown;
  linkDmgBonus: StatBreakdown;
  ultimateDmgBonus: StatBreakdown;
  allSkillDmgBonus: StatBreakdown;
  brokenDmgBonus: StatBreakdown;

  // Other
  originiumArtsPower: StatBreakdown;
  linkCdReduction: StatBreakdown;
}

// ═══════════════════════════════════════════════════════════════════
// Main build function
// ═══════════════════════════════════════════════════════════════════

function makeBreakdown(base: number): StatBreakdown {
  return { base, flatModifiers: [], percentModifiers: [] };
}

/**
 * Compute a CharacterBuild from raw input.
 *
 * This does NOT compute final ATK/HP/resistance values.
 * It organizes all stat components into breakdowns that
 * Layer 2 can evaluate at runtime (with dynamic buffs).
 */
export function computeCharacterBuild(input: CharacterInput): CharacterBuild & { buildStats: BuildStats } {
  // ── Talent row 1 bonus (main attribute) ──
  const talentBonus = computeTalentRow1Bonus(input.promotion);

  // ── Initialize attribute breakdowns ──
  const strengthBD = makeBreakdown(input.baseStrength);
  const agilityBD = makeBreakdown(input.baseAgility);
  const intellectBD = makeBreakdown(input.baseIntellect);
  const willBD = makeBreakdown(input.baseWill);

  // Apply talent row 1 to main attribute
  const attrMap: Record<string, StatBreakdown> = {
    strength: strengthBD, agility: agilityBD, intellect: intellectBD, will: willBD,
  };
  if (talentBonus > 0) {
    attrMap[input.mainAttribute].flatModifiers.push({ source: "talent_row1", value: talentBonus });
  }

  // ── Weapon ATK ──
  const weaponAtk = computeWeaponAtk(input.weaponBaseAtk, input.weaponLevel);

  // ── Initialize all stat breakdowns ──
  const attackFlatBD = makeBreakdown(0);
  const attackPercentBD = makeBreakdown(0);
  const critRateBD = makeBreakdown(5);      // base 5%
  const critDamageBD = makeBreakdown(50);   // base 50%
  const ultChargeEffBD = makeBreakdown(100);

  const dmgBreakdowns: Record<string, StatBreakdown> = {
    physicalDmg: makeBreakdown(0), blazeDmg: makeBreakdown(0),
    emagDmg: makeBreakdown(0), coldDmg: makeBreakdown(0),
    natureDmg: makeBreakdown(0), artsDmg: makeBreakdown(0),
    attackDmgBonus: makeBreakdown(0), skillDmgBonus: makeBreakdown(0),
    linkDmgBonus: makeBreakdown(0), ultimateDmgBonus: makeBreakdown(0),
    allSkillDmgBonus: makeBreakdown(0), brokenDmgBonus: makeBreakdown(0),
    originiumArtsPower: makeBreakdown(0), linkCdReduction: makeBreakdown(0),
  };

  // ── Route stat modifiers to breakdowns ──
  const allBreakdowns: Record<string, StatBreakdown> = {
    strength: strengthBD, agility: agilityBD, intellect: intellectBD, will: willBD,
    attack_flat: attackFlatBD, attack_percent: attackPercentBD,
    crit_rate: critRateBD, crit_damage: critDamageBD,
    ult_charge_eff: ultChargeEffBD,
    ...dmgBreakdowns,
  };

  for (const mod of input.statModifiers) {
    // Special routing
    if (mod.stat === "attack" && mod.type === "flat") {
      attackFlatBD.flatModifiers.push({ source: mod.source, value: mod.value });
      continue;
    }
    if (mod.stat === "attack_percent" || (mod.stat === "attack" && mod.type === "percent")) {
      attackPercentBD.flatModifiers.push({ source: mod.source, value: mod.value });
      continue;
    }
    if (mod.stat === "crit_rate") {
      critRateBD.flatModifiers.push({ source: mod.source, value: mod.value });
      continue;
    }
    if (mod.stat === "crit_damage" || mod.stat === "crit_dmg") {
      critDamageBD.flatModifiers.push({ source: mod.source, value: mod.value });
      continue;
    }
    if (mod.stat === "ult_charge_eff") {
      ultChargeEffBD.flatModifiers.push({ source: mod.source, value: mod.value });
      continue;
    }

    // Map stat names to breakdown keys
    const keyMap: Record<string, string> = {
      physical_dmg: "physicalDmg", blaze_dmg: "blazeDmg", emag_dmg: "emagDmg",
      cold_dmg: "coldDmg", nature_dmg: "natureDmg", arts_dmg: "artsDmg",
      attack_dmg_bonus: "attackDmgBonus", skill_dmg_bonus: "skillDmgBonus",
      link_dmg_bonus: "linkDmgBonus", ultimate_dmg_bonus: "ultimateDmgBonus",
      all_skill_dmg_bonus: "allSkillDmgBonus", broken_dmg_bonus: "brokenDmgBonus",
      originium_arts_power: "originiumArtsPower", link_cd_reduction: "linkCdReduction",
    };

    const bdKey = keyMap[mod.stat] || mod.stat;
    const bd = allBreakdowns[bdKey];
    if (bd) {
      if (mod.type === "flat") {
        bd.flatModifiers.push({ source: mod.source, value: mod.value });
      } else {
        bd.percentModifiers.push({ source: mod.source, value: mod.value });
      }
    }
  }

  // ── Gauge max ──
  let gaugeMax = input.baseGaugeMax;
  for (const mod of input.statModifiers) {
    if (mod.stat === "gaugeMax" || mod.stat === "ult_gauge_cost") {
      if (mod.type === "percent") {
        gaugeMax = Math.round(gaugeMax * (1 + mod.value / 100));
      } else {
        gaugeMax += mod.value;
      }
    }
  }
  gaugeMax = Math.max(1, gaugeMax);

  // ── Assemble ──
  // For CharacterBuild.stats, compute a snapshot (used by UI display).
  // Layer 2 will recompute from buildStats at runtime with buffs.
  const sumBreakdown = (bd: StatBreakdown) =>
    bd.base + bd.flatModifiers.reduce((s, m) => s + m.value, 0);

  const stats = {
    strength: sumBreakdown(strengthBD),
    agility: sumBreakdown(agilityBD),
    intellect: sumBreakdown(intellectBD),
    will: sumBreakdown(willBD),
    attack: 0,   // placeholder — computed at runtime
    hp: 0,       // placeholder — computed at runtime
    physicalResist: 0, blazeResist: 0, emagResist: 0,
    coldResist: 0, natureResist: 0, beyondResist: 0,
    healingEfficiency: 0,
    critRate: sumBreakdown(critRateBD),
    critDamage: sumBreakdown(critDamageBD),
    ultChargeEff: sumBreakdown(ultChargeEffBD),
    physicalDmg: sumBreakdown(dmgBreakdowns.physicalDmg),
    blazeDmg: sumBreakdown(dmgBreakdowns.blazeDmg),
    emagDmg: sumBreakdown(dmgBreakdowns.emagDmg),
    coldDmg: sumBreakdown(dmgBreakdowns.coldDmg),
    natureDmg: sumBreakdown(dmgBreakdowns.natureDmg),
    artsDmg: sumBreakdown(dmgBreakdowns.artsDmg),
    attackDmgBonus: sumBreakdown(dmgBreakdowns.attackDmgBonus),
    skillDmgBonus: sumBreakdown(dmgBreakdowns.skillDmgBonus),
    linkDmgBonus: sumBreakdown(dmgBreakdowns.linkDmgBonus),
    ultimateDmgBonus: sumBreakdown(dmgBreakdowns.ultimateDmgBonus),
    allSkillDmgBonus: sumBreakdown(dmgBreakdowns.allSkillDmgBonus),
    brokenDmgBonus: sumBreakdown(dmgBreakdowns.brokenDmgBonus),
    originiumArtsPower: sumBreakdown(dmgBreakdowns.originiumArtsPower),
    linkCdReduction: sumBreakdown(dmgBreakdowns.linkCdReduction),
  };

  const buildStats: BuildStats = {
    strength: strengthBD,
    agility: agilityBD,
    intellect: intellectBD,
    will: willBD,
    baseAttack: input.baseAttack,
    weaponAttack: weaponAtk,
    attackFlat: attackFlatBD,
    attackPercent: attackPercentBD,
    baseHp: input.baseHp,
    mainAttribute: input.mainAttribute,
    subAttribute: input.subAttribute,
    critRate: critRateBD,
    critDamage: critDamageBD,
    ultChargeEff: ultChargeEffBD,
    physicalDmg: dmgBreakdowns.physicalDmg,
    blazeDmg: dmgBreakdowns.blazeDmg,
    emagDmg: dmgBreakdowns.emagDmg,
    coldDmg: dmgBreakdowns.coldDmg,
    natureDmg: dmgBreakdowns.natureDmg,
    artsDmg: dmgBreakdowns.artsDmg,
    attackDmgBonus: dmgBreakdowns.attackDmgBonus,
    skillDmgBonus: dmgBreakdowns.skillDmgBonus,
    linkDmgBonus: dmgBreakdowns.linkDmgBonus,
    ultimateDmgBonus: dmgBreakdowns.ultimateDmgBonus,
    allSkillDmgBonus: dmgBreakdowns.allSkillDmgBonus,
    brokenDmgBonus: dmgBreakdowns.brokenDmgBonus,
    originiumArtsPower: dmgBreakdowns.originiumArtsPower,
    linkCdReduction: dmgBreakdowns.linkCdReduction,
  };

  return {
    id: input.id,
    name: input.name,
    element: input.element,
    rarity: input.rarity,
    stats,
    potentialLevel: input.potentialLevel,
    talentLevels: { ...input.talentLevels },
    weaponId: input.weaponId,
    equipmentSetId: input.equipmentSetId,
    gaugeMax,
    buildStats,
  };
}
