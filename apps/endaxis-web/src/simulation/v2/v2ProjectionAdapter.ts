/**
 * V2 Projection Adapter — converts V2 projection output to UI data formats.
 *
 * The existing UI components (TimelineGrid.vue, PropertiesPanel.vue) expect
 * specific data shapes for buff/debuff rendering. This adapter transforms
 * the V2 projection types into those shapes, avoiding any UI component changes.
 */

import type {
  BuffBar,
  BreakBar,
  StackBuffBar,
  AnomalyBar,
  AttachmentBar,
} from "./projections";
import type { BuffStatus } from "../projection/projectWeaponBuffTimeline";
import type { SelfBuffBar } from "../projection/projectSelfBuffTimeline";
import { getBuffMeta, getBuffIcon, resolveBuffIcon } from "./buffMetadata";
import { resolveSourceIcons } from "./sourceIconResolver";

// ── Buff color resolution ──
// Derive color from buffId keywords. Default = gray (physical/generic).
const BUFF_ELEMENT_COLORS: Record<string, string> = {
  blaze: "#ff6b35", fire: "#ff6b35", magma: "#ff6b35", burn: "#ff6b35",
  cold: "#4fc3f7", cryst: "#4fc3f7", frozen: "#4fc3f7", ice: "#4fc3f7",
  emag: "#ab47bc", pulse: "#ab47bc", electro: "#ab47bc", thunder: "#ab47bc",
  nature: "#66bb6a", natural: "#66bb6a", corrosion: "#66bb6a",
};

function resolveBuffColor(buffId: string): string {
  const lower = buffId.toLowerCase();
  for (const [keyword, color] of Object.entries(BUFF_ELEMENT_COLORS)) {
    if (lower.includes(keyword)) return color;
  }
  return "#999"; // generic/physical
}

// ═══════════════════════════════════════════════════════════════════
// BuffBar → BuffStatus (weapon / team / debuff rows)
// ═══════════════════════════════════════════════════════════════════

export interface AdaptedBuffStatuses {
  weaponStatuses: BuffStatus[];
  teamBuffStatuses: BuffStatus[];
  debuffStatuses: BuffStatus[];
}

/**
 * Convert V2 BuffBar[] into categorized BuffStatus arrays
 * matching the existing UI rendering pipeline.
 */
export function adaptBuffBars(
  bars: BuffBar[],
  equipmentIconResolver?: (setId: string) => string,
): AdaptedBuffStatuses {
  const weaponStatuses: BuffStatus[] = [];
  const teamBuffStatuses: BuffStatus[] = [];
  const debuffStatuses: BuffStatus[] = [];

  for (const bar of bars) {
    const meta = getBuffMeta(bar.buffId);
    const duration = bar.endTime - bar.startTime;
    // Source icons for "按技能/天赋" / "按角色" timeline modes.
    const sourceIcons = resolveSourceIcons(bar.sourceRef, bar.actorId, equipmentIconResolver);

    const base: BuffStatus = {
      id: bar.id,
      name: meta?.name || bar.name,
      // Prefer explicit metadata icon; otherwise fall back to a generic icon
      // chosen from the buff's stat+zone (covers converter-generated weapon /
      // equipment buffs that have no per-id metadata entry).
      icon: meta?.icon || resolveBuffIcon(bar.buffId, bar.stat, bar.zone),
      startTime: bar.startTime,
      logicalStartTime: bar.startTime,
      duration,
      stacks: bar.stacks,
      maxStacks: bar.stacks,
      color: "",
      type: "",
      preshifted: true,
      skillIcon: sourceIcons.skillIcon,
      actorIcon: sourceIcons.actorIcon,
      sourceLabel: sourceIcons.label,
      stat: bar.stat,
      zone: bar.zone,
    };

    const buffColor = resolveBuffColor(bar.buffId);

    if (bar.target === "self" || bar.target === "others") {
      weaponStatuses.push({
        ...base,
        trackId: bar.target === "self" ? bar.actorId : undefined,
        sourceTrackId: bar.actorId,
        color: buffColor,
        type: "skill_buff",
      });
    } else if (bar.target === "team") {
      teamBuffStatuses.push({
        ...base,
        sourceTrackId: bar.actorId,
        color: buffColor,
        type: "team_buff",
      });
    } else if (bar.target === "enemy") {
      debuffStatuses.push({
        ...base,
        sourceTrackId: bar.actorId,
        color: buffColor,
        type: "debuff",
      });
    }
  }

  return { weaponStatuses, teamBuffStatuses, debuffStatuses };
}

// ═══════════════════════════════════════════════════════════════════
// StackBuffBar → SelfBuffBar (per-track self-buff row)
// ═══════════════════════════════════════════════════════════════════

/**
 * Convert V2 StackBuffBar[] into per-track SelfBuffBar maps
 * matching computedSelfBuffsByTrack format.
 */
