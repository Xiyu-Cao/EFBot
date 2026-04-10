import type { ActorSnapshot } from "@/simulation/state/types.ts";
import type { BaseGameState } from "./BaseGameState";
import { EffectManager } from "./EffectManager";
import type { ResolvedAction } from "../compiler/types";
import type { EffectSnapshot } from "../effects/types";

export class ActorState implements BaseGameState<ActorSnapshot> {
  public effects: EffectManager;

  /** The action currently being executed, or null if idle. */
  private activeAction: ResolvedAction | null = null;

  /** Mutable ultimate gauge (终结技能量). Initialized from snapshot. */
  private gauge: number;
  /** Per-actor gauge cap. */
  private readonly maxGauge: number;
  /** Self-buff stacks (exclusive_buffs like magma, skillwater, etc.) */
  private selfBuffStacks: Record<string, number> = {};
  /** Max stacks per self-buff type */
  private static SELF_BUFF_MAX_STACKS = 4;

  /**
   * Cooldown map: skillId -> game time when the cooldown expires.
   * Written when an action with cooldown > 0 ends.
   * Read (future) by validation / canCast checks.
   */
  private cooldowns: Map<string, number> = new Map();

  constructor(public readonly snapshotData: ActorSnapshot) {
    this.effects = new EffectManager();
    this.gauge = snapshotData.resources.gauge;
    this.maxGauge = snapshotData.resources.maxGauge;
    // snapshotData.activeBuffs is not hydrated into EffectManager; runtime
    // buffs live only in this.effects. Rebuild via compile/passives as needed.
  }

  get id() {
    return this.snapshotData.id;
  }

  // -- Active action lifecycle --

  setActiveAction(action: ResolvedAction) {
    this.activeAction = action;
  }

  clearActiveAction() {
    this.activeAction = null;
  }

  getActiveAction(): ResolvedAction | null {
    return this.activeAction;
  }

  // -- Cooldown management --

  /**
   * Start a cooldown for a skill.
   * @param skillId - the skill's base id (e.g. "CHENQIANYU_link")
   * @param expiresAt - game time when the cooldown expires
   */
  setCooldown(skillId: string, expiresAt: number) {
    this.cooldowns.set(skillId, expiresAt);
  }

  /**
   * Check if a skill is on cooldown at the given time.
   *
   * TODO: This will be the basis for canCast / validation in a future phase.
   */
  isOnCooldown(skillId: string, currentTime: number): boolean {
    const expiresAt = this.cooldowns.get(skillId);
    if (expiresAt === undefined) return false;
    return currentTime < expiresAt - 0.0001;
  }

  getCooldownExpiry(skillId: string): number | undefined {
    return this.cooldowns.get(skillId);
  }

  /**
   * Reduce a skill's remaining cooldown by a fixed amount (seconds).
   * Does nothing if the skill is not on cooldown.
   */
  reduceCooldown(skillId: string, amount: number) {
    const expiresAt = this.cooldowns.get(skillId);
    if (expiresAt !== undefined) {
      this.cooldowns.set(skillId, expiresAt - amount);
    }
  }

  // -- Gauge (终结技能量) --

  getGauge(): number {
    return this.gauge;
  }

  getMaxGauge(): number {
    return this.maxGauge;
  }

  /**
   * Modify gauge by a signed amount. Clamped to [0, maxGauge].
   */
  modifyGauge(amount: number): number {
    this.gauge = Math.max(0, Math.min(this.gauge + amount, this.maxGauge));
    return this.gauge;
  }

  // -- Self-buff stacks (exclusive_buffs: magma, skillwater, etc.) --

  getSelfBuffStacks(prefix: string): number {
    return this.selfBuffStacks[prefix] || 0;
  }

  getAllSelfBuffStacks(): Record<string, number> {
    return { ...this.selfBuffStacks };
  }

  addSelfBuffStacks(prefix: string, amount: number): { prev: number; current: number } {
    const prev = this.selfBuffStacks[prefix] || 0;
    this.selfBuffStacks[prefix] = Math.min(ActorState.SELF_BUFF_MAX_STACKS, prev + amount);
    return { prev, current: this.selfBuffStacks[prefix] };
  }

  consumeSelfBuff(prefix: string): { prev: number; current: number } {
    const prev = this.selfBuffStacks[prefix] || 0;
    this.selfBuffStacks[prefix] = 0;
    return { prev, current: 0 };
  }

  // -- Lifecycle --

  advanceTime(_dt: number, currentTime: number) {
    // Sweep expired dynamic buffs from equipment/weapon triggers
    this.effects.sweepExpired(currentTime);
  }

  /**
   * Build the activeBuffs map from the live EffectManager state.
   */
  private buildActiveBuffs(): Map<string, EffectSnapshot> {
    const buffs = new Map<string, EffectSnapshot>();
    for (const instance of this.effects.getAll()) {
      buffs.set(instance.id, instance.effect.snapshot());
    }
    return buffs;
  }

  snapshot(): ActorSnapshot {
    return {
      ...this.snapshotData,
      resources: { ...this.snapshotData.resources, gauge: this.gauge },
      cooldowns: new Map(this.cooldowns),
      activeBuffs: this.buildActiveBuffs(),
      activeAction: this.activeAction ?? undefined,
    };
  }
}
