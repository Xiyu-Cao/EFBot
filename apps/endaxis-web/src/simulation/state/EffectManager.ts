import { Effect } from "../effects/types";
import type { EffectTag } from "../effects/types";

export type EffectInstance = {
  id: string;
  effect: Effect;
};

export class EffectManager {
  private counter = 0;
  private effectInstances: Map<string, EffectInstance> = new Map();
  private tagCounts: Map<EffectTag, number> = new Map();

  constructor() {}

  add(effect: Effect): EffectInstance {
    const existing = this.getByEffectId(effect.id);

    // 同id堆叠
    if (existing && existing.effect.isStackable()) {
      return {
        id: existing.id,
        effect: this.handleStacking(existing.effect, effect),
      };
    }

    const instanceId = `${effect.id}_${this.counter++}`;

    this.effectInstances.set(instanceId, { id: instanceId, effect });
    this.updateTags(effect, 1);

    return {
      id: instanceId,
      effect,
    };
  }

  remove(instanceId: string): EffectInstance | undefined {
    const instance = this.effectInstances.get(instanceId);
    if (instance) {
      this.effectInstances.delete(instanceId);
      this.updateTags(instance.effect, -1);
    }
    return instance;
  }

  hasTag(tag: EffectTag): boolean {
    return (this.tagCounts.get(tag) || 0) > 0;
  }

  getByTag(tag: EffectTag): EffectInstance[] {
    const results: EffectInstance[] = [];
    for (const instance of this.effectInstances.values()) {
      if (instance.effect.tags.includes(tag)) results.push(instance);
    }
    return results;
  }

  getAll(): EffectInstance[] {
    return Array.from(this.effectInstances.values());
  }

  getAllTags(): EffectTag[] {
    const tags = Array.from(this.tagCounts.keys());
    return tags.filter((tag) => this.tagCounts.get(tag)! > 0);
  }

  /**
   * Remove all effects whose duration has expired at the given time.
   * Call this periodically (e.g. from ActorState.advanceTime) to keep
   * the EffectManager clean.
   *
   * Effects with duration === Infinity are never swept.
   */
  sweepExpired(currentTime: number): number {
    let removed = 0;
    for (const [instanceId, instance] of this.effectInstances) {
      const eff = instance.effect;
      if (eff.duration !== Infinity && currentTime >= eff.startTime + eff.duration) {
        this.effectInstances.delete(instanceId);
        this.updateTags(eff, -1);
        removed++;
      }
    }
    return removed;
  }

  private handleStacking(existing: Effect, incoming: Effect): Effect {
    if (!existing.currentStacks) {
      existing.currentStacks = Math.min(
        existing.maxStacks,
        incoming.currentStacks,
      );
    }

    if (existing.currentStacks < existing.maxStacks) {
      existing.currentStacks = Math.min(
        existing.maxStacks,
        existing.currentStacks + incoming.currentStacks,
      );
    }

    if (existing.stackStrategy === "REFRESH_DURATION") {
      existing.startTime = incoming.startTime;
    }

    return existing;
  }

  /**
   * Find the first effect instance whose effect.id matches.
   */
  getByEffectId(id: string): EffectInstance | undefined {
    return this.effectInstances
      .values()
      .find((instance) => instance.effect.id === id);
  }

  /**
   * Remove effects that carry the given tag.
   * If `count` is provided, removes at most that many (oldest first by startTime).
   * Returns the removed instances.
   */
  removeByTag(tag: EffectTag, count?: number): EffectInstance[] {
    let candidates: EffectInstance[] = [];
    for (const instance of this.effectInstances.values()) {
      if (instance.effect.tags.includes(tag)) candidates.push(instance);
    }
    if (count !== undefined) {
      candidates.sort((a, b) => a.effect.startTime - b.effect.startTime);
      candidates = candidates.slice(0, count);
    }
    for (const inst of candidates) {
      this.effectInstances.delete(inst.id);
      this.updateTags(inst.effect, -1);
    }
    return candidates;
  }

  /**
   * Remove all effect instances whose effect.id matches.
   * Returns the removed instances.
   */
  removeByEffectId(effectId: string): EffectInstance[] {
    const removed: EffectInstance[] = [];
    for (const [instanceId, instance] of this.effectInstances) {
      if (instance.effect.id === effectId) {
        this.effectInstances.delete(instanceId);
        this.updateTags(instance.effect, -1);
        removed.push(instance);
      }
    }
    return removed;
  }

  /**
   * Consume N stacks from a stackable effect found by effect.id.
   * If stacks reach 0, removes the effect entirely.
   * Returns the number of stacks actually consumed.
   */
  consumeStacks(effectId: string, count: number): number {
    const instance = this.getByEffectId(effectId);
    if (!instance) return 0;

    const eff = instance.effect;
    const consumed = Math.min(count, eff.currentStacks);
    eff.currentStacks -= consumed;

    if (eff.currentStacks <= 0) {
      this.effectInstances.delete(instance.id);
      this.updateTags(eff, -1);
    }

    return consumed;
  }

  /**
   * Consume independent-duration stacks by stackGroup property.
   * Removes the N oldest stacks (by startTime).
   * Returns the number actually removed.
   */
  consumeStackGroup(groupId: string, count: number): number {
    const matching = this.getAll()
      .filter((inst) => inst.effect.properties.stackGroup === groupId);
    matching.sort((a, b) => a.effect.startTime - b.effect.startTime);

    let removed = 0;
    for (const inst of matching) {
      if (removed >= count) break;
      this.effectInstances.delete(inst.id);
      this.updateTags(inst.effect, -1);
      removed++;
    }
    return removed;
  }

  private updateTags(effect: Effect, delta: number) {
    effect.tags.forEach((tag) => {
      const current = this.tagCounts.get(tag) || 0;
      this.tagCounts.set(tag, Math.max(0, current + delta));
    });
  }
}
