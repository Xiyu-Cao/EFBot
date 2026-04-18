/**
 * V2 Simulation Kernel — Core Type Definitions
 *
 * Three-layer architecture:
 *   Layer 1: CharacterBuild (frozen stats, computed before battle)
 *   Layer 2: SimulationKernel (hit-based processing, produces EventLog)
 *   Layer 3: UI (consumes EventLog, no computation)
 */

// ═══════════════════════════════════════════════════════════════════
// Layer 1: Character Build (frozen before battle)
// ═══════════════════════════════════════════════════════════════════

/** Final computed stats for an actor, frozen at battle start. */
export interface ActorStats {
  // Base attributes
  strength: number;
  agility: number;
  intellect: number;
  will: number;

  // Derived from attributes
  attack: number;          // floor(((base+weapon) × (1+pct%) + flat) × ability_mult)
  hp: number;              // base + strength × 5
  physicalResist: number;  // round(agility / (agility + 1000) × 100)
  blazeResist: number;     // round(intellect / (intellect + 1000) × 100)
  emagResist: number;      // same as blazeResist
  coldResist: number;      // same as blazeResist
  natureResist: number;    // same as blazeResist
  beyondResist: number;    // 0 (no source yet)
  healingEfficiency: number; // will × 0.1 (%)

  // Combat stats
  critRate: number;        // base 5% + equipment + buffs
  critDamage: number;      // base 50% + equipment + buffs
  ultChargeEff: number;    // base 100, equipment/talent additive

  // Damage bonuses (%)
  physicalDmg: number;
  blazeDmg: number;
  emagDmg: number;
  coldDmg: number;
  natureDmg: number;
  artsDmg: number;
  attackDmgBonus: number;
  skillDmgBonus: number;
  linkDmgBonus: number;
  ultimateDmgBonus: number;
  allSkillDmgBonus: number;
  brokenDmgBonus: number;

  // Other
  originiumArtsPower: number;
  linkCdReduction: number;
}

