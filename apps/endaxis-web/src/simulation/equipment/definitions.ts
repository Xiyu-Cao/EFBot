/**
 * Real equipment set and weapon passive definitions.
 *
 * IMPORTANT: Static stat bonuses (passiveStats, affixes, base ATK) are
 * already applied to ActorSnapshot.stats via the timelineStore delta mechanism.
 * This file ONLY defines triggered/runtime effects:
 * - Trigger conditions and actions
 * - ICD / stack policy
 * - Runtime buff creation
 * - Equipment proc damage
 *
 * Do NOT add `stats.xxx += N` here — that would double-count.
 */

import { Effect } from "../effects/types";
import type { SimulationEngine } from "../engine/SimulationEngine";
import type { SimulationContext } from "../engine/SimulationContext";
import type { DiagnosticCollector } from "../diagnostics";
import { buildDamageTags } from "../calculation/damageTypes";
import {
  addOrRefreshBuff,
  addStackWithIndependentDuration,
  applyBuffToTargets,
  type DynamicBonus,
} from "./types";
import {
  registerWeaponFromData,
  type WeaponBuffAction,
  type WeaponData,
} from "./weaponDataAdapter";

// ===========================================================================
// 1. 点剑 (Dianjian) — 3-piece set
// ===========================================================================
//
// Static: +20% stagger efficiency (TODO: stagger efficiency stat)
// Trigger: On physical anomaly → 250% ATK physical equipmentProc + 10 stagger
// ICD: 15s

export function registerDianjianSet(
  engine: SimulationEngine,
  actorId: string,
): void {
  const passive = new Effect({
    id: "dianjian_3pc",
    tags: [],
    duration: Infinity,
    triggers: [
      {
        event: "APPLY_PHYSICAL_ANOMALY" as any,
        sourceMustBeWearer: true,
        deferred: true, // fires after physical anomaly fully completes (猛击完成后)
        cooldownId: "dianjian_3pc_icd",
        cooldownDuration: 15,
        action: (e: any, ctx: SimulationContext) => {
          const sourceId = e.payload.sourceActorId;
          const time = e.time;

          ctx.queue.enqueue({
            type: "ANOMALY_DAMAGE",
            time,
            payload: {
              multiplier: 2.5,
              tags: buildDamageTags({
                sourceActorId: sourceId,
                targetEnemyId: "boss",
                damageType: "physical",
                damageSource: "equipmentProc",
                sourceEffectId: "dianjian_3pc",
              }),
            },
          });

          ctx.queue.enqueue({
            type: "STAGGER_CHANGE",
            time,
            payload: {
              stagger: 10,
              actorId: sourceId,
              actionId: "dianjian_3pc",
              targetId: "boss",
            },
          });
        },
      },
    ],
  });

  engine.registerPassiveEffect(actorId, passive);
}

// ===========================================================================
// 2. 动火用 (Donghuoyong) — 3-piece set
// ===========================================================================
//
// Static: +30 originium arts power (handled by timelineStore delta — NOT here)
// Trigger 1: Direct burn → +50% blaze dmg, 10s, no stack
// Trigger 2: Direct corrosion → +50% nature dmg, 10s, no stack

