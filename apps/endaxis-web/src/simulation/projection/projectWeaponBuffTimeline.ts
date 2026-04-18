/**
 * Project weapon/team/debuff buff timelines from simLog.
 *
 * Replaces the store's `_autoGenerateBuffs` by consuming authoritative
 * WEAPON_BUFF_APPLIED simLog entries produced by registerTriggeredBuff
 * in simulator.ts.
 *
 * Output: categorized buff status arrays matching the store's data structures.
 */

import type { SimLogEntry } from "../events/event.types";

export interface BuffStatus {
  id: string;
  name: string;
  icon: string;
  color: string;
  startTime: number;
  logicalStartTime: number;
  duration: number;
  type: string;
  trackId?: string;
  sourceTrackId?: string;
  sourceActionInstanceId?: string;
  weaponId?: string;
  stacks?: number;
  maxStacks?: number;
  /** True when startTime/endTime are already in real (freeze-shifted) coordinates
   *  and should NOT be re-shifted by TimelineGrid's getShiftedEndTime. Set by V2
   *  kernel projections whose event times come directly from `action.startTime`. */
  preshifted?: boolean;
  /** Source icons for timeline "按技能" / "按角色" display modes. */
  skillIcon?: string;
  actorIcon?: string;
  /** Human-readable source label (for detail panel) — e.g. "黎风天赋·伏魔". */
  sourceLabel?: string;
}

export interface ProjectedBuffTimelines {
  /** Self buffs keyed to specific tracks (weapon passives on self) */
  weaponStatuses: BuffStatus[];
  /** Team-wide buffs */
  teamBuffStatuses: BuffStatus[];
  /** Enemy debuffs */
  debuffStatuses: BuffStatus[];
}

let _counter = 0;

/**
 * Scan simLog for WEAPON_BUFF_APPLIED entries and produce buff status arrays.
 *
 * @param simLog - Full simulation log
 * @param trackIds - All active track IDs (for "others" target distribution)
 * @param weaponIcons - Map of weaponId → icon URL
 */
export function projectWeaponBuffTimeline(
  simLog: SimLogEntry[],
  trackIds: string[],
  weaponIcons: Record<string, string>,
): ProjectedBuffTimelines {
  const weaponStatuses: BuffStatus[] = [];
  const teamBuffStatuses: BuffStatus[] = [];
  const debuffStatuses: BuffStatus[] = [];

  if (!simLog?.length) return { weaponStatuses, teamBuffStatuses, debuffStatuses };

  for (const entry of simLog) {
    if (entry.type !== "WEAPON_BUFF_APPLIED") continue;
    const p = entry.payload as {
      actorId: string;
      buffName: string;
      target: string;
      duration: number;
      stacks: number;
      maxStacks: number;
      weaponId: string;
      triggerAction: string;
    };

    if (p.duration <= 0) continue;

    const icon = weaponIcons[p.weaponId] || "";
    const base = {
      name: p.buffName,
      icon,
      startTime: entry.time,
      logicalStartTime: entry.time,
      duration: p.duration,
      weaponId: p.weaponId,
      sourceActionInstanceId: p.triggerAction,
      stacks: p.stacks,
      maxStacks: p.maxStacks,
    };

    _counter++;

    if (p.target === "self") {
      weaponStatuses.push({
        ...base,
        id: `wsim_${_counter}`,
        trackId: p.actorId,
        color: "#b37feb",
        type: "weapon",
      });
    } else if (p.target === "team") {
      teamBuffStatuses.push({
        ...base,
        id: `tsim_${_counter}`,
        sourceTrackId: p.actorId,
        color: "#faad14",
        type: "team_buff",
      });
    } else if (p.target === "enemy") {
      debuffStatuses.push({
        ...base,
        id: `dsim_${_counter}`,
        sourceTrackId: p.actorId,
        color: "#ff4d4f",
        type: "debuff",
      });
    } else if (p.target === "others") {
      for (const tid of trackIds) {
        if (tid === p.actorId) continue;
        _counter++;
        weaponStatuses.push({
          ...base,
          id: `wsim_${_counter}`,
          trackId: tid,
          color: "#b37feb",
          type: "weapon",
        });
      }
    }
  }

  return { weaponStatuses, teamBuffStatuses, debuffStatuses };
}