/** Character build: all data frozen before battle. */
export interface CharacterBuild {
  id: string;
  name: string;
  element: DamageElement;
  rarity: number;
  stats: ActorStats;
  potentialLevel: number;
  talentLevels: Record<string, number>;
  weaponId: string | null;
  equipmentSetId: string | null;
  /** Gauge cap after potential modifier (e.g., 300 × 0.85 = 255) */
  gaugeMax: number;
  /** If true, this actor only gains gauge from their own skill/link SP consumption (e.g., LASTRITE). */
  gaugeFromSelfOnly?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Skill & Hit structures
// ═══════════════════════════════════════════════════════════════════

export type ActionType = "attack" | "skill" | "link" | "ultimate" | "execution" | "dodge";
export type DamageElement = "physical" | "blaze" | "cold" | "emag" | "nature";
export type DamageSchool = "physical" | "magic";

/** A single hit within a skill. */
export interface Hit {
  /** Time offset from skill start (seconds). */
  offset: number;
  /** Which checkpoint segment this hit belongs to. */
  checkpointIndex: number;
  /** Damage info (null = pure effect hit, no damage). */
  damage: DamageInfo | null;
  /** Effects applied by this hit (processed before damage). */
  effects: HitEffect[];
  /**
   * Whether this hit follows standard processing logic.
   * false = custom handler needed (character-specific).
   */
  standardLogic: boolean;
}

/** Damage component of a hit. */
export interface DamageInfo {
  /**
   * Multiplier reference — resolved at runtime from skills.json level data.
   * Use EITHER `multiplier` (fixed value) OR `multiplierRef` (level-dependent).
   */
  multiplier?: number;
  multiplierRef?: MultiplierRef;
  /** Stagger value added to enemy stagger bar. */
  stagger: number;
  /** Damage element. */
  element: DamageElement;
  /** Whether this hit can crit. */
  canCrit: boolean;
  /** Damage school (physical or magic). */
  school: DamageSchool;
  /** Source action type (for damage bonus zone routing). */
  sourceType: ActionType;
}

/**
 * Reference to a level-dependent multiplier from skills.json.
 *
 * Each skill description has named multiplier rows (e.g., "初始爆炸伤害倍率")
 * with 12 values (Rank1-9, M1-M3). At runtime, the kernel resolves the
 * actual multiplier based on the actor's current skill level.
 *
 * Examples:
 *   - Single hit using full value:  { label: "伤害倍率", share: 1 }
 *   - 8 hits equally sharing:       { label: "持续伤害每段倍率", share: "equal", equalCount: 8 }
 *   - Hit using 30% of a segment:   { label: "总伤害倍率", share: 0.3 }
 */
export interface MultiplierRef {
  /** Label matching a row in skills.json levelData (e.g., "初始爆炸伤害倍率"). */
  label: string;
  /**
   * How much of this multiplier row this hit uses:
   * - number (0-1): fixed fraction (1 = full value)
   * - "equal": evenly split among equalCount hits
   */
  share: number | "equal";
  /** When share="equal", how many hits share this multiplier row. */
  equalCount?: number;
  /**
   * Runtime scaling: multiply the resolved value by a dynamic enemy-state quantity.
   * Used for skills whose per-layer multiplier depends on the current stack count
   * (e.g. 别礼 link hit 2: "消耗每层附着额外伤害倍率 × 层数"). The referenced stacks
   * should still be present when the multiplier is read — pair with `deferTo` on
   * the corresponding consume effect to defer consumption to afterSkillDamage.
   */
  scaleBy?: "attachmentStacks" | "breakStacks";
}

/** An effect applied by a hit. */
export interface HitEffect {
  /** Effect type identifier. */
  type: string;
  /** Effect parameters (type-specific). */
  params: Record<string, unknown>;
}

// ── Known HitEffect types ──
// "magic_attachment"    { element: DamageElement, stacks: number }
// "direct_anomaly"      { anomalyType: AnomalyType, level: number, duration?: number }
// "physical_anomaly"    { physicalType: PhysicalAnomalyType, stacks: number }
// "break_apply"         { stacks: number }
// "buff_apply"          { buffId: string, target: BuffTarget, ... }
// "buff_consume"        { buffId: string, stacks: number | "all" }
// "sp_restore"          { amount: number, isTrueSP: boolean }
// "sp_consume"          { amount: number }
// "gauge_gain"          { amount: number }
// "stack_buff_apply"    { buffType: string, stacks: number }  (type="stack" buffs like magma)
// "stack_buff_consume"  { buffType: string, stacks: number | "all" }
// "blaze_to_magma"      {}  (莱万汀天赋: consume enemy blaze → self magma)

/** Interrupt checkpoint within a skill. */
export interface Checkpoint {
  /** Checkpoint index (0-based). */
  index: number;
  /** What types of actions can interrupt at this point. */
  interruptibleBy: InterruptType[];
  /** Inclusive hit index range [start, end] belonging to this checkpoint. */
  hitRange: [number, number];
}

export type InterruptType = "dodge" | "skill" | "link" | "ultimate" | "switch";

/** Complete skill definition. */
export interface Skill {
  id: string;
  type: ActionType;
  name: string;
  element: DamageElement;
  duration: number;
  spCost: number;
  cooldown: number;
  /** True if this is the last normal attack segment (重击). */
  isHeavyAttack?: boolean;
  /** All hits in chronological order. */
  hits: Hit[];
  /** Checkpoint segments for interrupt system. */
  checkpoints: Checkpoint[];
  /** Gauge cost, consumed on cast (ultimate only). */
  gaugeCost?: number;
  /** Gauge gain for all team members, triggered on cast (SP consumption → charge). */
  teamGaugeGain?: number;
  /** Detach time (seconds from skill start). Hits at or after this offset are not affected by interrupts. */
  detach?: number;
  /** Override default interrupt rules (character exceptions). Lists action types that can interrupt this skill. */
  interruptibleBy?: ActionType[];
  /** Visual duration override for frontend display (e.g., internal CD indicator when kernel duration=0). */
  displayDuration?: number;
  // Note: SP restore within a skill is a HitEffect on a specific hit, not a Skill-level field.
  // gaugeGain for self is also derived from SP consumption (handled by kernel).
}

// ═══════════════════════════════════════════════════════════════════
// Variant system
// ═══════════════════════════════════════════════════════════════════

/** Condition for variant selection (evaluated at skill cast time). */
export interface VariantCondition {
  type: "stackBuff" | "ultimateActive";
  /** For stackBuff: which buff type to check. */
  buffType?: string;
  /** For stackBuff: comparison operator. */
  op?: ">=" | "<=" | ">" | "<" | "==" | "!=";
  /** For stackBuff: comparison value. */
  value?: number;
}

/** A variant override for a skill. */
export interface SkillVariant {
  id: string;
  priority: number;
  conditions: VariantCondition[];
  /** Overridden skill data (only fields that differ). */
  overrides: Partial<Skill>;
  /** Buffs to consume when this variant is selected. */
  consumeBuffs?: { buffType: string; stacks: number | "all" }[];
}

// ═══════════════════════════════════════════════════════════════════
// Anomaly & Status types
// ═══════════════════════════════════════════════════════════════════

export type MagicElement = "fire" | "cold" | "electro" | "nature";
export type AnomalyType = "burning" | "frozen" | "conduction" | "corrosion";
export type PhysicalAnomalyType = "launch" | "knockdown" | "slam" | "armorBreak";

export type BuffTarget = "self" | "team" | "enemy" | "others";

// ═══════════════════════════════════════════════════════════════════
// Trigger system (天赋/武器被动/套装效果)
// ═══════════════════════════════════════════════════════════════════

/**
 * A passive trigger registered on an actor (from talent, weapon, equipment set).
 *
 * After each hit's effects and damage are resolved, the kernel runs all
 * active triggers. Triggers that match fire their action (which may
 * produce more events/effects).
 *
 * Timing:
 *   - immediate (deferred=false): fires right after the triggering event
 *   - deferred (deferred=true): fires after the entire hit's processing
 *     completes (effects + damage + immediate triggers), useful for
 *     "xx后" (after X) semantics where the trigger should see the
 *     result of the hit before acting.
 *
 * Example — 莱万汀"灼心":
 *   listenTo: "heavy_attack_hit"
 *   deferred: false (fires immediately on hit)
 *   condition: enemy has blaze attachment
 *   action: consume blaze attachment → add magma stacks
 *
 * Example — 别礼"低温症":
 *   listenTo: "attachment_consumed"
 *   deferred: true (fires after hit completes, including damage that
 *            read the attachment for multiplier)
 *   condition: consumed element was cold
 *   action: apply cold fragility debuff
 */
export interface PassiveTrigger {
  /** Unique id for this trigger (for tracking/debug). */
  id: string;
  /** Source of this trigger (e.g., "talent_灼心", "weapon_熔铸火焰"). */
  source: string;
  /** Which event type to listen for. */
  listenTo: TriggerEventType;
  /** If true, action fires after the hit's full processing completes. */
  deferred: boolean;
  /** Must the event source be this trigger's owner? Default true. */
  sourceMustBeOwner?: boolean;
  /** Internal cooldown id (for ICD tracking). */
  cooldownId?: string;
  /** ICD duration in seconds. */
  cooldownDuration?: number;
  /** Additional condition to check (return false to skip). */
  condition?: TriggerCondition;
  /** Effect(s) to produce when triggered. */
  actions: HitEffect[];
  /** Structured source reference, used by the UI to resolve the source icon
   *  (天赋 / 战技 / 武器 / 装备等)。set automatically by converters for
   *  weapon/equipment triggers; character-intrinsic triggers should set it
   *  explicitly. */
  sourceRef?: TriggerSourceRef;
}

/** Where a trigger-generated buff came from, for UI icon resolution. */
export type TriggerSourceRef =
  | { kind: "talent_0" | "talent_1" | "talent_2"; actorId?: string }
  | { kind: "skill" | "link" | "ultimate"; actorId?: string }
  | { kind: "weapon"; id: string }
  | { kind: "equipment_set"; id: string };

/**
 * Events that triggers can listen to.
 * These are produced by the kernel during hit processing.
 */
export type TriggerEventType =
  // Skill cast (action_start)
  | "action_start"           // any skill cast started
  | "skill_cast"             // 战技 cast (aliases dispatched per-actionType if needed)
  // Hit events
  | "hit_damage"             // any damage dealt
  | "hit_effect"             // any effect applied
  // Specific action type hits
  | "attack_hit"             // normal attack hit
  | "heavy_attack_hit"       // heavy attack (last segment) hit
  | "skill_hit"              // 战技 hit
  | "link_hit"               // 连携技 hit
  | "ultimate_hit"           // 终结技 hit
  | "execution_hit"          // 处决 hit
  | "aerial_hit"             // 下落攻击 hit
  // Attachment events
  | "attachment_applied"     // magic attachment added/stacked
  | "attachment_consumed"    // attachment consumed by reaction
  | "magic_burst"            // same-element burst triggered
  // Anomaly events
  | "anomaly_applied"        // any spell anomaly applied (burn/freeze/conduction/corrosion)
  | "burn_applied"
  | "freeze_applied"
  | "conduction_applied"
  | "corrosion_applied"
  | "anomaly_consumed"       // anomaly consumed/expired
  // Physical events
  | "physical_anomaly"       // any physical anomaly (launch/knockdown/slam/armorBreak)
  | "break_applied"          // break stack added
  | "break_consumed"         // break stacks consumed (slam/armorBreak)
  // Stagger events
  | "stagger_increased"      // stagger value increased
  | "stagger_node_reached"   // stagger node threshold hit
  | "stagger_full"           // entered stagger state
  // Resource events
  | "sp_restored"            // SP recovered
  | "sp_consumed"            // SP spent
  | "gauge_gained"           // ultimate gauge increased
  // Stack buff events
  | "stack_buff_gained"      // special layer buff gained
  | "stack_buff_consumed"    // special layer buff consumed
  // Buff events
  | "buff_applied"           // any buff applied
  | "buff_removed";          // any buff removed/expired

/**
 * Condition for trigger evaluation.
 * Can check enemy state, actor state, or event properties.
 */
export interface TriggerCondition {
  type: string;
  params: Record<string, unknown>;
}

// Known condition types:
// "enemy_has_attachment"     { element?: MagicElement }  — enemy has any/specific attachment
// "enemy_has_anomaly"        { anomalyType: AnomalyType }
// "enemy_has_break"          {}
// "enemy_is_staggered"       {}
// "actor_has_stack_buff"     { buffType: string, op: string, value: number }
// "consumed_element"         { element: MagicElement }  — for attachment_consumed events
// "source_action_type"       { actionType: ActionType }  — event came from this skill type

// ═══════════════════════════════════════════════════════════════════
// Event Log (kernel output)
// ═══════════════════════════════════════════════════════════════════

/** Base event structure. */
export interface BaseEvent {
  time: number;
  type: string;
}

/** Damage dealt by a hit. */
export interface DamageEvent extends BaseEvent {
  type: "damage";
  sourceId: string;
  targetId: string;
  damage: number;
  multiplier: number;
  stagger: number;
  isCrit: boolean;
  element: DamageElement;
  school: DamageSchool;
  actionId: string;
  hitIndex: number;
  /** True if this damage was produced by a trigger (phantom attack, iron oath, etc.) */
  fromTrigger?: boolean;
  /** Display name for trigger-produced damage (e.g., "幻影追击") */
  triggerName?: string;
}

/** Gauge change (charge or consume). */
export interface GaugeChangeEvent extends BaseEvent {
  type: "gauge_change";
  actorId: string;
  change: number;
  gauge: number;
  reason: string;
}

/** SP change. */
export interface SpChangeEvent extends BaseEvent {
  type: "sp_change";
  actorId: string;
  /** Signed change amount. */
  change: number;
  /** Which SP pool this change affects (specified by skill effect, not inferred). */
  spType: "true" | "refund";
  /** Current trueSP after this change. */
  currentTrueSP: number;
  /** Current refundSP after this change. */
  currentRefundSP: number;
  /** Total SP (trueSP + refundSP) after this change. */
  currentTotal: number;
  /** Why this change occurred. */
  reason: string;
  /** Source action/effect that caused this change. */
  sourceId?: string;
}

/** Buff applied or removed. */
export interface BuffEvent extends BaseEvent {
  type: "buff_apply" | "buff_remove" | "buff_tick";
  actorId: string;
  targetId: string;
  buffId: string;
  buffName: string;
  target: BuffTarget;
  stacks: number;
  duration: number;
  reason: string;
  /** Buff's stat id and zone, carried through so UI can fall back to a generic
   *  (stat+zone)-based icon when buffMetadata has no explicit entry. */
  stat?: string;
  zone?: string;
  /** If produced by a PassiveTrigger, the trigger's sourceRef — for "source
   *  icon" modes in the UI (who/what generated this buff). */
  sourceRef?: TriggerSourceRef;
}

/** Stack buff (special layer) change. */
export interface StackBuffEvent extends BaseEvent {
  type: "stack_change";
  actorId: string;
  buffType: string;
  stacks: number;
  prevStacks: number;
  reason: string;
}

/** Magic attachment change. */
export interface AttachmentEvent extends BaseEvent {
  type: "attachment_change";
  element: MagicElement | null;
  stacks: number;
  prevElement: MagicElement | null;
  prevStacks: number;
  /** Actor who caused this change. */
  sourceId?: string;
}

/** Anomaly status change. */
export interface AnomalyEvent extends BaseEvent {
  type: "anomaly_apply" | "anomaly_remove" | "anomaly_tick";
  anomalyType: AnomalyType;
  level: number;
  sourceId: string;
  /** Duration in seconds (present on anomaly_apply). */
  duration?: number;
}

/** Break status change. */
export interface BreakEvent extends BaseEvent {
  type: "break_change";
  stacks: number;
  prevStacks: number;
  /** Physical anomaly type that caused this change (slam/armorBreak/launch/knockdown). */
  physicalType?: string;
  /** Actor who caused this change. */
  sourceId?: string;
}

/** Stagger value change. */
export interface StaggerEvent extends BaseEvent {
  type: "stagger_change";
  amount: number;
  total: number;
  maxStagger: number;
  /** True if this change caused a stagger node to be reached. */
  nodeReached: boolean;
  nodeIndex?: number;
  /** True if this change caused full stagger (enter stagger state). */
  isFullStagger: boolean;
}

/** Action lifecycle. */
export interface ActionEvent extends BaseEvent {
  type: "action_start" | "action_end";
  actorId: string;
  actionId: string;
  skillType: ActionType;
  variantId?: string;
  /** True if this action was interrupted before its natural end. Only present on action_end events. */
  interrupted?: boolean;
  /** Visual duration override for frontend (e.g., internal CD indicator). Only present on action_end events. */
  displayDuration?: number;
  /** Hit offsets from the V2 Skill used by the kernel (seconds from action start). Only present on action_end events. */
  hitOffsets?: number[];
}

/** Variant selection result. */
export interface ConditionResultEvent extends BaseEvent {
  type: "condition_result";
  actorId: string;
  actionId: string;
  variantId: string | null;
  consumedBuffs?: { buffType: string; stacks: number }[];
}

/** Blaze-to-magma conversion. */
export interface ConvertEvent extends BaseEvent {
  type: "convert";
  actorId: string;
  sourceElement: MagicElement;
  targetBuff: string;
  amount: number;
}

/** Per-hit annotation marker. Used by UI to style ticks (e.g. conditional effects). */
export interface HitMarkEvent extends BaseEvent {
  type: "hit_mark";
  actionId: string;
  hitIndex: number;
  /** Marker kind. "conditional" = this hit fired at least one condition-gated effect. */
  kind: "conditional";
}

/** Union of all event types. */
export type SimEvent =
  | DamageEvent
  | GaugeChangeEvent
  | SpChangeEvent
  | BuffEvent
  | StackBuffEvent
  | AttachmentEvent
  | AnomalyEvent
  | BreakEvent
  | StaggerEvent
  | ActionEvent
  | ConditionResultEvent
  | ConvertEvent
  | HitMarkEvent;

/** Validation error — returned when a skill's conditions are not met. */
export interface ValidationError {
  actorId: string;
  actionId: string;
  code: string;
  message: string;
  time: number;
}

/** Complete simulation output. */
export interface SimulationResult {
  events: SimEvent[];
  finalState: {
    actors: Map<string, { gauge: number; trueSP: number; refundSP: number; stackBuffs: Record<string, number> }>;
    enemy: {
      stagger: number;
      breakStacks: number;
      attachment: { element: MagicElement | null; stacks: number };
      anomalies: Record<AnomalyType, boolean>;
    };
  };
  /** Set when validation aborts due to unmet conditions. Events are still populated up to the failure point. */
  validationError?: ValidationError;
}
