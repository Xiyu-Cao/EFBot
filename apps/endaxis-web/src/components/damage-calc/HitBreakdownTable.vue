<script setup>
import { computed, ref, inject } from 'vue'
import { useTimelineStore } from '@/stores/timelineStore.js'
import HitZoneBreakdown from './HitZoneBreakdown.vue'

const props = defineProps({
  /** HitGroup[] — one entry per (actionId, hitIndex). */
  groups: { type: Array, required: true },
})

const store = useTimelineStore()
const state = inject('damageCalcState')

// Level-1 (hit-group) expansion — keyed by group.key
const expandedGroups = ref(new Set())
function toggleGroup(key) {
  const next = new Set(expandedGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedGroups.value = next
}

// Level-2 (per-damage) expansion inside a group — keyed by `${group.key}:${damageIdx}`
const expandedDamages = ref(new Set())
function toggleDamage(key) {
  const next = new Set(expandedDamages.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedDamages.value = next
}

// Click on a hit row selects it (for the settlement overlay button).
function selectGroup(g) {
  state.selectHit(g.actionId, g.hitIndex)
  toggleGroup(g.key)
}

const selectedKey = computed(() => {
  const s = state.selectedHitKey.value
  return s ? `${s.actionId}::${s.hitIndex}` : null
})

// Aggregates for the summary bar
const totalHits = computed(() => props.groups.length)
const mainDamageCount = computed(() =>
  props.groups.reduce((sum, g) => sum + g.damages.filter(d => d.source?.kind === 'main').length, 0),
)
const effectDamageCount = computed(() =>
  props.groups.reduce((sum, g) => sum + g.damages.filter(d => d.source?.kind === 'effect').length, 0),
)
const triggerDamageCount = computed(() =>
  props.groups.reduce((sum, g) => sum + g.damages.filter(d => d.source?.kind === 'trigger').length, 0),
)

const ELEMENT_LABELS = {
  physical: '物理',
  blaze: '灼热',
  cold: '寒冷',
  emag: '电磁',
  nature: '自然',
}

function fmtTime(t) { return t.toFixed(2) + 's' }

function fmtDmg(n) {
  if (!n || n === 0) return '0'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
  return n.toLocaleString('zh-CN')
}
</script>

<template>
  <div class="hit-table-container">
    <div class="hit-summary">
      <span>共 <b>{{ totalHits }}</b> 次命中</span>
      <span class="sep">·</span>
      <span>主 <b>{{ mainDamageCount }}</b></span>
      <span class="sep">·</span>
      <span :class="{ highlight: effectDamageCount > 0 }">破防 <b>{{ effectDamageCount }}</b></span>
      <span class="sep">·</span>
      <span :class="{ highlight: triggerDamageCount > 0 }">追加 <b>{{ triggerDamageCount }}</b></span>
    </div>

    <table class="hit-table">
      <thead>
        <tr>
          <th class="col-expand"></th>
          <th class="col-index">#</th>
          <th class="col-time">时间</th>
          <th class="col-element">元素</th>
          <th class="col-crit">暴击</th>
          <th class="col-stagger">失衡</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="g in groups" :key="g.key">
          <!-- ── Hit summary row ── -->
          <tr
            class="hit-row"
            :class="{
              expanded: expandedGroups.has(g.key),
              selected: selectedKey === g.key,
              multi: g.damages.length > 1,
            }"
            @click="selectGroup(g)"
          >
            <td class="col-expand">
              <span class="expand-chevron" :class="{ open: expandedGroups.has(g.key) }">&#x25B6;</span>
            </td>
            <td class="col-index">
              <span class="hit-tag">{{ g.hitIndex + 1 }}</span>
              <span v-if="g.damages.length > 1" class="hit-multi-badge" :title="`本 hit 触发 ${g.damages.length} 笔伤害`">
                ×{{ g.damages.length }}
              </span>
            </td>
            <td class="col-time">{{ fmtTime(g.time) }}</td>
            <td class="col-element">
              <span class="element-dot" :style="{ background: store.getColor(g.element) }" />
              <span class="element-text">{{ ELEMENT_LABELS[g.element] || g.element }}</span>
            </td>
            <td class="col-crit">
              <span v-if="g.isCrit" class="crit-yes">&#x2713;</span>
              <span v-else class="crit-no">-</span>
            </td>
            <td class="col-stagger">{{ g.staggerTotal || '-' }}</td>
          </tr>

          <!-- ── Level-2 (when expanded) ── -->
          <template v-if="expandedGroups.has(g.key)">
            <!-- Single damage → skip sub-row and show zones directly -->
            <tr v-if="g.damages.length === 1" class="zone-row-wrapper">
              <td colspan="6" class="zone-cell">
                <HitZoneBreakdown :hit="g.damages[0]" />
              </td>
            </tr>

            <!-- Multiple damages → show one sub-row per damage; each can further expand -->
            <template v-else>
              <template v-for="(d, di) in g.damages" :key="g.key + ':' + di">
                <tr
                  class="dmg-row"
                  :class="['src-' + (d.source?.kind || 'main'), { expanded: expandedDamages.has(g.key + ':' + di) }]"
                  @click.stop="toggleDamage(g.key + ':' + di)"
                >
                  <td class="col-expand">
                    <span class="expand-chevron sub" :class="{ open: expandedDamages.has(g.key + ':' + di) }">&#x25B6;</span>
                  </td>
                  <td class="col-index">
                    <span class="hit-tag" :class="'tag-' + (d.source?.kind || 'main')">
                      <span class="tag-idx">{{ d.hitIndex + 1 }}</span>
                      <template v-if="d.source?.kind && d.source.kind !== 'main'">
                        <span class="tag-sep">·</span><span class="tag-label">{{ d.source.label }}</span>
                      </template>
                    </span>
                  </td>
                  <td class="col-damage" :class="{ 'crit-damage': d.isCrit }" colspan="4">
                    {{ fmtDmg(d.damage) }}
                    <span v-if="d.isCrit" class="inline-crit">&#x2713;</span>
                  </td>
                </tr>
                <tr v-if="expandedDamages.has(g.key + ':' + di)" class="zone-row-wrapper">
                  <td colspan="6" class="zone-cell sub">
                    <HitZoneBreakdown :hit="d" />
                  </td>
                </tr>
              </template>
            </template>
          </template>
        </template>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.hit-table-container {
  overflow-x: auto;
}

.hit-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 8px;
  font-size: 11px;
  color: #999;
}
.hit-summary b {
  color: #e0e0e0;
  font-weight: 600;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}
