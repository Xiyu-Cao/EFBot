import { compileTimeline } from "./compileTimeline";
import type {
  ActionNode,
  ActorSnapshot,
  ActorStats,
  CompiledScenario,
  GameDatabase,
  ScenarioData,
  ScenarioTrack,
  SystemConstants,
} from "./types";
import { createDefaultStats } from "@/utils/coreStats";

// SP constants previously lived in `calculation/resourceFormulas` (now
// deleted with the rest of V1). The V2 kernel owns the authoritative
// copies but they are trivial and only referenced here for default
// system constants, so they are inlined rather than cross-imported.
const SP_REGEN_RATE = 8.5;
const SP_CAP = 300;
const DEFAULT_SKILL_SP_COST = 100;

function normalizeTracks(tracks: ScenarioTrack[]): ScenarioTrack[] {
  return tracks.map((track) => {
    const baseStats = createDefaultStats() as ActorStats;
    track.stats = { ...baseStats, ...track.stats };

    return track;
  });
}

function processActors(tracks: ScenarioTrack[]): ActorSnapshot[] {
  return tracks
    .filter((t) => !!t.id)
    .map((track) => {
      // maxGauge = explicit override > ultimate gaugeCost from actions > 100
      // In-game, gauge cap equals the ultimate's energy requirement (gaugeMax).
      // gaugeEfficiency only affects gain rate, not the cap.
      let maxGauge = track.maxGaugeOverride;
      if (!maxGauge || maxGauge <= 0) {
        const ult = track.actions.find((a) => a.type === "ultimate");
        maxGauge = ult?.gaugeCost || 100;
      }

      return {
        id: track.id,
        stats: track.stats,
        resources: {
          hp: track.stats.hp,
          gauge: track.initialGauge,
          maxGauge,
        },
        cooldowns: new Map(),
        activeBuffs: new Map(),
      };
    });
}

export function normalizeScenario(scenario: ScenarioData) {
  const tracks = normalizeTracks(scenario.tracks);

  const actions: ActionNode[] = [];
  tracks.forEach((track, index) => {
    track.actions.forEach((action) => {
      actions.push({
        type: "action",
        id: action.instanceId,
        trackIndex: index,
        trackId: track.id || `track_${index}`,
        node: action,
      });
    });
  });

  return {
    tracks,
    actions,
    actors: processActors(tracks),
  };
}

const DEFAULT_SYSTEM_CONSTANTS: SystemConstants = {
  maxSp: SP_CAP,
  initialSp: 200,
  spRegenRate: SP_REGEN_RATE,
  skillSpCostDefault: DEFAULT_SKILL_SP_COST,
  linkCdReduction: 0,
  maxStagger: 100,
  staggerNodeCount: 0,
  staggerNodeDuration: 2,
  staggerBreakDuration: 10,
  executionRecovery: 25,
};

export interface CompileOptions {
  systemConstants?: Partial<SystemConstants>;
  /** Accepted for API symmetry with the old runSimulation path; not used by compile itself. */
  db?: GameDatabase;
}

export function compileScenario(
  scenario: ScenarioData,
  {
    systemConstants,
  }: CompileOptions = {}
): CompiledScenario {
  const { actions, actors } = normalizeScenario(scenario);

  const compiledTimeline = compileTimeline(actions, scenario.connections);

  const mergedSystemConstants = {
    ...DEFAULT_SYSTEM_CONSTANTS,
    ...systemConstants,
    ...scenario.systemConstants,
  };

  return {
    timeline: compiledTimeline,
    actors,
    teamConfig: {
      maxSp: mergedSystemConstants.maxSp,
      initialSp: mergedSystemConstants.initialSp,
      spRegenRate: mergedSystemConstants.spRegenRate,
      skillSpCostDefault: mergedSystemConstants.skillSpCostDefault,
      linkCdReduction: mergedSystemConstants.linkCdReduction,
    },
    enemyConfig: {
      maxStagger: mergedSystemConstants.maxStagger,
      staggerNodeCount: mergedSystemConstants.staggerNodeCount,
      staggerNodeDuration: mergedSystemConstants.staggerNodeDuration,
      staggerBreakDuration: mergedSystemConstants.staggerBreakDuration,
      executionRecovery: mergedSystemConstants.executionRecovery,
    },
    systemConstants: mergedSystemConstants,
    diagnostics: [],
  };
}
