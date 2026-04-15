<script setup>
import { onMounted, onUnmounted, ref, nextTick, computed, watch, provide } from 'vue'
import { useRouter } from 'vue-router'
import { useTimelineStore } from '../stores/timelineStore.js'
import { useShareProject } from '@/composables/useShareProject.js'
import { ElLoading, ElMessage, ElMessageBox } from 'element-plus'
import { snapdom } from '@zumer/snapdom';
import { useI18n } from 'vue-i18n'
import { setLocale } from '@/i18n'

const router = useRouter()

// 组件引入
import TimelineGrid from '../components/TimelineGrid.vue'
import ActionLibrary from '../components/ActionLibrary.vue'
import PropertiesPanel from '../components/PropertiesPanel.vue'
import ResourceMonitor from '../components/ResourceMonitor.vue'
// V1 panels removed: DamageSummaryPanel, LegalityIssuePanel
import AbilityExpansionOverlay from '../components/AbilityExpansionOverlay.vue'
import StatsDetailOverlay from '../components/StatsDetailOverlay.vue'
import ValidationResultDialog from '../components/ValidationResultDialog.vue'

/** Editor mode: 'timeline' | 'abilityExpansion' | 'statsDetail' */
const editorMode = ref('timeline')
provide('openAbilityExpansion', () => { editorMode.value = 'abilityExpansion' })
provide('openStatsDetail', () => { editorMode.value = 'statsDetail' })
provide('editorMode', editorMode)

/** Ability expansion: selected item shared with right sidebar */
const aeSelectedItem = ref(null) // { type: 'skill'|'talent', key, label, icon, description? }
provide('aeSelectedItem', aeSelectedItem)

/** Weapon/equipment selector relay — TimelineGrid registers its functions here,
 *  ActionLibrary (sibling) consumes them via inject. */
const _weaponSelectorFn = ref(() => {})
const _equipmentSelectorFn = ref(() => {})
provide('openWeaponSelector', (...args) => _weaponSelectorFn.value(...args))
provide('openEquipmentSelector', (...args) => _equipmentSelectorFn.value(...args))
provide('_registerWeaponSelector', (fn) => { _weaponSelectorFn.value = fn })
provide('_registerEquipmentSelector', (fn) => { _equipmentSelectorFn.value = fn })

import { addMetadataToPng, readMetadataFromPng } from '../utils/pngUtils.js'

const store = useTimelineStore()
const { t, locale } = useI18n({ useScope: 'global' })
const { copyShareCode, importFromCode } = useShareProject()

const watermarkEl = ref(null)
const watermarkSubText = ref('Created by Endaxis')

function changeLocale(next) {
  setLocale(next)
}

function tryEnterRealisticMode() {
  if (store.timelineEditorMode === 'realistic') return
  // Validate timeline first; block switch if issues found
  store.validateTimeline()
  if (store.validationResult?.passed) {
    store.validationDialogVisible = false
    store.setTimelineEditorMode('realistic')
  }
  // If not passed, validationDialogVisible is already true — dialog shows errors
}

function onHeaderMenuCommand(cmd) {
  if (cmd === 'export') openExportDialog()
  else if (cmd === 'load') triggerImport()
  else if (cmd === 'receive') openImportShareDialog()
  else if (cmd.startsWith('lang-')) changeLocale(cmd.slice(5))
}

// === 方案管理逻辑 ===
const editingScenarioId = ref(null)
const renameInputRef = ref(null)

const currentScenario = computed(() => {
  return store.scenarioList.find(s => s.id === store.activeScenarioId) || store.scenarioList[0]
})

const formatIndex = (index) => {
  return (index + 1).toString().padStart(2, '0')
}

function startRenameCurrent() {
  if (!currentScenario.value) return
  editingScenarioId.value = currentScenario.value.id
  nextTick(() => {
    if (renameInputRef.value) {
      renameInputRef.value.focus()
      renameInputRef.value.select()
    }
  })
}

function finishRename() {
  editingScenarioId.value = null
}

function handleDeleteCurrent() {
  if (!currentScenario.value) return
  handleDeleteScenario(currentScenario.value.id)
}

function handleDeleteScenario(id) {
  ElMessageBox.confirm(
      t('timeline.scenario.deleteConfirm'),
      t('timeline.scenario.deleteTitle'),
      { confirmButtonText: t('common.delete'), cancelButtonText: t('common.cancel'), type: 'warning' }
  ).then(() => {
    store.deleteScenario(id)
    ElMessage.success(t('timeline.scenario.deleted'))
  }).catch(() => {})
}

function handleDuplicateCurrent() {
  if (!currentScenario.value) return
  if (store.scenarioList.length >= store.MAX_SCENARIOS) {
    ElMessage.warning(t('timeline.scenario.limit', { max: store.MAX_SCENARIOS }))
    return
  }
  store.duplicateScenario(currentScenario.value.id)
  ElMessage.success(t('timeline.scenario.duplicated'))
}

