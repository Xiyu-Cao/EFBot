/**
 * V2 Layer 2: Simulation Kernel
 *
 * Main entry point. Receives character builds + skill sequence,
 * processes each skill's hits in order, produces EventLog.
 *
 * Processing per skill:
 *   1. Variant selection (if conditions defined)
 *   2. Action start (SP cost, gauge cost, regen pause)
 *   3. For each hit — four-phase execution model:
 *      Phase 1: Effects (attachments, anomalies, buffs, SP restore, etc.)
 *               Effects may produce sub-damages (slam, crystal shatter) and
 *               deferred actions (buff removal, talent triggers).
 *      Phase 2: Effect-generated damages resolved.
 *               State from before consumption still applies (e.g., 现実静滞
 *               fragility buff active during slam + crystal shatter damage).
 *      Phase 3: Deferred actions executed (consumption cleanup, talent buffs).
 *               Consumed buffs removed, new buffs applied.
 *      Phase 4: Hit's own damage resolved.
 *               Sees post-deferred state (e.g., 本質瓦解 ATK buff active,
 *               现実静滞 already removed).
 *   4. Action end
 *
 * Key principle: effect chains fully resolve (including their damages and
 * deferred cleanup) before the hit's own damage is calculated. This ensures
 * consumption-triggered buffs affect the hit's damage while consumed debuffs
 * only apply to effect-generated damages.
 *
 * The kernel is stateful during a run but produces an immutable EventLog.
 */

import type {
  CharacterBuild,
  Skill,
  SkillVariant,
  Hit,
  HitEffect,
  MultiplierRef,
  SimEvent,
  SimulationResult,
  ValidationError,
  DamageElement,
  DamageSchool,
  MagicElement,
  AnomalyType,
  ActionType,
  BuffTarget,
  PassiveTrigger,
} from "./types";
import type { BuildStats } from "./characterBuild";
import { resolveDamage, computeEffectiveATK, emptyBuffModifiers, type BuffModifiers, type DamageContext } from "./damage";
import {
  resolveMagicAttachment, resolvePhysicalAnomaly, resolveStagger,
  ATTACHMENT_MAX_STACKS, ATTACHMENT_DURATION, BREAK_MAX_STACKS, BREAK_DURATION,
  CROSS_ELEMENT_ANOMALY, getAnomalyDuration,
  magicBurstMult, spellAnomalyTriggerMult, burningTickMult, iceShatterMult,
  launchKnockdownMult, slamMult, armorBreakMult,
  conductionVulnerability, armorBreakVulnerability, armorBreakVulnDuration,
  corrosionParams,
} from "./anomaly";
import { SpState, GaugeState, computeGaugeChargeFromSP, computeDirectGaugeGain, SP_CAP } from "./resources";
import { BuffManager, StackBuffTracker, selectVariant, applyVariant, type ConditionState, type BuffDef, type BuffModifierDef } from "./effects";
import { getBuffMeta } from "../data/buffMetadata";
import { TriggerProcessor, type TriggerEvent, type TriggerState } from "./triggers";
import {
  type EventContext,
  type ResolveContext,
  type ValueSource,
  normalizeTriggerEvent,
  resolveValue,
  resolveScaleBy,
} from "./valueSource";

// ═══════════════════════════════════════════════════════════════════
// Stat+Zone → BuffModifiers field mapping (for weapon/equipment buffs)
// ═══════════════════════════════════════════════════════════════════

const STAT_ZONE_TO_MODIFIER: Record<string, Record<string, keyof BuffModifiers>> = {
  // dmgBonus zone — stat determines which damage types
  dmgBonus: {
    physical_dmg: "physicalDmg",
    arts_dmg: "artsDmg",
    blaze_dmg: "blazeDmg",
    cold_dmg: "coldDmg",
    emag_dmg: "emagDmg",
    nature_dmg: "natureDmg",
    attack_dmg_bonus: "attackDmgBonus",
    skill_dmg_bonus: "skillDmgBonus",
    link_dmg_bonus: "linkDmgBonus",
    ultimate_dmg_bonus: "ultimateDmgBonus",
    all_skill_dmg_bonus: "allSkillDmgBonus",
    broken_dmg_bonus: "brokenDmgBonus",
    all_dmg: "damageBonus",
  },
  // Direct zone mappings (stat-agnostic)
  amplify: { _default: "amplify" },
  combo: { _default: "combo" },
  attackPercent: { _default: "attackPercent", all_dmg: "attackPercent" },
  attackFlat: { _default: "attackFlat" },
};

/**
 * Map weapon/equipment stat + zone to a BuffModifiers field name.
 * Returns null if the mapping is unknown.
 */
function resolveBuffModifierZone(stat: string, zone: string): keyof BuffModifiers | null {
  // Crit is special — stat determines rate vs damage
  if (zone === "crit" || stat === "crit_rate") return "critRateBonus";
  if (stat === "crit_dmg") return "critDamageBonus";

  const zoneMap = STAT_ZONE_TO_MODIFIER[zone];
  if (!zoneMap) return null;
  return (zoneMap[stat] || zoneMap._default) ?? null;
}

// ═══════════════════════════════════════════════════════════════════
// Effect damage — produced by effects during Phase 1, resolved in Phase 2
// ═══════════════════════════════════════════════════════════════════

/** A damage request produced by an effect (slam, crystal shatter, etc.). */
interface EffectDamage {
  sourceId: string;
  actionId: string;
  multiplier: number;
  stagger: number;
  element: DamageElement;
  school: DamageSchool;
  sourceType: ActionType;
  canCrit: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Kernel input
// ═══════════════════════════════════════════════════════════════════

/** A placed skill on the timeline. */
export interface PlacedSkill {
  actionId: string;
  actorId: string;
  skill: Skill;
  startTime: number;
  /** Available variants for this skill (from character data). */
  variants?: SkillVariant[];
}

/** Enemy configuration. */
export interface EnemyConfig {
  defenseMultiplier: number;
  maxStagger: number;
  staggerNodes: number[];      // threshold values
  staggerBreakDuration: number;
  basePhysicalResist: number;
  baseMagicResist: number;     // applies to all magic elements
}

/** Simulation configuration. */

// ── Skill category & interrupt matrix ──

type SkillCategory = "regular_attack" | "heavy_attack" | "execution" | "aerial"
  | "skill" | "link" | "dodge" | "ultimate";

/**
 * Evaluate a string-form condition against the current enemy state.
 * Unknown conditions treat as met so misspelled conditions don't silently skip.
 * Used by Phase 1 effect gating and the `hit_mark` projection.
 */
function evaluateEffectCondition(cond: string, enemy: EnemyState): boolean {
  switch (cond) {
    case "enemy_has_break":          return enemy.breakStacks > 0;
    case "enemy_not_has_break":      return enemy.breakStacks <= 0;
    case "enemy_has_attachment":     return enemy.attachment.element !== null;
    case "enemy_not_has_attachment": return enemy.attachment.element === null;
    default: return true;
  }
}

function getSkillCategory(skill: { type: string; isHeavyAttack?: boolean; id: string }): SkillCategory {
  if (skill.type === "execution") return "execution";
  if (skill.type === "attack") {
    if (skill.isHeavyAttack) return "heavy_attack";
    if (skill.id.includes("aerial")) return "aerial";
    return "regular_attack";
  }
  return skill.type as SkillCategory;
}

/** For each active category, which incoming categories can interrupt it. */
const DEFAULT_INTERRUPTIBLE_BY: Record<SkillCategory, ReadonlySet<SkillCategory>> = {
  regular_attack: new Set(["skill", "link", "dodge", "ultimate"]),
  heavy_attack:   new Set(["link", "dodge", "ultimate"]),
  execution:      new Set(["ultimate"]),
  aerial:         new Set(["ultimate"]),
  skill:          new Set(["link", "dodge", "ultimate"]),
  link:           new Set(["dodge", "ultimate"]),
  dodge:          new Set(["ultimate"]),
  ultimate:       new Set(),
};

/** Check if incoming skill can interrupt the currently active skill (per-actor). */
function canInterrupt(activeSkill: Skill, incomingSkill: Skill): boolean {
  // Per-skill override (character exceptions, e.g. 骏卫)
  if (activeSkill.interruptibleBy) {
    return activeSkill.interruptibleBy.includes(incomingSkill.type);
  }
  return DEFAULT_INTERRUPTIBLE_BY[getSkillCategory(activeSkill)].has(getSkillCategory(incomingSkill));
}

/** Whether this skill requires the actor to be the main control character. */
function needsMainControl(skill: Skill): boolean {
  return skill.type === "attack" || skill.type === "execution" || skill.type === "dodge";
}

export interface KernelConfig {
  initialSP: number;
  critMode: "real" | "expected";
  rng?: () => number;
  /**
   * Resolve a `*Ref` label to a numeric value from skills.json.
   * Called with (actorId, label) → number.
   */
  resolveRef?: (actorId: string, label: string) => number;
  /** Enable condition checking (SP/Gauge/CD). Abort on first failure. */
  validateConditions?: boolean;
  /** Start with full gauge for all actors (debug). */
  initialGaugeFull?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Enemy state
// ═══════════════════════════════════════════════════════════════════

class EnemyState {
  attachment: { element: MagicElement | null; stacks: number; expiresAt: number } = {
    element: null, stacks: 0, expiresAt: 0,
  };
  breakStacks: number = 0;
  breakExpiresAt: number = 0;
  stagger: number = 0;
  isStaggered: boolean = false;
  staggerEndTime: number = 0;

