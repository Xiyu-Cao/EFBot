<script setup>
import { inject, computed } from 'vue'
import { useTimelineStore } from '@/stores/timelineStore.js'
import HitBreakdownTable from './HitBreakdownTable.vue'

const props = defineProps({
  actionId: { type: String, required: true },
  actorId: { type: String, required: true },
})

const state = inject('damageCalcState')
const store = useTimelineStore()

// Find the action from store tracks
const action = computed(() => {
  for (const track of store.tracks) {
    const found = track.actions?.find(a => a.instanceId === props.actionId)
    if (found) return found
  }
  return null
})

// Character info
const charName = computed(() => {
  const charInfo = store.characterRoster.find(c => c.id === props.actorId)
  return charInfo?.name || props.actorId
})

// Hit details for this action
const hits = computed(() => {
  const details = state.hitDetails.value
  return details.get(props.actionId) || []
})

// Total damage for this action
const totalDamage = computed(() => {
  return hits.value.reduce((sum, h) => sum + h.damage, 0)
})

const totalStagger = computed(() => {
  return hits.value.reduce((sum, h) => sum + h.stagger, 0)
})

const critCount = computed(() => {
  return hits.value.filter(h => h.isCrit).length
})

const TYPE_LABELS = {
  attack: '普攻',
  skill: '战技',
  link: '连携技',
  ultimate: '终结技',
  execution: '处决',
  dodge: '闪避',
}

const ELEMENT_LABELS = {
  physical: '物理',
  blaze: '灼热',
  cold: '寒冷',
  emag: '电磁',
  nature: '自然',
}

function fmtDmg(n) {
  if (!n || n === 0) return '0'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
  return n.toLocaleString('zh-CN')
}
</script>

<template>
  <div class="skill-detail">
    <!-- Skill header -->
    <div class="skill-header">
      <div class="skill-info">
        <span
          class="type-badge"
          :style="{ background: store.getColor(action?.element || action?.type || 'default') }"
        >{{ TYPE_LABELS[action?.type] || action?.type }}</span>
        <span class="skill-name">{{ action?.name || action?.id || '未知技能' }}</span>
      </div>
      <div class="skill-meta">
        <span>{{ charName }}</span>
        <span v-if="action">{{ action.startTime?.toFixed(2) }}s ~ {{ (action.startTime + action.duration)?.toFixed(2) }}s</span>
      </div>
    </div>

    <!-- Damage totals -->
    <div class="damage-totals">
      <div class="total-item">
        <div class="total-value primary">{{ fmtDmg(totalDamage) }}</div>
        <div class="total-label">总伤害</div>
      </div>
      <div class="total-item">
        <div class="total-value">{{ hits.length }}</div>
        <div class="total-label">命中</div>
      </div>
      <div class="total-item">
        <div class="total-value">{{ critCount }}</div>
        <div class="total-label">暴击</div>
      </div>
      <div class="total-item">
        <div class="total-value">{{ totalStagger }}</div>
        <div class="total-label">失衡</div>
      </div>
    </div>

    <!-- Hit breakdown table -->
    <div class="section-title">命中明细</div>
    <HitBreakdownTable :hits="hits" />

    <div v-if="hits.length === 0" class="empty-hits">
      <span>此技能无伤害数据</span>
    </div>
  </div>
</template>

<style scoped>
.skill-detail {
  padding: 12px;
}

.skill-header {
  padding-bottom: 12px;
  border-bottom: 1px solid #333;
  margin-bottom: 12px;
}

.skill-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.type-badge {
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  color: #1a1a2e;
}

.skill-name {
  font-size: 16px;
  font-weight: 600;
  color: #e0e0e0;
}

.skill-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: #888;
}

.damage-totals {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 10px;
  background: #2a2c34;
  border-radius: 6px;
  margin-bottom: 16px;
}

.total-item {
  text-align: center;
}

.total-value {
  font-size: 16px;
  font-weight: 600;
  color: #e0e0e0;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.total-value.primary {
  color: #ffd700;
}

.total-label {
  font-size: 10px;
  color: #888;
  margin-top: 2px;
}

.section-title {
  font-size: 11px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
}

.empty-hits {
  text-align: center;
  padding: 20px;
  color: #666;
  font-size: 13px;
}
</style>
