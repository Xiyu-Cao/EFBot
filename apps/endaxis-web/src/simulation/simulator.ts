import type { TeamConfig, EnemyConfig, ActorSnapshot } from "./state/types.ts";
import { createEngine } from "./engine/createEngine.ts";
import type { ResolvedTimeline, GameDatabase } from "./compiler/types.ts";
import { SCNEARIO_EFFECT_TYPE_MAP } from "./effects/scenarioAdapter.ts";
import { Effect } from "./effects/types.ts";
import { AfflictionEffectMap } from "./effects/afflictionEffectMap.ts";
import { DiagnosticCollector, type Diagnostic } from "./diagnostics.ts";
import {
  registerEquipmentPassives,
  type EquipmentConfig,
} from "./equipment/registry.ts";
import { addOrRefreshBuff, addStackWithIndependentDuration, addStackWithRefreshDuration, type DynamicBonus } from "./equipment/types.ts";
import { applySkillMultiplierOverlay, getSkillsJsonRowByLabel } from "./data/skillMultipliers.ts";
import { getSegmentIndex } from "./compiler/compileTimeline.ts";
import { registerTalentConditionals } from "./data/talentConditionalRegistry.ts";
import { calcBreachPhysVulnerability, calcConductionDebuff } from "./calculation/anomalyDamageCalc.ts";
import { buildRng, type SimulationRngOptions } from "./engine/rng.ts";
import type { LegalityPolicy, LegalityIssue } from "./legality/types.ts";
import type { MagicElement, PhysicalAnomalyType, AnomalyDebuffType } from "./anomaly/types.ts";
import { getSkillBuffZone, isRoutableSkillBuff, resolveBonuses } from "./data/skillBuffZoneRegistry.ts";
import { getBuffMeta, getBuffIcon } from "./data/buffMetadata.ts";
import { registerCarrierConsumptionHandlers, applyEndminLinkedDebuff } from "./events/carrierConsumptionHandlers.ts";
import { getMultiplierFactor, applyDurationModifier } from "./data/potentialModifiers.ts";

// ── T4: Route attachments/anomalies to new anomaly subsystem ──
// These maps replace the old EFFECT_START path for the 8 scenario effect types.
// Old path (SCNEARIO_EFFECT_TYPE_MAP → AfflictionEffectMap → EFFECT_START → ReactionRegistry)
// is retained as legacy but no longer used by the main simulation loop.
const ELEMENT_ATTACH_MAP: Record<string, MagicElement> = {
  blaze_attach: "fire",
  cold_attach: "cold",
  emag_attach: "electro",
  nature_attach: "nature",
};

const PHYSICAL_ANOMALY_MAP: Record<string, PhysicalAnomalyType> = {
  armor_break: "armorBreak",
  stagger: "slam",
  knockdown: "knockdown",
  knockup: "launch",
};

// T5: Direct anomaly application (bypass attachment → reaction chain)
// Burst types also apply element attachment (the "burst" label in gamedata
// indicates the skill deals that element's damage and applies attachment).
const ELEMENT_BURST_ATTACH_MAP: Record<string, MagicElement> = {
  blaze_burst: "fire",
  cold_burst: "cold",
  emag_burst: "electro",
  nature_burst: "nature",
};

// "burning" etc. are distinct from "blaze_attach" — they directly apply the debuff.
const DIRECT_ANOMALY_MAP: Record<string, AnomalyDebuffType> = {
  burning: "burn",
  conductive: "conduction",
  frozen: "freeze",
  corrosion: "corrosion",
};

export interface SimulateOptions {
  equipmentConfigs?: EquipmentConfig[];
  db?: GameDatabase;
  /** Control crit/proc randomness. See SimulationRngOptions. */
  rng?: SimulationRngOptions;
  /** Legality validation policy. Default: "sandbox". */
  legalityPolicy?: LegalityPolicy;
  /** Per-track unified skill levels (1-12). Used for per-level multiplier selection. */
  skillLevelMap?: Record<string, Record<string, number>>; // trackId → { attack, skill, link, ultimate → unifiedLevel }
  /** Action instanceIds whose skill multiplier should use enhancedMultipliers. */
  enhancedActionIds?: Set<string>;
  /**
   * Crit calculation mode:
   * - "real": each hit rolls crit independently (default)
   * - "expected": probability-weighted expected multiplier (deterministic)
   */
  critMode?: "real" | "expected";
}

export interface SimulationResult {
  state: ReturnType<ReturnType<typeof createEngine>["run"]>;
  simLog: ReturnType<ReturnType<typeof createEngine>["getSimLog"]>;
  diagnostics: readonly Diagnostic[];
  /** Legality issues collected during the run. */
  legalityIssues: readonly LegalityIssue[];
}

