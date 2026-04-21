import type { TimeContext } from "@/simulation/compiler/timeContext.ts";

// ── Types previously imported from V1 state/ and diagnostics.ts, inlined
//    here so the compiler module stands alone after the V1 cleanup. The
//    compile step is the only V1 module still wired into the live pipeline
//    (timelineStore → compileScenario), so it needs no cross-module V1
//    references. ──

/** Per-type control immunity flags. */
export interface ControlImmunities {
  freeze?: boolean;
  launch?: boolean;
  knockdown?: boolean;
}

export interface EnemyConfig {
  maxStagger: number;
  staggerNodeCount: number;
  staggerNodeDuration: number;
  staggerBreakDuration: number;
  executionRecovery: number;
  defenseMultiplier?: number;
  baseMagicResist?: number;
  basePhysicalResist?: number;
  controlImmunities?: ControlImmunities;
}

export interface TeamConfig {
  maxSp: number;
  initialSp: number;
  spRegenRate: number;
  skillSpCostDefault: number;
  linkCdReduction: number;
}

/** Minimal per-actor snapshot emitted by `compileScenario`. `activeBuffs` is
 *  constructed empty; its downstream consumers have all been removed along
 *  with the V1 engine, so the value type is loosened to `unknown`. */
export interface ActorSnapshot {
  id: string;
  stats: ActorStats;
  resources: {
    hp: number;
    gauge: number;
    maxGauge: number;
  };
  cooldowns: Map<string, number>;
  activeBuffs: Map<string, unknown>;
}

export interface Diagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  context?: {
    actionId?: string;
    effectType?: string;
    actorId?: string;
    [key: string]: unknown;
  };
}

export interface ScenarioData {
  tracks: ScenarioTrack[];
  connections?: Connection[];

  // config
  systemConstants?: SystemConstants;
  characterOverrides?: Record<string, any>;
  weaponOverrides?: Record<string, any>;
  equipmentCategoryOverrides?: Record<string, any>;
  weaponStatuses?: any[];

  // enemy
  activeEnemyId?: string;
  customEnemyParams?: Partial<EnemyConfig>;

  switchEvents?: SwitchEvent[];

  // others
  [key: string]: any;
}

export type SystemConstants = EnemyConfig & TeamConfig;

export interface SwitchEvent {
  // TOOD
}

export interface Connection {
  id: string;
  from: string;
  to: string;
  fromEffectId?: string | null;
  fromEffectIndex?: number | null;
  toEffectId?: string | null;
  toEffectIndex?: number | null;
  isConsumption?: boolean;
  consumptionOffset?: number;
  targetPort?: string;
  sourcePort?: string;
}

export type ActorStats = {
  primary_ability: number;
  secondary_ability: number;
  strength: number;
  agility: number;
  intellect: number;
  will: number;
  attack: number;
  hp: number;
  crit_rate: number;
  crit_dmg: number;
  blaze_dmg: number;
  emag_dmg: number;
  cold_dmg: number;
  nature_dmg: number;
  healing_effect: number;
  physical_dmg: number;
  arts_dmg: number;
  attack_dmg_bonus: number;
  skill_dmg_bonus: number;
  link_dmg_bonus: number;
  ultimate_dmg_bonus: number;
  all_skill_dmg_bonus: number;
  broken_dmg_bonus: number;
  originium_arts_power: number;
  ult_charge_eff: number;
  link_cd_reduction: number;
};

export type ActorStatKeys = keyof ActorStats;

export interface ScenarioTrack {
  // 角色名
  id: string;
  actions: Action[];

  // stats
  stats: ActorStats;
  /**
   * @deprecated - use stats.ult_charge_eff
   */
  gaugeEfficiency: number;
  /**
   * @deprecated - use stats.originium_arts_power
   */
  originiumArtsPower: number;
  /**
   * @deprecated - use stats.link_cd_reduction
   */
  linkCdReduction: number;

  // config
  initialGauge: number;
  maxGaugeOverride?: number | null;

  // equipment
  weaponId?: string | null;
  weaponCommon1Tier?: number;
  weaponCommon2Tier?: number;
  weaponBuffTier?: number;
  weaponAppliedDeltas?: Record<string, any>;
  equipArmorId?: string | null;
  equipGlovesId?: string | null;
  equipAccessory1Id?: string | null;
  equipAccessory2Id?: string | null;
}

export interface GameDatabase {
  weaponDatabase?: Array<{
    id: string;
    name: string;
    passiveStats?: Record<string, number>;
    triggeredBuffs?: Array<{
      trigger: string;
      name?: string;
      target: string;
      effects: Array<{ stat?: string; value?: number; zone?: string; unit?: string }>;
      duration: number | null;
      maxStacks?: number;
      stackCooldown?: number;
      _raw?: string;
    }>;
  }>;
  equipmentDatabase?: Array<{
    id: string;
    category?: string;
    slot?: string;
  }>;
}

