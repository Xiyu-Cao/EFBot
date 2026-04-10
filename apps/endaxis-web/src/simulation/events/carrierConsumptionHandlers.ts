/**
 * Carrier buff consumption handlers.
 *
 * Registers EffectTrigger-based passive Effects that watch for events
 * and consume carrier buffs from EffectManager, enqueuing downstream
 * effects (damage, SP, linked debuffs).
 *
 * Called from simulator.ts after carrier buffs are routed.
 */

import { Effect } from "../effects/types";
import type { EffectTrigger } from "../effects/types";
import type { SimulationEngine } from "../engine/SimulationEngine";
import type { SimulationContext } from "../engine/SimulationContext";
import { getSkillsJsonRowByLabel } from "../data/skillMultipliers";
import { addOrRefreshBuff } from "../equipment/types";
import type { DynamicBonus } from "../equipment/types";
import type { ActorSnapshot } from "../state/types";
import { preDamageRegistry } from "./DamageHandler";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if an actor has a specific potential active (by level). */
function hasPotential(actor: ActorSnapshot, level: number): boolean {
  const potentialLevel = (actor.stats as any)?._potentialLevel;
  return typeof potentialLevel === "number" && potentialLevel >= level;
}

/**
 * Consume all magic attachment layers from enemy.
 * Returns { element, stacks } if consumed, or null if no attachment.
 */
function consumeMagicAttachment(ctx: SimulationContext): { element: string; stacks: number } | null {
  const status = ctx.state.enemy.status;
  if (!status.hasMagicAttachment()) return null;
  const element = status.getMagicElement()!;
  const stacks = status.getMagicStacks();
  status.clearMagicAttachment();
  return { element, stacks };
}

/** Enqueue a refund SP event (返还技力). */
function enqueueSpRefund(ctx: SimulationContext, amount: number, reason: string, sourceId: string): void {
  if (amount <= 0) return;
  ctx.queue.enqueue({
    type: "SP_CHANGE",
    time: ctx.state.getCurrentTime(),
    payload: {
      actorId: sourceId,
      spChange: amount,
      reason: "skill", // reason="skill" → addRefundSp (返还, no ult charge)
      sourceId,
      parent: {} as any,
    },
  });
}

// ---------------------------------------------------------------------------
// ENDMINISTRATOR — 源石结晶 consumption
// ---------------------------------------------------------------------------

/**
 * Register consumption handler for endmin_debuff (源石结晶).
 *
 * Trigger: APPLY_PHYSICAL_ANOMALY on enemy (any source) while crystal exists.
 * Also triggered by direct break (Route 2.6).
 *
 * On consume:
 *   1. Remove crystal from enemy.effects
 *   2. Enqueue extra DAMAGE_TICK (击碎结晶伤害倍率)
 *   3. Talent 0 (本质瓦解): ATK +15/30% on ENDMINISTRATOR, 15s
 *   4. Talent 1 (现实静滞): remove linked physical vulnerability debuff
 *
 * Talent 1 linked debuff: applied separately when crystal is created,
 * and removed here when crystal is consumed or expires.
 */
export function registerEndminCrystalConsumption(
  engine: SimulationEngine,
  skillLevelMap?: Record<string, Record<string, number>>,
): void {
  // Pre-compute crystal damage multiplier
  const unifiedLevel = skillLevelMap?.["ENDMINISTRATOR"]?.["link"] ?? 12;
  const levelIdx = Math.max(0, Math.min(11, unifiedLevel - 1));
  const multRow = getSkillsJsonRowByLabel("ENDMINISTRATOR", "link", "击碎结晶伤害倍率") ?? [];
  const crystalMult = parseFloat(String(multRow[levelIdx] ?? "400").replace("%", "")) / 100;

  /**
   * Immediate part: check crystal exists, enqueue crystal shatter damage.
   * Crystal buff is NOT removed here — removal is deferred.
   */
  function crystalReactionImmediate(ctx: SimulationContext): boolean {
    const crystal = ctx.state.enemy.effects.getByEffectId("endmin_debuff");
    if (!crystal) return false;

    const time = ctx.state.getCurrentTime();

    // Enqueue crystal shatter damage (immediate — part of the slam's cascade)
    ctx.queue.enqueue({
      type: "DAMAGE_TICK",
      time,
      payload: {
        sourceId: "ENDMINISTRATOR",
        targetId: "boss",
        damage: 0,
        stagger: 0,
        tickData: {
          offset: 0, realTime: time, realOffset: 0, time,
          multiplier: crystalMult,
          stagger: 0, sp: 0, boundEffects: [],
        },
        actionId: "endmin_crystal_shatter",
      },
    });

    // P1 SP refund (immediate — not dependent on cascade completion)
    try {
      const endmin = ctx.state.getActor("ENDMINISTRATOR");
      if (hasPotential(endmin.snapshotData, 1)) {
        enqueueSpRefund(ctx, 50, "endmin_p1_crystal_refund", "ENDMINISTRATOR");
      }
    } catch { /* */ }

    return true; // crystal was triggered
  }

  /**
   * Deferred part: remove crystal buff + 现实静滞 + apply 本质瓦解 ATK buff.
   * Fires after the triggering sub-action's cascade (including slam + crystal damage) completes.
   */
  function crystalConsumptionDeferred(ctx: SimulationContext): void {
    const enemyEffects = ctx.state.enemy.effects;
    const crystal = enemyEffects.getByEffectId("endmin_debuff");
    if (!crystal) return; // already consumed (shouldn't happen)

    const time = ctx.state.getCurrentTime();

    // Remove crystal
    enemyEffects.remove(crystal.id);

    ctx.simLog({
      type: "ANOMALY_STATUS_CHANGE",
      time,
      payload: {
        description: "源石结晶 consumed — crystal removed",
        type: "endmin_debuff_consumed",
        sourceId: "ENDMINISTRATOR",
      },
    });

    // Remove linked 现实静滞
    enemyEffects.removeByEffectId("endmin_reality_stasis");

    // Talent 0 (本质瓦解): ATK buff on self
    try {
      const actor = ctx.state.getActor("ENDMINISTRATOR");
      const talentEffects = (actor.snapshotData.stats as any)?._activeEffects;
      const t0 = talentEffects?.find(
        (e: any) => e.scope === "runtime_conditional" && e.type === "stat_bonus" && e.stat === "attack_percent",
      );
      if (t0?.value) {
        addOrRefreshBuff(
          actor.effects,
          new Effect({
            id: "endmin_essence_dissolve_atk",
            name: "本质瓦解",
            tags: [],
            duration: 15,
            startTime: time,
            properties: {
              dynamicBonuses: [{ stat: "all_dmg", value: t0.value, zone: "attackPercent" }] as DynamicBonus[],
            },
          }),
        );

        // P2 (权能映射): teammates get half the ATK buff
        if (hasPotential(actor.snapshotData, 2)) {
          const halfValue = t0.value / 2;
          for (const teammate of ctx.state.getAllActors()) {
            if (teammate.id === "ENDMINISTRATOR") continue;
            addOrRefreshBuff(
              teammate.effects,
              new Effect({
                id: "endmin_p2_team_atk_share",
                name: "权能映射",
                tags: [],
                duration: 15,
                startTime: time,
                properties: {
                  dynamicBonuses: [{ stat: "all_dmg" as any, value: halfValue, zone: "attackPercent" as any }],
                },
              }),
            );
          }
        }
      }
    } catch { /* */ }
  }

  // Trigger 1a: APPLY_PHYSICAL_ANOMALY → immediate (enqueue crystal damage)
  const physTriggerImmediate: EffectTrigger = {
    event: "APPLY_PHYSICAL_ANOMALY",
    sourceMustBeWearer: false,
    action: (_e: any, ctx: SimulationContext) => { crystalReactionImmediate(ctx); },
  };

  // Trigger 1b: APPLY_PHYSICAL_ANOMALY → deferred (remove crystal + talent)
  const physTriggerDeferred: EffectTrigger = {
    event: "APPLY_PHYSICAL_ANOMALY",
    sourceMustBeWearer: false,
    deferred: true,
    condition: (_e: any, ctx: SimulationContext) => {
      // Only fire if crystal still exists (immediate part confirmed it was triggered)
      return ctx.state.enemy.effects.getByEffectId("endmin_debuff") !== undefined;
    },
    action: (_e: any, ctx: SimulationContext) => { crystalConsumptionDeferred(ctx); },
  };

  // Trigger 2a: ultimate DAMAGE_TICK → immediate
  const ultTriggerImmediate: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      return action?.node?.type === "ultimate";
    },
    action: (_e: any, ctx: SimulationContext) => { crystalReactionImmediate(ctx); },
  };

  // Trigger 2b: ultimate DAMAGE_TICK → deferred
  const ultTriggerDeferred: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    deferred: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      return action?.node?.type === "ultimate" &&
        ctx.state.enemy.effects.getByEffectId("endmin_debuff") !== undefined;
    },
    action: (_e: any, ctx: SimulationContext) => { crystalConsumptionDeferred(ctx); },
  };

  engine.registerPassiveEffect("ENDMINISTRATOR", new Effect({
    id: "endmin_crystal_consumption_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [physTriggerImmediate, physTriggerDeferred, ultTriggerImmediate, ultTriggerDeferred],
  }));
}

/**
 * Register the linked talent 1 debuff (现实静滞) when crystal is applied.
 * Called from the carrier routing in simulator.ts after endmin_debuff Effect is created.
 */
export function applyEndminLinkedDebuff(ctx: SimulationContext): void {
  try {
    const actor = ctx.state.getActor("ENDMINISTRATOR");
    const talentEffects = (actor.snapshotData.stats as any)?._activeEffects;
    const t1 = talentEffects?.find(
      (e: any) => e.scope === "runtime_passive" && e.type === "damage_bonus" && e.stat === "physical_dmg",
    );
    if (t1?.value) {
      addOrRefreshBuff(
        ctx.state.enemy.effects,
        new Effect({
          id: "endmin_reality_stasis",
          name: "现实静滞",
          tags: [],
          duration: 999999, // lives as long as crystal — removed on consumption
          startTime: ctx.state.getCurrentTime(),
          properties: {
            dynamicBonuses: [{ stat: "physical_dmg", value: t1.value, zone: "fragility" }] as DynamicBonus[],
            sourceActorId: "ENDMINISTRATOR",
          },
        }),
      );
    }
  } catch { /* actor not found */ }
}

// ---------------------------------------------------------------------------
// POGRANICHNK — 铁誓 consumption
// ---------------------------------------------------------------------------

/**
 * Register consumption handler for pograni_buff (铁誓).
 *
 * Trigger 1: APPLY_PHYSICAL_ANOMALY → consume 1 layer, 袭扰/决胜
 * Trigger 2: POGRANICHNK link DAMAGE_TICK (first hit) → consume 1 layer
 */
