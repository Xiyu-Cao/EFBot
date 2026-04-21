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
import { simulate } from "@/simulation/v2/kernel";
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

  // ── Crit mode (can be toggled independently from store) ──
  const critMode = ref<"real" | "expected">("expected");

  // ── Simulation result ──
  const simResult = shallowRef<SimulationResult | null>(null);
  const simError = ref<string | null>(null);

  // ── Simulation trigger key — changes whenever we need to re-run ──
  // We track a version counter that increments on relevant store changes
  const simVersion = ref(0);

  /**
   * Run V2 kernel simulation from current store state.
   * Called on mount and whenever equipment/tracks change.
   */
  function runSimulation() {
    simError.value = null;
    try {
      const inputs = buildV2Inputs(
        store.tracks,
        store.characterRoster,
        store.weaponDatabase,
        store.systemConstants,
        store.resolveTrackConfiguredStats,
        store.getTrackGaugeMax,
        store.getActiveSetBonusCategories,
      );
      if (!inputs) {
        simError.value = "角色数据不完整或包含未支持的角色";
        simResult.value = null;
        return;
      }
      const result = simulate(
        inputs.builds,
        inputs.skills,
        inputs.enemyConfig,
        { ...inputs.config, critMode: critMode.value, validateConditions: false },
        inputs.triggersByActor,
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
  }

  function selectAction(actionId: string, actorId: string) {
    selectedItem.value = { type: "action", actionId, actorId };
  }

  function selectBuff(buffId: string, startTime: number) {
    selectedItem.value = { type: "buff", buffId, startTime };
  }

  function clearSelection() {
    selectedItem.value = null;
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
    critMode,
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

    // Actions
    runSimulation,
    selectCharacter,
    selectAction,
    selectBuff,
    clearSelection,
    toggleCritMode,
    getBuffDetail,
    goBack,
  };
}