export function registerDonghuoyongSet(
  engine: SimulationEngine,
  actorId: string,
): void {
  // NOTE: +30 originium_arts_power is a static set bonus.
  // It's applied via timelineStore's equipment delta mechanism,
  // so it's already in ActorSnapshot.stats. Do NOT += here.

  const passive = new Effect({
    id: "donghuoyong_3pc",
    tags: [],
    duration: Infinity,
    triggers: [
      {
        event: "APPLY_DIRECT_ANOMALY" as any,
        sourceMustBeWearer: true,
        condition: (e: any) => e.payload.anomalyType === "burn",
        action: (_e: any, ctx: SimulationContext) => {
          const actorState = ctx.state.getActor(actorId);
          addOrRefreshBuff(
            actorState.effects,
            new Effect({
              id: "donghuoyong_blaze_buff",
              tags: [],
              duration: 10,
              startTime: ctx.state.getCurrentTime(),
              properties: {
                dynamicBonuses: [
                  { stat: "blaze_dmg", value: 50 },
                ] as DynamicBonus[],
              },
            }),
          );
        },
      },
      {
        event: "APPLY_DIRECT_ANOMALY" as any,
        sourceMustBeWearer: true,
        condition: (e: any) => e.payload.anomalyType === "corrosion",
        action: (_e: any, ctx: SimulationContext) => {
          const actorState = ctx.state.getActor(actorId);
          addOrRefreshBuff(
            actorState.effects,
            new Effect({
              id: "donghuoyong_nature_buff",
              tags: [],
              duration: 10,
              startTime: ctx.state.getCurrentTime(),
              properties: {
                dynamicBonuses: [
                  { stat: "nature_dmg", value: 50 },
                ] as DynamicBonus[],
              },
            }),
          );
        },
      },
    ],
  });

  engine.registerPassiveEffect(actorId, passive);
}

// ===========================================================================
// 3. 脉冲式 (Maichongshi) — 3-piece set
// ===========================================================================
//
// Static: +30 originium arts power (handled by timelineStore delta)
// Trigger 1: Direct conduction → +50% emag dmg, 10s, no stack
// Trigger 2: Direct freeze → +50% cold dmg, 10s, no stack

export function registerMaichongshiSet(
  engine: SimulationEngine,
  actorId: string,
): void {
  const passive = new Effect({
    id: "maichongshi_3pc",
    tags: [],
    duration: Infinity,
    triggers: [
      {
        event: "APPLY_DIRECT_ANOMALY" as any,
        sourceMustBeWearer: true,
        condition: (e: any) => e.payload.anomalyType === "conduction",
        action: (_e: any, ctx: SimulationContext) => {
          const actorState = ctx.state.getActor(actorId);
          addOrRefreshBuff(
            actorState.effects,
            new Effect({
              id: "maichongshi_emag_buff",
              tags: [],
              duration: 10,
              startTime: ctx.state.getCurrentTime(),
              properties: {
                dynamicBonuses: [
                  { stat: "emag_dmg", value: 50 },
                ] as DynamicBonus[],
              },
            }),
          );
        },
      },
      {
        event: "APPLY_DIRECT_ANOMALY" as any,
        sourceMustBeWearer: true,
        condition: (e: any) => e.payload.anomalyType === "freeze",
        action: (_e: any, ctx: SimulationContext) => {
          const actorState = ctx.state.getActor(actorId);
          addOrRefreshBuff(
            actorState.effects,
            new Effect({
              id: "maichongshi_cold_buff",
              tags: [],
              duration: 10,
              startTime: ctx.state.getCurrentTime(),
              properties: {
                dynamicBonuses: [
                  { stat: "cold_dmg", value: 50 },
                ] as DynamicBonus[],
              },
            }),
          );
        },
      },
    ],
  });

  engine.registerPassiveEffect(actorId, passive);
}

// ===========================================================================
// 4. 潮涌 (Chaoyong) — 3-piece set
// ===========================================================================
//
// Static: +20% all skill damage (handled by timelineStore delta)
// Trigger: When attachment stacks reach >= 2 → +35% arts dmg, 15s, no stack

export function registerChaoyongSet(
  engine: SimulationEngine,
  actorId: string,
): void {
  const passive = new Effect({
    id: "chaoyong_3pc",
    tags: [],
    duration: Infinity,
    triggers: [
      {
        event: "APPLY_MAGIC_ATTACHMENT" as any,
        sourceMustBeWearer: true,
        condition: (_e: any, ctx: SimulationContext) => {
          return ctx.state.enemy.status.getMagicStacks() >= 2;
        },
        action: (_e: any, ctx: SimulationContext) => {
          const actorState = ctx.state.getActor(actorId);
          addOrRefreshBuff(
            actorState.effects,
            new Effect({
              id: "chaoyong_arts_buff",
              tags: [],
              duration: 15,
              startTime: ctx.state.getCurrentTime(),
              properties: {
                dynamicBonuses: [
                  { stat: "arts_dmg", value: 35 },
                ] as DynamicBonus[],
              },
            }),
          );
        },
      },
    ],
  });

  engine.registerPassiveEffect(actorId, passive);
}

