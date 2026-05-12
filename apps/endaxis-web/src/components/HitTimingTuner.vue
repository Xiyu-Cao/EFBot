<!--
  HitTimingTuner.vue (开发中, feature/hit-timing-override 分支)

  Dev-only dialog: lets the user override per-character hit timings without
  touching the source files. Editable: hit.offset, skill.duration, skill.detach.

  Reads defaults from getRawV2Module(charId) and overrides from
  hitTimingOverrides; writes overrides via the same module's setters.
-->

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { ElDialog, ElButton, ElTabs, ElTabPane, ElInputNumber, ElMessage, ElMessageBox, ElTag, ElInput, ElCollapse, ElCollapseItem } from 'element-plus'
import {
  V2_READY_IDS,
  preloadV2Modules,
  getRawV2Module,
  reapplyV2OverridesToRoster,
} from '@/simulation/v2/characters/adapter'
import {
  getAllOverrides,
  getOverrideForSkill,
  setHitOffsetOverride,
  setSkillDurationOverride,
  setSkillDetachOverride,
  clearOverridesForChar,
  clearAllOverrides,
  exportOverridesJSON,
  importOverridesJSON,
  getSkillTimingWarnings,
  overridesVersion,
} from '@/simulation/v2/hitTimingOverrides'
import { useTimelineStore } from '@/stores/timelineStore.js'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

const visible = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

const store = useTimelineStore()
const ready = ref(false)
const activeChar = ref('')
const importDialogVisible = ref(false)
const importText = ref('')

onMounted(async () => {
  await preloadV2Modules()
  // Pick first ready char by default
  const first = [...V2_READY_IDS][0]
  if (first) activeChar.value = first
  ready.value = true
})

watch(visible, async v => {
  if (v && !ready.value) {
    await preloadV2Modules()
    if (!activeChar.value) activeChar.value = [...V2_READY_IDS][0] || ''
    ready.value = true
  }
})

const charIds = computed(() => [...V2_READY_IDS])

/** Build a flat list of editable skills for a char from its raw module. */
function buildSkillRows(charId) {
  const mod = getRawV2Module(charId)
  if (!mod || !mod.skills) return []
  const out = []
  const push = (skill, group) => {
    if (!skill) return
    out.push({ skill, group })
  }
  for (const s of mod.skills.attack || []) push(s, '普攻 / 处决 / 下落')
  push(mod.skills.skill, '战技')
  if (Array.isArray(mod.skills.link)) {
    mod.skills.link.forEach((l, i) => push(l, `连携技 [${i}]`))
  } else {
    push(mod.skills.link, '连携技')
  }
  push(mod.skills.ultimate, '终结技')
  return out
}

const skillRows = computed(() => buildSkillRows(activeChar.value))

const charLabel = computed(() => {
  const mod = getRawV2Module(activeChar.value)
  return mod?.identity?.name ? `${mod.identity.name} (${activeChar.value})` : activeChar.value
})

// Force the panel to recompute when overrides change.
const _v = computed(() => overridesVersion.value)

function getOffsetOverride(skillId, hitIndex) {
  void _v.value
  const ov = getOverrideForSkill(activeChar.value, skillId)
  return ov?.hitOffsets?.[hitIndex]
}
function getDurationOverride(skillId) {
  void _v.value
  return getOverrideForSkill(activeChar.value, skillId)?.duration
}
function getDetachOverride(skillId) {
  void _v.value
  return getOverrideForSkill(activeChar.value, skillId)?.detach
}

/** Coerce el-input-number value to a valid number, or null if unusable. */
function coerceTiming(value) {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return n
}

function onOffsetChange(skillId, hitIndex, defaultOffset, value) {
  const n = coerceTiming(value)
  if (n === null) {
    setHitOffsetOverride(activeChar.value, skillId, hitIndex, null)
    return
  }
  if (Math.abs(n - defaultOffset) < 1e-6) {
    setHitOffsetOverride(activeChar.value, skillId, hitIndex, null)
    return
  }
  const err = setHitOffsetOverride(activeChar.value, skillId, hitIndex, n)
  if (err) ElMessage.error(`Hit #${hitIndex} offset 拒绝：${err}`)
}
function onDurationChange(skillId, defaultDuration, value) {
  const n = coerceTiming(value)
  if (n === null) {
    setSkillDurationOverride(activeChar.value, skillId, null)
    return
  }
  if (Math.abs(n - defaultDuration) < 1e-6) {
    setSkillDurationOverride(activeChar.value, skillId, null)
    return
  }
  const err = setSkillDurationOverride(activeChar.value, skillId, n)
  if (err) ElMessage.error(`duration 拒绝：${err}`)
}
function onDetachChange(skillId, defaultDetach, value) {
  const n = coerceTiming(value)
  if (n === null) {
    setSkillDetachOverride(activeChar.value, skillId, null)
    return
  }
  if (defaultDetach !== undefined && Math.abs(n - defaultDetach) < 1e-6) {
    setSkillDetachOverride(activeChar.value, skillId, null)
    return
  }
  const err = setSkillDetachOverride(activeChar.value, skillId, n)
  if (err) ElMessage.error(`detach 拒绝：${err}`)
}

