<script setup>
import { computed, ref, watch } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'

const store = useTimelineStore()

const issues = computed(() => store.sortedLegalityIssues)
const policy = computed(() => store.legalityPolicy)
const isVisible = computed(() => policy.value !== 'sandbox' || issues.value.length > 0)

// --- Collapse (persisted) ---
const LS_KEY = 'endaxis_legality_collapsed'
const collapsed = ref(localStorage.getItem(LS_KEY) === '1')
watch(collapsed, (v) => localStorage.setItem(LS_KEY, v ? '1' : '0'))

// --- View mode ---
const groupMode = ref(false) // false = flat list, true = grouped by code

// --- Filters ---
const filterSeverity = ref('all')
const filterActor = ref('all')

const uniqueActors = computed(() => {
  const set = new Set(issues.value.map(i => i.actorId))
  return [...set].sort()
})

const filteredIssues = computed(() => {
  let list = issues.value
  if (filterSeverity.value === 'blocked') {
    list = list.filter(i => i.resolution === 'blocked')
  } else if (filterSeverity.value !== 'all') {
    list = list.filter(i => i.severity === filterSeverity.value)
  }
  if (filterActor.value !== 'all') {
    list = list.filter(i => i.actorId === filterActor.value)
  }
  return list
})

const errorCount = computed(() => issues.value.filter(i => i.severity === 'error').length)

// --- Grouped view ---
const groupedIssues = computed(() => {
  const map = new Map()
  for (const issue of filteredIssues.value) {
    if (!map.has(issue.code)) {
      map.set(issue.code, { code: issue.code, severity: issue.severity, items: [] })
    }
    const group = map.get(issue.code)
    group.items.push(issue)
    // Escalate group severity
    if (issue.severity === 'error' && group.severity !== 'error') group.severity = 'error'
  }
  return [...map.values()]
})

const collapsedGroups = ref(new Set())
function toggleGroup(code) {
  if (collapsedGroups.value.has(code)) {
    collapsedGroups.value.delete(code)
  } else {
    collapsedGroups.value.add(code)
  }
}

// --- Helpers ---
const severityIcon = { info: 'i', warning: '!', error: '!!' }
const severityClass = (issue) => {
  if (issue.resolution === 'blocked') return 'severity-blocked'
  if (issue.severity === 'error') return 'severity-error'
  if (issue.severity === 'warning') return 'severity-warning'
  return 'severity-info'
}

function onIssueClick(issue) {
  store.selectAction(issue.actionId)
  const el = document.getElementById(`action-${issue.actionId}`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
  }
}

function formatTime(t) {
  return store.formatTimeLabel ? store.formatTimeLabel(t) : t.toFixed(2)
}

function toggleCollapse() {
  collapsed.value = !collapsed.value
}

function cycleSeverityFilter() {
  const cycle = ['all', 'error', 'blocked', 'warning']
  const idx = cycle.indexOf(filterSeverity.value)
  filterSeverity.value = cycle[(idx + 1) % cycle.length]
}

// --- Copy ---
const copyFeedback = ref('')
function copySummary() {
  const list = filteredIssues.value
  if (!list.length) return
  const header = `Legality Report (${policy.value}) — ${list.length} issue(s)`
  const lines = list.map(i =>
    `[${i.severity}] t=${formatTime(i.time)} ${i.actorId} ${i.code}: ${i.message}${i.resolution === 'blocked' ? ' (BLOCKED)' : ''}`
  )
  const text = [header, '—'.repeat(40), ...lines].join('\n')
  navigator.clipboard.writeText(text).then(() => {
    copyFeedback.value = 'Copied!'
    setTimeout(() => { copyFeedback.value = '' }, 1500)
  }).catch(() => {
    copyFeedback.value = 'Failed'
    setTimeout(() => { copyFeedback.value = '' }, 1500)
  })
}
</script>

