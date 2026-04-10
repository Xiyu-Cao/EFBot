/**
 * Weapon data adapter — reads triggeredBuffs metadata from gamedata.json
 * and builds EffectTrigger objects. Supports auto-generation from JSON
 * effects[] for simple stat buffs, with hand-written fallback for complex weapons.
 *
 * Architecture:
 * - JSON provides: trigger, target, duration, maxStacks, stackCooldown, effects[]
 * - Auto-generation: maps effects[].stat/zone to DynamicBonus[], builds buff action
 * - Fallback: hand-written action function overrides auto-generation
 */

import { Effect, type EffectTrigger } from "../effects/types";
import type { SimulationContext } from "../engine/SimulationContext";
import type { SimulationEngine } from "../engine/SimulationEngine";
import type { SimEvent, SimEventType } from "../events/event.types";
import type { DiagnosticCollector } from "../diagnostics";
import { addOrRefreshBuff, addStackWithIndependentDuration, type DynamicBonus } from "./types";

// ---------------------------------------------------------------------------
// Types matching gamedata.json weapon structure
// ---------------------------------------------------------------------------

export interface WeaponTriggeredBuff {
  trigger: string;
  name?: string;
  target: string; // "self" | "enemy" | "team" | "others" | "main_operator"
  effects: Array<{
    stat?: string;
    value?: number;
    zone?: string;
    unit?: string;
  }>;
  duration: number | null;
  maxStacks?: number;
  stackCooldown?: number;
  _raw?: string;
}

export interface WeaponData {
  id: string;
  name: string;
  passiveStats?: Record<string, number>;
  triggeredBuffs?: WeaponTriggeredBuff[];
}

// ---------------------------------------------------------------------------
// Trigger type mapping — JSON trigger string → SimEvent type
// ---------------------------------------------------------------------------

const TRIGGER_EVENT_MAP: Partial<Record<string, SimEventType>> = {
  // ── Existing ──
  on_skill_or_ultimate_hit: "DAMAGE_TICK",
  on_skill_hit: "DAMAGE_TICK",
  on_heavy_attack: "DAMAGE_TICK",
  on_physical_anomaly: "APPLY_PHYSICAL_ANOMALY",
  on_burning_apply: "APPLY_DIRECT_ANOMALY",
  on_freeze_apply: "APPLY_DIRECT_ANOMALY",
  on_conductive_apply: "APPLY_DIRECT_ANOMALY",
  on_burning_or_conductive_apply: "APPLY_DIRECT_ANOMALY",
  on_nature_attach: "APPLY_MAGIC_ATTACHMENT",
  on_skill_or_ultimate_cold_attach: "APPLY_MAGIC_ATTACHMENT",
  on_link: "ACTION_START",
  on_ultimate: "ACTION_START",
  on_skill: "ACTION_START",
  on_arts_burst: "APPLY_MAGIC_ATTACHMENT",
  on_knockup: "APPLY_PHYSICAL_ANOMALY",
  on_link_knockup: "APPLY_PHYSICAL_ANOMALY",

  // ── New trigger mappings ──
  on_arts_anomaly_consume: "APPLY_DIRECT_ANOMALY",    // consuming burn/conduction/freeze/corrosion
  on_arts_anomaly_apply: "APPLY_DIRECT_ANOMALY",      // applying any anomaly
  on_skill_arts_anomaly_apply: "APPLY_DIRECT_ANOMALY", // skill applying anomaly
  on_arts_attach_consume: "APPLY_MAGIC_ATTACHMENT",    // consuming magic attachment
  on_break_consume: "APPLY_PHYSICAL_ANOMALY",          // consuming break stacks
  on_break_apply_no_existing: "APPLY_PHYSICAL_ANOMALY", // applying break on non-broken enemy
  on_skill_break_apply: "APPLY_PHYSICAL_ANOMALY",      // skill applying break
  on_skill_physical_fragile: "APPLY_PHYSICAL_ANOMALY",  // skill applying phys fragility
  on_skill_sp_restore: "SP_CHANGE",                    // skill restoring SP
  on_skill_sp_restore_or_combo: "SP_CHANGE",           // skill restoring SP or combo
  on_skill_or_link_crit: "DAMAGE_TICK",                // skill/link crit hit
  on_knockdown_or_weaken: "APPLY_PHYSICAL_ANOMALY",    // knockdown or weaken
  on_freeze_consume: "APPLY_DIRECT_ANOMALY",           // consuming freeze
  on_corrosion_consume: "APPLY_DIRECT_ANOMALY",        // consuming corrosion
  on_crystal_or_freeze_apply: "APPLY_DIRECT_ANOMALY",  // applying crystal or freeze
  on_link_burst_or_physical_anomaly: "APPLY_PHYSICAL_ANOMALY", // link burst or phys anomaly

  // ── Fixed from wiki data (formerly _unknown) ──
  on_skill_cold_attach: "APPLY_MAGIC_ATTACHMENT",           // skill applying cold attachment
  on_link_hit_cold_enemy: "DAMAGE_TICK",                    // link hit on cold-attached enemy
  on_skill_or_ultimate_spell_vulnerable: "APPLY_PHYSICAL_ANOMALY", // skill/ult applying spell vuln
  condition_corrosion_on_enemy: "DAMAGE_TICK",               // enemy has corrosion (conditional)
  condition_freeze_or_corrosion_on_field: "DAMAGE_TICK",     // enemy has freeze or corrosion (conditional)
};

