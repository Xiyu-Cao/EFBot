/**
 * V2 Weapon Data Types
 */

import type { TriggerEventType, TriggerCondition, DamageElement, DamageSchool, ActionType } from "../types";

/** Common slot modifier — shared across weapons of same tier/size */
export interface CommonSlotDef {
  modifierId: string;   // e.g. "agility", "attack", "cold_dmg", "primary_ability"
  size: "small" | "medium" | "large";
}

/** A single weapon trigger effect (buff application) */
export interface WeaponTrigger {
  id: string;
  name: string;
  /** What event activates this trigger */
  listenTo: TriggerEventType;
  /** Additional condition */
  condition?: TriggerCondition;
  /** Buff target */
  target: "self" | "team" | "others";
  /** Buff stat and zone */
  stat: string;
  zone: string;
  /** Per-tier values (9 entries: tier 1-8 + max tier 9) */
  values: number[];
  /** Buff duration in seconds */
  duration: number;
  /** Stack rules */
  maxStacks: number;
  stackMode: "refresh" | "independent";
  /** Internal cooldown in seconds (0 = no ICD) */
  icd: number;
  /**
   * If set, the buff is not applied immediately but stored and consumed
   * when the next skill of the specified type(s) is cast.
   * The buff applies to ALL damage caused by that skill's effects
   * (including sub-damages like slam, crystal shatter, etc.),
   * not limited to the skill's duration window.
   */
  consumeOnSkillType?: ActionType[];
}

/** Complete weapon definition */
export interface WeaponDefinition {
  id: string;
  name: string;
  type: string;
  rarity: number;
  baseAtk: number;
  /** Common slots (1st and 2nd affixes) */
  commonSlots: CommonSlotDef[];
  /** Passive stats (always active, per-tier) */
  passiveStats: { stat: string; values: number[] }[];
  /** Triggered effects */
  triggers: WeaponTrigger[];
}
