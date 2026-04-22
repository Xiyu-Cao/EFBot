<script setup>
/**
 * Ability Expansion overlay — covers the main timeline workspace.
 * Left sidebar (operator avatars) and right sidebar (properties) stay visible.
 * Right sidebar shows selected skill/talent detail + level +/- controls.
 */
import { computed, ref, inject, onUnmounted } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'
import wikiIndex from '../external-data/warfarin-wiki/operators/index.json'
import { loadOperator } from '../data/operators/loader.js'

const store = useTimelineStore()
const emit = defineEmits(['close'])

// Shared selection state with right sidebar (provided by TimelineEditor)
const aeSelectedItem = inject('aeSelectedItem', ref(null))

const char = computed(() => store.characterRoster.find(c => c.id === store.activeTrackId))

// New static data (migrated operators only; null fields for others)
const opData = computed(() => loadOperator(store.activeTrackId))

// ---------------------------------------------------------------------------
// Growth state — reads/writes from store (per-track, persisted)
// ---------------------------------------------------------------------------
const growth = computed(() => store.getTrackGrowth(store.activeTrackId))
const currentPromo = computed(() => growth.value.promotion)

const SKILL_LABELS = { attack: '普通攻击', skill: '战技', link: '连携技', ultimate: '终结技' }

function skillUnifiedLevel(sk) {
  return store.skillToUnified(growth.value.skillLevels[sk] || { rank: 9, mastery: 3 })
}
function skillLevelLabel(sk) {
  const u = skillUnifiedLevel(sk)
  return u <= 9 ? `RANK ${u}` : `M${u - 9}`
}
function incSkill(sk) { store.setTrackSkillLevel(store.activeTrackId, sk, skillUnifiedLevel(sk) + 1) }
function decSkill(sk) { store.setTrackSkillLevel(store.activeTrackId, sk, skillUnifiedLevel(sk) - 1) }
function canInc(sk) { return skillUnifiedLevel(sk) < store.skillMaxUnified(currentPromo.value) }
function canDec(sk) { return skillUnifiedLevel(sk) > 1 }

