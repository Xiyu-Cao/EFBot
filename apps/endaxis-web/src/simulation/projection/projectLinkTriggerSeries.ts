import type { SimLogEntry } from "@/simulation/events/event.types.ts";

// ── Types ──

/**
 * Structured link trigger condition.
 * Examples:
 *   { trigger: "on_heavy_attack" }
 *   { trigger: "on_heavy_attack", require_not: ["break", "magic_attachment"] }
 *   { trigger: "on_anomaly_apply", types: ["burn", "corrosion"] }
 *   { trigger: "on_stagger" }
 *   { trigger: "on_magic_attachment" }
 *   { trigger: "on_attachment", elements: ["cold", "nature"], min_stacks: 2 }
 */
export interface LinkTriggerCondition {
  /** The event type that triggers the link */
  trigger: string;
  /** Optional: enemy must be in one of these states (OR) */
  require?: string[];
  /** Optional: enemy must NOT be in any of these states */
  require_not?: string[];
  /** For on_anomaly_apply: which anomaly types trigger */
  types?: string[];
  /** For on_attachment: which elements trigger */
  elements?: string[];
  /** For on_attachment: minimum stacks required */
  min_stacks?: number;
  /** For on_effect_expire: which effect ID to watch */
  effect_id?: string;
}

export interface TrackLinkConfig {
  trackId: string;
  trackIndex: number;
  condition: LinkTriggerCondition;
  avatar: string;
  linkCooldown: number;
}

export interface LinkTriggerEvent {
  time: number;
  trackId: string;
  /**
   * One-shot data captured at trigger time, passed through to the placed link action and
   * finally to the V2 kernel's variant selection (placed.triggerData).
   *
   * Keys so far:
   *  - consumedBreakStacks: number — for POGRANICHNK on_slam_or_armor_break; the break
   *    stacks consumed by the triggering slam/armor_break. Selects linkBreak1..4.
   */
  triggerData?: Record<string, unknown>;
}

export interface LinkQueueEntry {
  trackId: string;
  avatar: string;
  /** Seconds remaining in the 6s window */
  remaining: number;
  /** Fraction remaining (0-1) for countdown ring */
  fraction: number;
  /** Operator is busy (channeling) and can't cast */
  isLocked: boolean;
  /** Link is on cooldown */
  onCooldown: boolean;
  /** Trigger-time data from the underlying LinkTriggerEvent. Forwarded to action.triggerData
   *  when this queue entry is placed. */
  triggerData?: Record<string, unknown>;
}

// ── Constants ──

const LINK_WINDOW_DURATION = 6;

// ── Enemy State Tracker (for require/require_not checks) ──

class EnemyStateTracker {
  tagCounts: Record<string, number> = {};
  breakActive = false;
  element: string | null = null;
  elementStacks = 0;
  anomalies: Record<string, boolean> = {};
  effectIds = new Set<string>();
  private effectIdToTags = new Map<string, string[]>();

  private static PHYSICAL_TAGS = new Set([
    "PHYSICAL_CRUSH", "PHYSICAL_LIFT", "PHYSICAL_KNOCK_DOWN", "PHYSICAL_BREACH",
  ]);

  /** Check a single state condition (for require/require_not). */
  check(cond: string): boolean {
    switch (cond) {
      case "stagger":       return (this.tagCounts["PHYSICAL_CRUSH"] || 0) > 0;
      case "knockup":       return (this.tagCounts["PHYSICAL_LIFT"] || 0) > 0;
      case "knockdown":     return (this.tagCounts["PHYSICAL_KNOCK_DOWN"] || 0) > 0;
      case "armor_break":   return (this.tagCounts["PHYSICAL_BREACH"] || 0) > 0;
      case "break":         return this.breakActive;
      case "magic_attachment": return this.element !== null;
      case "cold_attach":   return this.element === "cold";
      case "blaze_attach":  return this.element === "fire";
      case "emag_attach":   return this.element === "electro";
      case "nature_attach": return this.element === "nature";
      case "frozen":        return !!this.anomalies["frozen"];
      case "burn":          return !!this.anomalies["burn"];
      case "corrosion":     return !!this.anomalies["corrosion"];
      case "conduction":    return !!this.anomalies["conduction"];
      case "physical_vulnerable": return (this.tagCounts["PHYSICAL_VULNERABLE"] || 0) > 0;
      case "antal_buff":    return this.effectIds.has("antal_buff");
      case "endmin_debuff": return this.effectIds.has("endmin_debuff");
    }
    return false;
  }

