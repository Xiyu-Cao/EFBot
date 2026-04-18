<script setup>
import { computed } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'
import { useDragConnection } from '../composables/useDragConnection.js'
import ActionLinkPorts from './ActionLinkPorts.vue'
import { getRectPos } from '@/utils/layoutUtils.js'
import { useI18n } from 'vue-i18n'
import { getBuffIcon } from '@/simulation/data/buffMetadata'

const props = defineProps({
  action: { type: Object, required: true },
})

const store = useTimelineStore()
const connectionHandler = useDragConnection()
const { t } = useI18n({ useScope: 'global' })
const TYPE_SHORTHAND = {
  'attack': 'A', 'dodge': 'D', 'execution': 'X', 'skill': 'C', 'link': 'E', 'ultimate': 'U'
}

const isVariant = computed(() => {
  return props.action.id && props.action.id.includes('_variant_')
})

// Skill status tag (supported / wip / null)
// Hit effect markers: effects that happen during this action's time range, from the same actor
const hitEffectsForAction = computed(() => {
  const all = store.v2HitEffects || []
  const start = props.action.startTime
  const end = start + (props.action.duration || 0)
  // Find which track this action belongs to
  const track = store.tracks.find(t => t.actions?.some(a => a.instanceId === props.action.instanceId))
  const trackId = track?.id || ''
  return all.filter(h => {
    // Match by actionId (trigger hits know their parent action)
    if (h.actionId === props.action.instanceId) return true
    // Match by time range + sourceId must match this action's track
    if (!h.actionId && h.sourceId === trackId && h.time >= start - 0.001 && h.time <= end + 0.001) return true
    return false
  })
})

// Group non-trigger effects by time for vertical stacking above hits
const groupedEffectIcons = computed(() => {
  const effects = hitEffectsForAction.value.filter(h => !h.isTriggerHit)
  const byTime = new Map()
  for (const fx of effects) {
    const key = Math.round(fx.time * 1000) // group by ms
    if (!byTime.has(key)) byTime.set(key, [])
    byTime.get(key).push(fx)
  }
  // Flatten with stack index
  const result = []
  for (const [, group] of byTime) {
    group.forEach((fx, idx) => {
      result.push({ ...fx, stackIndex: idx })
    })
  }
  return result
})

// Trigger hits rendered as tick markers (like regular hits but different color)
const triggerHitTicks = computed(() => {
  return hitEffectsForAction.value.filter(h => h.isTriggerHit)
})

// Resolve effect icon from buffMetadata or iconDatabase
function getEffectIcon(effectType) {
  const fromMeta = getBuffIcon(effectType)
  if (fromMeta) return fromMeta
  return store.iconDatabase?.[effectType] || ''
}

// V1 legality removed — V2 kernel handles validation

// 释放条件命中的结果（如有）
const conditionResult = computed(() => store.computedActionConditionResults.get(props.action.instanceId) || null)

// 命中时的变体技能信息
const resolvedVariantSkill = computed(() => {
  const result = conditionResult.value
  if (!result?.variantId) return null
  // 在所有轨道的库技能中查找
  for (const track of store.tracks) {
    if (!track.id) continue
    const found = store.activeSkillLibrary // 取当前激活轨道库
    break
  }
  // 直接从 characterRoster + variants 里查名字
  for (const track of store.tracks) {
    if (!track.actions.some(a => a.instanceId === props.action.instanceId)) continue
    const charInfo = store.characterRoster.find(c => c.id === track.id)
    if (!charInfo?.variants) return null
    const variantSuffix = result.variantId.replace(`${track.id}_variant_`, '')
    const variant = charInfo.variants.find(v => v.id === variantSuffix)
    return variant || null
  }
  return null
})

const secWidth = computed(() => store.timeBlockWidth)

// Effective type: kernel may convert attack → execution during stagger
const v2EffectiveType = computed(() => {
  const v2Bar = store.v2ActionBars?.get(props.action.instanceId)
  return v2Bar?.skillType || props.action.type
})

const displayLabel = computed(() => {
  const name = resolvedVariantSkill.value?.name || props.action.name || ''
  const type = v2EffectiveType.value
  const width = secWidth.value

  const suffix = (isVariant.value || conditionResult.value) ? '*' : ''

  if (type === 'dodge') {
    return `${TYPE_SHORTHAND[type] || '?'}${suffix}`
  }

  if (type === 'execution') {
    return width >= 30 ? `${t('skillType.execution', '处决')}${suffix}` : `E${suffix}`
  }

  if (props.action.kind === 'attack_segment' || props.action.kind === 'attack_auto_placed') {
    const total = Number(props.action.attackSequenceTotal) || 0
    // Use V2 recalculated segment index if available, otherwise store index
    const v2Idx = store.v2AttackSegments?.get(props.action.instanceId)
    const idx = v2Idx || Number(props.action.attackSequenceIndex) || 0

    if (total > 0 && idx > 0) {
      if (idx === total) {
        const groupName = props.action.attackGroupName || (name ? name.replace(/\s*\d+\s*$/, '') : t('skillType.attack'))
        return `${groupName}${suffix}`
      }
      return `A${idx}${suffix}`
    }
  }

  if (width >= 30) return `${name}${suffix}`
  return `${TYPE_SHORTHAND[type] || '?'}${suffix}`
})

