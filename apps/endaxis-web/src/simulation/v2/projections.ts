/**
 * V2 Layer 3: Projection Functions
 *
 * Pure functions that transform EventLog into UI-ready data structures.
 * No computation, no state — just filtering and reshaping events.
 *
 * These are consumed by the store's Vue computed properties for rendering.
 */

import type {
  SimEvent,
  DamageEvent,
  GaugeChangeEvent,
  SpChangeEvent,
  BuffEvent,
  StackBuffEvent,
  AttachmentEvent,
  AnomalyEvent,
  BreakEvent,
  StaggerEvent,
  ActionEvent,
  DamageElement,
  MagicElement,
  AnomalyType,
  ActionType,
} from "./types";

// ═══════════════════════════════════════════════════════════════════
// Gauge series (for timeline gauge curve)
// ═══════════════════════════════════════════════════════════════════

export interface GaugePoint {
  time: number;
  value: number;
  ratio: number;
}

/**
 * Project gauge time series for a single actor.
 */
export function projectGaugeSeries(
  events: SimEvent[],
  actorId: string,
  initialGauge: number,
  maxGauge: number,
  endTime: number,
): GaugePoint[] {
  const cap = Math.max(1, maxGauge);
  let current = Math.max(0, Math.min(initialGauge, cap));
  const ratio = () => current / cap;

  const points: GaugePoint[] = [{ time: 0, value: current, ratio: ratio() }];

  for (const e of events) {
    if (e.type !== "gauge_change") continue;
    const ge = e as GaugeChangeEvent;
    if (ge.actorId !== actorId) continue;

    points.push({ time: ge.time, value: current, ratio: ratio() });
    current = Math.max(0, Math.min(cap, current + ge.change));
    points.push({ time: ge.time, value: current, ratio: ratio() });
  }

  points.push({ time: endTime, value: current, ratio: ratio() });
  return points;
}

// ═══════════════════════════════════════════════════════════════════
// SP series
// ═══════════════════════════════════════════════════════════════════

export interface SpPoint {
  time: number;
  trueSP: number;
  refundSP: number;
  total: number;
}

/**
 * Project SP time series from events.
 */
export function projectSpSeries(
  events: SimEvent[],
  initialTrueSP: number,
  endTime: number,
): SpPoint[] {
  let trueSP = initialTrueSP;
  let refundSP = 0;

  const points: SpPoint[] = [{ time: 0, trueSP, refundSP, total: trueSP + refundSP }];

  for (const e of events) {
    if (e.type !== "sp_change") continue;
    const se = e as SpChangeEvent;

    points.push({ time: se.time, trueSP, refundSP, total: trueSP + refundSP });
    trueSP = se.currentTrueSP;
    refundSP = se.currentRefundSP;
    points.push({ time: se.time, trueSP, refundSP, total: trueSP + refundSP });
  }

  points.push({ time: endTime, trueSP, refundSP, total: trueSP + refundSP });
  return points;
}

// ═══════════════════════════════════════════════════════════════════
// Buff timeline bars
// ═══════════════════════════════════════════════════════════════════

export interface BuffBar {
  id: string;
  buffId: string;
  name: string;
  target: string;
  actorId: string;
  startTime: number;
  endTime: number;
  stacks: number;
  color: string;
}

/**
 * Project buff bars from buff_apply/buff_remove events.
 */
export function projectBuffBars(
  events: SimEvent[],
  endTime: number,
): BuffBar[] {
  const active = new Map<string, BuffBar>();
  const completed: BuffBar[] = [];
  let counter = 0;

  for (const e of events) {
    if (e.type === "buff_apply") {
      const be = e as BuffEvent;
      counter++;
      active.set(be.buffId, {
        id: `buff_${counter}`,
        buffId: be.buffId,
        name: be.buffName,
        target: be.target,
        actorId: be.actorId,
        startTime: be.time,
        endTime: be.time + be.duration,
        stacks: be.stacks,
        color: be.target === "enemy" ? "#ff4d4f" : be.target === "team" ? "#faad14" : "#b37feb",
      });
    } else if (e.type === "buff_remove") {
      const be = e as BuffEvent;
      const bar = active.get(be.buffId);
      if (bar) {
        bar.endTime = be.time;
        completed.push(bar);
        active.delete(be.buffId);
      }
    }
  }

  // Close unclosed buffs at endTime
  for (const bar of active.values()) {
    if (bar.endTime > endTime) bar.endTime = endTime;
    completed.push(bar);
  }

  return completed;
}

