/**
 * Core damage type system for the damage calculation pipeline.
 *
 * Every damage instance has:
 * - DamageType: the elemental type (burn/cold/electro/nature/physical/extradomain)
 * - DamageSchool: magic or physical (derived from DamageType)
 * - DamageSource: what originated this damage (skill type, anomaly, etc.)
 * - DamageTags: full classification metadata for buff/modifier matching
 */

// ---------------------------------------------------------------------------
// Core enums
// ---------------------------------------------------------------------------

/** The elemental type of a damage instance. */
export type DamageType =
  | "burn"
  | "cold"
  | "electro"
  | "nature"
  | "physical"
  | "extradomain";

/** Broad school: magic or physical. Derived from DamageType. */
export type DamageSchool = "magic" | "physical";

/** What originated this damage instance. */
export type DamageSource =
  | "normalAttack"
  | "heavyAttack"
  | "activeSkill"
  | "comboSkill"
  | "ultimateSkill"
  | "magicAttachmentBurst"
  | "magicAnomalyDirect"
  | "burnTick"
  | "shatter"
  | "physicalAnomaly"
  | "equipmentProc";

// ---------------------------------------------------------------------------
// DamageTags
// ---------------------------------------------------------------------------

/**
 * Metadata attached to every damage instance for filtering / aggregation.
 *
 * These tags drive buff matching in the multiplier zones.
 */
export interface DamageTags {
  sourceActorId: string;
  targetEnemyId: string;
  sourceSkillId?: string;
  sourceEffectId?: string;

  damageType: DamageType;
  damageSchool: DamageSchool;
  damageSource: DamageSource;

  /** Always true — matches "造成的伤害增加" (all damage increase). */
  countsAsAllDamage: true;

  countsAsNormalAttackDamage: boolean;
  /** Heavy attack is a subset of normal attack. */
  countsAsHeavyAttackDamage: boolean;
  countsAsActiveSkillDamage: boolean;
  countsAsComboSkillDamage: boolean;
  countsAsUltimateSkillDamage: boolean;
  countsAsMagicAttachmentBurstDamage: boolean;
  countsAsMagicAnomalyDirectDamage: boolean;
  countsAsBurnDamage: boolean;
  countsAsShatterDamage: boolean;
  countsAsPhysicalAnomalyDamage: boolean;
  countsAsEquipmentProcDamage: boolean;

  canCrit: boolean;
  isDot: boolean;
  critScope: "shared" | "perHit";
}

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

export function getDamageSchool(type: DamageType): DamageSchool {
  if (type === "physical") return "physical";
  // burn, cold, electro, nature, extradomain are all magic
  return "magic";
}

/**
 * Map action element strings (from scenario data) to DamageType.
 * Scenario uses "blaze"/"emag" etc., game model uses "burn"/"electro".
 */
export function actionElementToDamageType(element: string): DamageType {
  switch (element) {
    case "blaze":
    case "fire":
      return "burn";
    case "cold":
    case "cryo":
      return "cold";
    case "emag":
    case "electro":
    case "electric":
      return "electro";
    case "nature":
      return "nature";
    case "physical":
      return "physical";
    default:
      // TODO: handle extradomain when characters use it
      return "physical";
  }
}

/** Map MagicElement ("fire"|"cold"|"electro"|"nature") to DamageType. */
export function magicElementToDamageType(
  element: "fire" | "cold" | "electro" | "nature" | string,
): DamageType {
  switch (element) {
    case "fire":
      return "burn";
    case "cold":
      return "cold";
    case "electro":
      return "electro";
    case "nature":
      return "nature";
    default:
      return "physical";
  }
}

/**
 * Map ActionType to DamageSource.
 * Note: ActionType "attack" means 重击 (heavy attack) in this game.
 */
export function actionTypeToDamageSource(actionType: string): DamageSource {
  switch (actionType) {
    case "attack":
      return "heavyAttack"; // 重击 is a subset of normal attack
    case "execution":
      return "normalAttack"; // TODO: verify execution damage source
    case "skill":
      return "activeSkill";
    case "link":
      return "comboSkill";
    case "ultimate":
      return "ultimateSkill";
    default:
      return "normalAttack";
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a complete DamageTags from minimal parameters.
 * Automatically derives school and sets countsAs* flags.
 */
export function buildDamageTags(params: {
  sourceActorId: string;
  targetEnemyId: string;
  damageType: DamageType;
  damageSource: DamageSource;
  sourceSkillId?: string;
  sourceEffectId?: string;
  canCrit?: boolean;
  isDot?: boolean;
  critScope?: "shared" | "perHit";
}): DamageTags {
  const { damageSource: source, damageType } = params;
  const school = getDamageSchool(damageType);

  // Burn ticks cannot crit by default
  const defaultCanCrit = source !== "burnTick";
  // Only burn ticks are DoT by default
  const defaultIsDot = source === "burnTick";

  return {
    sourceActorId: params.sourceActorId,
    targetEnemyId: params.targetEnemyId,
    sourceSkillId: params.sourceSkillId,
    sourceEffectId: params.sourceEffectId,

    damageType,
    damageSchool: school,
    damageSource: source,

    countsAsAllDamage: true,
    // Heavy attack is a subset of normal attack damage
    countsAsNormalAttackDamage:
      source === "normalAttack" || source === "heavyAttack",
    countsAsHeavyAttackDamage: source === "heavyAttack",
    countsAsActiveSkillDamage: source === "activeSkill",
    countsAsComboSkillDamage: source === "comboSkill",
    countsAsUltimateSkillDamage: source === "ultimateSkill",
    countsAsMagicAttachmentBurstDamage: source === "magicAttachmentBurst",
    countsAsMagicAnomalyDirectDamage: source === "magicAnomalyDirect",
    countsAsBurnDamage: source === "burnTick",
    countsAsShatterDamage: source === "shatter",
    countsAsPhysicalAnomalyDamage: source === "physicalAnomaly",
    countsAsEquipmentProcDamage: source === "equipmentProc",

    canCrit: params.canCrit ?? defaultCanCrit,
    isDot: params.isDot ?? defaultIsDot,
    critScope: params.critScope ?? "shared",
  };
}