// ---------------------------------------------------------------------------
// Trigger condition builder
// ---------------------------------------------------------------------------

function buildTriggerCondition(
  trigger: string,
): ((e: SimEvent, ctx: SimulationContext) => boolean) | undefined {
  switch (trigger) {
    case "on_skill_or_ultimate_hit":
      return (e, ctx) => {
        if (e.type !== "DAMAGE_TICK") return false;
        const action = ctx.getAction(e.payload.actionId);
        return action?.node.type === "skill" || action?.node.type === "ultimate";
      };
    case "on_skill_hit":
      return (e, ctx) => {
        if (e.type !== "DAMAGE_TICK") return false;
        const action = ctx.getAction(e.payload.actionId);
        return action?.node.type === "skill";
      };
    case "on_heavy_attack":
      return (e, ctx) => {
        if (e.type !== "DAMAGE_TICK") return false;
        const action = ctx.getAction(e.payload.actionId);
        return action?.node.type === "attack";
      };
    case "on_burning_apply":
      return (e) => e.type === "APPLY_DIRECT_ANOMALY" && e.payload.anomalyType === "burn";
    case "on_freeze_apply":
      return (e) => e.type === "APPLY_DIRECT_ANOMALY" && e.payload.anomalyType === "freeze";
    case "on_conductive_apply":
      return (e) => e.type === "APPLY_DIRECT_ANOMALY" && e.payload.anomalyType === "conduction";
    case "on_burning_or_conductive_apply":
      return (e) =>
        e.type === "APPLY_DIRECT_ANOMALY" &&
        (e.payload.anomalyType === "burn" || e.payload.anomalyType === "conduction");
    case "on_nature_attach":
      return (e) => e.type === "APPLY_MAGIC_ATTACHMENT" && e.payload.element === "nature";
    case "on_skill_or_ultimate_cold_attach":
      return (e, ctx) => {
        if (e.type !== "APPLY_MAGIC_ATTACHMENT" || e.payload.element !== "cold") return false;
        const actor = ctx.state.getActor(e.payload.sourceActorId);
        const action = actor.getActiveAction();
        return action?.node.type === "skill" || action?.node.type === "ultimate";
      };
    case "on_link":
      return (e) => e.type === "ACTION_START" && e.payload.type === "link";
    case "on_ultimate":
      return (e) => e.type === "ACTION_START" && e.payload.type === "ultimate";
    case "on_skill":
      return (e) => e.type === "ACTION_START" && e.payload.type === "skill";
    case "on_knockup":
      return (e) => e.type === "APPLY_PHYSICAL_ANOMALY" && e.payload.physicalType === "launch";
    case "on_link_knockup":
      return (e, ctx) => {
        if (e.type !== "APPLY_PHYSICAL_ANOMALY" || e.payload.physicalType !== "launch") return false;
        const actor = ctx.state.getActor(e.payload.sourceActorId);
        return actor.getActiveAction()?.node.type === "link";
      };

    // ── New trigger conditions ──
    case "on_skill_sp_restore":
      return (e) => e.type === "SP_CHANGE" && (e.payload as any).spChange > 0 && (e.payload as any).reason === "skill";
    case "on_skill_sp_restore_or_combo":
      return (e) => {
        if (e.type !== "SP_CHANGE") return false;
        const p = e.payload as any;
        return p.spChange > 0 && (p.reason === "skill" || p.reason === "combo");
      };
    case "on_skill_or_link_crit":
      return (e, ctx) => {
        if (e.type !== "DAMAGE_TICK" || !(e as any).payload?.isCrit) return false;
        const action = ctx.getAction(e.payload.actionId);
        return action?.node.type === "skill" || action?.node.type === "link";
      };
    case "on_knockdown_or_weaken":
      return (e) =>
        e.type === "APPLY_PHYSICAL_ANOMALY" &&
        (e.payload.physicalType === "knockdown" || e.payload.physicalType === "slam");
    case "on_freeze_consume":
      return (e) => e.type === "APPLY_DIRECT_ANOMALY" && e.payload.anomalyType === "freeze";
    case "on_corrosion_consume":
      return (e) => e.type === "APPLY_DIRECT_ANOMALY" && e.payload.anomalyType === "corrosion";
    case "on_crystal_or_freeze_apply":
      return (e) => e.type === "APPLY_DIRECT_ANOMALY" && e.payload.anomalyType === "freeze";
    case "on_arts_anomaly_apply":
    case "on_skill_arts_anomaly_apply":
      return (e) => e.type === "APPLY_DIRECT_ANOMALY";
    case "on_arts_anomaly_consume":
      // Fires when an anomaly is consumed (cleared) — approximated by APPLY_DIRECT_ANOMALY
      return (e) => e.type === "APPLY_DIRECT_ANOMALY";
    case "on_break_consume":
      return (e) => e.type === "APPLY_PHYSICAL_ANOMALY" &&
        (e.payload.physicalType === "slam" || e.payload.physicalType === "armorBreak");
    case "on_break_apply_no_existing":
      return (e, ctx) => {
        if (e.type !== "APPLY_PHYSICAL_ANOMALY") return false;
        // Check if enemy had no break before this event
        return !ctx.state.enemy.status.hasBreak();
      };
    case "on_skill_break_apply":
      return (e, ctx) => {
        if (e.type !== "APPLY_PHYSICAL_ANOMALY") return false;
        const actor = ctx.state.getActor(e.payload.sourceActorId);
        return actor.getActiveAction()?.node.type === "skill";
      };
    case "on_skill_physical_fragile":
      return (e, ctx) => {
        if (e.type !== "APPLY_PHYSICAL_ANOMALY") return false;
        const actor = ctx.state.getActor(e.payload.sourceActorId);
        return actor.getActiveAction()?.node.type === "skill";
      };
    case "on_arts_burst":
      return (e) => e.type === "APPLY_MAGIC_ATTACHMENT";
    case "on_arts_attach_consume":
      return (e) => e.type === "APPLY_MAGIC_ATTACHMENT";
    case "on_link_burst_or_physical_anomaly":
      return (e, ctx) => {
        if (e.type === "APPLY_PHYSICAL_ANOMALY") return true;
        if (e.type === "APPLY_MAGIC_ATTACHMENT") {
          const actor = ctx.state.getActor(e.payload.sourceActorId);
          return actor.getActiveAction()?.node.type === "link";
        }
        return false;
      };

    // ── Fixed from wiki ──
    case "on_skill_cold_attach":
      return (e, ctx) => {
        if (e.type !== "APPLY_MAGIC_ATTACHMENT" || e.payload.element !== "cold") return false;
        const actor = ctx.state.getActor(e.payload.sourceActorId);
        return actor.getActiveAction()?.node.type === "skill";
      };
    case "on_link_hit_cold_enemy":
      return (e, ctx) => {
        if (e.type !== "DAMAGE_TICK") return false;
        const action = ctx.getAction(e.payload.actionId);
        if (action?.node.type !== "link") return false;
        return ctx.state.enemy.status.getMagicElement() === "cold";
      };
    case "on_skill_or_ultimate_spell_vulnerable":
      return (e, ctx) => {
        if (e.type !== "APPLY_PHYSICAL_ANOMALY") return false;
        const actor = ctx.state.getActor(e.payload.sourceActorId);
        const t = actor.getActiveAction()?.node.type;
        return t === "skill" || t === "ultimate";
      };
    case "condition_corrosion_on_enemy":
      return (_e, ctx) => {
        return ctx.state.enemy.status.corrosion !== null;
      };
    case "condition_freeze_or_corrosion_on_field":
      return (_e, ctx) => {
        const status = ctx.state.enemy.status;
        return status.isFrozen(ctx.state.getCurrentTime()) || status.corrosion !== null;
      };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// JSON stat/zone → DynamicBonus mapping
// ---------------------------------------------------------------------------

/** Map JSON zone name (Chinese) to engine DynamicBonusZone. */
const ZONE_MAP: Record<string, DynamicBonus["zone"]> = {
  "\u589E\u4F24": "damageBonus",        // 增伤
  "\u653B\u51FB\u52A0\u6210": "attackPercent",  // 攻击加成
  "\u6613\u4F24": "vulnerability",      // 易伤
  "\u66B4\u51FB": "crit",               // 暴击
};

/**
 * Split a JSON stat string into DynamicBonusStat(s).
 * Dual-element stats are split into two separate bonuses.
 * Returns null for stats that can't be mapped (e.g., all_ability, defense).
 */
function mapJsonStat(stat: string): DynamicBonus["stat"][] | null {
  // Direct 1:1 mappings
  const DIRECT: Record<string, DynamicBonus["stat"]> = {
    physical_dmg: "physical_dmg",
    arts_dmg: "arts_dmg",
    cold_dmg: "cold_dmg",
    emag_dmg: "emag_dmg",
    nature_dmg: "nature_dmg",
    blaze_dmg: "blaze_dmg",
    attack_dmg_bonus: "attack_dmg_bonus",
    ultimate_dmg_bonus: "ultimate_dmg_bonus",
    crit_rate: "crit_rate",
    crit_dmg: "crit_dmg",
    attack: "all_dmg", // ATK% → uses attackPercent zone
  };

  if (DIRECT[stat]) return [DIRECT[stat]];

  // Dual-element splits
  const DUAL: Record<string, DynamicBonus["stat"][]> = {
    physical_emag_dmg: ["physical_dmg", "emag_dmg"],
    blaze_emag_dmg: ["blaze_dmg", "emag_dmg"],
    blaze_nature_dmg: ["blaze_dmg", "nature_dmg"],
    cold_nature_dmg: ["cold_dmg", "nature_dmg"],
  };

  if (DUAL[stat]) return DUAL[stat];

  // Not mappable: all_ability, defense, originium_arts_power, element_dmg
  return null;
}

/**
 * Convert JSON effects[] to DynamicBonus[].
 * Skips individual effects that can't be mapped (unmappable stat/zone)
 * and returns the remaining mappable bonuses.
 * Returns null only if NO effect is mappable.
 */
export function mapJsonEffects(
  effects: WeaponTriggeredBuff["effects"],
): DynamicBonus[] | null {
  if (!effects?.length) return null;

  const bonuses: DynamicBonus[] = [];
  for (const eff of effects) {
    if (!eff.stat || eff.value === undefined) continue;

    const zone = eff.zone ? ZONE_MAP[eff.zone] : "damageBonus";
    if (!zone) continue; // skip unmappable zone (角色属性, 特殊系数)

    const stats = mapJsonStat(eff.stat);
    if (!stats) continue; // skip unmappable stat

    for (const stat of stats) {
      bonuses.push({ stat, value: eff.value, zone });
    }
  }

  return bonuses.length > 0 ? bonuses : null;
}

// ---------------------------------------------------------------------------
// Auto-generated action from JSON effects
// ---------------------------------------------------------------------------

/** Hand-written proc body registered alongside JSON metadata. */
export type WeaponBuffAction = (e: SimEvent, ctx: SimulationContext) => void;

/**
 * Build an auto-generated action from JSON metadata.
 * Creates addOrRefreshBuff or addStackWithIndependentDuration based on maxStacks.
 */
function buildAutoAction(
  buff: WeaponTriggeredBuff,
  bonuses: DynamicBonus[],
  weaponId: string,
): WeaponBuffAction {
  const duration = buff.duration ?? 999999; // null → effectively permanent
  const maxStacks = buff.maxStacks ?? 1;
  const target = buff.target ?? "self";
  const buffName = buff.name || weaponId;
  const buffId = `weapon_${weaponId}_${buffName}`;
  let stackCounter = 0;

  return (_e: SimEvent, ctx: SimulationContext) => {
    const time = ctx.state.getCurrentTime();

    const getTarget = (sourceId: string) => {
      if (target === "enemy") return ctx.state.enemy.effects;
      if (target === "self") return ctx.state.getActor(sourceId).effects;
      return null; // team/others handled separately
    };

    const createBuff = () => new Effect({
      id: maxStacks > 1 ? `${buffId}_${++stackCounter}` : buffId,
      name: buffName,
      tags: [],
      duration,
      startTime: time,
      properties: {
        dynamicBonuses: bonuses,
        stackGroup: maxStacks > 1 ? buffId : undefined,
      },
    });

    // Determine source actor
    const sourceId = (_e as any).payload?.sourceActorId
      ?? (_e as any).payload?.actorId
      ?? "";

    if (target === "team") {
      for (const actor of ctx.state.getAllActors()) {
        addOrRefreshBuff(actor.effects, createBuff());
      }
    } else if (target === "others") {
      for (const actor of ctx.state.getAllActors()) {
        if (actor.id === sourceId) continue;
        addOrRefreshBuff(actor.effects, createBuff());
      }
    } else {
      const targetEffects = getTarget(sourceId);
      if (!targetEffects) return;

      if (maxStacks > 1) {
        addStackWithIndependentDuration(
          targetEffects, createBuff(), buffId, maxStacks, time,
        );
      } else {
        addOrRefreshBuff(targetEffects, createBuff());
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Build EffectTrigger from JSON + optional fallback
// ---------------------------------------------------------------------------

/**
 * Build an EffectTrigger from a gamedata.json triggeredBuff entry.
 * Tries auto-generation from JSON effects[] first; falls back to hand-written action.
 */
export function buildTriggerFromMetadata(
  buff: WeaponTriggeredBuff,
  fallbackAction?: WeaponBuffAction,
  weaponId?: string,
): EffectTrigger | null {
  const eventType = TRIGGER_EVENT_MAP[buff.trigger];
  if (!eventType) return null;

  const condition = buildTriggerCondition(buff.trigger);

  // Determine action: fallback > auto-generated > null
  let action: WeaponBuffAction | undefined = fallbackAction;
  if (!action) {
    const bonuses = mapJsonEffects(buff.effects);
    if (bonuses) {
      action = buildAutoAction(buff, bonuses, weaponId || "unknown");
    }
  }
  if (!action) return null;

  const trigger: EffectTrigger = {
    event: eventType,
    sourceMustBeWearer: true,
    action,
  };

  if (condition) trigger.condition = condition;

  if (buff.stackCooldown && buff.stackCooldown > 0) {
    trigger.cooldownId = `weapon_${buff.name || buff.trigger}_icd`;
    trigger.cooldownDuration = buff.stackCooldown;
  }

  return trigger;
}

// ---------------------------------------------------------------------------
// Register weapon from data
// ---------------------------------------------------------------------------

/**
 * Register a weapon passive from gamedata.json metadata + optional fallback.
 * Auto-generates actions from JSON effects[] when possible.
 */
export function registerWeaponFromData(
  engine: SimulationEngine,
  actorId: string,
  weaponData: WeaponData,
  fallbacks?: Record<number, WeaponBuffAction>,
  diagnostics?: DiagnosticCollector,
): void {
  if (!weaponData.triggeredBuffs?.length) return;

  const triggers: EffectTrigger[] = [];

  for (let i = 0; i < weaponData.triggeredBuffs.length; i++) {
    const buff = weaponData.triggeredBuffs[i]!;
    const eventType = TRIGGER_EVENT_MAP[buff.trigger];
    if (!eventType) {
      diagnostics?.warn(
        "WEAPON_TRIGGER_UNKNOWN",
        `Weapon "${weaponData.id}" triggeredBuff[${i}] has unknown trigger "${buff.trigger}".`,
        { weaponId: weaponData.id, buffIndex: i, trigger: buff.trigger },
      );
      continue;
    }

    const fallback = fallbacks?.[i];
    const trigger = buildTriggerFromMetadata(buff, fallback, weaponData.id);

    if (trigger) {
      triggers.push(trigger);
    } else {
      diagnostics?.warn(
        "WEAPON_TRIGGER_NO_ACTION",
        `Weapon "${weaponData.id}" buff[${i}] trigger="${buff.trigger}": no fallback and effects[] not auto-mappable.`,
        { weaponId: weaponData.id, buffIndex: i },
      );
    }
  }

  if (triggers.length === 0) return;

  const passive = new Effect({
    id: `weapon_${weaponData.id}`,
    tags: [],
    duration: Infinity,
    triggers,
  });

  engine.registerPassiveEffect(actorId, passive);
}
