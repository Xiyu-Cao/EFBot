/**
 * V2 Character / Enemy panel — single-shot snapshot of raw inputs.
 *
 * Panels are built once per "validate timeline" call (or cached by the store).
 * They carry the raw components (base values, stat modifiers, skill levels,
 * potential level, weapon / equipment data) — NOT computed final values like
 * final ATK. Downstream code (storeAdapter → kernel) derives `CharacterBuild`
 * from `panel.input` via `computeCharacterBuild`, so the in-game formula is
 * always applied consistently.
 *
 * Cooldown resolution (ultimate / link CD + potential `cooldown_modifier`
 * flat-seconds) happens inside `buildCharacterPanel` and produces
 * `resolvedSkills` — clones of `mod.skills`, never mutating the shared module.
 */

import type { Skill, PassiveTrigger, DamageElement } from "./types";
import type { CharacterInput, StatModifier } from "./characterBuild";
import { computeTalentRow1Bonus } from "./characterBuild";
import type { EnemyConfig } from "./kernel";
import ultimateCooldownsData from "../../data/operators/ultimateCooldowns.json";

const ultimateCooldowns = ultimateCooldownsData as Record<string, { name?: string; cooldown?: number }>;

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface ResolvedSkills {
  attack?: Skill[];
  skill?: Skill;
  skillInChain?: Skill;
  link?: Skill | Skill[];
  ultimate?: Skill;
}

export interface CharacterPanel {
  /** Actor ID (= character module id). */
  actorId: string;
  /** Raw character inputs — feeds `computeCharacterBuild(panel.input)`. */
  input: CharacterInput;
  /** `true` when the character's gauge-refund rule excludes team contributions. */
  gaugeFromSelfOnly: boolean;
  /** Skills with ultimate / link CD injected + potential flat-seconds applied.
   *  Cloned from `mod.skills`; the source module object is never mutated. */
  resolvedSkills: ResolvedSkills;
  /** Variant definitions from mod (passed through; not mutated). */
  variants: any;
  /** Execution (处决) skill — kept separate so kernel can pick it up for auto-
   *  conversion during stagger windows. */
  execSkill: Skill | null;
  /** Triggers: character + weapon (tier-resolved) + equipment set. */
  triggers: PassiveTrigger[];
  /** Readonly reference to mod.skillData (for MultiplierRef label lookup). */
  skillData: any;
  /** Actor's per-skill rank / mastery snapshot (drives levelData index). */
  skillLevels: Record<string, { rank: number; mastery: number }>;
  /** Pre-resolved talent_X → numeric value at the actor's talent level. */
  talentValues: Map<string, number>;
  /** Attack segment re-evaluation helper data: total normal segments count. */
  totalAttackSegments: number;
}

export interface EnemyPanel {
  /** Base enemy runtime config consumed by the kernel. */
  config: EnemyConfig;
  // Reserved for future stage-scoped buffs / debuffs:
  //   stageBuffs?: StatModifier[];
  //   stageDebuffs?: StatModifier[];
}

// ═══════════════════════════════════════════════════════════════════
// Skill-level index mapping
// ═══════════════════════════════════════════════════════════════════

/** Map `{ rank, mastery }` → unified index 0-11 into `levelData.values`.
 *  rank 1..8 → index 0..7; rank 9 + mastery 0..3 → index 8..11.
 *  Missing level defaults to index 11 (M3) as a conservative fallback. */
export function toLevelIndex(level?: { rank: number; mastery: number }): number {
  if (!level) return 11;
  const r = Math.max(1, Math.min(9, Number(level.rank) || 1));
  const m = Math.max(0, Math.min(3, Number(level.mastery) || 0));
  const unified = r < 9 ? r : 9 + m; // 1..12
  return Math.max(0, Math.min(11, unified - 1));
}

// ═══════════════════════════════════════════════════════════════════
// Potential-derived cooldown reductions
// ═══════════════════════════════════════════════════════════════════

