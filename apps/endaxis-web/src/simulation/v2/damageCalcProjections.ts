/**
 * Damage Calculation Page — Projection Functions
 *
 * Additional projections specific to the damage calculation page.
 * Re-exports existing projections for convenience; adds per-hit
 * damage detail grouping and actor-level damage summaries with names.
 *
 * All functions are pure — no side effects, no state mutation.
 */

import type {
  SimEvent,
  DamageEvent,
  DamageElement,
  DamageSchool,
  ActionType,
  ActionEvent,
  BuffEvent,
} from "./types";

// Re-export existing projections for one-stop import
export {
  projectDamageSummary,
  projectBuffBars,
  projectStackBuffBars,
  projectAnomalyBars,
  projectAttachmentBars,
  projectBreakBars,
  projectHitEffects,
  projectActionBars,
  projectSpSeries,
  projectGaugeSeries,
  projectStaggerSeries,
} from "./projections";

export type {
  DamageSummary,
  BuffBar,
  StackBuffBar,
  AnomalyBar,
  AttachmentBar,
  BreakBar,
  HitEffectMarker,
  ActionBarInfo,
  SpPoint,
  GaugePoint,
  StaggerPoint,
} from "./projections";

// ═══════════════════════════════════════════════════════════════════
// Per-hit damage detail
// ═══════════════════════════════════════════════════════════════════

/** Detailed info for a single damage hit. */
export interface HitDamageDetail {
  time: number;
  hitIndex: number;
  actionId: string;
  sourceId: string;
  damage: number;
  multiplier: number;
  stagger: number;
  isCrit: boolean;
  element: DamageElement;
  school: DamageSchool;
  fromTrigger: boolean;
  triggerName?: string;
}

/**
 * Group damage events by actionId, preserving chronological order within each group.
 * Returns a Map from actionId to an array of hit details.
 */
export function projectHitDamageDetails(events: SimEvent[]): Map<string, HitDamageDetail[]> {
  const byAction = new Map<string, HitDamageDetail[]>();

  for (const e of events) {
    if (e.type !== "damage") continue;
    const de = e as DamageEvent;

    const list = byAction.get(de.actionId) || [];
    list.push({
      time: de.time,
      hitIndex: de.hitIndex,
      actionId: de.actionId,
      sourceId: de.sourceId,
      damage: de.damage,
      multiplier: de.multiplier,
      stagger: de.stagger,
      isCrit: de.isCrit,
      element: de.element,
      school: de.school,
      fromTrigger: de.fromTrigger || false,
      triggerName: de.triggerName,
    });
    byAction.set(de.actionId, list);
  }

  return byAction;
}

// ═══════════════════════════════════════════════════════════════════
// Actor-level damage summary with names
// ═══════════════════════════════════════════════════════════════════

/** Metadata for resolving names from store tracks. */
export interface TrackMeta {
  id: string;
  name: string;
  element: string;
  actions: ActionMeta[];
}

export interface ActionMeta {
  instanceId: string;
  name: string;
  type: string;
  element?: string;
  startTime: number;
  duration: number;
}

/** Per-action damage summary with display metadata. */
export interface ActionDamageInfo {
  actionId: string;
  name: string;
  type: string;
  element: string;
  startTime: number;
  duration: number;
  totalDamage: number;
  totalStagger: number;
  hitCount: number;
  critCount: number;
}

/** Per-actor damage summary with display metadata. */
export interface ActorDamageSummary {
  actorId: string;
  name: string;
  element: string;
  totalDamage: number;
  totalStagger: number;
  hitCount: number;
  critCount: number;
  actions: ActionDamageInfo[];
}

/** Overall damage summary with actor breakdowns. */
export interface FullDamageSummary {
  totalDamage: number;
  totalStagger: number;
  hitCount: number;
  critCount: number;
  byActor: ActorDamageSummary[];
  byElement: Map<DamageElement, number>;
}

/**
 * Build a complete damage summary with actor/action names resolved from store metadata.
 */
