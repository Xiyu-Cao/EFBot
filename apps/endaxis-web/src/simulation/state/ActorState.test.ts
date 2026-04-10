import { describe, it, expect } from "vitest";
import { ActorState } from "./ActorState";
import { Effect } from "../effects/types";
import type { ActorSnapshot } from "./types";
import { createDefaultStats } from "@/utils/coreStats";
import type { ActorStats } from "../compiler/types";

function makeActorSnapshot(id: string): ActorSnapshot {
  return {
    id,
    stats: createDefaultStats() as ActorStats,
    resources: { hp: 1000, gauge: 0 },
    cooldowns: new Map(),
    activeBuffs: new Map(),
  };
}

describe("ActorState", () => {
  it("activeBuffs in snapshot mirrors EffectManager add/remove", () => {
    const state = new ActorState(makeActorSnapshot("A"));
    expect(state.snapshot().activeBuffs.size).toBe(0);

    const inst = state.effects.add(
      new Effect({
        id: "buff_a",
        tags: ["DEBUFF_RES_DOWN"],
        duration: Infinity,
        name: "Test",
      }),
    );
    expect(state.snapshot().activeBuffs.size).toBe(1);
    expect(state.snapshot().activeBuffs.get(inst.id)?.id).toBe("buff_a");

    state.effects.remove(inst.id);
    expect(state.snapshot().activeBuffs.size).toBe(0);
  });
});
