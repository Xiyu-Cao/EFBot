/**
 * Talent conditional registry — maps actorId to trigger descriptors.
 *
 * Replaces the per-character if-else blocks in simulator.ts with a
 * declarative lookup table.  Each entry describes:
 *   - which effect to pick from _activeEffects (by type + stat)
 *   - how to register the triggered buff (event, condition, duration, stack, ICD)
 *   - how to map effect.value to DynamicBonus[]
 *
 * Numeric values (buff amount) come from talents.json via _activeEffects (data-driven).
 * Trigger semantics (event, condition, duration, stack) are hardcoded here because
 * talents.json does not carry trigger fields — this is a known structural limitation.
 */

import type { DynamicBonus } from "../equipment/types";
import type { DiagnosticCollector } from "../diagnostics";

// ---------------------------------------------------------------------------
// Effect → DynamicBonus mapping
// ---------------------------------------------------------------------------

/**
 * Map a talent effect's type + stat + value to DynamicBonus[].
 *
 * This makes the implicit mapping (e.g., stat_bonus/attack_percent →
 * zone "attackPercent") explicit and reusable.
 *
 * Returns undefined for unsupported type/stat combos so the caller
 * can emit a diagnostic instead of silently producing wrong bonuses.
 */
export function mapEffectToBonus(
  type: string,
  stat: string,
  value: number,
): DynamicBonus[] | undefined {
  if (type === "damage_bonus") {
    // damage_bonus effects map 1:1 to DynamicBonusStat with default zone
    switch (stat) {
      case "blaze_dmg":
      case "cold_dmg":
      case "emag_dmg":
      case "nature_dmg":
      case "physical_dmg":
      case "arts_dmg":
        return [{ stat: stat as DynamicBonus["stat"], value }];
      default:
        return undefined;
    }
  }

  if (type === "stat_bonus") {
    switch (stat) {
      case "attack_percent":
        // ATK% buff → attackPercent zone (matches CHENQIANYU pattern)
        return [{ stat: "all_dmg", value, zone: "attackPercent" }];
      default:
        return undefined;
    }
  }

  // gauge_modifier and other types are not supported by this adapter
  return undefined;
}

// ---------------------------------------------------------------------------
// Trigger descriptor
// ---------------------------------------------------------------------------

interface TalentConditionalDescriptor {
  /** Which effect to pick from conditionals: match by type + stat. */
  effectMatch: { type: string; stat: string };
  /** Unique carrier ID for the permanent trigger-holding effect. */
  carrierId: string;
  /** SimEvent type to listen for. */
  event: string;
  /** Optional condition callback (shared across all registrations of this descriptor). */
  condition?: (e: any, ctx: any) => boolean;
  /**
   * Optional factory that creates a fresh condition per registration.
   * Use this when the condition needs mutable closure state (e.g., SP accumulator).
   * Takes precedence over `condition` if both are present.
   */
  conditionFactory?: () => (e: any, ctx: any) => boolean;
  /** Buff effect ID. */
  buffId: string;
  /** Buff duration in seconds. */
  duration: number;
  /** Stack config. Omit for refresh (no-stack) mode. */
  stack?: { group: string; max: number };
  /** "refresh" (default) = new stack resets all stacks' timer. "independent" = each stack has its own timer. */
  stackMode?: "refresh" | "independent";
  /** ICD — passed through to TriggerProcessor. */
  cooldownId?: string;
  cooldownDuration?: number;
  /** Buff target. Default: "self". */
  target?: "self" | "enemy" | "team";
  /**
   * Optional override for effect → bonus mapping.
   * If omitted, uses mapEffectToBonus(type, stat, value).
   */
  bonusOverride?: (value: number, actorStats: Record<string, any>) => DynamicBonus[];
  /**
   * Optional: how many stacks to add per trigger invocation.
   * Default is 1 (current behavior for all other descriptors).
   * Use this when a single event should add N stacks (e.g., DAPAN break consumption).
   * Called only when condition returns true and stack config is present.
   */
  stackCountResolver?: (e: any, ctx: any) => number;
  /**
   * Override sourceMustBeWearer on the trigger. Default: true.
   * Set to false when the condition needs to observe events from ALL sources
   * (e.g., DAPAN needs to track break stacks built by any actor, but only
   * triggers the buff when DAPAN's own slam clears the break).
   * When false, the condition MUST do its own source filtering.
   */
  sourceMustBeWearer?: boolean;
  /**
   * Optional: resolve stack.max dynamically at registration time based on potential level.
   * If omitted, uses stack.max as-is.
   */
  stackMaxResolver?: (potentialLevel: number) => number;
  /**
   * Side effect to execute after the buff is applied.
   * Use for "consume buff then grant buff" or "refund SP on trigger" patterns.
   */
  postAction?: (e: any, ctx: any, actorId: string) => void;
}