function handleAddScenario() {
  if (store.scenarioList.length >= store.MAX_SCENARIOS) {
    ElMessage.warning(t('timeline.scenario.limit', { max: store.MAX_SCENARIOS }))
    return
  }
  store.addScenario()
}

// === 滚动遮罩逻辑 ===
const tabsGroupRef = ref(null)
const tabsMaskStyle = ref({})

function updateScrollMask() {
  const el = tabsGroupRef.value
  if (!el) return

  const tolerance = 2
  const isAtStart = el.scrollLeft <= tolerance
  const isAtEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - tolerance
  const isNoScroll = el.scrollWidth <= el.clientWidth

  if (isNoScroll) {
    tabsMaskStyle.value = { maskImage: 'none', WebkitMaskImage: 'none' }
    return
  }

  const startStr = isAtStart ? 'black 0%' : 'transparent 0px, black 20px'
  const endStr = isAtEnd ? 'black 100%' : 'black calc(100% - 20px), transparent 100%'

  const gradient = `linear-gradient(to right, ${startStr}, ${endStr})`

  tabsMaskStyle.value = {
    maskImage: gradient,
    WebkitMaskImage: gradient
  }
}

watch(() => store.scenarioList.length, async () => {
  await nextTick()
  updateScrollMask()
})

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
  window.addEventListener('resize', updateScrollMask) // 窗口缩放时重算
  nextTick(() => updateScrollMask())
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
  window.removeEventListener('resize', updateScrollMask)
})

// === 文件导入相关 ===
const fileInputRef = ref(null)

function triggerImport() {
  if (fileInputRef.value) fileInputRef.value.click()
}

async function processFile(file) {
  if (!file) return

  try {
    const fileExtension = file.name.split('.').pop().toLowerCase()
    
    if (fileExtension === 'png') {
        const metadata = await readMetadataFromPng(file, 'EndaxisData');
        if (metadata) {
             const success = store.importShareString(metadata);
             if (success) {
                 ElMessage.success(t('timeline.import.pngSuccess'));
                 return true;
             }
        }
        ElMessage.warning(t('timeline.import.pngNoData'));
    } else {
        const success = await store.importProject(file)
        if (success) {
          ElMessage.success(t('timeline.import.projectLoaded'))
          return true
        }
    }
  } catch (e) {
    ElMessage.error(t('timeline.import.failed', { msg: e.message }))
  }
  return false
}

async function onFileSelected(event) {
  const file = event.target.files[0]
  await processFile(file)
  event.target.value = ''
}

// === 拖拽导入逻辑 ===
const isDragging = ref(false)
const isInternalDrag = ref(false)
let dragCounter = 0

function hasFiles(e) {
  if (isInternalDrag.value) return false
  return e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')
}

// 区分内部拖拽和外部拖拽
function onGlobalDragStart(e) {
  isInternalDrag.value = true
}

function onGlobalDragEnd(e) {
  isInternalDrag.value = false
}

function handleWindowDragEnter(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragCounter++
  if (dragCounter === 1) {
    isDragging.value = true
  }
}

function handleWindowDragLeave(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragCounter--
  if (dragCounter === 0) {
    isDragging.value = false
  }
}

function handleWindowDragOver(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
}

async function handleWindowDrop(e) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragCounter = 0
  isDragging.value = false
  
  const file = e.dataTransfer?.files[0]
  if (file) {
    await processFile(file)
  }
}

// === 导出长图相关 ===
const exportDialogVisible = ref(false)
const exportForm = ref({ filename: '', duration: 60 })

function openExportDialog() {
  const dateStr = new Date().toISOString().slice(0, 10)
  exportForm.value.filename = `Endaxis_Timeline_${dateStr}`
  exportForm.value.duration = 60
  exportDialogVisible.value = true
}

function handleExportJson() {
  let rawFilename = exportForm.value.filename || 'Endaxis_Export'
  rawFilename = rawFilename.trim()
  if (rawFilename.toLowerCase().endsWith('.png')) {
    rawFilename = rawFilename.slice(0, -4)
  }
  if (!rawFilename) {
    rawFilename = 'Endaxis_Export'
  }
  let userFilename = rawFilename
  if (!userFilename.toLowerCase().endsWith('.json')) {
    userFilename += '.json'
  }
  store.exportProject({ filename: userFilename })
}