export function registerPograniBuffConsumption(
  engine: SimulationEngine,
  skillLevelMap?: Record<string, Record<string, number>>,
): void {
  const unifiedLevel = skillLevelMap?.["POGRANICHNK"]?.["ultimate"] ?? 12;
  const levelIdx = Math.max(0, Math.min(11, unifiedLevel - 1));
  const raidMultRow = getSkillsJsonRowByLabel("POGRANICHNK", "ultimate", "袭扰伤害倍率") ?? [];
  const raidSpRow = getSkillsJsonRowByLabel("POGRANICHNK", "ultimate", "袭扰恢复技力") ?? [];
  const finalMultRow = getSkillsJsonRowByLabel("POGRANICHNK", "ultimate", "决胜伤害倍率") ?? [];
  const finalStaggerRow = getSkillsJsonRowByLabel("POGRANICHNK", "ultimate", "决胜失衡值") ?? [];
  const finalSpRow = getSkillsJsonRowByLabel("POGRANICHNK", "ultimate", "决胜恢复技力") ?? [];

  const raidMult = parseFloat(String(raidMultRow[levelIdx] ?? "100").replace("%", "")) / 100;
  const raidSp = parseFloat(String(raidSpRow[levelIdx] ?? "10"));
  const finalMult = parseFloat(String(finalMultRow[levelIdx] ?? "450").replace("%", "")) / 100;
  const finalStagger = parseFloat(String(finalStaggerRow[levelIdx] ?? "15"));
  const finalSp = parseFloat(String(finalSpRow[levelIdx] ?? "40"));

  // Talent_1 (战术教导): ally who triggers follow-up gets morale, 5/10s
  let tacticsMoraleDuration = 0;
  let tacticsMoraleBonus: DynamicBonus[] = [];
  try {
    const pograni = engine.getState().getActor("POGRANICHNK");
    const effects = (pograni.snapshotData.stats as any)?._activeEffects;
    // Check talent_1 exists (has parsed_unimplemented entries for talent_1)
    const talents = (pograni.snapshotData as any)?.talents;
    const t1 = talents?.find((t: any) => t.id === "talent_1");
    if (t1) {
      // Promotion 3 = 10s, Promotion 2 = 5s
      const stage = t1.stages?.[t1.stages.length - 1];
      tacticsMoraleDuration = (stage?.promotion >= 3) ? 10 : 5;
      // Use same ATK% bonus as talent_0 morale
      const t0Effect = effects?.find(
        (e: any) => e.type === "stat_bonus" && e.stat === "attack_percent" && e.scope === "runtime_conditional",
      );
      if (t0Effect?.value) {
        tacticsMoraleBonus = [{ stat: "all_dmg" as const, value: t0Effect.value, zone: "attackPercent" as const }];
      }
    }
  } catch { /* */ }

  function consumeOneLayer(ctx: SimulationContext, actionId: string, triggerActorId?: string): void {
    const actorEffects = ctx.state.getActor("POGRANICHNK").effects;
    const remaining = actorEffects.getAll().filter((i) => i.effect.id === "pograni_buff");
    if (remaining.length === 0) return;

    // Remove oldest layer
    remaining.sort((a, b) => a.effect.startTime - b.effect.startTime);
    actorEffects.remove(remaining[0].id);

    const time = ctx.state.getCurrentTime();
    const isLast = remaining.length === 1;

    const mult = isLast ? finalMult : raidMult;
    const stagger = isLast ? finalStagger : 0;
    let spGain = isLast ? finalSp : raidSp;

    // P5 (新铸剑锋): 铁誓 SP recovery ×1.2
    try {
      const actor = ctx.state.getActor("POGRANICHNK");
      if (hasPotential(actor.snapshotData, 5)) spGain = Math.round(spGain * 1.2);
    } catch { /* */ }

    // Damage
    ctx.queue.enqueue({
      type: "DAMAGE_TICK",
      time,
      payload: {
        sourceId: "POGRANICHNK",
        targetId: "boss",
        damage: 0,
        stagger,
        tickData: {
          offset: 0, realTime: time, realOffset: 0, time,
          multiplier: mult, stagger, sp: 0, boundEffects: [],
        },
        actionId,
      },
    });

    // SP recovery
    if (spGain > 0) {
      ctx.queue.enqueue({
        type: "SP_CHANGE",
        time,
        payload: {
          actorId: "POGRANICHNK",
          spChange: spGain,
          reason: isLast ? "pograni_final" : "pograni_raid",
          sourceId: actionId,
          parent: {} as any,
        },
      });
    }

    ctx.simLog({
      type: "ANOMALY_STATUS_CHANGE",
      time,
      payload: {
        description: `铁誓 ${isLast ? "决胜" : "袭扰"} (${remaining.length - 1} layers left)`,
        type: isLast ? "pograni_final" : "pograni_raid",
        sourceId: "POGRANICHNK",
      },
    });

    // Talent_1 (战术教导): grant morale to triggering ally
    if (tacticsMoraleDuration > 0 && tacticsMoraleBonus.length > 0 && triggerActorId) {
      try {
        const triggerActor = ctx.state.getActor(triggerActorId);
        addOrRefreshBuff(
          triggerActor.effects,
          new Effect({
            id: "pogranichnk_tactics_morale",
            tags: [],
            duration: tacticsMoraleDuration,
            startTime: time,
            properties: { dynamicBonuses: tacticsMoraleBonus },
          }),
        );
      } catch { /* trigger actor not found */ }
    }
  }

  // Trigger 1: any APPLY_PHYSICAL_ANOMALY
  const physTrigger: EffectTrigger = {
    event: "APPLY_PHYSICAL_ANOMALY",
    sourceMustBeWearer: false,
    action: (e: any, ctx: SimulationContext) => {
      consumeOneLayer(ctx, e.payload?.actionId || "pograni_phys_trigger", e.payload?.sourceActorId);
    },
  };

  // Trigger 2: POGRANICHNK link first DAMAGE_TICK
  let linkConsumedForAction = "";
  const linkTrigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      if (action?.node?.type !== "link") return false;
      // Only first hit per link action
      if (linkConsumedForAction === e.payload?.actionId) return false;
      return true;
    },
    action: (e: any, ctx: SimulationContext) => {
      linkConsumedForAction = e.payload?.actionId || "";
      consumeOneLayer(ctx, e.payload?.actionId || "pograni_link_trigger", "POGRANICHNK");
    },
  };

  engine.registerPassiveEffect("POGRANICHNK", new Effect({
    id: "pograni_buff_consumption_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [physTrigger, linkTrigger],
  }));
}

// ---------------------------------------------------------------------------
// LAEVATAIN — 熔火 consumption by skill
// ---------------------------------------------------------------------------

/**
 * Register consume_magma bound-effect handler.
 *
 * Consumption is triggered by the enhanced hit's boundEffect tag ("consume_magma")
 * rather than ACTION_START, so that dodge-cancelled enhanced hits do not consume magma.
 *
 * The handler is registered in preDamageRegistry so it fires before damage resolution
 * on the same frame as the enhanced hit.
 */
export function registerMagmaConsumption(_engine: SimulationEngine): void {
  preDamageRegistry.set("consume_magma", (_e, ctx) => {
    const actorEffects = ctx.state.getActor("LAEVATAIN").effects;
    const magmaLayers = actorEffects.removeByEffectId("magma_1");

    if (magmaLayers.length > 0) {
      ctx.simLog({
        type: "ANOMALY_STATUS_CHANGE",
        time: ctx.state.getCurrentTime(),
        payload: {
          description: `熔火 ×${magmaLayers.length} consumed by skill`,
          type: "magma_consumed",
          sourceId: "LAEVATAIN",
          layersConsumed: magmaLayers.length,
        },
      });

      // Potential 1 (熔火之心): +20 SP refund on skill hit after magma consume
      try {
        const laeva = ctx.state.getActor("LAEVATAIN");
        if (hasPotential(laeva.snapshotData, 1)) {
          enqueueSpRefund(ctx, 20, "laeva_p1_magma_refund", "LAEVATAIN");
        }
      } catch { /* */ }
    }
  });
}

// ---------------------------------------------------------------------------
// TANGTANG — 涡流 consumption by skill
// ---------------------------------------------------------------------------

/**
 * Register consumption handler for comboskillwater (涡流).
 * Trigger: TANGTANG ACTION_START with type=skill → consume all 涡流.
 * SP recovery: 每处涡流 20 SP.
 */
