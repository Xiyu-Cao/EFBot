<script setup>
/**
 * Hit Settlement Overlay
 *
 * Overlays the left timeline panel with a cross-character flow view of all
 * kernel events that share the selected hit's time. Aims to show the full
 * resolution pipeline: effects → effect damages → skill damage → triggers,
 * including reactions from OTHER actors (e.g. one actor's talent firing on
 * another actor's event).
 *
 * First pass: filter events by time ≈ selectedHit.time and render as a
 * vertical stream, coloured by event kind, labelled by source actor. We
 * infer phase by event type; kernel does not yet emit phase markers.
 */
import { computed, inject } from 'vue'
import { useTimelineStore } from '@/stores/timelineStore.js'

const state = inject('damageCalcState')
const store = useTimelineStore()

// ── Resolve selected hit metadata ──────────────────────────────────
const selectedHit = computed(() => {
  const key = state.selectedHitKey.value
  if (!key) return null
  const details = state.hitDetails.value.get(key.actionId) || []
  const hitsOfIndex = details.filter(d => d.hitIndex === key.hitIndex)
  if (hitsOfIndex.length === 0) return null
  // Prefer the main damage as the anchor (its time is the hit's nominal time).
  const main = hitsOfIndex.find(d => d.source?.kind === 'main') || hitsOfIndex[0]
  return {
    actionId: key.actionId,
    hitIndex: key.hitIndex,
    time: main.time,
    sourceActorId: main.sourceId,
    damages: hitsOfIndex,
  }
})

const actorName = computed(() => {
  if (!selectedHit.value) return ''
  const info = store.characterRoster?.find(c => c.id === selectedHit.value.sourceActorId)
  return info?.name || selectedHit.value.sourceActorId
})

const actionName = computed(() => {
  if (!selectedHit.value) return ''
  for (const track of store.tracks) {
    const a = track.actions?.find(x => x.instanceId === selectedHit.value.actionId)
    if (a) return a.name || a.id || '未知'
  }
  return selectedHit.value.actionId
})

function actorNameOf(actorId) {
  if (!actorId) return '—'
  const info = store.characterRoster?.find(c => c.id === actorId)
  return info?.name || actorId
}

function actorIconOf(actorId) {
  if (!actorId) return null
  const info = store.characterRoster?.find(c => c.id === actorId)
  return info?.icon || null
}

// ── Filter & classify events for this hit ──────────────────────────
// Time window: a hit's Phase ①/②/③ all fire at the exact same kernel time.
// Phase ⑤ triggers at the same time. Delayed_damage can emit later (delay > 0).
// For v1 we take events within a small window around the anchor time.
const TIME_EPS = 0.0005 // 0.5 ms tolerance for "same hit"

const events = computed(() => state.simResult.value?.events || [])

/**
 * @typedef {object} FlowRow
 * @property {string} id
 * @property {string} kind — badge class
 * @property {string} badge — short label on the badge
 * @property {string} actorId
 * @property {string} time — formatted
 * @property {string} title
 * @property {string} [detail]
 * @property {number} [damage]
 * @property {boolean} [isCrit]
 */

const flow = computed(() => {
  const hit = selectedHit.value
  if (!hit) return []
  const rows = []
  const base = hit.time
  let n = 0

  for (const e of events.value) {
    if (Math.abs(e.time - base) > TIME_EPS) continue
    const row = classifyEvent(e)
    if (!row) continue
    rows.push({ id: `fx_${n++}`, time: e.time.toFixed(3) + 's', ...row })
  }
  return rows
})

function classifyEvent(e) {
  switch (e.type) {
    case 'damage': {
      const kind = e.fromTrigger ? 'trigger' : (matchesAnomaly(e) ? 'effect' : 'main')
      const titleByKind = {
        main: '技能伤害',
        effect: '破防系统伤害',
        trigger: e.triggerName || '追加攻击',
      }
      return {
        kind: 'dmg-' + kind,
        badge: kind === 'main' ? '伤' : kind === 'effect' ? '破' : '追',
        actorId: e.sourceId,
        title: titleByKind[kind],
        detail: `倍率 ${e.multiplier}% · ${elementLabel(e.element)}`,
        damage: e.damage,
        isCrit: e.isCrit,
      }
    }
    case 'break_change':
      return {
        kind: 'break',
        badge: '破防',
        actorId: e.sourceId || '',
        title: breakTitle(e),
        detail: `层数 ${e.prevStacks} → ${e.stacks}`,
      }
    case 'buff_apply':
      return {
        kind: 'buff-apply',
        badge: 'BUFF+',
        actorId: e.actorId,
        title: e.buffName || e.buffId,
        detail: buffTarget(e) + (e.duration ? ` · ${e.duration.toFixed(1)}s` : ''),
      }
    case 'buff_remove':
      return {
        kind: 'buff-remove',
        badge: 'BUFF-',
        actorId: e.actorId,
        title: (e.buffName || e.buffId) + ' 消失',
        detail: e.reason || '',
      }
    case 'anomaly_apply':
      return {
        kind: 'anomaly',
        badge: '异常',
        actorId: e.sourceId,
        title: anomalyNameCN(e.anomalyType),
        detail: `Lv${e.level} · ${e.duration?.toFixed(1) || 0}s`,
      }
    case 'attachment_change':
      return {
        kind: 'attach',
        badge: '附着',
        actorId: e.sourceId || '',
        title: (e.element || '') + ' 附着',
        detail: `层数 ${e.prevStacks ?? '?'} → ${e.stacks}`,
      }
    case 'stack_change':
      return {
        kind: 'stack',
        badge: '堆叠',
        actorId: e.actorId,
        title: e.buffType,
        detail: `层数 ${e.prevStacks} → ${e.stacks}${e.reason ? ' · ' + e.reason : ''}`,
      }
    default:
      return null // skip noisy events: sp_change, gauge_change, action_*, hit_mark, condition_result
  }
}