// ===========================================================================
// 5. M.I.警用 (MI Jingyon) — 3-piece set
// ===========================================================================
//
// Static: +5% crit rate (timelineStore delta)
// Trigger: On crit hit → +5% ATK, 5s, max 5 stacks (refresh per layer).
//   When stacks reach 5 → extra +5% crit rate (no stack, refresh).

export function registerMIJingyongSet(
  engine: SimulationEngine,
  actorId: string,
): void {
  let stackCount = 0;

  const passive = new Effect({
    id: "mi_jingyong_3pc",
    tags: [],
    duration: Infinity,
    triggers: [
      {
        event: "DAMAGE_TICK" as any,
        sourceMustBeWearer: true,
        condition: (e: any) => (e.payload as any)?._isCrit === true,
        action: (_e: any, ctx: SimulationContext) => {
          const time = ctx.state.getCurrentTime();
          const actorState = ctx.state.getActor(actorId);
          stackCount = Math.min(5, stackCount + 1);
          addOrRefreshBuff(actorState.effects, new Effect({
            id: "mi_jingyong_atk",
            name: "M.I.警用",
            tags: [],
            duration: 5,
            startTime: time,
            properties: {
              dynamicBonuses: [
                { stat: "all_dmg", value: 5 * stackCount, zone: "attackPercent" },
              ] as DynamicBonus[],
            },
          }));
          if (stackCount >= 5) {
            addOrRefreshBuff(actorState.effects, new Effect({
              id: "mi_jingyong_crit",
              name: "M.I.警用(暴击)",
              tags: [],
              duration: 5,
              startTime: time,
              properties: {
                dynamicBonuses: [
                  { stat: "all_dmg", value: 5, zone: "crit" },
                ] as DynamicBonus[],
              },
            }));
          }
        },
      },
    ],
  });

  engine.registerPassiveEffect(actorId, passive);
}

// ===========================================================================
// 6. 拓荒 (Tuohuang) — 3-piece set
// ===========================================================================
//
// Static: +15% link CD reduction (timelineStore delta)
// Trigger: SP recovery from skill → team all damage +16%, 15s, no stack

export function registerTuohuangSet(
  engine: SimulationEngine,
  actorId: string,
): void {
  const passive = new Effect({
    id: "tuohuang_3pc",
    tags: [],
    duration: Infinity,
    triggers: [
      {
        event: "SP_CHANGE" as any,
        sourceMustBeWearer: true,
        condition: (e: any) => e.payload.spChange > 0 && e.payload.reason === "damage",
        action: (_e: any, ctx: SimulationContext) => {
          const time = ctx.state.getCurrentTime();
          for (const actor of ctx.state.getAllActors()) {
            addOrRefreshBuff(actor.effects, new Effect({
              id: "tuohuang_team_dmg",
              name: "拓荒",
              tags: [],
              duration: 15,
              startTime: time,
              properties: {
                dynamicBonuses: [
                  { stat: "all_dmg", value: 16, zone: "damageBonus" },
                ] as DynamicBonus[],
              },
            }));
          }
        },
      },
    ],
  });

  engine.registerPassiveEffect(actorId, passive);
}

// ===========================================================================
// 7. 碾骨 (Niangu) — 3-piece set
// ===========================================================================
//
// Static: +15% ATK (timelineStore delta)
// Trigger: On link cast → gain 碾骨重压 stack (next skill +30%, max 2 stacks, consumed on skill)

