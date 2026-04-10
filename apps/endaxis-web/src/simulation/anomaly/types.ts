/**
 * Type definitions for the attachment / anomaly / reaction subsystem.
 *
 * This file is intentionally self-contained so the anomaly layer
 * can be understood without reading the rest of the simulation.
 */

// ---------------------------------------------------------------------------
// Element & anomaly enum types
// ---------------------------------------------------------------------------

/** The four magic elements that can be "attached" to a target. */
export type MagicElement = "fire" | "cold" | "electro" | "nature";

/** Physical anomaly types that interact with the break system. */
export type PhysicalAnomalyType = "launch" | "knockdown" | "armorBreak" | "slam";

/** Anomaly debuff types that can exist on a target. */
export type AnomalyDebuffType = "burn" | "freeze" | "conduction" | "corrosion";

/** 1-4 level derived from attachment stacks or direct application. */
export type AnomalyLevel = 1 | 2 | 3 | 4;

// ---------------------------------------------------------------------------
// State snapshots (stored on EnemyStatusState)
// ---------------------------------------------------------------------------

export interface MagicAttachment {
  element: MagicElement;
  stacks: number;    // 1–4
  expiresAt: number; // game time
}

export interface PhysicalBreak {
  stacks: number;    // 1–4
  expiresAt: number;
}

export interface BurnState {
  level: AnomalyLevel;
  expiresAt: number;
  lastTickTime: number;
  sourceActorId: string;
}

export interface FreezeState {
  level: AnomalyLevel;
  expiresAt: number;
  shattered: boolean;
  sourceActorId: string;
}

export interface ConductionState {
  level: AnomalyLevel;
  expiresAt: number;
  sourceActorId: string;
}

export interface CorrosionState {
  level: AnomalyLevel;
  expiresAt: number;
  currentResistDown: number;
  perSecondDelta: number;
  maxResistDown: number;
  sourceActorId: string;
}

// ---------------------------------------------------------------------------
// Lookup tables
// ---------------------------------------------------------------------------

export const MAGIC_ATTACHMENT_DURATION = 30;
export const PHYSICAL_BREAK_DURATION = 30;
export const MAGIC_ATTACHMENT_MAX_STACKS = 4;
export const PHYSICAL_BREAK_MAX_STACKS = 4;

export const BURN_DURATION = 10;
export const BURN_TICK_INTERVAL = 1;

export const FREEZE_DURATION_BY_LEVEL: Record<AnomalyLevel, number> = {
  1: 6, 2: 7, 3: 8, 4: 9,
};

export const CONDUCTION_PERCENT_BY_LEVEL: Record<AnomalyLevel, number> = {
  1: 12, 2: 16, 3: 20, 4: 24,
};

export const CONDUCTION_DURATION_BY_LEVEL: Record<AnomalyLevel, number> = {
  1: 12, 2: 18, 3: 24, 4: 30,
};

export const CORROSION_DURATION = 15;

/**
 * Maps a cross-element reaction to the anomaly debuff it produces.
 * Same-element → null (produces burst, not anomaly).
 */
export const CROSS_ELEMENT_ANOMALY: Record<MagicElement, AnomalyDebuffType | null> = {
  fire: "burn",
  cold: "freeze",
  electro: "conduction",
  nature: "corrosion",
};

// ---------------------------------------------------------------------------
// Resolver output types
// ---------------------------------------------------------------------------

/** An outcome produced by a resolver that the handler turns into events/logs. */
export type ResolverOutcome =
  | { type: "MAGIC_BURST_DAMAGE";   element: MagicElement; stacks: number; sourceActorId: string }
  | { type: "REACTION_DAMAGE";      anomalyType: AnomalyDebuffType; level: AnomalyLevel; sourceActorId: string; incomingElement: MagicElement }
  | { type: "ANOMALY_APPLIED";      anomalyType: AnomalyDebuffType; level: AnomalyLevel; sourceActorId: string }
  | { type: "PHYSICAL_DAMAGE";      physicalType: PhysicalAnomalyType; sourceActorId: string; breakStacks: number }
  | { type: "ICE_SHATTER_DAMAGE";   level: AnomalyLevel; sourceActorId: string }
  | { type: "BREAK_CHANGED";        stacks: number }
  | { type: "BREAK_CLEARED" }
  | { type: "ATTACHMENT_CHANGED";    element: MagicElement; stacks: number }
  | { type: "ATTACHMENT_CLEARED" }
  | { type: "PHYSICAL_VULN_APPLIED"; sourceActorId: string; physVulnPercent: number; vulnDuration: number }
  | { type: "BURN_TICK";            level: AnomalyLevel; sourceActorId: string };

// ---------------------------------------------------------------------------
// DamageTags — canonical definition moved to calculation/damageTypes.ts
// ---------------------------------------------------------------------------

/**
 * Re-export from canonical location.
 * All new code should import from "@/simulation/calculation/damageTypes".
 */
export type {
  DamageTags,
  DamageType,
  DamageSchool,
  DamageSource,
} from "../calculation/damageTypes";

export {
  buildDamageTags,
  magicElementToDamageType,
  actionElementToDamageType,
  actionTypeToDamageSource,
  getDamageSchool,
} from "../calculation/damageTypes";
