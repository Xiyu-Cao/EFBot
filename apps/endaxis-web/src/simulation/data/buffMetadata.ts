/**
 * Buff metadata — display name, icon path, and layer display style for all
 * known buff/debuff effect types.
 *
 * This is a pure data table consumed by:
 *   - simulator.ts Route 2.9 (sets Effect.name and properties.icon)
 *   - UI components for buff icon rendering
 *
 * Icon paths are relative to public/ (served as static assets).
 */

export interface BuffMeta {
  /** Display name (Chinese). */
  name: string;
  /** Icon path (relative to public/). */
  icon: string;
  /**
   * How layers are displayed:
   * - "number": show "name ×N" with a single icon (default for most buffs)
   * - "per-layer-icon": each layer count has its own icon (e.g., magma 0-4)
   *   When set, `layerIcons` must be provided.
   */
  layerDisplay?: "number" | "per-layer-icon";
  /**
   * Per-layer icon map. Key = layer count, value = icon path.
   * Only used when layerDisplay === "per-layer-icon".
   */
  layerIcons?: Record<number, string>;
  /** Maximum layers (for display capping). */
  maxLayers?: number;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const BUFF_METADATA: Record<string, BuffMeta> = {
  // ── Elemental amplify (增幅) ──
  fire_enhance:    { name: "灼热增幅", icon: "/icons/icon_battle_affix_fire_enhance.webp" },
  pulse_enhance:   { name: "电磁增幅", icon: "/icons/icon_battle_affix_pulse_enhance.webp" },
  cryst_enhance:   { name: "寒冷增幅", icon: "/icons/icon_battle_affix_cryst_enhance.webp" },
  natural_enhance: { name: "自然增幅", icon: "/icons/icon_battle_affix_natural_enhance.webp" },
  spell_enhance:   { name: "法术增幅", icon: "/icons/icon_battle_affix_spell_enhance.webp" },

  // ── Vulnerability/fragility (脆弱/易伤) ──
  physical_vulnerable: { name: "物理脆弱", icon: "/icons/icon_battle_affix_physical_vulnerable.webp" },
  spell_vulnerable:    { name: "法术脆弱", icon: "/icons/icon_battle_affix_spell_vulnerable.webp" },
  // Per-character aliases — each character's 物理脆弱 stacks independently but shares the same icon.
  lifeng_physical_vulnerability: { name: "物理脆弱", icon: "/icons/icon_battle_affix_physical_vulnerable.webp" },

  // ── Control ──
  affix_slow:    { name: "缓速", icon: "/icons/icon_battle_affix_slow.webp" },
  fluorite_bomb: { name: "粘性炸弹", icon: "" },
  weak:          { name: "虚弱", icon: "/icons/icon_battle_affix_weak.webp" },
  combo:      { name: "连击", icon: "/icons/icon_battle_affix_combo.webp" },

  // ── ANTAL ──
  antal_buff: { name: "聚焦", icon: "/avatars/ANTAL/icon_battle_antal_buff.webp" },

  // ── ENDMINISTRATOR ──
  endmin_debuff: { name: "结晶", icon: "/avatars/ENDMINISTRATOR/icon_skill_endmin_debuff.webp" },

  // ── POGRANICHNK ──
  pograni_buff: {
    name: "铁誓",
    icon: "/avatars/POGRANICHNK/icon_battle_pograni_buff.webp",
    layerDisplay: "number",
    maxLayers: 5,
  },

  // ── LASTRITE ──
  lastrite_buff: { name: "低温灌注", icon: "/avatars/LASTRITE/icon_battle_lastrite_buff.webp" },
  lastrite_low_temp_infusion: { name: "低温灌注", icon: "/avatars/LASTRITE/icon_battle_lastrite_buff.webp" },

  // ── Physical anomaly ──
  break: { name: "破防", icon: "/icons/icon_battle_physical_no_guard.webp" },
  break_apply: { name: "破防", icon: "/icons/icon_battle_physical_no_guard.webp" },
  break_consume: { name: "消耗破防", icon: "/icons/icon_battle_physical_no_guard.webp" },
  slam: { name: "猛击", icon: "/icons/icon_battle_physical_crush.webp" },
  armorBreak: { name: "碎甲", icon: "/icons/icon_battle_physical_fracture.webp" },
  launch: { name: "击飞", icon: "/icons/icon_battle_physical_airborne.webp" },
  knockdown: { name: "倒地", icon: "/icons/icon_battle_physical_knockdown.webp" },

  // ── XAIHI ──
  skill_seraph: { name: "支援晶体", icon: "/avatars/XAIHI/icon_skill_seraph_01.webp" },

  // ── LAEVATAIN — per-layer icons ──
  magma_1: {
    name: "熔火",
    icon: "/avatars/LAEVATAIN/magma_0.webp",
    layerDisplay: "per-layer-icon",
    maxLayers: 4,
    layerIcons: {
      0: "/avatars/LAEVATAIN/magma_0.webp",
      1: "/avatars/LAEVATAIN/magma_1.webp",
      2: "/avatars/LAEVATAIN/magma_2.webp",
      3: "/avatars/LAEVATAIN/magma_3.webp",
      4: "/avatars/LAEVATAIN/magma_4.webp",
    },
  },
  blaze_to_magma: { name: "灼热→熔火", icon: "/avatars/LAEVATAIN/magma_0.webp" },

  // ── TANGTANG ──
  comboskillwater: {
    name: "涡流",
    icon: "/avatars/TANGTANG/icon_battle_tangtang_comboskillwater.webp",
    layerDisplay: "number",
    maxLayers: 2,
  },
  skillwater:      { name: "水龙卷", icon: "/avatars/TANGTANG/icon_talent_tangtang_02.webp" },
  ultskilldebuff:  { name: "古老图形", icon: "/avatars/TANGTANG/icon_battle_tangtang_ultskilldebuff.webp" },

  // ── AVYWENNA ──
  Thunderlances:      { name: "雷枪", icon: "/avatars/AVYWENNA/icon_combo_skill_avywen_01.webp" },
  "Thunderlances EX": { name: "强雷枪", icon: "/avatars/AVYWENNA/icon_ultimate_skill_avywen_01.webp" },

  // ── DAPAN ──
  dapan_buff: { name: "备料", icon: "/avatars/DAPAN/icon_battle_dapan_buff.webp" },

  // ── SNOWSHINE (暂缓) ──
  combo_skill_aurora: { name: "极地救援", icon: "/avatars/SNOWSHINE/icon_combo_skill_aurora_01.webp" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getBuffMeta(effectType: string): BuffMeta | undefined {
  return BUFF_METADATA[effectType];
}

/**
 * Get the correct icon for a layered buff given its current layer count.
 * Falls back to the base icon if no per-layer mapping exists.
 */
export function getBuffIcon(effectType: string, layerCount?: number): string {
  const meta = BUFF_METADATA[effectType];
  if (!meta) return "";
  if (meta.layerDisplay === "per-layer-icon" && meta.layerIcons && layerCount !== undefined) {
    const clamped = Math.max(0, Math.min(layerCount, meta.maxLayers ?? layerCount));
    return meta.layerIcons[clamped] ?? meta.icon;
  }
  return meta.icon;
}

// ---------------------------------------------------------------------------
// Generic fallback: (stat × zone) → icon
// ---------------------------------------------------------------------------
// When a buff has no explicit BUFF_METADATA entry (e.g. converter-generated
// weapon/equipment buffs), the UI can still render a sensible icon based on
// its semantic stat + zone. Keys are "<stat>|<zone>"; unknown combos fall back
// to the empty string.
const STAT_ZONE_ICON: Record<string, string> = {
  // ATK / general attribute
  "attack|attackPercent":          "/icons/icon_normal_atk_efficiency.webp",
  "attack_percent|attackPercent":  "/icons/icon_normal_atk_efficiency.webp",
  "all_dmg|attackPercent":         "/icons/icon_normal_atk_efficiency.webp",
  // Damage-bonus zone — element specific
  "physical_dmg|dmgBonus":   "/icons/icon_physical_damage_increase.webp",
  "blaze_dmg|dmgBonus":      "/icons/icon_battle_affix_fire_enhance.webp",
  "cold_dmg|dmgBonus":       "/icons/icon_battle_affix_cryst_enhance.webp",
  "emag_dmg|dmgBonus":       "/icons/icon_battle_affix_pulse_enhance.webp",
  "nature_dmg|dmgBonus":     "/icons/icon_battle_affix_natural_enhance.webp",
  "arts_dmg|dmgBonus":       "/icons/icon_battle_affix_spell_enhance.webp",
  "all_dmg|dmgBonus":        "/icons/icon_normal_atk_efficiency.webp",
  // Skill-type damage bonuses (attack_dmg_bonus / skill_dmg_bonus etc.) —
  // fall back to attack icon since these boost the character's output.
  "attack_dmg_bonus|dmgBonus":   "/icons/icon_normal_atk_efficiency.webp",
  "skill_dmg_bonus|dmgBonus":    "/icons/icon_normal_skill_efficiency.webp",
  "link_dmg_bonus|dmgBonus":     "/icons/icon_comboskill_cooldown_scalar.webp",
  "ultimate_dmg_bonus|dmgBonus": "/icons/icon_ultimate_skill_efficiency.webp",
  "all_skill_dmg_bonus|dmgBonus": "/icons/icon_normal_atk_efficiency.webp",
  // Fragility (enemy takes more of element)
  "physical_dmg|fragility": "/icons/icon_battle_affix_physical_vulnerable.webp",
  "blaze_dmg|fragility":    "/icons/icon_battle_affix_fire_enhance.webp",
  "cold_dmg|fragility":     "/icons/icon_battle_affix_cryst_enhance.webp",
  "emag_dmg|fragility":     "/icons/icon_battle_affix_pulse_enhance.webp",
  "nature_dmg|fragility":   "/icons/icon_battle_affix_natural_enhance.webp",
  "arts_dmg|fragility":     "/icons/icon_battle_affix_spell_vulnerable.webp",
  // Vulnerability (enemy takes more damage general)
  "physical_dmg|vulnerability": "/icons/icon_battle_affix_physical_vulnerable.webp",
  "all_dmg|vulnerability":      "/icons/icon_attr_damage_to_broken_unit_increase.webp",
  // Crit
  "crit_rate|additive":     "/icons/icon_attribute_criticalRate.webp",
  "crit_damage|additive":   "/icons/icon_attribute_criticalDamageIncrease.webp",
  // Originium arts power
  "originium_arts_power|additive": "/icons/icon_originium_arts.webp",
  // Secondary / primary ability (attribute bonuses)
  "primary_ability|additive":   "/icons/icon_attribute_str.webp",
  "secondary_ability|additive": "/icons/icon_attribute_agi.webp",
};

/**
 * Resolve an icon path for a buff, preferring an explicit metadata entry and
 * falling back to the generic (stat + zone)-based mapping so converter-generated
 * weapon / equipment buffs don't need per-id metadata.
 */
export function resolveBuffIcon(
  buffId: string,
  stat?: string,
  zone?: string,
  layerCount?: number,
): string {
  const direct = getBuffIcon(buffId, layerCount);
  if (direct) return direct;
  if (stat && zone) {
    const key = `${stat}|${zone}`;
    const fallback = STAT_ZONE_ICON[key];
    if (fallback) return fallback;
  }
  return "";
}