export function registerNianguSet(
  engine: SimulationEngine,
  actorId: string,
): void {
  const passive = new Effect({
    id: "niangu_3pc",
    tags: [],
    duration: Infinity,
    triggers: [
      {
        event: "ACTION_START" as any,
        sourceMustBeWearer: true,
        condition: (e: any) => e.payload.type === "link",
        action: (_e: any, ctx: SimulationContext) => {
          const time = ctx.state.getCurrentTime();
          const actorState = ctx.state.getActor(actorId);
          const existing = actorState.effects.getByEffectId("niangu_stack");
          const stacks = existing ? Math.min(1, (existing.effect.properties?.stacks ?? 0)) : 0;
          addOrRefreshBuff(actorState.effects, new Effect({
            id: "niangu_stack",
            name: "碾骨重压",
            tags: [],
            duration: 999999,
            startTime: time,
            properties: {
              stacks: Math.min(2, stacks + 1),
              dynamicBonuses: [
                { stat: "all_dmg", value: 30 * Math.min(2, stacks + 1), zone: "damageBonus" },
              ] as DynamicBonus[],
              _consumeOnSkill: true,
            },
          }));
        },
      },
      {
        event: "ACTION_START" as any,
        sourceMustBeWearer: true,
        condition: (e: any) => e.payload.type === "skill",
        action: (_e: any, ctx: SimulationContext) => {
          // Consume stacks after skill benefits from them (deferred would be better, but this is post-start)
          const actorState = ctx.state.getActor(actorId);
          actorState.effects.removeByEffectId("niangu_stack");
        },
        deferred: true,
      },
    ],
  });

  engine.registerPassiveEffect(actorId, passive);
}

// ===========================================================================
// 8. 50式应龙 (50shi Yinglong) — 3-piece set
// ===========================================================================
//
// Static: +15% ATK (timelineStore delta)
// Trigger: Any ally skill cast → wearer gains 应龙之锐 (next link +20%, max 3 stacks, consumed on link)

export function registerYinglongSet(
  engine: SimulationEngine,
  actorId: string,
): void {
  const passive = new Effect({
    id: "yinglong_3pc",
    tags: [],
    duration: Infinity,
    triggers: [
      {
        event: "ACTION_START" as any,
        sourceMustBeWearer: false,
        condition: (e: any) => e.payload.type === "skill",
        action: (_e: any, ctx: SimulationContext) => {
          const time = ctx.state.getCurrentTime();
          const actorState = ctx.state.getActor(actorId);
          const existing = actorState.effects.getByEffectId("yinglong_stack");
          const stacks = existing ? Math.min(2, (existing.effect.properties?.stacks ?? 0)) : 0;
          addOrRefreshBuff(actorState.effects, new Effect({
            id: "yinglong_stack",
            name: "应龙之锐",
            tags: [],
            duration: 999999,
            startTime: time,
            properties: {
              stacks: Math.min(3, stacks + 1),
              dynamicBonuses: [
                { stat: "all_dmg", value: 20 * Math.min(3, stacks + 1), zone: "damageBonus" },
              ] as DynamicBonus[],
              _consumeOnLink: true,
            },
          }));
        },
      },
      {
        event: "ACTION_START" as any,
        sourceMustBeWearer: true,
        condition: (e: any) => e.payload.type === "link",
        action: (_e: any, ctx: SimulationContext) => {
          const actorState = ctx.state.getActor(actorId);
          actorState.effects.removeByEffectId("yinglong_stack");
        },
        deferred: true,
      },
    ],
  });

  engine.registerPassiveEffect(actorId, passive);
}

// ===========================================================================
// 9. 阿伯莉遗声 (Aboli Yisheng) — 3-piece set
// ===========================================================================
//
// Static: +24% all skill damage (timelineStore delta)
// Trigger: Skill/Link/Ultimate cast → +5% ATK each, 15s, three independent buffs

export function registerAboliSet(
  engine: SimulationEngine,
  actorId: string,
): void {
  const types = ["skill", "link", "ultimate"] as const;
  const triggers = types.map((t) => ({
    event: "ACTION_START" as any,
    sourceMustBeWearer: true,
    condition: (e: any) => e.payload.type === t,
    action: (_e: any, ctx: SimulationContext) => {
      const actorState = ctx.state.getActor(actorId);
      addOrRefreshBuff(actorState.effects, new Effect({
        id: `aboli_atk_${t}`,
        name: `阿伯莉遗声(${t})`,
        tags: [],
        duration: 15,
        startTime: ctx.state.getCurrentTime(),
        properties: {
          dynamicBonuses: [
            { stat: "all_dmg", value: 5, zone: "attackPercent" },
          ] as DynamicBonus[],
        },
      }));
    },
  }));

  engine.registerPassiveEffect(actorId, new Effect({
    id: "aboli_3pc",
    tags: [],
    duration: Infinity,
    triggers,
  }));
}

