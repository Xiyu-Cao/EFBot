<script setup>
import { inject, computed } from 'vue'
import { useTimelineStore } from '@/stores/timelineStore.js'

const props = defineProps({
  buffId: { type: String, required: true },
  startTime: { type: Number, required: true },
})

const state = inject('damageCalcState')
const store = useTimelineStore()

const detail = computed(() => {
  return state.getBuffDetail(props.buffId, props.startTime)
})

const sourceCharName = computed(() => {
  if (!detail.value) return '未知'
  const charInfo = store.characterRoster.find(c => c.id === detail.value.sourceActorId)
  return charInfo?.name || detail.value.sourceActorId
})

const targetCharName = computed(() => {
  if (!detail.value) return '未知'
  if (detail.value.target === 'enemy') return '敌方'
  if (detail.value.target === 'team') return '全队'
  const charInfo = store.characterRoster.find(c => c.id === detail.value.targetActorId)
  return charInfo?.name || detail.value.targetActorId
})

const TARGET_LABELS = {
  self: '自身',
  team: '全队',
  enemy: '敌方',
  others: '队友',
}

function fmtTime(t) {
  if (t == null) return '—'
  return t.toFixed(2) + 's'
}
</script>

<template>
  <div class="buff-detail">
    <div v-if="!detail" class="empty-state">
      <p>未找到 Buff 详情</p>
      <p class="hint">ID: {{ buffId }} @ {{ startTime.toFixed(2) }}s</p>
    </div>

    <template v-else>
      <!-- Buff header -->
      <div class="buff-header">
        <div class="buff-name">{{ detail.buffName || detail.buffId }}</div>
        <div class="buff-id">{{ detail.buffId }}</div>
      </div>

      <!-- Buff info -->
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">来源</span>
          <span class="info-value">{{ sourceCharName }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">目标</span>
          <span class="info-value">
            {{ TARGET_LABELS[detail.target] || detail.target }}
            <span v-if="detail.target === 'self'" class="target-sub">({{ targetCharName }})</span>
          </span>
        </div>
        <div class="info-row">
          <span class="info-label">叠层</span>
          <span class="info-value">{{ detail.stacks }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">持续时间</span>
          <span class="info-value">{{ detail.duration.toFixed(2) }}s</span>
        </div>
        <div class="info-row">
          <span class="info-label">起始时间</span>
          <span class="info-value">{{ fmtTime(detail.startTime) }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">结束时间</span>
          <span class="info-value">{{ fmtTime(detail.endTime) }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.buff-detail {
  padding: 12px;
}

.empty-state {
  padding: 30px 20px;
  text-align: center;
  color: #888;
}

.empty-state .hint {
  font-size: 11px;
  color: #555;
  margin-top: 6px;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.buff-header {
  padding-bottom: 12px;
  border-bottom: 1px solid #333;
  margin-bottom: 12px;
}

.buff-name {
  font-size: 16px;
  font-weight: 600;
  color: #e0e0e0;
}

.buff-id {
  font-size: 11px;
  color: #666;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  margin-top: 2px;
}

.info-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.info-row {
  display: flex;
  align-items: center;
  padding: 4px 0;
  font-size: 13px;
}

.info-label {
  width: 80px;
  color: #888;
  flex-shrink: 0;
}

.info-value {
  color: #e0e0e0;
}

.target-sub {
  color: #888;
  font-size: 12px;
  margin-left: 4px;
}
</style>