const isSelected = computed(() => store.isActionSelected(props.action.instanceId))

// 幽灵模式：触发窗口 < 0 时仅显示逻辑点，不显示实体框
const isGhostMode = computed(() => (props.action.triggerWindow || 0) < 0)

// 计算主题色
const themeColor = computed(() => {
  if (props.action.customColor) return props.action.customColor
  const effectiveType = v2EffectiveType.value
  if (effectiveType === 'link') return store.getColor('link')
  if (effectiveType === 'execution') return store.getColor('execution')
  if (effectiveType === 'attack') return store.getColor('attack')
  if (effectiveType === 'dodge') return store.getColor('dodge')
  if (props.action.element) return store.getColor(props.action.element)

  let charId = null
  for (const track of store.tracks) {
    if (track.actions.some(a => a.instanceId === props.action.instanceId)) {
      charId = track.id
      break
    }
  }
  if (charId) return store.getCharacterElementColor(charId)
  return store.getColor('default')
})

const actionLayout = computed(() => store.nodeRects[props.action.instanceId])

function getDamageTickTitle(tick) {
  if (!tick) return ''
  return t('actionItem.tickTooltip', {
    time: store.formatTimeLabel(tick.data?.offset),
    stagger: tick.data?.stagger || 0,
    sp: tick.data?.sp || 0,
  })
}

// 连携冷却计算
const effectiveCooldown = computed(() => {
  const baseCd = props.action.cooldown || 0
  if (props.action.type !== 'link') return baseCd
  const track = store.tracks.find(t => t.actions?.some(a => a.instanceId === props.action.instanceId))
  const clamp = (val) => {
    const num = Number(val) || 0
    if (num < 0) return 0
    if (num > 100) return 100
    return num
  }
  const reduction = clamp(track?.linkCdReduction ?? store.systemConstants.linkCdReduction ?? 0)
  return baseCd * (1 - reduction / 100)
})

// 主体样式计算
const style = computed(() => {
  const layout = actionLayout.value
  if (!layout || !layout.rect) {
    return {}
  }
  const { left, width, height } = layout.rect
  const color = themeColor.value

  const priorityBase = isSelected.value ? 10000 : 100;
  const timeWeight = Math.floor((props.action.startTime || 0) * 10);
  const finalZIndex = priorityBase + timeWeight;

  const layoutStyle = {
    position: 'absolute',
    top: '0',
    height: `${height}px`,
    left: `${left}px`,
    width: `${width}px`,
    boxSizing: 'border-box',
    zIndex: finalZIndex,
  }

  if (isGhostMode.value) {
    return {
      ...layoutStyle,
      border: 'none',
      backgroundColor: 'transparent',
      boxShadow: 'none',
      color: 'transparent',
      pointerEvents: isSelected.value ? 'auto' : 'none'
    }
  }

  let borderStyle = ''
  if (isSelected.value) {
    borderStyle = `2px dashed #ffffff`
  } else if (props.action.type === 'attack') {
    borderStyle = `1.5px solid ${hexToRgba(color, 0.4)}`
  } else {
    borderStyle = `2px dashed ${color}`
  }

  if (props.action.type === 'ultimate' && !props.action.isDisabled) {
    return {
      ...layoutStyle,
      border: `1.5px solid ${color}`,
      background: `radial-gradient(circle at center,
      ${hexToRgba(color, 0.5)} 0%,
      ${hexToRgba(color, 0.2)} 70%,
      ${hexToRgba(color, 0.1)} 100%)`,
      boxShadow: `0 0 15px ${hexToRgba(color, 0.5)}`,
      borderRadius: '2px',
      padding: '0 6px',
    }
  }

  if (props.action.type === 'link' && !props.action.isDisabled) {
    return {
      ...layoutStyle,
      border: `1.5px solid ${color}`,
      borderRadius: '2px',
      backgroundColor: hexToRgba(color, 0.15),
      boxShadow: isSelected.value ? `0 0 8px ${color}` : 'none',
      backdropFilter: store.isCapturing ? 'none' : 'blur(4px)',
      color: isSelected.value ? '#ffffff' : color,
    }
  }

  if (props.action.isDisabled) {
    return {
      ...layoutStyle,
      border: `2px dashed #555`,
      backgroundColor: `rgba(40,40,40, 0.3)`,
      color: '#777',
      opacity: 0.6,
      backdropFilter: 'none',
      backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(0,0,0,0.5) 5px, rgba(0,0,0,0.5) 10px)'
    }
  }

  return {
    ...layoutStyle,
    border: borderStyle,
    backgroundColor: hexToRgba(color, 0.15),
    backdropFilter: store.isCapturing ? 'none' : 'blur(4px)',
    color: isSelected.value ? '#ffffff' : color,
    boxShadow: isSelected.value ? `0 0 10px ${color}` : 'none'
  }
})

