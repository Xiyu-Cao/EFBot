/**
 * runSimulation — unified headless entry point for the simulation pipeline.
 *
 * Compiles a scenario, runs the simulation, and returns a structured result
 * that includes the state, log, diagnostics, and (future) rejected actions.
 *
 * Usage:
 *   import { runSimulation } from '@/simulation/runSimulation';
 *   const result = runSimulation(scenarioData, { db: gamedataJson });
 *   console.log(result.diagnostics);
 *   console.log(result.simLog);
 */

import {
  compileScenario,
  type CompileOptions,
} from "./compiler/compileScenario";
import { simulate, type SimulationResult } from "./simulator";
import type { ScenarioData, CompiledScenario } from "./compiler/types";
import type { Diagnostic } from "./diagnostics";
import { extractEquipmentConfigs } from "./equipment/registry";
import type { LegalityIssue } from "./legality/types";

export interface RunSimulationResult {
  compiled: CompiledScenario;
  state: SimulationResult["state"];
  simLog: SimulationResult["simLog"];
  diagnostics: readonly Diagnostic[];
  legalityIssues: readonly LegalityIssue[];
}

export type CompileOptions_ = CompileOptions;

export function runSimulation(
  scenario: ScenarioData,
  options?: CompileOptions,
): RunSimulationResult {
  const compiled = compileScenario(scenario, options);

  // Extract equipment/weapon configs from scenario tracks.
  // equipmentDatabase comes from options.db or scenario-level attachment.
  const db = options?.db;
  const equipmentConfigs = extractEquipmentConfigs(
    scenario,
    db?.equipmentDatabase,
  );

  const { state, simLog, diagnostics: simulateDiagnostics, legalityIssues } = simulate(
    compiled.timeline,
    compiled.teamConfig,
    compiled.enemyConfig,
    compiled.actors,
    {
      equipmentConfigs: equipmentConfigs.length > 0 ? equipmentConfigs : undefined,
      db,
      rng: options?.rng,
    },
  );

  const diagnostics = [...compiled.diagnostics, ...simulateDiagnostics];

  return {
    compiled,
    state,
    simLog,
    diagnostics,
    legalityIssues,
  };
}