export function simulate(
  timeline: ResolvedTimeline,
  teamConfig: TeamConfig,
  enemyConfig: EnemyConfig,
  actors: ActorSnapshot[],
  options?: SimulateOptions,
): SimulationResult {
  const { equipmentConfigs, db, rng: rngOptions, legalityPolicy, enhancedActionIds, skillLevelMap } = options ?? {};

  // Single DiagnosticCollector shared by simulator setup + engine + triggers
  const diagnostics = new DiagnosticCollector();
  const engine = createEngine(teamConfig, enemyConfig, actors, timeline, diagnostics);

  // Set RNG for deterministic crit/proc rolls
  engine.rng = buildRng(rngOptions);

  // Set legality policy
  if (legalityPolicy) {
    engine.legalityPolicy = legalityPolicy;
  }

  // Set crit mode
  if (options?.critMode) {
    engine.critMode = options.critMode;
  }

  // Register equipment/weapon passives before enqueueing timeline events
  if (equipmentConfigs?.length) {
    registerEquipmentPassives(engine, equipmentConfigs, {
      db,
      diagnostics,
    });
  }

  // ── Talent/potential runtime_passive effects → permanent buffs ──
  // Registers active runtime_passive effects as permanent Effects on the actor.
  // Each supported type maps to a specific DynamicBonus zone:
  //   damage_bonus       → fragility zone (e.g., "+X% physical_dmg against target")
  //   resistance_ignore  → resistance zone (e.g., "ignore X resist points")
  for (const actor of actors) {
    try {
      const actorState = engine.state.getActor(actor.id);
      const activeEffects = (actor.stats as any)?._activeEffects;
      if (!activeEffects?.length) continue;

      const dynBonuses: DynamicBonus[] = [];

      for (const e of activeEffects) {
        // runtime_passive: always-active buffs
        if (e.scope === "runtime_passive") {
          if (e.type === "damage_bonus" && e.stat && e.value) {
            dynBonuses.push({ stat: e.stat, value: e.value, zone: "fragility" });
          } else if (e.type === "resistance_ignore" && e.value) {
            // LAEVATAIN: resistance_ignore gated by 4-magma watcher (not unconditional)
            if (actor.id === "LAEVATAIN") continue;
            dynBonuses.push({ stat: "all_dmg", value: e.value, zone: "resistance" });
          }
        }

        // static: attribute-scaling permanent buffs (e.g., LIFENG 顿悟)
        if (e.scope === "static" && e.type === "stat_bonus" && e.stat === "attack_percent" && e.scaling) {
          const { from, perPoint } = e.scaling;
          if (Array.isArray(from) && typeof perPoint === "number") {
            let total = 0;
            for (const attr of from) {
              total += (actor.stats as any)?.[attr] || 0;
            }
            dynBonuses.push({ stat: "all_dmg", value: total * perPoint, zone: "attackPercent" });
          }
        }
      }

      if (dynBonuses.length === 0) continue;

      actorState.effects.add(
        new Effect({
          id: `talent_passive_${actor.id}`,
          tags: [],
          duration: 999999, // effectively permanent
          startTime: 0,
          properties: { dynamicBonuses: dynBonuses },
        })
      );
    } catch {
      // Actor not found in state — skip silently
    }
  }

  // ── T6: Unified triggered buff registration helper ──
  // Reusable for any "event triggers a timed self/enemy buff" pattern.
  // Handles both refresh (no stack) and independent-duration stacking modes.
  let _buffCounter = 0;
  function registerTriggeredBuff(
    actorId: string,
    opts: {
      carrierId: string;
      event: string;
      condition?: (e: any, ctx: any) => boolean;
      buffId: string;
      duration: number;
      bonuses: DynamicBonus[];
      target?: "self" | "enemy" | "team";
      stack?: { group: string; max: number };
      /** Internal cooldown — passed through to TriggerProcessor's built-in cooldown. */
      cooldownId?: string;
      cooldownDuration?: number;
      /** How many stacks to add per trigger. Default 1. Only used when stack is configured. */
      stackCountFn?: (e: any, ctx: any) => number;
      /** Stack duration mode. "refresh" = new stack refreshes all stacks' duration (default). "independent" = each stack has its own timer. */
      stackMode?: "refresh" | "independent";
      /** Override sourceMustBeWearer. Default true. Set false when condition needs to observe all sources. */
      sourceMustBeWearer?: boolean;
      /** Side effect to execute after the buff is applied (e.g., consume another buff, refund SP). */
      postAction?: (e: any, ctx: any, actorId: string) => void;
    },
  ): void {
    const actorState = engine.state.getActor(actorId);
    actorState.effects.add(new Effect({
      id: opts.carrierId,
      tags: [],
      duration: 999999,
      startTime: 0,
      properties: {},
      triggers: [{
        event: opts.event as any,
        sourceMustBeWearer: opts.sourceMustBeWearer !== false,
        cooldownId: opts.cooldownId,
        cooldownDuration: opts.cooldownDuration,
        condition: opts.condition,
        action: (_e: any, ctx: any) => {
          const time = ctx.state.getCurrentTime();

          // Team buff: apply to every actor (refresh only for now)
          if (opts.target === "team") {
            for (const teammate of ctx.state.getAllActors()) {
              addOrRefreshBuff(
                teammate.effects,
                new Effect({
                  id: opts.buffId,
                  tags: [],
                  duration: opts.duration,
                  startTime: time,
                  properties: { dynamicBonuses: opts.bonuses },
                }),
              );
            }
            ctx.simLog({
              type: "WEAPON_BUFF_APPLIED",
              time,
              payload: {
                actorId,
                buffName: opts.buffId,
                target: "team",
                duration: opts.duration,
                stacks: 1,
                maxStacks: opts.stack?.max ?? 1,
                weaponId: opts.carrierId,
                triggerAction: opts.event,
              },
            });
            if (opts.postAction) opts.postAction(_e, ctx, actorId);
            return;
          }

          const targetEffects = opts.target === "enemy"
            ? ctx.state.enemy.effects
            : ctx.state.getActor(actorId).effects;

          if (opts.stack) {
            const count = opts.stackCountFn ? opts.stackCountFn(_e, ctx) : 1;
            const addStackFn = opts.stackMode === "independent"
              ? addStackWithIndependentDuration
              : addStackWithRefreshDuration;
            for (let i = 0; i < count; i++) {
              _buffCounter++;
              addStackFn(
                targetEffects,
                new Effect({
                  id: `${opts.buffId}_${_buffCounter}`,
                  tags: [],
                  duration: opts.duration,
                  startTime: time,
                  properties: {
                    dynamicBonuses: opts.bonuses,
                    stackGroup: opts.stack.group,
                  },
                }),
                opts.stack.group,
                opts.stack.max,
                time,
              );
            }
          } else {
            addOrRefreshBuff(
              targetEffects,
              new Effect({
                id: opts.buffId,
                tags: [],
                duration: opts.duration,
                startTime: time,
                properties: { dynamicBonuses: opts.bonuses },
              }),
            );
          }

          ctx.simLog({
            type: "WEAPON_BUFF_APPLIED",
            time,
            payload: {
              actorId,
              buffName: opts.buffId,
              target: opts.target || "self",
              duration: opts.duration,
              stacks: opts.stack ? (opts.stackCountFn ? opts.stackCountFn(_e, ctx) : 1) : 1,
              maxStacks: opts.stack?.max ?? 1,
              weaponId: opts.carrierId,
              triggerAction: opts.event,
            },
          });

          if (opts.postAction) opts.postAction(_e, ctx, actorId);
        },
      }],
    }));
  }

  // ── T5/T6: Talent runtime_conditional effects → triggered buffs ──
  // Declarative registry in data/talentConditionalRegistry.ts replaces
  // the previous per-character if-else blocks.
  registerTalentConditionals(actors, registerTriggeredBuff, diagnostics);

  // ── Carrier buff consumption handlers ──
  registerCarrierConsumptionHandlers(engine, actors, skillLevelMap);

  // ── Potential level lookup (built once, used for multiplier/duration modifiers) ──
  const potentialLevelMap = new Map<string, number>();
  for (const actor of actors) {
    potentialLevelMap.set(actor.id, (actor.stats as any)?._potentialLevel ?? 0);
  }

  // ── AVYWENNA thunderlance constants ──
  const LANCE_DURATION = 30;
  const LANCE_EFFECT_ID_NORMAL = "Thunderlances";
  const LANCE_EFFECT_ID_STRONG = "Thunderlances EX";

  // ── Deferred action map: actions with releaseConditions defer effect/tick enqueue ──
  // ActionStartHandler will evaluate conditions, select variant, then enqueue.
  const deferredActions = new Map<string, typeof timeline.actions[0]>();

  // Helper: effect dedup key (shared between _enqueueActionEffectsAndTicks and T4)
  const _effectKey = (re: { uniqueId?: string; node: { type: string }; realStartTime: number }) =>
    re.uniqueId || `${re.node.type}_${re.realStartTime}`;

  // Helper: enqueue effects + damage ticks for an action (or its selected variant)
  // Returns the set of pre-enqueued effect keys (for T4 dedup).
  function _enqueueActionEffectsAndTicks(action: typeof timeline.actions[0]): Set<string> {

    // ── ALL effects enqueue BEFORE damage ticks ──
    // 原则：先结算所有特效，再结算所有伤害。
    // 完整流程（已验证）：
    //   附着 → [触发buff] → 异常 → [触发buff] → 物理异常 → [触发buff]
    //   → 异常/消耗伤害 → 载体buff → [触发buff] → 技能伤害 + 装备伤害
    // PriorityQueue 同时间 FIFO → 效果先入队先处理。
    // ── Pre-damage: enqueue ALL event-based effects BEFORE damage ticks ──
    // 原则：先结算所有特效，再结算所有伤害（已验证）。
    // 完整流程：附着 → [触发buff] → 异常 → [触发buff] → 物理异常 → [触发buff] → 伤害
    // PriorityQueue 同帧 FIFO → 先入队先处理。
    // 载体 buff / vulnerability 等直接修改 state 的效果在 T4 循环中处理，
    // 通过 isEffectActive(startTime) 保证时序正确。
    const preEnqueuedEffects = new Set<string>();

    // Phase 1: Magic attachments (法术附着)
    for (const re of action.effects) {
      const el = ELEMENT_ATTACH_MAP[re.node.type] ?? ELEMENT_BURST_ATTACH_MAP[re.node.type];
      if (el) {
        engine.enqueue({
          type: "APPLY_MAGIC_ATTACHMENT",
          time: re.realStartTime,
          payload: { element: el, sourceActorId: action.trackId, targetId: "boss", sourceSkillId: action.node.id || "" },
        });
        preEnqueuedEffects.add(_effectKey(re));
      }
    }

    // Phase 2: Direct anomalies (法术异常)
    for (const re of action.effects) {
      const at = DIRECT_ANOMALY_MAP[re.node.type];
      if (at) {
        const level = Math.max(1, Math.min(4, re.node.stacks || 1));
        const rawDur = re.node.duration;
        let durOvr = (typeof rawDur === "number" && rawDur > 0) ? rawDur : undefined;
        const pl = potentialLevelMap.get(action.trackId) ?? 0;
        if (pl > 0 && durOvr !== undefined) durOvr = applyDurationModifier(durOvr, action.trackId, pl, at);
        engine.enqueue({
          type: "APPLY_DIRECT_ANOMALY",
          time: re.realStartTime,
          payload: { anomalyType: at, level: level as 1|2|3|4, sourceActorId: action.trackId, targetId: "boss", sourceSkillId: action.node.id || "", durationOverride: durOvr },
        });
        preEnqueuedEffects.add(_effectKey(re));
      }
    }

    // Phase 3: Physical anomalies (物理异常: stagger/knockdown/knockup/armorBreak)
    for (const re of action.effects) {
      const pt = PHYSICAL_ANOMALY_MAP[re.node.type];
      if (pt) {
        const stacks = Math.max(1, Math.min(4, re.node.stacks || 1));
        for (let s = 0; s < stacks; s++) {
          engine.enqueue({
            type: "APPLY_PHYSICAL_ANOMALY",
            time: re.realStartTime,
            payload: { physicalType: pt, sourceActorId: action.trackId, targetId: "boss", sourceSkillId: action.node.id || "" },
          });
        }
        preEnqueuedEffects.add(_effectKey(re));
      }
    }

    action.resolvedDamageTicks.forEach((tick, tickIndex) => {
      // Skip ticks in cancelled segments (dodge interruption)
      if (action.isInterrupted && action.cancelledFromSegment !== undefined) {
        const checkpoints = action.node.checkpoints || [];
        const tickSegment = getSegmentIndex(tick.offset, checkpoints);
        if (tickSegment >= action.cancelledFromSegment) return;
      }

      const isEnhanced = enhancedActionIds?.has(action.id) ?? false;
      const unifiedLevel = skillLevelMap?.[action.trackId]?.[action.node.type] ?? 12;
      const tickData = applySkillMultiplierOverlay(
        action.trackId,
        action.node.type,
        tickIndex,
        tick,
        isEnhanced,
        unifiedLevel,
        action.resolvedDamageTicks.length,
      );

      // ── Ultimate SP recovery split (终结技恢复技力分配) ──
      // For ultimates with SP recovery hits (e.g., AKEKURI), distribute total SP across ticks.
      // Rule: total / tickCount, remainder to earlier ticks.
      if (action.node.type === "ultimate" && tickData.sp === 0) {
        const spRow = getSkillsJsonRowByLabel(action.trackId, "ultimate", "恢复技力");
        if (spRow) {
          const uLevel = skillLevelMap?.[action.trackId]?.["ultimate"] ?? 12;
          const uIdx = Math.max(0, Math.min(11, uLevel - 1));
          const totalSp = parseFloat(String(spRow[uIdx] ?? "0"));
          if (totalSp > 0) {
            const tCount = action.resolvedDamageTicks.length;
            const baseSp = Math.floor(totalSp / tCount);
            const remainder = totalSp - baseSp * tCount;
            tickData.sp = baseSp + (tickIndex < remainder ? 1 : 0);
          }
        }
      }

      // ── Potential multiplier scaling (倍率×N) ──
      const pLevel = potentialLevelMap.get(action.trackId) ?? 0;
      if (pLevel > 0) {
        const pFactor = getMultiplierFactor(action.trackId, pLevel, action.node.type, tickIndex);
        if (pFactor !== 1 && tickData.multiplier) {
          tickData.multiplier *= pFactor;
        }
      }

      // If ULTIMATE tick has SP recovery (e.g., AKEKURI), enqueue SP_CHANGE as trueSP (恢复)
      // Only for ultimate ticks — other skill types use sp field for SP cost, not recovery.
      if (action.node.type === "ultimate" && tickData.sp > 0) {
        engine.enqueue({
          type: "SP_CHANGE",
          time: tick.realTime,
          payload: {
            actorId: action.trackId,
            spChange: tickData.sp,
            reason: "damage", // "damage" = trueSP, generates ult charge
            sourceId: action.id,
            parent: {} as any,
          },
        });
      }

      engine.enqueue({
        type: "DAMAGE_TICK",
        time: tick.realTime,
        payload: {
          sourceId: action.trackId,
          targetId: "boss",
          damage: 0, // will be computed by DamageHandler if multiplier > 0
          stagger: tickData.stagger,
          tickData,
          actionId: action.id,
        },
      });
    });

    return preEnqueuedEffects;
  } // end _enqueueActionEffectsAndTicks

  timeline.actions.forEach((action) => {
    engine.enqueue({
      type: "ACTION_START",
      time: action.realStartTime,
      payload: {
        skillId: action.node.id || "",
        actionId: action.id,
        spCost: action.node.spCost,
        gaugeCost: action.node.gaugeCost || 0,
        actorId: action.trackId,
        type: action.node.type,
        freezeDuration: action.freezeDuration,
        allowedTypes: action.node.allowedTypes?.length ? action.node.allowedTypes : undefined,
      },
    });

    engine.enqueue({
      type: "ACTION_END",
      time: action.realStartTime + action.realDuration,
      payload: {
        skillId: action.node.id || "",
        actionId: action.id,
        spGain: action.node.spGain,
        actorId: action.trackId,
        type: action.node.type,
      },
    });

    // Defer effect/tick enqueue for actions with releaseConditions (variant selection at runtime)
    let _currentPreEnqueued = new Set<string>();
    if (action.node.releaseConditions?.length) {
      deferredActions.set(action.id, action);
    } else {
      _currentPreEnqueued = _enqueueActionEffectsAndTicks(action);
    }

    // ── AVYWENNA thunderlance: recall (skill consumes surviving lances) ──
    // Lance creation is handled by effect routing (Route 2.9 carrierOnly).
    // Recall reads surviving lance Effects from EffectManager and enqueues damage.
    if (action.trackId === "AVYWENNA" && action.node.type === "skill") {
      const actionTime = action.realStartTime;
      const actorEffects = engine.state.getActor("AVYWENNA").effects;

      // Collect surviving lances (sweep expired first)
      actorEffects.sweepExpired(actionTime);
      const normalLances = actorEffects.removeByEffectId(LANCE_EFFECT_ID_NORMAL);
      const strongLances = actorEffects.removeByEffectId(LANCE_EFFECT_ID_STRONG);
      const allLances = [
        ...normalLances.map(() => "normal" as const),
        ...strongLances.map(() => "strong" as const),
      ];

      if (allLances.length > 0) {
        const recallTime = actionTime + 0.3;
        const unifiedLevel = skillLevelMap?.["AVYWENNA"]?.["skill"] ?? 12;
        const levelIdx = Math.max(0, Math.min(11, unifiedLevel - 1));
        const normalMultTable = getSkillsJsonRowByLabel("AVYWENNA", "skill", "雷枪伤害倍率") ?? [];
        const strongMultTable = getSkillsJsonRowByLabel("AVYWENNA", "skill", "强雷枪伤害倍率") ?? [];

        for (const lanceType of allLances) {
          const mult = lanceType === "strong"
            ? strongMultTable[levelIdx]
            : normalMultTable[levelIdx];

          engine.enqueue({
            type: "DAMAGE_TICK",
            time: recallTime,
            payload: {
              sourceId: "AVYWENNA",
              targetId: "boss",
              damage: 0,
              stagger: lanceType === "strong" ? 10 : 5,
              tickData: {
                offset: 0.3,
                realTime: recallTime,
                realOffset: 0.3,
                time: recallTime,
                multiplier: mult,
                stagger: lanceType === "strong" ? 10 : 5,
                sp: 0,
                boundEffects: [],
              },
              actionId: action.id,
            },
          });
        }
      }
    }

    // ── T4: Route action effects to the appropriate anomaly subsystem ──
    // Elemental attachments → APPLY_MAGIC_ATTACHMENT (new anomaly path)
    // Physical anomalies → APPLY_PHYSICAL_ANOMALY (new anomaly path)
    // Other effect types → legacy EFFECT_START path (retained for compatibility)
    action.effects.forEach((resolvedEffect) => {
      // Skip non-detached effects in cancelled segments (dodge interruption)
      if (action.isInterrupted && action.cancelledFromSegment !== undefined) {
        const checkpoints = action.node.checkpoints || [];
        const effectSegment = getSegmentIndex(resolvedEffect.node.offset, checkpoints);
        if (effectSegment >= action.cancelledFromSegment && !resolvedEffect.node.detached) {
          return;
        }
      }

      const effectType = resolvedEffect.node.type;

      // Route 1: Elemental attachment → new anomaly subsystem
      // Already enqueued pre-damage above — skip duplicates.
      const element = ELEMENT_ATTACH_MAP[effectType] ?? ELEMENT_BURST_ATTACH_MAP[effectType];
      if (element) {
        if (_currentPreEnqueued.has(_effectKey(resolvedEffect))) return;
        engine.enqueue({
          type: "APPLY_MAGIC_ATTACHMENT",
          time: resolvedEffect.realStartTime,
          payload: {
            element,
            sourceActorId: action.trackId,
            targetId: "boss",
            sourceSkillId: action.node.id || "",
          },
        });
        return;
      }

      // Route 2: Physical anomaly → new anomaly subsystem
      // Already enqueued pre-damage above — skip duplicates.
      const physicalType = PHYSICAL_ANOMALY_MAP[effectType];
      if (physicalType) {
        if (_currentPreEnqueued.has(_effectKey(resolvedEffect))) return;
        const incomingStacks = Math.max(1, Math.min(4, resolvedEffect.node.stacks || 1));
        engine.enqueue({
          type: "APPLY_PHYSICAL_ANOMALY",
          time: resolvedEffect.realStartTime,
          payload: {
            physicalType,
            sourceActorId: action.trackId,
            targetId: "boss",
            sourceSkillId: action.node.id || "",
            stacks: incomingStacks,
          },
        });
        return;
      }

      // Route 2.5: Direct anomaly application (burning/conductive/frozen/corrosion)
      // Already enqueued pre-damage above — skip duplicates.
      const anomalyType = DIRECT_ANOMALY_MAP[effectType];
      if (anomalyType) {
        if (_currentPreEnqueued.has(_effectKey(resolvedEffect))) return;
        const level = Math.max(1, Math.min(4, resolvedEffect.node.stacks || 1));
        // Pass duration override only if the effect node explicitly provides a positive duration
        const rawDur = resolvedEffect.node.duration;
        let durationOverride = (typeof rawDur === "number" && rawDur > 0) ? rawDur : undefined;
        // Potential duration modifier (e.g., LAEVATAIN P3 burn +50%, SNOWSHINE P3 freeze +2s)
        const pLevelAnomaly = potentialLevelMap.get(action.trackId) ?? 0;
        if (pLevelAnomaly > 0 && durationOverride !== undefined) {
          durationOverride = applyDurationModifier(durationOverride, action.trackId, pLevelAnomaly, anomalyType);
        }
        engine.enqueue({
          type: "APPLY_DIRECT_ANOMALY",
          time: resolvedEffect.realStartTime,
          payload: {
            anomalyType,
            level: level as 1 | 2 | 3 | 4,
            sourceActorId: action.trackId,
            targetId: "boss",
            sourceSkillId: action.node.id || "",
            durationOverride,
          },
        });
        return;
      }

      // Route 2.6: Direct break application (破防) — adds break stacks WITHOUT
      // triggering physical anomaly reactions. Used by CATCHER skill反击.
      if (effectType === "break") {
        const stacks = Math.max(1, Math.min(4, resolvedEffect.node.stacks || 1));
        for (let i = 0; i < stacks; i++) {
          engine.state.enemy.status.addBreakStack(resolvedEffect.realStartTime);
        }
        return;
      }

      // Route 2.6.5: Skill-applied physical_weakness → enemy physical FRAGILITY debuff
      // physical_weakness is a fragility-zone debuff (脆弱区), distinct from physical_vulnerable (易伤区).
      // Value comes from the effect node's stacks field (interpreted as percentage).
      // Used by: LIFENG skill (战技第三段命中).
      if (effectType === "physical_weakness") {
        const percent = resolvedEffect.node.stacks || 5; // default 5% if not specified
        const rawDur = resolvedEffect.node.duration;
        const duration = (typeof rawDur === "number" && rawDur > 0) ? rawDur : 10;

        addOrRefreshBuff(
          engine.state.enemy.effects,
          new Effect({
            id: "PHYSICAL_WEAKNESS",
            tags: [],
            duration,
            startTime: resolvedEffect.realStartTime,
            properties: {
              dynamicBonuses: [{ stat: "physical_dmg", value: percent, zone: "fragility" }] as DynamicBonus[],
              sourceActorId: action.trackId,
            },
          }),
        );
        return;
      }

      // Route 2.7: Skill-applied physical_vulnerable → enemy PHYSICAL_VULNERABLE debuff
      // Uses existing tag+physVulnPercent mechanism consumed by computeVulnerabilityZone.
      // ESTELLA: conditional on frozen target — check frameSnapshot at compile time.
      if (effectType === "physical_vulnerable") {
        // ESTELLA: conditional on frozen target
        if (action.trackId === "ESTELLA") {
          // Check frozen state at effect time (use engine state since this runs at compile time)
          const isFrozen = engine.state.enemy.status.isFrozen(resolvedEffect.realStartTime);
          if (!isFrozen) return; // skip if target not frozen
          // Use ESTELLA-specific values from skills.json
          const skillType = action.node.type;
          const unifiedLevel = skillLevelMap?.[action.trackId]?.[skillType] ?? 12;
          const levelIdx = Math.max(0, Math.min(11, unifiedLevel - 1));
          const vulnRow = getSkillsJsonRowByLabel("ESTELLA", skillType, "物理脆弱倍率") ?? [];
          const durRow = getSkillsJsonRowByLabel("ESTELLA", skillType, "物理脆弱持续时间") ?? [];
          let vulnPct = parseFloat(String(vulnRow[levelIdx] ?? "15").replace("%", ""));
          let vulnDur = parseFloat(String(durRow[levelIdx] ?? "6"));
          // P1 (习惯性延误): +3s
          const pLevelEstella = potentialLevelMap.get("ESTELLA") ?? 0;
          if (pLevelEstella > 0) {
            vulnDur = applyDurationModifier(vulnDur, "ESTELLA", pLevelEstella, "physical_vulnerable");
          }
          addOrRefreshBuff(
            engine.state.enemy.effects,
            new Effect({
              id: "PHYSICAL_VULNERABLE",
              tags: ["PHYSICAL_VULNERABLE"],
              duration: vulnDur,
              startTime: resolvedEffect.realStartTime,
              properties: { physVulnPercent: vulnPct, sourceActorId: action.trackId },
            }),
          );
          return;
        }

        // Generic physical_vulnerable (from break/breach calc)
        const stacks = Math.max(1, Math.min(4, resolvedEffect.node.stacks || 1));
        let artsPower = 0;
        try {
          artsPower = engine.state.getActor(action.trackId).snapshotData.stats.originium_arts_power || 0;
        } catch { /* actor not found */ }
        const vuln = calcBreachPhysVulnerability(stacks, artsPower);
        let vulnPercent = vuln.physicalVulnerability;

        // LIFENG P1 (破执): physical_vulnerable +5%
        if (action.trackId === "LIFENG") {
          const pLevel = potentialLevelMap.get("LIFENG") ?? 0;
          if (pLevel >= 1) vulnPercent += 5;
        }

        const rawDur = resolvedEffect.node.duration;
        const duration = (typeof rawDur === "number" && rawDur > 0) ? rawDur : vuln.duration;

        addOrRefreshBuff(
          engine.state.enemy.effects,
          new Effect({
            id: "PHYSICAL_VULNERABLE",
            tags: ["PHYSICAL_VULNERABLE"],
            duration,
            startTime: resolvedEffect.realStartTime,
            properties: {
              physVulnPercent: vulnPercent,
              sourceActorId: action.trackId,
            },
          }),
        );
        return;
      }

      // Route 2.8: Skill-applied spell_vulnerable → enemy fragility debuff (magic)
      // Uses dynamicBonuses on enemy.effects, consumed by aggregateEnemyZoneBonuses in fragility zone.
      // Value from calcConductionDebuff.spellVulnerability (the existing spell vulnerability formula).
      if (effectType === "spell_vulnerable") {
        const stacks = Math.max(1, Math.min(4, resolvedEffect.node.stacks || 1));
        let artsPower = 0;
        try {
          artsPower = engine.state.getActor(action.trackId).snapshotData.stats.originium_arts_power || 0;
        } catch { /* actor not found */ }
        const debuff = calcConductionDebuff(stacks as 1 | 2 | 3 | 4, artsPower);
        // PERLICA P4 (长效导流): conduction spell_vulnerable ×1.33
        const pLevelSpellVuln = potentialLevelMap.get(action.trackId) ?? 0;
        if (action.trackId === "PERLICA" && pLevelSpellVuln >= 4) {
          debuff.spellVulnerability *= 1.33;
        }
        // TANGTANG P3 (当家气魄): spell fragility +5%
        if (action.trackId === "TANGTANG" && pLevelSpellVuln >= 3) {
          debuff.spellVulnerability += 5;
        }
        const rawDur = resolvedEffect.node.duration;
        const duration = (typeof rawDur === "number" && rawDur > 0) ? rawDur : debuff.duration;

        addOrRefreshBuff(
          engine.state.enemy.effects,
          new Effect({
            id: "SPELL_VULNERABLE",
            tags: [],
            duration,
            startTime: resolvedEffect.realStartTime,
            properties: {
              dynamicBonuses: [{ stat: "arts_dmg", value: debuff.spellVulnerability, zone: "fragility" }] as DynamicBonus[],
              sourceActorId: action.trackId,
            },
          }),
        );
        return;
      }

      // Route 2.9: Skill buff zone routing (amplify, damageBonus, etc.)
      // Handles effect types registered in skillBuffZoneRegistry.ts.
      // Each entry declares its zone, stat, target, and stack behaviour.
      if (isRoutableSkillBuff(effectType)) {
        const entry = getSkillBuffZone(effectType)!;
        const rawDur = resolvedEffect.node.duration;
        let duration = (typeof rawDur === "number" && rawDur > 0)
          ? rawDur
          : (entry.defaultDuration ?? 10);
        // Potential duration modifier (e.g., DAPAN P2 备料+10s, AVYWENNA P2 雷枪+20s)
        const pLevelBuff = potentialLevelMap.get(action.trackId) ?? 0;
        if (pLevelBuff > 0) {
          duration = applyDurationModifier(duration, action.trackId, pLevelBuff, effectType);
        }

        // Carrier-only buffs: create marker Effect with no DynamicBonus.
        // Used for mode/trigger carriers (e.g., 支援晶体, 雷枪, 熔火).
        if (entry.carrierOnly) {
          const targetEffects = entry.target === "enemy"
            ? engine.state.enemy.effects
            : engine.state.getActor(action.trackId).effects;
          const stacks = Math.max(1, resolvedEffect.node.stacks || 1);
          const meta = getBuffMeta(effectType);

          const makeCarrier = () => new Effect({
            id: effectType,
            name: meta?.name ?? effectType,
            tags: [],
            duration,
            startTime: resolvedEffect.realStartTime,
            properties: {
              sourceActorId: action.trackId,
              icon: meta?.icon,
              layerDisplay: meta?.layerDisplay,
              layerIcons: meta?.layerIcons,
            },
          });

          if (entry.stackBehaviour === "independent") {
            // Clear existing layers first (re-cast refreshes to full stacks)
            targetEffects.removeByEffectId(effectType);
            for (let i = 0; i < stacks; i++) {
              targetEffects.add(makeCarrier());
            }
          } else {
            addOrRefreshBuff(targetEffects, makeCarrier());
          }

          // ── Phase 2.3: Update self-buff stacks + emit simLog ──
          if (entry.target !== "enemy") {
            const actor = engine.state.getActor(action.trackId);
            const prefix = effectType.replace(/_\d+$/, "");
            const { prev, current } = actor.addSelfBuffStacks(prefix, stacks);
            engine.emitLog({
              type: "SELF_BUFF_CHANGE",
              time: resolvedEffect.realStartTime,
              payload: {
                actorId: action.trackId,
                buffType: prefix,
                stacks: current,
                prevStacks: prev,
                reason: "effect_applied",
              },
            });
          }

          // ── Phase 2.3: blaze_to_magma conversion ──
          if (effectType === "blaze_to_magma") {
            const actor = engine.state.getActor(action.trackId);
            const blazeStacks = engine.state.enemy.status.getMagicStacks?.() ?? 0;
            const blazeElement = engine.state.enemy.status.getMagicElement?.();
            if (blazeElement === "fire" && blazeStacks > 0) {
              const canAdd = 4 - actor.getSelfBuffStacks("magma");
              const amount = Math.min(blazeStacks, canAdd);
              if (amount > 0) {
                engine.state.enemy.status.clearMagicAttachment?.();
                const { prev, current } = actor.addSelfBuffStacks("magma", amount);
                engine.emitLog({
                  type: "SELF_BUFF_CHANGE",
                  time: resolvedEffect.realStartTime,
                  payload: { actorId: action.trackId, buffType: "magma", stacks: current, prevStacks: prev, reason: "blaze_to_magma" },
                });
                engine.emitLog({
                  type: "CONVERT_EVENT",
                  time: resolvedEffect.realStartTime,
                  payload: { actorId: action.trackId, sourceElement: "fire", targetBuff: "magma", amount },
                });
              }
            }
            return;
          }

          // Post-creation hooks for specific carriers
          if (effectType === "endmin_debuff") {
            // Talent 1 (现实静滞): apply linked physical vulnerability while crystal exists
            const hookCtx: SimulationContext = {
              state: engine.state, queue: { enqueue: (ev: any) => engine.enqueue(ev) },
              simLog: () => {}, getAction: () => undefined, diagnostics,
              rng: () => 0, legalityPolicy: "sandbox", legalityIssues: [], blockedActionIds: new Set(),
            };
            applyEndminLinkedDebuff(hookCtx);
          }

          return;
        }

        // Resolve bonuses — supports multi-bonus entries (e.g., antal_buff = emag + blaze fragility)
        const descriptors = resolveBonuses(entry);
        const skillType = action.node.type;
        const unifiedLevel = skillLevelMap?.[action.trackId]?.[skillType] ?? 12;
        const levelIdx = Math.max(0, Math.min(11, unifiedLevel - 1));

        const bonuses: DynamicBonus[] = [];
        for (const desc of descriptors) {
          let value = desc.fixedValue ?? (resolvedEffect.node.stacks || 0);
          if (!desc.fixedValue && desc.valueLabel) {
            const row = getSkillsJsonRowByLabel(action.trackId, skillType, desc.valueLabel);
            if (row && row[levelIdx] !== undefined) {
              value = parseFloat(String(row[levelIdx]).replace("%", ""));
            }
          }
          if (value <= 0) {
            diagnostics.warn(
              "SKILL_BUFF_ZERO_VALUE",
              `Skill buff "${effectType}" bonus "${desc.valueLabel}" for ${action.trackId} resolved to value 0`,
              { actorId: action.trackId, effectType },
            );
          }
          bonuses.push({ stat: desc.stat, value, zone: desc.zone });
        }

        // ── Potential buff value modifiers ──
        if (pLevelBuff > 0 && bonuses.length > 0) {
          for (const b of bonuses) {
            // ANTAL P1 (术法天分): antal_buff amplify ×1.1
            if (action.trackId === "ANTAL" && pLevelBuff >= 1
                && effectType === "antal_buff" && b.zone === "fragility") {
              // antal_buff has emag + blaze fragility; amplify is from fire_enhance/pulse_enhance
              // Actually antal_buff is fragility, not amplify. Skip.
            }
            // XAIHI P1 (敏捷实践): spell_enhance amplify +5%
            if (action.trackId === "XAIHI" && pLevelBuff >= 1
                && effectType === "spell_enhance" && b.zone === "amplify") {
              b.value += 5;
            }
            // XAIHI P5 (可控递归): ultimate amplify buffs ×1.1
            if (action.trackId === "XAIHI" && pLevelBuff >= 5
                && skillType === "ultimate" && b.zone === "amplify") {
              b.value *= 1.1;
            }
          }
          // ANTAL P1 (术法天分): fire_enhance/pulse_enhance amplify ×1.1
          if (action.trackId === "ANTAL" && pLevelBuff >= 1
              && (effectType === "fire_enhance" || effectType === "pulse_enhance")) {
            for (const b of bonuses) {
              if (b.zone === "amplify") b.value *= 1.1;
            }
          }
        }

        const meta = getBuffMeta(effectType);
        const buffEffect = new Effect({
          id: `${effectType}_${action.trackId}`,
          name: meta?.name ?? effectType,
          tags: [],
          duration,
          startTime: resolvedEffect.realStartTime,
          properties: {
            dynamicBonuses: bonuses,
            sourceActorId: action.trackId,
            icon: meta?.icon,
          },
        });

        if (entry.target === "team") {
          // Independent buff on each team member (co-existing, not overwriting)
          for (const actor of engine.state.getAllActors()) {
            if (entry.stackBehaviour === "independent") {
              actor.effects.add(buffEffect.clone());
            } else {
              addOrRefreshBuff(actor.effects, buffEffect.clone());
            }
          }
        } else if (entry.target === "enemy") {
          if (entry.stackBehaviour === "independent") {
            engine.state.enemy.effects.add(buffEffect);
          } else {
            addOrRefreshBuff(engine.state.enemy.effects, buffEffect);
          }
        } else {
          // source (self)
          const actorEffects = engine.state.getActor(action.trackId).effects;
          if (entry.stackBehaviour === "independent") {
            actorEffects.add(buffEffect);
          } else {
            addOrRefreshBuff(actorEffects, buffEffect);
          }
        }
        return;
      }

      // Route 3: Legacy fallback for any other effect types
      const tag =
        SCNEARIO_EFFECT_TYPE_MAP[
          effectType as keyof typeof SCNEARIO_EFFECT_TYPE_MAP
        ];

      if (!tag) {
        diagnostics.warn(
          "UNKNOWN_EFFECT_TYPE",
          `Effect type "${effectType}" has no mapping and was skipped.`,
          {
            actionId: action.id,
            effectType,
            actorId: action.trackId,
          },
        );
        return;
      }

      const effect = AfflictionEffectMap[tag].clone();
      effect.startTime = resolvedEffect.realStartTime;

      engine.enqueue({
        type: "EFFECT_START",
        time: effect.startTime,
        payload: {
          actorId: action.trackId,
          actionId: action.id,
          targetId: "boss",
          effect: effect.snapshot(),
        },
      });
    });
  });

  // Phase 2: pass deferred action map and enqueue function to engine context
  engine.deferredActions = deferredActions;
  engine.enqueueActionEffects = _enqueueActionEffectsAndTicks;

  const state = engine.run();
  const simLog = engine.getSimLog();

  return {
    state,
    simLog,
    diagnostics: diagnostics.getAll(),
    legalityIssues: engine.getLegalityIssues(),
  };
}