// 冷却条样式
const cdStyle = computed(() => {
  const layout = actionLayout.value

  if (!layout) {
    return { display: 'none' }
  }

  const start = Number(props.action.startTime) || 0
  const cdVal = effectiveCooldown.value

  if (cdVal <= 0) return { display: 'none' }

  const width = store.timeToPx(start + cdVal) - store.timeToPx(start)
  return {
    width: `${width}px`,
    transform: `translate(${layout.bar.leftEdge}px, ${layout.bar.relativeY}px)`,
    opacity: 0.6
  }
})

// 强化时间样式
const enhancementMetrics = computed(() => {
  const layout = actionLayout.value
  if (!layout) return { widthPx: 0, extensionAmount: 0 }

  const start = Number(props.action.startTime) || 0
  const end = store.getShiftedEndTime(start, props.action.duration || 0, props.action.instanceId)
  const time = Number(props.action.enhancementTime) || 0
  if (time <= 0) return { widthPx: 0, extensionAmount: 0 }

  const ultimateMetrics = (props.action.type === 'ultimate')
      ? store.getUltimateEnhancementMetrics?.(props.action.instanceId)
      : null

  const finalEnd = ultimateMetrics?.finalEnd || store.getShiftedEndTime(end, time, props.action.instanceId)
  const baseDuration = ultimateMetrics?.baseDuration ?? time

  const shiftedEnhDuration = finalEnd - end
  const extensionAmount = Math.round((shiftedEnhDuration - baseDuration) * 1000) / 1000
  const widthPx = store.timeToPx(finalEnd) - store.timeToPx(end)

  return { widthPx, extensionAmount }
})

const enhancementStyle = computed(() => {
  const layout = actionLayout.value

  if (!layout) {
    return { display: 'none' }
  }

  const width = enhancementMetrics.value.widthPx

  return { 
    width: `${width}px`, 
    transform: `translate(${layout.bar.rightEdge}px, ${layout.bar.relativeY}px)`,
    opacity: 0.8 
  }
})

// 触发窗口样式
const triggerWindowStyle = computed(() => {
  const layout = actionLayout.value

  if (!layout || !layout.triggerWindow || !layout.triggerWindow.hasWindow) {
    return { display: 'none' }
  }

  const width = layout.triggerWindow.rect.width
  const color = themeColor.value
  return { 
    '--tw-width': `${width}px`, 
    '--tw-color': color, 
    transform: layout.triggerWindow.localTransform
  }
})

// 自定义时间条
const customBarsToRender = computed(() => {
  const bars = props.action.customBars || []
  return bars.map((bar, index) => {
    const originalDuration = bar.duration || 0
    const originalOffset = bar.offset || 0
    if (originalDuration <= 0) return null

    // 计算起始点的现实偏移
    const shiftedStartTimestamp = store.getShiftedEndTime(props.action.startTime, originalOffset, props.action.instanceId)
    const shiftedOffset = shiftedStartTimestamp - props.action.startTime

    // 计算受时停影响后的结束点，从而得出最终视觉时长
    const shiftedEndTimestamp = store.getShiftedEndTime(shiftedStartTimestamp, originalDuration, props.action.instanceId)
    const shiftedDuration = shiftedEndTimestamp - shiftedStartTimestamp

    // 计算延长量
    const extensionAmount = Math.round((shiftedDuration - originalDuration) * 1000) / 1000

    const base = Number(props.action.startTime) || 0
    const left = (store.timeToPx(shiftedStartTimestamp) - store.timeToPx(base)) - 2
    const width = store.timeToPx(shiftedEndTimestamp) - store.timeToPx(shiftedStartTimestamp)
    const bottomOffset = -24 - (index * 16)

    return {
      style: { width: `${width}px`, left: `${left}px`, bottom: `${bottomOffset}px`, pointerEvents: 'none', opacity: 0.6, zIndex: 5 - index },
      text: bar.text, originalDuration, extensionAmount,
      displayDuration: Number(shiftedDuration.toFixed(1))
    }
  }).filter(item => item !== null)
})

// 计算动画时间的视觉宽度
const animationTimeWidth = computed(() => {
  // 从 Store 的计算结果中找到属于自己的那一项
  const myExtension = store.globalExtensions.find(ext => ext.sourceId === props.action.instanceId)

  if (myExtension) {
    return store.timeToPx(myExtension.time + myExtension.amount) - store.timeToPx(myExtension.time)
  }

  return 0
})

