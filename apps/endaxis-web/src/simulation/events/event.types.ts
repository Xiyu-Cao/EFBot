import type { ActionType, ResolvedDamageTick } from "../compiler/types";
import type { EffectSnapshot } from "../effects/types";
import type { AnomalyEvent } from "../anomaly/events";

export type SimEventType = SimEvent["type"];
type SimBaseEvent<Name extends string, Data = {}> = {
  // real time
  time: number;
  type: Name;
  payload: Data;
};
export type ActionStartEvent = SimBaseEvent<
  "ACTION_START",
  {
    skillId: string;
    actionId: string;
    spCost?: number;
    /** Gauge consumed on ultimate cast. */
    gaugeCost?: number;
    actorId: string;
    type: ActionType;
    freezeDuration?: number;
    /** Condition types required for this action (from gamedata allowedTypes). */
    allowedTypes?: string[];
  }
>;
export type ActionEndEvent = SimBaseEvent<
  "ACTION_END",
  {
    skillId: string;
    actionId: string;
    spGain?: number;
    actorId: string;
    type: ActionType;
  }
>;
export type DamageTickEvent = SimBaseEvent<
  "DAMAGE_TICK",
  {
    targetId: string;
    sourceId: string;
    damage: number;
    stagger: number;
    tickData: ResolvedDamageTick;
    actionId: string;
  }
>;
export type SpChangeEvent = SimBaseEvent<
  "SP_CHANGE",
  {
    actorId: string;
    spChange: number;
    reason: string;
    sourceId: string;
    parent: SimEvent;
  }
>;
export type SpRegenPauseEvent = SimBaseEvent<
  "SP_REGEN_PAUSE",
  {
    sourceId: string;
    duration: number;
  }
>;
export type EffectStartEvent = SimBaseEvent<
  "EFFECT_START",
  {
    actorId: string;
    actionId?: string;
    targetId: string;
    effect: EffectSnapshot;
  }
>;
export type EffectEndEvent = SimBaseEvent<
  "EFFECT_END",
  {
    effectInstanceId: string;
    type: "consumption" | "expiration";
    targetId?: string;
  }
>;
export type StaggerChangeEvent = SimBaseEvent<
  "STAGGER_CHANGE",
  {
    stagger: number;
    actorId: string;
    actionId: string;
    targetId: string;
  }
>;

export type SimEvent =
  | ActionStartEvent
  | ActionEndEvent
  | DamageTickEvent
  | SpChangeEvent
  | SpRegenPauseEvent
  | EffectStartEvent
  | EffectEndEvent
  | StaggerChangeEvent
  | AnomalyEvent;

export type SimLogEntryBase<Name extends string, Data = {}> = {
  type: Name;
  time: number;
  payload: Data;
};

export type SimLogEntry =
  | SimLogEntryBase<
      "SP_REGEN_PAUSE",
      {
        sourceId: string;
        duration: number;
        sp: number;
      }
    >
  | SimLogEntryBase<
      "SP_CHANGE",
      {
        sp: number;
        change: number;
        sourceId: string;
        reason: string;
        trueSP?: number;
        refundSP?: number;
      }
    >
  | SimLogEntryBase<
      "GAUGE_CHANGE",
      {
        actorId: string;
        change: number;
        gauge: number;
        reason: string;
      }
    >
  | SimLogEntryBase<
      "STAGGER",
      {
        actorId: string;
        actionId: string;
        amount: number;
        stagger: number;
        isBroken: boolean;
        breakEndTime?: number;
        nodeReachedIndex?: number;
        nodeEndTime?: number;
      }
    >
  | SimLogEntryBase<
      "DAMAGE_TICK",
      {
        targetId: string;
        sourceId: string;
        damage: number;
        stagger: number;
        tickData: ResolvedDamageTick;
        actionId: string;
      }
    >
  | SimLogEntryBase<
      "ACTION_START",
      {
        skillId: string;
        actionId: string;
        type: ActionType;
        spCost?: number;
      }
    >
  | SimLogEntryBase<
      "ACTION_END",
      {
        skillId: string;
        actionId: string;
        type: ActionType;
        spGain?: number;
      }
    >
  | SimLogEntryBase<
      "EFFECT_START",
      {
        effectSnapshot: EffectSnapshot;
        targetId: string;
      }
    >
  | SimLogEntryBase<
      "REACTION_OCCURRED",
      {
        reactionName: string;
        actorId: string;
      }
    >
  | SimLogEntryBase<
      "EFFECT_APPLIED",
      {
        name: string;
        tags: any[];
        targetId: string;
      }
    >
  | SimLogEntryBase<
      "EFFECT_END",
      {
        effectId: string;
        targetId: string;
        type: "consumption" | "expiration";
      }
    >
  | SimLogEntryBase<"ANOMALY_STATUS_CHANGE", { description: string; [key: string]: unknown }>
  | SimLogEntryBase<"ANOMALY_DAMAGE", { damage: number; tags: import("../calculation/damageTypes").DamageTags }>
  | SimLogEntryBase<"LEGALITY_ISSUE", {
      actorId: string;
      actionId: string;
      code: string;
      severity: string;
      message: string;
      resolution: string;
    }>
  // ── Phase 0: New simLog types for unified kernel ──
  | SimLogEntryBase<"SELF_BUFF_CHANGE", {
      actorId: string;
      buffType: string;
      stacks: number;
      prevStacks: number;
      reason: string;
    }>
  | SimLogEntryBase<"WEAPON_BUFF_APPLIED", {
      actorId: string;
      buffName: string;
      target: string;
      duration: number;
      stacks: number;
      maxStacks: number;
      weaponId: string;
      triggerAction: string;
    }>
  | SimLogEntryBase<"CONDITION_RESULT", {
      actorId: string;
      actionId: string;
      variantId: string | null;
      consumedBuffs?: { key: string; stacks: number | "all" }[];
    }>
  | SimLogEntryBase<"CONVERT_EVENT", {
      actorId: string;
      sourceElement: string;
      targetBuff: string;
      amount: number;
    }>;
