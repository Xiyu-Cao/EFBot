export interface BaseGameState<Snapshot> {
  advanceTime(dt: number, currentTime: number): void;

  snapshot(): Snapshot;
}