const char = computed(() => {
  const action = store.getActionById(props.action.instanceId)
  let charId = action?.trackId
  return store.characterRoster.find(c => c.id === charId)
})

// 辅助函数
function getEffectColor(type) { return store.getColor(type) }
function getIconPath(type) {
  if (char.value && char.value.exclusive_buffs) {
    const exclusive = char.value.exclusive_buffs.find(b => b.key === type)
    if (exclusive?.path) {
      return exclusive.path
    }
  }
  return store.iconDatabase[type] || store.iconDatabase['default'] || ''
}
function hexToRgba(hex, alpha) {
  if (!hex) return `rgba(255,255,255,${alpha})`
  let c = hex.substring(1).split('');
  if (c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
  c = '0x' + c.join('');
  return 'rgba(' + [(c >> 16) & 255, (c >> 8) & 255, c & 255].join(',') + ',' + alpha + ')'
}

const connectionSourceActionId = computed(() => {
  const node = store.resolveNode(connectionHandler.state.value.sourceId)
  if (!node) {
    return null
  }
  if (node.type === 'action') {
    return node.id
  }
  return node.actionId
})

// 计算判定点的位置样式
// V2 kernel hit positions are authoritative (handles combo variants, interrupts).
// Falls back to compiler-resolved ticks when V2 hasn't run.
const renderableTicks = computed(() => {
  const v2Bar = store.v2ActionBars?.get(props.action.instanceId)

  if (v2Bar?.hitOffsets) {
    const effectiveDuration = v2Bar.displayDuration ?? (v2Bar.endTime - v2Bar.startTime)
    const conditionalSet = new Set(v2Bar.conditionalHits || [])
    return v2Bar.hitOffsets
      .map((offset, idx) => ({ offset, idx }))
      .filter(({ offset }) => !v2Bar.interrupted || offset < effectiveDuration)
      .map(({ offset, idx }) => {
        const left = store.timeToPx(props.action.startTime + offset) - store.timeToPx(props.action.startTime)
        const isConditional = conditionalSet.has(idx)
        return {
          style: { left: `${left}px` },
          data: { offset },
          isConditional,
        }
      })
  }

  const resolvedAction = store.compiledTimeline.actionMap.get(props.action.instanceId)
  return resolvedAction?.resolvedDamageTicks.map(tick => {
      const left = store.timeToPx(tick.realTime) - store.timeToPx(resolvedAction.realStartTime)
      return {
          style: { left: `${left}px` },
          data: tick
      }
  })
})

const renderableAnomalies = computed(() => {
  const _variantForAnom = props.action.kind !== 'attack_segment' ? resolvedVariantSkill.value : null
  const raw = _variantForAnom?.physicalAnomaly !== undefined ? _variantForAnom.physicalAnomaly : (props.action.physicalAnomaly || [])
  if (raw.length === 0) return []
  const rows = Array.isArray(raw[0]) ? raw : [raw]
  const resultRows = []

  let globalFlatIndex = 0

  rows.forEach((row, rowIndex) => {
    row.forEach((effect, colIndex) => {
      const myEffectIndex = globalFlatIndex++
      const effectId = effect._id

      // blaze_to_magma：用本次转化层数的熔火图标；未发生转化则不显示
      let overrideIcon = undefined
      if (effect.type === 'blaze_to_magma') {
        const rawTime = (props.action.startTime || 0) + (Number(effect.offset) || 0)
        const hitTime = Math.round(rawTime * 1000) / 1000
        const event = store.computedConvertEvents.find(ev => ev.time === hitTime)
        if (!event || event.amount <= 0) return
        overrideIcon = getIconPath('magma_' + event.amount)
      }

      const layout = store.effectLayouts.get(effectId)
      if (!layout) return

      resultRows.push({
        data: effect,
        rowIndex,
        colIndex,
        flatIndex: myEffectIndex,
        style: {
          transform: layout.localTransform,
          zIndex: 15 + rowIndex,
        },
        barWidth: layout.barData.width,
        isConsumed: layout.barData.isConsumed,
        displayDuration: layout.barData.displayDuration,
        extensionAmount: layout.barData.extensionAmount,
        effectId: effectId,
        overrideIcon,
      })
    })
  })
  return resultRows
})

const showPorts = computed(() => {
  if (isGhostMode.value) {
    return false
  }
  if (connectionHandler.isDragging.value) {
    if (store.hoveredActionId === props.action.instanceId && props.action.instanceId !== connectionHandler.state.value.sourceId) {
      return true
    }
    return false
  } else if (store.hoveredActionId === props.action.instanceId && connectionHandler.toolEnabled.value) {
    return true
  }
  return false
})

const isActionValidConnectionTarget = computed(() => {
  return connectionHandler.isNodeValid(props.action.instanceId)
})

function onIconClick(evt, item, flatIndex) {
  evt.stopPropagation()
  store.selectAnomaly(props.action.instanceId, item.rowIndex, item.colIndex)
}

function handleConnectionDrop(port) {
  connectionHandler.endDrag(props.action.instanceId, port)
}

function handleConnectionSnap(port, snapPos) {
  if (connectionHandler.isNodeValid(props.action.instanceId)) {
    connectionHandler.snapTo(props.action.instanceId, port, snapPos);
  }
}

function handleActionDragStart(startPos, port) {
  connectionHandler.newConnectionFrom(startPos, props.action.instanceId, port)
}

function handleEffectDragStart(event, effectId) {
  if (!connectionHandler.toolEnabled.value || connectionHandler.isDragging.value) {
    return
  }
  const effectLayout = store.effectLayouts.get(effectId)
  if (!effectLayout) return
  const rect = effectLayout.rect
  const timelinePoint = getRectPos(rect, 'right')
  connectionHandler.newConnectionFrom(timelinePoint, effectId, 'right')
}

function handleEffectSnap(event, effectId) {
  if (!connectionHandler.isNodeValid(effectId)) {
    return
  }
  const effectLayout = store.effectLayouts.get(effectId)
  if (!effectLayout) return
  const rect = effectLayout.rect
  const timelinePoint = getRectPos(rect, 'left')
  connectionHandler.snapTo(effectId, 'left', timelinePoint)
}

function handleEffectDrop(effectId) {
  connectionHandler.endDrag(effectId, 'left')
}
</script>

<template>
  <div :id="`action-${action.instanceId}`" ref="actionElRef" class="action-item-wrapper" :data-id="action.instanceId"
       :class="{ 'is-link-target-invalid': !isActionValidConnectionTarget && connectionSourceActionId !== action.instanceId }"
       @mouseenter="store.setHoveredAction(action.instanceId)"
       @mouseleave="store.setHoveredAction(null)"
       :style="style"
       @click.stop
       @dragstart.prevent>


    <div v-if="!isGhostMode && effectiveCooldown > 0" class="cd-bar-container bottom-bar" :style="cdStyle">
      <div class="cd-line" :style="{ backgroundColor: themeColor }"></div>

      <span class="cd-text" :style="{ color: themeColor }">{{ store.formatTimeLabel(effectiveCooldown) }}</span>

      <div class="cd-end-mark"
           :style="{
         backgroundColor: themeColor,
         zIndex: 1
       }">
      </div>
    </div>

    <div v-if="!isGhostMode && action.type === 'ultimate' && (action.enhancementTime || 0) > 0"
         class="cd-bar-container bottom-bar"
         :style="enhancementStyle">

      <div class="cd-line" style="background-color: #b37feb;"></div>
      <span class="cd-text" style="color: #b37feb;">
        {{ store.formatTimeLabel(action.enhancementTime) }}
        <span v-if="enhancementMetrics.extensionAmount > 0" class="extension-label">
          (+{{ store.formatTimeLabel(enhancementMetrics.extensionAmount) }})
        </span>
      </span>
      <div class="cd-end-mark" style="background-color: #b37feb;"></div>

    </div>

    <template v-if="!isGhostMode">
      <div v-for="(barItem, idx) in customBarsToRender" :key="idx"
           class="custom-blue-bar bottom-bar" :style="barItem.style">
        <div class="cb-line"></div>
        <div class="cb-end-mark"></div>
        <span v-if="barItem.text" class="cb-label">{{ barItem.text }}</span>

        <span class="cb-duration">
          {{ store.formatTimeLabel(barItem.originalDuration) }}
          <span v-if="barItem.extensionAmount > 0" class="extension-label">(+{{ store.formatTimeLabel(barItem.extensionAmount) }})</span>
        </span>
      </div>
    </template>

    <div v-if="!isGhostMode" class="damage-ticks-layer">
      <div v-for="(tick, idx) in renderableTicks" :key="idx"
           class="damage-tick-wrapper"
           :style="tick.style"
           :title="getDamageTickTitle(tick)">
        <div class="tick-marker" :class="{ 'tick-marker--conditional': tick.isConditional }"></div>
      </div>
      <!-- Trigger hits as tick markers (fixed blue, regardless of element). -->
      <div v-for="hit in triggerHitTicks" :key="hit.id"
           class="damage-tick-wrapper"
           :style="{ left: `${store.timeToPx(hit.time) - store.timeToPx(action.startTime)}px` }"
           :title="`${hit.name}${hit.damage ? ' (' + hit.damage + ')' : ''}`">
        <div class="tick-marker tick-marker--trigger"></div>
      </div>
      <!-- Effect icons above hits (stacked vertically) -->
      <div v-for="fx in groupedEffectIcons" :key="fx.id"
           class="hit-effect-marker"
           :style="{ left: `${store.timeToPx(fx.time) - store.timeToPx(action.startTime)}px`, bottom: `calc(100% + ${fx.stackIndex * 18 + 2}px)` }"
           :title="fx.name">
        <div class="hit-effect-icon" :style="{ borderColor: store.getColor(fx.element) || '#999' }">
          <img v-if="getEffectIcon(fx.effectType)" :src="getEffectIcon(fx.effectType)" @error="e=>e.target.style.display='none'" />
          <span v-else class="hit-effect-letter">{{ fx.name?.charAt(0) || '?' }}</span>
        </div>
      </div>
    </div>

    <div v-if="action.triggerWindow && action.triggerWindow !== 0" class="trigger-window-bar bottom-bar" :style="triggerWindowStyle">
      <div class="tw-dot"></div>
      <div class="tw-separator"></div>
    </div>

    <div v-if="conditionResult" class="status-icon condition-met-icon" :title="resolvedVariantSkill?.name || ''">
      <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
        <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"></polygon>
      </svg>
    </div>

    <div v-if="action.isLocked" class="status-icon lock-icon" :title="t('actionItem.lockedTitle')">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
    </div>

    <div v-if="action.isDisabled" class="status-icon mute-icon" :title="t('actionItem.disabledTitle')">
      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
      </svg>
    </div>

    <template v-if="action.type === 'ultimate' && !action.isDisabled">
      <div class="ultimate-side-bar left-bar" :style="{ backgroundColor: themeColor }"></div>
      <div class="ultimate-side-bar right-bar" :style="{ backgroundColor: themeColor }"></div>
    </template>

    <div v-if="!isGhostMode" class="action-item-content drag-handle" :class="{ 'is-link-target-invalid': !isActionValidConnectionTarget && connectionSourceActionId !== action.instanceId }">
      {{ displayLabel }}
      <div v-if="animationTimeWidth > 0"
           class="animation-phase-overlay"
           :style="{ width: `${animationTimeWidth}px` }">
        <div class="shimmer-bar"></div>
      </div>
    </div>

    <ActionLinkPorts @drop="handleConnectionDrop" @snap="handleConnectionSnap"
                     @drag-start="handleActionDragStart" @clear-snap="connectionHandler.clearSnap"
                     :isDragging="connectionHandler.isDragging.value"
                     :disabled="!isActionValidConnectionTarget"
                     :canStart="connectionHandler.toolEnabled.value"
                     :rect="store.nodeRects[action.instanceId]?.rect"
                     v-if="showPorts"
                     :color="themeColor" />

    <div v-if="!isGhostMode" class="anomalies-overlay">
      <div v-for="(item, index) in renderableAnomalies" :key="`${item.rowIndex}-${item.colIndex}`"
           class="anomaly-wrapper" :style="item.style" :data-id="item.effectId">

        <div :id="item.effectId"
             class="anomaly-icon-box"
             :class="{ 'is-linking': connectionHandler.isDragging.value, 'is-link-target-valid': connectionHandler.isNodeValid(item.data._id) }"
             @mousedown.stop="handleEffectDragStart($event, item.data._id)"
             @mouseover.stop="handleEffectSnap($event, item.data._id)"
             @mouseup.stop="handleEffectDrop(item.data._id)"
             @mouseleave="connectionHandler.clearSnap()"
             @click.stop="onIconClick($event, item, index)">

          <img :src="item.overrideIcon !== undefined ? item.overrideIcon : getIconPath(item.data.type)" class="anomaly-icon" />
          <div v-if="item.data.stacks > 1" class="anomaly-stacks">{{ item.data.stacks }}</div>
        </div>

        <div class="anomaly-duration-bar"
           v-if="!item.data.hideDuration"
           :style="{width: `${item.barWidth}px`,backgroundColor: getEffectColor(item.data.type),display: (item.displayDuration > 0 || item.data.duration > 0 || item.isConsumed) ? 'flex' : 'none'}"
           :class="{ 'is-consumed-bar': item.isConsumed }">

          <div class="striped-bg"></div>
          <span class="duration-text">
            {{ store.formatTimeLabel(item.isConsumed ? item.displayDuration : item.data.duration) }}
            <span v-if="!item.isConsumed && item.extensionAmount > 0" class="extension-label">
              (+{{ store.formatTimeLabel(item.extensionAmount) }})
            </span>
          </span>

          <div v-if="item.isConsumed"
               :id="`${item.effectId}_transfer`"
               class="transfer-node-wrapper">
            <div class="transfer-node"></div>
            <div class="transfer-line"></div>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* === 基础容器 === */
