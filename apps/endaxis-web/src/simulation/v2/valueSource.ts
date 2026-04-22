/**
 * V2 Value Source + Event Context
 *
 * Unified resolver for numeric effect params that may depend on:
 *   - Character data (skills.json labels, talent levels)
 *   - Enemy state (attachment stacks, break stacks)
 *   - Trigger event data (consumed stacks, prev stacks, damage, …)
 *
 * Two extensible registries:
 *   - EVENT_NORMALIZERS:    raw TriggerEvent.type → EventContext
 *   - SCALE_BY_RESOLVERS:   scaleBy string → numeric extractor from ResolveContext
 *
 * Both accept `register*()` calls so future characters/equipment can add new
 * event categories or scale paths without touching the kernel.
 */

import type {
  MagicElement,
  DamageElement,
  ActionType,
  AnomalyType,
} from "./types";
import type { TriggerEvent } from "./triggers";

// ═══════════════════════════════════════════════════════════════════
// EventContext — normalized trigger event shape
// ═══════════════════════════════════════════════════════════════════

/**
 * Top-level category of a trigger event. Each raw event type maps to one of
 * these via EVENT_NORMALIZERS. Conditions/actions can branch on `kind` when
 * they need category-level behaviour.
 */
export type EventKind =
  | "skill_cast"    // 技能施放: action_start
  | "skill_hit"     // 技能命中: hit_damage / skill_hit / link_hit / …
  | "buff_add"      // buff 添加: attachment_applied / buff_applied / …
  | "buff_remove"   // buff 消失: buff_removed / anomaly_remove / 自然过期 …
  | "buff_consume"; // buff 消耗: attachment_consumed / stack_buff_consumed / slam · armorBreak

/**
 * Normalised view over a raw TriggerEvent. Fields are populated per kind by
 * the corresponding normalizer. Unknown fields stay undefined — resolvers are
 * defensive against missing values (default 0 / false).
 */
export interface EventContext {
  kind: EventKind;
  time: number;
  actorId: string;

  // Skill cast / hit
  actionType?: ActionType;
  actionId?: string;

  // Buff add / remove / consume — buff identity
  buffId?: string;
  element?: MagicElement | DamageElement;
  anomalyType?: AnomalyType;
  physicalType?: string;

  // Buff add / remove / consume — stack counts
  /** Stacks associated with this event. Meaning depends on kind:
   *  - buff_add:     stacks added in this event
   *  - buff_remove:  stacks that were present at removal
   *  - buff_consume: stacks consumed in this event */
  stacks?: number;
  prevStacks?: number;

  // Skill hit specifics
  damage?: number;
  isCrit?: boolean;

  /** Original raw event, for resolvers that need one-off custom fields. */
  raw?: TriggerEvent;
}

// ═══════════════════════════════════════════════════════════════════
// ResolveContext — passed to resolvers when computing a ValueSource
// ═══════════════════════════════════════════════════════════════════

/** Minimum enemy-state interface accessed by scaleBy resolvers. */
export interface EnemyStateView {
  attachment: { element: MagicElement | null; stacks: number; expiresAt: number };
  breakStacks: number;
}

export interface ResolveContext {
  /** Resolve a skills.json label (or talent_X) for the actor to a number.
   *  Optional `sectionHint` restricts the skills.json section searched — used by
   *  MultiplierRef.section to disambiguate labels shared across sections. */
  resolveRef: (actorId: string, label: string, sectionHint?: string) => number;
  enemy: EnemyStateView;
  /** Present when resolving a trigger action param. Absent for hit.effects. */
  event?: EventContext;
}

// ═══════════════════════════════════════════════════════════════════
// ValueSource — the polymorphic numeric param shape
// ═══════════════════════════════════════════════════════════════════

/**
 * Accepted forms:
 *   - `number`           — literal
 *   - `string`           — shorthand for `{ label: string }`
 *   - `{ label, literal, share, scaleBy, addition }` — full form
 *
 * Resolution:
 *   base    = label ? resolveRef(label) : (literal ?? 0)
 *   scaled  = base × (share ?? 1) × (scaleBy ? SCALE_BY_RESOLVERS[scaleBy](ctx) : 1)
 *   final   = scaled + (addition ?? 0)
 *
 * The `addition` component is a fixed literal added after the scaled part,
 * used for compound formulas like "14% + 7% × consumed_stacks" (显赫声名):
 *   { literal: 7, scaleBy: "event.stacks", addition: 14 }
 */