async function processExport() {
  exportDialogVisible.value = false
  const userDuration = exportForm.value.duration
  let rawFilename = exportForm.value.filename || 'Endaxis_Export'
  let userFilename = rawFilename
  if (!userFilename.toLowerCase().endsWith('.png')) userFilename += '.png'

  const durationSeconds = userDuration
  const pixelsPerSecond = store.timeBlockWidth
  const sidebarWidth = 180
  const rightMargin = 50

  const contentWidth = durationSeconds * pixelsPerSecond
  const totalWidth = sidebarWidth + contentWidth + rightMargin

  const loading = ElLoading.service({
    lock: true,
    text: t('timeline.export.rendering', { seconds: durationSeconds }),
    background: 'rgba(0, 0, 0, 0.9)'
  })

  const originalShift = store.timelineShift


  const timelineMain = document.querySelector('.timeline-main')
  const workspaceEl = document.querySelector('.timeline-workspace')
  const gridLayout = document.querySelector('.timeline-grid-layout')
  const scrollers = document.querySelectorAll('.tracks-content-scroller, .chart-scroll-wrapper, .timeline-grid-container')
  const tracksContent = document.querySelector('.tracks-content')
  const settingsScrollArea = document.querySelector('.settings-scroll-area')
  const mainPaths = document.querySelectorAll('path.main-path');
  const pathHoverZones = document.querySelectorAll('path.hover-zone');

  const styleMap = new Map()
  const backupStyle = (el) => { if (el) styleMap.set(el, el.style.cssText) }
  backupStyle(workspaceEl); backupStyle(timelineMain); backupStyle(gridLayout); backupStyle(tracksContent); backupStyle(settingsScrollArea)
  scrollers.forEach(el => backupStyle(el))
  mainPaths.forEach(el => backupStyle(el))
  pathHoverZones.forEach(el => backupStyle(el))

  try {
    store.setTimelineShift(0)
    store.setIsCapturing(true)
    document.body.classList.add('capture-mode')
    scrollers.forEach(el => el.scrollLeft = 0)

    watermarkSubText.value = rawFilename.replace(/\.png$/i, '')
    if (watermarkEl.value) {
      watermarkEl.value.style.display = 'block'
    }

    await new Promise(resolve => setTimeout(resolve, 100))

    if (timelineMain) { timelineMain.style.width = `${totalWidth}px`; timelineMain.style.overflow = 'visible'; }
    if (workspaceEl) { workspaceEl.style.width = `${totalWidth}px`; workspaceEl.style.overflow = 'visible'; }
    if (gridLayout) {
      gridLayout.style.width = `${totalWidth}px`
      gridLayout.style.display = 'grid'
      gridLayout.style.gridTemplateColumns = `${sidebarWidth}px ${contentWidth + rightMargin}px`
      gridLayout.style.overflow = 'visible'
    }
    scrollers.forEach(el => { el.style.width = '100%'; el.style.overflow = 'visible'; el.style.maxWidth = 'none' })

    if (tracksContent) {
      tracksContent.style.width = `${contentWidth}px`
      tracksContent.style.minWidth = `${contentWidth}px`
      const svgs = tracksContent.querySelectorAll('svg')
      svgs.forEach(svg => {
        svg.style.width = `${contentWidth}px`
        svg.setAttribute('width', contentWidth)
      })
    }

    if (settingsScrollArea) {
      settingsScrollArea.style.overflow = 'visible'
    }

    mainPaths.forEach(path => {
      const computed = window.getComputedStyle(path);
      path.style.strokeDasharray = computed.strokeDasharray;
      path.style.stroke = computed.stroke;
      path.style.strokeWidth = computed.strokeWidth;
    })

    pathHoverZones.forEach(path => {
      path.style.display = 'none'
    })

    await new Promise(resolve => setTimeout(resolve, 400))

    const capture = await snapdom(workspaceEl, {
      scale: 1.5,
      width: totalWidth,
      height: workspaceEl.scrollHeight + 20,
    })

    const captureBlob = await capture.toBlob({type: 'png', dpr: 1});
    
    let pngBlob = captureBlob
    
    try {
      // 仅包含当前截图的方案数据
      const shareString = await store.exportShareString({ includeScenarios: store.activeScenarioId });
      // 写入元数据失败不阻止导出
      pngBlob = await addMetadataToPng(captureBlob, 'EndaxisData', shareString);
    } catch (error) {
      console.error(error)
    }
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(pngBlob);
    link.download = userFilename;
    link.click();
    URL.revokeObjectURL(link.href);

    ElMessage.success(t('timeline.export.imageExported', { filename: userFilename }))

  } catch (error) {
    console.error(error)
    ElMessage.error(t('timeline.export.failed', { msg: error.message }))
  } finally {
    document.body.classList.remove('capture-mode')
    store.setIsCapturing(false)
    styleMap.forEach((cssText, el) => el.style.cssText = cssText)
    if (watermarkEl.value) {
      watermarkEl.value.style.display = 'none'
    }
    store.setTimelineShift(originalShift)
    loading.close()
  }
}

