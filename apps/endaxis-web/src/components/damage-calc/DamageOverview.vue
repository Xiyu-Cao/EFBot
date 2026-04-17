<script setup>
import { inject, computed } from 'vue'
import { useTimelineStore } from '@/stores/timelineStore.js'

const state = inject('damageCalcState')
const store = useTimelineStore()

const summary = computed(() => state.fullDamageSummary.value)

const ELEMENT_LABELS = {
  physical: '物理',
  blaze: '灼热',
  cold: '寒冷',
  emag: '电磁',
  nature: '自然',
}

const ELEMENT_COLOR = {
  physical: '#e0e0e0',
  blaze: '#ff4d4f',
  cold: '#00e5ff',
  emag: '#ffd700',
  nature: '#52c41a',
}

function fmtDmg(n) {
  if (!n || n === 0) return '0'
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
  return n.toLocaleString('zh-CN')
}

function pct(part, total) {
  if (!total || total === 0) return '0%'
  return (part / total * 100).toFixed(1) + '%'
}

// Element breakdown for display
const elementBreakdown = computed(() => {
  if (!summary.value) return []
  const result = []
  for (const [element, damage] of summary.value.byElement) {
    result.push({
      element,
      label: ELEMENT_LABELS[element] || element,
      color: ELEMENT_COLOR[element] || '#888',
      damage,
      pct: pct(damage, summary.value.totalDamage),
    })
  }
  result.sort((a, b) => b.damage - a.damage)
  return result
})
</script>

<template>
  <div class="damage-overview">
    <div v-if="!summary" class="empty-state">
      <p>暂无模拟数据</p>
      <p class="hint">请先在排轴页面完成时间轴编辑并通过验证</p>
    </div>

    <template v-else>
      <!-- Total stats -->
      <div class="overview-section">
        <div class="total-damage">{{ fmtDmg(summary.totalDamage) }}</div>
        <div class="total-label">总伤害</div>
        <div class="total-sub">
          {{ summary.hitCount }} 次命中 / {{ summary.critCount }} 次暴击 ({{ pct(summary.critCount, summary.hitCount) }})
        </div>
      </div>

      <!-- Per-actor breakdown -->
      <div class="section-title">角色伤害</div>
      <div class="actor-list">
        <div
          v-for="actor in summary.byActor"
          :key="actor.actorId"
          class="actor-row"
          @click="state.selectCharacter(actor.actorId)"
        >
          <div class="actor-info">
            <span
              class="actor-dot"
              :style="{ background: store.getColor(actor.element) }"
            />
            <span class="actor-name">{{ actor.name }}</span>
            <span class="actor-pct">{{ pct(actor.totalDamage, summary.totalDamage) }}</span>
          </div>
          <div class="actor-bar-container">
            <div
              class="actor-bar"
              :style="{
                width: pct(actor.totalDamage, summary.totalDamage),
                background: store.getColor(actor.element) + 'aa',
              }"
            />
          </div>
          <div class="actor-damage">{{ fmtDmg(actor.totalDamage) }}</div>
        </div>
      </div>

      <!-- Element breakdown -->
      <div class="section-title">元素分布</div>
      <div class="element-list">
        <div
          v-for="el in elementBreakdown"
          :key="el.element"
          class="element-row"
        >
          <span class="element-dot" :style="{ background: el.color }" />
          <span class="element-label">{{ el.label }}</span>
          <span class="element-bar-container">
            <span
              class="element-bar"
              :style="{ width: el.pct, background: el.color + '88' }"
            />
          </span>
          <span class="element-value">{{ fmtDmg(el.damage) }}</span>
          <span class="element-pct">{{ el.pct }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.damage-overview {
  padding: 12px;
}

.empty-state {
  padding: 40px 20px;
  text-align: center;
  color: #888;
}

.empty-state .hint {
  font-size: 12px;
  color: #666;
  margin-top: 8px;
}

.overview-section {
  text-align: center;
  padding: 16px 0 20px;
  border-bottom: 1px solid #333;
  margin-bottom: 16px;
}

.total-damage {
  font-size: 28px;
  font-weight: 700;
  color: #ffd700;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.total-label {
  font-size: 12px;
  color: #888;
  margin-top: 2px;
}

.total-sub {
  font-size: 12px;
  color: #999;
  margin-top: 6px;
}

.section-title {
  font-size: 12px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 8px;
  padding-left: 2px;
}

.actor-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 20px;
}

.actor-row {
  padding: 8px 10px;
  background: #2a2c34;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.1s;
}

.actor-row:hover {
  background: #333;
}

.actor-info {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.actor-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.actor-name {
  font-size: 13px;
  color: #e0e0e0;
  flex: 1;
}

.actor-pct {
  font-size: 12px;
  color: #999;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.actor-bar-container {
  height: 4px;
  background: #1e2028;
  border-radius: 2px;
  margin-bottom: 4px;
}

.actor-bar {
  height: 100%;
  border-radius: 2px;
  transition: width 0.3s;
}

.actor-damage {
  font-size: 13px;
  color: #ffd700;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  text-align: right;
}

.element-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.element-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0;
}

.element-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.element-label {
  font-size: 12px;
  color: #ccc;
  width: 30px;
}

.element-bar-container {
  flex: 1;
  height: 6px;
  background: #1e2028;
  border-radius: 3px;
}

.element-bar {
  display: block;
  height: 100%;
  border-radius: 3px;
}

.element-value {
  font-size: 12px;
  color: #ccc;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  width: 60px;
  text-align: right;
}

.element-pct {
  font-size: 11px;
  color: #888;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  width: 40px;
  text-align: right;
}
</style>
