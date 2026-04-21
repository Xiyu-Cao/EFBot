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
  TriggerSourceRef,
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
  /** Buff stat / zone carried through so the UI can fall back to a generic
   *  (stat+zone)-based icon when buffMetadata has no explicit entry. */
  stat?: string;
  zone?: string;
  /** If produced by a PassiveTrigger, the trigger's sourceRef — for per-source
   *  icon modes ("按技能/天赋" / "按角色") in the timeline UI. */
  sourceRef?: TriggerSourceRef;
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
        stat: be.stat,
        zone: be.zone,
        sourceRef: be.sourceRef,
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
// Break stack timeline
// ═══════════════════════════════════════════════════════════════════

export interface BreakBar {
  id: string;
  /** Max stack count reached during this break lifecycle. */
  stacks: number;
  startTime: number;
  endTime: number;
  /** Physical anomaly type that initially triggered the break state. */
  physicalType?: string;
  /** What consumed this break (slam/armorBreak), or undefined if expired naturally. */
  consumedBy?: string;
  /** Per-stack-change timeline within the lifecycle, for detailed UI. */
  segments: { stacks: number; startTime: number; endTime: number }[];
}

const BREAK_DURATION = 30;

/**
 * Project break stack bars from break_change events.
 *
 * A break lifecycle = continuous interval where stacks > 0. Stack additions
 * (击飞/倒地/直接施加) within one lifecycle do NOT open a new bar — they
 * append a segment. The lifecycle ends when stacks drop back to 0 (consumed
 * by 猛击/碎甲, or naturally expired via BREAK_DURATION).
 */
