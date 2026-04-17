<script setup>
import { inject, computed, ref } from 'vue'
import { useTimelineStore } from '@/stores/timelineStore.js'
import TimeRuler from './TimeRuler.vue'
import TimeColumn from './TimeColumn.vue'
import EnemyStatusTrack from './EnemyStatusTrack.vue'

const state = inject('damageCalcState')
const store = useTimelineStore()

const PX_PER_SECOND = 50
const endTime = computed(() => state.endTime.value)

// Get track info from store (name, element, icon, etc.)
const tracksInfo = computed(() => {
  return store.teamTracksInfo.filter(t => t.id)
})

// Compute total timeline height
const timelineHeight = computed(() => endTime.value * PX_PER_SECOND)

// Scroll container ref
const scrollContainer = ref(null)
</script>

<template>
  <div class="vertical-timeline" ref="scrollContainer">
    <div class="timeline-content" :style="{ minHeight: timelineHeight + 80 + 'px' }">
      <!-- Column headers (sticky top) -->
      <div class="column-headers">
        <div class="ruler-header">时间</div>
        <div
          v-for="track in tracksInfo"
          :key="track.id"
          class="column-header"
          :class="{ selected: state.selectedItem.value?.type === 'character' && state.selectedItem.value.trackId === track.id }"
          @click="state.selectCharacter(track.id)"
        >
          <div class="char-element-dot" :style="{ background: store.getColor(track.element || 'default') }" />
          <div class="char-name" :title="track.name">{{ track.name || track.id }}</div>
        </div>
        <div class="enemy-header">敌方状态</div>
      </div>

      <!-- Timeline body -->
      <div class="timeline-body">
        <TimeRuler :end-time="endTime" :px-per-second="PX_PER_SECOND" />

        <TimeColumn
          v-for="track in tracksInfo"
          :key="track.id"
          :track="track"
          :end-time="endTime"
          :px-per-second="PX_PER_SECOND"
        />

        <EnemyStatusTrack
          :end-time="endTime"
          :px-per-second="PX_PER_SECOND"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.vertical-timeline {
  width: 100%;
  height: 100%;
  overflow: auto;
  background: #1e2028;
}

.timeline-content {
  display: flex;
  flex-direction: column;
}

.column-headers {
  display: flex;
  position: sticky;
  top: 0;
  z-index: 10;
  background: #2a2c34;
  border-bottom: 1px solid #444;
  height: 40px;
  flex-shrink: 0;
}

.ruler-header {
  width: 48px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #666;
  border-right: 1px solid #333;
}

.column-header {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  cursor: pointer;
  border-right: 1px solid #333;
  transition: background 0.15s;
  min-width: 0;
}

.column-header:hover {
  background: #333;
}

.column-header.selected {
  background: #3a3520;
  border-bottom: 2px solid #ffd700;
}

.char-element-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.char-name {
  font-size: 13px;
  color: #e0e0e0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.enemy-header {
  width: 100px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #888;
}

.timeline-body {
  display: flex;
  flex: 1;
  position: relative;
}
</style>
