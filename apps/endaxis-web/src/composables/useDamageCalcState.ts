/**
 * Damage Calculation Page — State Composable
 *
 * Manages simulation, projections, and selection state for the damage calc page.
 * Reads from timelineStore (tracks, equipment, enemy config) and runs its own
 * V2 kernel simulation. Does NOT modify the store's simulation state.
 *
 * Equipment changes in the detail panel call store methods (updateTrackWeapon, etc.),
 * which mutate store.tracks. This composable watches those changes and re-runs
 * the simulation automatically.
 */

import { ref, computed, shallowRef, watch, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useTimelineStore } from "@/stores/timelineStore.js";
import { buildV2Inputs } from "@/simulation/v2/storeAdapter";
import { simulate, extractInterruptedHeavies, extractStaggerWindows } from "@/simulation/v2/kernel";
import type { SimulationResult, SimEvent } from "@/simulation/v2/types";
import {
  projectBuffBars,
  projectStackBuffBars,
  projectAnomalyBars,
  projectAttachmentBars,
  projectBreakBars,
  projectHitEffects,
  projectActionBars,
  projectStaggerSeries,
} from "@/simulation/v2/projections";
import {
  projectHitDamageDetails,
  projectFullDamageSummary,
  extractBuffDetail,
} from "@/simulation/v2/damageCalcProjections";
import type {
  HitDamageDetail,
  FullDamageSummary,
  TrackMeta,
  BuffDetail,
} from "@/simulation/v2/damageCalcProjections";
import { adaptAllProjections } from "@/simulation/v2/v2ProjectionAdapter";

// ═══════════════════════════════════════════════════════════════════
// Selection types
// ═══════════════════════════════════════════════════════════════════

export type SelectedItem =
  | { type: "character"; trackId: string }
  | { type: "action"; actionId: string; actorId: string }
  | { type: "buff"; buffId: string; startTime: number }
  | null;

// ═══════════════════════════════════════════════════════════════════
// Composable
// ═══════════════════════════════════════════════════════════════════

