/**
 * Project self-buff (exclusive_buff) timeline bars from simLog.
 *
 * Replaces the store's `computedSelfBuffSimulation` self-buff bar generation
 * by consuming SELF_BUFF_CHANGE simLog entries from the engine.
 *
 * Output: Map<trackId, SelfBuffBar[]> matching computedSelfBuffsByTrack format.
 */

import type { SimLogEntry } from "../events/event.types";

export interface SelfBuffBar {
  id: string;
  type: string;
  name: string;
  icon: string;
  stackIcon: string;
  startTime: number;
  endTime: number;
  stacks: number;
  color: string;
}

export interface ExclusiveBuffInfo {
  key: string;
  name: string;
  path: string;
}

/**
 * Build self-buff timeline bars from SELF_BUFF_CHANGE simLog entries.
 *
 * @param simLog - Full simulation log
 * @param exclusiveBuffsByTrack - Map of trackId → exclusive_buffs array (from characterRoster)
 * @param endTime - Timeline end time (viewDuration)
 */
export function projectSelfBuffTimeline(
  simLog: SimLogEntry[],
  exclusiveBuffsByTrack: Map<string, ExclusiveBuffInfo[]>,
  endTime: number,
): Map<string, SelfBuffBar[]> {
  const result = new Map<string, SelfBuffBar[]>();
  if (!simLog?.length) return result;

  // Collect SELF_BUFF_CHANGE events grouped by (actorId, buffType)
  const eventsByActor = new Map<string, Map<string, { time: number; stacks: number }[]>>();

  for (const entry of simLog) {
    if (entry.type !== "SELF_BUFF_CHANGE") continue;
    const p = entry.payload as { actorId: string; buffType: string; stacks: number };
    if (!eventsByActor.has(p.actorId)) eventsByActor.set(p.actorId, new Map());
    const byType = eventsByActor.get(p.actorId)!;
    if (!byType.has(p.buffType)) byType.set(p.buffType, []);
    byType.get(p.buffType)!.push({ time: entry.time, stacks: p.stacks });
  }

  let counter = 0;

  for (const [actorId, byType] of eventsByActor) {
    const buffs = exclusiveBuffsByTrack.get(actorId) || [];
    const bars: SelfBuffBar[] = [];

    for (const [prefix, events] of byType) {
      events.sort((a, b) => a.time - b.time);

      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        if (ev.stacks <= 0) continue;

        const nextTime = i + 1 < events.length ? events[i + 1].time : endTime;
        if (nextTime <= ev.time) continue;

        // Find matching exclusive_buff for display info
        const stackKey = `${prefix}_${ev.stacks}`;
        const stackBuff = buffs.find(b => b.key === stackKey);
        const baseBuff = buffs.find(b => b.key.startsWith(prefix + "_"));

        counter++;
        bars.push({
          id: `sbsim_${counter}`,
          type: prefix,
          name: stackBuff?.name || prefix,
          icon: baseBuff?.path || "",
          stackIcon: stackBuff?.path || baseBuff?.path || "",
          startTime: ev.time,
          endTime: nextTime,
          stacks: ev.stacks,
          color: "#ffa940",
        });
      }
    }

    if (bars.length > 0) result.set(actorId, bars);
  }

  return result;
}