// Match a damage event to its nearest-preceding `break_change` with
// prevStacks > 0 — if yes, it's an effect (slam/armorBreak/launch/knockdown)
// damage. This mirrors the pairing in projectHitDamageDetails.
function matchesAnomaly(damageEvent) {
  const list = events.value
  const idx = list.indexOf(damageEvent)
  for (let i = idx - 1; i >= 0; i--) {
    const prev = list[i]
    if (prev.type === 'damage' && prev.time === damageEvent.time) return false // another damage already ate that slot
    if (prev.type === 'break_change'
        && prev.time === damageEvent.time
        && prev.prevStacks > 0
        && prev.sourceId === damageEvent.sourceId
        && prev.physicalType) {
      return true
    }
    if (prev.time < damageEvent.time - TIME_EPS) break
  }
  return false
}

function breakTitle(e) {
  const typeCN = { slam: '猛击', armorBreak: '碎甲', launch: '击飞', knockdown: '倒地' }
  if (e.prevStacks === 0 && e.stacks > 0) return `${typeCN[e.physicalType] || e.physicalType} · 附加破防`
  if (e.stacks === 0 && e.prevStacks > 0) return `${typeCN[e.physicalType] || e.physicalType} · 消耗破防`
  if (e.stacks > e.prevStacks) return `${typeCN[e.physicalType] || e.physicalType} · 增加破防`
  return typeCN[e.physicalType] || e.physicalType || '破防变化'
}

function anomalyNameCN(type) {
  const map = { burning: '燃烧', frozen: '冻结', conduction: '导电', corrosion: '腐蚀' }
  return map[type] || type || '异常'
}

function elementLabel(el) {
  const map = { physical: '物理', blaze: '灼热', cold: '寒冷', emag: '电磁', nature: '自然' }
  return map[el] || el
}

function buffTarget(e) {
  const map = { self: '自身', team: '全队', others: '他人', enemy: '敌方' }
  return map[e.target] || e.target || ''
}

function fmtDmg(n) {
  if (!n || n === 0) return '0'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
  return n.toLocaleString('zh-CN')
}
</script>

<template>
  <div class="settlement-overlay">
    <div class="overlay-header">
      <div class="header-title-group">
        <span class="header-caption">Hit 结算视图</span>
        <span class="header-context" v-if="selectedHit">
          <span class="ctx-pill">{{ actorName }}</span>
          <span class="ctx-sep">›</span>
          <span class="ctx-pill">{{ actionName }}</span>
          <span class="ctx-sep">›</span>
          <span class="ctx-pill ctx-hit">#{{ selectedHit.hitIndex + 1 }}</span>
          <span class="ctx-time">@ {{ selectedHit.time.toFixed(3) }}s</span>
        </span>
      </div>
      <button class="close-btn" @click="state.closeSettlementOverlay()" title="关闭">&#x2715;</button>
    </div>

    <div v-if="!selectedHit" class="empty-state">
      <span>未选中 hit</span>
    </div>

    <div v-else-if="flow.length === 0" class="empty-state">
      <span>此 hit 时间点没有可展示的事件</span>
    </div>

    <div v-else class="flow-stream">
      <div class="flow-note">
        {{ flow.length }} 条事件 · 按发射顺序排列，actor 头像标明发起方
      </div>
      <div
        v-for="row in flow"
        :key="row.id"
        class="flow-row"
        :class="'fr-' + row.kind"
      >
        <!-- actor avatar column -->
        <div class="actor-col">
          <img
            v-if="actorIconOf(row.actorId)"
            :src="actorIconOf(row.actorId)"
            :alt="actorNameOf(row.actorId)"
            :title="actorNameOf(row.actorId)"
            class="actor-avatar"
          />
          <div v-else class="actor-placeholder" :title="actorNameOf(row.actorId)">
            {{ (actorNameOf(row.actorId) || '?').slice(0, 1) }}
          </div>
        </div>

        <!-- badge -->
        <div class="badge-col">
          <span class="flow-badge" :class="'bg-' + row.kind">{{ row.badge }}</span>
        </div>

        <!-- main content -->
        <div class="content-col">
          <div class="content-title">
            <span class="title-text">{{ row.title }}</span>
            <span v-if="row.damage != null" class="dmg-pill" :class="{ crit: row.isCrit }">
              {{ fmtDmg(row.damage) }}
              <span v-if="row.isCrit" class="pill-crit">&#x2713;</span>
            </span>
          </div>
          <div v-if="row.detail" class="content-detail">{{ row.detail }}</div>
          <div class="content-actor">{{ actorNameOf(row.actorId) }}</div>
        </div>

        <!-- time on right -->
        <div class="time-col">{{ row.time }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settlement-overlay {
  position: absolute;
  inset: 0;
  background: #1a1c24;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 20;
}

.overlay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #22242c;
  border-bottom: 1px solid #1890ff;
  flex-shrink: 0;
}

