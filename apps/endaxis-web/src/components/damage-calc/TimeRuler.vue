<script setup>
import { computed } from 'vue'

const props = defineProps({
  endTime: { type: Number, required: true },
  pxPerSecond: { type: Number, required: true },
})

// Generate tick marks
const ticks = computed(() => {
  const result = []
  const totalSeconds = Math.ceil(props.endTime)
  for (let s = 0; s <= totalSeconds; s++) {
    result.push({
      second: s,
      top: s * props.pxPerSecond,
      isMajor: s % 5 === 0,
    })
  }
  return result
})
</script>

<template>
  <div class="time-ruler" :style="{ height: endTime * pxPerSecond + 'px' }">
    <div
      v-for="tick in ticks"
      :key="tick.second"
      class="tick"
      :class="{ major: tick.isMajor }"
      :style="{ top: tick.top + 'px' }"
    >
      <span v-if="tick.isMajor" class="tick-label">{{ tick.second }}s</span>
      <span class="tick-line" :class="{ major: tick.isMajor }" />
    </div>
  </div>
</template>

<style scoped>
.time-ruler {
  width: 48px;
  flex-shrink: 0;
  position: relative;
  border-right: 1px solid #333;
  background: #22242c;
}

.tick {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  height: 0;
}

.tick-label {
  font-size: 10px;
  color: #888;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  padding-left: 4px;
  transform: translateY(-50%);
  white-space: nowrap;
}

.tick-line {
  position: absolute;
  right: 0;
  width: 6px;
  height: 1px;
  background: #444;
}

.tick-line.major {
  width: 10px;
  background: #666;
}
</style>
