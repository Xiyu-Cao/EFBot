<script setup>
import { inject, computed } from 'vue'
import { useTimelineStore } from '@/stores/timelineStore.js'
import BuffIconColumn from './BuffIconColumn.vue'

const props = defineProps({
  endTime: { type: Number, required: true },
  pxPerSecond: { type: Number, required: true },
})

const state = inject('damageCalcState')
const store = useTimelineStore()

function iconForAnomaly(type) {
  return store.iconDatabase?.[type] || ''
}

// ── Lane 1: Team buffs ──
const teamEntries = computed(() => {
  const data = state.adaptedProjections.value
  if (!data) return []
  return (data.teamBuffStatuses || []).map(bs => {
    const buffId = bs.buffId || bs.id
    return {
      id: `tb_${bs.id}`,
      icon: bs.icon,
      name: bs.name,
      startTime: bs.startTime,
      stacks: bs.stacks || 1,
      color: bs.color || '#faad14',
      buffId,
      _selectionKey: `${buffId}@${bs.startTime}`,
    }
  })
})

// ── Lane 2: Attachments + magic anomalies + break on enemy ──
const attachEntries = computed(() => {
  const data = state.adaptedProjections.value
  if (!data) return []
  const out = []
  for (const d of data.attachmentDebuffs || []) {
    const icon = iconForAnomaly(d.anomalyType)
    out.push({
      id: `at_${d.id}`,
      icon,
      name: d.anomalyType,
      startTime: d.startTime,
      stacks: d.stacks || 1,
      color: store.getColor(d.anomalyType),
      buffId: d.id,
      _selectionKey: `${d.id}@${d.startTime}`,
    })
  }
  for (const d of data.anomalyDebuffs || []) {
    const icon = iconForAnomaly(d.anomalyType)
    out.push({
      id: `an_${d.id}`,
      icon,
      name: d.anomalyType,
      startTime: d.startTime,
      stacks: d.stacks || 1,
      color: store.getColor(d.anomalyType),
      buffId: d.id,
      _selectionKey: `${d.id}@${d.startTime}`,
    })
  }
  const breakIcon = iconForAnomaly('break')
  for (const d of data.breakDebuffs || []) {
    out.push({
      id: `br_${d.id}`,
      icon: breakIcon,
      name: '破防',
      startTime: d.startTime,
      stacks: d.stacks || 1,
      color: '#ff7a45',
      buffId: d.id,
      _selectionKey: `${d.id}@${d.startTime}`,
    })
  }
  return out
})

// ── Lane 3: Enemy debuffs (脆弱, 猛击等) ──
const debuffEntries = computed(() => {
  const data = state.adaptedProjections.value
  if (!data) return []
  const out = []
  for (const bs of data.debuffStatuses || []) {
    const buffId = bs.buffId || bs.id
    out.push({
      id: `db_${bs.id}`,
      icon: bs.icon,
      name: bs.name,
      startTime: bs.startTime,
      stacks: bs.stacks || 1,
      color: bs.color || '#ff4d4f',
      buffId,
      _selectionKey: `${buffId}@${bs.startTime}`,
    })
  }
  return out
})

const selectedBuffKey = computed(() => {
  const sel = state.selectedItem.value
  if (sel?.type !== 'buff') return ''
  return `${sel.buffId}@${sel.startTime}`
})

function handleSelect(entry) {
  state.selectBuff(entry.buffId, entry.startTime)
}
</script>

<template>
  <div class="enemy-status-track" :style="{ height: endTime * pxPerSecond + 'px' }">
    <BuffIconColumn
      :entries="teamEntries"
      :end-time="endTime"
      :px-per-second="pxPerSecond"
      :width="56"
      :selected-key="selectedBuffKey"
      @select="handleSelect"
    />
    <BuffIconColumn
      :entries="attachEntries"
      :end-time="endTime"
      :px-per-second="pxPerSecond"
      :width="56"
      :selected-key="selectedBuffKey"
      @select="handleSelect"
    />
    <BuffIconColumn
      :entries="debuffEntries"
      :end-time="endTime"
      :px-per-second="pxPerSecond"
      :width="56"
      :selected-key="selectedBuffKey"
      @select="handleSelect"
    />
  </div>
</template>

<style scoped>
.enemy-status-track {
  flex-shrink: 0;
  display: flex;
  position: relative;
  border-left: 1px solid #333;
}
</style>