// ---------------------------------------------------------------------------
// Registry — one entry per actorId
// Each actor can have multiple descriptors (future-proof, but current actors have one each).
// ---------------------------------------------------------------------------

const TALENT_CONDITIONAL_TRIGGERS: Record<string, TalentConditionalDescriptor[]> = {
  // 正向反馈 (P1): SP recovery from skill → ATK+10%, 10s, max 5 stacks
  AKEKURI: [
    {
      effectMatch: { type: "stat_bonus", stat: "attack_percent" },
      carrierId: "talent_cond_akekuri_positive_feedback",
      event: "SP_CHANGE",
      condition: (e: any) => {
        const { spChange, reason } = e.payload ?? {};
        return typeof spChange === "number" && spChange > 0 && reason === "skill";
      },
      buffId: "akekuri_positive_feedback_stack",
      duration: 10,
      stack: { group: "akekuri_positive_feedback", max: 5 },
    },
  ],

  WULFGARD: [
    {
      effectMatch: { type: "damage_bonus", stat: "blaze_dmg" },
      carrierId: "talent_cond_wulfgard_blazing_fangs",
      event: "APPLY_DIRECT_ANOMALY",
      condition: (e: any) => e.payload?.anomalyType === "burn",
      buffId: "wulfgard_blaze_buff",
      duration: 10,
    },
  ],

  CHENQIANYU: [
    {
      effectMatch: { type: "stat_bonus", stat: "attack_percent" },
      carrierId: "talent_cond_chenqianyu_slash_edge",
      event: "DAMAGE_TICK",
      condition: (e: any, ctx: any) => {
        const action = ctx.getAction(e.payload?.actionId);
        const t = action?.node?.type;
        return t === "skill" || t === "link" || t === "ultimate";
      },
      buffId: "chenqianyu_atk_stack",
      duration: 10,
      stack: { group: "chenqianyu_slash", max: 5 },
    },
  ],

  // 勾芡: DAPAN link (slam) clears break → gain N buff stacks (N = consumed break layers)
  // physical_dmg +4/6% per stack, 10s, max 4, independent duration.
  //
  // sourceMustBeWearer: false — condition must observe ALL APPLY_PHYSICAL_ANOMALY events
  // (from any actor) to track break stacks as they build up. Only triggers the buff
  // when DAPAN's own slam/armorBreak clears the break (source check in condition).
  //
  // conditionFactory ensures closure state resets per simulate() run.
  DAPAN: [
    (() => {
      function _dapanFactory() {
        let lastBreakStacks = 0;
        let consumedStacks = 0;
        return {
          condition: (e: any, ctx: any) => {
            const pType = e.payload?.physicalType;
            const sourceId = e.payload?.sourceActorId;
            const breakState = ctx.state.enemy.status.physicalBreak;

            // For ALL events: update break stack tracking (regardless of source)
            if (breakState && breakState.stacks > 0) {
              lastBreakStacks = breakState.stacks;
            }

            // Only slam/armorBreak can clear break
            if (pType !== "slam" && pType !== "armorBreak") return false;

            // Only DAPAN's own events trigger the buff
            if (sourceId !== "DAPAN") return false;

            // After handler: break must be cleared (null)
            if (breakState !== null) return false;

            // Break was just cleared — consume tracked stacks
            if (lastBreakStacks > 0) {
              consumedStacks = lastBreakStacks;
              lastBreakStacks = 0;
              return true;
            }

            return false;
          },
          stackCount: () => {
            const count = consumedStacks;
            consumedStacks = 0;
            return count;
          },
        };
      }

      let _current: ReturnType<typeof _dapanFactory> | null = null;

      return {
        effectMatch: { type: "damage_bonus", stat: "physical_dmg" },
        carrierId: "talent_cond_dapan_gouqian",
        event: "APPLY_PHYSICAL_ANOMALY",
        sourceMustBeWearer: false, // condition handles source filtering itself
        conditionFactory: () => {
          _current = _dapanFactory();
          return _current.condition;
        },
        stackCountResolver: (_e: any, _ctx: any) => {
          return _current ? _current.stackCount() : 1;
        },
        buffId: "dapan_gouqian_stack",
        duration: 10,
        stack: { group: "dapan_gouqian", max: 4 },
      } as TalentConditionalDescriptor;
    })(),
  ],

  // 活着的旗帜: every 80 SP recovered from own skills → ATK% stack, 20s, max 3
  // SP accumulator maintained in a per-registration closure via conditionFactory.
  // NOTE: talent also grants +4/8 originium_arts_power per stack, but that stat
  // has no runtime dynamic bonus path yet — only attack_percent is consumed.
  // 委婉手段: ultimate DAMAGE_TICK → apply emag fragility debuff on enemy, 10s, no stack (refresh)
  // This is a talent-triggered enemy debuff, not a skill-intrinsic effect.
  // The fragility debuff makes the enemy take more electromagnetic damage.
  AVYWENNA: [
    {
      effectMatch: { type: "damage_bonus", stat: "emag_dmg" },
      carrierId: "talent_cond_avywenna_subtle_means",
      event: "DAMAGE_TICK",
      condition: (e: any, ctx: any) => {
        const action = ctx.getAction(e.payload?.actionId);
        return action?.node?.type === "ultimate";
      },
      buffId: "avywenna_emag_fragility",
      duration: 10,
      target: "enemy",
      // Override: route to fragility zone (脆弱区), not default damageBonus zone
      bonusOverride: (value: number) => [{ stat: "emag_dmg", value, zone: "fragility" }],
    },
  ],

  // P3 (战旗飘扬时): SP threshold 80→60, max stacks +2 (3→5)
  POGRANICHNK: [
    {
      effectMatch: { type: "stat_bonus", stat: "attack_percent" },
      carrierId: "talent_cond_pogranichnk_living_flag",
      event: "SP_CHANGE",
      conditionFactory: () => {
        let spAccumulator = 0;
        let threshold = 80;
        let maxStacks = 3;
        let resolved = false;
        return (e: any, ctx: any) => {
          if (!resolved) {
            try {
              const actor = ctx.state.getActor("POGRANICHNK");
              const pLevel = (actor.snapshotData.stats as any)?._potentialLevel ?? 0;
              if (pLevel >= 3) { threshold = 60; maxStacks = 5; }
            } catch { /* */ }
            resolved = true;
          }
          const { spChange, reason } = e.payload ?? {};
          if (typeof spChange !== "number" || spChange <= 0) return false;
          if (reason !== "skill" && reason !== "damage") return false;
          spAccumulator += spChange;
          if (spAccumulator >= threshold) {
            spAccumulator -= threshold;
            return true;
          }
          return false;
        };
      },
      buffId: "pogranichnk_morale_stack",
      duration: 20,
      stack: { group: "pogranichnk_morale", max: 3 },
      stackMode: "independent", // 每层单独计算时间
      // P3: max stacks 3→5
      stackMaxResolver: (pLevel: number) => pLevel >= 3 ? 5 : 3,
    },
  ],

  // 荒野游人: after N enhanced skill consume_conduction ticks → team emag_dmg buff
  // Bonus = intellect × perPoint (snapshot at registration), 15s, refresh (no stack).
  // P3 (歌谣): bonus ×1.3; P5 (荒野的徒从): trigger threshold 3→2.
  ARCLIGHT: [
    {
      effectMatch: { type: "damage_bonus", stat: "emag_dmg" },
      carrierId: "talent_cond_arclight_wilderness_wanderer",
      event: "DAMAGE_TICK",
      conditionFactory: () => {
        let counter = 0;
        let threshold = 3; // default; overridden at first trigger if P5 active
        let thresholdResolved = false;
        return (e: any, ctx: any) => {
          // Resolve threshold once (P5: 3→2)
          if (!thresholdResolved) {
            try {
              const actor = ctx.state.getActor("ARCLIGHT");
              const pLevel = (actor.snapshotData.stats as any)?._potentialLevel ?? 0;
              if (pLevel >= 5) threshold = 2;
            } catch { /* */ }
            thresholdResolved = true;
          }
          const bound = e.payload?.tickData?.boundEffects;
          if (!Array.isArray(bound) || !bound.includes("consume_conduction")) return false;
          counter++;
          if (counter >= threshold) {
            counter = 0;
            return true;
          }
          return false;
        };
      },
      buffId: "arclight_wilderness_wanderer",
      duration: 15,
      target: "team",
      bonusOverride: (perPoint: number, actorStats: Record<string, any>) => {
        const intellect = actorStats?.intellect || 0;
        let value = intellect * perPoint;
        // P3 (歌谣): bonus ×1.3
        const pLevel = (actorStats as any)?._potentialLevel ?? 0;
        if (pLevel >= 3) value *= 1.3;
        return [{ stat: "emag_dmg", value }];
      },
    },
  ],

  // 启动进程: link hit on cold-attached/frozen target → enemy cold fragility 7/10%, 5s
  XAIHI: [
    {
      effectMatch: { type: "damage_bonus", stat: "cold_dmg" },
      carrierId: "talent_cond_xaihi_boot_process",
      event: "DAMAGE_TICK",
      condition: (e: any, ctx: any) => {
        const action = ctx.getAction(e.payload?.actionId);
        if (action?.node?.type !== "link") return false;
        const status = ctx.state.enemy.status;
        return status.isFrozen(ctx.state.getCurrentTime()) ||
          status.getMagicElement() === "cold";
      },
      buffId: "xaihi_cold_fragility",
      duration: 5,
      target: "enemy",
      bonusOverride: (value: number) => [{ stat: "cold_dmg", value, zone: "fragility" }],
    },
  ],

  // 伏魔: on self knockdown → extra physical damage (ATK × 50/100%)
  // talents.json value is the multiplier percentage (50 or 100).
  // P5 (不懈): every 15s, the next trigger deals extra ATK×250% + 5 stagger.
  LIFENG: [
    (() => {
      let _mult = 0.5; // captured from bonusOverride call
      let _lastP5Time = -Infinity; // track last P5 bonus time

      return {
        effectMatch: { type: "stat_bonus", stat: "attack_percent" },
        carrierId: "talent_cond_lifeng_demon_subduer",
        event: "APPLY_PHYSICAL_ANOMALY",
        condition: (e: any) => {
          return e.payload?.physicalType === "knockdown" && e.payload?.sourceActorId === "LIFENG";
        },
        buffId: "lifeng_demon_subduer_proc",
        duration: 0, // instant
        bonusOverride: (value: number) => {
          _mult = value / 100;
          _lastP5Time = -Infinity; // reset on registration
          return [{ stat: "all_dmg" as const, value: 0, zone: "damageBonus" as const }];
        },
        postAction: (_e: any, ctx: any, actorId: string) => {
          const time = ctx.state.getCurrentTime();
          ctx.queue.enqueue({
            type: "DAMAGE_TICK",
            time,
            payload: {
              sourceId: actorId,
              targetId: "boss",
              damage: 0,
              stagger: 0,
              tickData: {
                offset: 0, realTime: time, realOffset: 0, time,
                multiplier: _mult,
                stagger: 0, sp: 0, boundEffects: [],
              },
              actionId: _e.payload?.actionId || "",
            },
          });

          // P5 (不懈): extra ATK×250% + 5 stagger every 15s
          try {
            const actor = ctx.state.getActor(actorId);
            const potLevel = (actor.snapshotData.stats as any)?._potentialLevel;
            if (typeof potLevel === "number" && potLevel >= 5 && time - _lastP5Time >= 15) {
              _lastP5Time = time;
              ctx.queue.enqueue({
                type: "DAMAGE_TICK",
                time,
                payload: {
                  sourceId: actorId,
                  targetId: "boss",
                  damage: 0,
                  stagger: 5,
                  tickData: {
                    offset: 0, realTime: time, realOffset: 0, time,
                    multiplier: 2.5,
                    stagger: 5, sp: 0, boundEffects: [],
                  },
                  actionId: "lifeng_p5_unyielding",
                },
              });
            }
          } catch { /* actor not found */ }
        },
      } as TalentConditionalDescriptor;
    })(),
  ],

  // 斫痕: skill DAMAGE_TICK → enemy 爪印斫痕 (fragility debuff + DoT)
  // P1: ATK 25% DoT, physical+blaze fragility +6%, 15s
  // P2: ATK 30% DoT, physical+blaze fragility +12%, 25s
  // talents.json value = ATK% for DoT (25 or 30).
  ROSSI: [
    (() => {
      function deriveParams(atkPct: number) {
        // P1(value=25) → fragility 6%, duration 15s
        // P2(value=30) → fragility 12%, duration 25s
        return atkPct <= 25
          ? { fragilityPct: 6, dotMult: atkPct / 100, dotDuration: 15 }
          : { fragilityPct: 12, dotMult: atkPct / 100, dotDuration: 25 };
      }

      let _params = { fragilityPct: 6, dotMult: 0.25, dotDuration: 15 };

      return {
        effectMatch: { type: "stat_bonus", stat: "attack_percent" },
        carrierId: "talent_cond_rossi_claw_mark",
        event: "DAMAGE_TICK",
        condition: (e: any, ctx: any) => {
          const action = ctx.getAction(e.payload?.actionId);
          return action?.node?.type === "skill";
        },
        buffId: "rossi_claw_mark_fragility",
        duration: 15, // overridden dynamically below
        target: "enemy" as const,
        bonusOverride: (value: number) => {
          _params = deriveParams(value);
          return [
            { stat: "physical_dmg" as const, value: _params.fragilityPct, zone: "fragility" as const },
            { stat: "blaze_dmg" as const, value: _params.fragilityPct, zone: "fragility" as const },
          ];
        },
        postAction: (_e: any, ctx: any, _actorId: string) => {
          // Enqueue DoT ticks: 1 per second for dotDuration, physical damage
          const time = ctx.state.getCurrentTime();
          const { dotMult, dotDuration } = _params;
          for (let i = 1; i <= dotDuration; i++) {
            ctx.queue.enqueue({
              type: "DAMAGE_TICK",
              time: time + i,
              payload: {
                sourceId: "ROSSI",
                targetId: "boss",
                damage: 0,
                stagger: 0,
                tickData: {
                  offset: i, realTime: time + i, realOffset: i, time: time + i,
                  multiplier: dotMult,
                  stagger: 0, sp: 0, boundEffects: [],
                },
                actionId: `rossi_claw_mark_dot_${Math.floor(time)}`,
              },
            });
          }
        },
      } as TalentConditionalDescriptor;
    })(),
  ],

  // 灼心: resistance_ignore handled by runtime_passive loop (scope="runtime_passive").
  // Currently applied unconditionally. The 4-magma-stack conditional activation
  // is a future refinement — requires monitoring magma layer count changes.

  // 监督重任 (P3): apply conduction → ATK+20%, 5s, max 2 stacks (independent duration)
  PERLICA: [
    {
      effectMatch: { type: "stat_bonus", stat: "attack_percent" },
      carrierId: "talent_cond_perlica_supervisory_duty",
      event: "APPLY_DIRECT_ANOMALY",
      condition: (e: any) => e.payload?.anomalyType === "conduction",
      buffId: "perlica_supervisory_atk_stack",
      duration: 5,
      stack: { group: "perlica_supervisory", max: 2 },
    },
  ],

  // 活着就是胜利 (P5): freeze on enemy → gain 5 ult gauge. ICD 1s.
  // Same pattern as ALESH flash_freeze but different value/ICD.
  ESTELLA: [
    {
      effectMatch: { type: "gauge_modifier", stat: "ult_gauge_gain" },
      carrierId: "talent_cond_estella_alive_is_victory",
      event: "APPLY_DIRECT_ANOMALY",
      condition: (e: any) => e.payload?.anomalyType === "freeze",
      buffId: "estella_alive_is_victory_gauge",
      duration: 0, // instant
      cooldownId: "estella_alive_is_victory_icd",
      cooldownDuration: 1,
      postAction: (_e: any, ctx: any, actorId: string) => {
        try {
          const actor = ctx.state.getActor(actorId);
          const activeEffects = (actor.snapshotData.stats as any)?._activeEffects;
          const eff = activeEffects?.find(
            (e: any) => e.type === "gauge_modifier" && e.stat === "ult_gauge_gain" && e.scope === "runtime_conditional",
          );
          const value = eff?.value ?? 5;
          actor.modifyGauge(value);
          ctx.simLog({
            type: "GAUGE_CHANGE",
            time: ctx.state.getCurrentTime(),
            payload: { actorId, change: value, gauge: actor.getGauge(), reason: "potential_alive_is_victory" },
          });
        } catch { /* actor not found */ }
      },
      bonusOverride: () => [{ stat: "all_dmg", value: 0, zone: "damageBonus" }],
    },
  ],

  // 闪冻锁鲜: freeze/crystal on enemy → gain ult gauge. Max once per 3s.
  // gauge_modifier type handled via postAction (gauge gain is not a DynamicBonus).
  ALESH: [
    {
      effectMatch: { type: "gauge_modifier", stat: "ult_gauge_gain" },
      carrierId: "talent_cond_alesh_flash_freeze",
      event: "APPLY_DIRECT_ANOMALY",
      condition: (e: any) => e.payload?.anomalyType === "freeze",
      buffId: "alesh_flash_freeze_gauge",
      duration: 0, // instant
      cooldownId: "alesh_flash_freeze_icd",
      cooldownDuration: 3,
      postAction: (_e: any, ctx: any, actorId: string) => {
        try {
          const actor = ctx.state.getActor(actorId);
          // Value comes from effectMatch (3 or 4 gauge), but we can't pass it
          // through to postAction easily. Use the effect value stored at registration.
          // For now use a simple approach: read from the actor snapshot.
          const activeEffects = (actor.snapshotData.stats as any)?._activeEffects;
          const eff = activeEffects?.find(
            (e: any) => e.type === "gauge_modifier" && e.stat === "ult_gauge_gain" && e.scope === "runtime_conditional",
          );
          const value = eff?.value ?? 3;
          actor.modifyGauge(value);
          ctx.simLog({
            type: "GAUGE_CHANGE",
            time: ctx.state.getCurrentTime(),
            payload: { actorId, change: value, gauge: actor.getGauge(), reason: "talent_flash_freeze" },
          });
        } catch { /* actor not found */ }
      },
      // Dummy bonus — the real effect is gauge gain via postAction
      bonusOverride: () => [{ stat: "all_dmg", value: 0, zone: "damageBonus" }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Registration function — called from simulator.ts
// ---------------------------------------------------------------------------

/**
 * Register talent conditional effects for all actors.
 *
 * Replaces the per-character if-else block in simulator.ts.
 * Iterates actors, looks up trigger descriptors by actorId, matches
 * effects from _activeEffects, and calls registerTriggeredBuff().
 */
export function registerTalentConditionals(
  actors: ReadonlyArray<{ id: string; stats: Record<string, any> }>,
  registerTriggeredBuff: (
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
      cooldownId?: string;
      cooldownDuration?: number;
      /** How many stacks to add per trigger. Default 1. */
      stackCountFn?: (e: any, ctx: any) => number;
      /** Stack mode: "refresh" (default) or "independent". */
      stackMode?: "refresh" | "independent";
      /** Override sourceMustBeWearer. Default true. */
      sourceMustBeWearer?: boolean;
      /** Side effect after buff application. */
      postAction?: (e: any, ctx: any, actorId: string) => void;
    },
  ) => void,
  diagnostics?: DiagnosticCollector,
): void {
  for (const actor of actors) {
    const descriptors = TALENT_CONDITIONAL_TRIGGERS[actor.id];
    if (!descriptors) continue;

    const activeEffects = (actor.stats as any)?._activeEffects;
    if (!activeEffects?.length) continue;

    const conditionals = activeEffects.filter(
      (e: any) => e.scope === "runtime_conditional" && e.value,
    );
    if (conditionals.length === 0) continue;

    for (const desc of descriptors) {
      const eff = conditionals.find(
        (e: any) => e.type === desc.effectMatch.type && e.stat === desc.effectMatch.stat,
      );
      if (!eff) continue;

      const bonuses = desc.bonusOverride
        ? desc.bonusOverride(eff.value, actor.stats as Record<string, any>)
        : mapEffectToBonus(eff.type, eff.stat, eff.value);

      if (!bonuses) {
        diagnostics?.warn(
          "UNSUPPORTED_CONDITIONAL_BONUS",
          `Cannot map talent conditional effect type="${eff.type}" stat="${eff.stat}" to DynamicBonus for ${actor.id}`,
          { actorId: actor.id, effectType: eff.type },
        );
        continue;
      }

      const condition = desc.conditionFactory ? desc.conditionFactory() : desc.condition;

      // Resolve dynamic stack max if descriptor provides a resolver
      let stack = desc.stack;
      if (stack && desc.stackMaxResolver) {
        const pLevel = (actor.stats as any)?._potentialLevel ?? 0;
        stack = { ...stack, max: desc.stackMaxResolver(pLevel) };
      }

      registerTriggeredBuff(actor.id, {
        carrierId: desc.carrierId,
        event: desc.event,
        condition,
        buffId: desc.buffId,
        duration: desc.duration,
        bonuses,
        target: desc.target,
        stack,
        cooldownId: desc.cooldownId,
        cooldownDuration: desc.cooldownDuration,
        stackCountFn: desc.stackCountResolver,
        stackMode: desc.stackMode,
        sourceMustBeWearer: desc.sourceMustBeWearer,
        postAction: desc.postAction,
      });
    }
  }
}
