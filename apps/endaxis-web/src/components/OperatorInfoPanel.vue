<script setup>
import { computed, ref, inject } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'
import CustomNumberInput from './CustomNumberInput.vue'
import wikiIndex from '../external-data/warfarin-wiki/operators/index.json'
import { loadOperator } from '../data/operators/loader.js'
import EndaxisStageIcon from './EndaxisStageIcon.vue'

const store = useTimelineStore()

const activeTrack = computed(() => store.tracks.find(t => t.id === store.activeTrackId))
const char = computed(() => store.characterRoster.find(c => c.id === store.activeTrackId))

// ---------------------------------------------------------------------------
// Level / Promotion — backed by store (per-track, persisted)
// ---------------------------------------------------------------------------
const growth = computed(() => store.getTrackGrowth(store.activeTrackId))
const currentPromo = computed({
  get: () => growth.value.promotion,
  set: (v) => store.setTrackPromotion(store.activeTrackId, v),
})
const currentLevel = computed({
  get: () => growth.value.characterLevel,
  set: (v) => store.setTrackCharacterLevel(store.activeTrackId, v),
})
const levelMin = computed(() => currentPromo.value > 0 ? store.PROMO_CAPS[currentPromo.value - 1] : 1)
const levelMax = computed(() => store.PROMO_CAPS[currentPromo.value])

// ---------------------------------------------------------------------------
// Ability expansion settings
// ---------------------------------------------------------------------------
const gaugeEffValue = computed({
  get: () => activeTrack.value ? Math.round((activeTrack.value.gaugeEfficiency ?? 100) * 1000) / 1000 : 100,
  set: (v) => store.activeTrackId && store.updateTrackGaugeEfficiency(store.activeTrackId, Math.round(v * 1000) / 1000)
})
const linkCdRedValue = computed({
  get: () => activeTrack.value ? (activeTrack.value.linkCdReduction ?? 0) : 0,
  set: (v) => store.activeTrackId && store.updateTrackLinkCdReduction(store.activeTrackId, v)
})
const artsPowerValue = computed({
  get: () => activeTrack.value ? (activeTrack.value.originiumArtsPower ?? 0) : 0,
  set: (v) => store.activeTrackId && store.updateTrackOriginiumArtsPower(store.activeTrackId, v)
})
const initialGaugeVal = computed({
  get: () => activeTrack.value ? (activeTrack.value.initialGauge || 0) : 0,
  set: (v) => store.activeTrackId && store.updateTrackInitialGauge(store.activeTrackId, v)
})
const maxGaugeVal = computed({
  get: () => activeTrack.value ? (activeTrack.value.maxGaugeOverride || char.value?.ultimate_gaugeMax || 100) : 100,
  set: (v) => store.activeTrackId && store.updateTrackMaxGauge(store.activeTrackId, v)
})

// Mode switches (injected from TimelineEditor)
const openAbilityExpansion = inject('openAbilityExpansion', () => {})
const openStatsDetail = inject('openStatsDetail', () => {})
const editorMode = inject('editorMode', ref('timeline'))
const isAbilityExpansionActive = computed(() => editorMode.value === 'abilityExpansion')
const isStatsDetailActive = computed(() => editorMode.value === 'statsDetail')

// ---------------------------------------------------------------------------
// Stats — Layer 2: configured stats (base + weapon/equipment, before combat buffs)
// ---------------------------------------------------------------------------
const configuredStats = computed(() => {
  if (!store.activeTrackId) return null
  return store.resolveTrackConfiguredStats(store.activeTrackId) || null
})
// Backward-compat alias used in template
const actorStats = computed(() => configuredStats.value || activeTrack.value?.stats || null)

// Effective ATK (after primary/secondary ability multiplier) — matches damage formula
const effectiveAttack = computed(() => {
  const s = configuredStats.value
  if (!s || !s.attack) return null
  const primary = s.primary_ability || 0
  const secondary = s.secondary_ability || 0
  const truncate = (v) => Math.floor(v * 10) / 10
  const mult = 1 + truncate(primary * 0.5) / 100 + truncate(secondary * 0.2) / 100
  return Math.floor(s.attack * mult)
})


