<script setup>
import { useTimelineStore } from '@/stores/timelineStore.js'

defineProps({
  hits: { type: Array, required: true },
})

const store = useTimelineStore()

const ELEMENT_LABELS = {
  physical: '物理',
  blaze: '灼热',
  cold: '寒冷',
  emag: '电磁',
  nature: '自然',
}

const SCHOOL_LABELS = {
  physical: '物理',
  magic: '法术',
}

function fmtDmg(n) {
  if (!n || n === 0) return '0'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
  return n.toLocaleString('zh-CN')
}

function fmtMult(n) {
  if (!n) return '—'
  return (n).toFixed(1) + '%'
}

function fmtTime(t) {
  return t.toFixed(2) + 's'
}
</script>

<template>
  <div class="hit-table-container">
    <table class="hit-table">
      <thead>
        <tr>
          <th class="col-index">#</th>
          <th class="col-time">时间</th>
          <th class="col-mult">倍率</th>
          <th class="col-element">元素</th>
          <th class="col-damage">伤害</th>
          <th class="col-crit">暴击</th>
          <th class="col-stagger">失衡</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(hit, i) in hits"
          :key="i"
          class="hit-row"
          :class="{ crit: hit.isCrit, trigger: hit.fromTrigger }"
        >
          <td class="col-index">
            <span v-if="hit.fromTrigger" class="trigger-badge" title="触发器追加">T</span>
            <span v-else>{{ hit.hitIndex + 1 }}</span>
          </td>
          <td class="col-time">{{ fmtTime(hit.time) }}</td>
          <td class="col-mult">{{ fmtMult(hit.multiplier) }}</td>
          <td class="col-element">
            <span
              class="element-dot"
              :style="{ background: store.getColor(hit.element) }"
            />
            <span class="element-text">{{ ELEMENT_LABELS[hit.element] || hit.element }}</span>
          </td>
          <td class="col-damage" :class="{ 'crit-damage': hit.isCrit }">{{ fmtDmg(hit.damage) }}</td>
          <td class="col-crit">
            <span v-if="hit.isCrit" class="crit-yes">&#x2713;</span>
            <span v-else class="crit-no">-</span>
          </td>
          <td class="col-stagger">{{ hit.stagger || '-' }}</td>
        </tr>
        <tr v-for="(hit, i) in hits" :key="'name-' + i" v-if="false">
          <!-- Trigger name row (shown below trigger hits) -->
        </tr>
      </tbody>
    </table>

    <!-- Trigger hit names shown inline -->
    <div
      v-for="(hit, i) in hits.filter(h => h.fromTrigger && h.triggerName)"
      :key="'tn-' + i"
      class="trigger-name-note"
    >
      <span class="trigger-badge-inline">T</span>
      {{ hit.triggerName }} @ {{ fmtTime(hit.time) }}
    </div>
  </div>
</template>

<style scoped>
.hit-table-container {
  overflow-x: auto;
}

.hit-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.hit-table th {
  padding: 6px 6px;
  text-align: left;
  color: #888;
  font-weight: 500;
  border-bottom: 1px solid #444;
  font-size: 11px;
  white-space: nowrap;
}

.hit-table td {
  padding: 5px 6px;
  border-bottom: 1px solid #2a2c34;
  color: #ccc;
}

.hit-row:hover {
  background: #2a2c34;
}

.hit-row.crit {
  background: rgba(255, 215, 0, 0.05);
}

.hit-row.trigger {
  border-left: 2px dashed #888;
}

.col-index {
  width: 28px;
  text-align: center;
  color: #666;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.col-time {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  color: #999;
}

.col-mult {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  color: #ccc;
}

.col-element {
  display: flex;
  align-items: center;
  gap: 4px;
}

.element-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.element-text {
  font-size: 11px;
}

.col-damage {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  color: #e0e0e0;
  font-weight: 500;
}

.col-damage.crit-damage {
  color: #ffd700;
}

.col-crit {
  text-align: center;
  width: 32px;
}

.crit-yes {
  color: #ffd700;
  font-weight: bold;
}

.crit-no {
  color: #555;
}

.col-stagger {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  color: #999;
}

.trigger-badge {
  display: inline-flex;
  width: 16px;
  height: 14px;
  align-items: center;
  justify-content: center;
  background: #555;
  color: #ddd;
  border-radius: 2px;
  font-size: 9px;
  font-weight: 700;
}

.trigger-name-note {
  padding: 3px 8px;
  font-size: 11px;
  color: #999;
  font-style: italic;
  display: flex;
  align-items: center;
  gap: 6px;
}

.trigger-badge-inline {
  display: inline-flex;
  width: 14px;
  height: 12px;
  align-items: center;
  justify-content: center;
  background: #555;
  color: #ddd;
  border-radius: 2px;
  font-size: 8px;
  font-weight: 700;
  font-style: normal;
}
</style>