.action-item-wrapper {
  display: flex; align-items: center; justify-content: center;
  white-space: nowrap; cursor: grab; user-select: none;
  position: relative; overflow: visible;
  transition: background-color 0.2s, box-shadow 0.2s, filter 0.2s;
  font-weight: bold; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}
.action-item-wrapper:hover { filter: brightness(1.2); }

/* === 异常状态层 === */
.anomalies-overlay { position: absolute; top: 0; left: -1px; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.anomaly-wrapper { position: absolute; display: flex; align-items: center; pointer-events: none; white-space: nowrap; bottom: 100% }

/* 图标样式 */
.anomaly-icon-box {
  width: 20px; height: 20px; background-color: #333; border: 1px solid #999;
  box-sizing: border-box; display: flex; align-items: center; justify-content: center;
  position: relative; z-index: 10; flex-shrink: 0; pointer-events: auto; cursor: pointer;
  transition: transform 0.1s, border-color 0.1s, box-shadow 0.2s;
}
.anomaly-icon-box:hover { border-color: #ffd700; transform: scale(1.2); z-index: 20; }
.anomaly-icon-box.is-linking {
  opacity: 0.5;
  pointer-events: none;
}
.anomaly-icon-box.is-linking.is-link-target-valid {
  opacity: 1;
  pointer-events: auto;
  border-color: #fff; box-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
  transform: scale(1.1); animation: pulse-target 1s infinite; z-index: 100;
}
@keyframes pulse-target {
  0% { box-shadow: 0 0 0 rgba(255,255,255,0.4); } 70% { box-shadow: 0 0 10px rgba(255,255,255,0); } 100% { box-shadow: 0 0 0 rgba(255,255,255,0); }
}
.anomaly-icon { width: 100%; height: 100%; object-fit: cover; }
.anomaly-stacks {
  position: absolute; bottom: -2px; right: -2px; background: rgba(0, 0, 0, 0.8);
  color: #ffd700; font-size: 8px; padding: 0 2px; line-height: 1; border-radius: 2px;
}

.status-icon {
  position: absolute;
  top: 2px;
  font-size: 10px;
  z-index: 25;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.8));
  pointer-events: none;
}
.lock-icon {
  left: 2px;
}
.mute-icon {
  right: 2px;
}
.condition-met-icon {
  right: 2px;
  color: #ffd700;
}
.legality-badge {
  left: 2px;
  bottom: 2px;
  top: auto;
  color: #faad14;
  pointer-events: auto;
  cursor: help;
}
.legality-error {
  color: #ff4d4f;
}
.legality-audit {
  color: #faad14;
  filter: drop-shadow(0 0 3px rgba(250,173,20,0.6));
}
.legality-blocked {
  color: #ff4d4f;
  animation: legality-pulse 1.5s ease-in-out infinite;
}
@keyframes legality-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.action-item-content {
  &.is-link-target-invalid {
    opacity: 0.5;
  }
}
.skill-wip-tag, .skill-unsupported-tag {
  display: inline-block;
  font-size: 7px;
  padding: 0 3px;
  margin-left: 3px;
  border-radius: 2px;
  font-weight: 700;
  vertical-align: middle;
  line-height: 1.4;
  letter-spacing: 0.3px;
  pointer-events: none;
}
.skill-wip-tag {
  background: rgba(250, 173, 20, 0.25);
  color: #faad14;
}
.skill-unsupported-tag {
  background: rgba(255, 77, 79, 0.2);
  color: #ff7875;
}

