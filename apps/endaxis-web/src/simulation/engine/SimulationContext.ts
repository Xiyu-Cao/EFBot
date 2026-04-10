import { GameState } from "@/simulation/state/GameState.ts";
import type { SimEvent, SimLogEntry } from "@/simulation/events/event.types.ts";
import type { GameSnapshot } from "@/simulation/state/types.ts";
import type { ResolvedAction } from "../compiler/types";
import type { DiagnosticCollector } from "../diagnostics";
import type { LegalityPolicy, LegalityIssue } from "../legality/types";

/**
 * Snapshot of enemy state captured at the START of a frame, before any effects process.
 * Used by consumption-based handlers (LASTRITE, YVONNE, etc.) to read multiplier-affecting
 * state that may be modified by pre-damage effects within the same frame.
 *
 * Example: LASTRITE link Hit 2 reads cold attachment stacks for its multiplier.
 * If cold_attach at the same time triggers a freeze reaction (clearing attachment),
 * the handler should use the snapshot value, not the post-reaction value.
 */
export interface FrameSnapshot {
  magicElement: string | null;
  magicStacks: number;
  breakStacks: number;
  hasBreak: boolean;
  isFrozen: boolean;
  hasBurn: boolean;
  hasConduction: boolean;
  hasCorrosion: boolean;
}

export interface SimulationContext {
  state: GameState;
  queue: {
    enqueue: (event: SimEvent) => void;
  };
  simLog: (entry: SimLogEntry) => void;
  getAction: (id: string) => ResolvedAction | undefined;
  diagnostics: DiagnosticCollector;
  /** Seeded/deterministic RNG for crit rolls. Default: Math.random. */
  rng: () => number;
  /** Legality validation policy. Default: "sandbox". */
  legalityPolicy: LegalityPolicy;
  /** Collected legality issues from the run. */
  legalityIssues: LegalityIssue[];
  /** Action IDs blocked by strict legality — subsequent events for these should be skipped. */
  blockedActionIds: Set<string>;
  /** Crit calculation mode: "real" (roll each hit) or "expected" (probability-weighted). Default: "real". */
  critMode: "real" | "expected";
  /**
   * Enemy state snapshot taken at the START of each frame, before any effects process.
   * Consumption handlers should read multiplier-affecting state from here, not from
   * ctx.state.enemy.status (which may have been modified by pre-damage effects).
   */
  frameSnapshot: FrameSnapshot;
  /** Deferred actions awaiting variant selection at ACTION_START (Phase 2) */
  deferredActions?: Map<string, any>;
  /** Enqueue effects + damage ticks for an action (Phase 2: called after variant selection) */
  enqueueActionEffects?: (action: any) => void;
}

export interface EventHookContext extends SimulationContext {
  beforeSnapshot: GameSnapshot;
  afterSnapshot: GameSnapshot;
}