export function projectBreakBars(
  events: SimEvent[],
  endTime: number,
): BreakBar[] {
  const bars: BreakBar[] = [];
  let current: {
    startTime: number;
    physicalType?: string;
    segments: { stacks: number; startTime: number; endTime: number }[];
    currentSegStart: number;
    currentStacks: number;
    maxStacks: number;
  } | null = null;
  let counter = 0;

  const closeSegment = (endT: number) => {
    if (!current) return;
    if (endT > current.currentSegStart) {
      current.segments.push({
        stacks: current.currentStacks,
        startTime: current.currentSegStart,
        endTime: endT,
      });
    }
  };

  for (const e of events) {
    if (e.type !== "break_change") continue;
    const bk = e as BreakEvent;

    if (bk.stacks > 0) {
      if (current == null) {
        // Open new lifecycle
        counter++;
        current = {
          startTime: bk.time,
          physicalType: bk.physicalType,
          segments: [],
          currentSegStart: bk.time,
          currentStacks: bk.stacks,
          maxStacks: bk.stacks,
        };
      } else {
        // Stack change within same lifecycle — close previous segment, open new
        closeSegment(bk.time);
        current.currentSegStart = bk.time;
        current.currentStacks = bk.stacks;
        if (bk.stacks > current.maxStacks) current.maxStacks = bk.stacks;
      }
    } else {
      // stacks went to 0 → close lifecycle
      if (current) {
        closeSegment(bk.time);
        bars.push({
          id: `break_${counter}`,
          stacks: current.maxStacks,
          startTime: current.startTime,
          endTime: bk.time,
          physicalType: current.physicalType,
          consumedBy: bk.physicalType,
          segments: current.segments,
        });
        current = null;
      }
    }
  }

  // Close unclosed (cap at last-refresh + BREAK_DURATION — each stack change refreshes expiry).
  // Kernel normally emits a break_change stacks=0 at the real expiry, so this fallback
  // only runs for edge cases where no expiry event was produced.
  if (current) {
    const cap = Math.min(endTime, current.currentSegStart + BREAK_DURATION);
    closeSegment(cap);
    bars.push({
      id: `break_${counter}`,
      stacks: current.maxStacks,
      startTime: current.startTime,
      endTime: cap,
      physicalType: current.physicalType,
      segments: current.segments,
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
  /** True if consumed by reaction/skill (not natural expiry). */
  consumed?: boolean;
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
      // Consumed if: element changed or cleared (not just stacks changed on same element)
      const isConsumed = ae.element !== current.element || ae.stacks === 0;
      bars.push({
        id: `attach_${counter}`,
        element: current.element,
        stacks: current.stacks,
        startTime: current.startTime,
        endTime: ae.time,
        consumed: isConsumed && ae.time < current.startTime + 30 - 0.01, // not expired naturally
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

// ── Stagger series for ResourceMonitor (with lock/node segments) ──

export interface StaggerMonitorPoint {
  time: number;
  val: number;
}

export interface LockSegment {
  start: number;
  end: number;
}

export interface NodeSegment {
  start: number;
  end: number;
  thresholdVal: number;
}

export interface StaggerMonitorData {
  points: StaggerMonitorPoint[];
  lockSegments: LockSegment[];
  nodeSegments: NodeSegment[];
  nodeStep: number;
}

/**
 * Project stagger events into the format expected by ResourceMonitor:
 * points (time/val pairs), lockSegments (full stagger windows),
 * and nodeSegments (node threshold windows).
 */
export function projectStaggerMonitorSeries(
  events: SimEvent[],
  maxStagger: number,
  staggerBreakDuration: number,
  staggerNodeDuration: number,
  staggerNodes: number[],
  endTime: number,
): StaggerMonitorData {
  const points: StaggerMonitorPoint[] = [{ time: 0, val: 0 }];
  const lockSegments: LockSegment[] = [];
  const nodeSegments: NodeSegment[] = [];

  let current = 0;
  let lockedUntil = -1;

  for (const e of events) {
    if (e.type !== "stagger_change") continue;
    const se = e as StaggerEvent;

    // Skip events during stagger lock
    if (se.time < lockedUntil - 0.0001) continue;

    // Step to pre-change value
    points.push({ time: se.time, val: current });

    current = se.total;

    if (se.isFullStagger) {
      current = 0;
      const lockEnd = se.time + staggerBreakDuration;
      lockedUntil = lockEnd;
      lockSegments.push({ start: se.time, end: lockEnd });
      points.push({ time: se.time, val: 0 });
    } else {
      if (se.nodeReached && se.nodeIndex != null && se.nodeIndex < staggerNodes.length) {
        const nodeEnd = se.time + staggerNodeDuration;
        nodeSegments.push({
          start: se.time,
          end: nodeEnd,
          thresholdVal: staggerNodes[se.nodeIndex],
        });
      }
      points.push({ time: se.time, val: current });
    }
  }

  if (points[points.length - 1].time < endTime) {
    points.push({ time: endTime, val: current });
  }

  const nodeStep = staggerNodes.length > 0
    ? maxStagger / (staggerNodes.length + 1)
    : 0;

  return { points, lockSegments, nodeSegments, nodeStep };
}

// ═══════════════════════════════════════════════════════════════════
// Hit effect markers (all visible effects at hit positions)
// ═══════════════════════════════════════════════════════════════════

export interface HitEffectMarker {
  id: string;
  time: number;
  sourceId: string;
  actionId: string;
  /** Effect category for icon/color selection */
  effectType: string;
  /** Display name */
  name: string;
  /** Damage value (for trigger damage markers) */
  damage?: number;
  /** Element for coloring */
  element?: DamageElement | string;
  /** Whether this is a trigger-produced extra hit */
  isTriggerHit?: boolean;
  /** Buff stat / zone — used by the UI's (stat+zone) icon fallback when the
   *  marker originates from a `buff_apply` without explicit buffMetadata. */
  stat?: string;
  zone?: string;
  /** Trigger source ref — lets the UI render the source icon (weapon / talent /
   *  skill / equipment) matching the current 按技能 / 按角色 display mode. */
  sourceRef?: TriggerSourceRef;
}

/**
 * Extract all visible effects from events as markers at hit positions.
 * Includes: attachments, buffs, anomalies, break changes, trigger hits.
 */
export function projectHitEffects(events: SimEvent[]): HitEffectMarker[] {
  const markers: HitEffectMarker[] = [];
  let counter = 0;
  const id = () => `hfx_${++counter}`;

  for (const e of events) {
    switch (e.type) {
      case "attachment_change": {
        const ae = e as AttachmentEvent;
        // Only show application events (stacks > 0), not expiry/clear
        if (ae.stacks > 0 && ae.element) {
          const elementNames: Record<string, string> = { fire: "灼热附着", cold: "寒冷附着", electro: "电磁附着", nature: "自然附着" };
          markers.push({
            id: id(), time: ae.time, sourceId: ae.sourceId || "", actionId: "",
            effectType: `${ae.element}_attach`,
            name: elementNames[ae.element] || `${ae.element}附着`,
            element: ae.element,
          });
        }
        break;
      }
      case "buff_apply": {
        const be = e as BuffEvent;
        // Only show markers for the skill's own declared hit.effects. Trigger
        // actions (weapon / equipment / talent / char-intrinsic triggers like
        // crystal consumption) have their details accessible via the buff row
        // + right panel; inlining them above the hit clutters the view.
        if (be.fromTrigger) break;
        markers.push({
          id: id(), time: be.time, sourceId: be.actorId, actionId: "",
          effectType: be.buffId,
          name: be.buffName,
          element: be.target === "enemy" ? undefined : undefined,
          stat: be.stat,
          zone: be.zone,
          sourceRef: be.sourceRef,
        });
        break;
      }
      case "break_change": {
        const bk = e as BreakEvent;
        const physType = bk.physicalType || (bk.stacks > bk.prevStacks ? "break_apply" : "break_consume");
        const physNames: Record<string, string> = { slam: "猛击", armorBreak: "碎甲", launch: "击飞", knockdown: "倒地", break_apply: "破防", break_consume: "消耗破防" };
        markers.push({
          id: id(), time: bk.time, sourceId: bk.sourceId || "", actionId: "",
          effectType: physType,
          name: physNames[physType] || physType,
        });
        break;
      }
      case "anomaly_apply": {
        const an = e as AnomalyEvent;
        const anomalyNames: Record<string, string> = { burning: "燃烧", frozen: "冻结", conduction: "导电", corrosion: "腐蚀" };
        markers.push({
          id: id(), time: an.time, sourceId: an.sourceId, actionId: "",
          effectType: an.anomalyType,
          name: anomalyNames[an.anomalyType] || an.anomalyType,
        });
        break;
      }
      case "stack_change": {
        const se = e as StackBuffEvent;
        if (se.stacks > se.prevStacks) {
          markers.push({
            id: id(), time: se.time, sourceId: se.actorId, actionId: "",
            effectType: se.buffType,
            name: se.buffType,
          });
        }
        break;
      }
      case "damage": {
        const de = e as DamageEvent;
        if (de.fromTrigger) {
          markers.push({
            id: id(), time: de.time, sourceId: de.sourceId, actionId: de.actionId,
            effectType: "trigger_damage",
            name: de.triggerName || "追加攻击",
            damage: de.damage,
            element: de.element,
            isTriggerHit: true,
          });
        }
        break;
      }
    }
  }

  return markers;
}

// ═══════════════════════════════════════════════════════════════════
// Action bars (duration + interrupt info from kernel events)
// ═══════════════════════════════════════════════════════════════════

export interface ActionBarInfo {
  actionId: string;
  actorId: string;
  startTime: number;
  endTime: number;
  interrupted: boolean;
  /** The skill type used by the kernel (may differ from store action type, e.g., attack → execution). */
  skillType?: string;
  /** Visual duration override (e.g., internal CD indicator when kernel duration=0). */
  displayDuration?: number;
  /** Hit offsets from the V2 Skill (seconds from action start). */
  hitOffsets?: number[];
  /** Hit indices that fired a condition-gated ("额外") effect. UI can colour these distinctly. */
  conditionalHits?: number[];
}

/**
 * Extract action duration info from kernel action_start / action_end events.
 * Returns Map<actionId, ActionBarInfo>.
 * When interrupted=true, endTime is the interrupt time (shorter than natural duration).
 */
export function projectActionBars(events: SimEvent[]): Map<string, ActionBarInfo> {
  const starts = new Map<string, { actorId: string; time: number }>();
  const result = new Map<string, ActionBarInfo>();
  // Collected hit_mark events keyed by actionId.
  const conditionalByAction = new Map<string, Set<number>>();

  for (const e of events) {
    if (e.type === "action_start") {
      const ae = e as ActionEvent;
      starts.set(ae.actionId, { actorId: ae.actorId, time: ae.time });
    } else if (e.type === "action_end") {
      const ae = e as ActionEvent;
      const start = starts.get(ae.actionId);
      if (start) {
        result.set(ae.actionId, {
          actionId: ae.actionId,
          actorId: start.actorId,
          startTime: start.time,
          endTime: ae.time,
          interrupted: ae.interrupted || false,
          skillType: ae.skillType,
          displayDuration: ae.displayDuration,
          hitOffsets: ae.hitOffsets,
        });
      }
    } else if (e.type === "hit_mark" && (e as any).kind === "conditional") {
      const he = e as any;
      if (!conditionalByAction.has(he.actionId)) conditionalByAction.set(he.actionId, new Set());
      conditionalByAction.get(he.actionId)!.add(he.hitIndex);
    }
  }

  // Attach conditional hit indices to the corresponding ActionBarInfo.
  for (const [actionId, hits] of conditionalByAction) {
    const info = result.get(actionId);
    if (info) info.conditionalHits = [...hits].sort((a, b) => a - b);
  }

  return result;
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