export function adaptStackBuffBars(
  bars: StackBuffBar[],
): Map<string, SelfBuffBar[]> {
  const result = new Map<string, SelfBuffBar[]>();

  for (const bar of bars) {
    const meta = getBuffMeta(bar.buffType);
    const icon = meta?.icon || "";
    const stackIcon = getBuffIcon(bar.buffType, bar.stacks) || icon;

    const selfBar: SelfBuffBar & { maxStacks?: number } = {
      id: bar.id,
      type: bar.buffType,
      name: meta?.name || bar.buffType,
      icon,
      stackIcon,
      startTime: bar.startTime,
      endTime: bar.endTime,
      stacks: bar.stacks,
      color: resolveBuffColor(bar.buffType),
      maxStacks: meta?.maxLayers || 0,
    };

    if (!result.has(bar.actorId)) {
      result.set(bar.actorId, []);
    }
    result.get(bar.actorId)!.push(selfBar);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// AnomalyBar → anomaly debuff format
// ═══════════════════════════════════════════════════════════════════

/** Anomaly debuff matching the store's computedAnomalyDebuffs format. */
export interface AdaptedAnomalyDebuff {
  id: string;
  anomalyType: string;
  startTime: number;
  endTime: number;
  duration: number;
  stacks: number;
  sourceTrackId: string;
  sourceActionInstanceId: string;
  icon: string;
  hideDuration: boolean;
  /** What consumed this (physicalType like "slam"), or undefined if not consumed. */
  consumedBy?: string;
  /** Whether this was consumed (not natural expiry). */
  consumed?: boolean;
  /** V2 times are already in real (freeze-shifted) coordinates; UI must not re-shift. */
  preshifted?: boolean;
}

/** Map V2 anomaly type to UI anomaly type name. */
const ANOMALY_TYPE_TO_UI: Record<string, string> = {
  burning: "burning",
  frozen: "frozen",
  conduction: "conductive",
  corrosion: "corrosion",
};

/**
 * Convert V2 AnomalyBar[] into anomaly debuff format
 * matching computedAnomalyDebuffs.
 */
export function adaptAnomalyBars(bars: AnomalyBar[]): AdaptedAnomalyDebuff[] {
  return bars.map(bar => ({
    id: bar.id,
    anomalyType: ANOMALY_TYPE_TO_UI[bar.anomalyType] || bar.anomalyType,
    startTime: bar.startTime,
    endTime: bar.endTime,
    duration: bar.endTime - bar.startTime,
    stacks: bar.level,
    sourceTrackId: bar.sourceId,
    sourceActionInstanceId: "",
    icon: "",  // resolved by UI from iconDatabase
    hideDuration: false,
    preshifted: true,
  }));
}

// ═══════════════════════════════════════════════════════════════════
// AttachmentBar → attachment debuff format
// ═══════════════════════════════════════════════════════════════════

/** Map V2 magic element to UI attachment type. */
const ELEMENT_TO_ATTACH_TYPE: Record<string, string> = {
  fire: "blaze_attach",
  cold: "cold_attach",
  electro: "emag_attach",
  nature: "nature_attach",
};

/**
 * Convert V2 AttachmentBar[] into attachment debuff format
 * matching computedAnomalyDebuffs attachment entries.
 */
export function adaptAttachmentBars(bars: AttachmentBar[]): AdaptedAnomalyDebuff[] {
  return bars.map(bar => ({
    id: bar.id,
    anomalyType: ELEMENT_TO_ATTACH_TYPE[bar.element] || `${bar.element}_attach`,
    startTime: bar.startTime,
    endTime: bar.endTime,
    duration: bar.endTime - bar.startTime,
    stacks: bar.stacks,
    sourceTrackId: "",
    sourceActionInstanceId: "",
    icon: "",
    hideDuration: false,
    consumed: bar.consumed,
    preshifted: true,
  }));
}

// ═══════════════════════════════════════════════════════════════════
// BreakBar → attachment-like debuff format (破防显示在附着行)
// ═══════════════════════════════════════════════════════════════════

export function adaptBreakBars(bars: BreakBar[]): AdaptedAnomalyDebuff[] {
  return bars.map(bar => ({
    id: bar.id,
    anomalyType: "break",
    startTime: bar.startTime,
    endTime: bar.endTime,
    duration: bar.endTime - bar.startTime,
    stacks: bar.stacks,
    sourceTrackId: "",
    sourceActionInstanceId: "",
    icon: "",
    hideDuration: false,
    consumedBy: bar.consumedBy,
    consumed: !!bar.consumedBy,
    preshifted: true,
  }));
}

// ═══════════════════════════════════════════════════════════════════
// Combined adapter — single call for all projections
// ═══════════════════════════════════════════════════════════════════

export interface V2ProjectedData {
  weaponStatuses: BuffStatus[];
  teamBuffStatuses: BuffStatus[];
  debuffStatuses: BuffStatus[];
  selfBuffsByTrack: Map<string, SelfBuffBar[]>;
  anomalyDebuffs: AdaptedAnomalyDebuff[];
  attachmentDebuffs: AdaptedAnomalyDebuff[];
  breakDebuffs: AdaptedAnomalyDebuff[];
}

/**
 * Adapt all V2 projection results into UI-ready data structures.
 */
export function adaptAllProjections(
  buffBars: BuffBar[],
  stackBuffBars: StackBuffBar[],
  anomalyBars: AnomalyBar[],
  attachmentBars: AttachmentBar[],
  breakBars: BreakBar[],
  equipmentIconResolver?: (setId: string) => string,
): V2ProjectedData {
  const buffs = adaptBuffBars(buffBars, equipmentIconResolver);
  const selfBuffs = adaptStackBuffBars(stackBuffBars);
  const anomalies = adaptAnomalyBars(anomalyBars);
  const attachments = adaptAttachmentBars(attachmentBars);
  const breaks = adaptBreakBars(breakBars);

  return {
    ...buffs,
    selfBuffsByTrack: selfBuffs,
    anomalyDebuffs: anomalies,
    attachmentDebuffs: attachments,
    breakDebuffs: breaks,
  };
}