// ===========================================================================
// 10. 轻超域 (Qingchaoyu) — 3-piece set
// ===========================================================================
//
// Static: +8% ATK (timelineStore delta)
// Trigger 1: On break stack applied → +8% physical dmg, 15s, max 4 stacks (refresh all)
// Trigger 2: When target reaches 4 break stacks → extra +16% physical dmg, 10s, no stack

export function registerQingchaoyuSet(
  engine: SimulationEngine,
  actorId: string,
): void {
  let stackCount = 0;

  const passive = new Effect({
    id: "qingchaoyu_3pc",
    tags: [],
    duration: Infinity,
    triggers: [
      {
        event: "STAGGER_CHANGE" as any,
        sourceMustBeWearer: true,
        action: (_e: any, ctx: SimulationContext) => {
          const time = ctx.state.getCurrentTime();
          const actorState = ctx.state.getActor(actorId);
          stackCount = Math.min(4, stackCount + 1);
          addOrRefreshBuff(actorState.effects, new Effect({
            id: "qingchaoyu_phys",
            name: "轻超域",
            tags: [],
            duration: 15,
            startTime: time,
            properties: {
              dynamicBonuses: [
                { stat: "physical_dmg", value: 8 * stackCount, zone: "damageBonus" },
              ] as DynamicBonus[],
            },
          }));
          // Check if enemy has 4 break stacks
          const breakStacks = ctx.state.enemy.status.getBreakStacks?.() ?? 0;
          if (breakStacks >= 4) {
            addOrRefreshBuff(actorState.effects, new Effect({
              id: "qingchaoyu_phys_extra",
              name: "轻超域(满破防)",
              tags: [],
              duration: 10,
              startTime: time,
              properties: {
                dynamicBonuses: [
                  { stat: "physical_dmg", value: 16, zone: "damageBonus" },
                ] as DynamicBonus[],
              },
            }));
          }
        },
      },
    ],
  });

  engine.registerPassiveEffect(actorId, passive);
}

// ===========================================================================
// 11. 天灾防护 (Tianzai Fanghu) — 3-piece set
// ===========================================================================
//
// Static: +20% ult charge efficiency (timelineStore delta)
// Trigger: On skill cast → refund 50 SP. Max 1 trigger per battle.

export function registerTianzaiFanghuSet(
  engine: SimulationEngine,
  actorId: string,
): void {
  let triggered = false;

  const passive = new Effect({
    id: "tianzai_fanghu_3pc",
    tags: [],
    duration: Infinity,
    triggers: [
      {
        event: "ACTION_START" as any,
        sourceMustBeWearer: true,
        condition: (e: any) => e.payload.type === "skill" && !triggered,
        action: (_e: any, ctx: SimulationContext) => {
          triggered = true;
          ctx.queue.enqueue({
            type: "SP_CHANGE",
            time: ctx.state.getCurrentTime(),
            payload: {
              actorId,
              spChange: 50,
              reason: "damage",
              sourceId: "tianzai_fanghu_3pc",
              parent: {} as any,
            },
          });
        },
        deferred: true,
      },
    ],
  });

  engine.registerPassiveEffect(actorId, passive);
}

// ===========================================================================
// 12. 长息 (Changxi) — 3-piece set
// ===========================================================================
//
// Static: +1000 HP (timelineStore delta)
// Trigger: After applying amplify or fragility → teammates damage +16%, 15s, no stack
// NOTE: 庇护(shield) and 虚弱(weaken) triggers not implemented (need shield/debuff system)

