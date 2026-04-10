import type {
  ActorStats,
  ResolvedAction,
} from "@/simulation/compiler/types.ts";
import type { EffectSnapshot } from "@/simulation/effects/types.ts";

export interface ActorSnapshot {
  id: string;
  stats: ActorStats;
  resources: {
    hp: number;
    gauge: number;
    /** Per-actor ultimate gauge cap. Default 100. */
    maxGauge: number;
  };
  cooldowns: Map<string, number>;
  activeBuffs: Map<string, EffectSnapshot>;
  activeAction?: ResolvedAction;
}

export interface TeamConfig {
  maxSp: number;
  initialSp: number;
  spRegenRate: number;
  skillSpCostDefault: number;
  linkCdReduction: number;
}

export interface TeamSnapshot {
  /** Total SP (trueSP + refundSP). */
  sp: number;
  /** SP that generates ultimate charge when consumed. */
  trueSP: number;
  /** SP returned by skills; consumed first, does NOT generate ultimate charge. */
  refundSP: number;
  spRegenRate: number;
  maxSp: number;
  isSpRegenPaused: boolean;
  spRegenPauseDuration: number;
}

/** Per-type control immunity flags. true = immune to the control effect. */
export interface ControlImmunities {
  freeze?: boolean;
  launch?: boolean;
  knockdown?: boolean;
  /** TODO: add more as needed (pull, stun, etc.) */
}

export interface EnemyConfig {
  maxStagger: number;
  staggerNodeCount: number;
  staggerNodeDuration: number;
  staggerBreakDuration: number;
  executionRecovery: number;

  /**
   * Defense multiplier (防御区). Default 0.5.
   * Applied as a direct multiplier to damage.
   */
  defenseMultiplier?: number;

  /** Base magic resistance (法抗). Default 0. Each point reduces magic damage by 1%. */
  baseMagicResist?: number;

  /** Base physical resistance (物抗). Default 0. Each point reduces physical damage by 1%. */
  basePhysicalResist?: number;

  /**
   * Per-type control immunities.
   * Control immunity does NOT prevent damage — only the control effect.
   * E.g., freeze immune: freeze debuff still applied (shatter can trigger),
   * but the movement-lock control effect is ignored.
   */
  controlImmunities?: ControlImmunities;
}

export interface EnemySnapshot {
  stagger: number;
  isBroken: boolean;
  isLocked: boolean;
  breakEndTime: number;
  lockEndTime: number;
}

export interface GameConfig {
  team: TeamConfig;
  enemy: EnemyConfig;
}

export interface GameSnapshot {
  team: TeamSnapshot;
  enemy: EnemySnapshot;
}
