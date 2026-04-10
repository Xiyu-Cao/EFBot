<script setup>
import { computed } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'

const store = useTimelineStore()

const visible = computed({
  get: () => store.validationDialogVisible,
  set: (v) => { store.validationDialogVisible = v }
})

const result = computed(() => store.validationResult)
const passed = computed(() => result.value?.passed ?? false)
const hasError = computed(() => result.value?.error)

const ISSUE_CODE_LABELS = {
  ISSUE_SP_INSUFFICIENT: '技力不足',
  ISSUE_GAUGE_INSUFFICIENT: '能量不足',
  ISSUE_COOLDOWN_ACTIVE: '冷却中',
  ISSUE_CONDITION_NOT_MET: '施放条件未满足',
  ISSUE_GLOBAL_ACTION_LOCK: '行动锁定',
}

function translateCode(code) {
  return ISSUE_CODE_LABELS[code] || code
}

function formatTime(t) {
  return `${t.toFixed(1)}s`
}

// Group issues by actorId
const groupedIssues = computed(() => {
  if (!result.value?.issues?.length) return []
  const map = new Map()
  for (const issue of result.value.issues) {
    if (!map.has(issue.actorId)) {
      map.set(issue.actorId, {
        actorId: issue.actorId,
        actorName: getActorName(issue.actorId),
        color: getActorColor(issue.actorId),
        issues: [],
      })
    }
    map.get(issue.actorId).issues.push(issue)
  }
  return [...map.values()]
})

function getActorName(actorId) {
  const track = store.tracks.find(t => t.id === actorId)
  if (!track) return actorId
  const charInfo = store.characterRoster?.find(c => c.id === actorId)
  return charInfo?.name || actorId
}

function getActorColor(actorId) {
  return store.getCharacterElementColor?.(actorId) || '#999'
}

function getActionName(issue) {
  const entry = store.actionMap?.get(issue.actionId)
  return entry?.action?.name || issue.actionId
}

function goToAction(issue) {
  store.selectAction(issue.actionId)
  visible.value = false
}
</script>

<template>
  <el-dialog v-model="visible" title="时间轴验证结果" width="520px" :close-on-click-modal="true" append-to-body>

    <!-- Success -->
    <div v-if="passed && !hasError" class="validation-success">
      <div class="success-icon">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#52c41a" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="8 12 11 15 16 9"/>
        </svg>
      </div>
      <div class="success-text">通过测试</div>
      <div class="success-sub">所有技能均可正常施放</div>
    </div>

    <!-- Runtime Error -->
    <div v-else-if="hasError" class="validation-error">
      <div class="error-text">模拟运行出错</div>
      <div class="error-detail">{{ result.error }}</div>
    </div>

    <!-- Issues Found -->
    <div v-else class="validation-issues">
      <div class="issues-summary">
        发现 {{ result?.issues?.length || 0 }} 个问题
      </div>

      <div class="issues-list">
        <div v-for="group in groupedIssues" :key="group.actorId" class="issue-group">
          <div class="group-header" :style="{ color: group.color }">
            {{ group.actorName }}
          </div>
          <div
              v-for="issue in group.issues"
              :key="issue.actionId + issue.code"
              class="issue-item"
              @click="goToAction(issue)">
            <span class="issue-action-name">{{ getActionName(issue) }}</span>
            <span class="issue-reason">{{ translateCode(issue.code) }}</span>
            <span class="issue-time">{{ formatTime(issue.time) }}</span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <button class="ea-btn ea-btn--sm" @click="visible = false">关闭</button>
    </template>
  </el-dialog>
</template>

<style scoped>
.validation-success {
  display: flex; flex-direction: column; align-items: center;
  padding: 24px 0;
}
.success-icon { margin-bottom: 12px; }
.success-text { font-size: 20px; font-weight: 700; color: #52c41a; }
.success-sub { font-size: 12px; color: #999; margin-top: 4px; }

.validation-error {
  padding: 16px 0; text-align: center;
}
.error-text { font-size: 16px; font-weight: 600; color: #ff4d4f; margin-bottom: 8px; }
.error-detail { font-size: 11px; color: #999; font-family: monospace; word-break: break-all; }

.validation-issues { }
.issues-summary {
  font-size: 13px; font-weight: 600; color: #ff7875;
  padding-bottom: 8px; border-bottom: 1px solid #3a3a3a;
  margin-bottom: 8px;
}
.issues-list {
  max-height: 360px; overflow-y: auto;
}
.issue-group { margin-bottom: 12px; }
.group-header {
  font-size: 12px; font-weight: 700; padding: 4px 0;
  border-bottom: 1px solid #333;
}
.issue-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; border-radius: 4px;
  cursor: pointer; font-size: 11px;
  transition: background 0.1s;
}
.issue-item:hover { background: #333; }
.issue-action-name { flex: 1; color: #ddd; font-weight: 500; }
.issue-reason {
  color: #ff7875; font-weight: 600;
  padding: 1px 6px; border-radius: 3px;
  background: rgba(255, 77, 79, 0.1);
  font-size: 10px;
}
.issue-time {
  color: #888; font-family: monospace; font-size: 10px;
  min-width: 40px; text-align: right;
}
</style>