/** Compute semantic warnings (soft) for a given skill. Reactive on overridesVersion. */
function getWarnings(skill) {
  void _v.value
  const ov = getOverrideForSkill(activeChar.value, skill.id)
  return getSkillTimingWarnings(skill, ov)
}

const fmtFrames = sec => `${(sec * 60).toFixed(1)}f`
const fmtSec = sec => `${sec.toFixed(4)}s`

function applyAndRevalidate() {
  // Re-apply v2 overrides to the in-memory roster (rewrites legacy fields)
  reapplyV2OverridesToRoster(store.characterRoster)
  // Re-run validation so kernel produces fresh events with new timings
  if (typeof store.validateTimeline === 'function') {
    store.validateTimeline()
  }
  ElMessage.success('已应用：本次校准已写入排轴模拟')
}

async function resetCharacter() {
  if (!activeChar.value) return
  try {
    await ElMessageBox.confirm(
      `重置 ${charLabel.value} 的全部 hit 校准？`,
      '确认',
      { type: 'warning' },
    )
  } catch { return }
  clearOverridesForChar(activeChar.value)
  ElMessage.info('已重置当前角色')
}

async function resetAll() {
  try {
    await ElMessageBox.confirm('重置全部角色的 hit 校准？此操作不可撤销。', '确认', { type: 'warning' })
  } catch { return }
  clearAllOverrides()
  ElMessage.info('已重置全部角色')
}

