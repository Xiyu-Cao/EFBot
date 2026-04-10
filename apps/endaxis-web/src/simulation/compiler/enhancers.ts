/**
 * Ultimate enhancement time extenders.
 *
 * These functions compute additional duration that an ultimate's
 * "enhancement window" gains because of skill/link actions that
 * overlap with it on the same track.
 *
 * Moved here from timelineStore.js so the compiler layer can run headless.
 */

export interface EnhancerInput {
  track: { actions?: any[] };
  enhStart: number;
  baseDuration: number;
  ultimateAction: { instanceId: string };
  getShiftedEndTime: (start: number, duration: number, excludeId?: string) => number;
}

export type EnhancerFn = (input: EnhancerInput) => number;

export function createOwnSkillLinkEnhancer(
  { linkSubtract = 0.0 } = {},
): EnhancerFn {
  return ({ track, enhStart, baseDuration, ultimateAction, getShiftedEndTime }) => {
    const epsilon = 0.0001;
    const processed = new Set<string>();
    let extraDuration = 0;

    let guard = 0;
    while (guard++ < 200) {
      const currentEnd = getShiftedEndTime(
        enhStart,
        baseDuration + extraDuration,
        ultimateAction.instanceId,
      );

      let foundAny = false;
      for (const a of track?.actions || []) {
        if (!a || a.isDisabled || (a.triggerWindow || 0) < 0) continue;
        if (a.type !== "skill" && a.type !== "link") continue;
        if (processed.has(a.instanceId)) continue;

        const t = Number(a.startTime) || 0;
        if (t + epsilon < enhStart) continue;
        if (t >= currentEnd - epsilon) continue;

        let delta = Number(a.duration) || 0;
        if (a.type === "link") {
          delta = Math.max(0, delta - linkSubtract);
        }
        processed.add(a.instanceId);

        if (delta <= 0) continue;
        extraDuration += delta;
        foundAny = true;
      }

      if (!foundAny) break;
    }

    return extraDuration;
  };
}

/**
 * Registry of character-specific ultimate enhancement extenders.
 *
 * Key = character id (matches track.id).
 * Value = function that computes extra enhancement duration.
 *
 * TODO: In the future this should be data-driven (loaded from gamedata or
 * a character-ability registry) rather than a hard-coded map.
 */
export const ULTIMATE_ENHANCEMENT_EXTENDERS: Record<string, EnhancerFn> = {
  LAEVATAIN: createOwnSkillLinkEnhancer({ linkSubtract: 0.5 }),
};