// Bonus stats from weapon/equipment (non-zero values beyond base 6 attributes).
// Only shows stats that have a non-zero/non-default value.
const BONUS_STAT_DISPLAY = [
  { id: 'crit_rate', label: '暴击率', suffix: '%' },
  { id: 'crit_dmg', label: '暴击伤害', suffix: '%' },
  { id: 'physical_dmg', label: '物伤加成', suffix: '%' },
  { id: 'arts_dmg', label: '法伤加成', suffix: '%' },
  { id: 'blaze_dmg', label: '灼热伤害', suffix: '%' },
  { id: 'cold_dmg', label: '寒冷伤害', suffix: '%' },
  { id: 'emag_dmg', label: '电磁伤害', suffix: '%' },
  { id: 'nature_dmg', label: '自然伤害', suffix: '%' },
  { id: 'healing_effect', label: '治疗效果', suffix: '%' },
  { id: 'attack_dmg_bonus', label: '普攻加成', suffix: '%' },
  { id: 'skill_dmg_bonus', label: '战技加成', suffix: '%' },
  { id: 'link_dmg_bonus', label: '连携加成', suffix: '%' },
  { id: 'ultimate_dmg_bonus', label: '终结加成', suffix: '%' },
  { id: 'all_skill_dmg_bonus', label: '全技能加成', suffix: '%' },
  { id: 'broken_dmg_bonus', label: '破防加成', suffix: '%' },
  { id: 'originium_arts_power', label: '源石技艺', suffix: '' },
]
const bonusStats = computed(() => {
  const s = configuredStats.value
  if (!s) return []
  return BONUS_STAT_DISPLAY
    .filter(d => s[d.id])
    .map(d => ({ label: d.label, value: s[d.id] + d.suffix }))
})

// ---------------------------------------------------------------------------
// Skills — backed by store growth state
// ---------------------------------------------------------------------------
const ATTACK_ICON_MAP = {
  sword: '/icons/icon_attack_sword.webp',
  claym: '/icons/icon_attack_claym.webp',
  lance: '/icons/icon_attack_lance.webp',
  pistol: '/icons/icon_attack_pistol.webp',
  funnel: '/icons/icon_attack_funnel.webp',
  staff: '/icons/icon_attack_staff.webp',
}
const SKILL_LABELS = { attack: '普通攻击', skill: '战技', link: '连携技', ultimate: '终结技' }

function skillUnifiedLevel(sk) {
  return store.skillToUnified(growth.value.skillLevels[sk] || { rank: 9, mastery: 3 })
}

function skillLevelLabel(sk) {
  const u = skillUnifiedLevel(sk)
  return u <= 9 ? `RANK ${u}` : `M${u - 9}`
}

function incSkillLevel(sk) { store.setTrackSkillLevel(store.activeTrackId, sk, skillUnifiedLevel(sk) + 1) }
function decSkillLevel(sk) { store.setTrackSkillLevel(store.activeTrackId, sk, skillUnifiedLevel(sk) - 1) }
function canIncSkill(sk) { return skillUnifiedLevel(sk) < store.skillMaxUnified(currentPromo.value) }
function canDecSkill(sk) { return skillUnifiedLevel(sk) > 1 }

const MASTERY_ICON_MAP = {
  0: '/icons/skill-level/mastery-rank9.svg',
  1: '/icons/skill-level/mastery-m1.svg',
  2: '/icons/skill-level/mastery-m2.svg',
  3: '/icons/skill-level/mastery-m3.svg',
}

function skillRankDisplay(sk) {
  return growth.value.skillLevels[sk] || { rank: 9, mastery: 0 }
}

function getMasteryIcon(mastery) {
  return MASTERY_ICON_MAP[mastery] || MASTERY_ICON_MAP[0]
}

const SKILL_BG_COLORS = {
  blaze: '#e8603a', cold: '#2ec4c4', emag: '#edb200', nature: '#a8d83c', physical: '#555555',
}
const skillElementColor = computed(() => {
  const el = char.value?.element
  return el ? (SKILL_BG_COLORS[el] || '#8c8c8c') : '#8c8c8c'
})

const skills = computed(() => {
  if (!char.value) return []
  return [
    { key: 'attack', label: '普通攻击', icon: ATTACK_ICON_MAP[char.value.weapon] || ATTACK_ICON_MAP.sword },
    { key: 'skill', label: '战技', icon: char.value.skill_icon },
    { key: 'link', label: '连携技', icon: char.value.link_icon },
    { key: 'ultimate', label: '终结技', icon: char.value.ultimate_icon },
  ]
})

