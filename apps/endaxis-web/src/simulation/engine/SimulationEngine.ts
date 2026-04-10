import type { ActorSnapshot, EnemyConfig, TeamConfig } from "../state/types.ts";
import { PriorityQueue } from "@/simulation/engine/PriorityQueue.ts";
import type { EventHandler } from "@/simulation/events/EventHandler.ts";
import { GameState } from "@/simulation/state/GameState.ts";
import type {
  SimEvent,
  SimEventType,
  SimLogEntry,
} from "@/simulation/events/event.types.ts";
import type {
  EventHookContext,
  SimulationContext,
} from "@/simulation/engine/SimulationContext.ts";
import type { ResolvedTimeline } from "../compiler/types.ts";
import { TriggerProcessor } from "./TriggerProcessor.ts";
import { DiagnosticCollector } from "../diagnostics.ts";
import type { Effect } from "../effects/types.ts";
import type { LegalityPolicy, LegalityIssue } from "../legality/types.ts";

type SimEventHook = (event: SimEvent, ctx: EventHookContext) => void;

export class SimulationEngine {
  private queue = new PriorityQueue<SimEvent>();
  private handlers = new Map<SimEventType, EventHandler<SimEvent>>();
  private listeners = new Set<SimEventHook>();
  private state: GameState;
  private simLog = new PriorityQueue<SimLogEntry>();
  private triggerProcessor: TriggerProcessor;
  readonly diagnostics: DiagnosticCollector;
  rng: () => number = Math.random;
  legalityPolicy: LegalityPolicy = "sandbox";
  critMode: "real" | "expected" = "real";
  private legalityIssues: LegalityIssue[] = [];
  /** Phase 2: deferred actions awaiting variant selection at ACTION_START */
  deferredActions?: Map<string, any>;
  /** Phase 2: enqueue effects + ticks for an action after variant selection */
  enqueueActionEffects?: (action: any) => void;

  constructor(
    private timeline: ResolvedTimeline,
    teamConfig: TeamConfig,
    enemyConfig: EnemyConfig,
    private actors: ActorSnapshot[],
    diagnostics?: DiagnosticCollector,
  ) {
    this.diagnostics = diagnostics ?? new DiagnosticCollector();
    this.state = new GameState(teamConfig, enemyConfig, this);
    this.triggerProcessor = new TriggerProcessor(this.diagnostics);

    this.actors.forEach((actor) => {
      this.state.setActor(actor);
    });
  }

  getState() { return this.state; }

  registerHandler<E extends SimEvent>(type: E["type"], handler: EventHandler<E>) {
    this.handlers.set(type, handler);
  }

  subscribe(listener: SimEventHook): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  enqueue(event: SimEvent) { this.queue.enqueue(event); }

  getAction(id: string) { return this.timeline.actionMap.get(id); }

  getSimLog(): SimLogEntry[] { return this.simLog.toArray(); }

  /** Public simLog emitter for setup-time code (outside event handlers) */
  emitLog(entry: SimLogEntry) { this.simLog.enqueue(entry); }

  getLegalityIssues(): readonly LegalityIssue[] { return this.legalityIssues; }

  getShiftedTime(startTime: number, duration: number) {
    return this.timeline.timeContext.getShiftedEndTime(startTime, duration);
  }

  registerPassiveEffect(actorId: string, effect: Effect) {
    const actor = this.state.getActor(actorId);
    actor.effects.add(effect);
  }

  // ── Constants ──

  private static readonly FRAME_EPSILON = 0.0001;
  private static readonly MAX_CASCADE_DEPTH = 500;

  // ── Nested recursive execution model ──

  /** Recursion depth counter for safety limit. */
  private cascadeDepth = 0;

  /**
   * Main simulation loop — nested recursive model.
   *
   * Each action/effect recursively splits into: 特效 → 伤害 → 后效
   *
   * For each event:
   *   1. Handler + immediate triggers execute
   *   2. Cascading same-frame events are recursively processed (depth-first)
   *   3. After cascade subtree completes → scoped deferred triggers fire
   *   4. Deferred cascade processed recursively
   *
   * Deferred triggers fire after the event's entire cascade subtree completes,
   * giving the nested "特效 → 伤害 → 后效" lifecycle per sub-action.
   */
  run() {
    const ctx = this.createContext();

    while (!this.queue.isEmpty()) {
      const frameTime = this.queue.peek()!.time;

      if (frameTime > this.state.getCurrentTime()) {
        this.state.advanceTime(frameTime - this.state.getCurrentTime());
      }

      // Collect all initially queued events at this frame time
      const pending: SimEvent[] = [];
      while (
        !this.queue.isEmpty() &&
        this.queue.peek()!.time <= frameTime + SimulationEngine.FRAME_EPSILON
      ) {
        pending.push(this.queue.dequeue()!);
      }

      // Frame snapshot: capture enemy state BEFORE effects process
      this.captureFrameSnapshot(ctx, frameTime);

      // Process each top-level event with recursive cascade
      for (const event of pending) {
        this.processEventWithCascade(event, ctx, frameTime);
      }
    }

    return this.state;
  }