// ═══════════════════════════════════════════════════════════════════
// Stack buff bars (magma, vortex, etc.)
// ═══════════════════════════════════════════════════════════════════

export interface StackBuffBar {
  id: string;
  actorId: string;
  buffType: string;
  startTime: number;
  endTime: number;
  stacks: number;
}

/**
 * Project stack buff bars from stack_change events.
 */
export function projectStackBuffBars(
  events: SimEvent[],
  endTime: number,
): StackBuffBar[] {
  // Group by (actorId, buffType) and track stack changes over time
  const bars: StackBuffBar[] = [];
  const current = new Map<string, { actorId: string; buffType: string; startTime: number; stacks: number }>();
  let counter = 0;

  for (const e of events) {
    if (e.type !== "stack_change") continue;
    const se = e as StackBuffEvent;
    const key = `${se.actorId}::${se.buffType}`;

    // Close previous bar
    const prev = current.get(key);
    if (prev && prev.stacks > 0) {
      counter++;
      bars.push({
        id: `stack_${counter}`,
        actorId: prev.actorId,
        buffType: prev.buffType,
        startTime: prev.startTime,
        endTime: se.time,
        stacks: prev.stacks,
      });
    }

    // Open new bar (if stacks > 0)
    if (se.stacks > 0) {
      current.set(key, { actorId: se.actorId, buffType: se.buffType, startTime: se.time, stacks: se.stacks });
    } else {
      current.delete(key);
    }
  }

  // Close unclosed bars at endTime
  for (const state of current.values()) {
    if (state.stacks > 0) {
      counter++;
      bars.push({
        id: `stack_${counter}`,
        actorId: state.actorId,
        buffType: state.buffType,
        startTime: state.startTime,
        endTime: endTime,
        stacks: state.stacks,
      });
    }
  }

  return bars;
}

// ═══════════════════════════════════════════════════════════════════
// Anomaly debuff bars
// ═══════════════════════════════════════════════════════════════════

export interface AnomalyBar {
  id: string;
  anomalyType: AnomalyType;
  level: number;
  startTime: number;
  endTime: number;
  sourceId: string;
}

/**
 * Project anomaly bars from anomaly_apply/anomaly_remove events.
 */
export function projectAnomalyBars(
  events: SimEvent[],
  endTime: number,
): AnomalyBar[] {
  const active = new Map<AnomalyType, { level: number; startTime: number; sourceId: string }>();
  const bars: AnomalyBar[] = [];
  let counter = 0;

  for (const e of events) {
    if (e.type === "anomaly_apply") {
      const ae = e as AnomalyEvent;
      // Close previous if exists
      const prev = active.get(ae.anomalyType);
      if (prev) {
        counter++;
        bars.push({
          id: `anom_${counter}`,
          anomalyType: ae.anomalyType,
          level: prev.level,
          startTime: prev.startTime,
          endTime: ae.time,
          sourceId: prev.sourceId,
        });
      }
      active.set(ae.anomalyType, { level: ae.level, startTime: ae.time, sourceId: ae.sourceId });
    } else if (e.type === "anomaly_remove") {
      const ae = e as AnomalyEvent;
      const prev = active.get(ae.anomalyType);
      if (prev) {
        counter++;
        bars.push({
          id: `anom_${counter}`,
          anomalyType: ae.anomalyType,
          level: prev.level,
          startTime: prev.startTime,
          endTime: ae.time,
          sourceId: prev.sourceId,
        });
        active.delete(ae.anomalyType);
      }
    }
  }

  // Close unclosed anomalies at endTime
  for (const [type, state] of active) {
    counter++;
    bars.push({
      id: `anom_${counter}`,
      anomalyType: type,
      level: state.level,
      startTime: state.startTime,
      endTime: endTime,
      sourceId: state.sourceId,
    });
  }

  return bars;
}

// ═══════════════════════════════════════════════════════════════════
// Attachment timeline
// ═══════════════════════════════════════════════════════════════════

