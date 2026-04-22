/**
 * Buff source icon resolver — maps a `TriggerSourceRef` to two icon paths
 * (`skillIcon` / `actorIcon`) + a display label. Used by the timeline UI to
 * render buffs as either "按技能/天赋" or "按角色" visual modes.
 *
 * Character / weapon / equipment folders follow a naming convention:
 *   /avatars/<CHAR>/<CHAR>.webp                                 — actor portrait
 *   /avatars/<CHAR>/icon_talent_<char>_0{1,2}.webp              — talent icons
 *   /avatars/<CHAR>/icon_skill_<char>_01.webp                   — 战技
 *   /avatars/<CHAR>/icon_combo_skill_<char>_01.webp             — 连携技
 *   /avatars/<CHAR>/icon_ultimate_skill_<char>_01.webp          — 终结技
 *   /weapons/<type>/<weaponId>.webp                             — weapon icon
 * Equipment sets have no dedicated icon; the resolver accepts a callback that
 * returns a representative piece icon for a given set id.
 */

import type { TriggerSourceRef } from "./types";
import { V2_WEAPON_REGISTRY } from "./weapons/definitions";

/** Mapping from uppercase actor id → lowercase file-prefix used in asset names. */
const CHAR_FILE_PREFIX: Record<string, string> = {
  ENDMINISTRATOR: "endmin",
  LIFENG:         "lifeng",
  LASTRITE:       "lastrite",
  POGRANICHNK:    "pograni",
  CHENQIANYU:     "chen",
  ZHUANGFANGYI:   "zhuangfy",
};

/** Default display label per kind (falls back to generic text if actor unknown). */
const KIND_LABEL: Record<string, string> = {
  talent_0:      "天赋 I",
  talent_1:      "天赋 II",
  talent_2:      "天赋 III",
  skill:         "战技",
  link:          "连携技",
  ultimate:      "终结技",
  weapon:        "武器",
  equipment_set: "装备套装",
};

export interface ResolvedSourceIcons {
  /** Per-source icon (talent / skill / weapon / set). */
  skillIcon: string;
  /** Character portrait (for "按角色" mode); empty for weapon/equipment without
   *  a carrier actor in the resolver's input. */
  actorIcon: string;
  /** Display label (used in detail panel). */
  label: string;
}

/**
 * Resolve a buff's source to icon paths.
 *
 * @param ref      The trigger source ref, if the buff originated from a PassiveTrigger.
 * @param actorId  The actor who applied the buff (from BuffBar.actorId). Used for
 *                 weapon/equipment triggers (attributing icon to carrier) and as
 *                 the default actorIcon when sourceRef has no explicit actor.
 * @param equipmentIconResolver Callback to look up a set's representative piece
 *                 icon by set id. Provided by the UI layer (which has access to
 *                 `equipmentDatabase`).
 */
export function resolveSourceIcons(
  ref: TriggerSourceRef | undefined,
  actorId: string,
  equipmentIconResolver?: (setId: string) => string,
): ResolvedSourceIcons {
  const actorIcon = actorId ? `/avatars/${actorId}/${actorId}.webp` : "";

  if (!ref) {
    // No trigger metadata — this is a direct hit.effect buff. Fall back to
    // the carrying actor.
    return { skillIcon: actorIcon, actorIcon, label: actorId };
  }

  switch (ref.kind) {
    case "talent_0":
    case "talent_1":
    case "talent_2": {
      const charId = ref.actorId || actorId;
      const prefix = CHAR_FILE_PREFIX[charId];
      const idx = ref.kind === "talent_0" ? "01" : ref.kind === "talent_1" ? "02" : "03";
      const skill = prefix
        ? `/avatars/${charId}/icon_talent_${prefix}_${idx}.webp`
        : "";
      return {
        skillIcon: skill || actorIcon,
        actorIcon: charId ? `/avatars/${charId}/${charId}.webp` : actorIcon,
        label: `${charId} ${KIND_LABEL[ref.kind]}`,
      };
    }
    case "skill":
    case "link":
    case "ultimate": {
      const charId = ref.actorId || actorId;
      const prefix = CHAR_FILE_PREFIX[charId];
      const filePart = ref.kind === "skill"
        ? `icon_skill_${prefix}_01.webp`
        : ref.kind === "link"
          ? `icon_combo_skill_${prefix}_01.webp`
          : `icon_ultimate_skill_${prefix}_01.webp`;
      const skill = prefix ? `/avatars/${charId}/${filePart}` : "";
      return {
        skillIcon: skill || actorIcon,
        actorIcon: charId ? `/avatars/${charId}/${charId}.webp` : actorIcon,
        label: `${charId} ${KIND_LABEL[ref.kind]}`,
      };
    }
    case "weapon": {
      const weapon = V2_WEAPON_REGISTRY[ref.id];
      const typeDir = weapon?.type || "sword";
      const skill = `/weapons/${typeDir}/${ref.id}.webp`;
      return {
        skillIcon: skill,
        actorIcon,
        label: weapon?.name ? `${weapon.name}（武器）` : `${ref.id}（武器）`,
      };
    }
    case "equipment_set": {
      const skill = equipmentIconResolver?.(ref.id) || "";
      return {
        skillIcon: skill,
        actorIcon,
        label: `${ref.id}（装备套装）`,
      };
    }
    default:
      return { skillIcon: actorIcon, actorIcon, label: actorId };
  }
}