/* 伤害节点样式 */
.damage-ticks-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 12;
}

.damage-tick-wrapper {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 12px;
  margin-left: -6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  pointer-events: auto;
  z-index: 20;
}

/* Hit effect icons (buff/attachment/anomaly applied at hit position) */
.hit-effect-marker {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translateX(-8px);
  pointer-events: auto;
  cursor: pointer;
  z-index: 25;
}
.hit-effect-icon {
  width: 16px;
  height: 16px;
  border: 1.5px solid #999;
  border-radius: 3px;
  background: #222;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.hit-effect-icon img {
  width: 14px;
  height: 14px;
  object-fit: cover;
}
.hit-effect-letter {
  font-size: 8px;
  font-weight: 700;
  color: #ccc;
}

.tick-marker {
  width: 6px;
  height: 6px;
  background-color: #ff4d4f;
  border: 1px solid #333;
  transform: translateY(50%) rotate(45deg);
  box-shadow: 0 1px 2px rgba(0,0,0,0.5);
  transition: all 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

/* Hit fired at least one condition-gated effect (e.g. 黎风战技对无破防敌人额外施加物理脆弱). */
.tick-marker--conditional {
  background-color: #ffd666;
  box-shadow: 0 0 4px rgba(255, 214, 102, 0.7);
}

/* Trigger-produced追加伤害 — fixed blue regardless of element. */
.tick-marker--trigger {
  background-color: #4fc3f7;
}

.damage-tick-wrapper:hover .tick-marker {
  background-color: #ffd700;
  border-color: #fff;
  transform: translateY(50%) rotate(45deg) scale(2.0);
  box-shadow: 0 0 8px rgba(255, 215, 0, 1);
  z-index: 30;
}

/* === 时长条样式 === */
.anomaly-duration-bar {
  height: 16px; border: none; border-radius: 2px; position: relative;
  display: flex; align-items: center; overflow: visible;
  box-sizing: border-box; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  z-index: 1; margin-left: 2px;
}
.is-consumed-bar { opacity: 0.95; border-right: none; }
.striped-bg {
  position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 1;
  background: repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.2) 2px, transparent 2px, transparent 6px);
}
.duration-text {
  position: absolute; left: 4px; font-size: 11px; color: #fff;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8); z-index: 2; font-weight: bold; line-height: 1; font-family: sans-serif;
}