  // Anomaly states
  anomalies: Record<AnomalyType, { active: boolean; level: number; expiresAt: number; sourceId: string }> = {
    burning: { active: false, level: 0, expiresAt: 0, sourceId: "" },
    frozen: { active: false, level: 0, expiresAt: 0, sourceId: "" },
    conduction: { active: false, level: 0, expiresAt: 0, sourceId: "" },
    corrosion: { active: false, level: 0, expiresAt: 0, sourceId: "" },
  };

  // Debuff values
  vulnerability: number = 0;        // 易伤 (%)
  physicalFragility: number = 0;    // 物理脆弱 (%) — non-armor-break sources
  magicFragility: number = 0;       // 法术脆弱 (%)
  elementFragility: Record<DamageElement, number> = {
    physical: 0, blaze: 0, cold: 0, emag: 0, nature: 0,
  };
  resistReduction: number = 0;      // 抗性削减

  /**
   * Armor-break-applied physical vulnerability. Single-source debuff: reapplying
   * 碎甲 refreshes value + expiresAt rather than stacking additively.
   */
  armorBreakVuln: { value: number; expiresAt: number } | null = null;

  buffManager = new BuffManager();

  /** Physical fragility at `time`, summing baseline sources with armor-break vuln (if still active). */
  getPhysicalFragility(time: number): number {
    const abv = this.armorBreakVuln && time < this.armorBreakVuln.expiresAt ? this.armorBreakVuln.value : 0;
    return this.physicalFragility + abv;
  }

