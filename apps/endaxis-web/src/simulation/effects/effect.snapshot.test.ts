import { describe, it, expect } from "vitest";
import { Effect } from "./types";
import type { ActionStartEvent } from "../events/event.types";

describe("Effect snapshot / clone", () => {
  it("snapshot includes triggers when non-empty", () => {
    const e = new Effect({
      id: "t1",
      tags: ["PHYSICAL_BONUS"],
      duration: 10,
      triggers: [
        {
          event: "ACTION_START",
          action: () => {},
        },
      ],
    });
    const s = e.snapshot();
    expect(s.triggers).toHaveLength(1);
    expect(s.triggers![0]!.event).toBe("ACTION_START");
  });

  it("round-trip new Effect(snapshot()) restores triggers", () => {
    const e0 = new Effect({
      id: "t2",
      tags: ["PHYSICAL_BONUS"],
      duration: 10,
      triggers: [
        {
          event: "ACTION_START",
          condition: (ev) => (ev as ActionStartEvent).payload.type === "skill",
          action: () => {},
        },
      ],
    });
    const e1 = new Effect(e0.snapshot());
    expect(e1.triggers).toHaveLength(1);
    expect(e1.triggers[0]!.event).toBe("ACTION_START");
  });

  it("clone preserves triggers", () => {
    const e0 = new Effect({
      id: "t3",
      tags: [],
      duration: Infinity,
      triggers: [{ event: "DAMAGE_TICK", action: () => {} }],
    });
    const e1 = e0.clone();
    expect(e1.triggers).toHaveLength(1);
    expect(e1.triggers[0]!.event).toBe("DAMAGE_TICK");
  });
});
