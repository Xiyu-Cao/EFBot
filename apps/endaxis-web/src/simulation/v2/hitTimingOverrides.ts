/**
 * Hit Timing Overrides (开发中, feature/hit-timing-override 分支)
 *
 * Lets users override hit timing data without editing the character source files.
 * Editable fields: hit.offset, skill.duration, skill.detach.
 * Effects, multipliers, IDs and structure remain locked — only timing.
 *
 * Storage: localStorage key endaxis_hit_timing_overrides (JSON).
 * Reactive: components consuming `overridesVersion` re-render on change;
 * `loadV2Module` (characters/adapter.ts) re-applies overrides when version bumps.
 */

import { ref } from "vue";
import type { Skill } from "./types";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/** Override for a single skill's timing. All fields optional. */
export interface SkillTimingOverride {
  /** Override skill total duration (seconds). */
  duration?: number;
  /** Override skill detach time (seconds, only meaningful for skills that have detach). */
  detach?: number;
  /** Override per-hit offset (seconds), keyed by hit index. */
  hitOffsets?: Record<number, number>;
}

/** All overrides for a single character: keyed by skill id. */
export type CharacterTimingOverrides = Record<string, SkillTimingOverride>;

/** Top-level: keyed by character id. */
export type AllTimingOverrides = Record<string, CharacterTimingOverrides>;

/** JSON wire format with version + payload. */
export interface OverridesFile {
  schemaVersion: 1;
  exportedAt: string;
  overrides: AllTimingOverrides;
}

// ═══════════════════════════════════════════════════════════════════
// Storage
// ═══════════════════════════════════════════════════════════════════

const STORAGE_KEY = "endaxis_hit_timing_overrides";

function readStorage(): AllTimingOverrides {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as AllTimingOverrides;
  } catch {
    return {};
  }
}