.hit-summary .sep { color: #444; }
.hit-summary .highlight b { color: #faad14; }
.hit-summary .highlight:last-child b { color: #52c41a; }

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

/* ── Summary row (hit group) ── */
.hit-row { cursor: pointer; }
.hit-row:hover { background: #2a2c34; }
.hit-row.expanded { background: #2a2c34; }

.hit-row.selected {
  background: rgba(24, 144, 255, 0.12);
}
.hit-row.selected td:first-child {
  box-shadow: inset 3px 0 0 #1890ff;
}
.hit-row.selected:hover { background: rgba(24, 144, 255, 0.18); }

.hit-row.multi .col-index {
  display: flex;
  align-items: center;
  gap: 4px;
}
.hit-multi-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 4px;
  border-radius: 2px;
  background: #3c3a20;
  color: #faad14;
  font-size: 10px;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  line-height: 1.2;
}

/* ── Damage sub-rows ── */
.dmg-row { cursor: pointer; background: #1c1e26; }
.dmg-row:hover { background: #22242e; }
.dmg-row.expanded { background: #22242e; }

.dmg-row.src-trigger td:first-child { box-shadow: inset 3px 0 0 #52c41a; }
.dmg-row.src-effect td:first-child { box-shadow: inset 3px 0 0 #faad14; }
.dmg-row.src-main td:first-child { box-shadow: inset 3px 0 0 #555; }

.dmg-row .col-index { padding-left: 22px; }

.tag-idx { color: #888; }
.tag-sep { color: #444; margin: 0 1px; }
.tag-label { font-weight: 500; }
.tag-main .tag-label { color: #aaa; }
.tag-effect .tag-label { color: #faad14; }
.tag-trigger .tag-label { color: #52c41a; }

.hit-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 11px;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  white-space: nowrap;
}

/* ── Columns ── */
.col-expand {
  width: 16px;
  text-align: center;
}
.expand-chevron {
  display: inline-block;
  color: #555;
  font-size: 9px;
  transition: transform 0.15s ease;
}
.expand-chevron.open { transform: rotate(90deg); color: #999; }
.expand-chevron.sub { font-size: 8px; }

.col-index {
  width: 56px;
  text-align: left;
  color: #666;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.col-time {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  color: #999;
  width: 60px;
}

.col-element {
  display: flex;
  align-items: center;
  gap: 4px;
}
.element-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.element-text { font-size: 11px; }

.col-crit { text-align: center; width: 36px; }
.crit-yes { color: #ffd700; font-weight: bold; }
.crit-no { color: #555; }

.col-stagger {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  color: #999;
  width: 42px;
}

.col-damage {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  color: #e0e0e0;
  font-weight: 500;
}
.col-damage.crit-damage { color: #ffd700; }
.inline-crit {
  margin-left: 6px;
  color: #ffd700;
  font-size: 11px;
}

/* ── Zone row wrapper ── */
.zone-row-wrapper { background: #1a1c24; }
.zone-row-wrapper .zone-cell { padding: 0 6px 4px 22px; border-bottom: 1px solid #2a2c34; }
.zone-row-wrapper .zone-cell.sub { padding-left: 44px; }
</style>