.header-title-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.header-caption {
  font-size: 12px;
  color: #40a9ff;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.header-context {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #ccc;
}

.ctx-pill {
  padding: 1px 6px;
  background: #2f3240;
  border-radius: 2px;
  color: #ddd;
  font-family: inherit;
}

.ctx-pill.ctx-hit {
  color: #1890ff;
  border: 1px solid #1890ff44;
}

.ctx-sep { color: #555; }
.ctx-time {
  margin-left: 6px;
  color: #888;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: 11px;
}

.close-btn {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: #aaa;
  border: 1px solid #444;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}
.close-btn:hover { background: #2f3240; color: #fff; }

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-size: 13px;
}

.flow-stream {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.flow-note {
  font-size: 11px;
  color: #666;
  padding: 4px 0 8px;
  border-bottom: 1px dashed #333;
  margin-bottom: 4px;
}

/* ── Flow row layout ── */
.flow-row {
  display: grid;
  grid-template-columns: 32px 44px 1fr auto;
  gap: 8px;
  padding: 6px 8px;
  background: #22242c;
  border-radius: 4px;
  border-left: 3px solid #444;
  align-items: center;
}

.actor-col {
  display: flex;
  align-items: center;
  justify-content: center;
}

.actor-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  object-fit: cover;
  background: #1a1c24;
}
.actor-placeholder {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #3a3c44;
  color: #aaa;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

.badge-col {
  display: flex;
  justify-content: flex-start;
}

.flow-badge {
  padding: 2px 6px;
  border-radius: 2px;
  font-size: 10px;
  font-weight: 700;
  color: #1a1c24;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  white-space: nowrap;
  min-width: 32px;
  text-align: center;
}

.bg-dmg-main { background: #e0e0e0; }
.bg-dmg-effect { background: #faad14; }
.bg-dmg-trigger { background: #52c41a; }
.bg-break { background: #ff7a45; }
.bg-buff-apply { background: #40a9ff; }
.bg-buff-remove { background: #8c8c8c; }
.bg-anomaly { background: #d4380d; color: #fff; }
.bg-attach { background: #9254de; color: #fff; }
.bg-stack { background: #b37feb; }

/* ── Left border accent per kind ── */
.fr-dmg-main { border-left-color: #e0e0e0; }
.fr-dmg-effect { border-left-color: #faad14; }
.fr-dmg-trigger { border-left-color: #52c41a; }
.fr-break { border-left-color: #ff7a45; }
.fr-buff-apply { border-left-color: #40a9ff; }
.fr-buff-remove { border-left-color: #8c8c8c; }
.fr-anomaly { border-left-color: #d4380d; }
.fr-attach { border-left-color: #9254de; }
.fr-stack { border-left-color: #b37feb; }

.content-col {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.content-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #e0e0e0;
  font-weight: 500;
}

.title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dmg-pill {
  padding: 1px 6px;
  background: #1a1c24;
  border: 1px solid #444;
  border-radius: 3px;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: 12px;
  color: #ccc;
}
.dmg-pill.crit {
  color: #ffd700;
  border-color: #ffd70055;
}
.pill-crit {
  margin-left: 4px;
  color: #ffd700;
}

.content-detail {
  font-size: 11px;
  color: #888;
}

.content-actor {
  font-size: 10px;
  color: #666;
}

.time-col {
  font-family: 'JetBrains Mono', 'Consolas', monospace;
  font-size: 11px;
  color: #777;
  white-space: nowrap;
}
</style>