export function projectFullDamageSummary(
  events: SimEvent[],
  tracksMeta: TrackMeta[],
): FullDamageSummary {
  // Build lookup maps
  const trackMap = new Map<string, TrackMeta>();
  const actionMap = new Map<string, ActionMeta & { trackId: string }>();
  for (const t of tracksMeta) {
    trackMap.set(t.id, t);
    for (const a of t.actions) {
      actionMap.set(a.instanceId, { ...a, trackId: t.id });
    }
  }

  // Aggregate damage
  const actorAgg = new Map<string, {
    damage: number; stagger: number; hits: number; crits: number;
    actionAgg: Map<string, { damage: number; stagger: number; hits: number; crits: number }>;
  }>();
  const byElement = new Map<DamageElement, number>();

  let totalDamage = 0;
  let totalStagger = 0;
  let hitCount = 0;
  let critCount = 0;

  for (const e of events) {
    if (e.type !== "damage") continue;
    const de = e as DamageEvent;

    totalDamage += de.damage;
    totalStagger += de.stagger;
    hitCount++;
    if (de.isCrit) critCount++;

    // By element
    byElement.set(de.element, (byElement.get(de.element) || 0) + de.damage);

    // By actor
    let actor = actorAgg.get(de.sourceId);
    if (!actor) {
      actor = { damage: 0, stagger: 0, hits: 0, crits: 0, actionAgg: new Map() };
      actorAgg.set(de.sourceId, actor);
    }
    actor.damage += de.damage;
    actor.stagger += de.stagger;
    actor.hits++;
    if (de.isCrit) actor.crits++;

    // By action within actor
    let action = actor.actionAgg.get(de.actionId);
    if (!action) {
      action = { damage: 0, stagger: 0, hits: 0, crits: 0 };
      actor.actionAgg.set(de.actionId, action);
    }
    action.damage += de.damage;
    action.stagger += de.stagger;
    action.hits++;
    if (de.isCrit) action.crits++;
  }

  // Build result with names
  const byActor: ActorDamageSummary[] = [];
  for (const [actorId, agg] of actorAgg) {
    const trackInfo = trackMap.get(actorId);
    const actions: ActionDamageInfo[] = [];

    for (const [actionId, actionAgg] of agg.actionAgg) {
      const actionInfo = actionMap.get(actionId);
      actions.push({
        actionId,
        name: actionInfo?.name || actionId,
        type: actionInfo?.type || "unknown",
        element: actionInfo?.element || trackInfo?.element || "physical",
        startTime: actionInfo?.startTime || 0,
        duration: actionInfo?.duration || 0,
        totalDamage: actionAgg.damage,
        totalStagger: actionAgg.stagger,
        hitCount: actionAgg.hits,
        critCount: actionAgg.crits,
      });
    }

    // Sort actions by startTime
    actions.sort((a, b) => a.startTime - b.startTime);

    byActor.push({
      actorId,
      name: trackInfo?.name || actorId,
      element: trackInfo?.element || "physical",
      totalDamage: agg.damage,
      totalStagger: agg.stagger,
      hitCount: agg.hits,
      critCount: agg.crits,
      actions,
    });
  }

  // Sort actors by total damage descending
  byActor.sort((a, b) => b.totalDamage - a.totalDamage);

  return { totalDamage, totalStagger, hitCount, critCount, byActor, byElement };
}

// ═══════════════════════════════════════════════════════════════════
// Buff detail extraction
// ═══════════════════════════════════════════════════════════════════

/** Full buff lifecycle info for detail panel display. */
export interface BuffDetail {
  buffId: string;
  buffName: string;
  sourceActorId: string;
  targetActorId: string;
  target: string; // 'self' | 'team' | 'enemy' | 'others'
  stacks: number;
  duration: number;
  startTime: number;
  endTime: number;
}

/**
 * Extract buff lifecycle details from events for a given buff bar.
 * Finds the buff_apply event closest to the given startTime for the buffId.
 */
export function extractBuffDetail(
  events: SimEvent[],
  buffId: string,
  startTime: number,
): BuffDetail | null {
  for (const e of events) {
    if (e.type !== "buff_apply") continue;
    const be = e as BuffEvent;
    if (be.buffId === buffId && Math.abs(be.time - startTime) < 0.01) {
      return {
        buffId: be.buffId,
        buffName: be.buffName,
        sourceActorId: be.actorId,
        targetActorId: be.targetId,
        target: be.target,
        stacks: be.stacks,
        duration: be.duration,
        startTime: be.time,
        endTime: be.time + be.duration,
      };
    }
  }
  return null;
}
