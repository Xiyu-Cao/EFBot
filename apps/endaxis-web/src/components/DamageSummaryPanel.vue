<script setup>
import { ref, computed } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'

const store = useTimelineStore()
const expanded = ref(false)
const expandedActors = ref(new Set())

const summary = computed(() => store.damageStatsSnapshot)

function toggleActor(trackId) {
  if (expandedActors.value.has(trackId)) {
    expandedActors.value.delete(trackId)
  } else {
    expandedActors.value.add(trackId)
  }
}

function fmtDmg(n) {
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
  return Math.round(n).toLocaleString()
}

function pct(part, total) {
  if (!total) return '0%'
  return (part / total * 100).toFixed(1) + '%'
}

const ACTION_TYPE_LABELS = {
  skill: '战技',
  link: '连携',
  ultimate: '终结',
  attack: '重击',
  execution: '处决',
}

const ELEMENT_COLORS = {
  blaze: '#f97316',
  emag: '#a855f7',
  cold: '#38bdf8',
  nature: '#22c55e',
  physical: '#94a3b8',
}
</script>

<template>
  <div class="damage-summary-panel" :class="{ expanded }">
    <div class="dsp-header" @click="expanded = !expanded">
      <div class="dsp-header-left">
        <svg class="dsp-icon" viewBox="0 0 16 16" fill="none">
          <path d="M2 12l4-5 3 3 2-4 3 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="dsp-title">伤害统计</span>
        <template v-if="summary">
          <span class="dsp-total">{{ fmtDmg(summary.totalDamage) }}</span>
          <span class="dsp-actors-count">{{ summary.byActor.length }} 名干员</span>
        </template>
        <span v-else class="dsp-empty">点击顶部「伤害统计」按钮计算</span>
      </div>
      <svg class="dsp-chevron" :class="{ rotated: expanded }" viewBox="0 0 16 16" fill="none">
        <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </div>

    <div v-if="expanded && summary" class="dsp-body">
      <div
        v-for="actor in summary.byActor"
        :key="actor.trackId"
        class="dsp-actor"
      >
        <div class="dsp-actor-header" @click="toggleActor(actor.trackId)">
          <svg class="dsp-actor-chevron" :class="{ rotated: expandedActors.has(actor.trackId) }" viewBox="0 0 16 16" fill="none">
            <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
          <span class="dsp-actor-name">{{ actor.name }}
            <span v-if="actor.hasUnsupported" class="dsp-unsupported-hint" title="含未支持技能，部分伤害未计入">⚠ 部分未计入</span>
          </span>
          <div class="dsp-bar-wrap">
            <div
              class="dsp-bar-fill"
              :style="{ width: pct(actor.damage, summary.totalDamage) }"
            />
          </div>
          <span class="dsp-actor-dmg">{{ fmtDmg(actor.damage) }}</span>
          <span class="dsp-actor-pct">{{ pct(actor.damage, summary.totalDamage) }}</span>
        </div>

        <div v-if="expandedActors.has(actor.trackId)" class="dsp-action-list">
          <div
            v-for="action in actor.actions"
            :key="action.actionId"
            class="dsp-action-row"
          >
            <span
              class="dsp-elem-dot"
              :style="{ background: ELEMENT_COLORS[action.element] || '#94a3b8' }"
            />
            <span class="dsp-action-type">{{ ACTION_TYPE_LABELS[action.type] || action.type }}</span>
            <span class="dsp-action-name">{{ action.name }}
              <span v-if="action.unsupportedTickCount > 0 && action.ticks.length === 0" class="dsp-unsupported-label">未支持</span>
              <span v-else-if="action.unsupportedTickCount > 0" class="dsp-partial-label">部分未支持</span>
            </span>
            <div class="dsp-bar-wrap dsp-bar-wrap--sm">
              <div
                class="dsp-bar-fill dsp-bar-fill--action"
                :style="{ width: pct(action.damage, actor.damage) }"
              />
            </div>
            <span class="dsp-action-dmg">{{ fmtDmg(action.damage) }}</span>
            <span class="dsp-action-pct">{{ pct(action.damage, actor.damage) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.damage-summary-panel {
  background: #181c24;
  border-bottom: 1px solid #2a2f3a;
  flex-shrink: 0;
  user-select: none;
}

.dsp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  height: 34px;
  cursor: pointer;
  gap: 8px;
}
.dsp-header:hover { background: #1e2330; }

.dsp-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.dsp-icon {
  width: 14px;
  height: 14px;
  color: #64748b;
  flex-shrink: 0;
}

.dsp-title {
  font-size: 12px;
  font-weight: 600;
  color: #94a3b8;
  letter-spacing: 0.02em;
}

.dsp-total {
  font-size: 13px;
  font-weight: 700;
  color: #e2e8f0;
  font-variant-numeric: tabular-nums;
}

.dsp-actors-count {
  font-size: 11px;
  color: #475569;
}

.dsp-empty {
  font-size: 11px;
  color: #475569;
  font-style: italic;
}

.dsp-chevron {
  width: 14px;
  height: 14px;
  color: #475569;
  transition: transform 0.15s;
  flex-shrink: 0;
}
.dsp-chevron.rotated { transform: rotate(180deg); }

/* Body */
.dsp-body {
  padding: 4px 0 6px;
  border-top: 1px solid #1e2330;
}

/* Actor row */
.dsp-actor { }

.dsp-actor-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 12px;
  cursor: pointer;
  min-width: 0;
}
.dsp-actor-header:hover { background: #1e2330; }

.dsp-actor-chevron {
  width: 12px;
  height: 12px;
  color: #475569;
  flex-shrink: 0;
  transition: transform 0.15s;
}
.dsp-actor-chevron.rotated { transform: rotate(90deg); }

.dsp-actor-name {
  font-size: 12px;
  color: #cbd5e1;
  font-weight: 500;
  min-width: 80px;
  flex-shrink: 0;
}

.dsp-bar-wrap {
  flex: 1;
  height: 4px;
  background: #1e2330;
  border-radius: 2px;
  overflow: hidden;
  min-width: 0;
}
.dsp-bar-fill {
  height: 100%;
  background: #3b82f6;
  border-radius: 2px;
  transition: width 0.3s;
}

.dsp-actor-dmg {
  font-size: 12px;
  color: #e2e8f0;
  font-variant-numeric: tabular-nums;
  min-width: 64px;
  text-align: right;
  flex-shrink: 0;
}

.dsp-actor-pct {
  font-size: 11px;
  color: #64748b;
  min-width: 36px;
  text-align: right;
  flex-shrink: 0;
}

/* Action list */
.dsp-action-list {
  padding: 2px 0 2px 28px;
}

.dsp-action-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 12px 2px 0;
  min-width: 0;
}

.dsp-elem-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dsp-action-type {
  font-size: 10px;
  color: #475569;
  min-width: 24px;
  flex-shrink: 0;
}

.dsp-action-name {
  font-size: 11px;
  color: #94a3b8;
  min-width: 80px;
  flex-shrink: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}

.dsp-bar-wrap--sm {
  height: 3px;
}

.dsp-bar-fill--action {
  background: #1d4ed8;
}

.dsp-action-dmg {
  font-size: 11px;
  color: #cbd5e1;
  font-variant-numeric: tabular-nums;
  min-width: 64px;
  text-align: right;
  flex-shrink: 0;
}

.dsp-action-pct {
  font-size: 10px;
  color: #475569;
  min-width: 36px;
  text-align: right;
  flex-shrink: 0;
}

.dsp-unsupported-hint {
  font-size: 9px;
  color: #faad14;
  font-weight: 400;
  margin-left: 4px;
}
.dsp-unsupported-label {
  font-size: 8px;
  color: #ff7875;
  background: rgba(255, 77, 79, 0.15);
  padding: 0 3px;
  border-radius: 2px;
  margin-left: 3px;
  font-weight: 600;
}
.dsp-partial-label {
  font-size: 8px;
  color: #faad14;
  background: rgba(250, 173, 20, 0.15);
  padding: 0 3px;
  border-radius: 2px;
  margin-left: 3px;
  font-weight: 600;
}
</style>