function onSkillClick(skillKey) {
  const lib = store.activeSkillLibrary
  const match = lib.find(s => s.type === skillKey || (skillKey === 'attack' && s.type === 'attack'))
  if (match) store.selectLibrarySkill(match.id, 'character')
}

// ---------------------------------------------------------------------------
// Talents
// ---------------------------------------------------------------------------
const TALENT_ICON_PREFIX = {
  AKEKURI: 'karin', ALESH: 'deepfin', ANTAL: 'antal', ARCLIGHT: 'ikut',
  ARDELIA: 'ardelia', AVYWENNA: 'avywen', CATCHER: 'meurs', CHENQIANYU: 'chen',
  DAPAN: 'dapan', EMBER: 'azrila', ENDMINISTRATOR: 'endminm', ESTELLA: 'whiten',
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

const talents = computed(() => {
  if (!char.value) return []
  const opData = loadOperator(store.activeTrackId)
  const staticTalents = opData.talents?.talents
  if (staticTalents?.length) {
    return staticTalents.map((t, i) => ({
      key: t.id || `talent_${i}`,
      name: t.name,
      icon: t.icon || getTalentIcon(char.value.id, i),
      level: store.getTrackTalentLevel(store.activeTrackId, t.id || `talent_${i}`),
      maxLevel: t.maxLevel || t.unlockStages?.length || 2,
    }))
  }
  return []
})

const selectedTalent = ref(null)
function onTalentClick(talent) {
  selectedTalent.value = selectedTalent.value?.key === talent.key ? null : talent
}

// ---------------------------------------------------------------------------
// Potentials
// ---------------------------------------------------------------------------
const currentPotentialLevel = computed(() => growth.value?.potentialLevel || 0)
const potentials = computed(() => {
  if (!char.value) return []
  const opData = loadOperator(store.activeTrackId)
  const data = opData.potentials?.potentials || []
  return data.map(p => ({
    level: p.level,
    description: p.description || '',
    active: currentPotentialLevel.value >= p.level,
  }))
})

function togglePotentialPanel() {
  if (store.selectedPotentialData) {
    store.selectedPotentialData = null
    return
  }
  refreshPotentialPanel()
}

function refreshPotentialPanel() {
  const lvl = currentPotentialLevel.value
  const p = potentials.value.find(p => p.level === lvl)
  store.selectedPotentialData = {
    currentLevel: lvl,
    description: p?.description || (lvl === 0 ? '无潜能' : ''),
  }
}

// ---------------------------------------------------------------------------
// Element / Profession / Rarity display
// ---------------------------------------------------------------------------
const ELEMENT_ICON_MAP = { physical: '物理', blaze: '火', emag: '电', cold: '冰', nature: '自然' }
const ELEMENT_LABELS = { physical: '物理', blaze: '灼热', emag: '电磁', cold: '寒冷', nature: '自然' }
function getElementIcon(element) {
  const name = ELEMENT_ICON_MAP[element]
  return name ? `/icons/operator-info/${name}.jpg` : null
}
const RARITY_STAR_ICON = '/icons/operator-info/星星.png'
const PROFESSION_MAP = {
  '先锋': { label: '先锋', icon: '先锋.jpg' }, '近卫': { label: '近卫', icon: '近卫.jpg' },
  '重装': { label: '重装', icon: '重装.jpg' }, '突击': { label: '突击', icon: '突击.jpg' },
  '辅助': { label: '辅助', icon: '辅助.jpg' }, '术师': { label: '术师', icon: '术师.jpg' },
  '术士': { label: '术师', icon: '术师.jpg' },
}
function resolveProfession(raw) { return PROFESSION_MAP[raw] || null }
// New static data (all operators, fallback-safe)
const opData = computed(() => loadOperator(store.activeTrackId))

// Profession: prefer new static data, fallback to wiki index
const wikiEntry = computed(() => {
  if (!char.value) return null
  const name = char.value.name
  return wikiIndex.find(w => w.name_zh === name || w.name_en === name || w.id === char.value.id?.toUpperCase?.()) || null
})
const professionResolved = computed(() => {
  const staticLabel = opData.value.meta?.professionLabel
  if (staticLabel) return resolveProfession(staticLabel)
  return resolveProfession(wikiEntry.value?.profession)
})
const professionLabel = computed(() => professionResolved.value?.label || null)
const professionIcon = computed(() => { const r = professionResolved.value; return r ? `/icons/operator-info/${r.icon}` : null })

// Main ability icon (first stat icon, using element as proxy)
const mainAbilityIcon = computed(() => getElementIcon(char.value?.element))
</script>

<template>
  <div v-if="char" class="op-info-panel">

    <!-- === 1. Header === -->
    <div class="op-header">
      <div class="op-avatar-box">
        <img :src="char.avatar" class="op-avatar" @error="e=>e.target.style.display='none'" />
      </div>
      <div class="op-header-info">
        <div class="op-name">{{ char.name }}</div>
        <div class="op-rarity">
          <img v-for="i in (char.rarity || 1)" :key="i" :src="RARITY_STAR_ICON" class="op-star-icon" />
        </div>
        <div class="op-tags">
          <span class="op-tag-icon" v-if="getElementIcon(char.element)" :title="ELEMENT_LABELS[char.element]">
            <img :src="getElementIcon(char.element)" class="op-tag-img" />
          </span>
          <span class="op-tag-icon" v-if="professionIcon" :title="professionLabel">
            <img :src="professionIcon" class="op-tag-img" />
          </span>
          <span v-if="!professionIcon && professionLabel" class="op-tag-text">{{ professionLabel }}</span>
        </div>
      </div>
    </div>

    <!-- === 2. Growth === -->
    <div class="op-section">
      <div class="op-section-title">等级 / 精英化</div>
      <div class="op-growth-row">
        <div class="op-growth-block">
          <div class="op-promo-display">
            <span class="op-promo-label">精英化</span>
            <span class="op-promo-value">{{ currentPromo }}</span>
            <span class="op-promo-max">/4</span>
          </div>
          <div class="op-promo-dots">
            <span v-for="i in 4" :key="i" class="op-promo-dot" :class="{ filled: i <= currentPromo }"></span>
          </div>
          <div class="op-promo-controls">
            <button class="op-btn" @click="currentPromo > 0 && (currentPromo -= 1)" :disabled="currentPromo <= 0">−</button>
            <button class="op-btn" @click="currentPromo < 4 && (currentPromo += 1)" :disabled="currentPromo >= 4">+</button>
          </div>
        </div>
        <div class="op-growth-block">
          <div class="op-level-display">
            <span class="op-level-label">LEVEL</span>
            <span class="op-level-value">{{ currentLevel }}</span>
            <span class="op-level-max">/{{ levelMax }}</span>
          </div>
          <input type="range" class="op-level-slider" v-model.number="currentLevel" :min="levelMin" :max="levelMax" />
        </div>
      </div>
    </div>

    <!-- === Ability Expansion: compact entry → toggles editor mode === -->
    <div class="op-ability-entry" :class="{ 'is-active': isAbilityExpansionActive }"
         @click="isAbilityExpansionActive ? (editorMode.value = 'timeline') : openAbilityExpansion()">
      <span class="op-ability-entry-label">能力扩展</span>
      <span class="op-ability-entry-arrow">{{ isAbilityExpansionActive ? '●' : '▸' }}</span>
    </div>

    <!-- === 3. Stats (compact) — click to open detail === -->
    <div v-if="actorStats" class="op-section">
      <div class="op-ability-entry" :class="{ 'is-active': isStatsDetailActive }"
           @click="isStatsDetailActive ? (editorMode.value = 'timeline') : openStatsDetail()">
        <span class="op-ability-entry-label">能力值</span>
        <span class="op-ability-entry-arrow">{{ isStatsDetailActive ? '●' : '▸' }}</span>
      </div>
      <div class="op-stats-grid">
        <div class="op-stat-item"><span class="op-stat-label">力量</span><span class="op-stat-value">{{ actorStats.strength }}</span></div>
        <div class="op-stat-item"><span class="op-stat-label">敏捷</span><span class="op-stat-value">{{ actorStats.agility }}</span></div>
        <div class="op-stat-item"><span class="op-stat-label">智识</span><span class="op-stat-value">{{ actorStats.intellect }}</span></div>
        <div class="op-stat-item"><span class="op-stat-label">意志</span><span class="op-stat-value">{{ actorStats.will }}</span></div>
      </div>
      <div class="op-stats-secondary">
        <span class="op-stat-mini" v-if="effectiveAttack">⚔ {{ effectiveAttack }}</span>
      </div>
    </div>

    <!-- === 4. Skills (compact 2×2 grid) === -->
    <div class="op-section">
      <div class="op-section-title">技能</div>
      <div class="op-skills-row">
        <div v-for="sk in skills" :key="sk.key" class="op-skill-item" @click="onSkillClick(sk.key)" :title="sk.label">
          <div class="op-skill-icon-box" :class="sk.key === 'ultimate' ? 'op-skill-bg-circle' : 'op-skill-bg-sector'" :style="{ '--el-color': skillElementColor }">
            <img v-if="sk.icon" :src="sk.icon" class="op-skill-icon" @error="e=>e.target.style.display='none'" />
          </div>
          <div class="op-skill-rank">
            <span v-if="skillRankDisplay(sk.key).rank < 9" class="op-rank-text">RANK {{ skillRankDisplay(sk.key).rank }}</span>
            <img v-else :src="getMasteryIcon(skillRankDisplay(sk.key).mastery)"
                 class="op-mastery-icon"
                 :title="skillRankDisplay(sk.key).mastery > 0 ? 'M' + skillRankDisplay(sk.key).mastery : 'RANK 9'" />
          </div>
        </div>
      </div>
    </div>

    <!-- === 5. Talents (compact) === -->
    <div v-if="talents.length > 0" class="op-section">
      <div class="op-section-title">天赋</div>
      <div class="op-talents-row">
        <div v-for="talent in talents" :key="talent.key" class="op-talent-item">
          <img v-if="talent.icon" :src="talent.icon" class="op-talent-icon" @error="e=>e.target.style.display='none'" />
          <span class="op-talent-level">Lv.{{ talent.level }}</span>
        </div>
      </div>
    </div>

    <!-- === 6. Potentials === -->
    <div v-if="potentials.length > 0" class="op-section">
      <div class="op-section-title">潜能</div>
      <div class="op-potential-row" :class="{ 'is-selected': !!store.selectedPotentialData }" @click="togglePotentialPanel">
        <div class="op-potential-icon-wrap">
          <EndaxisStageIcon :stage="currentPotentialLevel + 1" inactive-color="#3a3a3e" active-color="#c9a80e" complete-color="#e2e8f0" />
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.op-info-panel { padding: 8px; display: flex; flex-direction: column; gap: 6px; }

/* Header */
.op-header { display: flex; gap: 10px; align-items: center; padding: 6px; background: rgba(255,255,255,0.03); border-radius: 6px; }
.op-avatar-box { width: 48px; height: 48px; border-radius: 6px; overflow: hidden; flex-shrink: 0; border: 1px solid #444; }
.op-avatar { width: 100%; height: 100%; object-fit: cover; }
.op-header-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.op-name { font-size: 15px; font-weight: 700; color: #e2e8f0; line-height: 1.2; }
.op-rarity { display: flex; gap: 1px; align-items: center; }
.op-star-icon { width: 14px; height: 14px; object-fit: contain; display: block; }
.op-tags { display: flex; gap: 4px; align-items: center; }
.op-tag-icon { width: 20px; height: 20px; border-radius: 3px; overflow: hidden; flex-shrink: 0; }
.op-tag-img { width: 100%; height: 100%; object-fit: cover; display: block; }
.op-tag-text { font-size: 9px; padding: 1px 5px; border: 1px solid #444; border-radius: 3px; color: #aaa; }

/* Sections */
.op-section { background: rgba(255,255,255,0.02); border-radius: 5px; padding: 6px 8px; }
.op-section-title { font-size: 10px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 3px; }

/* Growth */
.op-growth-row { display: flex; flex-direction: column; gap: 8px; }
.op-growth-block { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.op-promo-display { display: flex; align-items: baseline; gap: 2px; }
.op-promo-label { font-size: 10px; color: #888; }
.op-promo-value { font-size: 18px; font-weight: 700; color: #ffd700; }
.op-promo-max { font-size: 11px; color: #555; }
.op-promo-dots { display: flex; gap: 3px; margin-left: 4px; }
.op-promo-dot { width: 8px; height: 8px; border-radius: 50%; border: 1px solid #555; }
.op-promo-dot.filled { background: #ffd700; border-color: #ffd700; }
.op-promo-controls { display: flex; gap: 3px; margin-left: auto; }
.op-btn { width: 22px; height: 22px; border: 1px solid #555; background: #222; color: #ccc; border-radius: 3px; cursor: pointer; font-size: 13px; display: flex; align-items: center; justify-content: center; }
.op-btn:hover:not(:disabled) { background: #333; }
.op-btn:disabled { opacity: 0.3; cursor: default; }
.op-level-display { display: flex; align-items: baseline; gap: 3px; }
.op-level-label { font-size: 9px; color: #888; letter-spacing: 1px; }
.op-level-value { font-size: 18px; font-weight: 700; color: #e2e8f0; }
.op-level-max { font-size: 11px; color: #555; }
.op-level-slider { flex: 1; min-width: 60px; accent-color: #ffd700; height: 4px; }

/* Ability expansion entry button */
.op-ability-entry {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px; background: rgba(255,215,0,0.06); border: 1px solid rgba(255,215,0,0.15);
  border-radius: 5px; cursor: pointer; transition: background 0.15s;
}
.op-ability-entry:hover { background: rgba(255,215,0,0.12); }
.op-ability-entry.is-active { background: rgba(255,215,0,0.20); border-color: #ffd700; }
.op-ability-entry-label { font-size: 11px; font-weight: 600; color: #ffd700; }
.op-ability-entry-arrow { font-size: 10px; color: #888; }
.op-ability-entry.is-active .op-ability-entry-arrow { color: #ffd700; }

/* Stats */
.op-stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.op-stat-item { display: flex; justify-content: space-between; padding: 3px 6px; background: rgba(255,255,255,0.03); border-radius: 3px; cursor: default; }
.op-stat-item:hover { background: rgba(255,255,255,0.06); }
.op-stat-label { font-size: 11px; color: #888; }
.op-stat-value { font-size: 12px; font-weight: 600; color: #e2e8f0; font-variant-numeric: tabular-nums; }
.op-stats-secondary { display: flex; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
.op-stat-mini { font-size: 10px; color: #666; }

/* Skills compact */
.op-skills-row { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; }
.op-skill-item { display: flex; flex-direction: column; align-items: center; gap: 3px; cursor: pointer; }
.op-skill-item:hover .op-skill-icon-box { border-color: #ffd700; }
.op-skill-icon-box { width: 36px; height: 36px; border-radius: 50%; border: 2px solid #444; overflow: hidden; background: #1a1a1a; display: flex; align-items: center; justify-content: center; transition: border-color 0.15s; }
.op-skill-bg-circle { background: var(--el-color, #1a1a1a); }
.op-skill-bg-sector { background: conic-gradient(transparent 100deg, var(--el-color, #555) 100deg 240deg, transparent 240deg); }
.op-skill-icon { width: 100%; height: 100%; object-fit: cover; position: relative; z-index: 1; }
.op-skill-rank { height: 22px; display: flex; align-items: center; justify-content: center; }
.op-rank-text { font-size: 9px; font-weight: 700; color: #888; letter-spacing: 0.5px; line-height: 22px; }
.op-mastery-icon { width: 22px; height: 22px; object-fit: contain; display: block; }

/* Talents compact */
.op-talents-row { display: flex; gap: 8px; }
.op-talent-item { display: flex; align-items: center; gap: 4px; padding: 3px 8px; background: rgba(255,255,255,0.03); border-radius: 4px; }
.op-talent-icon { width: 22px; height: 22px; border-radius: 4px; border: 1px solid #444; }
.op-talent-level { font-size: 11px; color: #aaa; font-weight: 600; }

/* Potentials */
.op-potential-row { display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 10px; border: 1px solid transparent; border-radius: 4px; transition: all 0.15s; }
.op-potential-row:hover { background: rgba(255,255,255,0.04); }
.op-potential-row.is-selected { border-color: rgba(201,168,14,0.3); background: rgba(201,168,14,0.06); }
.op-potential-icon-wrap { width: 90px; height: 90px; }
</style>