  advanceTime(time: number): { attachmentExpired?: { element: MagicElement; stacks: number; expiresAt: number }; breakExpired?: { prevStacks: number; expiredAt: number }; staggerExpired?: boolean; anomaliesExpired?: { type: AnomalyType; level: number; expiresAt: number }[]; armorBreakVulnExpired?: boolean } {
    const changes: { attachmentExpired?: { element: MagicElement; stacks: number; expiresAt: number }; breakExpired?: { prevStacks: number; expiredAt: number }; staggerExpired?: boolean; anomaliesExpired?: { type: AnomalyType; level: number; expiresAt: number }[]; armorBreakVulnExpired?: boolean } = {};
    // Expire attachment
    if (this.attachment.element && time >= this.attachment.expiresAt) {
      changes.attachmentExpired = { element: this.attachment.element, stacks: this.attachment.stacks, expiresAt: this.attachment.expiresAt };
      this.attachment = { element: null, stacks: 0, expiresAt: 0 };
    }
    // Expire break — record the real expiry moment so projection bars close at it,
    // not at the next action start that happens to observe the expiry.
    if (this.breakStacks > 0 && time >= this.breakExpiresAt) {
      changes.breakExpired = { prevStacks: this.breakStacks, expiredAt: this.breakExpiresAt };
      this.breakStacks = 0;
    }
    // Expire armor-break physical vulnerability
    if (this.armorBreakVuln && time >= this.armorBreakVuln.expiresAt) {
      changes.armorBreakVulnExpired = true;
      this.armorBreakVuln = null;
    }
    // Expire stagger state
    if (this.isStaggered && time >= this.staggerEndTime) {
      changes.staggerExpired = true;
      this.isStaggered = false;
      this.stagger = 0;
    }
    // Expire anomalies
    for (const [aType, aState] of Object.entries(this.anomalies) as [AnomalyType, { active: boolean; level: number; expiresAt: number; sourceId: string }][]) {
      if (aState.active && time >= aState.expiresAt) {
        if (!changes.anomaliesExpired) changes.anomaliesExpired = [];
        changes.anomaliesExpired.push({ type: aType, level: aState.level, expiresAt: aState.expiresAt });
        aState.active = false;
        aState.level = 0;
      }
    }
    // Sweep buff expiry
    this.buffManager.sweepExpired(time);
    return changes;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Element mapping
// ═══════════════════════════════════════════════════════════════════

const DAMAGE_ELEMENT_TO_MAGIC: Record<string, MagicElement | null> = {
  blaze: "fire", cold: "cold", emag: "electro", nature: "nature", physical: null,
};

// ═══════════════════════════════════════════════════════════════════
// Kernel
// ═══════════════════════════════════════════════════════════════════

/** Extract stagger windows from simulation events (for two-pass execution detection). */
export function extractStaggerWindows(events: SimEvent[], breakDuration: number): { start: number; end: number }[] {
  const windows: { start: number; end: number }[] = [];
  for (const e of events) {
    if (e.type === "stagger_change" && (e as StaggerEvent).isFullStagger) {
      windows.push({ start: e.time, end: e.time + breakDuration });
    }
  }
  return windows;
}

export function simulate(
  builds: CharacterBuild[],
  skills: PlacedSkill[],
  enemyConfig: EnemyConfig,
  config: KernelConfig,
  triggersByActor?: Map<string, PassiveTrigger[]>,
  executionSkillByActor?: Map<string, Skill>,
  /** Pre-computed stagger windows from a prior simulation pass. When provided,
   *  attacks during these windows are auto-converted to execution. */
  knownStaggerWindows?: { start: number; end: number }[],
): SimulationResult {
  const events: SimEvent[] = [];
  const emit = (e: SimEvent) => events.push(e);
  const rng = config.rng || Math.random;
  const resolveRef = config.resolveRef || (() => 0);

  /** Queued slot item — an effect plus the event that produced it (for trigger actions). */
  interface SlotItem { effect: HitEffect; eventContext?: EventContext }

  /**
   * Resolve a hit's multiplier from either fixed value or multiplierRef.
   * `scaleBy` goes through the shared SCALE_BY_RESOLVERS registry, same as
   * ValueSource — `"attachmentStacks"`, `"breakStacks"`, `"event.stacks"` etc.
   */
  function resolveMultiplier(actorId: string, damage: { multiplier?: number; multiplierRef?: MultiplierRef }, eventContext?: EventContext): number {
    if (damage.multiplier !== undefined) return damage.multiplier;
    if (!damage.multiplierRef) return 0;
    const ref = damage.multiplierRef;
    const rawValue = resolveRef(actorId, ref.label);
    let base: number;
    if (ref.share === "equal") base = rawValue / (ref.equalCount || 1);
    else base = rawValue * ref.share;
    if (ref.scaleBy) {
      const ctx: ResolveContext = { resolveRef, enemy, event: eventContext };
      base *= resolveScaleBy(ref.scaleBy, ctx);
    }
    return base;
  }

  // ── Initialize state ──
  const sp = new SpState(config.initialSP);
  const gauges = new Map<string, GaugeState>();
  const actorBuffs = new Map<string, BuffManager>();
  const stackBuffs = new Map<string, StackBuffTracker>();
  const buildMap = new Map<string, CharacterBuild>();

  for (const build of builds) {
    buildMap.set(build.id, build);
    const initialGauge = config.initialGaugeFull ? build.gaugeMax : 0;
    gauges.set(build.id, new GaugeState(initialGauge, build.gaugeMax));
    actorBuffs.set(build.id, new BuffManager());
    stackBuffs.set(build.id, new StackBuffTracker());
  }

  const enemy = new EnemyState();

  // ── Initialize trigger processor ──
  const triggerProc = new TriggerProcessor();
  if (triggersByActor) {
    for (const [actorId, trigs] of triggersByActor) {
      triggerProc.registerAll(actorId, trigs);
    }
  }

  // ── Pending weapon charges (consumeOnAction buffs) ──
  // Map<actorId, Array<{ chargeBuffId, activateBuffId, stat, zone, value, consumeOnAction }>>
  interface PendingCharge {
    chargeBuffId: string;
    stat: string;
    zone: string;
    value: number;
    consumeOnAction: string[];
  }
  const pendingCharges = new Map<string, PendingCharge[]>();

  // ── Sort skills by start time ──
  const sorted = [...skills].sort((a, b) => a.startTime - b.startTime);

  // ── Validation state ──
  let validationError: ValidationError | undefined;
  const validate = config.validateConditions ?? false;

  // ── Track active actions per actor (for interrupt system) ──
  const activeActions = new Map<string, { placed: PlacedSkill; skill: Skill; endTime: number }>();
  // Track link cooldowns per actor: Map<actorId, cooldownExpiresAt>
  const linkCooldowns = new Map<string, number>();

  // ── Main control & interrupt tracking ──
  let currentMainControl: string | null = null;
  /** actionId → time at which the action was interrupted */
  const interruptInfo = new Map<string, number>();
  /** Deferred action_end records (emitted after Phase A when all interrupts are resolved) */
  const actionEndRecords: { actionId: string; actorId: string; naturalEnd: number; skillType: ActionType; variantId?: string; displayDuration?: number; hitOffsets?: number[] }[] = [];

  // ── Track ultimate enhancement windows (for variant condition) ──
  const ultWindows: { actorId: string; start: number; end: number }[] = [];

  // ── Helper: is actor in ultimate enhancement at time? ──
  function isUltimateActive(actorId: string, time: number): boolean {
    return ultWindows.some(w => w.actorId === actorId && time >= w.start && time < w.end);
  }

  // ── Helper: get current buff modifiers for an actor ──
  function getBuffModifiers(actorId: string, time: number): BuffModifiers {
    const base = emptyBuffModifiers();
    const mgr = actorBuffs.get(actorId);
    if (mgr) {
      const mods = mgr.aggregateModifiers(time);
      Object.assign(base, mods);
    }
    // Also aggregate enemy debuffs that affect damage zones
    const enemyMods = enemy.buffManager.aggregateModifiers(time);
    // Enemy debuffs contribute to vulnerability/fragility via the target context, not here
    return base;
  }

  // ── Collect all hits globally ──
  interface GlobalHit {
    hit: Hit; hitTime: number; hitIdx: number;
    actorId: string; actionId: string; build: CharacterBuild; skill: Skill;
    selectedVariant: SkillVariant | null;
  }
  const globalHits: GlobalHit[] = [];

  // ── Helper: sweep expired stack buffs for all actors and emit events ──
  function sweepStackBuffExpiry(time: number) {
    for (const [actorId, tracker] of stackBuffs) {
      const changes = tracker.sweepExpired(time);
      for (const ch of changes) {
        emit({
          type: "stack_change", time, actorId,
          buffType: ch.buffType,
          stacks: ch.current, prevStacks: ch.prev,
          reason: "expired",
        });
      }
    }
  }

  // ── Stagger pre-scan: check if enemy is staggered at a given time ──
  // Phase B hasn't run yet, so we simulate stagger from collected globalHits.
  // Returns { isStaggered, windowStart } or null.
  // ── Stagger window lookup (from knownStaggerWindows, populated by a prior simulation pass) ──
  function isInStaggerWindow(atTime: number): { isStaggered: boolean; windowStart: number } {
    if (!knownStaggerWindows) return { isStaggered: false, windowStart: 0 };
    for (const w of knownStaggerWindows) {
      if (atTime >= w.start && atTime < w.end) return { isStaggered: true, windowStart: w.start };
    }
    return { isStaggered: false, windowStart: 0 };
  }

  // Track execution usage per stagger window (keyed by window start time).
  // Once an execution fires in a window, no more can fire (even if interrupted).
  const executionUsedInWindow = new Set<number>();

  // ── Phase A: Process each skill (skill-level ops + collect hits) ──
  for (const placed of sorted) {
    if (validationError) break; // stop processing after first error

    const { actionId, actorId, startTime } = placed;
    let skill = placed.skill;
    const build = buildMap.get(actorId);
    if (!build) continue;

    const time = startTime;

    // Advance enemy state + emit expiry events
    const expiryChanges = enemy.advanceTime(time);
    if (expiryChanges.attachmentExpired) {
      emit({ type: "attachment_change", time: expiryChanges.attachmentExpired.expiresAt, element: null, stacks: 0, prevElement: expiryChanges.attachmentExpired.element, prevStacks: expiryChanges.attachmentExpired.stacks });
    }
    if (expiryChanges.breakExpired) {
      emit({ type: "break_change", time: expiryChanges.breakExpired.expiredAt, stacks: 0, prevStacks: expiryChanges.breakExpired.prevStacks });
    }
    if (expiryChanges.staggerExpired) {
      emit({ type: "stagger_change", time, amount: 0, total: 0, maxStagger: enemyConfig.maxStagger, nodeReached: false, isFullStagger: false });
    }
    if (expiryChanges.anomaliesExpired) {
      for (const a of expiryChanges.anomaliesExpired) {
        emit({ type: "anomaly_remove", time: a.expiresAt, anomalyType: a.type, level: a.level, sourceId: "" });
      }
    }
    // Advance SP regen to action start
    sp.advanceRegen(time);
    sweepStackBuffExpiry(time);

    // ── Auto-convert first attack during stagger → execution ──
    let autoConvertedToExecution = false;
    if (skill.type === "attack" && executionSkillByActor?.has(actorId)) {
      const scan = isInStaggerWindow(time);
      if (scan.isStaggered && !executionUsedInWindow.has(scan.windowStart)) {
        skill = executionSkillByActor.get(actorId)!;
        executionUsedInWindow.add(scan.windowStart);
        autoConvertedToExecution = true;
      }
    }

    // ── 0a. Check if action can proceed (switch + per-actor interrupt) ──
    const activeAct = activeActions.get(actorId);
    if (activeAct && time < activeAct.endTime) {
      const isSwitch = needsMainControl(skill) && currentMainControl !== null && actorId !== currentMainControl;
      // Switch can interrupt anything except ultimate animation
      const switchCanInterrupt = isSwitch && activeAct.skill.type !== "ultimate";
      const perActorCanInterrupt = canInterrupt(activeAct.skill, skill);
      if (!switchCanInterrupt && !perActorCanInterrupt) {
        continue; // blocked — skip this action
      }
    }

    // ── 0b. Main control switch ──
    if (needsMainControl(skill) && actorId !== currentMainControl) {
      if (currentMainControl !== null) {
        // Interrupt old main's active action (unless ultimate animation)
        const oldActive = activeActions.get(currentMainControl);
        if (oldActive && time < oldActive.endTime && oldActive.skill.type !== "ultimate") {
          interruptInfo.set(oldActive.placed.actionId, time);
          oldActive.endTime = time;
        }
      }
      currentMainControl = actorId;
    }

    // ── 0c. Per-actor interrupt ──
    // If we reach here, canInterrupt or switchCanInterrupt was true (checked in 0a)
    if (activeAct && time < activeAct.endTime) {
      interruptInfo.set(activeAct.placed.actionId, time);
      activeAct.endTime = time;
    }

    // ── 0b. Condition check (validation mode) ──
    if (validate) {
      // SP check
      if (skill.spCost > 0) {
        const currentTotal = sp.getTrueSP() + sp.getRefundSP();
        if (currentTotal < skill.spCost - 0.01) {
          validationError = {
            actorId, actionId, time,
            code: "ISSUE_SP_INSUFFICIENT",
            message: `SP不足: 需要${skill.spCost}, 当前${currentTotal.toFixed(1)}`,
          };
          break;
        }
      }
      // Gauge check (ultimate)
      if (skill.gaugeCost && skill.gaugeCost > 0) {
        const gauge = gauges.get(actorId);
        const current = gauge?.getGauge() || 0;
        const max = gauge?.getMax() || 0;
        if (current < max - 0.01) {
          validationError = {
            actorId, actionId, time,
            code: "ISSUE_GAUGE_INSUFFICIENT",
            message: `终结技能量不足: 需要${max}, 当前${current.toFixed(0)}`,
          };
          break;
        }
      }
      // Execution validation (only for manually placed executions, not auto-converted attacks)
      if (skill.type === "execution" && !autoConvertedToExecution) {
        const scan = isInStaggerWindow(time);
        if (!scan.isStaggered) {
          validationError = {
            actorId, actionId, time,
            code: "ISSUE_NOT_STAGGERED",
            message: `处决失败: 敌人未处于失衡状态`,
          };
          break;
        }
        if (executionUsedInWindow.has(scan.windowStart)) {
          validationError = {
            actorId, actionId, time,
            code: "ISSUE_EXECUTION_USED",
            message: `处决失败: 本次失衡已触发过处决`,
          };
          break;
        }
        executionUsedInWindow.add(scan.windowStart);
      }
      // Link CD check
      if (skill.type === "link") {
        const cdExpiry = linkCooldowns.get(actorId) || 0;
        if (time < cdExpiry - 0.001) {
          validationError = {
            actorId, actionId, time,
            code: "ISSUE_COOLDOWN_ACTIVE",
            message: `连携技冷却中: ${(cdExpiry - time).toFixed(1)}s后可用`,
          };
          break;
        }
      }
    }

    // Track this action as active (for interrupt checks on subsequent actions)
    activeActions.set(actorId, { placed, skill, endTime: time + skill.duration });

    // ── 1. Variant selection ──
    let selectedVariant: SkillVariant | null = null;
    if (placed.variants?.length) {
      const tracker = stackBuffs.get(actorId);
      const condState: ConditionState = {
        stackBuffs: tracker?.getAllStacks() || {},
        ultimateActive: isUltimateActive(actorId, time),
      };
      selectedVariant = selectVariant(placed.variants, condState);

      if (selectedVariant) {
        // Consume buffs if required
        if (selectedVariant.consumeBuffs?.length && tracker) {
          for (const consume of selectedVariant.consumeBuffs) {
            const result = consume.stacks === "all"
              ? tracker.consumeAll(consume.buffType)
              : tracker.consumeStacks(consume.buffType, consume.stacks as number);
            if (result.prev !== result.current) {
              emit({
                type: "stack_change", time, actorId,
                buffType: consume.buffType,
                stacks: result.current, prevStacks: result.prev,
                reason: "variant_consumed",
              });
            }
          }
        }

        // Apply variant overrides
        skill = applyVariant(skill, selectedVariant);
      }

      emit({
        type: "condition_result", time, actorId, actionId,
        variantId: selectedVariant?.id || null,
        consumedBuffs: selectedVariant?.consumeBuffs?.map(c => ({
          buffType: c.buffType,
          stacks: typeof c.stacks === "number" ? c.stacks : 0,
        })),
      });
    }

    // ── 2. Action start ──
    emit({
      type: "action_start", time, actorId, actionId,
      skillType: skill.type,
      variantId: selectedVariant?.id,
    });
    // Fire skill_cast triggers at action start, out-of-hit. Trigger actions
    // resolve inline (legacy fireTriggers path) — they don't participate in
    // the hit's effectDamages/slot pipeline.
    {
      const castState = buildTriggerState(actorId, time);
      fireTriggers(
        { type: "action_start", time, sourceActorId: actorId, data: { actionType: skill.type, actionId } },
        castState, actorId, actionId, time, build,
      );
    }

    // SP cost
    if (skill.spCost > 0) {
      const consumed = sp.consume(skill.spCost);
      const snap = sp.snapshot();
      emit({
        type: "sp_change", time, actorId, change: -skill.spCost,
        spType: consumed.refundSPConsumed > 0 ? "refund" : "true",
        currentTrueSP: snap.trueSP, currentRefundSP: snap.refundSP, currentTotal: snap.total,
        reason: "skill_cost", sourceId: actionId,
      });

      // Gauge charge from trueSP consumed → all actors (unless gaugeFromSelfOnly)
      if (consumed.trueSPConsumed > 0) {
        for (const [aid, gauge] of gauges) {
          const actorBuild = buildMap.get(aid);
          if (!actorBuild) continue;
          // gaugeFromSelfOnly: skip gauge from other actors' SP consumption
          if (actorBuild.gaugeFromSelfOnly && aid !== actorId) continue;
          const charge = computeGaugeChargeFromSP(consumed.trueSPConsumed, actorBuild.stats.ultChargeEff);
          const actual = gauge.modify(charge, time);
          if (actual !== 0) {
            emit({
              type: "gauge_change", time, actorId: aid,
              change: actual, gauge: gauge.getGauge(),
              reason: "sp_consumption",
            });
          }
        }
      }

      // Regen pause
      sp.pauseRegenUntil(time + 0.5);
    }

    // Gauge cost (ultimate)
    if (skill.gaugeCost && skill.gaugeCost > 0) {
      const gauge = gauges.get(actorId);
      if (gauge) {
        const consumed = gauge.consumeForUltimate(skill.gaugeCost);
        emit({
          type: "gauge_change", time, actorId,
          change: -consumed, gauge: gauge.getGauge(),
          reason: "ultimate_cast",
        });
      }
    }

    // Link cast → 10 gauge to caster only (global rule)
    if (skill.type === "link") {
      const gauge = gauges.get(actorId);
      if (gauge) {
        const gain = computeDirectGaugeGain(10, build.stats.ultChargeEff);
        const actual = gauge.modify(gain, time);
        if (actual !== 0) {
          emit({
            type: "gauge_change", time, actorId,
            change: actual, gauge: gauge.getGauge(),
            reason: "link_cast",
          });
        }
      }
    }

    // Register ultimate enhancement window
    if (skill.type === "ultimate") {
      // Enhancement window starts after skill duration
      // (simplified: start = startTime, end = startTime + duration)
      // The actual enhancement period is handled by the UI's enhancement time
      // For now, mark the entire skill duration as ultimate active
      const enhEnd = startTime + skill.duration;
      ultWindows.push({ actorId, start: startTime, end: enhEnd });
      // Block gauge during ultimate
      const gauge = gauges.get(actorId);
      gauge?.addBlockWindow(startTime, enhEnd);
    }



    // ── 3. Collect all hits (interrupt filtering deferred to Phase B) ──
    for (let hitIdx = 0; hitIdx < skill.hits.length; hitIdx++) {
      const hit = skill.hits[hitIdx];
      const hitTime = startTime + hit.offset;
      globalHits.push({ hit, hitTime, hitIdx, actorId, actionId, build, skill, selectedVariant });
    }

    // ── 4. Track action end + link cooldown (action_end emitted after Phase A) ──
    const endTime = startTime + skill.duration;

    if (skill.type === "link" && skill.cooldown > 0) {
      linkCooldowns.set(actorId, endTime + skill.cooldown);
    }

    actionEndRecords.push({
      actionId, actorId, naturalEnd: endTime,
      skillType: skill.type, variantId: selectedVariant?.id,
      displayDuration: skill.displayDuration,
      hitOffsets: skill.hits.map(h => h.offset),
    });
  }

  // ── Emit deferred action_end events (with correct interrupted flag) ──
  for (const rec of actionEndRecords) {
    const intTime = interruptInfo.get(rec.actionId);
    const interrupted = intTime !== undefined;
    emit({
      type: "action_end",
      time: interrupted ? intTime : rec.naturalEnd,
      actorId: rec.actorId,
      actionId: rec.actionId,
      skillType: rec.skillType,
      variantId: rec.variantId,
      interrupted,
      displayDuration: rec.displayDuration,
      hitOffsets: rec.hitOffsets,
    });
  }

  // ═════════════════════════════════════════════════════════════════
  // Phase B: Process all hits globally sorted by absolute time
  // ═════════════════════════════════════════════════════════════════

  globalHits.sort((a, b) => a.hitTime - b.hitTime);

  // Track which actions have been seen (for consumeOnAction first-hit detection)
  const seenActions = new Set<string>();

  for (const { hit, hitTime, hitIdx, actorId, actionId, build, skill } of globalHits) {
    if (validationError) break;

    // ── Activate pending weapon charges on first hit of a new action ──
    if (!seenActions.has(actionId)) {
      seenActions.add(actionId);
      const charges = pendingCharges.get(actorId);
      if (charges && charges.length > 0) {
        const remaining: PendingCharge[] = [];
        for (const charge of charges) {
          const buffMgr = actorBuffs.get(actorId);
          if (buffMgr && buffMgr.getStacks(charge.chargeBuffId, hitTime) > 0
              && charge.consumeOnAction.includes(skill.type)) {
            buffMgr.removeById(charge.chargeBuffId);
            emit({
              type: "buff_remove", time: hitTime, actorId, targetId: actorId,
              buffId: charge.chargeBuffId, buffName: charge.chargeBuffId,
              target: "self", stacks: 0, duration: 0, reason: "consumed",
            });
            const modZone = resolveBuffModifierZone(charge.stat, charge.zone);
            const activeDef: BuffDef = {
              id: `${charge.chargeBuffId}_active`,
              name: `${charge.chargeBuffId}_active`,
              target: "self",
              duration: skill.duration + 0.001,
              maxStacks: 1,
              stackBehavior: "replace",
              modifiers: modZone ? [{ zone: modZone, valuePerStack: charge.value }] : [],
            };
            buffMgr.apply(activeDef, actorId, hitTime);
            emit({
              type: "buff_apply", time: hitTime, actorId, targetId: actorId,
              buffId: activeDef.id, buffName: activeDef.id, target: "self",
              stacks: 1, duration: activeDef.duration, reason: "weapon_charge",
            });
          } else {
            remaining.push(charge);
          }
        }
        if (remaining.length > 0) pendingCharges.set(actorId, remaining);
        else pendingCharges.delete(actorId);
      }
    }

    // ── Hit interrupt filter ──
    const intTime = interruptInfo.get(actionId);
    if (intTime !== undefined && hitTime >= intTime) {
      // Check if this hit is protected by detach
      const isProtected = skill.detach !== undefined && hit.offset >= skill.detach;
      if (!isProtected) continue; // hit cancelled by interrupt
    }

    // Advance SP regen to hit time
    sp.advanceRegen(hitTime);
    sweepStackBuffExpiry(hitTime);
    // Advance enemy state + emit expiry events
    const hitExpiryChanges = enemy.advanceTime(hitTime);
    if (hitExpiryChanges.attachmentExpired) {
      emit({ type: "attachment_change", time: hitExpiryChanges.attachmentExpired.expiresAt, element: null, stacks: 0, prevElement: hitExpiryChanges.attachmentExpired.element, prevStacks: hitExpiryChanges.attachmentExpired.stacks });
    }
    if (hitExpiryChanges.anomaliesExpired) {
      for (const a of hitExpiryChanges.anomaliesExpired) {
        emit({ type: "anomaly_remove", time: hitTime, anomalyType: a.type, level: a.level, sourceId: "" });
      }
    }

      // ════════════════════════════════════════════════════════════════
      // Hit pipeline — 3 phases + 2 deferTo slot drains:
      //   ① effects (+ effect-originated triggers fired inline)
      //   ② effect damages resolved
      //   ◇ afterEffectDamage slot drain (e.g. 结晶消失)
      //   ③ skill damage resolved
      //   ◇ afterSkillDamage slot drain + post-damage triggers fired
      //                              (e.g. 别礼 consume_attachment, hit_damage/skill_hit listeners)
      // Trigger cascades are suppressed (noTriggerEvents inside fireTriggers).
      // ════════════════════════════════════════════════════════════════

      const effectDamages: EffectDamage[] = [];
      const deferredActions: (() => void)[] = []; // legacy, unused by current effect handlers
      const hitTriggerEvents: TriggerEvent[] = [];
      // Slot queues carry an optional EventContext so deferred trigger actions
      // keep access to the triggering event's data when they eventually run.
      const slotQueues = {
        afterEffectDamage: [] as SlotItem[],
        afterSkillDamage:  [] as SlotItem[],
      };

      // ── Helper: route an effect to its slot or call processEffect now.
      //           allowDefer=false prevents re-queuing when draining a slot.
      const dispatchEffect = (effect: HitEffect, allowDefer: boolean, eventContext?: EventContext) => {
        if (allowDefer) {
          const deferTo = (effect.params as any)?.deferTo;
          if (deferTo === "afterEffectDamage") { slotQueues.afterEffectDamage.push({ effect, eventContext }); return; }
          if (deferTo === "afterSkillDamage")  { slotQueues.afterSkillDamage.push({ effect, eventContext });  return; }
        }
        processEffect(effect, actorId, actionId, hitTime, hitIdx, build, emit, effectDamages, deferredActions, hitTriggerEvents, skill.type, eventContext);
      };

      // ── Helper: resolve everything currently queued in effectDamages. ──
      const resolveQueuedDamages = () => {
        if (effectDamages.length === 0) return;
        const toResolve = effectDamages.splice(0);
        for (const eDmg of toResolve) {
          const buffMods = getBuffModifiers(eDmg.sourceId, hitTime);
          const eBuild = buildMap.get(eDmg.sourceId) || build;
          const ctx: DamageContext = {
            source: { buildStats: eBuild.buildStats, buffModifiers: buffMods },
            target: {
              defenseMultiplier: enemyConfig.defenseMultiplier,
              resistPhysical: enemyConfig.basePhysicalResist,
              resistBlaze: enemyConfig.baseMagicResist,
              resistEmag: enemyConfig.baseMagicResist,
              resistCold: enemyConfig.baseMagicResist,
              resistNature: enemyConfig.baseMagicResist,
              resistReduction: enemy.resistReduction,
              isStaggered: enemy.isStaggered,
              vulnerability: enemy.vulnerability,
              physicalFragility: enemy.getPhysicalFragility(hitTime),
              magicFragility: enemy.magicFragility,
              elementFragility: { ...enemy.elementFragility },
            },
            multiplier: eDmg.multiplier,
            element: eDmg.element,
            school: eDmg.school,
            sourceType: eDmg.sourceType,
            canCrit: eDmg.canCrit,
            critMode: config.critMode,
            rng,
          };
          const result = resolveDamage(ctx);
          emit({
            type: "damage", time: hitTime,
            sourceId: eDmg.sourceId, targetId: "boss",
            damage: result.finalDamage, multiplier: eDmg.multiplier,
            stagger: eDmg.stagger, isCrit: result.isCrit,
            element: eDmg.element, school: eDmg.school,
            actionId: eDmg.actionId, hitIndex: hitIdx,
          });
        }
      };

      // ── Helper: fire all pending trigger events through the unified pipeline. ──
      let _trigState: TriggerState | null = null;
      const getTrigState = () => (_trigState ??= buildTriggerState(actorId, hitTime));
      const fireQueuedTriggers = () => {
        if (hitTriggerEvents.length === 0) return;
        const toFire = hitTriggerEvents.splice(0);
        for (const te of toFire) {
          fireTriggers(te, getTrigState(), actorId, actionId, hitTime, build, effectDamages, slotQueues);
        }
      };

      // ── Helper: drain a slot once; drained effects may push to hitTriggerEvents. ──
      const drainSlot = (slot: SlotItem[]) => {
        if (slot.length === 0) return;
        const toRun = slot.splice(0);
        for (const item of toRun) dispatchEffect(item.effect, false, item.eventContext);
      };

      // ════════════ ① Effects ════════════
      // Effect-originated triggers fire at the end of this phase (before effect
      // damages resolve). This means the hit that emits an event (attachment_applied,
      // physical_anomaly, buff_applied, etc.) sees the triggered effects reflected
      // in its own subsequent damage — e.g. 赫拉芬格 "施加寒冷附着时 cold_dmg+X%"
      // buff applies to the skill hit that caused the attachment.
      let hitMarkedConditional = false;
      for (const effect of hit.effects) {
        const cond = (effect.params as any)?.condition;
        if (typeof cond === "string") {
          if (!evaluateEffectCondition(cond, enemy)) continue;
          if (!hitMarkedConditional) {
            emit({ type: "hit_mark", time: hitTime, actionId, hitIndex: hitIdx, kind: "conditional" });
            hitMarkedConditional = true;
          }
        }
        dispatchEffect(effect, true);
      }
      // Fire effect-originated triggers for events emitted during Phase ①.
      // Trigger actions route through the shared effectDamages pool and honour deferTo.
      fireQueuedTriggers();

      // Legacy deferredActions (currently no effect handler uses this).
      for (const action of deferredActions) action();
      deferredActions.length = 0;

      // ════════════ ② Effect damages ════════════
      resolveQueuedDamages();

      // ════════════ ◇ afterEffectDamage slot drain ════════════
      // Hit-effects (and trigger actions) with `deferTo: "afterEffectDamage"` run
      // here. 例如 管理员 源石结晶消耗：crystalConsumption trigger 在 Phase ① 末
      // fire，其 buff_consume 标 deferTo=afterEffectDamage 后落到这里，保证
      // 结晶消失发生在效果伤害（碎晶伤害）结算之后、技能伤害之前。
      drainSlot(slotQueues.afterEffectDamage);
      fireQueuedTriggers();     // drained effects may emit new trigger events
      resolveQueuedDamages();

      // ════════════ ③ Skill damage ════════════
      if (hit.damage) {
        const mult = resolveMultiplier(actorId, hit.damage);
        const buffMods = getBuffModifiers(actorId, hitTime);
        const ctx: DamageContext = {
          source: { buildStats: build.buildStats, buffModifiers: buffMods },
          target: {
            defenseMultiplier: enemyConfig.defenseMultiplier,
            resistPhysical: enemyConfig.basePhysicalResist,
            resistBlaze: enemyConfig.baseMagicResist,
            resistEmag: enemyConfig.baseMagicResist,
            resistCold: enemyConfig.baseMagicResist,
            resistNature: enemyConfig.baseMagicResist,
            resistReduction: enemy.resistReduction,
            isStaggered: enemy.isStaggered,
            vulnerability: enemy.vulnerability,
            physicalFragility: enemy.getPhysicalFragility(hitTime),
            magicFragility: enemy.magicFragility,
            elementFragility: { ...enemy.elementFragility },
          },
          multiplier: mult,
          element: hit.damage.element,
          school: hit.damage.school,
          sourceType: hit.damage.sourceType,
          canCrit: hit.damage.canCrit,
          critMode: config.critMode,
          rng,
        };
        const result = resolveDamage(ctx);
        emit({
          type: "damage", time: hitTime,
          sourceId: actorId, targetId: "boss",
          damage: result.finalDamage, multiplier: mult,
          stagger: hit.damage.stagger, isCrit: result.isCrit,
          element: hit.damage.element, school: hit.damage.school,
          actionId, hitIndex: hitIdx,
        });
        // Stagger from hit damage
        if (hit.damage.stagger > 0 && !enemy.isStaggered) {
          const staggerResult = resolveStagger(
            hit.damage.stagger, enemy.stagger,
            enemyConfig.maxStagger, enemyConfig.staggerNodes,
          );
          enemy.stagger = staggerResult.newTotal;
          emit({
            type: "stagger_change", time: hitTime,
            amount: hit.damage.stagger, total: staggerResult.newTotal,
            maxStagger: enemyConfig.maxStagger,
            nodeReached: staggerResult.nodeReached,
            nodeIndex: staggerResult.nodeIndex,
            isFullStagger: staggerResult.isFullStagger,
          });
          if (staggerResult.isFullStagger) {
            enemy.isStaggered = true;
            enemy.staggerEndTime = hitTime + enemyConfig.staggerBreakDuration;
          }
        }
      }

      // ════════════ ◇ afterSkillDamage slot drain + post-damage triggers ════════════
      // Step 1: drain deferred hit.effects (e.g. 别礼 consume_attachment);
      //         these may push new trigger events (e.g. attachment_consumed).
      drainSlot(slotQueues.afterSkillDamage);

      // Step 2: synthesise post-damage trigger events and queue alongside step 1's.
      if (hit.damage) {
        const sourceType = hit.damage.sourceType;
        hitTriggerEvents.push({ type: "hit_damage", time: hitTime, sourceActorId: actorId, data: { actionType: sourceType } });
        const typeMap: Record<string, string> = { attack: "attack_hit", skill: "skill_hit", link: "link_hit", ultimate: "ultimate_hit", execution: "execution_hit" };
        const specificType = typeMap[sourceType];
        if (specificType) {
          hitTriggerEvents.push({ type: specificType as any, time: hitTime, sourceActorId: actorId, data: {} });
        }
        if (skill.isHeavyAttack && hitIdx === skill.hits.length - 1) {
          hitTriggerEvents.push({ type: "heavy_attack_hit", time: hitTime, sourceActorId: actorId, data: {} });
        }
        if (sourceType === "attack" && skill.id.includes("aerial")) {
          hitTriggerEvents.push({ type: "aerial_hit" as any, time: hitTime, sourceActorId: actorId, data: {} });
        }
        if (hit.damage.stagger > 0) {
          hitTriggerEvents.push({ type: "stagger_increased", time: hitTime, sourceActorId: actorId, data: {} });
        }
      }

      // Step 3: fire everything — drained-effect events + post-damage events together.
      fireQueuedTriggers();

      // Step 4: drain again if trigger actions routed more into the slot;
      //         no further trigger cascade since 禁级联 is enforced.
      drainSlot(slotQueues.afterSkillDamage);
      resolveQueuedDamages();

      // Legacy: flush trigger-level `deferred: true` triggers (LASTRITE hypothermia 等).
      // Each item carries the event that produced it so `event.*` scaleBy params
      // still resolve correctly at deferred fire time.
      const deferredEffects = triggerProc.flushDeferred();
      for (const { effect: eff, event: evt } of deferredEffects) {
        dispatchEffect(eff, false, normalizeTriggerEvent(evt));
      }
      resolveQueuedDamages();
  }  // end globalHits for loop

  // ── Final expiry sweep: expire any remaining timed states ──
  sweepStackBuffExpiry(Infinity);
  const finalExpiry = enemy.advanceTime(Infinity);
  if (finalExpiry.attachmentExpired) {
    emit({ type: "attachment_change", time: finalExpiry.attachmentExpired.expiresAt, element: null, stacks: 0, prevElement: finalExpiry.attachmentExpired.element, prevStacks: finalExpiry.attachmentExpired.stacks });
  }
  if (finalExpiry.anomaliesExpired) {
    for (const a of finalExpiry.anomaliesExpired) {
      emit({ type: "anomaly_remove", time: a.expiresAt, anomalyType: a.type, level: a.level, sourceId: "" });
    }
  }

  // ── Build final state ──
  const actorFinals = new Map<string, { gauge: number; trueSP: number; refundSP: number; stackBuffs: Record<string, number> }>();
  for (const build of builds) {
    const gauge = gauges.get(build.id);
    const tracker = stackBuffs.get(build.id);
    actorFinals.set(build.id, {
      gauge: gauge?.getGauge() || 0,
      trueSP: sp.getTrueSP(),
      refundSP: sp.getRefundSP(),
      stackBuffs: tracker?.getAllStacks() || {},
    });
  }

  return {
    events,
    finalState: {
      actors: actorFinals,
      enemy: {
        stagger: enemy.stagger,
        breakStacks: enemy.breakStacks,
        attachment: {
          element: enemy.attachment.element,
          stacks: enemy.attachment.stacks,
        },
        anomalies: {
          burning: enemy.anomalies.burning.active,
          frozen: enemy.anomalies.frozen.active,
          conduction: enemy.anomalies.conduction.active,
          corrosion: enemy.anomalies.corrosion.active,
        },
      },
    },
    validationError,
  };

  // ═════════════════════════════════════════════════════════════════
  // Trigger helpers (inner functions with access to kernel state)
  // ═════════════════════════════════════════════════════════════════

  function buildTriggerState(_actorId: string, time: number): TriggerState {
    // Aggregate ALL actors' stack buffs (triggers can check any actor's buffs)
    const allStackBuffs: Record<string, number> = {};
    for (const [, tracker] of stackBuffs) {
      const stacks = tracker.getAllStacks();
      for (const [key, val] of Object.entries(stacks)) {
        allStackBuffs[key] = (allStackBuffs[key] || 0) + val;
      }
    }

    // Collect active buff IDs across all actors
    const actorActiveBuffIds = new Set<string>();
    for (const [, mgr] of actorBuffs) {
      for (const b of mgr.getActive(time)) {
        actorActiveBuffIds.add(b.defId);
      }
    }

    // Collect active buff IDs on enemy
    const enemyActiveBuffIds = new Set<string>();
    for (const b of enemy.buffManager.getActive(time)) {
      enemyActiveBuffIds.add(b.defId);
    }

    return {
      enemy: {
        attachmentElement: enemy.attachment.element,
        attachmentStacks: enemy.attachment.stacks,
        breakStacks: enemy.breakStacks,
        isStaggered: enemy.isStaggered,
        anomalies: {
          burning: enemy.anomalies.burning.active,
          frozen: enemy.anomalies.frozen.active,
          conduction: enemy.anomalies.conduction.active,
          corrosion: enemy.anomalies.corrosion.active,
        },
        activeBuffIds: enemyActiveBuffIds,
      },
      actor: {
        stackBuffs: allStackBuffs,
        activeBuffIds: actorActiveBuffIds,
      },
      event: { type: "hit_damage", time: 0, sourceActorId: _actorId, data: {} },
    };
  }

  /**
   * Fire triggers for an event.
   *
   * When `effectDamagesPool` is provided, trigger-produced damages are appended
   * to it (for the caller to resolve in a unified phase) rather than resolved
   * inline. When `slotQueues` is provided, trigger actions with `deferTo` route
   * into the corresponding slot queue (along with the normalised event context
   * so deferred effects still see the triggering event's data).
   *
   * The raw event is normalised via `normalizeTriggerEvent` and passed to each
   * processed effect, enabling trigger-action params like
   * `valueRef: { label, scaleBy: "event.stacks" }` to scale by consumed/added
   * stack counts (LASTRITE 低温症 pattern).
   *
   * Without `effectDamagesPool`, the legacy behaviour is used: damages resolve
   * inline. Trigger cascades are always suppressed (禁级联).
   */
  function fireTriggers(
    event: TriggerEvent,
    state: TriggerState,
    actorId: string,
    actionId: string,
    time: number,
    build: CharacterBuild,
    effectDamagesPool?: EffectDamage[],
    slotQueues?: { afterEffectDamage: SlotItem[]; afterSkillDamage: SlotItem[] },
  ): void {
    state.event = event;
    const immediateEffects = triggerProc.processEvent(event, state);
    const eventContext = normalizeTriggerEvent(event);
    // Process immediate trigger effects (these may produce damage, buffs, etc.)
    const localDamages: EffectDamage[] = effectDamagesPool || [];
    const trigDeferredActions: (() => void)[] = [];
    const noTriggerEvents: TriggerEvent[] = []; // don't cascade triggers from triggers
    for (const eff of immediateEffects) {
      // Honour deferTo when slot queues are available.
      const deferTo = slotQueues ? (eff.params as any)?.deferTo : undefined;
      if (deferTo === "afterEffectDamage" && slotQueues) { slotQueues.afterEffectDamage.push({ effect: eff, eventContext }); continue; }
      if (deferTo === "afterSkillDamage"  && slotQueues) { slotQueues.afterSkillDamage.push({ effect: eff, eventContext });  continue; }
      processEffect(eff, actorId, actionId, time, 0, build, emit, localDamages, trigDeferredActions, noTriggerEvents, undefined, eventContext);
    }
    // If caller didn't supply an external pool, resolve damages inline (legacy).
    if (effectDamagesPool) {
      // Caller will resolve; just execute deferred actions.
      for (const action of trigDeferredActions) action();
      return;
    }
    // Resolve trigger-originated damages immediately
    for (const eDmg of localDamages) {
      const buffMods = getBuffModifiers(eDmg.sourceId, time);
      const eBuild = buildMap.get(eDmg.sourceId) || build;
      const ctx: DamageContext = {
        source: { buildStats: eBuild.buildStats, buffModifiers: buffMods },
        target: {
          defenseMultiplier: enemyConfig.defenseMultiplier,
          resistPhysical: enemyConfig.basePhysicalResist,
          resistBlaze: enemyConfig.baseMagicResist,
          resistEmag: enemyConfig.baseMagicResist,
          resistCold: enemyConfig.baseMagicResist,
          resistNature: enemyConfig.baseMagicResist,
          resistReduction: enemy.resistReduction,
          isStaggered: enemy.isStaggered,
          vulnerability: enemy.vulnerability,
          physicalFragility: enemy.getPhysicalFragility(time),
          magicFragility: enemy.magicFragility,
          elementFragility: { ...enemy.elementFragility },
        },
        multiplier: eDmg.multiplier,
        element: eDmg.element,
        school: eDmg.school,
        sourceType: eDmg.sourceType,
        canCrit: eDmg.canCrit,
        critMode: config.critMode,
        rng,
      };
      const result = resolveDamage(ctx);
      emit({
        type: "damage", time,
        sourceId: eDmg.sourceId, targetId: "boss",
        damage: result.finalDamage, multiplier: eDmg.multiplier,
        stagger: eDmg.stagger, isCrit: result.isCrit,
        element: eDmg.element, school: eDmg.school,
        actionId, hitIndex: 0,
      });
    }
    // Execute trigger deferred actions
    for (const action of trigDeferredActions) {
      action();
    }
  }

  /** Check if a buff is active on any actor. (Used by condition evaluation.) */
  function _hasActorBuff(buffId: string, time: number): boolean {
    for (const [, mgr] of actorBuffs) {
      if (mgr.getStacks(buffId, time) > 0) return true;
    }
    return false;
  }

  // ═════════════════════════════════════════════════════════════════
  // Effect processor (inner function with access to kernel state)
  // ═════════════════════════════════════════════════════════════════

  function processEffect(
    effect: HitEffect,
    actorId: string,
    actionId: string,
    time: number,
    hitIndex: number,
    build: CharacterBuild,
    emit: (e: SimEvent) => void,
    effectDamages: EffectDamage[],
    deferredActions: (() => void)[],
    hitTriggerEvents?: TriggerEvent[],
    /** Action type context for trigger event data. */
    skillType?: ActionType,
    /** Present when this effect is a trigger action — lets `valueRef.scaleBy: "event.*"` resolve. */
    eventContext?: EventContext,
  ): void {
    const resolveCtx: ResolveContext = { resolveRef, enemy, event: eventContext };
    // Local shorthand for migrating old "p.foo ?? resolveRef(p.fooRef)" patterns.
    const rv = (source: ValueSource | undefined, fallback: number = 0): number =>
      resolveValue(source, actorId, resolveCtx, fallback);
    // Keep rv referenced even when no case uses it (e.g. empty migrations).
    void rv;
    switch (effect.type) {
      case "magic_attachment": {
        const p = effect.params as { element: DamageElement; stacks?: number; delay?: number };
        const magicEl = DAMAGE_ELEMENT_TO_MAGIC[p.element];
        if (!magicEl) break;
        const attachTime = time + (p.delay || 0);
        const stacks = p.stacks || 1;
        for (let i = 0; i < stacks; i++) {
          const outcomes = resolveMagicAttachment(
            magicEl, enemy.attachment.element as MagicElement | null, enemy.attachment.stacks,
          );
          for (const outcome of outcomes) {
            if (outcome.type === "stacked") {
              const prev = enemy.attachment.stacks;
              enemy.attachment.element = outcome.element;
              enemy.attachment.stacks = outcome.newStacks;
              enemy.attachment.expiresAt = attachTime + ATTACHMENT_DURATION;
              emit({
                type: "attachment_change", time: attachTime, sourceId: actorId,
                element: outcome.element, stacks: outcome.newStacks,
                prevElement: prev > 0 ? enemy.attachment.element : null, prevStacks: prev,
              });
              hitTriggerEvents?.push({
                type: "attachment_applied", time: attachTime, sourceActorId: actorId,
                data: { element: p.element, stacks: outcome.newStacks, actionType: skillType },
              });
            } else if (outcome.type === "burst") {
              // Burst damage (magic burst)
              const artsPower = build.stats.originiumArtsPower;
              const burstMult = magicBurstMult(outcome.stacks, artsPower);
              emit({
                type: "damage", time: attachTime,
                sourceId: actorId, targetId: "boss",
                damage: Math.floor(computeEffectiveATK(build.buildStats, getBuffModifiers(actorId, time)) * burstMult),
                multiplier: burstMult * 100, stagger: 0,
                isCrit: false, element: p.element, school: "magic",
                actionId, hitIndex,
              });
              hitTriggerEvents?.push({
                type: "magic_burst", time: attachTime, sourceActorId: actorId,
                data: { element: p.element, stacks: outcome.stacks, actionType: skillType },
              });
            } else if (outcome.type === "reaction") {
              // Clear attachment
              const prevEl = enemy.attachment.element;
              const prevStacks = enemy.attachment.stacks;
              enemy.attachment = { element: null, stacks: 0, expiresAt: 0 };
              emit({
                type: "attachment_change", time: attachTime, sourceId: actorId,
                element: null, stacks: 0,
                prevElement: prevEl, prevStacks,
              });
              // Apply anomaly
              const anomalyType = outcome.anomaly;
              const level = outcome.anomalyLevel;
              const duration = getAnomalyDuration(anomalyType, level);
              enemy.anomalies[anomalyType] = {
                active: true, level, expiresAt: attachTime + duration, sourceId: actorId,
              };
              emit({
                type: "anomaly_apply", time: attachTime,
                anomalyType, level, sourceId: actorId, duration,
              });
              hitTriggerEvents?.push({
                type: "anomaly_applied", time: attachTime, sourceActorId: actorId,
                data: { anomalyType, level, actionType: skillType },
              });
              // Specific anomaly type trigger events
              const anomalyTypeMap: Record<string, TriggerEventType> = {
                burning: "burn_applied", frozen: "freeze_applied",
                conduction: "conduction_applied", corrosion: "corrosion_applied",
              };
              const specificAnomalyEvent = anomalyTypeMap[anomalyType];
              if (specificAnomalyEvent) {
                hitTriggerEvents?.push({
                  type: specificAnomalyEvent, time: attachTime, sourceActorId: actorId,
                  data: { anomalyType, level, actionType: skillType },
                });
              }
            }
          }
        }
        break;
      }

      case "physical_anomaly": {
        const p = effect.params as { physicalType: "launch" | "knockdown" | "slam" | "armorBreak"; stacks?: number };
        const outcome = resolvePhysicalAnomaly(p.physicalType, enemy.breakStacks);
        if (outcome.type === "break_applied") {
          const prev = enemy.breakStacks;
          enemy.breakStacks = Math.min(BREAK_MAX_STACKS, enemy.breakStacks + outcome.newStacks);
          enemy.breakExpiresAt = time + BREAK_DURATION;
          emit({
            type: "break_change", time, sourceId: actorId,
            stacks: enemy.breakStacks, prevStacks: prev,
            physicalType: p.physicalType,
          });
        } else if (outcome.type === "slam") {
          // Phase 1: consume break stacks (state change)
          const consumed = outcome.breakStacksConsumed;
          enemy.breakStacks = 0;
          emit({ type: "break_change", time, sourceId: actorId, stacks: 0, prevStacks: consumed, physicalType: "slam" });
          // Queue slam damage for Phase 2
          const artsPower = build.stats.originiumArtsPower;
          const mult = slamMult(consumed, 1, artsPower); // level=1 simplified
          effectDamages.push({
            sourceId: actorId, actionId,
            multiplier: mult, stagger: 0,
            element: "physical", school: "physical", sourceType: "skill",
            canCrit: false,
          });
        } else if (outcome.type === "armorBreak") {
          // Phase 1: consume break stacks + apply vulnerability
          const consumed = outcome.breakStacksConsumed;
          enemy.breakStacks = 0;
          emit({ type: "break_change", time, sourceId: actorId, stacks: 0, prevStacks: consumed, physicalType: "armorBreak" });
          const artsPower = build.stats.originiumArtsPower;
          const vuln = armorBreakVulnerability(consumed, artsPower);
          const dur = armorBreakVulnDuration(consumed);
          // Refresh (not accumulate): a new 碎甲 replaces value + expiry.
          enemy.armorBreakVuln = { value: vuln, expiresAt: time + dur };
          // Queue armorBreak damage for Phase 2
          const mult = armorBreakMult(consumed, 1, artsPower); // level=1 simplified
          effectDamages.push({
            sourceId: actorId, actionId,
            multiplier: mult, stagger: 0,
            element: "physical", school: "physical", sourceType: "skill",
            canCrit: false,
          });
        } else if (outcome.type === "launch" || outcome.type === "knockdown") {
          // Launch/knockdown: don't consume break, add 1 stack
          const prev = enemy.breakStacks;
          enemy.breakStacks = Math.min(BREAK_MAX_STACKS, enemy.breakStacks + 1);
          enemy.breakExpiresAt = time + BREAK_DURATION;
          emit({ type: "break_change", time, sourceId: actorId, stacks: enemy.breakStacks, prevStacks: prev, physicalType: outcome.type });
          // Queue launch/knockdown damage for Phase 2
          const artsPower = build.stats.originiumArtsPower;
          const mult = launchKnockdownMult(1, artsPower); // level=1 simplified
          effectDamages.push({
            sourceId: actorId, actionId,
            multiplier: mult, stagger: 0,
            element: "physical", school: "physical", sourceType: "skill",
            canCrit: false,
          });
        }
        // Emit trigger event only for actual physical anomaly (not break_applied)
        if (outcome.type !== "break_applied") {
          hitTriggerEvents?.push({
            type: "physical_anomaly", time, sourceActorId: actorId,
            data: { physicalType: p.physicalType, outcome: outcome.type },
          });
        }
        break;
      }

      case "break_apply": {
        const p = effect.params as { stacks: number };
        const prev = enemy.breakStacks;
        enemy.breakStacks = Math.min(BREAK_MAX_STACKS, enemy.breakStacks + (p.stacks || 1));
        enemy.breakExpiresAt = time + BREAK_DURATION;
        emit({ type: "break_change", time, sourceId: actorId, stacks: enemy.breakStacks, prevStacks: prev });
        hitTriggerEvents?.push({
          type: "break_applied", time, sourceActorId: actorId,
          data: { stacks: enemy.breakStacks, prevStacks: prev, actionType: skillType },
        });
        break;
      }

      case "stack_buff_apply": {
        const p = effect.params as { buffType: string; stacks: number; expiresAt?: number; durationRef?: string; duration?: number; maxStacks?: number };
        const tracker = stackBuffs.get(actorId);
        if (tracker) {
          // Register with correct maxStacks from params or buffMetadata
          const meta = getBuffMeta(p.buffType);
          const maxStacks = p.maxStacks || meta?.maxLayers || 4;
          tracker.register(p.buffType, maxStacks);
          // Resolve expiry: explicit expiresAt > durationRef > duration > null (permanent)
          let expiresAt = p.expiresAt ?? null;
          if (expiresAt == null) {
            const dur = p.duration || (p.durationRef ? resolveRef(actorId, p.durationRef) : 0);
            if (dur > 0) expiresAt = time + dur;
          }
          const result = tracker.addStacks(p.buffType, p.stacks || 1, expiresAt);
          emit({
            type: "stack_change", time, actorId,
            buffType: p.buffType,
            stacks: result.current, prevStacks: result.prev,
            reason: "effect_applied",
          });
          hitTriggerEvents?.push({
            type: "stack_buff_gained", time, sourceActorId: actorId,
            data: { buffType: p.buffType, stacks: result.current },
          });
        }
        break;
      }

      case "stack_buff_consume": {
        const p = effect.params as { buffType: string; stacks: number | "all" };
        // Find the actor who actually has this stack buff (may differ from current actorId)
        let consumeActorId = actorId;
        let consumeTracker = stackBuffs.get(actorId);
        if (!consumeTracker || consumeTracker.getStacks(p.buffType) === 0) {
          for (const [aid, t] of stackBuffs) {
            if (t.getStacks(p.buffType) > 0) {
              consumeActorId = aid;
              consumeTracker = t;
              break;
            }
          }
        }
        if (consumeTracker && consumeTracker.getStacks(p.buffType) > 0) {
          const result = p.stacks === "all"
            ? consumeTracker.consumeAll(p.buffType)
            : consumeTracker.consumeStacks(p.buffType, p.stacks);
          emit({
            type: "stack_change", time, actorId: consumeActorId,
            buffType: p.buffType,
            stacks: result.current, prevStacks: result.prev,
            reason: "effect_consumed",
          });
          hitTriggerEvents?.push({
            type: "stack_buff_consumed", time, sourceActorId: consumeActorId,
            data: { buffType: p.buffType, consumed: result.prev - result.current },
          });
        }
        break;
      }

      case "sp_restore": {
        const p = effect.params as { amount?: number; amountRef?: string; spType?: "true" | "refund"; isTrueSP?: boolean };
        const spType = p.spType || (p.isTrueSP ? "true" : "refund");
        const amount = p.amount || (p.amountRef ? resolveRef(actorId, p.amountRef) : 0);
        const actual = sp.restore(amount, spType);
        if (actual > 0) {
          const snap = sp.snapshot();
          emit({
            type: "sp_change", time, actorId, change: actual,
            spType,
            currentTrueSP: snap.trueSP, currentRefundSP: snap.refundSP, currentTotal: snap.total,
            reason: "hit_restore", sourceId: actionId,
          });
          hitTriggerEvents?.push({
            type: "sp_restored", time, sourceActorId: actorId,
            data: { amount: actual, spType },
          });
        }
        break;
      }

      case "gauge_gain": {
        const p = effect.params as { amount: number };
        const gauge = gauges.get(actorId);
        if (gauge) {
          const gain = computeDirectGaugeGain(p.amount, build.stats.ultChargeEff);
          const actual = gauge.modify(gain, time);
          if (actual !== 0) {
            emit({
              type: "gauge_change", time, actorId,
              change: actual, gauge: gauge.getGauge(),
              reason: "hit_gauge_gain",
            });
          }
        }
        break;
      }

      case "blaze_to_magma": {
        // LAEVATAIN talent: consume enemy blaze attachment → self magma stacks
        if (enemy.attachment.element === "fire" && enemy.attachment.stacks > 0) {
          const tracker = stackBuffs.get(actorId);
          if (tracker) {
            const currentMagma = tracker.getStacks("magma");
            const canAdd = 4 - currentMagma;
            const amount = Math.min(enemy.attachment.stacks, canAdd);
            if (amount > 0) {
              // Consume attachment
              const prevStacks = enemy.attachment.stacks;
              enemy.attachment.stacks -= amount;
              if (enemy.attachment.stacks <= 0) {
                enemy.attachment = { element: null, stacks: 0, expiresAt: 0 };
              }
              emit({
                type: "attachment_change", time, sourceId: actorId,
                element: enemy.attachment.element, stacks: enemy.attachment.stacks,
                prevElement: "fire", prevStacks,
              });
              // Add magma
              const result = tracker.addStacks("magma", amount);
              emit({
                type: "stack_change", time, actorId,
                buffType: "magma", stacks: result.current, prevStacks: result.prev,
                reason: "blaze_to_magma",
              });
              emit({
                type: "convert", time, actorId,
                sourceElement: "fire", targetBuff: "magma", amount,
              });
            }
          }
        }
        break;
      }

      case "buff_apply": {
        const p = effect.params as {
          buffId: string;
          target?: BuffTarget | "mainControl" | "trigger_source" | "others";
          duration?: ValueSource;
          durationRef?: ValueSource;
          stat?: string;
          zone?: string;
          value?: ValueSource;
          valueRef?: ValueSource;
          maxStacks?: number;
          stackBehavior?: string;
          // Conditional application — skip if not satisfied.
          // Supports: "enemy_has_break", "enemy_not_has_break",
          //           "enemy_has_attachment", "enemy_not_has_attachment".
          condition?: string;
          // consumeOnAction stored buff metadata
          consumeOnAction?: string[];
          activateStat?: string;
          activateZone?: string;
          activateValue?: number;
        };

        // Condition gating is handled in the Phase 1 caller via
        // `evaluateEffectCondition` so effect dispatchers stay uniform.

        const duration = rv(p.duration ?? p.durationRef, 0) || 15;

        // If this is a consumeOnAction charge buff, register it
        if (p.consumeOnAction?.length && p.activateStat && p.activateZone) {
          const charges = pendingCharges.get(actorId) || [];
          charges.push({
            chargeBuffId: p.buffId,
            stat: p.activateStat,
            zone: p.activateZone,
            value: p.activateValue || 0,
            consumeOnAction: p.consumeOnAction,
          });
          pendingCharges.set(actorId, charges);
        }

        // Resolve stat modifiers from stat/zone/value params.
        // value/valueRef can be a ValueSource (literal, label, or object with scaleBy).
        // E.g. LASTRITE 低温症: { label: "talent_0", scaleBy: "event.stacks" }
        // scales the buff value by the consumed-attachment-stacks from the triggering event.
        const modifiers: BuffModifierDef[] = [];
        if (p.stat && p.zone) {
          const modZone = resolveBuffModifierZone(p.stat, p.zone);
          const modValue = rv(p.value ?? p.valueRef, 0);
          if (modZone && modValue) {
            modifiers.push({ zone: modZone, valuePerStack: modValue });
          }
        }

        const buffDef: BuffDef = {
          id: p.buffId,
          name: p.buffId,
          target: (p.target === "mainControl" || p.target === "trigger_source" || p.target === "others") ? "self" : (p.target || "self"),
          duration,
          maxStacks: p.maxStacks || 1,
          stackBehavior: (p.stackBehavior as any) || "refresh",
          modifiers,
        };

        // Determine target BuffManager(s)
        const targetStr = p.target || "self";
        if (targetStr === "enemy") {
          const result = enemy.buffManager.apply(buffDef, actorId, time);
          if (result.added) {
            emit({
              type: "buff_apply", time, actorId, targetId: "enemy",
              buffId: p.buffId, buffName: p.buffId, target: "enemy",
              stacks: enemy.buffManager.getStacks(p.buffId, time),
              duration, reason: "effect",
            });
            // Push trigger event for enemy buff application (used by weapons like 宏愿)
            hitTriggerEvents?.push({
              type: "anomaly_applied", time, sourceActorId: actorId,
              data: { buffType: p.buffId, actionType: skillType },
            });
          }
        } else if (targetStr === "team" || targetStr === "others") {
          for (const [aid, mgr] of actorBuffs) {
            if (targetStr === "others" && aid === actorId) continue;
            const cloneDef = { ...buffDef, target: "self" as BuffTarget };
            mgr.apply(cloneDef, actorId, time);
          }
          emit({
            type: "buff_apply", time, actorId, targetId: targetStr,
            buffId: p.buffId, buffName: p.buffId, target: targetStr as any,
            stacks: 1, duration, reason: "effect",
          });
        } else {
          // "self" / "mainControl" / "trigger_source" → apply to source actor
          const mgr = actorBuffs.get(actorId);
          if (mgr) {
            mgr.apply(buffDef, actorId, time);
            emit({
              type: "buff_apply", time, actorId, targetId: actorId,
              buffId: p.buffId, buffName: p.buffId, target: "self",
              stacks: mgr.getStacks(p.buffId, time),
              duration, reason: "effect",
            });
          }
        }
        break;
      }

      case "buff_consume": {
        const p = effect.params as { buffId: string; stacks?: number | "all" };
        // Try actor buffs first, then enemy
        let found = false;
        for (const [aid, mgr] of actorBuffs) {
          if (mgr.getStacks(p.buffId, time) > 0) {
            mgr.removeById(p.buffId);
            emit({
              type: "buff_remove", time, actorId: aid, targetId: aid,
              buffId: p.buffId, buffName: p.buffId, target: "self",
              stacks: 0, duration: 0, reason: "consumed",
            });
            found = true;
            break;
          }
        }
        if (!found && enemy.buffManager.getStacks(p.buffId, time) > 0) {
          enemy.buffManager.removeById(p.buffId);
          emit({
            type: "buff_remove", time, actorId, targetId: "enemy",
            buffId: p.buffId, buffName: p.buffId, target: "enemy",
            stacks: 0, duration: 0, reason: "consumed",
          });
        }
        break;
      }

      case "consume_attachment": {
        const p = effect.params as { element?: MagicElement };
        if (enemy.attachment.element && (!p.element || enemy.attachment.element === p.element)) {
          const prevElement = enemy.attachment.element;
          const prevStacks = enemy.attachment.stacks;
          enemy.attachment = { element: null, stacks: 0, expiresAt: 0 };
          emit({
            type: "attachment_change", time, sourceId: actorId,
            element: null, stacks: 0,
            prevElement, prevStacks,
          });
          hitTriggerEvents?.push({
            type: "attachment_consumed", time, sourceActorId: actorId,
            data: { consumedElement: prevElement, consumedStacks: prevStacks },
          });
        }
        break;
      }

      case "delayed_damage": {
        // Emit a damage event at time + delay, resolved with current state.
        // `multiplier` / `multiplierRef` / `multiplierFromTalent` all accept a
        // ValueSource so trigger actions can scale damage by event.stacks etc.
        const p = effect.params as {
          delay?: ValueSource;
          multiplier?: ValueSource;
          multiplierRef?: ValueSource;
          /** Resolve multiplier from a talent id (e.g. "talent_1"). Honoured when no literal/ref present. */
          multiplierFromTalent?: ValueSource;
          stagger?: ValueSource;
          element?: DamageElement;
          school?: DamageSchool;
        };
        const delay = rv(p.delay, 0);
        const mult = rv(p.multiplier, 0)
          || rv(p.multiplierRef, 0)
          || rv(p.multiplierFromTalent, 0);
        const dmgTime = time + delay;

        if (mult > 0) {
          const buffMods = getBuffModifiers(actorId, time);
          const ctx: DamageContext = {
            source: { buildStats: build.buildStats, buffModifiers: buffMods },
            target: {
              defenseMultiplier: enemyConfig.defenseMultiplier,
              resistPhysical: enemyConfig.basePhysicalResist,
              resistBlaze: enemyConfig.baseMagicResist,
              resistEmag: enemyConfig.baseMagicResist,
              resistCold: enemyConfig.baseMagicResist,
              resistNature: enemyConfig.baseMagicResist,
              resistReduction: enemy.resistReduction,
              isStaggered: enemy.isStaggered,
              vulnerability: enemy.vulnerability,
              physicalFragility: enemy.getPhysicalFragility(dmgTime),
              magicFragility: enemy.magicFragility,
              elementFragility: { ...enemy.elementFragility },
            },
            multiplier: mult,
            element: p.element || build.element,
            school: p.school || "physical",
            sourceType: "skill",
            canCrit: true,
            critMode: config.critMode,
            rng,
          };
          const result = resolveDamage(ctx);
          emit({
            type: "damage", time: dmgTime,
            sourceId: actorId, targetId: "boss",
            damage: result.finalDamage, multiplier: mult,
            stagger: rv(p.stagger, 0), isCrit: result.isCrit,
            element: p.element || build.element,
            school: p.school || "physical",
            actionId, hitIndex,
            fromTrigger: true,
            triggerName: (effect.params as any).triggerName || "追加攻击",
          });
        }
        break;
      }

      case "sp_consume": {
        const p = effect.params as { amount: number };
        if (p.amount > 0) {
          sp.consume(p.amount);
          const snap = sp.snapshot();
          emit({
            type: "sp_change", time, actorId, change: -p.amount,
            spType: "true",
            currentTrueSP: snap.trueSP, currentRefundSP: snap.refundSP, currentTotal: snap.total,
            reason: "effect_consume", sourceId: actionId,
          });
        }
        break;
      }

      default:
        // Unknown effect type — skip silently
        break;
    }
  }
} // end simulate