/* === 被消耗节点 === */
.transfer-node-wrapper {
  position: absolute; right: -6px; top: 50%; transform: translateY(-50%);
  width: 12px; height: 12px; display: flex; align-items: center; justify-content: center;
  z-index: 20; pointer-events: none;
}
.transfer-node {
  width: 6px; height: 6px; background-color: #fff; border: 1px solid #ffd700;
  transform: rotate(45deg); box-shadow: 0 0 4px #ffd700, 0 0 8px rgba(255, 215, 0, 0.6);
  position: relative; z-index: 2;
}
.transfer-line {
  position: absolute;
  width: 2px;
  height: 14px;
  background-color: #fff;
  border-radius: 1px;
  box-shadow: 0 0 2px rgba(0,0,0,0.5);
  z-index: 1;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}

/* === 其他样式 === */
.bottom-bar { 
  bottom: 0;
  left: 0;
  position: absolute;
 }

.cd-bar-container { position: absolute; height: 2px; display: flex; align-items: center; pointer-events: none; }
.cd-line { flex-grow: 1; height: 2px; }
.cd-text { position: absolute; left: 0; top: 4px; font-size: 10px; font-weight: bold; line-height: 1; }
.cd-end-mark { position: absolute; right: 0; top: 50%; transform: translateY(-50%); width: 1px; height: 8px; }

