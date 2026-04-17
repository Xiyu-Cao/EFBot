<script setup>
import { inject, computed } from 'vue'
import { useTimelineStore } from '@/stores/timelineStore.js'

const props = defineProps({
  endTime: { type: Number, required: true },
  pxPerSecond: { type: Number, required: true },
})

const state = inject('damageCalcState')
const store = useTimelineStore()

// Element colors for attachments
const ATTACH_COLORS = {
  fire: '#ff4d4f',
  cold: '#00e5ff',
  electro: '#ffd700',
  nature: '#52c41a',
}

// Anomaly colors
const ANOMALY_COLORS = {
  burning: '#f5222d',
  frozen: '#1890ff',
  conduction: '#ffec3d',
  corrosion: '#52c41a',
}

// Combine attachment and anomaly bars into a visual timeline
const attachBars = computed(() => {
  return (state.attachmentBars.value || []).map(bar => ({
    top: bar.startTime * props.pxPerSecond,
    height: Math.max((bar.endTime - bar.startTime) * props.pxPerSecond, 2),
    color: ATTACH_COLORS[bar.element] || '#888',
    label: `${bar.element} ×${bar.stacks}`,
    type: 'attach',
  }))
})

const anomalyBarItems = computed(() => {
  return (state.anomalyBars.value || []).map(bar => ({
    top: bar.startTime * props.pxPerSecond,
    height: Math.max((bar.endTime - bar.startTime) * props.pxPerSecond, 2),
    color: ANOMALY_COLORS[bar.anomalyType] || '#888',
    label: bar.anomalyType,
    type: 'anomaly',
  }))
})

const breakBarItems = computed(() => {
  return (state.breakBars.value || []).map(bar => ({
    top: bar.startTime * props.pxPerSecond,
    height: Math.max((bar.endTime - bar.startTime) * props.pxPerSecond, 2),
    color: '#ff7a45',
    label: `破防 ×${bar.stacks}`,
    type: 'break',
  }))
})
</script>

<template>
  <div class="enemy-status-track" :style="{ height: endTime * pxPerSecond + 'px' }">
    <!-- Attachment lane -->
    <div class="lane" title="法术附着">
      <div
        v-for="(bar, i) in attachBars"
        :key="'a' + i"
        class="status-bar"
        :style="{ top: bar.top + 'px', height: bar.height + 'px', background: bar.color + '33', borderLeftColor: bar.color }"
        :title="bar.label"
      />
    </div>

    <!-- Anomaly lane -->
    <div class="lane" title="法术异常">
      <div
        v-for="(bar, i) in anomalyBarItems"
        :key="'n' + i"
        class="status-bar"
        :style="{ top: bar.top + 'px', height: bar.height + 'px', background: bar.color + '33', borderLeftColor: bar.color }"
        :title="bar.label"
      />
    </div>

    <!-- Break lane -->
    <div class="lane" title="破防">
      <div
        v-for="(bar, i) in breakBarItems"
        :key="'b' + i"
        class="status-bar"
        :style="{ top: bar.top + 'px', height: bar.height + 'px', background: bar.color + '33', borderLeftColor: bar.color }"
        :title="bar.label"
      />
    </div>
  </div>
</template>

<style scoped>
.enemy-status-track {
  width: 100px;
  flex-shrink: 0;
  display: flex;
  position: relative;
  border-left: 1px solid #333;
}

.lane {
  flex: 1;
  position: relative;
}

.status-bar {
  position: absolute;
  left: 1px;
  right: 1px;
  border-radius: 2px;
  border-left: 2px solid #888;
  min-height: 2px;
}
</style>