  /** Check require conditions: at least one must be met (OR). */
  checkRequire(conditions: string[]): boolean {
    return conditions.some(c => this.check(c));
  }

  /** Check require_not conditions: none must be met. */
  checkRequireNot(conditions: string[]): boolean {
    return !conditions.some(c => this.check(c));
  }

  // ── State mutation from simLog events ──

  onEffectStart(effectId: string, tags: string[], targetId: string) {
    if (targetId !== "boss") return;
    const relevant = tags.filter(t => EnemyStateTracker.PHYSICAL_TAGS.has(t) || t === "PHYSICAL_VULNERABLE");
    if (relevant.length > 0) {
      for (const tag of relevant) this.tagCounts[tag] = (this.tagCounts[tag] || 0) + 1;
      if (!this.effectIdToTags.has(effectId)) this.effectIdToTags.set(effectId, relevant);
    }
    if (effectId === "antal_buff" || effectId === "endmin_debuff") this.effectIds.add(effectId);
  }

  onEffectEnd(effectId: string, targetId: string) {
    if (targetId !== "boss") return;
    const tags = this.effectIdToTags.get(effectId);
    if (tags) {
      for (const tag of tags) this.tagCounts[tag] = Math.max(0, (this.tagCounts[tag] || 1) - 1);
    }
    this.effectIds.delete(effectId);
  }

  onStagger(isBroken: boolean, breakEndTime?: number) {
    if (isBroken) this.breakActive = true;
  }

  onBreakEnd() { this.breakActive = false; }

  onAnomalyStatusChange(payload: Record<string, unknown>) {
    const desc = String(payload.description || "");
    if (payload.anomalyType) this.anomalies[String(payload.anomalyType)] = true;
    if (payload.element) {
      this.element = String(payload.element);
      this.elementStacks = Number(payload.stacks) || 0;
    }
    if (desc.includes("cleared")) {
      if (desc.includes("attachment")) { this.element = null; this.elementStacks = 0; }
      if (desc.includes("break")) this.breakActive = false;
    }
    if (desc.includes("consumed") || desc.includes("expired")) {
      for (const key of ["burn", "frozen", "corrosion", "conduction"]) {
        if (desc.includes(key)) this.anomalies[key] = false;
      }
    }
  }
}

// ── Main projection function ──

/**
 * Scan simLog to produce a chronological list of link trigger events.
 * Uses event-based trigger conditions (on_heavy_attack, on_anomaly_apply, etc.)
 * rather than pure state-transition detection.
 */
