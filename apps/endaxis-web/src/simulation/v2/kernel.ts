/**
 * V2 Layer 2: Simulation Kernel
 *
 * Main entry point. Receives character builds + skill sequence,
 * processes each skill's hits in order, produces EventLog.
 *
 * Processing per skill:
 *   1. Variant selection (if conditions defined)
 *   2. Action start (SP cost, gauge cost, regen pause)
 *   3. For each hit (in checkpoint order):
 *      a. Effects first (attachments, anomalies, buffs, SP restore, etc.)
 *      b. Damage second (if hit has damage)
 *      c. Stagger update (if damage has stagger)
 *   4. Action end
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
  DamageElement,
  MagicElement,
  AnomalyType,
  ActionType,
  BuffTarget,
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
import { BuffManager, StackBuffTracker, selectVariant, applyVariant, type ConditionState } from "./effects";

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
export interface KernelConfig {
  initialSP: number;
  critMode: "real" | "expected";
  rng?: () => number;
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

  advanceTime(time: number): void {
    // Expire attachment
    if (this.attachment.element && time >= this.attachment.expiresAt) {
      this.attachment = { element: null, stacks: 0, expiresAt: 0 };
    }
    // Expire break
    if (this.breakStacks > 0 && time >= this.breakExpiresAt) {
      this.breakStacks = 0;
    }
    // Expire stagger state
    if (this.isStaggered && time >= this.staggerEndTime) {
      this.isStaggered = false;
      this.stagger = 0;
    }
    // Sweep buff expiry
    this.buffManager.sweepExpired(time);
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
): SimulationResult {
  const events: SimEvent[] = [];
  const emit = (e: SimEvent) => events.push(e);
  const rng = config.rng || Math.random;

  // ── Initialize state ──
  const sp = new SpState(config.initialSP);
  const gauges = new Map<string, GaugeState>();
  const actorBuffs = new Map<string, BuffManager>();
  const stackBuffs = new Map<string, StackBuffTracker>();
  const buildMap = new Map<string, CharacterBuild>();

  for (const build of builds) {
    buildMap.set(build.id, build);
    gauges.set(build.id, new GaugeState(0, build.gaugeMax));
    actorBuffs.set(build.id, new BuffManager());
    stackBuffs.set(build.id, new StackBuffTracker());
  }

  const enemy = new EnemyState();

  // ── Sort skills by start time ──
  const sorted = [...skills].sort((a, b) => a.startTime - b.startTime);

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

  // ── Process each skill ──
  for (const placed of sorted) {
    const { actionId, actorId, startTime } = placed;
    let skill = placed.skill;
    const build = buildMap.get(actorId);
    if (!build) continue;

    const time = startTime;

    // Advance enemy state
    enemy.advanceTime(time);

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

    // ── 3. Process hits ──
    for (let hitIdx = 0; hitIdx < skill.hits.length; hitIdx++) {
      const hit = skill.hits[hitIdx];
      const hitTime = startTime + hit.offset;

      // Advance SP regen to hit time
      sp.advanceRegen(hitTime);
      // Advance enemy state
      enemy.advanceTime(hitTime);

      // ── 3a. Effects first ──
      for (const effect of hit.effects) {
        processEffect(effect, actorId, actionId, hitTime, hitIdx, build, emit);
      }

      // ── 3b. Damage second ──
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

        // ── 3c. Stagger ──
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
    }

    // ── 4. Action end ──
    const endTime = startTime + skill.duration;
    sp.advanceRegen(endTime);

    emit({
      type: "action_end", time: endTime, actorId, actionId,
      skillType: skill.type,
      variantId: selectedVariant?.id,
    });
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
  };

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
  ): void {
    switch (effect.type) {
      case "magic_attachment": {
        const p = effect.params as { element: DamageElement; stacks?: number };
        const magicEl = DAMAGE_ELEMENT_TO_MAGIC[p.element];
        if (!magicEl) break;
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
              enemy.attachment.expiresAt = time + ATTACHMENT_DURATION;
              emit({
                type: "attachment_change", time,
                element: outcome.element, stacks: outcome.newStacks,
                prevElement: prev > 0 ? enemy.attachment.element : null, prevStacks: prev,
              });
            } else if (outcome.type === "burst") {
              // Burst damage (magic burst)
              const artsPower = build.stats.originiumArtsPower;
              const burstMult = magicBurstMult(outcome.stacks, artsPower);
              // Emit as anomaly damage event (simplified)
              emit({
                type: "damage", time,
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
                type: "attachment_change", time,
                element: null, stacks: 0,
                prevElement: prevEl, prevStacks,
              });
              // Apply anomaly
              const anomalyType = outcome.anomaly;
              const level = outcome.anomalyLevel;
              const duration = getAnomalyDuration(anomalyType, level);
              enemy.anomalies[anomalyType] = {
                active: true, level, expiresAt: time + duration, sourceId: actorId,
              };
              emit({
                type: "anomaly_apply", time,
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
            type: "break_change", time,
            stacks: enemy.breakStacks, prevStacks: prev,
          });
        } else if (outcome.type === "slam") {
          enemy.breakStacks = 0;
          emit({ type: "break_change", time, stacks: 0, prevStacks: outcome.breakStacksConsumed });
        } else if (outcome.type === "armorBreak") {
          enemy.breakStacks = 0;
          emit({ type: "break_change", time, stacks: 0, prevStacks: outcome.breakStacksConsumed });
          // Apply physical vulnerability
          const artsPower = build.stats.originiumArtsPower;
          const vuln = armorBreakVulnerability(outcome.breakStacksConsumed, artsPower);
          const dur = armorBreakVulnDuration(outcome.breakStacksConsumed);
          enemy.physicalFragility += vuln; // simplified: additive
        } else if (outcome.type === "launch" || outcome.type === "knockdown") {
          // Add break stacks + refresh
          const prev = enemy.breakStacks;
          enemy.breakStacks = Math.min(BREAK_MAX_STACKS, enemy.breakStacks + 1);
          enemy.breakExpiresAt = time + BREAK_DURATION;
          emit({ type: "break_change", time, stacks: enemy.breakStacks, prevStacks: prev });
        }
        break;
      }

      case "break_apply": {
        const p = effect.params as { stacks: number };
        const prev = enemy.breakStacks;
        enemy.breakStacks = Math.min(BREAK_MAX_STACKS, enemy.breakStacks + (p.stacks || 1));
        enemy.breakExpiresAt = time + BREAK_DURATION;
        emit({ type: "break_change", time, stacks: enemy.breakStacks, prevStacks: prev });
        break;
      }

      case "stack_buff_apply": {
        const p = effect.params as { buffType: string; stacks: number; expiresAt?: number };
        const tracker = stackBuffs.get(actorId);
        if (tracker) {
          const result = tracker.addStacks(p.buffType, p.stacks || 1, p.expiresAt ?? null);
          emit({
            type: "stack_change", time, actorId,
            buffType: p.buffType,
            stacks: result.current, prevStacks: result.prev,
            reason: "effect_applied",
          });
        }
        break;
      }

      case "stack_buff_consume": {
        const p = effect.params as { buffType: string; stacks: number | "all" };
        const tracker = stackBuffs.get(actorId);
        if (tracker) {
          const result = p.stacks === "all"
            ? tracker.consumeAll(p.buffType)
            : tracker.consumeStacks(p.buffType, p.stacks);
          emit({
            type: "stack_change", time, actorId,
            buffType: p.buffType,
            stacks: result.current, prevStacks: result.prev,
            reason: "effect_consumed",
          });
        }
        break;
      }

      case "sp_restore": {
        const p = effect.params as { amount: number; spType: "true" | "refund" };
        const actual = sp.restore(p.amount, p.spType || "true");
        if (actual > 0) {
          const snap = sp.snapshot();
          emit({
            type: "sp_change", time, actorId, change: actual,
            spType: p.spType || "true",
            currentTrueSP: snap.trueSP, currentRefundSP: snap.refundSP, currentTotal: snap.total,
            reason: "hit_restore", sourceId: actionId,
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
                type: "attachment_change", time,
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

      // Add more effect types as needed...
      default:
        // Unknown effect type — skip (no false positives)
        break;
    }
  }
}