.custom-blue-bar { height: 2px; display: flex; align-items: center; color: #69c0ff; z-index: 5; }
.cb-line { flex-grow: 1; height: 2px; background-color: #69c0ff; }
.cb-label {
  position: absolute; right: 100%; margin-right: 6px; top: 50%; transform: translateY(-50%);
  font-size: 10px; font-weight: bold; white-space: nowrap; line-height: 1; color: #69c0ff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.8);
}
.cb-duration { position: absolute; left: 0; top: 4px; font-size: 10px; font-weight: bold; line-height: 1; color: #69c0ff; display: flex; align-items: center; }
.cb-end-mark { position: absolute; right: 0; width: 1px; height: 8px; background-color: #69c0ff; top: 50%; transform: translateY(-50%); }

.trigger-window-bar {
  position: absolute; --tw-width: 0px; --tw-color: transparent;
  width: var(--tw-width); height: 2px;
  display: flex; align-items: center; pointer-events: auto; cursor: pointer; z-index: 5;
}
.trigger-window-bar::after { content: ''; position: absolute; top: -4px; bottom: -4px; left: 0; right: 0; background: transparent; }
.trigger-window-bar::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%); height: 2px; background-color: var(--tw-color); opacity: 1; border-radius: 2px 0 0 2px; }
.tw-separator { position: absolute; right: 0; top: -2px; width: 1px; height: 8px; background-color: var(--tw-color); transform: translateX(50%); }
.tw-dot { position: absolute; left: 0; top: 50%; width: 1px; height: 8px; background-color: var(--tw-color); border-radius: 0; z-index: 6; transform: translate(-50%, -50%); }

.ultimate-side-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 4px;
  z-index: 2;
  pointer-events: none;
}

.left-bar {
  left: 0;
  border-radius: 2px 0 0 2px;
}

.right-bar {
  right: 0;
  border-radius: 0 2px 2px 0;
}

.animation-phase-overlay {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  max-width: calc(100% - 1px);
  pointer-events: none;
  overflow: hidden;
  border-right: 1px solid rgba(255, 255, 255, 0.3);
  z-index: 1;
}

.shimmer-bar {
  position: absolute;
  inset: 0;
  width: 200%;
  background: linear-gradient(
    90deg, 
    rgba(255, 255, 255, 0) 0%, 
    rgba(255, 255, 255, 0.15) 50%, 
    rgba(255, 255, 255, 0) 100%
  );
  will-change: transform;
  animation: shimmer 1.5s infinite linear;
}

@keyframes shimmer {
  0% { 
    transform: translateX(-100%); 
  }
  100% { 
    transform: translateX(50%); 
  }
}
</style>