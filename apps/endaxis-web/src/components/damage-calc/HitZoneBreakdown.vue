<script setup>
import { computed } from 'vue'

const props = defineProps({
  hit: { type: Object, required: true },
})

const zones = computed(() => props.hit?.zones || null)

const ZONE_ROWS = [
  { key: 'defense',       label: '防御区',   cn: '防御' },
  { key: 'crit',          label: '暴击区',   cn: '暴击' },
  { key: 'damageBonus',   label: '增伤区',   cn: '增伤' },
  { key: 'amplify',       label: '增幅区',   cn: '增幅' },
  { key: 'combo',         label: '连击区',   cn: '连击' },
  { key: 'vulnerability', label: '易伤区',   cn: '易伤' },
  { key: 'fragility',     label: '脆弱区',   cn: '脆弱' },
  { key: 'resistance',    label: '抗性区',   cn: '抗性' },
  { key: 'stagger',       label: '失衡区',   cn: '失衡' },
  { key: 'reduction',     label: '减伤区',   cn: '减伤' },
  { key: 'special',       label: '特殊区',   cn: '特殊' },
]

function fmtMult(v) {
  if (v == null) return '—'
  return 'x' + v.toFixed(3).replace(/\.?0+$/, '')
}

function fmtPct(v) {
  if (v == null) return ''
  const delta = (v - 1) * 100
  if (Math.abs(delta) < 0.05) return ''
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}%`
}

function zoneClass(v) {
  if (v == null) return 'neutral'
  if (Math.abs(v - 1) < 0.0005) return 'neutral'
  return v > 1 ? 'positive' : 'negative'
}

function fmtNumber(n) {
  if (n == null) return '—'
  if (Math.abs(n) >= 1000) return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
  return n.toFixed(0)
}

function fmtDmg(n) {
  if (n == null) return '—'
  return n.toLocaleString('zh-CN')
}

// Running product from ATK × skillMult through each zone
const runningProducts = computed(() => {
  if (!zones.value) return []
  const z = zones.value
  let running = z.atk * z.skillMult
  const rows = []
  for (const row of ZONE_ROWS) {
    const zv = z[row.key]
    running = running * zv
    rows.push({ ...row, value: zv, running })
  }
  return rows
})

const baseLine = computed(() => {
  if (!zones.value) return null
  return zones.value.atk * zones.value.skillMult
})
</script>

<template>
  <div v-if="zones" class="zone-breakdown">
    <!-- Header: ATK × skillMult -->
    <div class="zone-head">
      <div class="head-item">
        <span class="head-label">攻击力</span>
        <span class="head-value">{{ fmtNumber(zones.atk) }}</span>
      </div>
      <span class="head-op">x</span>
      <div class="head-item">
        <span class="head-label">技能倍率</span>
        <span class="head-value">{{ (zones.skillMult * 100).toFixed(0) }}%</span>
      </div>
      <span class="head-eq">=</span>
      <div class="head-item">
        <span class="head-label">基础伤害</span>
        <span class="head-value base">{{ fmtNumber(baseLine) }}</span>
      </div>
    </div>

    <!-- 11 zones -->
    <div class="zone-rows">
      <div
        v-for="row in runningProducts"
        :key="row.key"
        class="zone-row"
        :class="zoneClass(row.value)"
      >
        <span class="zone-label">{{ row.cn }}</span>
        <span class="zone-mult">{{ fmtMult(row.value) }}</span>
        <span class="zone-pct">{{ fmtPct(row.value) }}</span>
        <span class="zone-running">{{ fmtNumber(row.running) }}</span>
      </div>
    </div>

    <!-- Final -->
    <div class="zone-final">
      <span class="final-label">最终伤害</span>
      <span class="final-value" :class="{ crit: hit.isCrit }">{{ fmtDmg(hit.damage) }}</span>
    </div>
  </div>

  <div v-else class="no-zones">
    <span>此 hit 没有 zones 数据（请确认 kernel 已附带 zones）</span>
  </div>
</template>

<style scoped>
.zone-breakdown {
  background: #1a1c24;
  border-radius: 4px;
  padding: 8px 10px;
  margin: 4px 0 6px;
  font-size: 11px;
  border-left: 2px solid #555;
}

.zone-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 6px;
  border-bottom: 1px dashed #333;
  margin-bottom: 6px;
}

.head-item {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.head-label {
  font-size: 10px;
  color: #666;
}

.head-value {
  font-size: 12px;
  color: #ccc;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.head-value.base {
  color: #e0e0e0;
  font-weight: 600;
}

.head-op, .head-eq {
  color: #555;
  font-size: 11px;
  padding: 0 2px;
  align-self: flex-end;
  padding-bottom: 1px;
}

.zone-rows {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 0 8px;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.zone-row {
  display: contents;
}

.zone-row > span {
  padding: 2px 0;
  border-bottom: 1px dotted #26282f;
}

.zone-label {
  color: #888;
  font-size: 11px;
}

.zone-mult {
  color: #aaa;
  justify-self: start;
}

.zone-pct {
  justify-self: end;
  min-width: 48px;
  text-align: right;
}

.zone-running {
  color: #888;
  justify-self: end;
  min-width: 60px;
  text-align: right;
}

.zone-row.positive .zone-mult,
.zone-row.positive .zone-pct {
  color: #73d13d;
}

.zone-row.negative .zone-mult,
.zone-row.negative .zone-pct {
  color: #ff7a45;
}

.zone-row.neutral .zone-mult,
.zone-row.neutral .zone-pct {
  color: #555;
}

.zone-row.neutral .zone-label {
  color: #555;
}

.zone-row.neutral .zone-running {
  color: #555;
}

.zone-final {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid #333;
}

.final-label {
  font-size: 11px;
  color: #888;
}

.final-value {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: 14px;
  font-weight: 600;
  color: #e0e0e0;
}

.final-value.crit {
  color: #ffd700;
}

.no-zones {
  padding: 8px 10px;
  font-size: 11px;
  color: #666;
  font-style: italic;
  background: #1a1c24;
  border-radius: 4px;
  border-left: 2px solid #444;
  margin: 4px 0;
}
</style>