export interface AttachmentBar {
  id: string;
  element: MagicElement;
  stacks: number;
  startTime: number;
  endTime: number;
}

/**
 * Project attachment bars from attachment_change events.
 */
export function projectAttachmentBars(
  events: SimEvent[],
  endTime: number,
): AttachmentBar[] {
  const bars: AttachmentBar[] = [];
  let current: { element: MagicElement; stacks: number; startTime: number } | null = null;
  let counter = 0;

  for (const e of events) {
    if (e.type !== "attachment_change") continue;
    const ae = e as AttachmentEvent;

    // Close previous bar
    if (current) {
      counter++;
      bars.push({
        id: `attach_${counter}`,
        element: current.element,
        stacks: current.stacks,
        startTime: current.startTime,
        endTime: ae.time,
      });
      current = null;
    }

    // Open new bar
    if (ae.element && ae.stacks > 0) {
      current = { element: ae.element, stacks: ae.stacks, startTime: ae.time };
    }
  }

  // Close unclosed
  if (current) {
    counter++;
    bars.push({
      id: `attach_${counter}`,
      element: current.element,
      stacks: current.stacks,
      startTime: current.startTime,
      endTime: endTime,
    });
  }

  return bars;
}

// ═══════════════════════════════════════════════════════════════════
// Stagger series
// ═══════════════════════════════════════════════════════════════════

export interface StaggerPoint {
  time: number;
  value: number;
  maxStagger: number;
  isStaggered: boolean;
}

/**
 * Project stagger time series.
 */
export function projectStaggerSeries(
  events: SimEvent[],
  maxStagger: number,
  endTime: number,
): StaggerPoint[] {
  let current = 0;
  let isStaggered = false;

  const points: StaggerPoint[] = [{ time: 0, value: 0, maxStagger, isStaggered: false }];

  for (const e of events) {
    if (e.type !== "stagger_change") continue;
    const se = e as StaggerEvent;

    points.push({ time: se.time, value: current, maxStagger, isStaggered });
    current = se.total;
    isStaggered = se.isFullStagger || isStaggered;
    points.push({ time: se.time, value: current, maxStagger, isStaggered });
  }

  points.push({ time: endTime, value: current, maxStagger, isStaggered });
  return points;
}

// ═══════════════════════════════════════════════════════════════════
// Damage summary
// ═══════════════════════════════════════════════════════════════════

export interface DamageSummary {
  totalDamage: number;
  totalStagger: number;
  hitCount: number;
  critCount: number;
  byActor: Map<string, { damage: number; hits: number; crits: number }>;
  byElement: Map<DamageElement, number>;
  byActionType: Map<ActionType, number>;
  byAction: Map<string, { damage: number; hits: number; name?: string }>;
}

/**
 * Aggregate damage statistics from events.
 */
export function projectDamageSummary(events: SimEvent[]): DamageSummary {
  const summary: DamageSummary = {
    totalDamage: 0,
    totalStagger: 0,
    hitCount: 0,
    critCount: 0,
    byActor: new Map(),
    byElement: new Map(),
    byActionType: new Map(),
    byAction: new Map(),
  };

  for (const e of events) {
    if (e.type !== "damage") continue;
    const de = e as DamageEvent;

    summary.totalDamage += de.damage;
    summary.totalStagger += de.stagger;
    summary.hitCount++;
    if (de.isCrit) summary.critCount++;

    // By actor
    const actor = summary.byActor.get(de.sourceId) || { damage: 0, hits: 0, crits: 0 };
    actor.damage += de.damage;
    actor.hits++;
    if (de.isCrit) actor.crits++;
    summary.byActor.set(de.sourceId, actor);

    // By element
    summary.byElement.set(de.element, (summary.byElement.get(de.element) || 0) + de.damage);

    // By action type
    // (sourceType is on DamageInfo, but DamageEvent has school — use actionId to look up)
    // For now, skip action type grouping (would need action metadata)

    // By action
    const action = summary.byAction.get(de.actionId) || { damage: 0, hits: 0 };
    action.damage += de.damage;
    action.hits++;
    summary.byAction.set(de.actionId, action);
  }

  return summary;
}