export interface CompiledScenario {
  timeline: ResolvedTimeline;
  actors: ActorSnapshot[];
  teamConfig: TeamConfig;
  enemyConfig: EnemyConfig;
  systemConstants: SystemConstants;
  /** Compile-phase diagnostics; merged with simulate diagnostics in runSimulation */
  diagnostics: readonly Diagnostic[];
}

export interface Anomaly {
  _id: string;
  offset: number;
  duration: number;
  type: string;
  sp?: number;
  stagger?: number;
  stacks: number | string; // numeric string
  /** 脱手效果：打断后仍然生效（如已施加的燃烧、已部署的晶体） */
  detached?: boolean;
}

export interface DamageTick {
  offset: number;
  sp: number;
  stagger: number;
  boundEffects?: string[];
  /** 该 tick 的伤害倍率（0 或缺省表示无数据，跳过伤害计算） */
  multiplier?: number;
}

export interface ResolvedDamageTick extends DamageTick {
  realTime: number;
  realOffset: number;
  time: number;
}

export type ActionType =
  | "execution" // 处决
  | "skill" // 技能
  | "link" // 连携
  | "ultimate" // 终结技
  | "attack" // 重击
  | "dodge"; // 闪避

// ── Release condition types (for variant selection) ──

export interface ReleaseCondition {
  type: string; // "selfBuff" | "ultimateActive"
  key?: string;
  op?: string;  // ">=" | "<=" | ">" | "<" | "==" | "!="
  value?: number;
}

export interface ReleaseConditionEntry {
  priority: number;
  conditions: ReleaseCondition[];
  result: {
    variantId: string;
    consumeSelfBuffs?: { key: string; stacks: number | "all" }[];
  };
}

export interface ActionVariant {
  id: string;
  name?: string;
  type?: ActionType;
  duration?: number;
  spCost?: number;
  gaugeGain?: number;
  teamGaugeGain?: number;
  damageTicks?: DamageTick[];
  physicalAnomaly?: Anomaly[][];
}

export interface Action {
  id: string;
  instanceId: string;
  type: ActionType;
  name: string;
  startTime: number;
  logicalStartTime: number;
  cooldown: number;
  spCost: number;
  spGain?: number;
  element: string;
  librarySource?: string;
  icon?: string;
  gaugeCost: number;
  gaugeGain: number;
  teamGaugeGain: number;
  enhancementTime?: number;
  duration: number;
  triggerWindow?: number;
  animationTime?: number;
  isDisabled?: boolean;
  weaponId?: string | null;
  sourceWeaponId?: string | null;
  allowedTypes: string[];
  damageTicks: DamageTick[];
  physicalAnomaly: Anomaly[][];
  /** 打断承诺点 offset 数组（升序），将 action 分为 segment */
  checkpoints?: number[];
  /** Available variants for this action (populated from characterRoster) */
  variants?: ActionVariant[];
  /** Release conditions for variant selection (populated from characterRoster) */
  releaseConditions?: ReleaseConditionEntry[];

  isLocked?: boolean;
  customBars?: any[];
  customColor?: string | null;
}

export interface ActionNode {
  type: "action";
  id: string;
  trackIndex: number;
  trackId: string;
  node: Action;
}

export interface AnomalyNode {
  type: "effect";
  id: string;
  actionId: string;
  colIndex: number;
  rowIndex: number;
  flatIndex: number;
  node: Anomaly;
}

export interface ResolvedEffect extends AnomalyNode {
  uniqueId: string;
  realDuration: number;
  realStartTime: number;
  displayDuration: number;
  isConsumed: boolean;
  extensionAmount: number;
}

export interface ResolvedAction extends ActionNode {
  startTime: number;
  realStartTime: number;
  duration: number;
  realDuration: number;
  isInterrupted: boolean;
  /** 打断发生的相对 offset（相对于 action 起始） */
  interruptOffset?: number;
  /** 从哪个 segment 开始被取消（0-based，对应 checkpoints 分段） */
  cancelledFromSegment?: number;
  effects: ResolvedEffect[];
  triggerWindow: {
    hasWindow: boolean;
    startTime: number;
    duration: number;
  };
  resolvedDamageTicks: ResolvedDamageTick[];
  extensionAmount: number;
  freezeDuration?: number;
}

export interface TimeExtension {
  time: number;
  gameTime: number;
  amount: number;
  sourceId: string;
  logicalTime: number;
  cumulativeFreezeTime: number;
}

export interface ResolvedTimeline {
  actions: ResolvedAction[];
  actionMap: Map<string, ResolvedAction>;
  effectMap: Map<string, ResolvedEffect>;
  timeExtensions: TimeExtension[];
  timeContext: TimeContext;
  meta: {
    totalDuration: number;
  };
}