// ---------------------------------------------------------------------------
// Talent level helpers — mirrors skill level pattern, writes to growth.talentLevels
// ---------------------------------------------------------------------------
function talentLevel(talentKey) {
  return store.getTrackTalentLevel(store.activeTrackId, talentKey)
}
function talentMax(talentKey) {
  const t = opData.value.talents?.talents?.find(t => t.id === talentKey)
  return t ? store.getTalentMaxLevel(t, currentPromo.value) : 0
}
function incTalent(talentKey) {
  store.setTrackTalentLevel(store.activeTrackId, talentKey, talentLevel(talentKey) + 1)
  // Refresh right sidebar description
  const t = talents.value.find(t => t.key === talentKey)
  if (t) selectTalent(t)
}
function decTalent(talentKey) {
  store.setTrackTalentLevel(store.activeTrackId, talentKey, talentLevel(talentKey) - 1)
  const t = talents.value.find(t => t.key === talentKey)
  if (t) selectTalent(t)
}
function canIncTalent(talentKey) { return talentLevel(talentKey) < talentMax(talentKey) }
function canDecTalent(talentKey) {
  const t = opData.value.talents?.talents?.find(t => t.id === talentKey)
  // Talents unlocked at E0 cannot be deactivated (min level = 1)
  const minLevel = (t?.unlockStages?.[0] === 0 || t?.stages?.[0]?.promotion === 0) ? 1 : 0
  return talentLevel(talentKey) > minLevel
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------
const ATTACK_ICON_MAP = {
  sword: '/icons/icon_attack_sword.webp', claym: '/icons/icon_attack_claym.webp',
  lance: '/icons/icon_attack_lance.webp', pistol: '/icons/icon_attack_pistol.webp',
  funnel: '/icons/icon_attack_funnel.webp', staff: '/icons/icon_attack_staff.webp',
}

const SKILL_BG_COLORS = {
  blaze: '#e8603a', cold: '#2ec4c4', emag: '#edb200', nature: '#a8d83c', physical: '#555555',
}
const elementColor = computed(() => {
  if (!char.value?.element) return '#8c8c8c'
  return SKILL_BG_COLORS[char.value.element] || '#8c8c8c'
})

const skills = computed(() => {
  if (!char.value) return []
  const sk = opData.value.skills
  return [
    { key: 'attack', label: sk?.attack?.name || '普通攻击', icon: ATTACK_ICON_MAP[char.value.weapon] || ATTACK_ICON_MAP.sword },
    { key: 'skill', label: sk?.skill?.name || '战技', icon: char.value.skill_icon },
    { key: 'link', label: sk?.link?.name || '连携技', icon: char.value.link_icon },
    { key: 'ultimate', label: sk?.ultimate?.name || '终结技', icon: char.value.ultimate_icon },
  ]
})

// ---------------------------------------------------------------------------
// Warfarin wiki data (normalized)
// ---------------------------------------------------------------------------
const normalizedModules = import.meta.glob(
  '../external-data/warfarin-wiki/operators/normalized/*.json',
  { eager: true }
)

const wikiEntry = computed(() => {
  if (!char.value) return null
  const name = char.value.name
  return wikiIndex.find(w =>
    w.name_zh === name || w.name_en === name || w.id === char.value.id?.toUpperCase?.()
  ) || null
})

const wikiNormalized = computed(() => {
  if (!wikiEntry.value?.slug) return null
  const key = `../external-data/warfarin-wiki/operators/normalized/${wikiEntry.value.slug}.json`
  const mod = normalizedModules[key]
  return mod?.default || mod || null
})

// ---------------------------------------------------------------------------
// Main attribute (力量 / 敏捷 / 智识 / 意志)
// ---------------------------------------------------------------------------
const MAIN_ATTR_ICON_MAP = {
  '力量': '/icons/icon_attribute_str.webp',
  '敏捷': '/icons/icon_attribute_agi.webp',
  '智识': '/icons/icon_attribute_wisd.webp',
  '意志': '/icons/icon_attribute_will.webp',
}

const mainAttribute = computed(() => {
  const t = opData.value.talents
  if (t?.mainAttribute?.label) return t.mainAttribute.label
  return wikiNormalized.value?.meta?.main_attribute || null
})
const mainAttributeIcon = computed(() => {
  const t = opData.value.talents
  if (t?.mainAttribute?.icon) return t.mainAttribute.icon
  return MAIN_ATTR_ICON_MAP[mainAttribute.value] || null
})

// Row 1: 4 nodes, all using the operator's main-attribute icon.
// Each corresponds to promotion stage 1-4, with cumulative bonuses.
const ATTR_NODE_NAMES = { '力量': '锤炼', '敏捷': '游刃', '智识': '明晰', '意志': '守誓' }
const row1Nodes = computed(() => {
  const label = mainAttribute.value || '主能力'
  const nodeName = ATTR_NODE_NAMES[label] || label
  const icon = mainAttributeIcon.value
  const promo = growth.value.promotion
  return store.TALENT_ROW1_BONUSES.slice(1).map((bonus, i) => ({
    stage: i + 1,
    icon,
    bonus,
    nodeName,
    active: promo >= i + 1,
    description: `干员${label}能力值提升${bonus}。`,
  }))
})

// ---------------------------------------------------------------------------
// Talent icons (from public/avatars/{ID}/icon_talent_{prefix}_0X.webp)
// ---------------------------------------------------------------------------
const TALENT_ICON_PREFIX = {
  AKEKURI: 'karin', ALESH: 'deepfin', ANTAL: 'antal', ARCLIGHT: 'ikut',
  ARDELIA: 'ardelia', AVYWENNA: 'avywen', CATCHER: 'meurs', CHENQIANYU: 'chen',
  DAPAN: 'dapan', EMBER: 'azrila', ENDMINISTRATOR: 'endmin', ESTELLA: 'whiten',
  FLUORITE: 'bounda', GILBERTA: 'aglina', LAEVATAIN: 'laevat', LASTRITE: 'lastrite',
  LIFENG: 'lifeng', PERLICA: 'pelica', POGRANICHNK: 'pograni', ROSSI: 'wulfa',
  SNOWSHINE: 'aurora', TANGTANG: 'tangtang', WULFGARD: 'wolfgd', XAIHI: 'seraph',
  YVONNE: 'yvonne',
}

function getTalentIcon(charId, index) {
  const prefix = TALENT_ICON_PREFIX[charId]
  if (!prefix) return null
  return `/avatars/${charId}/icon_talent_${prefix}_0${index + 1}.webp`
}

// ---------------------------------------------------------------------------
// Horizontal stage (promotion phase) layout
// Both skills and talents share these column coordinates
// ---------------------------------------------------------------------------
// E1–E3: rank segments (equal-width columns); E4: mastery only (narrower, separate)
const STAGE_SEGMENTS = [
  { label: '精英 1', start: 2, count: 2 },
  { label: '精英 2', start: 4, count: 3 },
  { label: '精英 3', start: 7, count: 3 },
]

// ---------------------------------------------------------------------------
// Parse talent entries from wiki "talents" raw text
// Pattern: 天赋名突破X阶段后可解锁 marks a new talent + its unlock stage
// ---------------------------------------------------------------------------
function parseTalentEntries(rawArr) {
  if (!rawArr?.length) return []
  const text = rawArr.join('')
  const entries = []

  // Pass 1: detect "name默认解锁" (talent unlocked by default, before any promotion)
  const defaultRe = /(?:^|。|\n)([^。\n]*?)默认解锁/g
  let dm
  while ((dm = defaultRe.exec(text)) !== null) {
    const name = dm[1].trim()
    if (name && !entries.find(e => e.name === name)) {
      entries.push({ name, unlockStage: 1, upgradeStage: 2 })
    }
  }

  // Pass 2: detect "name突破X阶段后可解锁/效果提升"
  const re = /(?:^|。|\n)([^。\n]*?)突破(\d)阶段后(可解锁|效果提升)/g
  let m
  while ((m = re.exec(text)) !== null) {
    const name = m[1].trim()
    const stage = parseInt(m[2], 10)
    const type = m[3]
    if (!name) continue
    let entry = entries.find(e => e.name === name)
    if (!entry) {
      entry = { name, unlockStage: null, upgradeStage: null }
      entries.push(entry)
    }
    if (type === '可解锁' && entry.unlockStage === null) entry.unlockStage = stage
    else if (type === '效果提升' && entry.upgradeStage === null) entry.upgradeStage = stage
  }
  return entries
}

const talents = computed(() => {
  const charId = char.value?.id
  if (!charId) return []

  // Priority 1: new static data (talents.json)
  const staticTalents = opData.value.talents?.talents
  if (staticTalents?.length) {
    return staticTalents.map((t, i) => ({
      key: t.id || `talent_${i}`,
      name: t.name,
      icon: t.icon || getTalentIcon(charId, i),
      description: t.stages?.map(s => `[${s.type === 'unlock' ? '解锁' : '强化'}] ${s.description}`).join('\n') || '',
      unlockStages: t.unlockStages || [t.unlockStage ?? (i === 0 ? 1 : 2), t.upgradeStage ?? (i === 0 ? 2 : 3)].filter(v => v != null),
      unlockStage: t.unlockStage,
      upgradeStage: t.upgradeStage,
    }))
  }

  // Priority 2: wiki normalized data
  const wiki = wikiNormalized.value
  const entries = wiki ? parseTalentEntries(wiki.talents) : []
  const rawText = wiki?.talents?.join('') || ''

  if (entries.length > 0) {
    return entries.map((e, i) => ({
      key: `talent_${i}`,
      name: e.name,
      icon: getTalentIcon(charId, i),
      description: rawText,
      unlockStage: e.unlockStage,
      upgradeStage: e.upgradeStage,
    }))
  }

  // Fallback: use exclusive_buffs
  if (char.value?.exclusive_buffs?.length) {
    return char.value.exclusive_buffs.map((b, i) => ({
      key: b.key,
      name: b.name,
      icon: b.path || getTalentIcon(charId, i),
      description: '',
      unlockStage: i + 1,
      upgradeStage: i + 2,
    }))
  }

  return []
})

// ---------------------------------------------------------------------------
// Selection state (skill or talent) — writes to shared aeSelectedItem
// ---------------------------------------------------------------------------
const selectedItem = aeSelectedItem // alias for template readability

function selectSkill(sk) {
  // Build description from new static data if available
  const staticSkill = opData.value.skills?.[sk.key]
  let desc = staticSkill?.description || ''
  // Append current-level multipliers if available
  if (staticSkill?.levelData) {
    const uLevel = skillUnifiedLevel(sk.key)
    const idx = uLevel - 1 // 0-indexed
    const lines = staticSkill.levelData
      .map(row => `${row.label}: ${row.values?.[idx] ?? '—'}`)
      .join('\n')
    if (lines) desc += (desc ? '\n\n' : '') + `── 当前等级 ${staticSkill.levelHeaders?.[idx] || uLevel} ──\n${lines}`
  }
  selectedItem.value = { type: 'skill', key: sk.key, label: staticSkill?.name || sk.label, icon: sk.icon, description: desc }
  // Also trigger right-panel detail via store
  const lib = store.activeSkillLibrary
  const match = lib.find(s => s.type === sk.key || (sk.key === 'attack' && s.type === 'attack'))
  if (match) store.selectLibrarySkill(match.id, 'character')
}

function selectTalent(t) {
  // Show description for the current active level based on promotion
  const promo = growth.value.promotion
  const stages = t.unlockStages || []
  // Current level = how many stages the operator has reached
  let currentLv = 0
  for (const s of stages) { if (promo >= s) currentLv++ }

  // Get the description for the current level from static talent data
  const staticTalent = opData.value.talents?.talents?.find(st => (st.id || '') === t.key)
  const stageDescs = staticTalent?.stages || []
  const desc = currentLv > 0 && stageDescs[currentLv - 1]
    ? stageDescs[currentLv - 1].description
    : (currentLv > 0 ? t.description : '未解锁')

  selectedItem.value = { type: 'talent', key: t.key, label: t.name, icon: t.icon, description: `Lv.${currentLv}/${stages.length}\n${desc}` }
}

function selectMainAttribute() {
  const attr = mainAttribute.value
  const staticT = opData.value.talents
  const subLabel = staticT?.subAttribute?.label
  const promo = growth.value.promotion
  const totalBonus = store.getTalentRow1Bonus(promo)
  const desc = attr
    ? `该干员的主属性为${attr}。` + (subLabel ? `\n副属性为${subLabel}。` : '')
      + (totalBonus ? `\n\n当前精英化${promo}，主能力累计+${totalBonus}。` : '')
    : ''
  selectedItem.value = {
    type: 'talent', key: '_main_attribute',
    label: attr ? `主属性 · ${attr}` : '主属性',
    icon: mainAttributeIcon.value,
    description: desc,
  }
}

function selectRow1Node(node) {
  selectedItem.value = {
    type: 'talent', key: `_row1_e${node.stage}`,
    label: node.nodeName,
    icon: node.icon,
    description: node.description + (node.active ? '\n（已生效）' : '\n（未达到精英化阶段）'),
  }
}

const isSkillSelected = computed(() => selectedItem.value?.type === 'skill')
const isTalentSelected = computed(() => selectedItem.value?.type === 'talent')
const selectedSkillKey = computed(() => isSkillSelected.value ? selectedItem.value.key : null)
// Real talent key (not _main_attribute or _row1_*) for level controls
const selectedTalentKey = computed(() => {
  if (!isTalentSelected.value) return null
  const key = selectedItem.value?.key
  if (!key || key.startsWith('_')) return null
  return talents.value.some(t => t.key === key) ? key : null
})

// Clear shared state when overlay closes
onUnmounted(() => { aeSelectedItem.value = null })

// ---------------------------------------------------------------------------
// Talent map: position helpers (CSS custom-property based, no hardcoded px)
// --e1..--e4 and --scw are defined in CSS on .ae-trow
// ---------------------------------------------------------------------------
function talentLineStyle(fromStage, fromAnchor, toStage, toAnchor) {
  return {
    left:  `calc(var(--e${fromStage}) + var(--scw) * ${fromAnchor})`,
    right: `calc(100% - var(--e${toStage}) - var(--scw) * ${toAnchor})`,
  }
}
function tNodeStyle(anchor) {
  return { marginLeft: `${anchor * 100}%`, transform: 'translateX(-50%)' }
}
</script>

<template>
  <div class="ae-overlay">
    <!-- Top bar -->
    <div class="ae-top-bar">
      <div class="ae-top-title">能力扩展</div>
      <div class="ae-top-char" v-if="char">{{ char.name }} · 精英化 {{ currentPromo }}</div>
      <button class="ae-close-btn" @click="emit('close')">✕ 返回排轴</button>
    </div>

    <!-- Main content: shared horizontal stage grid -->
    <div class="ae-body">
      <div class="ae-content-inner">

        <!-- Stage header (shared columns for skills + talents) -->
        <div class="ae-stage-row ae-stage-header">
          <div class="ae-stage-gutter"></div>
          <div v-for="stage in STAGE_SEGMENTS" :key="stage.label" class="ae-stage-col-hdr">{{ stage.label }}</div>
          <div class="ae-stage-col-hdr">精英 4</div>
        </div>

        <!-- ── Battle skills ── -->
        <div class="ae-section-label">战斗技能</div>

        <div v-for="sk in skills" :key="sk.key"
             class="ae-stage-row ae-skill-row" :class="{ selected: selectedItem?.key === sk.key }"
             @click="selectSkill(sk)">
          <div class="ae-stage-gutter ae-skill-gutter">
            <div class="ae-skill-icon-wrap" :class="sk.key === 'ultimate' ? 'ae-skill-bg-circle' : 'ae-skill-bg-sector'"
                 :style="{ '--el-color': elementColor }">
              <img v-if="sk.icon" :src="sk.icon" class="ae-skill-img" @error="e=>e.target.style.display='none'" />
            </div>
            <div class="ae-skill-rank-text">
              <span class="ae-rank-main">{{ skillUnifiedLevel(sk.key) <= 9 ? 'RANK ' + skillUnifiedLevel(sk.key) : 'M' + (skillUnifiedLevel(sk.key) - 9) }}</span>
              <span class="ae-rank-max">/{{ skillUnifiedLevel(sk.key) <= 9 ? '9' : '3' }}</span>
            </div>
          </div>
          <!-- E1–E3: rank segments -->
          <div v-for="(stage, si) in STAGE_SEGMENTS" :key="si" class="ae-stage-cell">
            <div v-for="seg in stage.count" :key="seg"
                 class="ae-level-seg"
                 :class="{ filled: skillUnifiedLevel(sk.key) >= stage.start + seg - 1 }">
            </div>
          </div>
          <!-- E4: mastery icon -->
          <div class="ae-stage-cell ae-mastery-cell">
            <img :src="skillUnifiedLevel(sk.key) >= 12 ? '/icons/skill-level/mastery-m3.svg'
                     : skillUnifiedLevel(sk.key) >= 11 ? '/icons/skill-level/mastery-m2.svg'
                     : skillUnifiedLevel(sk.key) >= 10 ? '/icons/skill-level/mastery-m1.svg'
                     : '/icons/skill-level/mastery-rank9.svg'" class="ae-mastery-img" />
          </div>
        </div>

        <!-- ── Divider ── -->
        <div class="ae-section-divider"></div>

        <!-- ── Talent array (node map) ── -->
        <div class="ae-section-label">天赋阵列</div>

        <!-- Row 1: 4 main-attribute icons (all same icon), one per stage column -->
        <div class="ae-stage-row ae-trow ae-trow-attr">
          <div class="ae-stage-gutter"></div>
          <div v-for="node in row1Nodes" :key="node.stage"
               class="ae-stage-cell ae-tnode-cell">
            <div class="ae-tnode" :class="{ active: node.active, selected: selectedItem?.key === '_row1_e' + node.stage }"
                 :style="tNodeStyle(0.25)" @click.stop="selectRow1Node(node)">
              <img v-if="node.icon" :src="node.icon" class="ae-tnode-img" @error="e=>e.target.style.display='none'" />
            </div>
          </div>
        </div>

        <!-- Talent rows: dynamically rendered from unlockStages -->
        <template v-for="(talent, ti) in talents" :key="talent.key">
          <div class="ae-stage-row ae-trow ae-trow-talent" @click="selectTalent(talent)">
            <div class="ae-stage-gutter">
              <!-- E0 talent node: rendered in gutter, aligned with skill icons -->
              <template v-if="(talent.unlockStages || [])[0] === 0">
                <div class="ae-tnode ae-tnode-e0"
                     :class="{ active: talentLevel(talent.key) > 0, selected: selectedItem?.key === talent.key }">
                  <img :src="talent.icon" class="ae-tnode-img" @error="e=>e.target.style.display='none'" />
                </div>
              </template>
            </div>
            <div v-for="si in 4" :key="si" class="ae-stage-cell ae-tnode-cell">
              <template v-for="(stage, lvIdx) in (talent.unlockStages || [])" :key="lvIdx">
                <div v-if="stage === si && stage !== 0"
                     class="ae-tnode"
                     :class="{ active: talentLevel(talent.key) > lvIdx, selected: selectedItem?.key === talent.key }"
                     :style="tNodeStyle(0.25)">
                  <img :src="talent.icon" class="ae-tnode-img" @error="e=>e.target.style.display='none'" />
                </div>
              </template>
            </div>
            <!-- Connecting line: style based on talent state -->
            <div v-if="(talent.unlockStages || []).length > 1"
                 class="ae-tline"
                 :class="talentLevel(talent.key) >= (talent.unlockStages || []).length
                   ? 'ae-tline-solid ae-tline-active'
                   : talentLevel(talent.key) > 0
                     ? 'ae-tline-dashed ae-tline-active'
                     : 'ae-tline-dashed'"
                 :style="talentLineStyle(
                   Math.max(1, talent.unlockStages[0]), talent.unlockStages[0] === 0 ? 0 : 0.25,
                   talent.unlockStages[talent.unlockStages.length - 1], 0.25
                 )"></div>
          </div>
        </template>
        <!-- Fallback if no talent 2 -->
        <div v-if="talents.length < 2" class="ae-stage-row ae-trow ae-trow-talent ae-trow-empty">
          <div class="ae-stage-gutter"></div>
          <div v-for="si in 4" :key="si" class="ae-stage-cell ae-tnode-cell"></div>
        </div>

      </div>
    </div>

    <!-- Bottom-right: level +/- controls (skills or talents) -->
    <div v-if="isSkillSelected && selectedSkillKey" class="ae-level-controls">
      <div class="ae-lc-label">{{ selectedItem.label }} · {{ skillLevelLabel(selectedSkillKey) }}</div>
      <div class="ae-lc-buttons">
        <button class="ae-lc-btn" @click="decSkill(selectedSkillKey)" :disabled="!canDec(selectedSkillKey)">−</button>
        <button class="ae-lc-btn" @click="incSkill(selectedSkillKey)" :disabled="!canInc(selectedSkillKey)">+</button>
      </div>
    </div>
    <div v-else-if="selectedTalentKey" class="ae-level-controls">
      <div class="ae-lc-label">{{ selectedItem.label }} · Lv.{{ talentLevel(selectedTalentKey) }}/{{ talentMax(selectedTalentKey) }}</div>
      <div class="ae-lc-buttons">
        <button class="ae-lc-btn" @click="decTalent(selectedTalentKey)" :disabled="!canDecTalent(selectedTalentKey)">−</button>
        <button class="ae-lc-btn" @click="incTalent(selectedTalentKey)" :disabled="!canIncTalent(selectedTalentKey)">+</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ae-overlay {
  background: #1e2028; display: flex; flex-direction: column;
  width: 100%; height: 100%; min-height: 0;
}