function exportJSON() {
  const json = exportOverridesJSON()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  a.href = url
  a.download = `endaxis-hit-timing-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  ElMessage.success('已下载 JSON 文件')
}

function openImport() {
  importText.value = ''
  importDialogVisible.value = true
}
function commitImport() {
  const result = importOverridesJSON(importText.value)
  if (!result.ok) {
    ElMessage.error(`导入失败：${result.errors.join('; ')}`)
    return
  }
  if (result.errors.length > 0) {
    ElMessage.warning(`导入完成，但有 ${result.errors.length} 条警告（详见控制台）`)
    console.warn('[HitTimingTuner] import warnings:', result.errors)
  } else {
    ElMessage.success('导入成功')
  }
  importDialogVisible.value = false
}

const stats = computed(() => {
  void _v.value
  const ov = getAllOverrides()
  let chars = 0, hits = 0, durations = 0, detaches = 0
  for (const charOv of Object.values(ov)) {
    chars++
    for (const skOv of Object.values(charOv)) {
      if (skOv.duration !== undefined) durations++
      if (skOv.detach !== undefined) detaches++
      if (skOv.hitOffsets) hits += Object.keys(skOv.hitOffsets).length
    }
  }
  return { chars, hits, durations, detaches }
})
</script>

<template>
  <el-dialog
    v-model="visible"
    title="Hit 校准（开发中）"
    width="900px"
    top="5vh"
    align-center
    destroy-on-close
  >
    <div class="hit-tuner-banner">
      此功能仍在开发中，仅在 <code>feature/hit-timing-override</code> 分支可用。
      修改仅作用于 hit 时间，不会影响伤害效果与触发逻辑。数据保存在浏览器 localStorage。
    </div>

    <div class="hit-tuner-summary">
      <span>当前覆盖：</span>
      <el-tag size="small">{{ stats.chars }} 角色</el-tag>
      <el-tag size="small" type="success">{{ stats.hits }} hit</el-tag>
      <el-tag size="small" type="info">{{ stats.durations }} duration</el-tag>
      <el-tag size="small" type="warning">{{ stats.detaches }} detach</el-tag>
    </div>

    <div class="hit-tuner-actions">
      <el-button type="primary" size="small" @click="applyAndRevalidate">应用到排轴</el-button>
      <el-button size="small" @click="exportJSON">导出 JSON</el-button>
      <el-button size="small" @click="openImport">导入 JSON</el-button>
      <el-button size="small" type="danger" plain @click="resetCharacter">重置当前角色</el-button>
      <el-button size="small" type="danger" plain @click="resetAll">重置全部</el-button>
    </div>

    <el-tabs v-model="activeChar" tab-position="left" class="hit-tuner-tabs">
      <el-tab-pane v-for="id in charIds" :key="id" :label="id" :name="id">
        <div v-if="ready && activeChar === id" class="hit-tuner-pane">
          <div class="hit-tuner-pane-header">{{ charLabel }}</div>
          <el-collapse>
            <el-collapse-item
              v-for="row in skillRows"
              :key="row.skill.id"
              :name="row.skill.id"
            >
              <template #title>
                <span class="skill-title">
                  <span class="skill-group">[{{ row.group }}]</span>
                  <span class="skill-name">{{ row.skill.name }}</span>
                  <span class="skill-id">{{ row.skill.id }}</span>
                  <el-tag
                    v-if="getWarnings(row.skill).length > 0"
                    size="small"
                    type="danger"
                    effect="plain"
                  >⚠ {{ getWarnings(row.skill).length }} 警告</el-tag>
                </span>
              </template>
              <div class="skill-body">
                <div v-if="getWarnings(row.skill).length > 0" class="skill-warnings">
                  <div class="skill-warnings-header">⚠ 语义警告（不阻止保存）</div>
                  <ul>
                    <li v-for="(w, wi) in getWarnings(row.skill)" :key="wi">{{ w }}</li>
                  </ul>
                </div>
                <div class="skill-meta-row">
                  <label>duration（秒）</label>
                  <el-input-number
                    :model-value="getDurationOverride(row.skill.id) ?? row.skill.duration"
                    :min="0"
                    :step="1 / 60"
                    :precision="4"
                    size="small"
                    @change="v => onDurationChange(row.skill.id, row.skill.duration, v)"
                  />
                  <span class="default-hint">
                    默认 {{ fmtSec(row.skill.duration) }} ({{ fmtFrames(row.skill.duration) }})
                  </span>
                  <el-tag v-if="getDurationOverride(row.skill.id) !== undefined" size="small" type="warning">
                    已覆盖
                  </el-tag>
                </div>

                <div v-if="row.skill.detach !== undefined" class="skill-meta-row">
                  <label>detach（秒）</label>
                  <el-input-number
                    :model-value="getDetachOverride(row.skill.id) ?? row.skill.detach"
                    :min="0"
                    :step="1 / 60"
                    :precision="4"
                    size="small"
                    @change="v => onDetachChange(row.skill.id, row.skill.detach, v)"
                  />
                  <span class="default-hint">
                    默认 {{ fmtSec(row.skill.detach) }} ({{ fmtFrames(row.skill.detach) }})
                  </span>
                  <el-tag v-if="getDetachOverride(row.skill.id) !== undefined" size="small" type="warning">
                    已覆盖
                  </el-tag>
                </div>

                <div class="hits-table-wrap">
                  <table class="hits-table">
                    <thead>
                      <tr>
                        <th style="width: 50px;">#</th>
                        <th style="width: 200px;">offset（秒）</th>
                        <th>默认</th>
                        <th>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(hit, hi) in row.skill.hits" :key="hi">
                        <td>{{ hi }}</td>
                        <td>
                          <el-input-number
                            :model-value="getOffsetOverride(row.skill.id, hi) ?? hit.offset"
                            :min="0"
                            :step="1 / 60"
                            :precision="4"
                            size="small"
                            @change="v => onOffsetChange(row.skill.id, hi, hit.offset, v)"
                          />
                        </td>
                        <td>
                          <span class="default-hint">
                            {{ fmtSec(hit.offset) }} ({{ fmtFrames(hit.offset) }})
                          </span>
                        </td>
                        <td>
                          <el-tag v-if="getOffsetOverride(row.skill.id, hi) !== undefined" size="small" type="warning">
                            已覆盖
                          </el-tag>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </el-collapse-item>
          </el-collapse>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog
      v-model="importDialogVisible"
      title="导入 hit 校准 JSON"
      width="640px"
      append-to-body
    >
      <el-input
        v-model="importText"
        type="textarea"
        :rows="14"
        placeholder="把 hit-timing JSON 粘贴在这里…"
      />
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="commitImport">导入</el-button>
      </template>
    </el-dialog>
  </el-dialog>
</template>

<style scoped>
.hit-tuner-banner {
  background: #fff7e6;
  border: 1px solid #ffd591;
  color: #ad6800;
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 12px;
  font-size: 12px;
  line-height: 1.5;
}
.hit-tuner-banner code {
  background: #fff1d6;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
}
.hit-tuner-summary {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
}
.hit-tuner-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.hit-tuner-tabs {
  height: 60vh;
}
.hit-tuner-tabs :deep(.el-tabs__content) {
  height: 100%;
  overflow-y: auto;
}
.hit-tuner-pane-header {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}
.skill-title {
  display: inline-flex;
  gap: 8px;
  align-items: baseline;
}
.skill-group {
  color: #909399;
  font-size: 12px;
}
.skill-name {
  font-weight: 600;
}
.skill-id {
  color: #c0c4cc;
  font-size: 11px;
  font-family: monospace;
}
.skill-body {
  padding: 0 12px 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.skill-meta-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.skill-meta-row label {
  width: 110px;
  color: #606266;
}
.default-hint {
  color: #909399;
  font-size: 11px;
  font-family: monospace;
}
.skill-warnings {
  background: #fef0f0;
  border: 1px solid #fbc4c4;
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  color: #b13030;
}
.skill-warnings-header {
  font-weight: 600;
  margin-bottom: 4px;
}
.skill-warnings ul {
  margin: 0;
  padding-left: 18px;
}
.skill-warnings li {
  line-height: 1.5;
}
.hits-table-wrap {
  margin-top: 4px;
}
.hits-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.hits-table th,
.hits-table td {
  padding: 6px 8px;
  border-bottom: 1px solid #ebeef5;
  text-align: left;
}
.hits-table th {
  background: #f5f7fa;
  color: #606266;
  font-weight: 500;
}
</style>