export function registerVortexConsumption(
  engine: SimulationEngine,
  skillLevelMap?: Record<string, Record<string, number>>,
): void {
  const unifiedLevel = skillLevelMap?.["TANGTANG"]?.["skill"] ?? 12;
  const levelIdx = Math.max(0, Math.min(11, unifiedLevel - 1));
  const spRow = getSkillsJsonRowByLabel("TANGTANG", "skill", "每处涡流技力返还") ?? [];
  const spPerVortex = parseFloat(String(spRow[levelIdx] ?? "20"));

  const trigger: EffectTrigger = {
    event: "ACTION_START",
    sourceMustBeWearer: true,
    condition: (e: any) => e.payload?.type === "skill",
    action: (e: any, ctx: SimulationContext) => {
      const actorEffects = ctx.state.getActor("TANGTANG").effects;
      const vortices = actorEffects.removeByEffectId("comboskillwater");

      if (vortices.length > 0) {
        // Potential 1 (财宝储备): +5 SP per vortex consumed
        let extraSpPerVortex = 0;
        try {
          const tangtang = ctx.state.getActor("TANGTANG");
          if (hasPotential(tangtang.snapshotData, 1)) extraSpPerVortex = 5;
        } catch { /* */ }
        const totalSp = vortices.length * (spPerVortex + extraSpPerVortex);
        ctx.queue.enqueue({
          type: "SP_CHANGE",
          time: ctx.state.getCurrentTime(),
          payload: {
            actorId: "TANGTANG",
            spChange: totalSp,
            reason: "vortex_consume",
            sourceId: e.payload?.actionId || "",
            parent: e,
          },
        });

        ctx.simLog({
          type: "ANOMALY_STATUS_CHANGE",
          time: ctx.state.getCurrentTime(),
          payload: {
            description: `涡流 ×${vortices.length} consumed → +${totalSp} SP`,
            type: "vortex_consumed",
            sourceId: "TANGTANG",
          },
        });
      }
    },
  };

  engine.registerPassiveEffect("TANGTANG", new Effect({
    id: "vortex_consumption_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// WULFGARD — skill: consume magic anomaly debuff (燃烧/导电/冻结/腐蚀) + extra attack
//            talent_1 节制准则: on successful consume → refund SP
//            P2: extra +10 SP refund
// ---------------------------------------------------------------------------

/**
 * WULFGARD skill mechanic:
 *   - If target has a magic anomaly debuff (burn/conduction/freeze/corrosion):
 *     consume it, skip blaze_attach, enqueue extra DAMAGE_TICK instead.
 *   - If no anomaly debuff: normal blaze_attach (handled by effect routing).
 *   - talent_1 (节制准则): on successful consume → refund 5/10 SP
 *   - P2 potential: extra +10 SP refund on top
 */
function registerWulfgardSkillConsume(
  engine: SimulationEngine,
  skillLevelMap?: Record<string, Record<string, number>>,
): void {
  let talentSpValue = 0;
  let p2Bonus = 0;
  let hasP3 = false;
  try {
    const actor = engine.getState().getActor("WULFGARD");
    const effects = (actor.snapshotData.stats as any)?._activeEffects;
    const eff = effects?.find(
      (e: any) => e.type === "sp_refund" && e.stat === "on_anomaly_consume" && e.scope === "runtime_conditional",
    );
    if (eff?.value) talentSpValue = eff.value;
    if (hasPotential(actor.snapshotData, 2)) p2Bonus = 10;
    if (hasPotential(actor.snapshotData, 3)) hasP3 = true;
  } catch { /* */ }

  let consumedForAction = "";
  let pendingConsumeType = "";

  // Pre-compute extra attack multiplier
  const extraMultRow = getSkillsJsonRowByLabel("WULFGARD", "skill", "追加伤害倍率") ?? [];
  const extraLevelIdx = Math.max(0, Math.min(11, (skillLevelMap?.["WULFGARD"]?.["skill"] ?? 12) - 1));
  const extraMult = parseFloat(String(extraMultRow[extraLevelIdx] ?? "0").replace("%", "")) / 100;

  /** Fixed priority: burn > conduction > freeze > corrosion. Only one consumed. */
  function detectConsumable(ctx: SimulationContext): string {
    const status = ctx.state.enemy.status;
    if (status.burn !== null) return "burn";
    if (status.conduction !== null) return "conduction";
    if (status.isFrozen(ctx.state.getCurrentTime())) return "freeze";
    if (status.corrosion !== null) return "corrosion";
    return "";
  }

  // Immediate: detect anomaly + enqueue extra attack (anomaly buff still active)
  const immediateTrigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      if (action?.node?.type !== "skill") return false;
      if (consumedForAction === e.payload?.actionId) return false;
      return detectConsumable(ctx) !== "";
    },
    action: (e: any, ctx: SimulationContext) => {
      consumedForAction = e.payload?.actionId || "";
      pendingConsumeType = detectConsumable(ctx);
      if (!pendingConsumeType) return;
      const time = ctx.state.getCurrentTime();
      if (extraMult > 0) {
        ctx.queue.enqueue({
          type: "DAMAGE_TICK", time,
          payload: {
            sourceId: "WULFGARD", targetId: "boss", damage: 0, stagger: 0,
            tickData: { offset: 0, realTime: time, realOffset: 0, time, multiplier: extraMult, stagger: 0, sp: 0, boundEffects: [] },
            actionId: e.payload?.actionId || "wulfgard_extra_attack",
          },
        });
      }
    },
  };

  // Deferred: actually consume anomaly + SP refund + P3 buff refresh
  const deferredTrigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    deferred: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      return action?.node?.type === "skill" && pendingConsumeType !== "";
    },
    action: (_e: any, ctx: SimulationContext) => {
      const status = ctx.state.enemy.status;
      const time = ctx.state.getCurrentTime();
      const consumedType = pendingConsumeType;
      pendingConsumeType = "";

      if (consumedType === "burn") status.clearBurn();
      else if (consumedType === "conduction") status.clearConduction();
      else if (consumedType === "freeze") status.clearFreeze();
      else if (consumedType === "corrosion") status.clearCorrosion();

      ctx.simLog({
        type: "ANOMALY_STATUS_CHANGE", time,
        payload: { description: `${consumedType} consumed by WULFGARD skill`, type: `wulfgard_consume_${consumedType}`, sourceId: "WULFGARD" },
      });

      const totalRefund = talentSpValue + p2Bonus;
      if (totalRefund > 0) enqueueSpRefund(ctx, totalRefund, "wulfgard_restraint", "WULFGARD");

      if (hasP3) {
        const actor = ctx.state.getActor("WULFGARD");
        const existing = actor.effects.getByEffectId("wulfgard_blaze_buff");
        if (existing) {
          const bonuses = existing.effect.properties.dynamicBonuses as DynamicBonus[] | undefined;
          if (bonuses?.length) {
            addOrRefreshBuff(actor.effects, new Effect({
              id: "wulfgard_blaze_buff", tags: [], duration: 10, startTime: time,
              properties: { dynamicBonuses: bonuses },
            }));
            const halfBonuses: DynamicBonus[] = bonuses.map((b) => ({ ...b, value: b.value * 0.5 }));
            for (const teammate of ctx.state.getAllActors()) {
              if (teammate.id === "WULFGARD") continue;
              addOrRefreshBuff(teammate.effects, new Effect({
                id: "wulfgard_blaze_buff_shared", tags: [], duration: 10, startTime: time,
                properties: { dynamicBonuses: halfBonuses },
              }));
            }
          }
        }
      }
    },
  };

  engine.registerPassiveEffect("WULFGARD", new Effect({
    id: "wulfgard_skill_consume_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [immediateTrigger, deferredTrigger],
  }));
}

// ---------------------------------------------------------------------------
// WULFGARD — P5: 天生掠食者 — post ultimate → reset link CD
// ---------------------------------------------------------------------------