export function registerChangxiSet(
  engine: SimulationEngine,
  actorId: string,
): void {
  function applyTeamBuff(ctx: SimulationContext) {
    const time = ctx.state.getCurrentTime();
    for (const actor of ctx.state.getAllActors()) {
      if (actor.id === actorId) continue;
      addOrRefreshBuff(actor.effects, new Effect({
        id: "changxi_team_dmg",
        name: "长息",
        tags: [],
        duration: 15,
        startTime: time,
        properties: {
          dynamicBonuses: [
            { stat: "all_dmg", value: 16, zone: "damageBonus" },
          ] as DynamicBonus[],
        },
      }));
    }
  }

  // Trigger on amplify/fragility buff application by this actor
  // Detected via EFFECT_START for effects with amplify/fragility zones
  const passive = new Effect({
    id: "changxi_3pc",
    tags: [],
    duration: Infinity,
    triggers: [
      {
        event: "EFFECT_START" as any,
        sourceMustBeWearer: true,
        condition: (e: any) => {
          const effect = e.payload?.effect;
          const bonuses = effect?.dynamicBonuses ?? effect?.properties?.dynamicBonuses;
          if (!bonuses) return false;
          return bonuses.some((b: any) => b.zone === "amplify" || b.zone === "fragility");
        },
        action: (_e: any, ctx: SimulationContext) => { applyTeamBuff(ctx); },
      },
    ],
  });

  engine.registerPassiveEffect(actorId, passive);
}

// ===========================================================================
// Weapon definitions
// ===========================================================================

// ===========================================================================
// 5. 典范 (Paradigm) — Weapon
// ===========================================================================
//
// Static: +28% physical damage (handled by timelineStore delta — NOT here)
// Trigger: Skill/ultimate hit → +28% physical dmg, 30s, max 3 stacks, independent duration
// ICD: 0.1s
//
// Metadata (trigger, duration, maxStacks, stackCooldown) comes from gamedata.json.
// Only the effect action (creating stacked buffs) is hand-written here.

/** Default weapon data for 典范 — used when gamedata.json is not passed */
const PARADIGM_DEFAULT_DATA: WeaponData = {
  id: "wpn_claym_0004",
  name: "典范",
  triggeredBuffs: [{
    trigger: "on_skill_or_ultimate_hit",
    name: "多层斩断",
    target: "self",
    effects: [],
    duration: 30,
    maxStacks: 3,
    stackCooldown: 0.1,
  }],
};

export function registerParadigmWeapon(
  engine: SimulationEngine,
  actorId: string,
  weaponData?: WeaponData,
  diagnostics?: DiagnosticCollector,
): void {
  // NOTE: +28 physical_dmg is a static passive (passiveStats).
  // Already in ActorSnapshot.stats via timelineStore. Do NOT += here.

  const data = weaponData ?? PARADIGM_DEFAULT_DATA;
  const buff = data.triggeredBuffs?.[0];
  const duration = buff?.duration ?? 30;
  const maxStacks = buff?.maxStacks ?? 3;

  let stackCounter = 0;

  // Hand-written action: JSON effects[] is not auto-simulated; logic lives here.
  const action: WeaponBuffAction = (_e, ctx) => {
    const actorState = ctx.state.getActor(actorId);
    const time = ctx.state.getCurrentTime();
    stackCounter++;

    addStackWithIndependentDuration(
      actorState.effects,
      new Effect({
        id: `paradigm_stack_${stackCounter}`,
        tags: [],
        duration,
        startTime: time,
        properties: {
          dynamicBonuses: [
            { stat: "physical_dmg", value: 28 },
          ] as DynamicBonus[],
          stackGroup: "paradigm_buff",
        },
      }),
      "paradigm_buff",
      maxStacks,
      time,
    );
  };

  registerWeaponFromData(engine, actorId, data, { 0: action }, diagnostics);
}

// ===========================================================================
// 6. 作品：蚀迹 (Zuopin Shiji) — Weapon
// ===========================================================================
//
// Static: +19.6% attack (handled by timelineStore as buffBonus → stats delta)
// Trigger: Skill → nature attachment → other teammates get arts dmg buff
//   - Base: +14% arts damage
//   - Dynamic: +5.6% per nature-attached enemy (max +16.8%)
//   - Duration: 15s, no stack (same-name cannot stack)

