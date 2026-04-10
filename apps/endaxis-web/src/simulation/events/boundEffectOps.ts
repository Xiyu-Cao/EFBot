/**
 * Declarative bound-effect operations.
 *
 * Instead of hand-writing a handler function for every bound-effect tag,
 * define the behaviour as an array of BoundEffectOp descriptors and call
 * registerBoundEffectOps().  The helper compiles the ops into pre/post
 * handler functions and registers them in the DamageHandler registries.
 */

import type { DamageTickEvent } from "./event.types";
import type { SimulationContext } from "../engine/SimulationContext";
import type { AnomalyDebuffType } from "../anomaly/types";
import type { Effect } from "../effects/types";

// ---------------------------------------------------------------------------
// Operation types
// ---------------------------------------------------------------------------

/** Consume an enemy anomaly debuff status (conduction / corrosion / burn / freeze). */
export interface ConsumeEnemyStatusOp {
  op: "consume_enemy_status";
  phase: "post";
  statusType: AnomalyDebuffType;
}

/** Apply a buff/debuff via an Effect factory. */
export interface ApplyBuffOp {
  op: "apply_buff";
  phase: "pre" | "post";
  target: "source" | "enemy" | "team";
  effectFactory: (e: DamageTickEvent, ctx: SimulationContext) => Effect;
}

/** Consume stacks from a stackable effect on a target. */
export interface ConsumeBuffOp {
  op: "consume_buff";
  phase: "post";
  target: "source" | "enemy";
  effectId: string;
  count: number;
}

/** Execute child ops only if condition is true. */
export interface ConditionalOp {
  op: "conditional";
  phase: "pre" | "post";
  condition: (e: DamageTickEvent, ctx: SimulationContext) => boolean;
  then: BoundEffectOp[];
}

/** Enqueue an SP_CHANGE event. */
export interface SpChangeOp {
  op: "sp_change";
  phase: "post";
  amount: number | ((e: DamageTickEvent, ctx: SimulationContext) => number);
}

export type BoundEffectOp =
  | ConsumeEnemyStatusOp
  | ApplyBuffOp
  | ConsumeBuffOp
  | ConditionalOp
  | SpChangeOp;

// ---------------------------------------------------------------------------
// Status clear dispatch
// ---------------------------------------------------------------------------

const STATUS_CLEAR_MAP: Record<AnomalyDebuffType, string> = {
  burn: "clearBurn",
  freeze: "clearFreeze",
  conduction: "clearConduction",
  corrosion: "clearCorrosion",
};

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

import { addOrRefreshBuff } from "../equipment/types";

export function executeOp(
  op: BoundEffectOp,
  e: DamageTickEvent,
  ctx: SimulationContext,
): void {
  switch (op.op) {
    case "consume_enemy_status": {
      const status = ctx.state.enemy.status;
      const current = status[op.statusType];
      if (current !== null) {
        const clearFn = STATUS_CLEAR_MAP[op.statusType];
        (status as any)[clearFn]();
        ctx.simLog({
          type: "ANOMALY_STATUS_CHANGE",
          time: e.time,
          payload: {
            description: `${op.statusType} consumed by ${e.payload.sourceId} (post-damage, same frame)`,
            type: `${op.statusType}_consumed`,
            sourceId: e.payload.sourceId,
          },
        });
      }
      break;
    }

    case "apply_buff": {
      const effect = op.effectFactory(e, ctx);
      if (op.target === "enemy") {
        addOrRefreshBuff(ctx.state.enemy.effects, effect);
      } else if (op.target === "team") {
        for (const actor of ctx.state.getAllActors()) {
          addOrRefreshBuff(actor.effects, effect.clone());
        }
      } else {
        const actor = ctx.state.getActor(e.payload.sourceId);
        addOrRefreshBuff(actor.effects, effect);
      }
      break;
    }

    case "consume_buff": {
      const mgr =
        op.target === "enemy"
          ? ctx.state.enemy.effects
          : ctx.state.getActor(e.payload.sourceId).effects;
      mgr.consumeStacks(op.effectId, op.count);
      break;
    }

    case "conditional": {
      if (op.condition(e, ctx)) {
        for (const child of op.then) {
          executeOp(child, e, ctx);
        }
      }
      break;
    }

    case "sp_change": {
      const amount =
        typeof op.amount === "function" ? op.amount(e, ctx) : op.amount;
      if (amount !== 0) {
        ctx.queue.enqueue({
          type: "SP_CHANGE",
          time: e.time,
          payload: {
            actorId: e.payload.sourceId,
            spChange: amount,
            reason: "bound_effect",
            sourceId: e.payload.actionId,
            parent: e,
          },
        });
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Registration helper
// ---------------------------------------------------------------------------

type BoundEffectHandler = (e: DamageTickEvent, ctx: SimulationContext) => void;

export interface BoundEffectRegistries {
  pre: Map<string, BoundEffectHandler>;
  post: Map<string, BoundEffectHandler>;
}

/**
 * Compile an array of BoundEffectOps into pre/post handler functions
 * and register them under the given tag string.
 */
export function registerBoundEffectOps(
  tag: string,
  ops: BoundEffectOp[],
  registries: BoundEffectRegistries,
): void {
  const preOps = ops.filter((o) => o.phase === "pre");
  const postOps = ops.filter((o) => o.phase === "post");

  if (preOps.length > 0) {
    registries.pre.set(tag, (e, ctx) => {
      for (const op of preOps) executeOp(op, e, ctx);
    });
  }
  if (postOps.length > 0) {
    registries.post.set(tag, (e, ctx) => {
      for (const op of postOps) executeOp(op, e, ctx);
    });
  }
}
