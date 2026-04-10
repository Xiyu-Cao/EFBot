/**
 * Built-in bound-effect registrations expressed via the declarative ops system.
 *
 * Call registerBuiltinBoundEffects() once during engine creation to register
 * all built-in pre/post damage handlers.
 */

import { registerBoundEffectOps } from "./boundEffectOps";
import { preDamageRegistry, postDamageRegistry } from "./DamageHandler";
import { Effect } from "../effects/types";
import type { DamageTickEvent } from "./event.types";
import type { SimulationContext } from "../engine/SimulationContext";
import { getSkillsJsonRowByLabel } from "../data/skillMultipliers";
import type { DynamicBonus } from "../equipment/types";

// ---------------------------------------------------------------------------
// Helpers — shared skill-level lookup logic
// ---------------------------------------------------------------------------

function getUnifiedLevel(e: DamageTickEvent, ctx: SimulationContext): number {
  const action = ctx.getAction(e.payload.actionId);
  return (action as any)?._unifiedSkillLevel ?? 12;
}

function levelIdx(unifiedLevel: number): number {
  return Math.max(0, Math.min(11, unifiedLevel - 1));
}

// ---------------------------------------------------------------------------
// consume_conduction
// ---------------------------------------------------------------------------

const CONSUME_CONDUCTION: BoundEffectOp[] = [
  { op: "consume_enemy_status", phase: "post", statusType: "conduction" },
];

// ---------------------------------------------------------------------------
// consume_corrosion_apply_vuln
// ---------------------------------------------------------------------------

/** Check if ARDELIA has P1 (羊的乐园): +8% vuln bonus. */
function getArdeliaP1Bonus(ctx: SimulationContext): number {
  try {
    const actor = ctx.state.getActor("ARDELIA");
    const potLevel = (actor.snapshotData.stats as any)?._potentialLevel;
    return typeof potLevel === "number" && potLevel >= 1 ? 8 : 0;
  } catch { return 0; }
}

const CONSUME_CORROSION_APPLY_VULN: BoundEffectOp[] = [
  { op: "consume_enemy_status", phase: "post", statusType: "corrosion" },
  {
    op: "apply_buff",
    phase: "post",
    target: "enemy",
    effectFactory: (e, ctx) => {
      const lvl = getUnifiedLevel(e, ctx);
      const idx = levelIdx(lvl);
      const vulnRow = getSkillsJsonRowByLabel("ARDELIA", "skill", "脆弱效果") ?? [];
      const durRow = getSkillsJsonRowByLabel("ARDELIA", "skill", "脆弱持续时间（秒）") ?? [];
      const vulnPct = parseFloat(String(vulnRow[idx] ?? "20").replace("%", "")) + getArdeliaP1Bonus(ctx);
      const vulnDur = parseFloat(String(durRow[idx] ?? "30"));

      return new Effect({
        id: "PHYSICAL_VULNERABLE",
        tags: ["PHYSICAL_VULNERABLE"],
        duration: vulnDur,
        startTime: ctx.state.getCurrentTime(),
        properties: { physVulnPercent: vulnPct, sourceActorId: e.payload.sourceId },
      });
    },
  },
  {
    op: "apply_buff",
    phase: "post",
    target: "enemy",
    effectFactory: (e, ctx) => {
      const lvl = getUnifiedLevel(e, ctx);
      const idx = levelIdx(lvl);
      const vulnRow = getSkillsJsonRowByLabel("ARDELIA", "skill", "脆弱效果") ?? [];
      const durRow = getSkillsJsonRowByLabel("ARDELIA", "skill", "脆弱持续时间（秒）") ?? [];
      const vulnPct = parseFloat(String(vulnRow[idx] ?? "20").replace("%", "")) + getArdeliaP1Bonus(ctx);
      const vulnDur = parseFloat(String(durRow[idx] ?? "30"));

      return new Effect({
        id: "SPELL_VULNERABLE",
        tags: [],
        duration: vulnDur,
        startTime: ctx.state.getCurrentTime(),
        properties: {
          dynamicBonuses: [{ stat: "arts_dmg", value: vulnPct, zone: "fragility" }] as DynamicBonus[],
          sourceActorId: e.payload.sourceId,
        },
      });
    },
  },
];

// estella_phys_vuln_if_frozen: REMOVED
// Now handled by Route 2.7 in simulator.ts (conditional on frozen, applied at compile time).
// This ensures physical_vulnerable is active for ALL same-frame damage (knockup, shatter, skill).

// ---------------------------------------------------------------------------
// Registration entry point
// ---------------------------------------------------------------------------

let registered = false;

export function registerBuiltinBoundEffects(): void {
  if (registered) return;
  registered = true;

  const registries = { pre: preDamageRegistry, post: postDamageRegistry };

  registerBoundEffectOps("consume_conduction", CONSUME_CONDUCTION, registries);
  registerBoundEffectOps("consume_corrosion_apply_vuln", CONSUME_CORROSION_APPLY_VULN, registries);
}
