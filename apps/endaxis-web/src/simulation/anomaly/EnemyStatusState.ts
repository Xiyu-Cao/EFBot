/**
 * EnemyStatusState — manages magic attachment, physical break, and anomaly
 * debuffs on a single enemy target.
 *
 * This class is the authoritative source of truth for attachment / anomaly
 * state. Resolvers read and mutate it, then return outcomes.
 *
 * Composed into EnemyState (not a replacement for it).
 */

import {
  type MagicAttachment,
  type PhysicalBreak,
  type BurnState,
  type FreezeState,
  type ConductionState,
  type CorrosionState,
  type MagicElement,
  type AnomalyLevel,
  type AnomalyDebuffType,
  MAGIC_ATTACHMENT_DURATION,
  MAGIC_ATTACHMENT_MAX_STACKS,
  PHYSICAL_BREAK_DURATION,
  PHYSICAL_BREAK_MAX_STACKS,
  BURN_DURATION,
  FREEZE_DURATION_BY_LEVEL,
  CONDUCTION_DURATION_BY_LEVEL,
  CORROSION_DURATION,
} from "./types";

function clampLevel(n: number): AnomalyLevel {
  return Math.max(1, Math.min(4, Math.floor(n))) as AnomalyLevel;
}

export class EnemyStatusState {
  magicAttachment: MagicAttachment | null = null;
  physicalBreak: PhysicalBreak | null = null;

  burn: BurnState | null = null;
  freeze: FreezeState | null = null;
  conduction: ConductionState | null = null;
  corrosion: CorrosionState | null = null;

  // -- Magic attachment --

  hasMagicAttachment(): boolean {
    return this.magicAttachment !== null;
  }

  getMagicElement(): MagicElement | null {
    return this.magicAttachment?.element ?? null;
  }

  getMagicStacks(): number {
    return this.magicAttachment?.stacks ?? 0;
  }

  applyMagicAttachment(element: MagicElement, time: number): void {
    if (!this.magicAttachment || this.magicAttachment.element !== element) {
      this.magicAttachment = {
        element,
        stacks: 1,
        expiresAt: time + MAGIC_ATTACHMENT_DURATION,
      };
    } else {
      this.magicAttachment.stacks = Math.min(
        MAGIC_ATTACHMENT_MAX_STACKS,
        this.magicAttachment.stacks + 1,
      );
      this.magicAttachment.expiresAt = time + MAGIC_ATTACHMENT_DURATION;
    }
  }

  clearMagicAttachment(): void {
    this.magicAttachment = null;
  }

  // -- Physical break --

  hasBreak(): boolean {
    return this.physicalBreak !== null && this.physicalBreak.stacks > 0;
  }

  getBreakStacks(): number {
    return this.physicalBreak?.stacks ?? 0;
  }

  addBreakStack(time: number): void {
    if (!this.physicalBreak) {
      this.physicalBreak = { stacks: 1, expiresAt: time + PHYSICAL_BREAK_DURATION };
    } else {
      this.physicalBreak.stacks = Math.min(
        PHYSICAL_BREAK_MAX_STACKS,
        this.physicalBreak.stacks + 1,
      );
      this.physicalBreak.expiresAt = time + PHYSICAL_BREAK_DURATION;
    }
  }

  clearBreak(): void {
    this.physicalBreak = null;
  }

  // -- Burn --

  applyBurn(level: AnomalyLevel, sourceActorId: string, time: number, durationOverride?: number): void {
    // Always overwrite (low level can overwrite high)
    this.burn = {
      level,
      expiresAt: time + (durationOverride ?? BURN_DURATION),
      lastTickTime: time,
      sourceActorId,
    };
  }

  clearBurn(): void {
    this.burn = null;
  }

  /**
   * Advance burn ticks. Returns the number of ticks that should fire.
   */
  advanceBurn(currentTime: number): number {
    if (!this.burn) return 0;
    if (currentTime >= this.burn.expiresAt) {
      const remaining = Math.max(0,
        Math.floor((this.burn.expiresAt - this.burn.lastTickTime) / 1),
      );
      this.burn = null;
      return remaining;
    }
    const elapsed = currentTime - this.burn.lastTickTime;
    const ticks = Math.floor(elapsed);
    if (ticks > 0) {
      this.burn.lastTickTime += ticks;
    }
    return ticks;
  }

  // -- Freeze --

  applyFreeze(level: AnomalyLevel, sourceActorId: string, time: number, durationOverride?: number): void {
    const duration = durationOverride ?? FREEZE_DURATION_BY_LEVEL[level];
    this.freeze = {
      level,
      expiresAt: time + duration,
      shattered: false,
      sourceActorId,
    };
  }

