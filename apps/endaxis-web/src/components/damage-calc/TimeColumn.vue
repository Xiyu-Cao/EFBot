<script setup>
import { inject, computed } from 'vue'
import { useTimelineStore } from '@/stores/timelineStore.js'

const props = defineProps({
  track: { type: Object, required: true },
  endTime: { type: Number, required: true },
  pxPerSecond: { type: Number, required: true },
})

const state = inject('damageCalcState')
const store = useTimelineStore()

// Action type labels
const TYPE_LABELS = {
  attack: 'A',
  skill: 'C',
  link: 'E',
  ultimate: 'U',
  execution: 'X',
  dodge: 'D',
}

// Get the actions for this track
const actions = computed(() => {
  return (props.track.actions || [])
    .filter(a => !a.isDisabled && a.startTime != null && a.duration > 0)
    .sort((a, b) => a.startTime - b.startTime)
})

// Lookup per-action damage from the full damage summary
const actionDamageMap = computed(() => {
  const map = new Map()
  const summary = state.fullDamageSummary.value
  if (!summary) return map
  const actorSummary = summary.byActor.find(a => a.actorId === props.track.id)
  if (!actorSummary) return map
  for (const action of actorSummary.actions) {
    map.set(action.actionId, action.totalDamage)
  }
  return map
})

function getActionTop(action) {
  return action.startTime * props.pxPerSecond
}

function getActionHeight(action) {
  return Math.max(action.duration * props.pxPerSecond, 2)
}

function getActionColor(action) {
  // Use element or action type for coloring
  const element = action.element || props.track.element
  return store.getColor(element || action.type || 'default')
}

function getTypeLabel(action) {
  return TYPE_LABELS[action.type] || '?'
}

function getDisplayName(action) {
  if (action.name) return action.name
  if (action.type === 'attack') return '普攻'
  return action.id || ''
}

function fmtDmg(n) {
  if (!n || n === 0) return ''
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
  return n.toLocaleString('zh-CN')
}

function isSelected(action) {
  const sel = state.selectedItem.value
  return sel?.type === 'action' && sel.actionId === action.instanceId
}

function handleClick(action) {
  state.selectAction(action.instanceId, props.track.id)
}
</script>

<template>
  <div class="time-column" :style="{ height: endTime * pxPerSecond + 'px' }">
    <!-- Action blocks -->
    <div
      v-for="action in actions"
      :key="action.instanceId"
      class="action-block"
      :class="{ selected: isSelected(action) }"
      :style="{
        top: getActionTop(action) + 'px',
        height: getActionHeight(action) + 'px',
        borderLeftColor: getActionColor(action),
      }"
      @click.stop="handleClick(action)"
      :title="`${getDisplayName(action)} [${getTypeLabel(action)}] ${action.startTime.toFixed(2)}s`"
    >
      <!-- Type badge -->
      <span
        class="type-badge"
        :style="{ background: getActionColor(action) }"
      >{{ getTypeLabel(action) }}</span>

      <!-- Skill name (only if block is tall enough) -->
      <span v-if="getActionHeight(action) >= 18" class="action-name">
        {{ getDisplayName(action) }}
      </span>

      <!-- Damage number (only if block is tall enough) -->
      <span
        v-if="getActionHeight(action) >= 32 && actionDamageMap.get(action.instanceId)"
        class="action-damage"
      >
        {{ fmtDmg(actionDamageMap.get(action.instanceId)) }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.time-column {
  flex: 1;
  position: relative;
  border-right: 1px solid #2a2c34;
  min-width: 0;
}

/* Subtle alternating background every 5 seconds */
.time-column::before {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent calc(v-bind('pxPerSecond * 5') * 1px),
    rgba(255, 255, 255, 0.015) calc(v-bind('pxPerSecond * 5') * 1px),
    rgba(255, 255, 255, 0.015) calc(v-bind('pxPerSecond * 10') * 1px)
  );
  pointer-events: none;
}

.action-block {
  position: absolute;
  left: 4px;
  right: 4px;
  border-radius: 3px;
  background: #2e3040;
  border-left: 3px solid #888;
  display: flex;
  flex-direction: column;
  padding: 2px 4px;
  cursor: pointer;
  overflow: hidden;
  transition: background 0.1s, box-shadow 0.1s;
  z-index: 1;
}

.action-block:hover {
  background: #383a4c;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.15);
}

.action-block.selected {
  background: #3a3520;
  box-shadow: 0 0 0 1.5px #ffd700;
}

.type-badge {
  font-size: 10px;
  font-weight: 700;
  color: #1a1a2e;
  width: 16px;
  height: 14px;
  line-height: 14px;
  text-align: center;
  border-radius: 2px;
  flex-shrink: 0;
}

.action-name {
  font-size: 11px;
  color: #ccc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 14px;
}

.action-damage {
  font-size: 10px;
  color: #ffd700;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  line-height: 14px;
}
</style>
