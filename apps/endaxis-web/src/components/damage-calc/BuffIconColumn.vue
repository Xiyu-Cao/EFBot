<script setup>
import { computed } from 'vue'

const props = defineProps({
  // Each entry: { id, icon, name, startTime, stacks?, color?, buffId?, kind? }
  entries: { type: Array, default: () => [] },
  endTime: { type: Number, required: true },
  pxPerSecond: { type: Number, required: true },
  width: { type: Number, default: 48 },
  // Minimum vertical spacing before a new lane opens (px)
  laneSpacing: { type: Number, default: 22 },
  iconSize: { type: Number, default: 20 },
  selectedKey: { type: String, default: '' },
})

const emit = defineEmits(['select'])

// Lane assignment: icons within laneSpacing px of each other get shunted to
// the next horizontal lane so they don't overlap.
const placed = computed(() => {
  const sorted = [...(props.entries || [])]
    .filter(e => e && e.startTime >= 0 && e.startTime <= props.endTime)
    .sort((a, b) => a.startTime - b.startTime)

  const laneLastY = []  // Y position of last icon per lane
  const out = []

  for (const e of sorted) {
    const y = e.startTime * props.pxPerSecond
    let lane = -1
    for (let i = 0; i < laneLastY.length; i++) {
      if (y - laneLastY[i] >= props.laneSpacing) { lane = i; break }
    }
    if (lane === -1) {
      lane = laneLastY.length
      laneLastY.push(y)
    } else {
      laneLastY[lane] = y
    }
    out.push({ ...e, _lane: lane, _y: y })
  }
  return out
})

const maxLane = computed(() => {
  let m = 0
  for (const e of placed.value) if (e._lane > m) m = e._lane
  return m
})

// Column width grows if we need more lanes. Base width = one lane + padding.
const columnWidth = computed(() => {
  const n = maxLane.value + 1
  return Math.max(props.width, n * (props.iconSize + 4) + 4)
})

function iconLeft(entry) {
  return 2 + entry._lane * (props.iconSize + 4)
}

function iconTop(entry) {
  // Center icon on startTime
  return entry._y - props.iconSize / 2
}

function isSelected(entry) {
  return props.selectedKey && entry._selectionKey === props.selectedKey
}

function onClick(entry) {
  emit('select', entry)
}

function tooltipFor(entry) {
  const parts = [entry.name || entry.buffId || '']
  if (entry.stacks && entry.stacks > 1) parts.push(`×${entry.stacks}`)
  parts.push(`@${entry.startTime.toFixed(2)}s`)
  return parts.join(' ')
}
</script>

<template>
  <div
    class="buff-icon-column"
    :style="{
      height: endTime * pxPerSecond + 'px',
      width: columnWidth + 'px',
    }"
  >
    <div
      v-for="entry in placed"
      :key="entry.id"
      class="buff-icon"
      :class="{ selected: isSelected(entry), refresh: entry.kind === 'refresh' }"
      :style="{
        top: iconTop(entry) + 'px',
        left: iconLeft(entry) + 'px',
        width: iconSize + 'px',
        height: iconSize + 'px',
        borderColor: entry.color || '#888',
      }"
      :title="tooltipFor(entry)"
      @click.stop="onClick(entry)"
    >
      <img
        v-if="entry.icon"
        :src="entry.icon"
        class="buff-icon-img"
        draggable="false"
        @error="e => e.target.style.display='none'"
      />
      <span v-else class="buff-icon-fallback">?</span>
      <span v-if="entry.stacks && entry.stacks > 1" class="stack-badge">{{ entry.stacks }}</span>
    </div>
  </div>
</template>

<style scoped>
.buff-icon-column {
  position: relative;
  flex-shrink: 0;
  border-right: 1px solid #2a2c34;
  background: rgba(255, 255, 255, 0.01);
}

.buff-icon {
  position: absolute;
  border-radius: 3px;
  border: 1px solid #888;
  background: #1a1c24;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.1s, box-shadow 0.1s;
  z-index: 2;
}

.buff-icon:hover {
  transform: scale(1.12);
  z-index: 3;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.3);
}

.buff-icon.selected {
  box-shadow: 0 0 0 1.5px #ffd700;
  z-index: 4;
}

.buff-icon.refresh {
  opacity: 0.75;
  border-style: dashed;
}

.buff-icon-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.buff-icon-fallback {
  font-size: 11px;
  color: #666;
}

.stack-badge {
  position: absolute;
  right: -1px;
  bottom: -1px;
  background: #1a1c24;
  color: #ffd700;
  font-size: 9px;
  font-weight: 700;
  line-height: 1;
  padding: 1px 2px;
  border-radius: 2px;
  pointer-events: none;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}
</style>