/** Sum flat-second `cooldown_modifier` effects from potentials whose level
 *  is ≤ the character's potential level, grouped by the skill type they target. */
export function collectPotentialCooldownMods(
  mod: any,
  potentialLevel: number,
): { link: number; skill: number; ultimate: number } {
  const out = { link: 0, skill: 0, ultimate: 0 };
  const pots = mod?.potentials;
  if (!Array.isArray(pots)) return out;
  for (const pot of pots) {
    if (!pot || pot.level > potentialLevel) continue;
    const effs = pot.effects;
    if (!Array.isArray(effs)) continue;
    for (const eff of effs) {
      if (eff?.type !== "cooldown_modifier") continue;
      const stat = eff.stat as "link" | "skill" | "ultimate";
      if (stat in out) out[stat] += Number(eff.value) || 0; // value is negative for reduction
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// Skill resolution
// ═══════════════════════════════════════════════════════════════════

/** Read the "冷却时间" row from a skill section's levelData at the given level index. */
function readCooldownFromSkillData(section: any, levelIdx: number): number {
  const row = section?.levelData?.find?.((r: any) => r?.label === "冷却时间");
  if (!row || !Array.isArray(row.values)) return 0;
  const raw = String(row.values[levelIdx] ?? row.values[row.values.length - 1] ?? "0");
  const cd = parseFloat(raw.replace("%", "").replace("s", ""));
  return Number.isFinite(cd) ? cd : 0;
}

/**
 * Resolve a character's skills for a panel:
 *   1. Shallow-clone mod.skills (no mutation of the source).
 *   2. Inject ultimate CD from ultimateCooldowns.json (level-independent per char).
 *   3. Inject link CD from mod.skillData.link.levelData at the actor's link level.
 *   4. Inject skill CD from mod.skillData.skill.levelData if present (rare today).
 *   5. Apply potential `cooldown_modifier` flat-seconds reductions (all clamped at 0).
 *
 * Ordering matters: potential mods apply LAST, on top of level-resolved CDs, so
 * POGRANICHNK P5's link -2s subtracts from the M3 link cooldown value.
 */
export function resolveSkillsForPanel(
  mod: any,
  skillLevels: Record<string, { rank: number; mastery: number }>,
  potentialLevel: number,
): ResolvedSkills {
  const src = mod?.skills || {};
  const out: ResolvedSkills = { ...src };

  // ── 2. Ultimate CD injection ──
  const charId = mod?.identity?.id;
  const ultCd = charId ? ultimateCooldowns[charId]?.cooldown : undefined;
  if (out.ultimate && typeof ultCd === "number" && ultCd > 0) {
    out.ultimate = { ...out.ultimate, cooldown: ultCd };
  }

  // ── 3. Link CD from skillData ──
  if (out.link && mod?.skillData?.link) {
    const cd = readCooldownFromSkillData(mod.skillData.link, toLevelIndex(skillLevels?.link));
    if (cd > 0) {
      if (Array.isArray(out.link)) {
        out.link = out.link.map((s: Skill) => ({ ...s, cooldown: cd }));
      } else {
        out.link = { ...out.link, cooldown: cd };
      }
    }
  }

  // ── 4. Skill CD from skillData (if game data exposes one) ──
  if (out.skill && mod?.skillData?.skill) {
    const cd = readCooldownFromSkillData(mod.skillData.skill, toLevelIndex(skillLevels?.skill));
    if (cd > 0) {
      out.skill = { ...out.skill, cooldown: cd };
      if (out.skillInChain) {
        out.skillInChain = { ...out.skillInChain, cooldown: cd };
      }
    }
  }

  // ── 5. Apply potential flat-seconds reductions (last) ──
  return adjustSkillCooldowns(out, collectPotentialCooldownMods(mod, potentialLevel));
}

/** Return a shallow-cloned skills view with flat-second cooldown modifiers
 *  applied per skill type. Clamped at 0; preserves identity for skills with
 *  cooldown=0 (nothing to reduce) so callers can tell "untouched" from "cloned". */
export function adjustSkillCooldowns(
  skills: ResolvedSkills,
  mods: { link: number; skill: number; ultimate: number },
): ResolvedSkills {
  if (!skills) return skills;
  const applyFlat = (s: Skill | undefined | null, flat: number): Skill | undefined | null => {
    if (!s || !flat) return s;
    const base = Number(s.cooldown) || 0;
    if (base <= 0) return s;
    return { ...s, cooldown: Math.max(0, base + flat) };
  };
  const out: ResolvedSkills = { ...skills };
  if (out.link && mods.link) {
    out.link = Array.isArray(out.link)
      ? out.link.map((s: Skill) => applyFlat(s, mods.link) as Skill)
      : applyFlat(out.link, mods.link) as Skill;
  }
  if (out.skill && mods.skill) out.skill = applyFlat(out.skill, mods.skill) as Skill;
  if (out.skillInChain && mods.skill) out.skillInChain = applyFlat(out.skillInChain, mods.skill) as Skill;
  if (out.ultimate && mods.ultimate) out.ultimate = applyFlat(out.ultimate, mods.ultimate) as Skill;
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// Talent value resolution
// ═══════════════════════════════════════════════════════════════════

/** Map talent_X → numeric value for the actor's current talent level.
 *  Picks the highest-promotion stage with `promotion <= level`.
 *
 *  When `activePotentialEffects` is supplied, any `{ type: "talent_enhance",
 *  talent: "talent_X", valueBonus: N }` entries are accumulated into the
 *  resolved value. Lets potentials like ROSSI P3 (沸血 +8%) and LIFENG P3
 *  (顿悟 +0.05/point) modify the talent_X resolved by `multiplierFromTalent`
 *  / `valueRef: "talent_X"` without character-side hardcoding. */
export function resolveTalentValues(
  mod: any,
  talentLevels: Record<string, number>,
  activePotentialEffects?: Array<{ type?: string; talent?: string; valueBonus?: number }>,
): Map<string, number> {
  const map = new Map<string, number>();
  if (!Array.isArray(mod?.talents)) return map;
  for (const talent of mod.talents) {
    const level = Number(talentLevels?.[talent.id]) || 0;
    if (level <= 0 || !Array.isArray(talent.stages)) continue;
    const stage = [...talent.stages].reverse().find((s: any) => Number(s.promotion) <= level);
    if (!stage) continue;
    const baseValue = Number(stage.value ?? stage.damageMultiplier ?? stage.valuePerPoint ?? 0) || 0;
    let bonus = 0;
    if (Array.isArray(activePotentialEffects)) {
      for (const eff of activePotentialEffects) {
        if (eff?.type === "talent_enhance" && eff?.talent === talent.id) {
          bonus += Number(eff.valueBonus) || 0;
        }
      }
    }
    map.set(talent.id, baseValue + bonus);
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════════
// Level stats lookup
// ═══════════════════════════════════════════════════════════════════

export interface BaseLevelStats {
  strength: number; agility: number; intellect: number; will: number;
  attack: number; hp: number;
}

/** Look up base stats from V2 module's levelStats JSON. */
export function lookupLevelStats(levelStats: any, level: number): BaseLevelStats | null {
  const table = levelStats?.levels || levelStats;
  if (!table) return null;
  const exact = table[String(level)];
  if (exact) return exact;
  const levels = Object.keys(table).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
  if (levels.length === 0) return null;
  let best = levels[0];
  for (const l of levels) if (l <= level) best = l;
  return table[String(best)] || null;
}

// ═══════════════════════════════════════════════════════════════════
// Stat modifier collection — from the store's configured "干员面板"
// ═══════════════════════════════════════════════════════════════════

/**
 * Map from store stat names → kernel stat names, with the `CORE_STATS` default.
 * Attribute stats (strength/agility/intellect/will) and `attack` flat are NOT
 * in this table — they're handled separately because their "base" isn't a
 * constant default but the per-level `lookupLevelStats` value.
 */
const NON_ATTR_STAT_MAP: Record<string, { stat: string; type: "flat" | "percent"; defaultVal: number }> = {
  attack_percent:       { stat: "attack_percent",       type: "flat", defaultVal: 0 },
  crit_rate:            { stat: "crit_rate",            type: "flat", defaultVal: 0 },
  crit_dmg:             { stat: "crit_damage",          type: "flat", defaultVal: 0 },
  physical_dmg:         { stat: "physical_dmg",         type: "flat", defaultVal: 0 },
  blaze_dmg:            { stat: "blaze_dmg",            type: "flat", defaultVal: 0 },
  emag_dmg:             { stat: "emag_dmg",             type: "flat", defaultVal: 0 },
  cold_dmg:             { stat: "cold_dmg",             type: "flat", defaultVal: 0 },
  nature_dmg:           { stat: "nature_dmg",           type: "flat", defaultVal: 0 },
  arts_dmg:             { stat: "arts_dmg",             type: "flat", defaultVal: 0 },
  attack_dmg_bonus:     { stat: "attack_dmg_bonus",     type: "flat", defaultVal: 0 },
  skill_dmg_bonus:      { stat: "skill_dmg_bonus",      type: "flat", defaultVal: 0 },
  link_dmg_bonus:       { stat: "link_dmg_bonus",       type: "flat", defaultVal: 0 },
  ultimate_dmg_bonus:   { stat: "ultimate_dmg_bonus",   type: "flat", defaultVal: 0 },
  all_skill_dmg_bonus:  { stat: "all_skill_dmg_bonus",  type: "flat", defaultVal: 0 },
  broken_dmg_bonus:     { stat: "broken_dmg_bonus",     type: "flat", defaultVal: 0 },
  originium_arts_power: { stat: "originium_arts_power", type: "flat", defaultVal: 0 },
  link_cd_reduction:    { stat: "link_cd_reduction",    type: "flat", defaultVal: 0 },
  ult_charge_eff:       { stat: "ult_charge_eff",       type: "flat", defaultVal: 100 },
};

/**
 * Convert the store's configured-stats snapshot (base level + weapon/equipment
 * deltas + set bonuses + talent/potential static `stat_bonus` / `damage_bonus`)
 * into a list of kernel `StatModifier`s.
 *
 * Non-attribute stats: modifier value = `configured - CORE_STATS.default`, which
 * for zero-default stats is just the sum of all contributions. The `ult_charge_eff`
 * default of 100 is subtracted so the kernel doesn't double-count its own base.
 *
 * Attribute stats (strength/agility/intellect/will) and flat `attack`: modifier
 * value = `configured - base_level[attr]` (minus the `talent_row1` bonus for
 * the main attribute, since `characterBuild` re-applies it from `input.promotion`).
 */
export function collectModifiersFromConfigured(
  configured: Record<string, number>,
  baseLevel: BaseLevelStats,
  promotion: number,
  mainAttribute: "strength" | "agility" | "intellect" | "will",
): StatModifier[] {
  const mods: StatModifier[] = [];

  for (const [field, m] of Object.entries(NON_ATTR_STAT_MAP)) {
    const abs = Number(configured[field]) || 0;
    const delta = abs - m.defaultVal;
    if (delta !== 0) mods.push({ source: "equipment", stat: m.stat, value: delta, type: m.type });
  }

  const row1 = computeTalentRow1Bonus(promotion);
  const attrs = ["strength", "agility", "intellect", "will"] as const;
  for (const attr of attrs) {
    const abs = Number(configured[attr]) || 0;
    const base = Number(baseLevel[attr]) || 0;
    const subtractRow1 = attr === mainAttribute ? row1 : 0;
    const delta = abs - base - subtractRow1;
    if (delta !== 0) mods.push({ source: "equipment", stat: attr, value: delta, type: "flat" });
  }

  // Flat ATK (non-percent). Weapon passive ATK flat lives here too; characterBuild
  // sums it into `attackFlat` on top of its own `input.baseAttack` (= baseLevel.attack).
  const absAtk = Number(configured.attack) || 0;
  const atkDelta = absAtk - (Number(baseLevel.attack) || 0);
  if (atkDelta !== 0) mods.push({ source: "equipment", stat: "attack", value: atkDelta, type: "flat" });

  return mods;
}

// ═══════════════════════════════════════════════════════════════════
// Panel construction
// ═══════════════════════════════════════════════════════════════════

/** Minimal track shape consumed by `buildCharacterPanel` (kept loose —
 *  timelineStore is JS). */
export interface TrackPanelInput {
  id: string;
  stats?: Record<string, number>;
  weaponId?: string | null;
  growth?: {
    promotion?: number;
    characterLevel?: number;
    potentialLevel?: number;
    skillLevels?: Record<string, { rank: number; mastery: number }>;
    talentLevels?: Record<string, number>;
  };
}

export interface WeaponPanelInput {
  id: string;
  baseAtk?: number;
  level?: number;
  passiveStats?: Record<string, number>;
}

/** Build a CharacterPanel for a single track. Returns null if the module or
 *  level data is insufficient. `mod.skills` is not mutated.
 *
 *  `resolveTrackConfiguredStats` is the store's 干员面板 aggregator — it returns
 *  absolute (not delta) values for every `CORE_STATS` field including base
 *  level, weapon/equipment deltas, equipment-set passives, and talent/potential
 *  static `stat_bonus`/`damage_bonus` effects. The panel converts these into
 *  kernel-side `StatModifier`s via `collectModifiersFromConfigured`. */
export function buildCharacterPanel(
  track: TrackPanelInput,
  mod: any,
  weaponDatabase: WeaponPanelInput[],
  resolveTrackConfiguredStats: (trackId: string) => Record<string, number> | null,
  resolveGaugeMax: (trackId: string) => number,
): CharacterPanel | null {
  const identity = mod?.identity;
  const levelStats = mod?.levelStats;
  const growth = track.growth;
  if (!identity || !levelStats || !growth) return null;

  const level = growth.characterLevel || 90;
  const baseStats = lookupLevelStats(levelStats, level);
  if (!baseStats) return null;

  const weapon = track.weaponId ? weaponDatabase.find(w => w.id === track.weaponId) || null : null;

  const configured = resolveTrackConfiguredStats(track.id) || {};
  const statModifiers = collectModifiersFromConfigured(
    configured,
    baseStats,
    growth.promotion || 4,
    identity.mainAttribute,
  );

  const input: CharacterInput = {
    id: identity.id,
    name: identity.name,
    element: identity.element as DamageElement,
    rarity: identity.rarity,

    promotion: growth.promotion || 4,
    potentialLevel: growth.potentialLevel || 0,
    talentLevels: growth.talentLevels || {},

    baseStrength: baseStats.strength || 0,
    baseAgility: baseStats.agility || 0,
    baseIntellect: baseStats.intellect || 0,
    baseWill: baseStats.will || 0,
    baseAttack: baseStats.attack || 0,
    baseHp: baseStats.hp || 0,

    mainAttribute: identity.mainAttribute,
    subAttribute: identity.subAttribute,

    weaponId: track.weaponId || null,
    weaponBaseAtk: weapon?.baseAtk || 0,
    weaponLevel: weapon?.level || 90,

    equipmentSetId: null, // TODO: detect from equipment slots

    baseGaugeMax: resolveGaugeMax(track.id),

    statModifiers,
  };

  const skillLevels = growth.skillLevels || {};
  const resolvedSkills = resolveSkillsForPanel(mod, skillLevels, input.potentialLevel);

  // Separate execution skill (used for auto-conversion during stagger).
  const execSkill: Skill | null = Array.isArray(mod.skills?.attack)
    ? mod.skills.attack.find((s: Skill) => s.type === "execution") || null
    : null;

  const totalAttackSegments = Array.isArray(resolvedSkills.attack)
    ? resolvedSkills.attack.filter((s: Skill) =>
        s.type === "attack" && !s.id.includes("execution") && !s.id.includes("aerial"),
      ).length
    : 0;

  return {
    actorId: track.id,
    input,
    gaugeFromSelfOnly: !!mod.gaugeFromSelfOnly,
    resolvedSkills,
    variants: mod.variants,
    execSkill,
    triggers: [], // populated by caller (weapon + equipment triggers come from outside)
    skillData: mod.skillData,
    skillLevels,
    talentValues: resolveTalentValues(
      mod,
      growth.talentLevels || {},
      // configured._activeEffects carries all active talent + potential effects;
      // resolveTalentValues filters for talent_enhance entries.
      (configured as any)?._activeEffects,
    ),
    totalAttackSegments,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Enemy panel
// ═══════════════════════════════════════════════════════════════════

export interface EnemySystemConstants {
  maxStagger: number;
  staggerNodeCount: number;
  staggerNodeDuration: number;
  staggerBreakDuration: number;
}

/** Build nodes array dividing `maxStagger` into `nodeCount` evenly-spaced breakpoints. */
function buildStaggerNodes(maxStagger: number, nodeCount: number): number[] {
  if (nodeCount <= 0 || maxStagger <= 0) return [];
  const nodes: number[] = [];
  for (let i = 1; i <= nodeCount; i++) {
    nodes.push(Math.round((maxStagger * i) / (nodeCount + 1)));
  }
  return nodes;
}

/** Build the EnemyPanel. Currently only wraps EnemyConfig — stage-scoped
 *  buffs/debuffs will extend this in a later pass. */
export function buildEnemyPanel(sys: EnemySystemConstants): EnemyPanel {
  const staggerNodes = buildStaggerNodes(sys.maxStagger, sys.staggerNodeCount);
  return {
    config: {
      // All enemies are modelled as 100 defense until per-encounter values
      // exist — 100 / (100 + 100) = 0.5. See EnemyConfig for the formula.
      defenseMultiplier: 0.5,
      maxStagger: sys.maxStagger,
      staggerNodes,
      staggerBreakDuration: sys.staggerBreakDuration,
      basePhysicalResist: 0,
      baseMagicResist: 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Label resolution (MultiplierRef → number)
// ═══════════════════════════════════════════════════════════════════

/** Build a per-panel label resolver. The resolver looks up:
 *    1. `talent_X` → panel.talentValues
 *    2. Skill-data label → section.levelData at that section's actor level
 *       When `sectionHint` is provided, the search is restricted to that
 *       section — use this to disambiguate labels shared across sections
 *       (e.g. "伤害倍率" appearing in both skill and link).
 *  Returns 0 when no match is found. */
export function makeLabelResolver(panel: CharacterPanel): (label: string, sectionHint?: string) => number {
  return (label: string, sectionHint?: string): number => {
    const tv = panel.talentValues.get(label);
    if (tv !== undefined) return tv;

    const sd = panel.skillData;
    if (!sd) return 0;
    const keys = sectionHint && sd[sectionHint] ? [sectionHint] : Object.keys(sd);
    for (const key of keys) {
      const section = sd[key];
      if (!section?.levelData) continue;
      for (const row of section.levelData) {
        if (row.label === label) {
          const idx = toLevelIndex(panel.skillLevels[key]);
          const raw = String(row.values?.[idx] ?? row.values?.[row.values.length - 1] ?? "0");
          return parseFloat(raw.replace("%", "").replace("s", "")) || 0;
        }
      }
    }
    return 0;
  };
}