function writeStorage(data: AllTimingOverrides): void {
  if (typeof localStorage === "undefined") return;
  if (Object.keys(data).length === 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ═══════════════════════════════════════════════════════════════════
// Reactive state
// ═══════════════════════════════════════════════════════════════════

/** Current overrides loaded into memory. Mutate via the helpers below to keep version in sync. */
const _overrides = ref<AllTimingOverrides>(readStorage());

/** Bumps every time overrides change. Consumers (e.g. adapter cache) listen on this. */
export const overridesVersion = ref(0);

export function getAllOverrides(): AllTimingOverrides {
  return _overrides.value;
}

export function getOverridesForChar(charId: string): CharacterTimingOverrides | null {
  return _overrides.value[charId] ?? null;
}

export function getOverrideForSkill(
  charId: string,
  skillId: string,
): SkillTimingOverride | null {
  return _overrides.value[charId]?.[skillId] ?? null;
}

function commit(next: AllTimingOverrides): void {
  // Strip empties so JSON stays small.
  const cleaned: AllTimingOverrides = {};
  for (const [charId, charOv] of Object.entries(next)) {
    const cleanChar: CharacterTimingOverrides = {};
    for (const [skillId, skOv] of Object.entries(charOv)) {
      const cleanSk: SkillTimingOverride = {};
      if (typeof skOv.duration === "number") cleanSk.duration = skOv.duration;
      if (typeof skOv.detach === "number") cleanSk.detach = skOv.detach;
      if (skOv.hitOffsets && Object.keys(skOv.hitOffsets).length > 0) {
        cleanSk.hitOffsets = { ...skOv.hitOffsets };
      }
      if (
        cleanSk.duration !== undefined ||
        cleanSk.detach !== undefined ||
        cleanSk.hitOffsets !== undefined
      ) {
        cleanChar[skillId] = cleanSk;
      }
    }
    if (Object.keys(cleanChar).length > 0) cleaned[charId] = cleanChar;
  }
  _overrides.value = cleaned;
  writeStorage(cleaned);
  overridesVersion.value++;
}

/** Reject NaN, Infinity, -Infinity, negatives, and non-numeric junk. */
export function isValidTimingValue(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/** Practical upper bound — no skill in the game runs longer than 60 seconds.
 *  Catches typos like "60" entered as frames instead of seconds. */
const MAX_REASONABLE_SECONDS = 60;

export interface ValidationError {
  reason: string;
}

/** Validate a candidate timing value. Returns null on success, an error object on rejection. */
function validateTimingValue(v: unknown, label: string): ValidationError | null {
  if (typeof v !== "number") return { reason: `${label} 必须是数字` };
  if (Number.isNaN(v)) return { reason: `${label} 不能是 NaN` };
  if (!Number.isFinite(v)) return { reason: `${label} 不能是 Infinity` };
  if (v < 0) return { reason: `${label} 不能为负 (got ${v})` };
  if (v > MAX_REASONABLE_SECONDS) {
    return { reason: `${label} 大于 ${MAX_REASONABLE_SECONDS}s 不合理 (got ${v}) — 注意单位是秒不是帧` };
  }
  return null;
}

/**
 * Set/clear a hit offset override.
 * Returns null on success, an error message on rejection.
 * Pass `null` to clear the override (always succeeds).
 */
export function setHitOffsetOverride(
  charId: string,
  skillId: string,
  hitIndex: number,
  offsetSeconds: number | null,
): string | null {
  if (!Number.isInteger(hitIndex) || hitIndex < 0) {
    return `hitIndex 必须是非负整数 (got ${hitIndex})`;
  }
  if (offsetSeconds !== null) {
    const err = validateTimingValue(offsetSeconds, "hit offset");
    if (err) return err.reason;
  }
  const next: AllTimingOverrides = JSON.parse(JSON.stringify(_overrides.value));
  const charOv = (next[charId] ??= {});
  const skOv = (charOv[skillId] ??= {});
  const hitOffsets = (skOv.hitOffsets ??= {});
  if (offsetSeconds === null) {
    delete hitOffsets[hitIndex];
  } else {
    hitOffsets[hitIndex] = offsetSeconds;
  }
  commit(next);
  return null;
}

/** Set/clear a skill duration override. Returns null on success, error message on rejection. */
export function setSkillDurationOverride(
  charId: string,
  skillId: string,
  durationSeconds: number | null,
): string | null {
  if (durationSeconds !== null) {
    const err = validateTimingValue(durationSeconds, "duration");
    if (err) return err.reason;
  }
  const next: AllTimingOverrides = JSON.parse(JSON.stringify(_overrides.value));
  const charOv = (next[charId] ??= {});
  const skOv = (charOv[skillId] ??= {});
  if (durationSeconds === null) {
    delete skOv.duration;
  } else {
    skOv.duration = durationSeconds;
  }
  commit(next);
  return null;
}

/** Set/clear a skill detach override. Returns null on success, error message on rejection. */
export function setSkillDetachOverride(
  charId: string,
  skillId: string,
  detachSeconds: number | null,
): string | null {
  if (detachSeconds !== null) {
    const err = validateTimingValue(detachSeconds, "detach");
    if (err) return err.reason;
  }
  const next: AllTimingOverrides = JSON.parse(JSON.stringify(_overrides.value));
  const charOv = (next[charId] ??= {});
  const skOv = (charOv[skillId] ??= {});
  if (detachSeconds === null) {
    delete skOv.detach;
  } else {
    skOv.detach = detachSeconds;
  }
  commit(next);
}

export function clearOverridesForChar(charId: string): void {
  const next: AllTimingOverrides = JSON.parse(JSON.stringify(_overrides.value));
  delete next[charId];
  commit(next);
}

export function clearAllOverrides(): void {
  commit({});
}

// ═══════════════════════════════════════════════════════════════════
// Application
// ═══════════════════════════════════════════════════════════════════

/** Returns a deep-cloned skill with override timings applied (or the original if no override). */
export function applyOverrideToSkill(
  skill: Skill,
  ov: SkillTimingOverride | null | undefined,
): Skill {
  if (!ov) return skill;
  const out: Skill = {
    ...skill,
    hits: skill.hits.map((h, i) => {
      const o = ov.hitOffsets?.[i];
      return typeof o === "number" ? { ...h, offset: o } : h;
    }),
    checkpoints: skill.checkpoints.map(c => ({ ...c })),
  };
  if (typeof ov.duration === "number") out.duration = ov.duration;
  if (typeof ov.detach === "number") out.detach = ov.detach;
  return out;
}

/**
 * Returns a shallow-cloned module whose `skills` block has overrides applied.
 * Triggers, identity, talents etc. are kept by reference (immutable).
 */
export function applyOverridesToModule<T extends { skills: any }>(
  mod: T,
  charOverrides: CharacterTimingOverrides | null | undefined,
): T {
  if (!charOverrides || Object.keys(charOverrides).length === 0) return mod;
  const skills = mod.skills;
  const overrideById = (skill: Skill) =>
    applyOverrideToSkill(skill, charOverrides[skill.id]);

  const next: any = { ...skills };
  if (Array.isArray(skills.attack)) {
    next.attack = skills.attack.map(overrideById);
  }
  if (skills.skill) next.skill = overrideById(skills.skill);
  if (skills.link) {
    next.link = Array.isArray(skills.link)
      ? skills.link.map(overrideById)
      : overrideById(skills.link);
  }
  if (skills.ultimate) next.ultimate = overrideById(skills.ultimate);
  return { ...mod, skills: next };
}

// ═══════════════════════════════════════════════════════════════════
// Semantic warnings (soft — do not block save, only flag in the UI)
// ═══════════════════════════════════════════════════════════════════

/**
 * Inspect a skill against its (possibly partial) override and return any
 * semantic warnings — values that pass type validation but look suspicious:
 *   - hit offset > effective duration
 *   - hits out of chronological order
 *   - detach > effective duration
 *   - detach beyond the last hit (no hit gets protected)
 *
 * `effective` reflects the post-override values; `defaults` is the raw skill.
 */
export function getSkillTimingWarnings(
  skill: Skill,
  override: SkillTimingOverride | null | undefined,
): string[] {
  const warnings: string[] = [];
  const eff = applyOverrideToSkill(skill, override);
  const dur = eff.duration;
  // 1. hit offsets past duration
  eff.hits.forEach((h, i) => {
    if (h.offset > dur + 1e-6) {
      warnings.push(`Hit #${i} offset ${h.offset.toFixed(4)}s > duration ${dur.toFixed(4)}s`);
    }
  });
  // 2. out-of-order hits
  for (let i = 1; i < eff.hits.length; i++) {
    if (eff.hits[i].offset < eff.hits[i - 1].offset - 1e-6) {
      warnings.push(
        `Hit #${i} (${eff.hits[i].offset.toFixed(4)}s) 早于 Hit #${i - 1} (${eff.hits[i - 1].offset.toFixed(4)}s)`,
      );
    }
  }
  // 3 + 4. detach checks
  if (typeof eff.detach === "number") {
    if (eff.detach > dur + 1e-6) {
      warnings.push(`detach ${eff.detach.toFixed(4)}s > duration ${dur.toFixed(4)}s`);
    }
    if (eff.hits.length > 0) {
      const lastHit = eff.hits[eff.hits.length - 1].offset;
      if (eff.detach > lastHit + 1e-6) {
        warnings.push(`detach ${eff.detach.toFixed(4)}s > 最后一个 hit (${lastHit.toFixed(4)}s) — 没有 hit 受保护`);
      }
    }
  }
  return warnings;
}

// ═══════════════════════════════════════════════════════════════════
// JSON import/export
// ═══════════════════════════════════════════════════════════════════

export function exportOverridesJSON(): string {
  const file: OverridesFile = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    overrides: _overrides.value,
  };
  return JSON.stringify(file, null, 2);
}

export interface ImportResult {
  ok: boolean;
  errors: string[];
  applied?: AllTimingOverrides;
}

export function importOverridesJSON(text: string): ImportResult {
  const errors: string[] = [];
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch (e: any) {
    return { ok: false, errors: [`JSON 解析失败：${e?.message ?? e}`] };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, errors: ["顶层不是对象"] };
  }
  if (parsed.schemaVersion !== 1) {
    errors.push(`未知 schemaVersion: ${parsed.schemaVersion}（期望 1）`);
  }
  const ov = parsed.overrides;
  if (!ov || typeof ov !== "object") {
    return { ok: false, errors: [...errors, "缺少 overrides 字段"] };
  }
  const out: AllTimingOverrides = {};
  for (const [charId, charOv] of Object.entries(ov)) {
    if (!charOv || typeof charOv !== "object") {
      errors.push(`角色 ${charId} 不是对象，已跳过`);
      continue;
    }
    const cleanChar: CharacterTimingOverrides = {};
    for (const [skillId, skOv] of Object.entries(charOv as Record<string, any>)) {
      if (!skOv || typeof skOv !== "object") continue;
      const cleanSk: SkillTimingOverride = {};
      if (skOv.duration !== undefined) {
        if (isValidTimingValue(skOv.duration) && skOv.duration <= MAX_REASONABLE_SECONDS) {
          cleanSk.duration = skOv.duration;
        } else {
          errors.push(`${charId}/${skillId}.duration 非法 (${skOv.duration})，已忽略`);
        }
      }
      if (skOv.detach !== undefined) {
        if (isValidTimingValue(skOv.detach) && skOv.detach <= MAX_REASONABLE_SECONDS) {
          cleanSk.detach = skOv.detach;
        } else {
          errors.push(`${charId}/${skillId}.detach 非法 (${skOv.detach})，已忽略`);
        }
      }
      if (skOv.hitOffsets && typeof skOv.hitOffsets === "object") {
        const hs: Record<number, number> = {};
        for (const [k, v] of Object.entries(skOv.hitOffsets)) {
          const idx = Number(k);
          if (
            Number.isInteger(idx) &&
            idx >= 0 &&
            isValidTimingValue(v) &&
            (v as number) <= MAX_REASONABLE_SECONDS
          ) {
            hs[idx] = v as number;
          } else {
            errors.push(`${charId}/${skillId}.hitOffsets[${k}] 非法 (${v})，已忽略`);
          }
        }
        if (Object.keys(hs).length > 0) cleanSk.hitOffsets = hs;
      }
      if (Object.keys(cleanSk).length > 0) cleanChar[skillId] = cleanSk;
    }
    if (Object.keys(cleanChar).length > 0) out[charId] = cleanChar;
  }
  commit(out);
  return { ok: true, errors, applied: out };
}
