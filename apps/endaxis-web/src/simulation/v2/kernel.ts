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
import { BuffManager, StackBuffTracker, selectVariant, applyVariant, type ConditionState, type BuffDef } from "./effects";
import { getBuffMeta } from "../data/buffMetadata";
import { TriggerProcessor, type TriggerEvent, type TriggerState } from "./triggers";

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
/** Action type priority for interrupt system. */
const ACTION_PRIORITY: Record<string, number> = {
  attack: 1, skill: 2, link: 3, dodge: 4, ultimate: 5, execution: 5,
};

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
  physicalFragility: number = 0;    // 物理脆弱 (%)
  magicFragility: number = 0;       // 法术脆弱 (%)
  elementFragility: Record<DamageElement, number> = {
    physical: 0, blaze: 0, cold: 0, emag: 0, nature: 0,
  };
  resistReduction: number = 0;      // 抗性削减

  buffManager = new BuffManager();

  advanceTime(time: number): { attachmentExpired?: { element: MagicElement; stacks: number; expiresAt: number }; breakExpired?: boolean; staggerExpired?: boolean } {
    const changes: { attachmentExpired?: { element: MagicElement; stacks: number; expiresAt: number }; breakExpired?: boolean; staggerExpired?: boolean } = {};
    // Expire attachment
    if (this.attachment.element && time >= this.attachment.expiresAt) {
      changes.attachmentExpired = { element: this.attachment.element, stacks: this.attachment.stacks, expiresAt: this.attachment.expiresAt };
      this.attachment = { element: null, stacks: 0, expiresAt: 0 };
    }
    // Expire break
    if (this.breakStacks > 0 && time >= this.breakExpiresAt) {
      changes.breakExpired = true;
      this.breakStacks = 0;
    }
    // Expire stagger state
    if (this.isStaggered && time >= this.staggerEndTime) {
      changes.staggerExpired = true;
      this.isStaggered = false;
      this.stagger = 0;
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

export function simulate(
  builds: CharacterBuild[],
  skills: PlacedSkill[],
  enemyConfig: EnemyConfig,
  config: KernelConfig,
  triggersByActor?: Map<string, PassiveTrigger[]>,
): SimulationResult {
  const events: SimEvent[] = [];
  const emit = (e: SimEvent) => events.push(e);
  const rng = config.rng || Math.random;
  const resolveRef = config.resolveRef || (() => 0);

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

  // ── Sort skills by start time ──
  const sorted = [...skills].sort((a, b) => a.startTime - b.startTime);

  // ── Validation state ──
  let validationError: ValidationError | undefined;
  const validate = config.validateConditions ?? false;

  // ── Track active actions per actor (for interrupt system) ──
  const activeActions = new Map<string, { placed: PlacedSkill; skill: Skill; endTime: number }>();
  // Track link cooldowns per actor: Map<actorId, cooldownExpiresAt>
  const linkCooldowns = new Map<string, number>();

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

  // ── Phase A: Process each skill (skill-level ops + collect hits) ──
  for (const placed of sorted) {
    if (validationError) break; // stop processing after first error

    const { actionId, actorId, startTime } = placed;
    let skill = placed.skill;
    const build = buildMap.get(actorId);
    if (!build) continue;

    const time = startTime;
    const skillPriority = ACTION_PRIORITY[skill.type] || 0;

    // Advance enemy state + emit expiry events
    const expiryChanges = enemy.advanceTime(time);
    if (expiryChanges.attachmentExpired) {
      emit({ type: "attachment_change", time: expiryChanges.attachmentExpired.expiresAt, element: null, stacks: 0, prevElement: expiryChanges.attachmentExpired.element, prevStacks: expiryChanges.attachmentExpired.stacks });
    }
    if (expiryChanges.breakExpired) {
      emit({ type: "break_change", time, stacks: 0, prevStacks: 0 });
    }
    if (expiryChanges.staggerExpired) {
      emit({ type: "stagger_change", time, amount: 0, total: 0, maxStagger: enemyConfig.maxStagger, nodeReached: false, isFullStagger: false });
    }
    // Advance SP regen to action start
    sp.advanceRegen(time);

    // ── 0a. Interrupt check ──
    // If this actor has an active action, check priority
    const activeAct = activeActions.get(actorId);
    if (activeAct && time < activeAct.endTime) {
      const activePriority = ACTION_PRIORITY[activeAct.skill.type] || 0;
      if (skillPriority <= activePriority) {
        // Cannot interrupt: lower or equal priority → skip this action
        continue;
      }
      // Higher priority → interrupt the active action at this time
      // (hits with offset >= interrupt time won't execute — handled in Phase 3 loop)
      activeAct.endTime = time; // truncate
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

      // Gauge charge from trueSP consumed → all actors
      if (consumed.trueSPConsumed > 0) {
        for (const [aid, gauge] of gauges) {
          const actorBuild = buildMap.get(aid);
          if (!actorBuild) continue;
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

    // Team gauge gain on cast
    if (skill.teamGaugeGain && skill.teamGaugeGain > 0) {
      for (const [aid, gauge] of gauges) {
        if (aid === actorId) continue;
        const actorBuild = buildMap.get(aid);
        if (!actorBuild) continue;
        const gain = computeDirectGaugeGain(skill.teamGaugeGain, actorBuild.stats.ultChargeEff);
        const actual = gauge.modify(gain, time);
        if (actual !== 0) {
          emit({
            type: "gauge_change", time, actorId: aid,
            change: actual, gauge: gauge.getGauge(),
            reason: "team_gauge_gain",
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

    // ── 3. Collect hits for global processing ──
    const effectiveEnd = activeActions.get(actorId)?.endTime ?? (startTime + skill.duration);
    for (let hitIdx = 0; hitIdx < skill.hits.length; hitIdx++) {
      const hit = skill.hits[hitIdx];
      const hitTime = startTime + hit.offset;
      if (hitTime >= effectiveEnd) break;
      globalHits.push({ hit, hitTime, hitIdx, actorId, actionId, build, skill, selectedVariant });
    }

    // ── 4. Action end ──
    const endTime = startTime + skill.duration;

    // Track link cooldown
    if (skill.type === "link" && skill.cooldown > 0) {
      linkCooldowns.set(actorId, endTime + skill.cooldown);
    }

    emit({
      type: "action_end", time: endTime, actorId, actionId,
      skillType: skill.type,
      variantId: selectedVariant?.id,
    });
  }

  // ═════════════════════════════════════════════════════════════════
  // Phase B: Process all hits globally sorted by absolute time
  // ═════════════════════════════════════════════════════════════════

  globalHits.sort((a, b) => a.hitTime - b.hitTime);

  for (const { hit, hitTime, hitIdx, actorId, actionId, build, skill } of globalHits) {
    if (validationError) break;

    // Advance SP regen to hit time
    sp.advanceRegen(hitTime);
    // Advance enemy state + emit expiry events
    const hitExpiryChanges = enemy.advanceTime(hitTime);
    if (hitExpiryChanges.attachmentExpired) {
      emit({ type: "attachment_change", time: hitExpiryChanges.attachmentExpired.expiresAt, element: null, stacks: 0, prevElement: hitExpiryChanges.attachmentExpired.element, prevStacks: hitExpiryChanges.attachmentExpired.stacks });
    }

      // Queues populated during effect processing
      const effectDamages: EffectDamage[] = [];
      const deferredActions: (() => void)[] = [];
      const hitTriggerEvents: TriggerEvent[] = []; // trigger events from Phase 1 effects

      // ── Phase 1: Effects ──
      // Process hit effects. Effects may push sub-damages into effectDamages
      // and cleanup actions into deferredActions.
      for (const effect of hit.effects) {
        processEffect(effect, actorId, actionId, hitTime, hitIdx, build, emit, effectDamages, deferredActions, hitTriggerEvents);
      }

      // ── Phase 2: Effect-generated damages ──
      // Resolve damages produced by effects (slam, crystal shatter, etc.).
      // Enemy state from before deferred cleanup still applies (e.g., fragility buffs).
      for (const eDmg of effectDamages) {
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
            physicalFragility: enemy.physicalFragility,
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

      // ── Phase 3: Deferred actions ──
      // Consumption cleanup, talent buff application, etc.
      // After this phase, consumed buffs are gone and new buffs are active.
      for (const action of deferredActions) {
        action();
      }

      // ── Phase 4: Hit's own damage ──
      // Resolved last — sees post-deferred state.
      if (hit.damage) {
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
            physicalFragility: enemy.physicalFragility,
            magicFragility: enemy.magicFragility,
            elementFragility: { ...enemy.elementFragility },
          },
          multiplier: hit.damage.multiplier,
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
          damage: result.finalDamage, multiplier: hit.damage.multiplier,
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

      // ── Phase 5: Trigger evaluation ──
      // Fire trigger events based on what happened during this hit.
      const trigState = buildTriggerState(actorId, hitTime);

      // Effect-originated triggers (from Phase 1)
      for (const te of hitTriggerEvents) {
        fireTriggers(te, trigState, actorId, actionId, hitTime, build);
      }

      // Damage trigger (from Phase 4)
      if (hit.damage) {
        const sourceType = hit.damage.sourceType;
        const hitDmgEvent: TriggerEvent = { type: "hit_damage", time: hitTime, sourceActorId: actorId, data: { actionType: sourceType } };
        fireTriggers(hitDmgEvent, trigState, actorId, actionId, hitTime, build);

        // Action-type-specific trigger
        const typeMap: Record<string, string> = { attack: "attack_hit", skill: "skill_hit", link: "link_hit", ultimate: "ultimate_hit", execution: "execution_hit" };
        const specificType = typeMap[sourceType];
        if (specificType) {
          fireTriggers({ type: specificType as any, time: hitTime, sourceActorId: actorId, data: {} }, trigState, actorId, actionId, hitTime, build);
        }

        // Heavy attack trigger: last hit of an attack-type skill with stagger > 0
        if (sourceType === "attack" && hit.damage.stagger > 0 && hitIdx === skill.hits.length - 1) {
          fireTriggers({ type: "heavy_attack_hit", time: hitTime, sourceActorId: actorId, data: {} }, trigState, actorId, actionId, hitTime, build);
        }

        // Stagger trigger
        if (hit.damage.stagger > 0) {
          fireTriggers({ type: "stagger_increased", time: hitTime, sourceActorId: actorId, data: {} }, trigState, actorId, actionId, hitTime, build);
        }
      }

      // Flush deferred triggers (幻影追击 etc.)
      const deferredEffects = triggerProc.flushDeferred();
      for (const eff of deferredEffects) {
        processEffect(eff, actorId, actionId, hitTime, hitIdx, build, emit, effectDamages, deferredActions);
      }
  }  // end globalHits for loop

  // ── Final expiry sweep: expire any remaining timed states ──
  const finalExpiry = enemy.advanceTime(Infinity);
  if (finalExpiry.attachmentExpired) {
    emit({ type: "attachment_change", time: finalExpiry.attachmentExpired.expiresAt, element: null, stacks: 0, prevElement: finalExpiry.attachmentExpired.element, prevStacks: finalExpiry.attachmentExpired.stacks });
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

  /** Fire triggers for an event; immediate effects are processed inline. */
  function fireTriggers(
    event: TriggerEvent,
    state: TriggerState,
    actorId: string,
    actionId: string,
    time: number,
    build: CharacterBuild,
  ): void {
    state.event = event;
    const immediateEffects = triggerProc.processEvent(event, state);
    // Process immediate trigger effects (these may produce damage, buffs, etc.)
    const trigEffectDamages: EffectDamage[] = [];
    const trigDeferredActions: (() => void)[] = [];
    const noTriggerEvents: TriggerEvent[] = []; // don't cascade triggers from triggers
    for (const eff of immediateEffects) {
      processEffect(eff, actorId, actionId, time, 0, build, emit, trigEffectDamages, trigDeferredActions, noTriggerEvents);
    }
    // Resolve trigger-originated damages immediately
    for (const eDmg of trigEffectDamages) {
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
          physicalFragility: enemy.physicalFragility,
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
  ): void {
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
                anomalyType, level, sourceId: actorId,
              });
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
          enemy.physicalFragility += vuln; // simplified: additive
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
        break;
      }

      case "stack_buff_apply": {
        const p = effect.params as { buffType: string; stacks: number; expiresAt?: number; durationRef?: string; maxStacks?: number };
        const tracker = stackBuffs.get(actorId);
        if (tracker) {
          // Register with correct maxStacks from params or buffMetadata
          const meta = getBuffMeta(p.buffType);
          const maxStacks = p.maxStacks || meta?.maxLayers || 4;
          tracker.register(p.buffType, maxStacks);
          const result = tracker.addStacks(p.buffType, p.stacks || 1, p.expiresAt ?? null);
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
          target?: BuffTarget | "mainControl" | "trigger_source";
          duration?: number;
          durationRef?: string;
          stat?: string;
          zone?: string;
          valueRef?: string;
          valuePerLayerRef?: string;
          maxStacks?: number;
          stackBehavior?: string;
        };
        const duration = p.duration || (p.durationRef ? resolveRef(actorId, p.durationRef) : 0) || 15;
        const buffDef: BuffDef = {
          id: p.buffId,
          name: p.buffId,
          target: (p.target === "mainControl" || p.target === "trigger_source") ? "self" : (p.target || "self"),
          duration,
          maxStacks: p.maxStacks || 1,
          stackBehavior: (p.stackBehavior as any) || "refresh",
          modifiers: [], // stat modifiers resolved from zone/valueRef if present
        };

        // Determine target BuffManager
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
          }
        } else if (targetStr === "team") {
          for (const [aid, mgr] of actorBuffs) {
            const cloneDef = { ...buffDef, target: "self" as BuffTarget };
            mgr.apply(cloneDef, actorId, time);
          }
          emit({
            type: "buff_apply", time, actorId, targetId: "team",
            buffId: p.buffId, buffName: p.buffId, target: "team",
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
        // Emit a damage event at time + delay, resolved with current state
        const p = effect.params as {
          delay?: number;
          multiplier?: number;
          multiplierRef?: string;
          stagger?: number;
          element?: DamageElement;
          school?: DamageSchool;
        };
        const delay = p.delay || 0;
        const mult = p.multiplier || (p.multiplierRef ? resolveRef(actorId, p.multiplierRef) / 100 : 0);
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
              physicalFragility: enemy.physicalFragility,
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
            stagger: p.stagger || 0, isCrit: result.isCrit,
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
