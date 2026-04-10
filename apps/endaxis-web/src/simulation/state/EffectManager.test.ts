import { describe, it, expect, beforeEach } from "vitest";
import { EffectManager } from "./EffectManager";
import { Effect } from "../effects/types";

describe("EffectManager", () => {
  let manager: EffectManager;

  beforeEach(() => {
    manager = new EffectManager();
  });

  it("添加状态", () => {
    const effect = new Effect({
      id: "test_buff",
      name: "Test Buff",
      tags: ["ELEMENT_HEAT"],
    });

    manager.add(effect);

    expect(manager.getAll().length).toBe(1);
    expect(manager.hasTag("ELEMENT_HEAT")).toBe(true);
  });

  it("叠加状态", () => {
    const effect1 = new Effect({
      id: "stacking_buff",
      name: "Stacking Buff",
      tags: ["ELEMENT_HEAT"],
      currentStacks: 2,
      maxStacks: 4,
    });

    const effect2 = new Effect({
      id: "stacking_buff",
      name: "Stacking Buff",
      tags: ["ELEMENT_HEAT"],
      currentStacks: 3,
      maxStacks: 4,
    });

    manager.add(effect1);
    expect(manager.getAll()[0]?.effect.currentStacks).toBe(2);

    manager.add(effect2);
    expect(manager.getAll()).toHaveLength(1);
    expect(manager.getAll()[0]?.effect.currentStacks).toBe(4);
  });

  it("移除状态", () => {
    const effect = new Effect({
      id: "temp_buff",
      name: "Temp Buff",
      tags: ["ELEMENT_HEAT"],
    });

    const inst = manager.add(effect);
    expect(manager.hasTag("ELEMENT_HEAT")).toBe(true);

    manager.remove(inst.id);
    expect(manager.getAll().length).toBe(0);
    expect(manager.hasTag("ELEMENT_HEAT")).toBe(false);
  });

  // ── getByEffectId ──

  describe("getByEffectId", () => {
    it("returns the instance matching effect.id", () => {
      manager.add(new Effect({ id: "alpha", tags: [] }));
      manager.add(new Effect({ id: "beta", tags: [] }));
      expect(manager.getByEffectId("alpha")).toBeDefined();
      expect(manager.getByEffectId("alpha")!.effect.id).toBe("alpha");
    });

    it("returns undefined when not found", () => {
      expect(manager.getByEffectId("missing")).toBeUndefined();
    });
  });

  // ── removeByTag ──

  describe("removeByTag", () => {
    it("removes all effects with the given tag", () => {
      manager.add(new Effect({ id: "a", tags: ["PHYSICAL_BONUS"] }));
      manager.add(new Effect({ id: "b", tags: ["PHYSICAL_BONUS", "DEBUFF_RES_DOWN"] }));
      manager.add(new Effect({ id: "c", tags: ["DEBUFF_RES_DOWN"] }));

      const removed = manager.removeByTag("PHYSICAL_BONUS");
      expect(removed).toHaveLength(2);
      expect(manager.getAll()).toHaveLength(1);
      expect(manager.getAll()[0]!.effect.id).toBe("c");
    });

    it("removes at most `count` effects (oldest first)", () => {
      manager.add(new Effect({ id: "a", tags: ["ELEMENT_HEAT"], startTime: 5 }));
      manager.add(new Effect({ id: "b", tags: ["ELEMENT_HEAT"], startTime: 1 }));
      manager.add(new Effect({ id: "c", tags: ["ELEMENT_HEAT"], startTime: 3 }));

      const removed = manager.removeByTag("ELEMENT_HEAT", 2);
      expect(removed).toHaveLength(2);
      expect(manager.getAll()).toHaveLength(1);
      expect(manager.getAll()[0]!.effect.startTime).toBe(5);
    });

    it("returns empty array when tag not found", () => {
      manager.add(new Effect({ id: "a", tags: ["PHYSICAL_BONUS"] }));
      expect(manager.removeByTag("DEBUFF_RES_DOWN")).toHaveLength(0);
    });

    it("updates tag counts correctly", () => {
      manager.add(new Effect({ id: "a", tags: ["PHYSICAL_BONUS"] }));
      expect(manager.hasTag("PHYSICAL_BONUS")).toBe(true);
      manager.removeByTag("PHYSICAL_BONUS");
      expect(manager.hasTag("PHYSICAL_BONUS")).toBe(false);
    });
  });

  // ── removeByEffectId ──

  describe("removeByEffectId", () => {
    it("removes the instance with matching effect.id", () => {
      manager.add(new Effect({ id: "target", tags: ["ELEMENT_HEAT"] }));
      manager.add(new Effect({ id: "other", tags: [] }));

      const removed = manager.removeByEffectId("target");
      expect(removed).toHaveLength(1);
      expect(manager.getAll()).toHaveLength(1);
      expect(manager.getAll()[0]!.effect.id).toBe("other");
      expect(manager.hasTag("ELEMENT_HEAT")).toBe(false);
    });

    it("returns empty array when id not found", () => {
      expect(manager.removeByEffectId("nope")).toHaveLength(0);
    });
  });

  // ── consumeStacks ──

  describe("consumeStacks", () => {
    it("decrements stacks and returns consumed count", () => {
      manager.add(new Effect({ id: "buff", tags: [], maxStacks: 5, currentStacks: 3 }));
      const consumed = manager.consumeStacks("buff", 2);
      expect(consumed).toBe(2);
      expect(manager.getByEffectId("buff")!.effect.currentStacks).toBe(1);
    });

    it("removes effect when stacks reach 0", () => {
      manager.add(new Effect({ id: "buff", tags: ["PHYSICAL_BONUS"], maxStacks: 3, currentStacks: 2 }));
      const consumed = manager.consumeStacks("buff", 2);
      expect(consumed).toBe(2);
      expect(manager.getByEffectId("buff")).toBeUndefined();
      expect(manager.hasTag("PHYSICAL_BONUS")).toBe(false);
    });

    it("consumes only available stacks if count exceeds current", () => {
      manager.add(new Effect({ id: "buff", tags: [], maxStacks: 5, currentStacks: 2 }));
      const consumed = manager.consumeStacks("buff", 10);
      expect(consumed).toBe(2);
      expect(manager.getByEffectId("buff")).toBeUndefined();
    });

    it("returns 0 when effect not found", () => {
      expect(manager.consumeStacks("missing", 1)).toBe(0);
    });
  });

  // ── consumeStackGroup ──

  describe("consumeStackGroup", () => {
    it("removes oldest stacks by startTime", () => {
      manager.add(new Effect({ id: "s1", tags: [], startTime: 10, properties: { stackGroup: "grp" } }));
      manager.add(new Effect({ id: "s2", tags: [], startTime: 2, properties: { stackGroup: "grp" } }));
      manager.add(new Effect({ id: "s3", tags: [], startTime: 6, properties: { stackGroup: "grp" } }));
      manager.add(new Effect({ id: "other", tags: [], startTime: 0 }));

      const removed = manager.consumeStackGroup("grp", 2);
      expect(removed).toBe(2);
      const remaining = manager.getAll().map((i) => i.effect.id).sort();
      expect(remaining).toEqual(["other", "s1"]);
    });

    it("returns 0 when no matching group", () => {
      manager.add(new Effect({ id: "a", tags: [] }));
      expect(manager.consumeStackGroup("nope", 3)).toBe(0);
    });

    it("returns actual count when fewer than requested", () => {
      manager.add(new Effect({ id: "s1", tags: [], properties: { stackGroup: "grp" } }));
      expect(manager.consumeStackGroup("grp", 5)).toBe(1);
      expect(manager.getAll()).toHaveLength(0);
    });
  });
});