function registerWulfgardUltLinkCdReset(engine: SimulationEngine): void {
  const trigger: EffectTrigger = {
    event: "ACTION_END",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      return action?.node?.type === "ultimate";
    },
    action: (_e: any, ctx: SimulationContext) => {
      const actor = ctx.state.getActor("WULFGARD");
      const time = ctx.state.getCurrentTime();
      // Reset link cooldown by setting expiry to current time
      actor.setCooldown("WULFGARD_link", time);

      ctx.simLog({
        type: "ANOMALY_STATUS_CHANGE",
        time,
        payload: {
          description: "P5 天生掠食者: link CD reset after ultimate",
          type: "wulfgard_p5_link_cd_reset",
          sourceId: "WULFGARD",
        },
      });
    },
  };

  engine.registerPassiveEffect("WULFGARD", new Effect({
    id: "wulfgard_p5_ult_link_cd_reset",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// ARCLIGHT — P1: +10 SP on each consume_conduction trigger
// ---------------------------------------------------------------------------

function registerArclightP1SpRefund(engine: SimulationEngine): void {
  const trigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any) => {
      const bound = e.payload?.tickData?.boundEffects;
      return Array.isArray(bound) && bound.includes("consume_conduction");
    },
    action: (_e: any, ctx: SimulationContext) => {
      enqueueSpRefund(ctx, 10, "arclight_p1_conduction_refund", "ARCLIGHT");
    },
  };

  engine.registerPassiveEffect("ARCLIGHT", new Effect({
    id: "arclight_p1_sp_refund_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// DAPAN — dapan_buff (备料) consumption: link hit → reduce link CD by 40%
// ---------------------------------------------------------------------------

function registerDapanBuffConsumption(engine: SimulationEngine): void {
  let consumedForAction = "";

  const trigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      if (action?.node?.type !== "link") return false;
      if (consumedForAction === e.payload?.actionId) return false;
      // Check if dapan_buff exists
      const actor = ctx.state.getActor("DAPAN");
      return actor.effects.getByEffectId("dapan_buff") !== undefined;
    },
    action: (e: any, ctx: SimulationContext) => {
      consumedForAction = e.payload?.actionId || "";
      const actor = ctx.state.getActor("DAPAN");
      const removed = actor.effects.removeByEffectId("dapan_buff");
      if (removed.length === 0) return;

      // Reduce link cooldown by 40% of max cooldown (20s → 8s reduction)
      const action = ctx.getAction(e.payload?.actionId);
      const maxCooldown = action?.node?.cooldown || 20;
      const reduction = maxCooldown * 0.4;
      actor.reduceCooldown(action?.node?.id || "link", reduction);

      ctx.simLog({
        type: "ANOMALY_STATUS_CHANGE",
        time: ctx.state.getCurrentTime(),
        payload: {
          description: `备料 consumed → link CD reduced by ${reduction}s`,
          type: "dapan_buff_consumed",
          sourceId: "DAPAN",
        },
      });
    },
  };

  engine.registerPassiveEffect("DAPAN", new Effect({
    id: "dapan_buff_consumption_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// POGRANICHNK — skill break tier SP recovery
// ---------------------------------------------------------------------------

/**
 * POGRANICHNK skill 粉碎阵线: consumes break stacks, SP recovery by tier.
 * 1 layer→5, 2→10, 3→20, 4→30 SP (values from skills.json).
 */
function registerPograniSkillBreakSp(
  engine: SimulationEngine,
  skillLevelMap?: Record<string, Record<string, number>>,
): void {
  const level = skillLevelMap?.["POGRANICHNK"]?.["skill"] ?? 12;
  const idx = Math.max(0, Math.min(11, level - 1));

  const spByTier: number[] = [];
  for (let tier = 1; tier <= 4; tier++) {
    const label = `消耗${["一", "二", "三", "四"][tier - 1]}层破防时技力恢复`;
    const row = getSkillsJsonRowByLabel("POGRANICHNK", "skill", label) ?? [];
    spByTier.push(parseFloat(String(row[idx] ?? (tier * 5 + (tier > 2 ? (tier - 2) * 5 : 0)))));
  }

  const trigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      return action?.node?.type === "skill" && ctx.state.enemy.status.hasBreak();
    },
    action: (e: any, ctx: SimulationContext) => {
      const stacks = ctx.state.enemy.status.getBreakStacks();
      if (stacks <= 0) return;
      const tier = Math.min(stacks, 4);
      let sp = spByTier[tier - 1] || 0;

      // P5 (新铸剑锋): SP recovery ×1.2
      try {
        const actor = ctx.state.getActor("POGRANICHNK");
        if (hasPotential(actor.snapshotData, 5)) sp = Math.round(sp * 1.2);
      } catch { /* */ }

      // Consume break stacks
      ctx.state.enemy.status.clearBreak();

      if (sp > 0) {
        // "恢复" = trueSP (generates ult charge)
        ctx.queue.enqueue({
          type: "SP_CHANGE",
          time: ctx.state.getCurrentTime(),
          payload: {
            actorId: "POGRANICHNK",
            spChange: sp,
            reason: "damage", // trueSP
            sourceId: e.payload?.actionId || "",
            parent: e,
          },
        });
      }

      ctx.simLog({
        type: "ANOMALY_STATUS_CHANGE",
        time: ctx.state.getCurrentTime(),
        payload: {
          description: `POGRANICHNK skill consumed ${tier} break layers → +${sp} SP`,
          type: "pograni_break_consume",
          sourceId: "POGRANICHNK",
        },
      });
    },
  };

  engine.registerPassiveEffect("POGRANICHNK", new Effect({
    id: "pograni_skill_break_sp_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// ROSSI — link attachment consumption → extra damage
// ---------------------------------------------------------------------------

function registerRossiLinkConsume(
  engine: SimulationEngine,
  skillLevelMap?: Record<string, Record<string, number>>,
): void {
  const level = skillLevelMap?.["ROSSI"]?.["link"] ?? 12;
  const idx = Math.max(0, Math.min(11, level - 1));
  const perLayerRow = getSkillsJsonRowByLabel("ROSSI", "link", "消耗每层附着额外伤害倍率") ?? [];
  const perLayerMult = parseFloat(String(perLayerRow[idx] ?? "180").replace("%", "")) / 100;

  let consumedForAction = "";

  const trigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      if (action?.node?.type !== "link") return false;
      if (consumedForAction === e.payload?.actionId) return false;
      // Check if enemy has magic attachment
      return ctx.state.enemy.status.hasMagicAttachment();
    },
    action: (e: any, ctx: SimulationContext) => {
      consumedForAction = e.payload?.actionId || "";
      const status = ctx.state.enemy.status;
      const stacks = status.getMagicStacks();
      if (stacks <= 0) return;

      // Consume all attachment layers
      status.clearMagicAttachment();

      const time = ctx.state.getCurrentTime();

      // Extra damage per layer
      for (let i = 0; i < stacks; i++) {
        ctx.queue.enqueue({
          type: "DAMAGE_TICK",
          time,
          payload: {
            sourceId: "ROSSI",
            targetId: "boss",
            damage: 0,
            stagger: 0,
            tickData: {
              offset: 0, realTime: time, realOffset: 0, time,
              multiplier: perLayerMult,
              stagger: 0, sp: 0, boundEffects: [],
            },
            actionId: e.payload?.actionId || "rossi_link_consume",
          },
        });
      }

      ctx.simLog({
        type: "ANOMALY_STATUS_CHANGE",
        time,
        payload: {
          description: `ROSSI link consumed ${stacks} attachment layers → ${stacks}× extra damage`,
          type: "rossi_link_consume",
          sourceId: "ROSSI",
        },
      });
    },
  };

  engine.registerPassiveEffect("ROSSI", new Effect({
    id: "rossi_link_consume_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// ANTAL — link reapplies current anomaly/attachment on target
// ---------------------------------------------------------------------------

function registerAntalLinkReapply(engine: SimulationEngine): void {
  let reappliedForAction = "";

  // Map allowedTypes condition strings to reapply actions
  const ATTACHMENT_MAP: Record<string, string> = {
    blaze_attach: "fire", cold_attach: "cold", emag_attach: "electro", nature_attach: "nature",
  };
  const ANOMALY_MAP: Record<string, string> = {
    burning: "burn", conductive: "conduction", frozen: "freeze", corrosion: "corrosion",
  };
  const BURST_MAP: Record<string, string> = {
    blaze_burst: "fire", cold_burst: "cold", emag_burst: "electro", nature_burst: "nature",
  };

  const trigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      if (action?.node?.type !== "link") return false;
      return reappliedForAction !== e.payload?.actionId;
    },
    action: (e: any, ctx: SimulationContext) => {
      reappliedForAction = e.payload?.actionId || "";
      const action = ctx.getAction(e.payload?.actionId);
      const allowedTypes: string[] = action?.node?.allowedTypes || [];
      const status = ctx.state.enemy.status;
      const time = ctx.state.getCurrentTime();
      let reapplied = false;

      // Find which condition triggered the link and reapply only that one
      for (const cond of allowedTypes) {
        if (reapplied) break;

        // Magic attachment
        const element = ATTACHMENT_MAP[cond] || BURST_MAP[cond];
        if (element && status.getMagicElement() === element) {
          ctx.queue.enqueue({
            type: "APPLY_MAGIC_ATTACHMENT",
            time,
            payload: { element: element as any, sourceActorId: "ANTAL", targetId: "boss", sourceSkillId: "ANTAL_link_reapply" },
          });
          reapplied = true;
          continue;
        }

        // Anomaly debuff
        const anomaly = ANOMALY_MAP[cond];
        if (anomaly) {
          const stateMap: Record<string, any> = { burn: status.burn, conduction: status.conduction, corrosion: status.corrosion };
          if (anomaly === "freeze" && status.isFrozen(time)) {
            ctx.queue.enqueue({
              type: "APPLY_DIRECT_ANOMALY", time,
              payload: { anomalyType: "freeze" as any, level: status.freeze!.level as any, sourceActorId: "ANTAL", targetId: "boss", sourceSkillId: "ANTAL_link_reapply" },
            });
            reapplied = true;
          } else if (stateMap[anomaly] !== undefined && stateMap[anomaly] !== null) {
            ctx.queue.enqueue({
              type: "APPLY_DIRECT_ANOMALY", time,
              payload: { anomalyType: anomaly as any, level: stateMap[anomaly].level as any, sourceActorId: "ANTAL", targetId: "boss", sourceSkillId: "ANTAL_link_reapply" },
            });
            reapplied = true;
          }
        }
      }
    },
  };

  engine.registerPassiveEffect("ANTAL", new Effect({
    id: "antal_link_reapply_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// LASTRITE — skill phantom attack + SP refund
// ---------------------------------------------------------------------------

function registerLastritePhantom(
  engine: SimulationEngine,
  skillLevelMap?: Record<string, Record<string, number>>,
): void {
  const level = skillLevelMap?.["LASTRITE"]?.["skill"] ?? 12;
  const idx = Math.max(0, Math.min(11, level - 1));
  const multRow = getSkillsJsonRowByLabel("LASTRITE", "skill", "幻影追击伤害倍率") ?? [];
  let baseMult = parseFloat(String(multRow[idx] ?? "320").replace("%", "")) / 100;

  // P1 (守墓人之赠): phantom +20% damage + 5 stagger
  // P5 (寒风再起): phantom ×1.2 + skill +5SP
  let hasP1 = false;
  let hasP5 = false;
  try {
    const actor = engine.getState().getActor("LASTRITE");
    hasP1 = hasPotential(actor.snapshotData, 1);
    hasP5 = hasPotential(actor.snapshotData, 5);
  } catch { /* */ }

  let mult = baseMult;
  if (hasP1) mult *= 1.2; // P1: +20% damage
  if (hasP5) mult *= 1.2; // P5: phantom ×1.2
  const phantomStagger = hasP1 ? 5 : 0; // P1: +5 stagger

  // Simplified: phantom attack fires when skill is used (default trigger,
  // since actual trigger = heavy attack after buff, but we don't have heavy attack detection)
  const trigger: EffectTrigger = {
    event: "ACTION_END",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      return action?.node?.type === "skill";
    },
    action: (e: any, ctx: SimulationContext) => {
      const time = ctx.state.getCurrentTime();

      // Phantom attack damage
      ctx.queue.enqueue({
        type: "DAMAGE_TICK",
        time: time + 0.5,
        payload: {
          sourceId: "LASTRITE",
          targetId: "boss",
          damage: 0,
          stagger: phantomStagger,
          tickData: {
            offset: 0.5, realTime: time + 0.5, realOffset: 0.5, time: time + 0.5,
            multiplier: mult, stagger: phantomStagger, sp: 0, boundEffects: [],
          },
          actionId: "lastrite_phantom_attack",
        },
      });

      // Phantom applies cold attachment
      ctx.queue.enqueue({
        type: "APPLY_MAGIC_ATTACHMENT",
        time: time + 0.5,
        payload: {
          element: "cold" as any,
          sourceActorId: "LASTRITE",
          targetId: "boss",
          sourceSkillId: "lastrite_phantom",
        },
      });

      // SP refund (返还 30, P5: +5)
      enqueueSpRefund(ctx, hasP5 ? 35 : 30, "lastrite_phantom_sp", "LASTRITE");
    },
  };

  engine.registerPassiveEffect("LASTRITE", new Effect({
    id: "lastrite_phantom_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// LASTRITE — link 噬冬: consume cold attachment layers → per-layer damage + gauge
// ---------------------------------------------------------------------------

function registerLastriteLinkConsume(
  engine: SimulationEngine,
  skillLevelMap?: Record<string, Record<string, number>>,
): void {
  const level = skillLevelMap?.["LASTRITE"]?.["link"] ?? 12;
  const idx = Math.max(0, Math.min(11, level - 1));
  const perLayerMultRow = getSkillsJsonRowByLabel("LASTRITE", "link", "消耗每层附着额外伤害倍率") ?? [];
  const baseGaugeRow = getSkillsJsonRowByLabel("LASTRITE", "link", "基础获得终结技能量") ?? [];
  const perLayerGaugeRow = getSkillsJsonRowByLabel("LASTRITE", "link", "消耗每层附着额外获得终结技能量") ?? [];
  const perLayerMult = parseFloat(String(perLayerMultRow[idx] ?? "240").replace("%", "")) / 100;
  const baseGauge = parseFloat(String(baseGaugeRow[idx] ?? "40"));
  const perLayerGauge = parseFloat(String(perLayerGaugeRow[idx] ?? "15"));

  let consumedForAction = "";

  // Consumption trigger: only fires on the LAST tick of the link action (hit2 = 斩碎)
  // Hit1 (凝结冰锥) is pure damage, hit2 consumes attachment.
  const consumeTrigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      if (action?.node?.type !== "link") return false;
      if (consumedForAction === e.payload?.actionId) return false;
      // Only fire on the last damage tick of the link
      const ticks = action.resolvedDamageTicks;
      if (!ticks?.length) return false;
      const lastTick = ticks[ticks.length - 1];
      if (Math.abs(e.time - lastTick.realTime) > 0.001) return false;
      // Must have cold attachment to consume
      return ctx.frameSnapshot.magicElement === "cold" && ctx.frameSnapshot.magicStacks > 0;
    },
    action: (e: any, ctx: SimulationContext) => {
      consumedForAction = e.payload?.actionId || "";
      // Read layers from frameSnapshot (pre-effect state), then consume
      const stacks = ctx.frameSnapshot.magicStacks;
      consumeMagicAttachment(ctx); // clear real-time state
      if (stacks <= 0) return;
      const time = ctx.state.getCurrentTime();

      // Combined per-layer extra damage (single hit, total multiplier)
      const totalMult = perLayerMult * stacks;
      if (totalMult > 0) {
        ctx.queue.enqueue({
          type: "DAMAGE_TICK", time,
          payload: {
            sourceId: "LASTRITE", targetId: "boss", damage: 0, stagger: 0,
            tickData: { offset: 0, realTime: time, realOffset: 0, time, multiplier: totalMult, stagger: 0, sp: 0, boundEffects: [] },
            actionId: e.payload?.actionId || "lastrite_link_consume",
          },
        });
      }

      // Gauge: base + per-layer
      const gaugeGain = baseGauge + stacks * perLayerGauge;
      try {
        const actor = ctx.state.getActor("LASTRITE");
        actor.modifyGauge(gaugeGain);
        ctx.simLog({
          type: "GAUGE_CHANGE", time,
          payload: { actorId: "LASTRITE", change: gaugeGain, gauge: actor.getGauge(), reason: "lastrite_link_consume" },
        });
      } catch { /* */ }

      ctx.simLog({
        type: "ANOMALY_STATUS_CHANGE", time,
        payload: { description: `LASTRITE link consumed ${stacks} cold layers → ${stacks}× extra damage + ${gaugeGain} gauge`, type: "lastrite_link_consume", sourceId: "LASTRITE" },
      });
    },
  };

  // Talent_0 低温症: "消耗法术附着后" → deferred (fires after hit2 fully completes)
  const hypothermiaTrigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    deferred: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      if (action?.node?.type !== "link") return false;
      // Only fire once per action, and only if consumption happened
      const ticks = action.resolvedDamageTicks;
      if (!ticks?.length) return false;
      const lastTick = ticks[ticks.length - 1];
      if (Math.abs(e.time - lastTick.realTime) > 0.001) return false;
      // Check if cold attachment was present at frame start (consumption target)
      return ctx.frameSnapshot.magicElement === "cold" && ctx.frameSnapshot.magicStacks > 0;
    },
    action: (_e: any, ctx: SimulationContext) => {
      const stacks = ctx.frameSnapshot.magicStacks;
      if (stacks <= 0) return;
      const time = ctx.state.getCurrentTime();
      try {
        const actor = ctx.state.getActor("LASTRITE");
        const effects = (actor.snapshotData.stats as any)?._activeEffects;
        const t0 = effects?.find(
          (ef: any) => ef.type === "cold_fragility_per_layer" && ef.stat === "cold_dmg",
        );
        if (t0?.value) {
          const fragilityValue = stacks * t0.value;
          addOrRefreshBuff(ctx.state.enemy.effects, new Effect({
            id: "lastrite_hypothermia_fragility",
            name: "低温症",
            tags: [],
            duration: 15,
            startTime: time,
            properties: {
              dynamicBonuses: [{ stat: "cold_dmg", value: fragilityValue, zone: "fragility" }] as DynamicBonus[],
              sourceActorId: "LASTRITE",
            },
          }));
        }
      } catch { /* */ }
    },
  };

  engine.registerPassiveEffect("LASTRITE", new Effect({
    id: "lastrite_link_consume_watcher", tags: [], duration: 999999, startTime: 0, properties: {},
    triggers: [consumeTrigger, hypothermiaTrigger],
  }));
}

// ---------------------------------------------------------------------------
// ALESH — skill: consume cold attachment layers → freeze + per-tier SP
// ---------------------------------------------------------------------------

function registerAleshSkillConsume(
  engine: SimulationEngine,
  skillLevelMap?: Record<string, Record<string, number>>,
): void {
  const level = skillLevelMap?.["ALESH"]?.["skill"] ?? 12;
  const idx = Math.max(0, Math.min(11, level - 1));

  // SP by tier: 消耗一/二/三/四层附着时恢复技力
  const spByTier: number[] = [];
  for (let tier = 1; tier <= 4; tier++) {
    const label = `消耗${["一", "二", "三", "四"][tier - 1]}层附着时恢复技力`;
    const row = getSkillsJsonRowByLabel("ALESH", "skill", label) ?? [];
    spByTier.push(parseFloat(String(row[idx] ?? (tier * 10))));
  }

  // P1 bonus: +10 SP
  let p1Bonus = 0;
  try {
    const actor = engine.getState().getActor("ALESH");
    if (hasPotential(actor.snapshotData, 1)) p1Bonus = 10;
  } catch { /* */ }

  let consumedForAction = "";

  const trigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      if (action?.node?.type !== "skill") return false;
      if (consumedForAction === e.payload?.actionId) return false;
      return ctx.frameSnapshot.magicElement === "cold" && ctx.frameSnapshot.magicStacks > 0;
    },
    action: (e: any, ctx: SimulationContext) => {
      consumedForAction = e.payload?.actionId || "";
      const stacks = ctx.frameSnapshot.magicStacks;
      consumeMagicAttachment(ctx); // clear real-time state
      if (stacks <= 0) return;
      const time = ctx.state.getCurrentTime();
      const tier = Math.min(stacks, 4);

      // Force freeze
      ctx.queue.enqueue({
        type: "APPLY_DIRECT_ANOMALY", time,
        payload: { anomalyType: "freeze" as any, level: tier as any, sourceActorId: "ALESH", targetId: "boss", sourceSkillId: "ALESH_skill" },
      });

      // SP recovery (恢复 = trueSP, generates ult charge)
      const sp = (spByTier[tier - 1] || 0) + p1Bonus;
      if (sp > 0) {
        ctx.queue.enqueue({
          type: "SP_CHANGE", time,
          payload: { actorId: "ALESH", spChange: sp, reason: "damage", sourceId: e.payload?.actionId || "", parent: e },
        });
      }

      ctx.simLog({
        type: "ANOMALY_STATUS_CHANGE", time,
        payload: { description: `ALESH skill consumed ${stacks} cold layers → freeze + ${sp} SP`, type: "alesh_skill_consume", sourceId: "ALESH" },
      });
    },
  };

  engine.registerPassiveEffect("ALESH", new Effect({
    id: "alesh_skill_consume_watcher", tags: [], duration: 999999, startTime: 0, properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// LASTRITE — talent_1 低温脆性: ultimate treats cold fragility as ×1.2/1.5
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// YVONNE — skill: consume cold/nature attachment → freeze + per-layer damage + gauge
// ---------------------------------------------------------------------------

function registerYvonneSkillConsume(
  engine: SimulationEngine,
  skillLevelMap?: Record<string, Record<string, number>>,
): void {
  const level = skillLevelMap?.["YVONNE"]?.["skill"] ?? 12;
  const idx = Math.max(0, Math.min(11, level - 1));
  const freezeMultRow = getSkillsJsonRowByLabel("YVONNE", "skill", "施加冻结伤害倍率") ?? [];
  const perLayerMultRow = getSkillsJsonRowByLabel("YVONNE", "skill", "消耗每层附着额外伤害倍率") ?? [];
  const baseGaugeRow = getSkillsJsonRowByLabel("YVONNE", "skill", "施加冻结获得终结技能量") ?? [];
  const perLayerGaugeRow = getSkillsJsonRowByLabel("YVONNE", "skill", "消耗每层附着额外获得终结技能量") ?? [];

  const freezeMult = parseFloat(String(freezeMultRow[idx] ?? "150").replace("%", "")) / 100;
  const perLayerMult = parseFloat(String(perLayerMultRow[idx] ?? "200").replace("%", "")) / 100;
  const baseGauge = parseFloat(String(baseGaugeRow[idx] ?? "10"));
  const perLayerGauge = parseFloat(String(perLayerGaugeRow[idx] ?? "30"));

  let consumedForAction = "";

  const trigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      if (action?.node?.type !== "skill") return false;
      if (consumedForAction === e.payload?.actionId) return false;
      const element = ctx.state.enemy.status.getMagicElement();
      return element === "cold" || element === "nature";
    },
    action: (e: any, ctx: SimulationContext) => {
      consumedForAction = e.payload?.actionId || "";
      // Read from frameSnapshot for multiplier, then consume real state
      const stacks = ctx.frameSnapshot.magicStacks;
      const element = ctx.frameSnapshot.magicElement;
      consumeMagicAttachment(ctx); // clear real-time state
      if (stacks <= 0 || !element) return;
      const time = ctx.state.getCurrentTime();

      // Step 1: Force freeze (before damage — enables 冰点 talent)
      const freezeLevel = Math.max(1, Math.min(4, stacks)) as 1 | 2 | 3 | 4;
      ctx.queue.enqueue({
        type: "APPLY_DIRECT_ANOMALY", time,
        payload: { anomalyType: "freeze" as any, level: freezeLevel, sourceActorId: "YVONNE", targetId: "boss", sourceSkillId: "YVONNE_skill" },
      });

      // Step 2: Combined damage (base skill multiplier is on the original DAMAGE_TICK;
      // this is the ADDITIONAL freeze + per-layer damage as a single hit)
      const combinedExtraMult = freezeMult + perLayerMult * stacks;
      if (combinedExtraMult > 0) {
        ctx.queue.enqueue({
          type: "DAMAGE_TICK", time,
          payload: {
            sourceId: "YVONNE", targetId: "boss", damage: 0, stagger: 0,
            tickData: { offset: 0, realTime: time, realOffset: 0, time, multiplier: combinedExtraMult, stagger: 0, sp: 0, boundEffects: [] },
            actionId: e.payload?.actionId || "yvonne_consume_dmg",
          },
        });
      }

      // Step 3: Gauge gain
      const gaugeGain = baseGauge + stacks * perLayerGauge;
      try {
        const actor = ctx.state.getActor("YVONNE");
        actor.modifyGauge(gaugeGain);
        ctx.simLog({
          type: "GAUGE_CHANGE", time,
          payload: { actorId: "YVONNE", change: gaugeGain, gauge: actor.getGauge(), reason: "yvonne_skill_consume" },
        });
      } catch { /* */ }

      ctx.simLog({
        type: "ANOMALY_STATUS_CHANGE", time,
        payload: { description: `YVONNE skill consumed ${stacks} ${element} layers → freeze(lv${freezeLevel}) + combined extra ${(combinedExtraMult*100).toFixed(0)}% + ${gaugeGain} gauge`, type: "yvonne_skill_consume", sourceId: "YVONNE" },
      });
    },
  };

  engine.registerPassiveEffect("YVONNE", new Effect({
    id: "yvonne_skill_consume_watcher", tags: [], duration: 999999, startTime: 0, properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// LASTRITE — talent_1 低温脆性
// ---------------------------------------------------------------------------

/**
 * 低温脆性: ONLY during LASTRITE ultimate DAMAGE_TICK, cold fragility is amplified.
 * Approach: add bonus before each LASTRITE ult DAMAGE_TICK, remove after.
 * This ensures only LASTRITE's ultimate damage benefits, not other sources.
 */
function registerLastriteColdBrittleness(engine: SimulationEngine): void {
  let ampMultiplier = 1.0;
  try {
    const actor = engine.getState().getActor("LASTRITE");
    const effects = (actor.snapshotData.stats as any)?._activeEffects;
    const eff = effects?.find(
      (e: any) => e.type === "fragility_amplify" && e.stat === "cold_dmg",
    );
    if (eff?.value) ampMultiplier = eff.value; // 1.2 or 1.5
  } catch { /* */ }

  if (ampMultiplier <= 1.0) return;

  const extraRatio = ampMultiplier - 1.0; // 0.2 or 0.5

  // Use a DAMAGE_TICK trigger that fires BEFORE handler via the preDamageRegistry
  // mechanism. But preDamageRegistry is boundEffect-based (per tick tag).
  // Instead: use an EffectTrigger that adds+removes around each DAMAGE_TICK.
  // Since TriggerProcessor runs AFTER the handler, we need a different approach.
  //
  // Solution: register an ACTION_START trigger that tracks the ultimate state,
  // and a DAMAGE_TICK trigger that temporarily modifies enemy fragility for
  // just the damage calc by adding to the source actor's own effects as a
  // special zone. But fragility is target-side...
  //
  // Simplest correct approach: subscribe to the engine's event loop and
  // add/remove the bonus around each LASTRITE ult DAMAGE_TICK event.
  // Since we can't intercept before handler, we track ultimate active state
  // and apply a persistent bonus only during the ultimate window.
  // The bonus only applies to LASTRITE's own damage because fragility zone
  // is evaluated per-hit — we accept the minor inaccuracy that any other
  // damage in the same window also sees it. In practice, during LASTRITE's
  // ultimate no other character acts (it's a channel).

  let ultActive = false;

  const startTrigger: EffectTrigger = {
    event: "ACTION_START",
    sourceMustBeWearer: true,
    condition: (e: any) => e.payload?.type === "ultimate",
    action: (_e: any, ctx: SimulationContext) => {
      ultActive = true;
      const enemyEffects = ctx.state.enemy.effects;
      let totalColdFragility = 0;
      for (const inst of enemyEffects.getAll()) {
        const bonuses = inst.effect.properties.dynamicBonuses as any[];
        if (!bonuses) continue;
        for (const db of bonuses) {
          if (db.zone === "fragility" && db.stat === "cold_dmg") {
            totalColdFragility += db.value;
          }
        }
      }
      if (totalColdFragility <= 0) return;

      addOrRefreshBuff(enemyEffects, new Effect({
        id: "lastrite_cold_brittleness_bonus",
        name: "低温脆性",
        tags: [],
        duration: 30,
        startTime: ctx.state.getCurrentTime(),
        properties: {
          dynamicBonuses: [{ stat: "cold_dmg", value: totalColdFragility * extraRatio, zone: "fragility" }] as DynamicBonus[],
        },
      }));
    },
  };

  const endTrigger: EffectTrigger = {
    event: "ACTION_END",
    sourceMustBeWearer: true,
    condition: (e: any) => e.payload?.type === "ultimate",
    action: (_e: any, ctx: SimulationContext) => {
      ultActive = false;
      ctx.state.enemy.effects.removeByEffectId("lastrite_cold_brittleness_bonus");
    },
  };

  engine.registerPassiveEffect("LASTRITE", new Effect({
    id: "lastrite_cold_brittleness_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [startTrigger, endTrigger],
  }));
}

// ---------------------------------------------------------------------------
// ARCLIGHT — ultimate: consume EM attachment → force conduction
// ---------------------------------------------------------------------------

function registerArclightUltForceConduction(engine: SimulationEngine): void {
  let consumedForAction = "";

  const trigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      if (action?.node?.type !== "ultimate") return false;
      if (consumedForAction === e.payload?.actionId) return false;
      // Only on second hit (the detonation) — check if EM attachment exists
      return ctx.state.enemy.status.getMagicElement() === "electro";
    },
    action: (e: any, ctx: SimulationContext) => {
      consumedForAction = e.payload?.actionId || "";
      // Consume EM attachment
      ctx.state.enemy.status.clearMagicAttachment();
      // Force apply conduction
      ctx.queue.enqueue({
        type: "APPLY_DIRECT_ANOMALY",
        time: ctx.state.getCurrentTime(),
        payload: {
          anomalyType: "conduction" as any,
          level: 1 as any,
          sourceActorId: "ARCLIGHT",
          targetId: "boss",
          sourceSkillId: "ARCLIGHT_ultimate",
        },
      });
      ctx.simLog({
        type: "ANOMALY_STATUS_CHANGE",
        time: ctx.state.getCurrentTime(),
        payload: {
          description: "ARCLIGHT ultimate consumed EM attachment → forced conduction",
          type: "arclight_force_conduction",
          sourceId: "ARCLIGHT",
        },
      });
    },
  };

  engine.registerPassiveEffect("ARCLIGHT", new Effect({
    id: "arclight_ult_force_conduction_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// LAEVATAIN — talent 灼心: conditional on 4 magma layers
// ---------------------------------------------------------------------------

function registerLaevatainConditionalResistIgnore(engine: SimulationEngine): void {
  // resistance_ignore is skipped in the runtime_passive loop for LAEVATAIN.
  // This watcher adds/removes it based on magma count (>= 4 layers).
  let isActive = false;

  // Read the resistance_ignore value from actor snapshot at registration time
  let resistIgnoreValue = 0;
  try {
    const actor = engine.state.getActor("LAEVATAIN");
    const activeEffects = (actor.snapshotData.stats as any)?._activeEffects;
    const ri = activeEffects?.find(
      (e: any) => e.scope === "runtime_passive" && e.type === "resistance_ignore",
    );
    if (ri?.value) resistIgnoreValue = ri.value;
  } catch { /* */ }

  if (resistIgnoreValue === 0) return; // no resistance_ignore talent data

  const trigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: false,
    action: (_e: any, ctx: SimulationContext) => {
      try {
        const actor = ctx.state.getActor("LAEVATAIN");
        const magmaCount = actor.effects.getAll()
          .filter((i: any) => i.effect.id === "magma_1").length;
        const shouldBeActive = magmaCount >= 4;

        if (shouldBeActive && !isActive) {
          isActive = true;
          addOrRefreshBuff(actor.effects, new Effect({
            id: "talent_passive_LAEVATAIN",
            name: "灼心",
            tags: [],
            duration: 999999,
            startTime: ctx.state.getCurrentTime(),
            properties: {
              dynamicBonuses: [
                { stat: "all_dmg" as any, value: resistIgnoreValue, zone: "resistance" as any },
              ],
            },
          }));
        } else if (!shouldBeActive && isActive) {
          isActive = false;
          actor.effects.removeByEffectId("talent_passive_LAEVATAIN");
        }
      } catch { /* */ }
    },
  };

  engine.registerPassiveEffect("LAEVATAIN", new Effect({
    id: "laevatain_magma_condition_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// ROSSI — talent_1 沸血: crit on 斫痕 target → extra blaze damage
// ---------------------------------------------------------------------------

function registerRossiBoilingBlood(
  engine: SimulationEngine,
): void {
  // Read talent value from _activeEffects (talent_1 has value 12 or 24)
  let extraMult = 0;
  try {
    const actor = engine.getState().getActor("ROSSI");
    const effects = (actor.snapshotData.stats as any)?._activeEffects;
    // talent_1 is the second stat_bonus/attack_percent entry (talent_0 has value 25/30)
    const matches = effects?.filter(
      (e: any) => e.type === "stat_bonus" && e.stat === "attack_percent" && e.scope === "runtime_conditional",
    ) || [];
    // talent_1 values are 12 or 24 (vs talent_0 values 25 or 30)
    const t1 = matches.find((e: any) => e.value <= 24);
    if (t1?.value) extraMult = t1.value / 100;
  } catch { /* */ }

  if (extraMult <= 0) return;

  const trigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: SimulationContext) => {
      // Must be a crit hit
      if (!(e.payload as any)?._isCrit) return false;
      // Must be a skill hit (技能)
      const action = ctx.getAction(e.payload?.actionId);
      const t = action?.node?.type;
      if (t !== "skill" && t !== "link" && t !== "ultimate") return false;
      // Target must have 爪印斫痕 (rossi_claw_mark_fragility)
      return ctx.state.enemy.effects.getByEffectId("rossi_claw_mark_fragility") !== undefined;
    },
    action: (e: any, ctx: SimulationContext) => {
      const time = ctx.state.getCurrentTime();
      let mult = extraMult;

      // If target is burning, damage × 1.5
      if (ctx.state.enemy.status.burn !== null) {
        mult *= 1.5;
      }

      ctx.queue.enqueue({
        type: "DAMAGE_TICK",
        time,
        payload: {
          sourceId: "ROSSI",
          targetId: "boss",
          damage: 0,
          stagger: 0,
          tickData: {
            offset: 0, realTime: time, realOffset: 0, time,
            multiplier: mult, stagger: 0, sp: 0, boundEffects: [],
          },
          actionId: "rossi_boiling_blood",
        },
      });
    },
  };

  engine.registerPassiveEffect("ROSSI", new Effect({
    id: "rossi_boiling_blood_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// ROSSI — link crit buff + ultimate crit damage buff
// ---------------------------------------------------------------------------

function registerRossiCritBuffs(
  engine: SimulationEngine,
  skillLevelMap?: Record<string, Record<string, number>>,
): void {
  // Link: 暴击率提升 + 暴击伤害提升, 15s, refresh
  const linkLevel = skillLevelMap?.["ROSSI"]?.["link"] ?? 12;
  const linkIdx = Math.max(0, Math.min(11, linkLevel - 1));
  const crRow = getSkillsJsonRowByLabel("ROSSI", "link", "暴击率提升") ?? [];
  const cdRow = getSkillsJsonRowByLabel("ROSSI", "link", "暴击伤害提升") ?? [];
  const durRow = getSkillsJsonRowByLabel("ROSSI", "link", "增益效果的持续时间（秒）") ?? [];
  const critRate = parseFloat(String(crRow[linkIdx] ?? "25").replace("%", ""));
  const critDmg = parseFloat(String(cdRow[linkIdx] ?? "50").replace("%", ""));
  const buffDur = parseFloat(String(durRow[linkIdx] ?? "15"));

  const linkTrigger: EffectTrigger = {
    event: "ACTION_START",
    sourceMustBeWearer: true,
    condition: (e: any) => e.payload?.type === "link",
    action: (_e: any, ctx: SimulationContext) => {
      const time = ctx.state.getCurrentTime();
      const actor = ctx.state.getActor("ROSSI");
      // Crit rate + crit damage buff (uses "crit" zone, aggregated by DamageResolver)
      addOrRefreshBuff(actor.effects, new Effect({
        id: "rossi_link_crit_buff",
        name: "燎影暴击",
        tags: [],
        duration: buffDur,
        startTime: time,
        properties: {
          dynamicBonuses: [
            { stat: "crit_rate", value: critRate, zone: "crit" },
            { stat: "crit_dmg", value: critDmg, zone: "crit" },
          ] as DynamicBonus[],
        },
      }));
    },
  };

  // Ultimate: 暴击伤害提升 60% (固定值, 持续终结技期间)
  const ultTrigger: EffectTrigger = {
    event: "ACTION_START",
    sourceMustBeWearer: true,
    condition: (e: any) => e.payload?.type === "ultimate",
    action: (_e: any, ctx: SimulationContext) => {
      const actor = ctx.state.getActor("ROSSI");
      addOrRefreshBuff(actor.effects, new Effect({
        id: "rossi_ult_crit_dmg",
        name: "利爪暴伤",
        tags: [],
        duration: 10, // ultimate duration
        startTime: ctx.state.getCurrentTime(),
        properties: { dynamicBonuses: [{ stat: "crit_dmg", value: 60, zone: "crit" }] as DynamicBonus[] },
      }));
    },
  };

  engine.registerPassiveEffect("ROSSI", new Effect({
    id: "rossi_crit_buff_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [linkTrigger, ultTrigger],
  }));
}

// ---------------------------------------------------------------------------
// GILBERTA — ultimate spell_vulnerable scales with break stacks
// ---------------------------------------------------------------------------

function registerGilbertaBreakScaling(
  engine: SimulationEngine,
  skillLevelMap?: Record<string, Record<string, number>>,
): void {
  const ultLevel = skillLevelMap?.["GILBERTA"]?.["ultimate"] ?? 12;
  const idx = Math.max(0, Math.min(11, ultLevel - 1));
  const perLayerRow = getSkillsJsonRowByLabel("GILBERTA", "ultimate", "每层破防提升法术脆弱") ?? [];
  const perLayer = parseFloat(String(perLayerRow[idx] ?? "3").replace("%", ""));

  // P2 (乘风而行): per-layer bonus doubled + treat as +1 layer (cap 4)
  let hasP2 = false;
  try {
    const actor = engine.getState().getActor("GILBERTA");
    if (hasPotential(actor.snapshotData, 2)) hasP2 = true;
  } catch { /* */ }

  // After GILBERTA ultimate DAMAGE_TICK, check break stacks and boost spell_vulnerable
  const trigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: SimulationContext) => {
      const action = ctx.getAction(e.payload?.actionId);
      return action?.node?.type === "ultimate" && ctx.state.enemy.status.hasBreak();
    },
    action: (_e: any, ctx: SimulationContext) => {
      const rawStacks = ctx.state.enemy.status.getBreakStacks();
      if (rawStacks <= 0) return;
      const effectiveStacks = hasP2 ? Math.min(rawStacks + 1, 4) : rawStacks;
      const multiplier = hasP2 ? 2 : 1;
      const bonus = effectiveStacks * perLayer * multiplier;
      // Add extra fragility on top of the base spell_vulnerable already applied by Route 2.8
      addOrRefreshBuff(ctx.state.enemy.effects, new Effect({
        id: "gilberta_break_spell_vuln_bonus",
        name: "重力场破防加成",
        tags: [],
        duration: 5, // same as force field
        startTime: ctx.state.getCurrentTime(),
        properties: {
          dynamicBonuses: [{ stat: "arts_dmg", value: bonus, zone: "fragility" }] as DynamicBonus[],
        },
      }));
    },
  };

  engine.registerPassiveEffect("GILBERTA", new Effect({
    id: "gilberta_break_scaling_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// LAEVATAIN — skill consumes magma → apply forced burn
// ---------------------------------------------------------------------------

function registerLaevatainSkillBurn(engine: SimulationEngine): void {
  const trigger: EffectTrigger = {
    event: "ACTION_START",
    sourceMustBeWearer: true,
    condition: (e: any) => e.payload?.type === "skill",
    action: (_e: any, ctx: SimulationContext) => {
      // Check if magma was consumed (magma consumption handler runs on same event)
      // We check if any magma existed before — the consumption handler already removed them.
      // Use a simpler approach: if the "magma_consumed" simLog was just written, apply burn.
      // Actually, just always apply burn after skill — the skill description says it does.
      ctx.queue.enqueue({
        type: "APPLY_DIRECT_ANOMALY",
        time: ctx.state.getCurrentTime(),
        payload: {
          anomalyType: "burn" as any,
          level: 1 as any,
          sourceActorId: "LAEVATAIN",
          targetId: "boss",
          sourceSkillId: "LAEVATAIN_skill",
        },
      });
    },
  };

  engine.registerPassiveEffect("LAEVATAIN", new Effect({
    id: "laevatain_skill_burn_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// XAIHI — ultimate intellect scaling for amplify
// ---------------------------------------------------------------------------

function registerXaihiIntellectScaling(
  engine: SimulationEngine,
  skillLevelMap?: Record<string, Record<string, number>>,
): void {
  const ultLevel = skillLevelMap?.["XAIHI"]?.["ultimate"] ?? 12;
  const idx = Math.max(0, Math.min(11, ultLevel - 1));
  const perPointRow = getSkillsJsonRowByLabel("XAIHI", "ultimate", "每点智识提升的增幅效果") ?? [];
  const capRow = getSkillsJsonRowByLabel("XAIHI", "ultimate", "智识提升增幅上限") ?? [];
  const perPoint = parseFloat(String(perPointRow[idx] ?? "0.03").replace("%", ""));
  const cap = parseFloat(String(capRow[idx] ?? "36").replace("%", ""));

  const trigger: EffectTrigger = {
    event: "ACTION_START",
    sourceMustBeWearer: true,
    condition: (e: any) => e.payload?.type === "ultimate",
    action: (_e: any, ctx: SimulationContext) => {
      const actor = ctx.state.getActor("XAIHI");
      const intellect = actor.snapshotData.stats.intellect || 0;
      const bonus = Math.min(intellect * perPoint, cap);
      if (bonus <= 0) return;

      const time = ctx.state.getCurrentTime();
      // Apply intellect-scaled amplify bonus to all team members (same targets as base buff)
      for (const teammate of ctx.state.getAllActors()) {
        addOrRefreshBuff(teammate.effects, new Effect({
          id: "xaihi_ult_intellect_cold_amp",
          name: "栈溢出智识加成(寒冷)",
          tags: [],
          duration: 12, // same as base buff
          startTime: time,
          properties: {
            dynamicBonuses: [{ stat: "cold_dmg", value: bonus, zone: "amplify" }] as DynamicBonus[],
          },
        }));
        addOrRefreshBuff(teammate.effects, new Effect({
          id: "xaihi_ult_intellect_nature_amp",
          name: "栈溢出智识加成(自然)",
          tags: [],
          duration: 12,
          startTime: time,
          properties: {
            dynamicBonuses: [{ stat: "nature_dmg", value: bonus, zone: "amplify" }] as DynamicBonus[],
          },
        }));
      }
    },
  };

  engine.registerPassiveEffect("XAIHI", new Effect({
    id: "xaihi_intellect_scaling_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// Registration entry point
// ---------------------------------------------------------------------------

/**
 * Register all carrier consumption handlers.
 * Called from simulator.ts after actors are initialized.
 */
export function registerCarrierConsumptionHandlers(
  engine: SimulationEngine,
  actors: ReadonlyArray<{ id: string }>,
  skillLevelMap?: Record<string, Record<string, number>>,
): void {
  const actorIds = new Set(actors.map((a) => a.id));

  if (actorIds.has("ENDMINISTRATOR")) {
    registerEndminCrystalConsumption(engine, skillLevelMap);
  }
  if (actorIds.has("POGRANICHNK")) {
    registerPograniBuffConsumption(engine, skillLevelMap);
  }
  if (actorIds.has("LAEVATAIN")) {
    registerMagmaConsumption(engine);
  }
  if (actorIds.has("TANGTANG")) {
    registerVortexConsumption(engine, skillLevelMap);
  }
  if (actorIds.has("ARCLIGHT")) {
    try {
      const arclight = engine.getState().getActor("ARCLIGHT");
      if (hasPotential(arclight.snapshotData, 1)) {
        registerArclightP1SpRefund(engine);
      }
    } catch { /* actor not found */ }
  }
  if (actorIds.has("WULFGARD")) {
    registerWulfgardSkillConsume(engine, skillLevelMap);
    try {
      const wulfgard = engine.getState().getActor("WULFGARD");
      if (hasPotential(wulfgard.snapshotData, 5)) {
        registerWulfgardUltLinkCdReset(engine);
      }
    } catch { /* actor not found */ }
  }
  if (actorIds.has("DAPAN")) {
    registerDapanBuffConsumption(engine);
  }
  if (actorIds.has("POGRANICHNK")) {
    registerPograniSkillBreakSp(engine, skillLevelMap);
  }
  if (actorIds.has("ROSSI")) {
    registerRossiCritBuffs(engine, skillLevelMap);
    registerRossiLinkConsume(engine, skillLevelMap);
    registerRossiBoilingBlood(engine);
  }
  if (actorIds.has("GILBERTA")) {
    registerGilbertaBreakScaling(engine, skillLevelMap);
  }
  if (actorIds.has("LAEVATAIN")) {
    registerLaevatainSkillBurn(engine);
  }
  if (actorIds.has("XAIHI")) {
    registerXaihiIntellectScaling(engine, skillLevelMap);
  }
  if (actorIds.has("LASTRITE")) {
    registerLastritePhantom(engine, skillLevelMap);
    registerLastriteLinkConsume(engine, skillLevelMap);
    registerLastriteColdBrittleness(engine);
  }
  if (actorIds.has("ALESH")) {
    registerAleshSkillConsume(engine, skillLevelMap);
  }
  if (actorIds.has("YVONNE")) {
    registerYvonneSkillConsume(engine, skillLevelMap);
  }
  if (actorIds.has("ANTAL")) {
    registerAntalLinkReapply(engine);
  }
  if (actorIds.has("ARCLIGHT")) {
    registerArclightUltForceConduction(engine);
  }
  if (actorIds.has("LAEVATAIN")) {
    registerLaevatainConditionalResistIgnore(engine);
  }
  if (actorIds.has("AKEKURI")) {
    registerAkekuriUltimateBuffs(engine);
  }
  if (actorIds.has("ESTELLA")) {
    registerEstellaIceShatterSp(engine);
  }
  if (actorIds.has("ANTAL")) {
    try {
      const antal = engine.getState().getActor("ANTAL");
      if (hasPotential(antal.snapshotData, 5)) {
        registerAntalP5FocusTimer(engine);
      }
    } catch { /* */ }
  }
  if (actorIds.has("AVYWENNA")) {
    registerAvywennaLanceGauge(engine);
  }
  if (actorIds.has("DAPAN")) {
    try {
      const dapan = engine.getState().getActor("DAPAN");
      if (hasPotential(dapan.snapshotData, 5)) {
        registerDapanP5ExtraBreak(engine);
      }
    } catch { /* */ }
  }
  if (actorIds.has("ALESH")) {
    registerAleshLinkRareFish(engine, skillLevelMap);
  }
  if (actorIds.has("FLUORITE")) {
    try {
      const fluorite = engine.getState().getActor("FLUORITE");
      if (hasPotential(fluorite.snapshotData, 5)) {
        registerFluoriteAttachmentCdReduction(engine);
      }
    } catch { /* */ }
  }
}

// ---------------------------------------------------------------------------
// FLUORITE — P5: 享受混乱 — cold/nature attachment → link CD-1s (ICD 1s)
// ---------------------------------------------------------------------------

function registerFluoriteAttachmentCdReduction(engine: SimulationEngine): void {
  const trigger: EffectTrigger = {
    event: "APPLY_MAGIC_ATTACHMENT",
    sourceMustBeWearer: false, // any source
    cooldownId: "fluorite_p5_attach_cd_icd",
    cooldownDuration: 1,
    condition: (e: any) => {
      const element = e.payload?.element;
      return element === "cold" || element === "nature";
    },
    action: (_e: any, ctx: SimulationContext) => {
      const actor = ctx.state.getActor("FLUORITE");
      actor.reduceCooldown("FLUORITE_link", 1);
    },
  };

  engine.registerPassiveEffect("FLUORITE", new Effect({
    id: "fluorite_p5_attach_cd_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// AKEKURI — ultimate: 心流时间 (combo buff) + P3 (team ATK) + P5 (+5s)
// ---------------------------------------------------------------------------

/**
 * AKEKURI talent_1 心流时间: on ultimate cast → apply combo buff for ultimate duration.
 * P3 (全力协作): also apply team ATK+10% for same duration.
 * P5 (残心节奏): combo buff duration +5s.
 *
 * The 3 SP recovery hits during ultimate are placed as timeline hits by the user.
 */
function registerAkekuriUltimateBuffs(engine: SimulationEngine): void {
  let hasP3 = false;
  let hasP5 = false;
  try {
    const actor = engine.getState().getActor("AKEKURI");
    hasP3 = hasPotential(actor.snapshotData, 3);
    hasP5 = hasPotential(actor.snapshotData, 5);
  } catch { /* */ }

  const trigger: EffectTrigger = {
    event: "ACTION_START",
    sourceMustBeWearer: true,
    condition: (e: any) => e.payload?.type === "ultimate",
    action: (e: any, ctx: SimulationContext) => {
      const time = ctx.state.getCurrentTime();
      const action = ctx.getAction(e.payload?.actionId);
      // Duration = ultimate action duration
      const baseDuration = action?.duration ?? 5;
      const comboDuration = hasP5 ? baseDuration + 5 : baseDuration;

      // Apply combo buff to all teammates
      for (const teammate of ctx.state.getAllActors()) {
        addOrRefreshBuff(
          teammate.effects,
          new Effect({
            id: "akekuri_combo",
            name: "连击(心流时间)",
            tags: [],
            duration: comboDuration,
            startTime: time,
            properties: {
              dynamicBonuses: [{ stat: "all_dmg" as const, value: 30, zone: "combo" as const }],
            },
          }),
        );
      }

      // P3: team ATK+10% for ultimate duration
      if (hasP3) {
        for (const teammate of ctx.state.getAllActors()) {
          addOrRefreshBuff(
            teammate.effects,
            new Effect({
              id: "akekuri_p3_team_atk",
              name: "全力协作",
              tags: [],
              duration: baseDuration,
              startTime: time,
              properties: {
                dynamicBonuses: [{ stat: "all_dmg" as const, value: 10, zone: "attackPercent" as const }],
              },
            }),
          );
        }
      }
    },
  };

  engine.registerPassiveEffect("AKEKURI", new Effect({
    id: "akekuri_ult_buff_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// ESTELLA — talent_0 同病相怜: ice shatter → next skill refunds SP
// ---------------------------------------------------------------------------

function registerEstellaIceShatterSp(engine: SimulationEngine): void {
  // Read SP refund value from talent data (7.5 at P1, 15 at P2)
  let spRefundAmount = 7.5;
  try {
    const actor = engine.state.getActor("ESTELLA");
    const promotion = (actor.snapshotData.stats as any)?._promotionStage ?? 1;
    spRefundAmount = promotion >= 2 ? 15 : 7.5;
  } catch { /* */ }

  // Trigger 1: on ANOMALY_DAMAGE with damageSource=shatter → set charge
  const shatterTrigger: EffectTrigger = {
    event: "ANOMALY_DAMAGE",
    sourceMustBeWearer: false,
    condition: (e: any) => e.payload?.tags?.damageSource === "shatter",
    action: (_e: any, ctx: SimulationContext) => {
      const actor = ctx.state.getActor("ESTELLA");
      if (actor.effects.getByEffectId("estella_shatter_charge")) return;
      actor.effects.add(new Effect({
        id: "estella_shatter_charge",
        name: "同病相怜",
        tags: [],
        duration: 999999,
        startTime: ctx.state.getCurrentTime(),
        properties: {},
      }));
    },
  };

  // Trigger 2: on skill ACTION_START → consume charge + refund SP
  const skillTrigger: EffectTrigger = {
    event: "ACTION_START",
    sourceMustBeWearer: true,
    condition: (e: any) => e.payload?.type === "skill",
    action: (_e: any, ctx: SimulationContext) => {
      const actor = ctx.state.getActor("ESTELLA");
      const charge = actor.effects.getByEffectId("estella_shatter_charge");
      if (!charge) return;
      actor.effects.removeByEffectId("estella_shatter_charge");
      enqueueSpRefund(ctx, spRefundAmount, "estella_shatter_sp", "ESTELLA");
    },
  };

  engine.registerPassiveEffect("ESTELLA", new Effect({
    id: "estella_ice_shatter_sp_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [shatterTrigger, skillTrigger],
  }));
}

// ---------------------------------------------------------------------------
// ANTAL P5 — 高规格技术: antal_buff on target for 20s → fragility +4%
// ---------------------------------------------------------------------------

function registerAntalP5FocusTimer(engine: SimulationEngine): void {
  let buffAppliedTime = -1;
  let bonusActive = false;

  const trigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: false,
    action: (_e: any, ctx: SimulationContext) => {
      const time = ctx.state.getCurrentTime();
      const enemyEffects = ctx.state.enemy.effects;
      const hasAntalBuff = enemyEffects.getByEffectId("antal_buff") !== undefined;

      if (hasAntalBuff && buffAppliedTime < 0) {
        buffAppliedTime = time;
      } else if (!hasAntalBuff) {
        buffAppliedTime = -1;
        if (bonusActive) {
          bonusActive = false;
          enemyEffects.removeByEffectId("antal_p5_focus_fragility");
        }
        return;
      }

      if (!bonusActive && buffAppliedTime >= 0 && (time - buffAppliedTime) >= 20) {
        bonusActive = true;
        addOrRefreshBuff(enemyEffects, new Effect({
          id: "antal_p5_focus_fragility",
          name: "高规格技术",
          tags: [],
          duration: 999999,
          startTime: time,
          properties: {
            dynamicBonuses: [
              { stat: "emag_dmg" as any, value: 4, zone: "fragility" as any },
              { stat: "blaze_dmg" as any, value: 4, zone: "fragility" as any },
            ],
          },
        }));
      }
    },
  };

  engine.registerPassiveEffect("ANTAL", new Effect({
    id: "antal_p5_focus_timer",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// AVYWENNA — talent_0 高效派送: thunderlance hit → ult gauge + P1 bonus
// ---------------------------------------------------------------------------

function registerAvywennaLanceGauge(engine: SimulationEngine): void {
  // Read talent value (3 at P1 unlock, 4 at P2 upgrade)
  let baseGauge = 3;
  let p1Bonus = 0;
  try {
    const actor = engine.state.getActor("AVYWENNA");
    const promotion = (actor.snapshotData.stats as any)?._promotionStage ?? 1;
    baseGauge = promotion >= 2 ? 4 : 3;
    if (hasPotential(actor.snapshotData, 1)) p1Bonus = 2;
  } catch { /* */ }

  const gaugePerHit = baseGauge + p1Bonus;

  const trigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: any) => {
      const action = ctx.getAction(e.payload?.actionId);
      const t = action?.node?.type;
      return t === "skill" || t === "link";
    },
    action: (_e: any, ctx: SimulationContext) => {
      const actor = ctx.state.getActor("AVYWENNA");
      actor.modifyGauge(gaugePerHit);
      ctx.simLog({
        type: "GAUGE_CHANGE",
        time: ctx.state.getCurrentTime(),
        payload: {
          actorId: "AVYWENNA",
          change: gaugePerHit,
          gauge: actor.getGauge(),
          reason: "talent_lance_hit",
        },
      });
    },
  };

  engine.registerPassiveEffect("AVYWENNA", new Effect({
    id: "avywenna_lance_gauge_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// DAPAN P5 — 猛火收汁: skill single-target hit → extra break stack (ICD 45s)
// TODO: currently assumes single-target (always procs). Multi-target check not implemented.
// ---------------------------------------------------------------------------

function registerDapanP5ExtraBreak(engine: SimulationEngine): void {
  let lastProcTime = -999;

  const trigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: any) => {
      const action = ctx.getAction(e.payload?.actionId);
      if (action?.node?.type !== "skill") return false;
      const time = ctx.state.getCurrentTime();
      return (time - lastProcTime) >= 45;
    },
    action: (_e: any, ctx: SimulationContext) => {
      lastProcTime = ctx.state.getCurrentTime();
      // TODO: single-target check not implemented — defaulting to always true
      ctx.queue.enqueue({
        type: "APPLY_PHYSICAL_ANOMALY",
        time: ctx.state.getCurrentTime(),
        payload: {
          physicalType: "slam" as any,
          sourceActorId: "DAPAN",
          targetId: "boss",
          sourceSkillId: "dapan_p5_extra_break",
          stacks: 1,
        },
      });
    },
  };

  engine.registerPassiveEffect("DAPAN", new Effect({
    id: "dapan_p5_extra_break_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}

// ---------------------------------------------------------------------------
// ALESH — link 珍鳞 (rare fish): probabilistic enhanced link + P3 team ATK
// ---------------------------------------------------------------------------

function registerAleshLinkRareFish(
  engine: SimulationEngine,
  skillLevelMap?: Record<string, Record<string, number>>,
): void {
  // Read probability and multiplier data
  const linkLevel = skillLevelMap?.["ALESH"]?.["link"] ?? 12;
  const levelIdx = Math.max(0, Math.min(11, linkLevel - 1));

  const baseProbRow = getSkillsJsonRowByLabel("ALESH", "link", "钓起珍鳞概率") ?? [];
  const baseProbability = parseFloat(String(baseProbRow[levelIdx] ?? "10").replace("%", ""));

  const normalMultRow = getSkillsJsonRowByLabel("ALESH", "link", "伤害倍率") ?? [];
  const enhancedMultRow = getSkillsJsonRowByLabel("ALESH", "link", "强化伤害倍率") ?? [];
  const normalMult = parseFloat(String(normalMultRow[levelIdx] ?? "0").replace("%", ""));
  const enhancedMult = parseFloat(String(enhancedMultRow[levelIdx] ?? "0").replace("%", ""));

  const extraSpRow = getSkillsJsonRowByLabel("ALESH", "link", "额外技力恢复") ?? [];
  const extraSp = parseFloat(String(extraSpRow[levelIdx] ?? "0"));

  // Talent_1 (钓鳞老手): probability bonus from intellect
  let talentProbBonus = 0;
  let hasP3 = false;
  try {
    const actor = engine.state.getActor("ALESH");
    const intellect = actor.snapshotData.stats.intellect || 0;
    const promotion = (actor.snapshotData.stats as any)?._promotionStage ?? 1;
    // P2 unlock: +0.2% per 10 intellect; P3 upgrade: +0.5% per 10 intellect; max +30%
    if (promotion >= 3) {
      talentProbBonus = Math.min(30, Math.floor(intellect / 10) * 0.5);
    } else if (promotion >= 2) {
      talentProbBonus = Math.min(30, Math.floor(intellect / 10) * 0.2);
    }
    hasP3 = hasPotential(actor.snapshotData, 3);
  } catch { /* */ }

  const totalProbability = Math.min(100, baseProbability + talentProbBonus);
  let prockedForAction = "";

  const trigger: EffectTrigger = {
    event: "DAMAGE_TICK",
    sourceMustBeWearer: true,
    condition: (e: any, ctx: any) => {
      const action = ctx.getAction(e.payload?.actionId);
      return action?.node?.type === "link" && prockedForAction !== e.payload?.actionId;
    },
    action: (e: any, ctx: SimulationContext) => {
      prockedForAction = e.payload?.actionId || "";

      // Determine if 珍鳞 procs
      let procs = false;
      if (ctx.rng) {
        procs = ctx.rng.next() * 100 < totalProbability;
      } else {
        // Expected mode: no RNG — skip probabilistic effects
        // The expected damage bonus is applied as probability-weighted multiplier
        procs = false;
      }

      if (procs && enhancedMult > normalMult) {
        // Add bonus damage: enhanced - normal mult difference
        const bonusMult = enhancedMult - normalMult;
        const time = ctx.state.getCurrentTime();
        ctx.queue.enqueue({
          type: "DAMAGE_TICK",
          time,
          payload: {
            sourceId: "ALESH",
            targetId: "boss",
            damage: 0,
            stagger: 0,
            tickData: {
              offset: 0, realTime: time, realOffset: 0, time,
              multiplier: bonusMult,
              stagger: 0, sp: 0, boundEffects: [],
            },
            actionId: e.payload?.actionId || "",
          },
        });

        // Extra SP recovery
        if (extraSp > 0) {
          enqueueSpRefund(ctx, extraSp, "alesh_rare_fish_sp", "ALESH");
        }

        ctx.simLog({
          type: "ANOMALY_STATUS_CHANGE",
          time,
          payload: {
            description: `珍鳞 proc! (+${bonusMult}% mult, +${extraSp} SP)`,
            type: "alesh_rare_fish",
            sourceId: "ALESH",
          },
        });

        // P3 (愿者上钩): team ATK+15%, 10s, no stack
        if (hasP3) {
          for (const teammate of ctx.state.getAllActors()) {
            addOrRefreshBuff(teammate.effects, new Effect({
              id: "alesh_p3_team_atk",
              name: "愿者上钩",
              tags: [],
              duration: 10,
              startTime: time,
              properties: {
                dynamicBonuses: [{ stat: "all_dmg" as any, value: 15, zone: "attackPercent" as any }],
              },
            }));
          }
        }
      }
    },
  };

  engine.registerPassiveEffect("ALESH", new Effect({
    id: "alesh_rare_fish_watcher",
    tags: [],
    duration: 999999,
    startTime: 0,
    properties: {},
    triggers: [trigger],
  }));
}