export type ValueSource =
  | number
  | string
  | ValueSourceObject;

export interface ValueSourceObject {
  label?: string;
  literal?: number;
  share?: number;
  /** Key into SCALE_BY_RESOLVERS. Multiplies the base value by the resolved scalar. */
  scaleBy?: string;
  /** Constant added after base × share × scaleBy. Enables compound formulas. */
  addition?: number;
}

// ═══════════════════════════════════════════════════════════════════
// SCALE_BY registry — extensible path table
// ═══════════════════════════════════════════════════════════════════

type ScaleByResolver = (ctx: ResolveContext) => number;

const SCALE_BY_RESOLVERS = new Map<string, ScaleByResolver>([
  // Enemy state (available regardless of event context).
  ["attachmentStacks", (ctx) => ctx.enemy.attachment.stacks],
  ["breakStacks",      (ctx) => ctx.enemy.breakStacks],
  // Event-dependent. Return 0 when no event (hit.effects path).
  ["event.stacks",      (ctx) => ctx.event?.stacks ?? 0],
  ["event.prevStacks",  (ctx) => ctx.event?.prevStacks ?? 0],
  ["event.damage",      (ctx) => ctx.event?.damage ?? 0],
  ["event.isCrit",      (ctx) => (ctx.event?.isCrit ? 1 : 0)],
]);

/**
 * Register a new scaleBy path. Call at module load time (not per-simulate) —
 * the registry is global. Idempotent; last registration wins.
 */
export function registerScaleByResolver(name: string, fn: ScaleByResolver): void {
  SCALE_BY_RESOLVERS.set(name, fn);
}

/** Read a scaleBy multiplier. Unknown paths return 1 (no-op). */
export function resolveScaleBy(name: string, ctx: ResolveContext): number {
  const fn = SCALE_BY_RESOLVERS.get(name);
  return fn ? fn(ctx) : 1;
}

// ═══════════════════════════════════════════════════════════════════
// EVENT_NORMALIZERS — raw TriggerEvent type → EventContext
// ═══════════════════════════════════════════════════════════════════

type EventNormalizer = (raw: TriggerEvent) => EventContext;

const EVENT_NORMALIZERS = new Map<string, EventNormalizer>();

/**
 * Register a normaliser for a raw trigger event type. Overwrites on duplicate
 * (useful during tests / future extension).
 */
export function registerEventNormalizer(type: string, fn: EventNormalizer): void {
  EVENT_NORMALIZERS.set(type, fn);
}

/**
 * Default fallback normaliser — produces a generic skill_hit context so that
 * unknown events don't crash downstream. Meaning is weak; prefer registering
 * a concrete normaliser.
 */
function fallbackNormalizer(raw: TriggerEvent): EventContext {
  return {
    kind: "skill_hit",
    time: raw.time,
    actorId: (raw as any).sourceActorId || "",
    raw,
  };
}

export function normalizeTriggerEvent(raw: TriggerEvent): EventContext {
  const fn = EVENT_NORMALIZERS.get(raw.type);
  return fn ? fn(raw) : fallbackNormalizer(raw);
}

// ── Initial event normalizer population ──────────────────────────────

// 技能施放
registerEventNormalizer("action_start", (raw) => ({
  kind: "skill_cast",
  time: raw.time,
  actorId: (raw as any).sourceActorId || (raw as any).actorId || "",
  actionType: (raw as any).data?.actionType,
  actionId: (raw as any).data?.actionId,
  raw,
}));

// 技能命中
const HIT_TYPES = [
  "hit_damage", "skill_hit", "attack_hit", "link_hit",
  "ultimate_hit", "execution_hit", "heavy_attack_hit", "aerial_hit",
  "stagger_increased", "crit_hit",
] as const;
for (const t of HIT_TYPES) {
  registerEventNormalizer(t, (raw) => ({
    kind: "skill_hit",
    time: raw.time,
    actorId: (raw as any).sourceActorId || "",
    actionType: (raw as any).data?.actionType,
    damage: (raw as any).data?.damage,
    isCrit: (raw as any).data?.isCrit,
    raw,
  }));
}