export function registerZuopinShijiWeapon(
  engine: SimulationEngine,
  actorId: string,
): void {
  // NOTE: +19.6% attack is a static weapon bonus (buffBonuses).
  // Applied via timelineStore's weapon delta mechanism.
  // If the UI doesn't yet handle this as percentBonus in the delta,
  // the weapon can register it as a dynamic attackPercent buff below.
  // TODO: verify timelineStore correctly applies this; if not, uncomment:
  //
  // const actor = engine.getState().getActor(actorId);
  // addOrRefreshBuff(actor.effects, new Effect({
  //   id: "zuopin_shiji_atk_pct",
  //   tags: [], duration: Infinity, startTime: 0,
  //   properties: { dynamicBonuses: [{ stat: "all_dmg", value: 0, zone: "attackPercent" as any }] },
  // }));

  const passive = new Effect({
    id: "zuopin_shiji_weapon",
    tags: [],
    duration: Infinity,
    triggers: [
      {
        event: "APPLY_MAGIC_ATTACHMENT" as any,
        sourceMustBeWearer: true,
        condition: (e: any, ctx: SimulationContext) => {
          if (e.payload.element !== "nature") return false;
          const actorState = ctx.state.getActor(actorId);
          const activeAction = actorState.getActiveAction();
          return activeAction?.node.type === "skill";
        },
        action: (_e: any, ctx: SimulationContext) => {
          const time = ctx.state.getCurrentTime();

          const natureCount =
            ctx.state.enemy.status.getMagicElement() === "nature" ? 1 : 0;
          const dynamicBonus = Math.min(16.8, natureCount * 5.6);
          const totalBonus = 14 + dynamicBonus;

          applyBuffToTargets(
            ctx.state,
            actorId,
            "otherTeammates",
            () =>
              new Effect({
                id: "zuopin_shiji_arts_buff",
                tags: [],
                duration: 15,
                startTime: time,
                properties: {
                  dynamicBonuses: [
                    { stat: "arts_dmg", value: totalBonus },
                  ] as DynamicBonus[],
                },
              }),
          );
        },
      },
    ],
  });

  engine.registerPassiveEffect(actorId, passive);
}

// ---------------------------------------------------------------------------
// 显赫声名 (Eminent Repute) — wpn_sword_0013
// ---------------------------------------------------------------------------

/**
 * On break consume: self ATK +[5% + 2.5% × consumed layers],
 * other teammates get half. 20s, no stack (refresh only).
 *
 * Despite "后" in description, triggers immediately (verified).
 * Reads consumed break layers from frameSnapshot.breakStacks.
 */
export function registerEminentReputeWeapon(
  engine: SimulationEngine,
  actorId: string,
): void {
  const passive = new Effect({
    id: "weapon_eminent_repute",
    tags: [],
    duration: Infinity,
    triggers: [
      {
        event: "APPLY_PHYSICAL_ANOMALY" as any,
        sourceMustBeWearer: true,
        condition: (e: any, ctx: SimulationContext) => {
          const pType = e.payload?.physicalType;
          return (pType === "slam" || pType === "armorBreak") &&
            ctx.frameSnapshot.breakStacks > 0;
        },
        action: (_e: any, ctx: SimulationContext) => {
          const time = ctx.state.getCurrentTime();
          const consumedLayers = ctx.frameSnapshot.breakStacks;
          const selfBonus = 5 + 2.5 * consumedLayers;
          const otherBonus = selfBonus / 2;

          addOrRefreshBuff(
            ctx.state.getActor(actorId).effects,
            new Effect({
              id: "eminent_repute_atk",
              name: "显赫声名",
              tags: [],
              duration: 20,
              startTime: time,
              properties: {
                dynamicBonuses: [{ stat: "all_dmg" as const, value: selfBonus, zone: "attackPercent" as const }],
              },
            }),
          );

          for (const teammate of ctx.state.getAllActors()) {
            if (teammate.id === actorId) continue;
            addOrRefreshBuff(
              teammate.effects,
              new Effect({
                id: "eminent_repute_atk_shared",
                name: "显赫声名(共享)",
                tags: [],
                duration: 20,
                startTime: time,
                properties: {
                  dynamicBonuses: [{ stat: "all_dmg" as const, value: otherBonus, zone: "attackPercent" as const }],
                },
              }),
            );
          }
        },
      },
    ],
  });

  engine.registerPassiveEffect(actorId, passive);
}