  /**
   * Process a single event and recursively process all cascading events
   * it produces. Deferred triggers fire after the entire cascade subtree completes.
   */
  private processEventWithCascade(
    event: SimEvent,
    ctx: SimulationContext,
    frameTime: number,
  ): void {
    if (++this.cascadeDepth > SimulationEngine.MAX_CASCADE_DEPTH) {
      ctx.diagnostics.warn(
        `Cascade depth exceeded ${SimulationEngine.MAX_CASCADE_DEPTH} at t=${frameTime.toFixed(3)} — possible infinite loop.`,
      );
      this.cascadeDepth--;
      return;
    }

    // Push deferred scope for this event's subtree
    this.triggerProcessor.pushDeferredScope();

    // Run handler + immediate triggers
    this.processSingleEvent(event, ctx);

    // Recursively process cascading same-frame events
    this.drainAndProcessCascade(ctx, frameTime);

    // Pop scope: execute deferred triggers for this subtree
    const hadDeferred = this.triggerProcessor.popAndFlushDeferred();

    // Deferred actions may have enqueued new events → cascade those too
    if (hadDeferred) {
      this.drainAndProcessCascade(ctx, frameTime);
    }

    this.cascadeDepth--;
  }

  /** Drain same-frame events from queue and process each recursively. */
  private drainAndProcessCascade(ctx: SimulationContext, frameTime: number): void {
    while (
      !this.queue.isEmpty() &&
      this.queue.peek()!.time <= frameTime + SimulationEngine.FRAME_EPSILON
    ) {
      const cascading = this.queue.dequeue()!;
      this.processEventWithCascade(cascading, ctx, frameTime);
    }
  }

  /** Process a single event: handler → TriggerProcessor. */
  private processSingleEvent(event: SimEvent, ctx: SimulationContext): void {
    const handler = this.handlers.get(event.type);

    if (handler) {
      try {
        handler.handle(event, ctx);
      } catch (err) {
        ctx.diagnostics.warn(
          `Event handler error at t=${event.time.toFixed(3)} type=${event.type}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    try {
      this.triggerProcessor.process(event, ctx);
    } catch (err) {
      ctx.diagnostics.warn(
        `Trigger error at t=${event.time.toFixed(3)}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ── Helpers ──

  private createContext(): SimulationContext {
    return {
      state: this.state,
      queue: { enqueue: this.enqueue.bind(this) },
      simLog: (entry: SimLogEntry) => { this.simLog.enqueue(entry); },
      getAction: this.getAction.bind(this),
      diagnostics: this.diagnostics,
      rng: this.rng,
      legalityPolicy: this.legalityPolicy,
      legalityIssues: this.legalityIssues,
      blockedActionIds: new Set(),
      critMode: this.critMode,
      frameSnapshot: {
        magicElement: null, magicStacks: 0, breakStacks: 0,
        hasBreak: false, isFrozen: false, hasBurn: false,
        hasConduction: false, hasCorrosion: false,
      },
      deferredActions: this.deferredActions,
      enqueueActionEffects: this.enqueueActionEffects,
    };
  }

  private captureFrameSnapshot(ctx: SimulationContext, frameTime: number): void {
    const status = this.state.enemy.status;
    ctx.frameSnapshot = {
      magicElement: status.getMagicElement(),
      magicStacks: status.getMagicStacks(),
      breakStacks: status.getBreakStacks(),
      hasBreak: status.hasBreak(),
      isFrozen: status.isFrozen(frameTime),
      hasBurn: status.burn !== null,
      hasConduction: status.conduction !== null,
      hasCorrosion: status.corrosion !== null,
    };
  }

  // ── Legacy model (disabled backup) ──

  /** @deprecated Old flat frame model. Use run() instead. */
  runLegacy() {
    const ctx = this.createContext();
    while (!this.queue.isEmpty()) {
      const frameTime = this.queue.peek()!.time;
      if (frameTime > this.state.getCurrentTime()) {
        this.state.advanceTime(frameTime - this.state.getCurrentTime());
      }
      const pending: SimEvent[] = [];
      while (!this.queue.isEmpty() && this.queue.peek()!.time <= frameTime + SimulationEngine.FRAME_EPSILON) {
        pending.push(this.queue.dequeue()!);
      }
      this.captureFrameSnapshot(ctx, frameTime);
      let iterations = 0;
      while (pending.length > 0) {
        if (++iterations > SimulationEngine.MAX_CASCADE_DEPTH) break;
        const event = pending.shift()!;
        this.processSingleEvent(event, ctx);
        const cascading: SimEvent[] = [];
        while (!this.queue.isEmpty() && this.queue.peek()!.time <= frameTime + SimulationEngine.FRAME_EPSILON) {
          cascading.push(this.queue.dequeue()!);
        }
        if (cascading.length > 0) pending.unshift(...cascading);
      }
    }
    return this.state;
  }
}