// buff 添加
registerEventNormalizer("attachment_applied", (raw) => ({
  kind: "buff_add",
  time: raw.time,
  actorId: (raw as any).sourceActorId || "",
  element: (raw as any).data?.element,
  stacks: (raw as any).data?.stacks,
  actionType: (raw as any).data?.actionType,
  raw,
}));
registerEventNormalizer("anomaly_applied", (raw) => ({
  kind: "buff_add",
  time: raw.time,
  actorId: (raw as any).sourceActorId || "",
  anomalyType: (raw as any).data?.anomalyType,
  stacks: (raw as any).data?.level,
  actionType: (raw as any).data?.actionType,
  raw,
}));
registerEventNormalizer("buff_applied", (raw) => ({
  kind: "buff_add",
  time: raw.time,
  actorId: (raw as any).sourceActorId || "",
  buffId: (raw as any).data?.buffId || (raw as any).data?.buffType,
  stacks: (raw as any).data?.stacks,
  actionType: (raw as any).data?.actionType,
  raw,
}));
registerEventNormalizer("stack_buff_gained", (raw) => ({
  kind: "buff_add",
  time: raw.time,
  actorId: (raw as any).sourceActorId || "",
  buffId: (raw as any).data?.buffType,
  stacks: (raw as any).data?.stacks,
  prevStacks: (raw as any).data?.prevStacks,
  raw,
}));
registerEventNormalizer("break_applied", (raw) => ({
  kind: "buff_add",
  time: raw.time,
  actorId: (raw as any).sourceActorId || "",
  physicalType: "break",
  stacks: (raw as any).data?.stacks,
  prevStacks: (raw as any).data?.prevStacks,
  actionType: (raw as any).data?.actionType,
  raw,
}));

// buff 消失
registerEventNormalizer("buff_removed", (raw) => ({
  kind: "buff_remove",
  time: raw.time,
  actorId: (raw as any).sourceActorId || "",
  buffId: (raw as any).data?.buffId,
  prevStacks: (raw as any).data?.prevStacks,
  raw,
}));
registerEventNormalizer("anomaly_remove", (raw) => ({
  kind: "buff_remove",
  time: raw.time,
  actorId: (raw as any).sourceActorId || "",
  anomalyType: (raw as any).anomalyType,
  prevStacks: (raw as any).level,
  raw,
}));

// buff 消耗
registerEventNormalizer("attachment_consumed", (raw) => ({
  kind: "buff_consume",
  time: raw.time,
  actorId: (raw as any).sourceActorId || "",
  element: (raw as any).data?.consumedElement,
  stacks: (raw as any).data?.consumedStacks,
  raw,
}));
registerEventNormalizer("stack_buff_consumed", (raw) => ({
  kind: "buff_consume",
  time: raw.time,
  actorId: (raw as any).sourceActorId || "",
  buffId: (raw as any).data?.buffType,
  stacks: (raw as any).data?.consumed,
  raw,
}));
registerEventNormalizer("physical_anomaly", (raw) => {
  const physicalType = (raw as any).data?.physicalType as string | undefined;
  const outcome = (raw as any).data?.outcome as string | undefined;
  // slam / armorBreak consume break; launch / knockdown add break.
  const isConsume = outcome === "slam" || outcome === "armorBreak";
  return {
    kind: isConsume ? "buff_consume" : "buff_add",
    time: raw.time,
    actorId: (raw as any).sourceActorId || "",
    physicalType,
    stacks: (raw as any).data?.consumedStacks ?? (raw as any).data?.stacks,
    raw,
  };
});

// ═══════════════════════════════════════════════════════════════════
// resolveValue — the single entry point for numeric param resolution
// ═══════════════════════════════════════════════════════════════════

/**
 * Resolve a ValueSource to a number. Defensive against undefined input
 * (returns fallback, default 0).
 */
export function resolveValue(
  source: ValueSource | undefined,
  actorId: string,
  ctx: ResolveContext,
  fallback: number = 0,
): number {
  if (source == null) return fallback;
  if (typeof source === "number") return source;
  if (typeof source === "string") return ctx.resolveRef(actorId, source);
  // Object form
  let base: number;
  if (source.label != null) base = ctx.resolveRef(actorId, source.label);
  else if (source.literal != null) base = source.literal;
  else base = fallback;
  if (source.share != null) base *= source.share;
  if (source.scaleBy) base *= resolveScaleBy(source.scaleBy, ctx);
  if (source.addition != null) base += source.addition;
  return base;
}
