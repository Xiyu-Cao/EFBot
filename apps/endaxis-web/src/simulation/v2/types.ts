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
  /** All hits in chronological order. */
  hits: Hit[];
  /** Checkpoint segments for interrupt system. */
  checkpoints: Checkpoint[];
  /** Gauge cost, consumed on cast (ultimate only). */
  gaugeCost?: number;
  /** Gauge gain for all team members, triggered on cast (SP consumption → charge). */
  teamGaugeGain?: number;
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
}

/** Anomaly status change. */
export interface AnomalyEvent extends BaseEvent {
  type: "anomaly_apply" | "anomaly_remove" | "anomaly_tick";
  anomalyType: AnomalyType;
  level: number;
  sourceId: string;
}

/** Break status change. */
export interface BreakEvent extends BaseEvent {
  type: "break_change";
  stacks: number;
  prevStacks: number;
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
  | ConvertEvent;

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
}