  isFrozen(time: number): boolean {
    return this.freeze !== null && time < this.freeze.expiresAt && !this.freeze.shattered;
  }

  /**
   * Attempt ice shatter. Returns true if shatter occurred.
   */
  tryShatter(time: number): boolean {
    if (!this.freeze || this.freeze.shattered || time >= this.freeze.expiresAt) {
      return false;
    }
    this.freeze.shattered = true;
    return true;
  }

  clearFreeze(): void {
    this.freeze = null;
  }

  // -- Conduction --

  applyConduction(level: AnomalyLevel, sourceActorId: string, time: number, durationOverride?: number): void {
    const duration = durationOverride ?? CONDUCTION_DURATION_BY_LEVEL[level];
    // Always overwrite
    this.conduction = {
      level,
      expiresAt: time + duration,
      sourceActorId,
    };
  }

  clearConduction(): void {
    this.conduction = null;
  }

  // -- Corrosion --

  /**
   * Corrosion resist-down parameters by level.
   * TODO: These are placeholder values — replace with real game data.
   */
  private static CORROSION_PARAMS: Record<AnomalyLevel, { perSecond: number; max: number }> = {
    1: { perSecond: 1.5, max: 15 },
    2: { perSecond: 2.0, max: 20 },
    3: { perSecond: 2.5, max: 25 },
    4: { perSecond: 3.0, max: 30 },
  };

  applyCorrosion(level: AnomalyLevel, sourceActorId: string, time: number, durationOverride?: number): void {
    const params = EnemyStatusState.CORROSION_PARAMS[level];
    const dur = durationOverride ?? CORROSION_DURATION;

    if (!this.corrosion) {
      this.corrosion = {
        level,
        expiresAt: time + dur,
        currentResistDown: 0,
        perSecondDelta: params.perSecond,
        maxResistDown: params.max,
        sourceActorId,
      };
    } else {
      // Refresh timer + update params, but don't reduce currentResistDown
      this.corrosion.expiresAt = time + dur;
      this.corrosion.level = level;
      this.corrosion.perSecondDelta = params.perSecond;
      this.corrosion.sourceActorId = sourceActorId;
      // Only increase maxResistDown, never decrease currentResistDown
      if (params.max > this.corrosion.maxResistDown) {
        this.corrosion.maxResistDown = params.max;
      }
      // If current is already above new max, keep current
    }
  }

  /**
   * Advance corrosion resist-down. Called by time advancement.
   */
  advanceCorrosion(dt: number, currentTime: number): void {
    if (!this.corrosion) return;
    if (currentTime >= this.corrosion.expiresAt) {
      this.corrosion = null;
      return;
    }
    this.corrosion.currentResistDown = Math.min(
      this.corrosion.maxResistDown,
      this.corrosion.currentResistDown + this.corrosion.perSecondDelta * dt,
    );
  }

  getCorrosionResistDown(): number {
    return this.corrosion?.currentResistDown ?? 0;
  }

  clearCorrosion(): void {
    this.corrosion = null;
  }

  // -- Time advancement --

  advanceTime(dt: number, currentTime: number): void {
    // Expire attachment
    if (this.magicAttachment && currentTime >= this.magicAttachment.expiresAt) {
      this.magicAttachment = null;
    }
    // Expire break
    if (this.physicalBreak && currentTime >= this.physicalBreak.expiresAt) {
      this.physicalBreak = null;
    }
    // Expire freeze
    if (this.freeze && currentTime >= this.freeze.expiresAt) {
      this.freeze = null;
    }
    // Expire conduction
    if (this.conduction && currentTime >= this.conduction.expiresAt) {
      this.conduction = null;
    }
    // Advance corrosion (may expire)
    this.advanceCorrosion(dt, currentTime);
    // Burn expiry handled in advanceBurn() by the handler
  }

  // -- Snapshot --

  snapshot(): EnemyStatusSnapshot {
    return {
      magicAttachment: this.magicAttachment ? { ...this.magicAttachment } : null,
      physicalBreak: this.physicalBreak ? { ...this.physicalBreak } : null,
      burn: this.burn ? { ...this.burn } : null,
      freeze: this.freeze ? { ...this.freeze } : null,
      conduction: this.conduction ? { ...this.conduction } : null,
      corrosion: this.corrosion ? { ...this.corrosion } : null,
    };
  }
}

export interface EnemyStatusSnapshot {
  magicAttachment: MagicAttachment | null;
  physicalBreak: PhysicalBreak | null;
  burn: BurnState | null;
  freeze: FreezeState | null;
  conduction: ConductionState | null;
  corrosion: CorrosionState | null;
}
