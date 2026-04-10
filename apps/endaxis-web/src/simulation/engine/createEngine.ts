import type {
  ActorSnapshot,
  EnemyConfig,
  TeamConfig,
} from "@/simulation/state/types.ts";
import { SimulationEngine } from "./SimulationEngine";
import { DamageHandler } from "../events/DamageHandler";
import { ActionStartHandler } from "../events/ActionStartHandler";
import { ActionEndHandler } from "../events/ActionEndHandler";
import { SpChangeHandler } from "../events/SpChangeHandler";
import { SpRegenPauseHandler } from "../events/SpRegenPauseHandler";
import { EffectStartHandler } from "../events/EffectStartHandler";
import { EffectEndHandler } from "../events/EffectEndHandler";
import { StaggerChangeHandler } from "../events/StaggerChangeHandler";
import {
  ApplyMagicAttachmentHandler,
  ApplyPhysicalAnomalyHandler,
  ApplyDirectAnomalyHandler,
  AnomalyDamageHandler,
} from "../anomaly/AnomalyHandlers";
import type { ResolvedTimeline } from "../compiler/types";
import type { DiagnosticCollector } from "../diagnostics";

export function createEngine(
  teamConfig: TeamConfig,
  enemyConfig: EnemyConfig,
  actors: ActorSnapshot[],
  timeline: ResolvedTimeline,
  diagnostics?: DiagnosticCollector,
) {
  const engine = new SimulationEngine(
    timeline,
    teamConfig,
    enemyConfig,
    actors,
    diagnostics,
  );

  // Core handlers
  engine.registerHandler("DAMAGE_TICK", new DamageHandler());
  engine.registerHandler("ACTION_START", new ActionStartHandler());
  engine.registerHandler("ACTION_END", new ActionEndHandler());
  engine.registerHandler("SP_CHANGE", new SpChangeHandler());
  engine.registerHandler("SP_REGEN_PAUSE", new SpRegenPauseHandler());
  engine.registerHandler("EFFECT_START", new EffectStartHandler());
  engine.registerHandler("EFFECT_END", new EffectEndHandler());
  engine.registerHandler("STAGGER_CHANGE", new StaggerChangeHandler());

  // Anomaly subsystem handlers
  engine.registerHandler("APPLY_MAGIC_ATTACHMENT", new ApplyMagicAttachmentHandler());
  engine.registerHandler("APPLY_PHYSICAL_ANOMALY", new ApplyPhysicalAnomalyHandler());
  engine.registerHandler("APPLY_DIRECT_ANOMALY", new ApplyDirectAnomalyHandler());
  engine.registerHandler("ANOMALY_DAMAGE", new AnomalyDamageHandler());

  return engine;
}