// === 重置与快捷键 ===
function handleReset() {
  ElMessageBox.confirm(
      t('timeline.reset.confirm'),
      t('common.warning'),
      {
        confirmButtonText: t('timeline.reset.confirmButton'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
      }
  ).then(() => {
    store.resetProject()
    ElMessage.success(t('timeline.reset.done'))
  }).catch(() => {})
}

// === 接收数据码逻辑 ===
const importShareDialogVisible = ref(false)
const shareCodeInput = ref('')

function openImportShareDialog() {
  shareCodeInput.value = '' // 清空输入框
  importShareDialogVisible.value = true
}

function handleImportShare() {
  const success = importFromCode(shareCodeInput.value)
  if (success) {
    importShareDialogVisible.value = false
    shareCodeInput.value = '' // 成功后清空
  }
}

function handleGlobalKeydown(e) {
  const target = e.target
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return

  // ── Ctrl+S: Manual save (all modes) ──
  if (e.ctrlKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); store.manualSave(); return }

  // ── Realistic mode shortcuts (blocked while warning dialog is active) ──
  if (store.timelineEditorMode === 'realistic' && !store.isWarningActive()) {
    // Shift+Arrow: jump to action boundary
    if (!e.ctrlKey && !e.altKey && e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault()
      const dir = e.key === 'ArrowRight' ? 1 : -1
      const result = store.jumpToActionBoundary(dir)
      if (result?.requiresConfirmation) {
        store.showBlockingRewind(result)
      }
      return
    }
    // Arrow keys: move playhead by step
    if (!e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault()
      const dir = e.key === 'ArrowRight' ? 1 : -1
      const result = store.movePlayheadByStep(dir)
      if (result?.requiresConfirmation) {
        store.showBlockingRewind(result)
      }
      return
    }
    // Up/Down: cycle move step size
    if (!e.ctrlKey && !e.altKey && e.key === 'ArrowUp') { e.preventDefault(); store.cycleMoveStep(1); return }
    if (!e.ctrlKey && !e.altKey && e.key === 'ArrowDown') { e.preventDefault(); store.cycleMoveStep(-1); return }
    // Space: toggle playback
    if (e.key === ' ') { e.preventDefault(); store.togglePlayback(); return }
    // +/= : speed up, -/_ : slow down
    if (e.key === '+' || e.key === '=') { e.preventDefault(); store.cyclePlaybackSpeed(1); return }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); store.cyclePlaybackSpeed(-1); return }
    // 1-4: cast skill of track N
    if (!e.ctrlKey && !e.altKey && e.key >= '1' && e.key <= '4') {
      e.preventDefault()
      store.castSkillByShortcut(Number(e.key) - 1, 'skill')
      return
    }
    // Alt+1-4: cast ultimate of track N
    if (e.altKey && !e.ctrlKey && e.key >= '1' && e.key <= '4') {
      e.preventDefault()
      store.castSkillByShortcut(Number(e.key) - 1, 'ultimate')
      return
    }
    // E: cast link (auto-find available)
    if (!e.ctrlKey && !e.altKey && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault()
      store.castLinkByShortcut()
      return
    }
    // A: basic attack (main control operator only)
    if (!e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault()
      store.castAttackByShortcut()
      return
    }
    // Shift+A: full attack sequence
    if (!e.ctrlKey && !e.altKey && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault()
      store.castFullAttackSequence()
      return
    }
    // Q: cycle main control (1→2→3→4→1)
    if (!e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'q' || e.key === 'Q')) {
      e.preventDefault()
      store.cycleMainControl()
      return
    }
    // F1-F4: switch main control to track N
    if (!e.ctrlKey && !e.altKey && e.key >= 'F1' && e.key <= 'F4') {
      e.preventDefault()
      const trackIdx = Number(e.key.slice(1)) - 1
      const track = store.tracks[trackIdx]
      if (track?.id) store.switchMainControlTo(track.id)
      return
    }
  }

  // ── Global shortcuts (both modes) ──
  if (e.ctrlKey && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); store.undo(); ElMessage.info({ message: t('timeline.shortcut.undo'), duration: 800 }); return }
  if ((e.ctrlKey && (e.key === 'y' || e.key === 'Y')) || (e.ctrlKey && e.shiftKey && (e.key === 'z' || e.key === 'Z'))) { e.preventDefault(); store.redo(); ElMessage.info({message: t('timeline.shortcut.redo'), duration: 800}); return }
  if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); store.copySelection(); ElMessage.success({message: t('timeline.shortcut.copied'), duration: 800}); return }
  if (e.ctrlKey && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); store.pasteSelection(); ElMessage.success({message: t('timeline.shortcut.pasted'), duration: 800}); return }
  if (e.ctrlKey && (e.key === 'g' || e.key === 'G')) { e.preventDefault(); store.toggleCursorGuide(); ElMessage.info({ message: store.showCursorGuide ? t('timeline.shortcut.cursorGuideOn') : t('timeline.shortcut.cursorGuideOff'), duration: 1500 }); return }
  if (e.ctrlKey && (e.key === 'b' || e.key === 'B')) { e.preventDefault(); store.toggleBoxSelectMode(); ElMessage.info({ message: store.isBoxSelectMode ? t('timeline.shortcut.boxSelectOn') : t('timeline.shortcut.boxSelectOff'), duration: 1500 }); return }
  if (e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); store.toggleSnapStep(); const mode = store.snapStep < 0.05 ? t('timeline.shortcut.snapModeFrame') : t('timeline.shortcut.snapMode01'); ElMessage.info({message: t('timeline.shortcut.snapPrecision', { mode }), duration: 1000}); return }
  if (e.altKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); store.toggleConnectionTool(); ElMessage.info({ message: t('timeline.shortcut.connectionTool', { state: store.enableConnectionTool ? t('common.on') : t('common.off') }),  duration: 1000 }); return }
}

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown)
  
  window.addEventListener('dragstart', onGlobalDragStart, true)
  window.addEventListener('dragend', onGlobalDragEnd, true)

  window.addEventListener('dragenter', handleWindowDragEnter)
  window.addEventListener('dragleave', handleWindowDragLeave)
  window.addEventListener('dragover', handleWindowDragOver)
  window.addEventListener('drop', handleWindowDrop)
})