<template>
  <div v-if="isVisible" class="legality-issue-panel" :class="['policy-' + policy, { 'is-collapsed': collapsed }]">
    <div class="lip-header" @click="toggleCollapse">
      <span class="lip-collapse-arrow">{{ collapsed ? '▸' : '▾' }}</span>
      <span class="lip-title">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="vertical-align: -1px; margin-right: 3px;">
          <path d="M12 2L1 21h22L12 2zm0 4l7.53 13H4.47L12 6zm-1 5v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
        </svg>
        Legality
      </span>
      <span class="lip-badge" :class="'policy-badge-' + policy">{{ policy }}</span>

      <template v-if="!collapsed && issues.length > 0">
        <button class="lip-filter-btn" @click.stop="cycleSeverityFilter"
                :class="{ 'is-active': filterSeverity !== 'all' }">
          {{ filterSeverity === 'all' ? 'All' : filterSeverity }}
        </button>
        <select v-if="uniqueActors.length > 1" class="lip-filter-select" v-model="filterActor" @click.stop>
          <option value="all">All actors</option>
          <option v-for="a in uniqueActors" :key="a" :value="a">{{ a }}</option>
        </select>
        <button class="lip-filter-btn" @click.stop="groupMode = !groupMode"
                :class="{ 'is-active': groupMode }" title="Group by code">
          G
        </button>
        <button class="lip-filter-btn lip-copy-btn" @click.stop="copySummary" title="Copy issue summary">
          {{ copyFeedback || '📋' }}
        </button>
      </template>

      <span class="lip-count" v-if="issues.length > 0">
        <template v-if="filteredIssues.length !== issues.length">{{ filteredIssues.length }}/</template>{{ issues.length }}
        <span v-if="errorCount > 0" class="lip-error-count">{{ errorCount }} err</span>
      </span>
    </div>

    <template v-if="!collapsed">
      <div v-if="filteredIssues.length === 0" class="lip-empty">
        {{ issues.length === 0 ? 'No issues detected.' : 'No issues match filter.' }}
      </div>

      <!-- Grouped view -->
      <div v-else-if="groupMode" class="lip-list">
        <div v-for="group in groupedIssues" :key="group.code" class="lip-group">
          <div class="lip-group-header" :class="'severity-' + group.severity" @click="toggleGroup(group.code)">
            <span class="lip-collapse-arrow">{{ collapsedGroups.has(group.code) ? '▸' : '▾' }}</span>
            <span class="lip-severity">{{ severityIcon[group.severity] || '?' }}</span>
            <span class="lip-code">{{ group.code }}</span>
            <span class="lip-group-count">{{ group.items.length }}</span>
          </div>
          <template v-if="!collapsedGroups.has(group.code)">
            <div v-for="(issue, idx) in group.items" :key="idx"
                 class="lip-item lip-item-grouped" :class="severityClass(issue)"
                 @click="onIssueClick(issue)">
              <span class="lip-time">{{ formatTime(issue.time) }}</span>
              <span class="lip-actor">{{ issue.actorId }}</span>
              <span class="lip-message">{{ issue.message }}</span>
              <span v-if="issue.resolution === 'blocked'" class="lip-resolution">BLOCKED</span>
            </div>
          </template>
        </div>
      </div>

      <!-- Flat view -->
      <div v-else class="lip-list">
        <div v-for="(issue, idx) in filteredIssues" :key="idx"
             class="lip-item" :class="severityClass(issue)"
             @click="onIssueClick(issue)">
          <span class="lip-severity">{{ severityIcon[issue.severity] || '?' }}</span>
          <span class="lip-time">{{ formatTime(issue.time) }}</span>
          <span class="lip-actor">{{ issue.actorId }}</span>
          <span class="lip-code">{{ issue.code }}</span>
          <span class="lip-message">{{ issue.message }}</span>
          <span v-if="issue.resolution === 'blocked'" class="lip-resolution">BLOCKED</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.legality-issue-panel {
  background: #1a1a2e;
  border-top: 1px solid #333;
  font-size: 11px;
  font-family: 'Roboto Mono', monospace;
  max-height: 160px;
  overflow-y: auto;
  flex-shrink: 0;
}
.legality-issue-panel.is-collapsed {
  max-height: none;
  overflow: visible;
}
.policy-audit { border-top-color: #faad14; }
.policy-strict { border-top-color: #ff4d4f; }

.lip-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: rgba(255,255,255,0.04);
  border-bottom: 1px solid #2a2a3e;
  position: sticky;
  top: 0;
  z-index: 1;
  cursor: pointer;
  user-select: none;
}
.lip-header:hover { background: rgba(255,255,255,0.07); }

.lip-collapse-arrow {
  color: #666;
  font-size: 10px;
  width: 10px;
  flex-shrink: 0;
}
.lip-title {
  color: #ccc;
  font-weight: 600;
  font-size: 11px;
}
.lip-badge {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.5px;
}
.policy-badge-sandbox { background: #333; color: #888; }
.policy-badge-audit { background: #3d3000; color: #faad14; }
.policy-badge-strict { background: #3d0000; color: #ff4d4f; }

.lip-filter-btn {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid #444;
  background: transparent;
  color: #888;
  cursor: pointer;
  text-transform: capitalize;
  font-family: inherit;
}
.lip-filter-btn:hover { border-color: #666; color: #ccc; }
.lip-filter-btn.is-active { border-color: #b37feb; color: #b37feb; }
.lip-copy-btn { font-size: 11px; padding: 0 5px; }

.lip-filter-select {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  border: 1px solid #444;
  background: #1a1a2e;
  color: #888;
  cursor: pointer;
  font-family: inherit;
  max-width: 100px;
}

.lip-count {
  color: #888;
  margin-left: auto;
  flex-shrink: 0;
}
.lip-error-count {
  color: #ff4d4f;
  font-weight: 700;
  margin-left: 4px;
}

.lip-empty {
  padding: 8px 10px;
  color: #555;
  text-align: center;
}

.lip-list {
  display: flex;
  flex-direction: column;
}
.lip-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  cursor: pointer;
  transition: background 0.15s;
  border-left: 2px solid transparent;
}
.lip-item-grouped {
  padding-left: 28px;
}
.lip-item:hover {
  background: rgba(255,255,255,0.06);
}
.severity-info { border-left-color: #555; }
.severity-warning { border-left-color: #faad14; }
.severity-error { border-left-color: #ff4d4f; }
.severity-blocked {
  border-left-color: #ff4d4f;
  background: rgba(255,77,79,0.06);
}

.lip-severity {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
  flex-shrink: 0;
}
.severity-warning .lip-severity { background: #3d3000; color: #faad14; }
.severity-error .lip-severity { background: #3d0000; color: #ff4d4f; }
.severity-blocked .lip-severity { background: #ff4d4f; color: #fff; }
.severity-info .lip-severity { background: #222; color: #888; }

.lip-time {
  color: #888;
  min-width: 36px;
  text-align: right;
  flex-shrink: 0;
}
.lip-actor {
  color: #8bb4e0;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}
.lip-code {
  color: #b37feb;
  font-size: 10px;
  flex-shrink: 0;
}
.lip-message {
  color: #aaa;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.lip-resolution {
  color: #ff4d4f;
  font-size: 9px;
  font-weight: 700;
  flex-shrink: 0;
  padding: 0 4px;
  background: rgba(255,77,79,0.15);
  border-radius: 2px;
}

/* Group view */
.lip-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  cursor: pointer;
  user-select: none;
  background: rgba(255,255,255,0.02);
  border-left: 2px solid transparent;
}
.lip-group-header:hover { background: rgba(255,255,255,0.06); }
.lip-group-header.severity-error { border-left-color: #ff4d4f; }
.lip-group-header.severity-warning { border-left-color: #faad14; }
.lip-group-count {
  color: #666;
  font-size: 9px;
  margin-left: auto;
}
</style>
