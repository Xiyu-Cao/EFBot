<script setup>
import { provide } from 'vue'
import { useDamageCalcState } from '@/composables/useDamageCalcState'
import DamageCalcHeader from '@/components/damage-calc/DamageCalcHeader.vue'
import VerticalTimeline from '@/components/damage-calc/VerticalTimeline.vue'
import DetailPanel from '@/components/damage-calc/DetailPanel.vue'

const state = useDamageCalcState()
provide('damageCalcState', state)
</script>

<template>
  <div class="damage-calc-page">
    <DamageCalcHeader />

    <div v-if="state.simError.value" class="error-banner">
      <span class="error-icon">!</span>
      <span>{{ state.simError.value }}</span>
      <button class="back-btn" @click="state.goBack()">返回排轴</button>
    </div>

    <div v-else class="damage-calc-body">
      <div class="timeline-panel">
        <VerticalTimeline />
      </div>
      <div class="detail-panel">
        <DetailPanel />
      </div>
    </div>
  </div>
</template>

<style scoped>
.damage-calc-page {
  width: 100vw;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #1e2028;
  color: #e0e0e0;
  overflow: hidden;
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 24px;
  background: #3a2020;
  border-bottom: 1px solid #663333;
  font-size: 14px;
}

.error-icon {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #ff4d4f;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 14px;
  flex-shrink: 0;
}

.back-btn {
  margin-left: auto;
  padding: 4px 16px;
  background: #444;
  color: #e0e0e0;
  border: 1px solid #555;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
}

.back-btn:hover {
  background: #555;
}

.damage-calc-body {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 360px;
  min-height: 0;
}

.timeline-panel {
  overflow: hidden;
  border-right: 1px solid #444;
}

.detail-panel {
  overflow: hidden;
}
</style>