onUnmounted(() => { 
  window.removeEventListener('keydown', handleGlobalKeydown)
  
  window.removeEventListener('dragstart', onGlobalDragStart, true)
  window.removeEventListener('dragend', onGlobalDragEnd, true)

  window.removeEventListener('dragenter', handleWindowDragEnter)
  window.removeEventListener('dragleave', handleWindowDragLeave)
  window.removeEventListener('dragover', handleWindowDragOver)
  window.removeEventListener('drop', handleWindowDrop)
})
</script>

<template>
  <div v-if="store.isLoading" class="loading-screen">
    <div class="loading-content">
      <div class="spinner"></div>
      <p>{{ t('timeline.loading') }}</p>
    </div>
  </div>

  <div v-if="!store.isLoading" class="app-layout" :class="{ 'mode-ability-expansion': editorMode === 'abilityExpansion' }">

    <aside class="action-library"><ActionLibrary/></aside>

    <main class="timeline-main">
      <header class="timeline-header" @click="store.selectTrack(null)">

        <div class="tech-scenario-bar">

          <div class="ts-header-group">

            <button class="ea-btn ea-btn--icon ea-btn--icon-24 ea-btn--ghost ea-btn--no-shrink" @click="startRenameCurrent" :title="t('timeline.scenario.renameTooltip')">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            </button>

            <button class="ea-btn ea-btn--icon ea-btn--icon-24 ea-btn--ghost ea-btn--no-shrink" @click="handleDuplicateCurrent" :title="t('timeline.scenario.duplicateTooltip')">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>

            <button
                v-if="store.scenarioList.length > 1"
                class="ea-btn ea-btn--icon ea-btn--icon-24 ea-btn--ghost ea-btn--hover-danger ea-btn--no-shrink"
                @click="handleDeleteCurrent"
                :title="t('timeline.scenario.deleteTooltip')"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>

            <div class="ts-title-wrapper">
              <div class="ts-deco-bracket">[</div>
              <input
                  v-if="editingScenarioId === currentScenario?.id"
                  ref="renameInputRef"
                  v-model="currentScenario.name"
                  @blur="finishRename"
                  @keydown.enter="finishRename"
                  class="ts-title-input"
              />
              <span v-else class="ts-title-text" @dblclick="startRenameCurrent">
                {{ currentScenario?.name || t('timeline.scenario.unnamed') }}
              </span>
              <div class="ts-deco-bracket">]</div>
            </div>

          </div>

          <div
              class="ts-tabs-group"
              ref="tabsGroupRef"
              :style="tabsMaskStyle"
              @scroll="updateScrollMask"
          >
            <div
                v-for="(sc, index) in store.scenarioList"
                :key="sc.id"
                class="ts-tab-item"
                :class="{ 'is-active': sc.id === store.activeScenarioId }"
                @click="store.switchScenario(sc.id)"
            >
              {{ formatIndex(index) }}
            </div>

            <button
                v-if="store.scenarioList.length < store.MAX_SCENARIOS"
                class="ea-btn ea-btn--icon ea-btn--icon-24 ea-btn--icon-plus ea-btn--no-shrink ts-add-btn"
                @click="handleAddScenario"
                :title="t('timeline.scenario.addTooltip')"
            >+</button>
          </div>

        </div>

        <div class="header-controls">
          <input type="file" ref="fileInputRef" style="display: none" accept=".json,.png" @change="onFileSelected" />

          <button class="ea-btn ea-btn--sm ea-btn--lift ea-btn--hover-blue" @click="store.manualSave()" title="保存 (Ctrl+S)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
            </svg>
          </button>

          <div class="divider-vertical"></div>

          <button
              v-if="store.timelineEditorMode === 'free'"
              class="ea-btn ea-btn--sm ea-btn--lift ea-btn--hover-green"
              @click="store.validateTimeline()"
              title="从 t=0 模拟验证所有技能是否可以施放">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            验证时间轴
          </button>

          <!-- Editor Mode Switch (Free / Realistic) -->
          <div class="editor-mode-switch">
            <button
                class="ea-btn ea-btn--sm mode-switch-btn"
                :class="{ 'is-active': store.timelineEditorMode === 'free' }"
                @click="store.setTimelineEditorMode('free')"
                title="自由摆放技能，无视CD/技力/施放条件">
              自由模式
            </button>
            <button
                class="ea-btn ea-btn--sm mode-switch-btn"
                :class="{ 'is-active': store.timelineEditorMode === 'realistic' }"
                @click="tryEnterRealisticMode"
                title="模拟真实施放，按时间顺序放置技能">
              拟真排轴
            </button>
          </div>

          <div class="divider-vertical"></div>

          <button class="ea-btn ea-btn--sm ea-btn--lift ea-btn--hover-danger-dark" @click="handleReset" :title="t('timeline.header.resetTooltip')">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            {{ t('common.reset') }}
          </button>

          <div class="divider-vertical"></div>

          <!-- Consolidated menu: Export / Load / Receive / Language -->
          <el-dropdown trigger="click" placement="bottom-end" @command="onHeaderMenuCommand">
            <button class="ea-btn ea-btn--sm ea-btn--lift ea-btn--hover-info header-menu-btn" type="button" title="More">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
              </svg>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="export">
                  <span class="menu-item-icon">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M14 3h7v7"/><path d="M10 14L21 3"/><path d="M21 14v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h7"/>
                    </svg>
                  </span>
                  {{ t('common.export') }}
                </el-dropdown-item>
                <el-dropdown-item command="load">
                  <span class="menu-item-icon">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  </span>
                  {{ t('common.load') }}
                </el-dropdown-item>
                <el-dropdown-item command="receive">
                  <span class="menu-item-icon">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                    </svg>
                  </span>
                  {{ t('common.receive') }}
                </el-dropdown-item>
                <el-dropdown-item divided command="lang-zh-CN" :disabled="locale === 'zh-CN'">
                  <span class="menu-item-icon">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20"/><path d="M12 2a15 15 0 0 0 0 20"/>
                    </svg>
                  </span>
                  {{ t('locale.zhCN') }}
                </el-dropdown-item>
                <el-dropdown-item command="lang-en" :disabled="locale === 'en'">
                  <span class="menu-item-icon">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20"/><path d="M12 2a15 15 0 0 0 0 20"/>
                    </svg>
                  </span>
                  {{ t('locale.en') }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <div class="timeline-workspace" style="position: relative;">
        <div class="timeline-grid-container">
          <TimelineGrid/>
        </div>
        <div class="resource-monitor-panel"><ResourceMonitor/></div>

        <!-- Ability Expansion panel: covers timeline grid area, below DamageSummary, above ResourceMonitor -->
        <div v-if="editorMode === 'abilityExpansion'" class="ae-workspace-panel">
          <AbilityExpansionOverlay @close="editorMode = 'timeline'" />
        </div>

        <!-- Stats Detail panel: same overlay area -->
        <div v-if="editorMode === 'statsDetail'" class="ae-workspace-panel">
          <StatsDetailOverlay @close="editorMode = 'timeline'" />
        </div>

        <div class="export-watermark" ref="watermarkEl">
          Endaxis
          <span class="watermark-sub">{{ watermarkSubText }}</span>
        </div>
      </div>
    </main>

    <aside class="properties-sidebar"><PropertiesPanel/></aside>

    <el-dialog v-model="exportDialogVisible" :title="t('timeline.export.dialogTitle')" width="460px" align-center class="custom-dialog">
      <div class="export-form">
        <div class="form-item"><label>{{ t('timeline.export.filenameLabel') }}</label><el-input v-model="exportForm.filename" :placeholder="t('timeline.export.filenamePlaceholder')" size="large"/></div>
        <div class="form-item"><label>{{ t('timeline.export.durationLabel') }}</label><el-input-number v-model="exportForm.duration" :min="10" :max="store.TOTAL_DURATION" :step="10" size="large" style="width: 100%;"/><div class="hint">{{ t('timeline.export.durationHintMax', { max: store.TOTAL_DURATION }) }}</div></div>
      </div>
      <template #footer>
        <span class="dialog-footer">
          <button type="button" class="ea-btn ea-btn--sm ea-btn--lift ea-btn--outline-muted" @click="exportDialogVisible = false">{{ t('common.cancel') }}</button>
          <button type="button" class="ea-btn ea-btn--sm ea-btn--lift ea-btn--fill-success" @click="handleExportJson">{{ t('timeline.export.exportJson') }}</button>
          <button type="button" class="ea-btn ea-btn--sm ea-btn--lift ea-btn--fill-success" @click="copyShareCode">{{ t('timeline.export.copyCode') }}</button>
          <button type="button" class="ea-btn ea-btn--sm ea-btn--lift ea-btn--fill-gold" @click="processExport">{{ t('timeline.export.exportImage') }}</button>
        </span>
      </template>
    </el-dialog>

    <el-dialog
        v-model="importShareDialogVisible"
        :title="t('timeline.import.dialogTitle')"
        width="500px"
        align-center
        class="custom-dialog"
        :append-to-body="true"
    >
      <div class="share-import-container">
        <p class="dialog-hint">{{ t('timeline.import.dialogHint') }}</p>

        <el-alert
            :title="t('timeline.import.dialogAlert')"
            type="warning"
            show-icon
            :closable="false"
            style="margin-bottom: 10px;"
        />

        <el-input
            v-model="shareCodeInput"
            type="textarea"
            :rows="6"
            :placeholder="t('timeline.import.dialogPlaceholder')"
            resize="none"
        />
      </div>
      <template #footer>
      <span class="dialog-footer">
        <button type="button" class="ea-btn ea-btn--sm ea-btn--lift ea-btn--outline-muted" @click="importShareDialogVisible = false">{{ t('common.cancel') }}</button>
        <button type="button" class="ea-btn ea-btn--sm ea-btn--lift ea-btn--fill-gold" @click="handleImportShare">{{ t('timeline.import.dialogConfirm') }}</button>
      </span>
      </template>
    </el-dialog>

    <div v-show="isDragging" class="drop-overlay">
      <div class="drop-content">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="64" height="64">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        <p>{{ t('timeline.import.dropHint') }}</p>
      </div>
    </div>

    <ValidationResultDialog />
  </div>
</template>

<style scoped>
/* App Layout */
.app-layout { display: grid; grid-template-columns: 200px 1fr 250px; grid-template-rows: 100vh; height: 100vh; overflow: hidden; background-color: #2c2c2c; font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
.action-library { background-color: #333; border-right: 1px solid #444; display: flex; flex-direction: column; overflow-y: auto; z-index: 10; }
.timeline-main { display: flex; flex-direction: column; overflow: hidden; background-color: #282828; z-index: 1; border-right: 1px solid #444; }
.properties-sidebar { background-color: #333; overflow: hidden; z-index: 10; }

/* Header */
.timeline-header { height: 50px; flex-shrink: 0; border-bottom: 1px solid #444; background-color: #3a3a3a; display: flex; align-items: center; justify-content: space-between; padding: 0 10px 0 0; cursor: default; user-select: none; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2); }

.header-controls { display: flex; align-items: center; gap: 10px; }
.divider-vertical { width: 1px; height: 20px; background-color: #555; margin: 0 5px; }

/* === 方案选择器样式 === */
.tech-scenario-bar { display: flex; align-items: center; height: 36px; background: linear-gradient(90deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0) 100%); padding: 0 10px; flex: 1; min-width: 0; margin-right: 20px; }

.ts-header-group { display: flex; align-items: center; gap: 4px; position: relative; padding-right: 10px; width: 260px; flex-shrink: 0; overflow: hidden; }

.ts-tabs-group { display: flex; align-items: center; gap: 6px; background: transparent; padding: 0; border-radius: 0; flex-grow: 1; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; -ms-overflow-style: none; }
.ts-tabs-group::-webkit-scrollbar { display: none; }


.ts-title-wrapper { display: flex; align-items: baseline; color: #f0f0f0; font-size: 16px; font-weight: bold; font-family: 'Segoe UI', sans-serif; letter-spacing: 0.5px; margin-left: 4px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ts-deco-bracket { color: #666; font-weight: 300; margin: 0 2px; user-select: none; flex-shrink: 0; }

.ts-title-text { white-space: nowrap; cursor: pointer; border-bottom: 1px dashed transparent; overflow: hidden; text-overflow: ellipsis; }
.ts-title-text:hover { border-bottom-color: #888; }

.ts-title-input { background: transparent; border: none; border-bottom: 1px solid #ffd700; color: #ffd700; font-size: 16px; font-weight: bold; width: 120px; outline: none; padding: 0; }

.ts-tab-item { min-width: 40px; height: 24px; display: flex; align-items: center; justify-content: center; font-family: 'Roboto Mono', monospace; font-size: 12px; font-weight: bold; color: #aaa; background-color: rgba(255, 255, 255, 0.08); border-radius: 4px; cursor: pointer; transition: all 0.2s; user-select: none; flex-shrink: 0; }
.ts-tab-item:hover { background-color: rgba(255, 255, 255, 0.15); color: #fff; }
.ts-tab-item.is-active { background-color: #e0e0e0; color: #222; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }

.ts-add-btn { margin-left: 4px; font-size: 14px; }

/* 按钮组容器 */
.project-btn-group { display: flex; align-items: center; }
.project-btn-group .group-item { position: relative; border-radius: 0; margin-right: -1px; }
.project-btn-group .group-item:first-child { border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
.project-btn-group .group-item:last-child { border-top-right-radius: 4px; border-bottom-right-radius: 4px; margin-right: 0; }
.project-btn-group .group-item:hover { z-index: 2; border-color: currentColor; }

/* Workspace & Panels */
.timeline-workspace { flex-grow: 1; display: flex; flex-direction: column; overflow: hidden; position: relative; }
.timeline-grid-container { flex-grow: 1; overflow: hidden; min-height: 0; }
.resource-monitor-panel { height: 200px; flex-shrink: 0; border-top: 1px solid #444; z-index: 20; background: #252525; }

/* Loading */
.loading-screen { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: #18181c; z-index: 9999; display: flex; align-items: center; justify-content: center; color: #888; font-size: 14px; }
.loading-content { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.spinner { width: 30px; height: 30px; border: 3px solid #333; border-top-color: #ffd700; border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* Export Dialog Styles */
.export-form { display: flex; flex-direction: column; gap: 20px; padding: 10px 0; }
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  width: 100%;
}
.form-item label { display: block; margin-bottom: 8px; font-weight: bold; color: #ccc; }
.hint { font-size: 12px; color: #888; margin-top: 6px; }

.share-import-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dialog-hint {
  color: #888;
  font-size: 12px;
  margin: 0;
}
:deep(.el-textarea__inner) {
  background-color: #1a1a1a;
  box-shadow: inset 0 0 0 1px #333;
  color: #e0e0e0;
  border: none;
  font-family: monospace;
}
:deep(.el-textarea__inner:focus) {
  box-shadow: inset 0 0 0 1px #ffd700;
}
/* === 水印样式 === */
.export-watermark {
  display: none;
  position: absolute;
  top: 20px;
  right: 20px;
  z-index: 9999;
  text-align: right;
  pointer-events: none;
  user-select: none;
  font-family: 'Segoe UI', sans-serif;
  font-size: 24px;
  font-weight: bold;
  color: rgba(255, 255, 255, 0.15);
}

.watermark-sub {
  display: block;
  font-size: 12px;
  opacity: 0.7;
}
/* Dark Mode Adapter for Element Plus Dialog */
:deep(.el-dialog) { background-color: #2b2b2b; border: 1px solid #444; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
:deep(.el-dialog__header) { margin-right: 0; border-bottom: 1px solid #3a3a3a; padding: 15px 20px; }
:deep(.el-dialog__title) { color: #f0f0f0; font-size: 16px; font-weight: 600; }
:deep(.el-dialog__body) { color: #ccc; padding: 25px 25px 10px 25px; }
:deep(.el-dialog__footer) { padding: 15px 25px 20px; border-top: 1px solid #3a3a3a; }
:deep(.el-input__wrapper) { background-color: #1f1f1f; box-shadow: 0 0 0 1px #444 inset; padding: 4px 11px; }
  :deep(.el-input__inner) { color: white; height: 36px; line-height: 36px; }
  :deep(.el-input__wrapper:hover) { box-shadow: 0 0 0 1px #666 inset; }
  :deep(.el-input__wrapper.is-focus) { box-shadow: 0 0 0 1px #ffd700 inset; }

.drop-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.85);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  animation: fadeIn 0.2s ease-in-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.drop-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #ffd700;
  gap: 20px;
  font-size: 24px;
  font-weight: bold;
}
.legality-audit { border-color: #faad14 !important; color: #faad14 !important; }
.legality-strict { border-color: #ff4d4f !important; color: #ff4d4f !important; }

/* Ability Expansion panel: overlays timeline area inside workspace */
.ae-workspace-panel {
  position: absolute;
  top: 0;
  left: 180px; /* track header column width */
  right: 0;
  bottom: 200px; /* above resource-monitor-panel */
  z-index: 30;
  background: #1e2028;
  border-left: 1px solid #444;
  overflow: auto;
}


/* Editor Mode Switch */
.editor-mode-switch {
  display: flex; gap: 0; border-radius: 6px; overflow: hidden;
  border: 1px solid #444;
}
.mode-switch-btn {
  border-radius: 0 !important; border: none !important;
  padding: 4px 10px; font-size: 11px; font-weight: 600;
  background: #333; color: #999; transition: all 0.15s ease;
  cursor: pointer;
}
.mode-switch-btn:hover { background: #3a3a3a; color: #ccc; }
.mode-switch-btn.is-active {
  background: #4a6cf7; color: #fff;
}

.ea-btn--hover-green:hover { border-color: #52c41a; color: #52c41a; }

/* Header menu dropdown */
.header-menu-btn {
  padding: 4px 6px !important;
}
.menu-item-icon {
  display: inline-flex; align-items: center; margin-right: 6px;
  vertical-align: middle;
}
</style>