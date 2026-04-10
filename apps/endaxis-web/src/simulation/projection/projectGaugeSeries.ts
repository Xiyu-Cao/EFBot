/**
 * Project gauge (ultimate charge) time-series from simLog.
 *
 * Replaces the store's `calculateGaugeData` by consuming authoritative
 * GAUGE_CHANGE simLog entries produced by:
 *   - ActionStartHandler (ultimate gauge cost, negative)
 *   - SpChangeHandler (SP consumption → charge, positive)
 *   - ActionEndHandler (excess gaugeGain beyond SP charge, positive)
 *
 * Output format: [{ time, val, ratio }] — matches calculateGaugeData.
 */

import type { SimLogEntry } from "../events/event.types";

export interface GaugeDataPoint {
  time: number;
  val: number;
  ratio: number;
}

/**
 * Build a gauge time-series for a single actor from simLog.
 *
 * @param simLog - Full simulation log
 * @param actorId - The actor to project gauge for
 * @param initialGauge - Starting gauge value (from track config)
 * @param maxGauge - Gauge cap (after potential modifiers)
 * @param endTime - End time for the series (viewDuration)
 */
export function projectGaugeSeries(
  simLog: SimLogEntry[],
  actorId: string,
  initialGauge: number,
  maxGauge: number,
  endTime: number,
): GaugeDataPoint[] {
  const cap = Math.max(1, maxGauge);
  let currentGauge = Math.max(0, Math.min(initialGauge, cap));
  const ratio = () => currentGauge / cap;

  const points: GaugeDataPoint[] = [{ time: 0, val: currentGauge, ratio: ratio() }];

  if (simLog?.length) {
    for (const entry of simLog) {
      if (entry.type !== "GAUGE_CHANGE") continue;
      const p = entry.payload as { actorId: string; change: number };
      if (p.actorId !== actorId) continue;

      // Step before change
      points.push({ time: entry.time, val: currentGauge, ratio: ratio() });
      // Apply
      currentGauge += p.change;
      if (currentGauge > cap) currentGauge = cap;
      if (currentGauge < 0) currentGauge = 0;
      // Step after change
      points.push({ time: entry.time, val: currentGauge, ratio: ratio() });
    }
  }

  points.push({ time: endTime, val: currentGauge, ratio: ratio() });
  return points;
}