export function projectLinkTriggerSeries(
  simLog: SimLogEntry[],
  trackConfigs: TrackLinkConfig[],
  castLinks: { trackId: string; time: number }[] = [],
  convertEvents: { time: number; amount: number }[] = [],
): LinkTriggerEvent[] {
  if (!simLog?.length || !trackConfigs?.length) return [];

  const state = new EnemyStateTracker();
  const triggers: LinkTriggerEvent[] = [];

  // Pre-sort convert events (blaze absorption) by time for efficient consumption
  const sortedConverts = [...convertEvents].sort((a, b) => a.time - b.time);
  let convertIdx = 0;

  // Track active action type per actor (to identify heavy attacks)
  const activeActionType = new Map<string, string>(); // actionId → type
  const pendingBreakEnds: number[] = [];

  // Build cooldown windows from cast links
  // { trackId → [{castTime, cdEnd}] }
  const cooldownWindows = new Map<string, { castTime: number; cdEnd: number }[]>();
  for (const cl of castLinks) {
    const cfg = trackConfigs.find(c => c.trackId === cl.trackId);
    if (!cfg) continue;
    if (!cooldownWindows.has(cl.trackId)) cooldownWindows.set(cl.trackId, []);
    cooldownWindows.get(cl.trackId)!.push({
      castTime: cl.time,
      cdEnd: cl.time + (cfg.linkCooldown || 0),
    });
  }

  function isOnCooldown(trackId: string, time: number): boolean {
    const windows = cooldownWindows.get(trackId);
    if (!windows) return false;
    return windows.some(w => time >= w.castTime && time < w.cdEnd);
  }

  /** Check if a trigger condition is met for a given event context.
   *  Returns `{ ok, data? }` — `data` carries trigger-time state for variant selection
   *  (e.g. POGRANICHNK: { consumedBreakStacks: N } from the slam/armor_break that fired). */
  function checkTrigger(
    cfg: TrackLinkConfig,
    eventType: string,
    eventPayload: Record<string, unknown>,
    time: number,
  ): { ok: boolean; data?: Record<string, unknown> } {
    const cond = cfg.condition;
    if (!cond?.trigger) return { ok: false };

    // Don't trigger during cooldown
    if (isOnCooldown(cfg.trackId, time)) return { ok: false };

    let triggered = false;
    let triggerData: Record<string, unknown> | undefined;

    switch (cond.trigger) {
      case "on_heavy_attack": {
        // Triggered by STAGGER event where source action is type "attack"
        if (eventType !== "STAGGER") break;
        const actionId = String(eventPayload.actionId || "");
        const actionType = activeActionType.get(actionId);
        if (actionType === "attack") triggered = true;
        break;
      }

      case "on_stagger": {
        // Triggered by any STAGGER event
        if (eventType === "STAGGER") triggered = true;
        break;
      }

      case "on_stagger_node": {
        // Triggered by STAGGER event that reached a node
        if (eventType === "STAGGER" && eventPayload.nodeReachedIndex != null) triggered = true;
        break;
      }

      case "on_stagger_or_node": {
        // AKEKURI: enter stagger state (isBroken) OR reach a stagger node
        if (eventType === "STAGGER" && (eventPayload.isBroken || eventPayload.nodeReachedIndex != null)) triggered = true;
        break;
      }

      case "on_break": {
        // Triggered when enemy enters break state
        if (eventType === "STAGGER" && eventPayload.isBroken) triggered = true;
        break;
      }

      case "on_anomaly_apply": {
        // Triggered when specific anomaly types are applied
        if (eventType !== "ANOMALY_STATUS_CHANGE") break;
        const anomalyType = String(eventPayload.anomalyType || "");
        if (!anomalyType) break;
        if (cond.types?.length) {
          triggered = cond.types.some(t =>
            t === anomalyType || (t === "combustion" && anomalyType === "burn")
          );
        } else {
          // Any anomaly
          triggered = true;
        }
        break;
      }

      case "on_magic_attachment": {
        // Triggered when any magic element is attached
        if (eventType !== "ANOMALY_STATUS_CHANGE") break;
        if (eventPayload.element && eventPayload.stacks) triggered = true;
        break;
      }

      case "on_attachment": {
        // Triggered when specific elements reach min_stacks
        if (eventType !== "ANOMALY_STATUS_CHANGE") break;
        const elem = String(eventPayload.element || "");
        const stacks = Number(eventPayload.stacks) || 0;
        if (!elem) break;
        const matchesElement = !cond.elements?.length || cond.elements.includes(elem);
        const meetsStacks = !cond.min_stacks || stacks >= cond.min_stacks;
        if (matchesElement && meetsStacks) triggered = true;
        break;
      }

      case "on_frozen": {
        // Triggered when enemy enters frozen state
        if (eventType === "ANOMALY_STATUS_CHANGE" && eventPayload.anomalyType === "frozen") triggered = true;
        break;
      }

      case "on_conduction_apply_or_consume": {
        // ARCLIGHT: conduction applied or consumed
        if (eventType !== "ANOMALY_STATUS_CHANGE") break;
        if (eventPayload.anomalyType === "conduction") triggered = true;
        const desc = String(eventPayload.description || "");
        if (desc.includes("conduction") && desc.includes("consumed")) triggered = true;
        break;
      }

      case "on_anomaly_or_crystal_consume": {
        // ALESH: magic anomaly or crystal consumed
        if (eventType !== "ANOMALY_STATUS_CHANGE") break;
        const desc = String(eventPayload.description || "");
        if (desc.includes("consumed")) triggered = true;
        break;
      }

      case "on_magic_burst": {
        // Triggered on magic burst (element attachment reaching 4 stacks)
        if (eventType !== "ANOMALY_STATUS_CHANGE") break;
        const stacks = Number(eventPayload.stacks) || 0;
        if (eventPayload.element && stacks >= 4) triggered = true;
        break;
      }

      case "on_break_stacks": {
        // DAPAN: enemy reaches N break stacks
        if (eventType !== "ANOMALY_STATUS_CHANGE") break;
        const desc = String(eventPayload.description || "");
        const stacks = Number(eventPayload.stacks) || 0;
        if (desc.includes("break") && stacks >= (cond.min_stacks || 4)) triggered = true;
        break;
      }

      case "on_link_damage": {
        // ENDMINISTRATOR: when another team member's link deals damage
        if (eventType !== "DAMAGE_TICK") break;
        const actionId = String(eventPayload.actionId || "");
        const actionType = activeActionType.get(actionId);
        if (actionType === "link" && eventPayload.sourceId !== cfg.trackId) triggered = true;
        break;
      }

      case "on_physical_anomaly_or_attachment": {
        // ANTAL: enemy enters physical anomaly (knockup/knockdown/stagger/armor_break) OR magic attachment
        if (eventType === "EFFECT_START") {
          const snap = eventPayload.effectSnapshot as any;
          if (snap?.tags && eventPayload.targetId === "boss") {
            const hasPhy = (snap.tags as string[]).some((t: string) =>
              ["PHYSICAL_CRUSH", "PHYSICAL_LIFT", "PHYSICAL_KNOCK_DOWN", "PHYSICAL_BREACH"].includes(t)
            );
            if (hasPhy) triggered = true;
          }
        }
        if (eventType === "ANOMALY_STATUS_CHANGE" && eventPayload.element && eventPayload.stacks) {
          triggered = true;
        }
        break;
      }

      case "on_cold_attach_or_burst": {
        // TANGTANG: cold attachment OR any magic burst
        if (eventType !== "ANOMALY_STATUS_CHANGE") break;
        if (eventPayload.element === "cold" && eventPayload.stacks) triggered = true;
        const stacks = Number(eventPayload.stacks) || 0;
        if (eventPayload.element && stacks >= 4) triggered = true; // burst at 4 stacks
        break;
      }

      case "on_slam_or_armor_break": {
        // POGRANICHNK: slam (PHYSICAL_CRUSH) or armor_break (PHYSICAL_BREACH) applied.
        // consumedBreakStacks (the break stacks this slam/armor_break consumed) selects
        // one of linkBreak1..4. V1 simLog does not carry stacks on EFFECT_START — the
        // V2 kernel break_change event does (prevStacks), but this projection layer
        // runs on the V1 simLog. When the link queue system migrates to V2 event sources,
        // populate `triggerData.consumedBreakStacks` from the break_change prevStacks.
        if (eventType === "EFFECT_START") {
          const snap = eventPayload.effectSnapshot as any;
          if (snap?.tags && eventPayload.targetId === "boss") {
            const tags = snap.tags as string[];
            if (tags.includes("PHYSICAL_CRUSH") || tags.includes("PHYSICAL_BREACH")) {
              triggered = true;
              const stacks = Number((snap as { stacks?: number }).stacks ?? (eventPayload as { stacks?: number }).stacks);
              if (Number.isFinite(stacks) && stacks > 0) {
                triggerData = { consumedBreakStacks: stacks };
              }
            }
          }
        }
        break;
      }

      case "on_effect_consumed": {
        // Triggered when a specific effect is consumed (charges exhausted), NOT natural expiry
        // XAIHI: support crystal (skill_seraph) charges exhausted
        if (eventType !== "EFFECT_END") break;
        if (eventPayload.type !== "consumption") break;
        const eid = String(eventPayload.effectId || "");
        if (cond.effect_id && eid === cond.effect_id) triggered = true;
        break;
      }
    }

    if (!triggered) return { ok: false };

    // Check require/require_not against enemy state
    if (cond.require?.length && !state.checkRequire(cond.require)) return { ok: false };
    if (cond.require_not?.length && !state.checkRequireNot(cond.require_not)) return { ok: false };

    return { ok: true, data: triggerData };
  }

  // ── Main scan loop ──

  for (const entry of simLog) {
    if (!entry) continue;

    // Process pending break ends
    for (let i = pendingBreakEnds.length - 1; i >= 0; i--) {
      if (pendingBreakEnds[i] <= entry.time) {
        state.onBreakEnd();
        pendingBreakEnds.splice(i, 1);
      }
    }

    // Update enemy state tracking (always, regardless of trigger type)
    switch (entry.type) {
      case "EFFECT_START": {
        const snap = entry.payload.effectSnapshot;
        if (snap) state.onEffectStart(snap.id, snap.tags || [], entry.payload.targetId);
        break;
      }
      case "EFFECT_END":
        state.onEffectEnd(entry.payload.effectId, entry.payload.targetId);
        break;
      case "STAGGER":
        if (entry.payload.isBroken) {
          state.onStagger(true);
          if (entry.payload.breakEndTime && entry.payload.breakEndTime > entry.time) {
            pendingBreakEnds.push(entry.payload.breakEndTime);
          }
        }
        break;
      case "ANOMALY_STATUS_CHANGE":
        state.onAnomalyStatusChange(entry.payload as Record<string, unknown>);
        break;
      case "ACTION_START":
        activeActionType.set(entry.payload.actionId, entry.payload.type);
        break;
    }

    // Apply blaze→magma convert events up to current time (clears blaze attachment)
    while (convertIdx < sortedConverts.length && sortedConverts[convertIdx].time <= entry.time) {
      const ev = sortedConverts[convertIdx];
      // Reduce blaze attachment stacks; if all absorbed, clear element
      if (state.element === "fire") {
        state.elementStacks = Math.max(0, state.elementStacks - ev.amount);
        if (state.elementStacks <= 0) {
          state.element = null;
          state.elementStacks = 0;
        }
      }
      convertIdx++;
    }

    // Check trigger conditions for each track
    const eventType = entry.type;
    const eventPayload = entry.payload as Record<string, unknown>;

    for (const cfg of trackConfigs) {
      const result = checkTrigger(cfg, eventType, eventPayload, entry.time);
      if (result.ok) {
        triggers.push({
          time: entry.time, trackId: cfg.trackId,
          ...(result.data ? { triggerData: result.data } : {}),
        });
      }
    }
  }

  return triggers;
}