/* ── Top bar ── */
.ae-top-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 16px; background: rgba(255,215,0,0.06);
  border-bottom: 1px solid rgba(255,215,0,0.15); flex-shrink: 0;
}
.ae-top-title { font-size: 14px; font-weight: 700; color: #ffd700; }
.ae-top-char { font-size: 11px; color: #999; }
.ae-close-btn {
  margin-left: auto; padding: 4px 12px;
  background: rgba(255,255,255,0.06); border: 1px solid #555;
  color: #ccc; border-radius: 4px; cursor: pointer; font-size: 11px; font-family: inherit;
}
.ae-close-btn:hover { background: rgba(255,255,255,0.12); }

/* ── Body: scrollable in both axes ── */
.ae-body { flex: 1; overflow: auto; padding: 16px; min-height: 0; }

/* Inner content: min-width prevents compression → triggers horizontal scroll */
.ae-content-inner {
  min-width: 700px;
  display: flex; flex-direction: column; gap: 4px;
}

/* ── Shared stage-grid row (header, skill rows, talent rows all share this) ── */
/* Columns: gutter | E1 = E2 = E3 (equal) | E4 (narrower, mastery) */
.ae-stage-row {
  display: grid;
  grid-template-columns: 110px 1fr 1fr 1fr minmax(48px, 0.5fr);
  gap: 0 6px;
  align-items: center;
}

/* Stage header */
.ae-stage-header { margin-bottom: 4px; }
.ae-stage-col-hdr {
  font-size: 10px; color: #666; text-align: center;
  padding: 2px 0; border-bottom: 1px solid rgba(255,255,255,0.08);
  letter-spacing: 0.5px;
}

/* Section labels */
.ae-section-label {
  font-size: 11px; font-weight: 700; color: #888;
  text-transform: uppercase; letter-spacing: 1px;
  padding: 8px 0 4px;
}
.ae-section-divider { border-top: 1px solid rgba(255,255,255,0.06); margin: 8px 0; }

/* ── Gutter (left column: icon + label) ── */
.ae-stage-gutter { display: flex; align-items: center; gap: 6px; min-width: 0; }

/* ── Stage cell (holds level segments or talent unlock marker) ── */
.ae-stage-cell { display: flex; gap: 2px; align-items: center; min-width: 0; }

/* ── Skill rows ── */
.ae-skill-row {
  padding: 5px 0; border-radius: 4px; cursor: pointer;
  transition: background 0.15s; border: 1px solid transparent;
}
.ae-skill-row:hover { background: rgba(255,255,255,0.04); }
.ae-skill-row.selected { background: rgba(255,215,0,0.06); border-color: rgba(255,215,0,0.3); }

.ae-skill-icon-wrap {
  width: 36px; height: 36px; border-radius: 50%; border: 2px solid #555;
  overflow: hidden; background: #111; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
.ae-skill-row.selected .ae-skill-icon-wrap { border-color: #ffd700; }
.ae-skill-img { width: 100%; height: 100%; object-fit: cover; position: relative; z-index: 1; }
.ae-skill-bg-circle { background: var(--el-color, #555); }
.ae-skill-bg-sector { background: conic-gradient(transparent 100deg, var(--el-color, #555) 100deg 240deg, transparent 240deg); }

.ae-skill-rank-text { flex-shrink: 0; white-space: nowrap; }
.ae-rank-main { font-size: 11px; font-weight: 700; color: #e2e8f0; }
.ae-rank-max { font-size: 10px; color: #555; }

/* Level segments (inside stage cells) */
.ae-level-seg {
  flex: 1; height: 6px; border-radius: 1px;
  background: #333; transition: background 0.15s;
}
.ae-level-seg.filled { background: #e2e8f0; }

/* Mastery cell (E4 column in skill rows) */
.ae-mastery-cell { justify-content: center; }
.ae-mastery-img { width: 24px; height: 24px; object-fit: contain; }

/* ── Talent node-map rows ── */
/* CSS custom properties for column positions (relative to row left edge).
   Grid: 110px [gap] 1fr [gap] 1fr [gap] 1fr [gap] 0.5fr
   --scw = width of one 1fr column; --eN = left edge of column N */
.ae-trow {
  position: relative;
  min-height: 48px;
  --gutter: 116px; /* 110px + 6px gap */
  --gaps: 24px;    /* 4 gaps × 6px */
  --scw: calc((100% - var(--gutter) - var(--gaps)) / 3.5);
  --e1: var(--gutter);
  --e2: calc(var(--e1) + var(--scw) + 6px);
  --e3: calc(var(--e2) + var(--scw) + 6px);
  --e4: calc(var(--e3) + var(--scw) + 6px);
}
.ae-trow-talent { cursor: pointer; border: 1px solid transparent; border-radius: 4px; transition: background 0.15s; }
.ae-trow-talent:hover { background: rgba(255,255,255,0.04); }
.ae-trow-empty { cursor: default; }
.ae-trow-empty:hover { background: none; }

/* Row label (in gutter) */
.ae-trow-label { font-size: 11px; color: #888; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ae-trow-label-dim { color: #555; font-style: italic; }
.ae-talent-level { font-size: 10px; color: #666; margin-left: 4px; white-space: nowrap; }

/* Node cell: let nodes position freely via margin */
.ae-tnode-cell { position: relative; min-height: 44px; }

/* Talent node (circular icon) */
.ae-tnode {
  width: 36px; height: 36px; border-radius: 50%;
  border: 2px solid #555; background: #111;
  overflow: hidden; flex-shrink: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: border-color 0.15s;
  position: relative; z-index: 2;
}
.ae-tnode-e0 { margin-left: auto; }
.ae-tnode:hover { border-color: rgba(255,255,255,0.5); }
.ae-tnode.active { background: #c9a80e; border-color: #c9a80e; }
.ae-tnode.selected { border-color: #fff; box-shadow: 0 0 6px rgba(255,255,255,0.4); }
.ae-tnode-img { width: 80%; height: 80%; object-fit: cover; }

/* Connecting lines (absolutely positioned within the row) */
.ae-tline {
  position: absolute;
  top: 50%;
  height: 2px;
  transform: translateY(-50%);
  pointer-events: none;
  z-index: 1;
}
/* Line states: gray dashed (locked) → white dashed (unlocked) → white solid (maxed) */
.ae-tline-dashed {
  background: none; height: 0;
  border-top: 2px dashed rgba(255,255,255,0.2);
}
.ae-tline-dashed.ae-tline-active {
  border-top-color: rgba(255,255,255,0.7);
}
.ae-tline-solid {
  background: rgba(255,255,255,0.7);
}
.ae-tline-solid:not(.ae-tline-active) {
  background: none; height: 0;
  border-top: 2px dashed rgba(255,255,255,0.2);
}


/* ── Bottom-right level controls ── */
.ae-level-controls {
  position: absolute; bottom: 16px; right: 16px;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px; background: rgba(0,0,0,0.7);
  border: 1px solid rgba(255,215,0,0.2); border-radius: 6px;
  z-index: 101;
}
.ae-lc-label { font-size: 11px; color: #ccc; white-space: nowrap; }
.ae-lc-buttons { display: flex; gap: 4px; }
.ae-lc-btn {
  width: 32px; height: 32px; border: 1px solid #666;
  background: #333; color: #fff; border-radius: 4px;
  cursor: pointer; font-size: 18px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.ae-lc-btn:hover:not(:disabled) { background: #555; border-color: #ffd700; }
.ae-lc-btn:disabled { opacity: 0.3; cursor: default; }
</style>