// ---------------------------------------------------------------------------
// 古渠 (Ancient Canal) — wpn_claym_0014
// ---------------------------------------------------------------------------

/** On break consume: physical_dmg +[5% × consumed layers], 20s, no stack. */
export function registerAncientCanalWeapon(engine: SimulationEngine, actorId: string): void {
  engine.registerPassiveEffect(actorId, new Effect({
    id: "weapon_ancient_canal", tags: [], duration: Infinity,
    triggers: [{
      event: "APPLY_PHYSICAL_ANOMALY" as any,
      sourceMustBeWearer: true,
      condition: (e: any, ctx: SimulationContext) => {
        const pType = e.payload?.physicalType;
        return (pType === "slam" || pType === "armorBreak") && ctx.frameSnapshot.breakStacks > 0;
      },
      action: (_e: any, ctx: SimulationContext) => {
        const bonus = 5 * ctx.frameSnapshot.breakStacks;
        addOrRefreshBuff(ctx.state.getActor(actorId).effects, new Effect({
          id: "ancient_canal_phys", name: "古渠", tags: [], duration: 20,
          startTime: ctx.state.getCurrentTime(),
          properties: { dynamicBonuses: [{ stat: "physical_dmg" as const, value: bonus, zone: "damageBonus" as const }] },
        }));
      },
    }],
  }));
}

// ---------------------------------------------------------------------------
// 骁勇 (Valiant) — wpn_lance_0010
// ---------------------------------------------------------------------------

/** On physical anomaly: deal ATK × 120% physical damage. */
export function registerValiantWeapon(engine: SimulationEngine, actorId: string): void {
  engine.registerPassiveEffect(actorId, new Effect({
    id: "weapon_valiant", tags: [], duration: Infinity,
    triggers: [{
      event: "APPLY_PHYSICAL_ANOMALY" as any,
      sourceMustBeWearer: true,
      deferred: true,
      action: (_e: any, ctx: SimulationContext) => {
        ctx.queue.enqueue({
          type: "ANOMALY_DAMAGE",
          time: ctx.state.getCurrentTime(),
          payload: {
            multiplier: 1.2,
            tags: buildDamageTags({
              sourceActorId: actorId, targetEnemyId: "boss",
              damageType: "physical", damageSource: "equipmentProc",
              sourceEffectId: "valiant",
            }),
          },
        });
      },
    }],
  }));
}

// ---------------------------------------------------------------------------
// O.B.J.迅极 (O.B.J. Velocitous) — wpn_pistol_0012
// ---------------------------------------------------------------------------

/** On attachment consume: nature_dmg +[5% × consumed layers], 20s, no stack. */
export function registerObjVelocitousWeapon(engine: SimulationEngine, actorId: string): void {
  engine.registerPassiveEffect(actorId, new Effect({
    id: "weapon_obj_velocitous", tags: [], duration: Infinity,
    triggers: [{
      event: "DAMAGE_TICK" as any,
      sourceMustBeWearer: true,
      condition: (_e: any, ctx: SimulationContext) => {
        return ctx.frameSnapshot.magicStacks > 0 && !ctx.state.enemy.status.hasMagicAttachment();
      },
      action: (_e: any, ctx: SimulationContext) => {
        const bonus = 5 * ctx.frameSnapshot.magicStacks;
        addOrRefreshBuff(ctx.state.getActor(actorId).effects, new Effect({
          id: "obj_velocitous_nature", name: "O.B.J.迅极", tags: [], duration: 20,
          startTime: ctx.state.getCurrentTime(),
          properties: { dynamicBonuses: [{ stat: "nature_dmg" as const, value: bonus, zone: "damageBonus" as const }] },
        }));
      },
    }],
  }));
}