// ── Queue computation ──

/**
 * Given trigger events and a query time, compute the link queue state.
 */
export function computeLinkQueueAt(
  triggers: LinkTriggerEvent[],
  queryTime: number,
  trackConfigs: TrackLinkConfig[],
  lockedTrackIds: Set<string>,
  simState: { actors?: Map<string, any> },
  castLinks: { trackId: string; time: number }[],
): LinkQueueEntry[] {
  const windowMap = new Map<
    string,
    { windowStart: number; windowEnd: number; insertionOrder: number; triggerData?: Record<string, unknown> }
  >();
  let insertionCounter = 0;

  for (const trigger of triggers) {
    if (trigger.time > queryTime) break;

    const existing = windowMap.get(trigger.trackId);
    if (existing && trigger.time <= existing.windowEnd) {
      // Re-trigger within active window: refresh duration, keep position.
      // Latest triggerData wins (re-trigger supplies fresh state).
      existing.windowStart = trigger.time;
      existing.windowEnd = trigger.time + LINK_WINDOW_DURATION;
      if (trigger.triggerData) existing.triggerData = trigger.triggerData;
    } else {
      windowMap.set(trigger.trackId, {
        windowStart: trigger.time,
        windowEnd: trigger.time + LINK_WINDOW_DURATION,
        insertionOrder: insertionCounter++,
        triggerData: trigger.triggerData,
      });
    }
  }

  const activeEntries: Array<{
    trackId: string; windowEnd: number;
    insertionOrder: number; trackIndex: number; avatar: string;
    triggerData?: Record<string, unknown>;
  }> = [];

  for (const [trackId, window] of windowMap) {
    if (queryTime > window.windowEnd) continue;

    const wasCast = castLinks.some(cl =>
      cl.trackId === trackId && cl.time >= window.windowStart && cl.time <= window.windowEnd
    );
    if (wasCast) continue;

    const cfg = trackConfigs.find(c => c.trackId === trackId);
    if (!cfg) continue;

    activeEntries.push({
      trackId,
      windowEnd: window.windowEnd,
      insertionOrder: window.insertionOrder,
      trackIndex: cfg.trackIndex,
      avatar: cfg.avatar,
      triggerData: window.triggerData,
    });
  }

  activeEntries.sort((a, b) => {
    if (a.insertionOrder !== b.insertionOrder) return a.insertionOrder - b.insertionOrder;
    return a.trackIndex - b.trackIndex;
  });

  return activeEntries.map(entry => {
    const remaining = entry.windowEnd - queryTime;
    const fraction = Math.max(0, Math.min(1, remaining / LINK_WINDOW_DURATION));

    let onCooldown = false;
    const actor = simState.actors?.get(entry.trackId);
    if (actor?.isOnCooldown) {
      onCooldown = actor.isOnCooldown(`${entry.trackId}_link`, queryTime);
    }

    return {
      trackId: entry.trackId,
      avatar: entry.avatar,
      remaining,
      fraction,
      isLocked: lockedTrackIds.has(entry.trackId),
      onCooldown,
      ...(entry.triggerData ? { triggerData: entry.triggerData } : {}),
    };
  });
}
