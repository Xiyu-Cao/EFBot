<script setup>
import { inject, computed } from 'vue'

const state = inject('damageCalcState')

const totalDamage = computed(() => state.fullDamageSummary.value?.totalDamage || 0)
const totalHits = computed(() => state.fullDamageSummary.value?.hitCount || 0)
const totalCrits = computed(() => state.fullDamageSummary.value?.critCount || 0)
const critRate = computed(() => totalHits.value > 0 ? (totalCrits.value / totalHits.value * 100).toFixed(1) : '0.0')
const dps = computed(() => {
  const et = state.endTime.value
  if (!et || et <= 0) return 0
  return totalDamage.value / et
})

function fmtDmg(n) {
  if (!n || n === 0) return '0'
  if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
  return n.toLocaleString('zh-CN')
}
</script>

<template>
  <div class="damage-calc-header">
    <div class="header-left">
      <button class="back-button" @click="state.goBack()" title="返回排轴">
        <span class="arrow">&#8592;</span>
        <span>返回</span>
      </button>
      <div class="header-title">伤害计算</div>
    </div>

    <div class="header-center">
      <div class="stat-group">
        <div class="stat-label">总伤害</div>
        <div class="stat-value primary">{{ fmtDmg(totalDamage) }}</div>
      </div>
      <div class="stat-divider" />
      <div class="stat-group">
        <div class="stat-label">DPS</div>
        <div class="stat-value">{{ fmtDmg(Math.floor(dps)) }}</div>
      </div>
      <div class="stat-divider" />
      <div class="stat-group">
        <div class="stat-label">命中/暴击</div>
        <div class="stat-value">{{ totalHits }} / {{ totalCrits }} ({{ critRate }}%)</div>
      </div>
    </div>

    <div class="header-right">
      <button
        class="settlement-btn"
        :class="{
          active: state.settlementOverlayVisible.value,
          disabled: !state.selectedHitKey.value,
        }"
        :disabled="!state.selectedHitKey.value"
        @click="state.toggleSettlementOverlay()"
        :title="state.selectedHitKey.value
          ? (state.settlementOverlayVisible.value ? '关闭结算视图' : '查看选中 hit 的完整结算')
          : '请先在右侧命中表中选择一个 hit'"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="20" x2="18" y2="10"/>
          <line x1="12" y1="20" x2="12" y2="4"/>
          <line x1="6" y1="20" x2="6" y2="14"/>
        </svg>
        结算视图
      </button>
      <button
        class="crit-mode-btn"
        :class="{ active: state.critMode.value === 'expected' }"
        @click="state.toggleCritMode()"
        :title="state.critMode.value === 'expected' ? '期望暴击 — 概率加权' : '真实暴击 — 随机判定'"
      >
        {{ state.critMode.value === 'expected' ? '期望暴击' : '真实暴击' }}
      </button>
      <button class="rerun-btn" @click="state.runSimulation()" title="重新模拟">
        &#x21bb;
      </button>
    </div>
  </div>
</template>

<style scoped>
.damage-calc-header {
  height: 50px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  background: #2a2c34;
  border-bottom: 1px solid #444;
  flex-shrink: 0;
  gap: 16px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.back-button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  background: transparent;
  color: #aaa;
  border: 1px solid #555;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
}

.back-button:hover {
  background: #3a3c44;
  color: #e0e0e0;
  border-color: #777;
}

.arrow {
  font-size: 16px;
}

.header-title {
  font-size: 15px;
  font-weight: 600;
  color: #e0e0e0;
  letter-spacing: 0.5px;
}

.header-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.stat-group {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.stat-label {
  font-size: 12px;
  color: #888;
}

.stat-value {
  font-size: 14px;
  color: #ccc;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.stat-value.primary {
  color: #ffd700;
  font-size: 16px;
  font-weight: 600;
}

.stat-divider {
  width: 1px;
  height: 20px;
  background: #444;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.settlement-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: #333;
  color: #ccc;
  border: 1px solid #555;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}

.settlement-btn:hover:not(.disabled) {
  background: #444;
  color: #e0e0e0;
}

.settlement-btn.active {
  background: #20333e;
  border-color: #1890ff;
  color: #40a9ff;
}

.settlement-btn.disabled {
  opacity: 0.38;
  cursor: not-allowed;
  color: #888;
}

.crit-mode-btn {
  padding: 4px 12px;
  background: #333;
  color: #ccc;
  border: 1px solid #555;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}

.crit-mode-btn:hover {
  background: #444;
}

.crit-mode-btn.active {
  background: #3a3520;
  border-color: #ffd700;
  color: #ffd700;
}

.rerun-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: #aaa;
  border: 1px solid #555;
  border-radius: 4px;
  cursor: pointer;
  font-size: 18px;
  transition: all 0.15s;
}

.rerun-btn:hover {
  background: #3a3c44;
  color: #e0e0e0;
}
</style>
