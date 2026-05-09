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
import { getBuffMeta, getBuffIcon, resolveBuffIcon, isGenericBuff } from "./buffMetadata";
import { resolveSourceIcons } from "./sourceIconResolver";

// UI row shape for weapon / team-buff / debuff statuses. Consumed by
// TimelineGrid + PropertiesPanel. `preshifted: true` tells TimelineGrid
// the times are already in real (freeze-shifted) coordinates.
export interface BuffStatus {
  id: string;
  /** Semantic buff id (from BuffBar.buffId) — used for detail lookup. */
  buffId?: string;
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
  preshifted?: boolean;
  skillIcon?: string;
  actorIcon?: string;
  sourceLabel?: string;
  stat?: string;
  zone?: string;
  /** When true, the UI renders a stack/level badge even for stacks === 1
   *  (e.g. 碎甲 Lv.1 still carries vulnerability — its level should be
   *  visible to the player). */
  forceShowStacks?: boolean;
}

// UI row shape for per-track self-buff bars (e.g. 熔火 stacks).
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
    // Icon sourcing:
    //  - Universal game-mechanic buffs (物理/法术异常, 连击, 脆弱, 附着增幅, …)
    //    always render their canonical icon regardless of display mode —
    //    these are not character-specific, so who caused them is irrelevant
    //    to the icon. For those we override skill/actor icons with meta.icon
    //    so the Vue UI's per-mode selector still lands on the generic icon.
    //  - Other buffs use sourceRef-derived icons (talent/skill/weapon) so
    //    "按技能" and "按角色" modes render meaningful distinctions.
    const metaIcon = meta?.icon || resolveBuffIcon(bar.buffId, bar.stat, bar.zone);
    const sourceIcons = isGenericBuff(bar.buffId)
      ? { skillIcon: metaIcon, actorIcon: metaIcon, label: meta?.name || bar.buffId }
      : resolveSourceIcons(bar.sourceRef, bar.actorId, equipmentIconResolver);

    const base: BuffStatus = {
      id: bar.id,
      buffId: bar.buffId,
      name: meta?.name || bar.name,
      // Prefer explicit metadata icon; otherwise fall back to a generic icon
      // chosen from the buff's stat+zone (covers converter-generated weapon /
      // equipment buffs that have no per-id metadata entry).
      icon: metaIcon,
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
      // Physical-anomaly-style debuffs (碎甲 / 未来的其他物理异常派生脆弱)
      // need their level badge visible even at Lv.1, since the level controls
      // vuln magnitude and duration.
      const forceShowStacks = bar.buffId === "armorBreak";
      debuffStatuses.push({
        ...base,
        sourceTrackId: bar.actorId,
        color: buffColor,
        type: "debuff",
        forceShowStacks,
      });
    }
  }

  return { weaponStatuses, teamBuffStatuses, debuffStatuses };
}

// ═══════════════════════════════════════════════════════════════════
// StackBuffBar → SelfBuffBar (per-track self-buff row)
// ═══════════════════════════════════════════════════════════════════

/** Result of adapting stack-buff bars — split into per-track and team rows. */
export interface AdaptedStackBuffs {
  /** Per-track self-buff bars (keyed by actorId). */
  selfBuffs: Map<string, SelfBuffBar[]>;
  /** Team-scoped stack buffs (e.g. 连击), promoted to BuffStatus so the
   *  existing team-buff row can render them alongside regular team buffs. */
  teamStackBuffs: BuffStatus[];
}

/**
 * Convert V2 StackBuffBar[] into per-track SelfBuffBar maps
 * matching computedSelfBuffsByTrack format.
 *
 * Stack buffs whose metadata carries `teamBuff: true` are routed to the
 * separate `teamStackBuffs` list (merged into team row by adaptAllProjections)
 * instead of the per-track selfBuffs map.
 */
export function adaptStackBuffBars(
  bars: StackBuffBar[],
): AdaptedStackBuffs {
  const selfBuffs = new Map<string, SelfBuffBar[]>();
  const teamStackBuffs: BuffStatus[] = [];

  for (const bar of bars) {
    const meta = getBuffMeta(bar.buffType);
    const icon = meta?.icon || "";
    const stackIcon = getBuffIcon(bar.buffType, bar.stacks) || icon;
    const duration = Math.max(0, bar.endTime - bar.startTime);
    const color = resolveBuffColor(bar.buffType);

    if (meta?.teamBuff) {
      teamStackBuffs.push({
        id: bar.id,
        buffId: bar.buffType,
        name: meta.name || bar.buffType,
        icon,
        color,
        startTime: bar.startTime,
        logicalStartTime: bar.startTime,
        duration,
        type: "team_buff",
        sourceTrackId: bar.actorId,
        stacks: bar.stacks,
        maxStacks: meta.maxLayers || bar.stacks,
        preshifted: true,
      });
      continue;
    }

    const selfBar: SelfBuffBar & { maxStacks?: number } = {
      id: bar.id,
      type: bar.buffType,
      name: meta?.name || bar.buffType,
      icon,
      stackIcon,
      startTime: bar.startTime,
      endTime: bar.endTime,
      stacks: bar.stacks,
      color,
      maxStacks: meta?.maxLayers || 0,
    };

    if (!selfBuffs.has(bar.actorId)) {
      selfBuffs.set(bar.actorId, []);
    }
    selfBuffs.get(bar.actorId)!.push(selfBar);
  }

  return { selfBuffs, teamStackBuffs };
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

/**
 * Split each break lifecycle into one adapted entry per stack-level segment,
 * mirroring the attachment-bar pattern. A 1→2→3 break sequence produces three
 * entries (at the respective stack-change times), each with its own icon and
 * level badge on the UI. Only the final segment carries consumed/consumedBy so
 * the consume marker renders at the real end of the lifecycle.
 */
export function adaptBreakBars(bars: BreakBar[]): AdaptedAnomalyDebuff[] {
  const out: AdaptedAnomalyDebuff[] = [];
  for (const bar of bars) {
    const segs = bar.segments && bar.segments.length > 0
      ? bar.segments
      : [{ stacks: bar.stacks, startTime: bar.startTime, endTime: bar.endTime }];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const isLastSeg = i === segs.length - 1;
      out.push({
        id: segs.length > 1 ? `${bar.id}_s${i}` : bar.id,
        anomalyType: "break",
        startTime: seg.startTime,
        endTime: seg.endTime,
        duration: seg.endTime - seg.startTime,
        stacks: seg.stacks,
        sourceTrackId: "",
        sourceActionInstanceId: "",
        icon: "",
        hideDuration: false,
        consumedBy: isLastSeg ? bar.consumedBy : undefined,
        consumed: isLastSeg ? !!bar.consumedBy : false,
        preshifted: true,
      });
    }
  }
  return out;
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
  const { selfBuffs, teamStackBuffs } = adaptStackBuffBars(stackBuffBars);
  const anomalies = adaptAnomalyBars(anomalyBars);
  const attachments = adaptAttachmentBars(attachmentBars);
  const breaks = adaptBreakBars(breakBars);

  return {
    ...buffs,
    teamBuffStatuses: [...buffs.teamBuffStatuses, ...teamStackBuffs],
    selfBuffsByTrack: selfBuffs,
    anomalyDebuffs: anomalies,
    attachmentDebuffs: attachments,
    breakDebuffs: breaks,
  };
}
