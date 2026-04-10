<template>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 349 372" class="endaxis-stage-icon">
    <defs>
      <filter id="band-shadow-gray" x="-40%" y="-40%" width="200%" height="200%">
        <feDropShadow dx="2.3" dy="2.8" stdDeviation="2.7" flood-color="#000000" flood-opacity="0.34" />
      </filter>
      <filter id="band-shadow-top" x="-45%" y="-45%" width="210%" height="210%">
        <feDropShadow dx="3.0" dy="3.4" stdDeviation="3.0" flood-color="#000000" flood-opacity="0.42" />
      </filter>
      <filter id="endaxis-stage-glow" x="-45%" y="-45%" width="190%" height="190%">
        <feFlood flood-color="#F8D728" result="flood" />
        <feComposite in="flood" in2="SourceGraphic" operator="in" result="tinted" />
        <feGaussianBlur in="tinted" stdDeviation="8" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    <rect width="349" height="372" fill="#27272A" />

    <polygon
      v-for="(points, idx) in bandPoints"
      :key="'gray-' + idx"
      :points="points"
      :fill="inactiveColor"
      filter="url(#band-shadow-gray)"
    />

    <g :opacity="safeStage === 6 ? 1 : 0" filter="url(#endaxis-stage-glow)">
      <polygon
        v-for="(points, idx) in bandPoints"
        :key="'glow-' + idx"
        :points="points"
        :fill="activeColor"
      />
    </g>

    <template v-for="(fill, idx) in topFills" :key="'top-' + idx">
      <polygon
        v-if="fill !== 'transparent'"
        :points="bandPoints[idx]"
        :fill="fill"
        filter="url(#band-shadow-top)"
      />
    </template>
  </svg>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  stage?: number
  inactiveColor?: string
  activeColor?: string
  completeColor?: string
}>(), {
  stage: 1,
  inactiveColor: '#59595D',
  activeColor: '#F8D728',
  completeColor: '#F4F4F6',
})

const safeStage = computed(() => Math.min(6, Math.max(1, props.stage)))
const bandPoints = [
  "260.95,207.44 100.77,91.06 87.15,51.49 247.32,167.88",
  "221.61,110.40 61.43,226.79 19.60,227.52 179.77,111.13",
  "117.17,117.85 178.35,306.15 166.12,346.15 104.94,157.84",
  "91.94,219.47 289.94,219.47 324.22,243.47 126.22,243.47",
  "180.83,274.85 242.00,86.55 275.43,61.36 214.25,249.67"
]

const topFills = computed(() => {
  if (safeStage.value === 6) {
    return bandPoints.map(() => props.completeColor)
  }
  return bandPoints.map((_, idx) => {
    if (idx < safeStage.value - 1) return props.completeColor
    if (idx === safeStage.value - 1) return props.activeColor
    return 'transparent'
  })
})
</script>

<style scoped>
.endaxis-stage-icon {
  width: 100%;
  height: auto;
  display: block;
}
</style>