export function useDamageCalcState() {
  const store = useTimelineStore();
  const router = useRouter();

  // ── Selection state ──
  const selectedItem = ref<SelectedItem>(null);

  // ── Per-hit selection (for the settlement detail view) ──
  const selectedHitKey = ref<{ actionId: string; hitIndex: number } | null>(null);
  // ── Whether the hit-settlement overlay is visible over the left panel ──
  const settlementOverlayVisible = ref(false);

  // ── Crit mode (can be toggled independently from store) ──
  const critMode = ref<"real" | "expected">("expected");

  // ── Per-damage prob-event locks (page-scoped, not persisted) ──
  // Key format: `crit:<actionId>:<hitIndex>:<damageIdx>` (assigned by kernel).
  // "yes" = force crit, "no" = force no-crit. Missing entries fall back to mode.
  const probLocks = ref<Map<string, "yes" | "no">>(new Map());

  function getProbLock(key: string | undefined): "yes" | "no" | null {
    if (!key) return null;
    return probLocks.value.get(key) ?? null;
  }

  /** Cycle a lock through: null → "yes" → "no" → null. */
  function cycleProbLock(key: string) {
    const cur = probLocks.value.get(key);
    const next = new Map(probLocks.value);
    if (cur === undefined) next.set(key, "yes");
    else if (cur === "yes") next.set(key, "no");
    else next.delete(key);
    probLocks.value = next;
    runSimulation();
  }

  function clearAllProbLocks() {
    if (probLocks.value.size === 0) return;
    probLocks.value = new Map();
    runSimulation();
  }

  const probLockCount = computed(() => probLocks.value.size);

  // ── Per-track buff-lane expand state ──
  const BUFF_VIS_KEY = "endaxis_dmg_calc_buff_visible_tracks";
  const buffExpandedByTrack = ref<Record<string, boolean>>((() => {
    try {
      const raw = localStorage.getItem(BUFF_VIS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  })());

  function isBuffExpanded(trackId: string): boolean {
    // Default: expanded
    return buffExpandedByTrack.value[trackId] !== false;
  }

  function toggleBuffExpanded(trackId: string) {
    const current = isBuffExpanded(trackId);
    buffExpandedByTrack.value = {
      ...buffExpandedByTrack.value,
      [trackId]: !current,
    };
    try {
      localStorage.setItem(BUFF_VIS_KEY, JSON.stringify(buffExpandedByTrack.value));
    } catch { /* ignore quota */ }
  }

  // ── Simulation result ──
  const simResult = shallowRef<SimulationResult | null>(null);
  const simError = ref<string | null>(null);

  // ── Simulation trigger key — changes whenever we need to re-run ──
  // We track a version counter that increments on relevant store changes
  const simVersion = ref(0);

  /**
   * Run V2 kernel simulation from current store state.
   *
   * Mirrors the 2-pass pipeline used by `timelineStore.validateTimeline`:
   *   Pass 1 — discovers stagger windows + heavy-attacks interrupted before
   *            their first hit (combo resolution input for Pass 2).
   *   Pass 2 — re-simulated with `executionSkillByActor` + precomputed
   *            `staggerWindows` so that auto-execution on staggered enemies
   *            and trigger timing match the 自由排轴 validator exactly.
   *
   * Single-pass was previously used here for performance but diverged on
   * triggers that depend on stagger state (e.g. 骏卫 铁誓 consumption fires
   * 袭扰/决胜 only on the second hit's 碎甲 — pass 1's state diverges).
   */
  function runSimulation() {
    simError.value = null;
    try {
      const cachedPanels = store.v2Panels || undefined;
      let inputs = buildV2Inputs(
        store.tracks,
        store.characterRoster,
        store.weaponDatabase,
        store.systemConstants,
        store.resolveTrackConfiguredStats,
        store.getTrackGaugeMax,
        store.getActiveSetBonusCategories,
        undefined,
        cachedPanels,
      );
      if (!inputs) {
        simError.value = "角色数据不完整或包含未支持的角色";
        simResult.value = null;
        return;
      }

      // Pass 1: discover stagger windows + interrupted heavies.
      const pass1 = simulate(
        inputs.builds,
        inputs.skills,
        inputs.enemyConfig,
        { ...inputs.config, critMode: critMode.value, validateConditions: false, probLocks: probLocks.value },
        inputs.triggersByActor,
      );
      const pendingHeavyInfo = extractInterruptedHeavies(pass1.events, inputs.skills);
      if (pendingHeavyInfo.size > 0) {
        const rebuilt = buildV2Inputs(
          store.tracks,
          store.characterRoster,
          store.weaponDatabase,
          store.systemConstants,
          store.resolveTrackConfiguredStats,
          store.getTrackGaugeMax,
          store.getActiveSetBonusCategories,
          pendingHeavyInfo,
          cachedPanels,
        );
        if (rebuilt) inputs = rebuilt;
      }
      const staggerWindows = extractStaggerWindows(
        pass1.events,
        inputs.enemyConfig.staggerBreakDuration,
      );

      // Pass 2: authoritative run — includes execution replacement and
      // primed stagger windows so trigger firing matches the validator.
      const result = simulate(
        inputs.builds,
        inputs.skills,
        inputs.enemyConfig,
        { ...inputs.config, critMode: critMode.value, validateConditions: false, probLocks: probLocks.value },
        inputs.triggersByActor,
        inputs.executionSkillByActor,
        staggerWindows,
      );
      simResult.value = result;
    } catch (e: any) {
      simError.value = e.message || "模拟运行出错";
      simResult.value = null;
    }
  }

  // ── Track metadata for projections ──
  const tracksMeta = computed<TrackMeta[]>(() => {
    return store.tracks
      .filter((t: any) => t.id)
      .map((t: any) => {
        const charInfo = store.characterRoster?.find((c: any) => c.id === t.id);
        return {
          id: t.id,
          name: charInfo?.name || t.id,
          element: charInfo?.element || "physical",
          actions: (t.actions || []).map((a: any) => ({
            instanceId: a.instanceId,
            name: a.name || a.id || "unknown",
            type: a.type || "attack",
            element: a.element,
            startTime: a.startTime,
            duration: a.duration,
          })),
        };
      });
  });

  // ── End time ──
  const endTime = computed(() => store.viewDuration || 120);

  // ── Events shortcut ──
  const events = computed<SimEvent[]>(() => simResult.value?.events || []);

  // ── Projections (all computed, auto-update when simResult changes) ──

  const fullDamageSummary = computed<FullDamageSummary | null>(() => {
    if (!events.value.length) return null;
    return projectFullDamageSummary(events.value, tracksMeta.value);
  });

  const hitDetails = computed<Map<string, HitDamageDetail[]>>(() => {
    return projectHitDamageDetails(events.value);
  });

  const buffBars = computed(() => {
    if (!events.value.length) return [];
    return projectBuffBars(events.value, endTime.value);
  });

  const stackBuffBars = computed(() => {
    if (!events.value.length) return [];
    return projectStackBuffBars(events.value, endTime.value);
  });

  const anomalyBars = computed(() => {
    if (!events.value.length) return [];
    return projectAnomalyBars(events.value, endTime.value);
  });

  const attachmentBars = computed(() => {
    if (!events.value.length) return [];
    return projectAttachmentBars(events.value, endTime.value);
  });

  const breakBars = computed(() => {
    if (!events.value.length) return [];
    return projectBreakBars(events.value, endTime.value);
  });

  const hitEffects = computed(() => {
    return projectHitEffects(events.value);
  });

  const actionBars = computed(() => {
    return projectActionBars(events.value);
  });

  const staggerSeries = computed(() => {
    if (!events.value.length) return [];
    const maxStagger = store.systemConstants?.maxStagger || 1000;
    return projectStaggerSeries(events.value, maxStagger, endTime.value);
  });

  // Adapted buff data for UI display
  const adaptedProjections = computed(() => {
    if (!events.value.length) return null;
    const equipmentIconResolver = (setId: string) => {
      const piece = store.equipmentDatabase?.find(
        (e: { category?: string; icon?: string }) => e.category === setId && !!e.icon,
      );
      return piece?.icon || "";
    };
    return adaptAllProjections(
      buffBars.value,
      stackBuffBars.value,
      anomalyBars.value,
      attachmentBars.value,
      breakBars.value,
      equipmentIconResolver,
    );
  });

  // ── Buff detail lookup ──
  function getBuffDetail(buffId: string, startTime: number): BuffDetail | null {
    return extractBuffDetail(events.value, buffId, startTime);
  }

  // ── Selection helpers ──
  function selectCharacter(trackId: string) {
    selectedItem.value = { type: "character", trackId };
    selectedHitKey.value = null;
    settlementOverlayVisible.value = false;
  }

  function selectAction(actionId: string, actorId: string) {
    // Switching to a different action drops any hit selection tied to the
    // previous action; re-selecting the same action keeps the hit selection.
    if (selectedItem.value?.type !== "action" || selectedItem.value.actionId !== actionId) {
      selectedHitKey.value = null;
      settlementOverlayVisible.value = false;
    }
    selectedItem.value = { type: "action", actionId, actorId };
  }

  function selectBuff(buffId: string, startTime: number) {
    selectedItem.value = { type: "buff", buffId, startTime };
    selectedHitKey.value = null;
    settlementOverlayVisible.value = false;
  }

  function clearSelection() {
    selectedItem.value = null;
    selectedHitKey.value = null;
    settlementOverlayVisible.value = false;
  }

  function selectHit(actionId: string, hitIndex: number) {
    selectedHitKey.value = { actionId, hitIndex };
  }

  function clearHitSelection() {
    selectedHitKey.value = null;
    settlementOverlayVisible.value = false;
  }

  function toggleSettlementOverlay() {
    if (!selectedHitKey.value) return;
    settlementOverlayVisible.value = !settlementOverlayVisible.value;
  }

  function closeSettlementOverlay() {
    settlementOverlayVisible.value = false;
  }

  // ── Crit mode toggle ──
  function toggleCritMode() {
    critMode.value = critMode.value === "expected" ? "real" : "expected";
    runSimulation();
  }

  // ── Watch for track changes (equipment, stats, etc.) and re-simulate ──
  watch(
    () => {
      // Deep-watch relevant track properties by reading them
      return store.tracks.map((t: any) => ({
        id: t.id,
        weaponId: t.weaponId,
        equipArmorId: t.equipArmorId,
        equipGlovesId: t.equipGlovesId,
        equipAccessory1Id: t.equipAccessory1Id,
        equipAccessory2Id: t.equipAccessory2Id,
        stats: t.stats ? JSON.stringify(t.stats) : "",
        growth: t.growth ? JSON.stringify(t.growth) : "",
        actionCount: t.actions?.length || 0,
      }));
    },
    () => {
      simVersion.value++;
      runSimulation();
    },
    { deep: true },
  );

  // ── Navigation ──
  function goBack() {
    router.push("/timeline");
  }

  // ── Mount: run initial simulation, redirect if invalid ──
  onMounted(() => {
    runSimulation();
    if (!simResult.value) {
      // Stay on page but show error — don't redirect automatically
      // User can go back manually
    }
  });

  return {
    // State
    selectedItem,
    selectedHitKey,
    settlementOverlayVisible,
    critMode,
    probLocks,
    probLockCount,
    simResult,
    simError,
    endTime,

    // Projections
    fullDamageSummary,
    hitDetails,
    buffBars,
    stackBuffBars,
    anomalyBars,
    attachmentBars,
    breakBars,
    hitEffects,
    actionBars,
    staggerSeries,
    adaptedProjections,
    tracksMeta,

    // Buff expand state
    isBuffExpanded,
    toggleBuffExpanded,

    // Actions
    runSimulation,
    selectCharacter,
    selectAction,
    selectBuff,
    clearSelection,
    selectHit,
    clearHitSelection,
    toggleSettlementOverlay,
    closeSettlementOverlay,
    toggleCritMode,
    getProbLock,
    cycleProbLock,
    clearAllProbLocks,
    getBuffDetail,
    goBack,
  };
}
