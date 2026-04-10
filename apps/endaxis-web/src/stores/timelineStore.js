import { defineStore } from 'pinia'
import { ref, computed, watch, shallowRef } from 'vue'
import { watchThrottled } from '@vueuse/core'
import { executeFetch } from '@/api/fetchStrategy.js'
import { compressGzip, decompressGzip } from '@/utils/gzipUtils'
import { CORE_STATS, createDefaultStats } from '@/utils/coreStats.js'
import { lookupBaseStats, createWikiDataLoader } from '@/utils/operatorStats.js'
import { applySkillMultiplierOverlay } from '@/simulation/data/skillMultipliers'
import { lookupOperatorStats, loadOperator } from '@/data/operators/loader.js'
import { compileScenario } from '@/simulation/compiler/compileScenario'
import { simulate } from '@/simulation/simulator'
import { ULTIMATE_ENHANCEMENT_EXTENDERS } from '@/simulation/compiler/enhancers'
import { projectSpSeries } from '@/simulation/projection/projectSpSeries'
import { projectStaggerSeries } from '@/simulation/projection/projectStaggerSeries'
import { projectLinkTriggerSeries, computeLinkQueueAt } from '@/simulation/projection/projectLinkTriggerSeries'
import { projectGaugeSeries as projGaugeSeries } from '@/simulation/projection/projectGaugeSeries'
import { projectWeaponBuffTimeline } from '@/simulation/projection/projectWeaponBuffTimeline'
import { projectSelfBuffTimeline } from '@/simulation/projection/projectSelfBuffTimeline'
import { CATEGORY_TO_SET_ID } from '@/simulation/equipment/registry'
import { checkConditionsMet } from '@/simulation/legality/checkActionLegality'
import { i18n } from '@/i18n'
import { snapMs } from '@/utils/precision.js'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
    calcSpellBurstDamage,
    calcSpellAnomalyTriggerDamage,
    calcCombustionDotTick,
    calcFreezeConsumeDamage,
    calcLiftKnockdownDamage,
    calcCrushDamage,
    calcBreachDamage,
} from '@/utils/anomalyCalc.js'

const tr = (key, params) => i18n.global.t(key, params)
const getI18nSkillType = (type) => {
    const key = `skillType.${type}`
    const out = tr(key)
    return out === key ? tr('skillType.unknown') : out
}

const uid = () => Math.random().toString(36).substring(2, 9)
const ATTACK_SEGMENT_COUNT = 5
const COLLAPSED_PREP_PX = 18
const MIN_PREP_DURATION = 0.5
const EQUIPMENT_REFINE_MAX_TIER = 3
const WEAPON_POTENTIAL_MAX_TIER = 9   // 满潜能 = tier 9（large[8]=39%攻击/19.5%暴击/43.3%元素）

// createOwnSkillLinkEnhancer and ULTIMATE_ENHANCEMENT_EXTENDERS
// moved to simulation/compiler/enhancers.ts — imported above

function shiftSnapshotTimes(snapshot, delta) {
    const d = Number(delta) || 0
    if (!snapshot || !Number.isFinite(d) || d === 0) return snapshot

    const shiftVal = (v) => {
        const n = Number(v) || 0
        const out = n + d
        return out < 0 ? 0 : out
    }

    const shiftStartLike = (obj) => {
        if (!obj || typeof obj !== 'object') return
        if (obj.startTime !== undefined) obj.startTime = shiftVal(obj.startTime)
        if (obj.logicalStartTime !== undefined) obj.logicalStartTime = shiftVal(obj.logicalStartTime)
        if (obj.time !== undefined) obj.time = shiftVal(obj.time)
    }

    if (Array.isArray(snapshot.tracks)) {
        snapshot.tracks.forEach((track) => {
            if (!track || !Array.isArray(track.actions)) return
            track.actions.forEach(shiftStartLike)
        })
    }

    if (Array.isArray(snapshot.weaponStatuses)) {
        snapshot.weaponStatuses.forEach(shiftStartLike)
    }

    if (Array.isArray(snapshot.cycleBoundaries)) {
        snapshot.cycleBoundaries.forEach(shiftStartLike)
    }

    if (Array.isArray(snapshot.switchEvents)) {
        snapshot.switchEvents.forEach(shiftStartLike)
    }

    return snapshot
}

function normalizePrepConfig(snapshot) {
    const hasPrep = snapshot && (snapshot.prepDuration !== undefined || snapshot.prepExpanded !== undefined)
    if (hasPrep) {
        const dur = Number(snapshot.prepDuration)
        if (Number.isFinite(dur)) {
            const clamped = Math.max(MIN_PREP_DURATION, dur)
            if (Math.abs(clamped - dur) > 0.0001) {
                shiftSnapshotTimes(snapshot, clamped - dur)
            }
            snapshot.prepDuration = clamped
        } else {
            snapshot.prepDuration = 5
        }
        snapshot.prepExpanded = snapshot.prepExpanded !== false
        return { snapshot, migrated: false }
    }

    // Legacy project: assume old "0s == battle start", migrate to default prepDuration=5
    const migratedSnapshot = snapshot || {}
    migratedSnapshot.prepDuration = 5
    migratedSnapshot.prepExpanded = true
    shiftSnapshotTimes(migratedSnapshot, 5)
    return { snapshot: migratedSnapshot, migrated: true }
}

function normalizeAttackSegmentsForCharacter(char) {
    if (!char) return

    const legacy = {
        duration: Number(char.attack_duration) || 0,
        gaugeGain: Number(char.attack_gaugeGain) || 0,
        allowed_types: Array.isArray(char.attack_allowed_types) ? [...char.attack_allowed_types] : [],
        anomalies: char.attack_anomalies ? JSON.parse(JSON.stringify(char.attack_anomalies)) : [],
        damage_ticks: char.attack_damage_ticks ? JSON.parse(JSON.stringify(char.attack_damage_ticks)) : [],
    }

    const sanitizeSeg = (seg, fallback) => {
        const raw = seg && typeof seg === 'object' ? seg : {}
        const base = fallback && typeof fallback === 'object' ? fallback : {}
        return {
            duration: Number(raw.duration ?? base.duration) || 0,
            gaugeGain: Number(raw.gaugeGain ?? base.gaugeGain) || 0,
            allowed_types: Array.isArray(raw.allowed_types) ? raw.allowed_types : (Array.isArray(base.allowed_types) ? [...base.allowed_types] : []),
            anomalies: raw.anomalies ? JSON.parse(JSON.stringify(raw.anomalies)) : (base.anomalies ? JSON.parse(JSON.stringify(base.anomalies)) : []),
            damage_ticks: raw.damage_ticks ? JSON.parse(JSON.stringify(raw.damage_ticks)) : (base.damage_ticks ? JSON.parse(JSON.stringify(base.damage_ticks)) : []),
            element: typeof raw.element === 'string' ? raw.element : (typeof base.element === 'string' ? base.element : undefined),
            icon: typeof raw.icon === 'string' ? raw.icon : (typeof base.icon === 'string' ? base.icon : undefined),
        }
    }

    if (!Array.isArray(char.attack_segments)) {
        const seg0 = sanitizeSeg(null, legacy)
        char.attack_segments = Array.from({ length: ATTACK_SEGMENT_COUNT }, (_, idx) => {
            if (idx === 0) return seg0
            return sanitizeSeg({ duration: 0 }, seg0)
        })
        return
    }

    const normalized = char.attack_segments.slice(0, ATTACK_SEGMENT_COUNT).map(seg => sanitizeSeg(seg, legacy))
    while (normalized.length < ATTACK_SEGMENT_COUNT) normalized.push(sanitizeSeg({ duration: 0 }, legacy))
    char.attack_segments = normalized
}

export const useTimelineStore = defineStore('timeline', () => {

    // ===================================================================================
    // 系统配置与常量
    // ===================================================================================

    const DEFAULT_SYSTEM_CONSTANTS = {
        maxSp: 300,
        initialSp: 200,
        spRegenRate: 8,
        skillSpCostDefault: 100,
        linkCdReduction: 0,
        maxStagger: 100,
        staggerNodeCount: 0,
        staggerNodeDuration: 2,
        staggerBreakDuration: 10,
        executionRecovery: 25
    }

    const systemConstants = ref({ ...DEFAULT_SYSTEM_CONSTANTS })
    const customEnemyParams = ref({
        maxStagger: 100,
        staggerNodeCount: 0,
        staggerNodeDuration: 2,
        staggerBreakDuration: 10,
        executionRecovery: 25
    })

    watch(systemConstants, (newVal) => {
        if (activeEnemyId.value === 'custom') {
            customEnemyParams.value = {
                maxStagger: newVal.maxStagger,
                staggerNodeCount: newVal.staggerNodeCount,
                staggerNodeDuration: newVal.staggerNodeDuration,
                staggerBreakDuration: newVal.staggerBreakDuration,
                executionRecovery: newVal.executionRecovery
            }
        }
    }, { deep: true })

    const BASE_BLOCK_WIDTH = ref(50)
    const ZOOM_LIMITS = {
        MIN: 15,
        MAX: 1200
    }
    const TOTAL_DURATION = 120
    const MAX_SCENARIOS = 14

    const prepDuration = ref(5)
    const prepExpanded = ref(true)

    const viewDuration = computed(() => (Number(prepDuration.value) || 0) + TOTAL_DURATION)
    const prepZoneWidthPx = computed(() => {
        const dur = Number(prepDuration.value) || 0
        if (dur <= 0) return 0
        if (prepExpanded.value) return dur * timeBlockWidth.value
        return COLLAPSED_PREP_PX
    })

    function timeToPx(time) {
        const t = Number(time) || 0
        const dur = Number(prepDuration.value) || 0
        const width = timeBlockWidth.value
        if (dur <= 0 || prepExpanded.value) return t * width
        if (t <= dur) return (t / dur) * COLLAPSED_PREP_PX
        return COLLAPSED_PREP_PX + (t - dur) * width
    }

    function pxToTime(px) {
        const x = Number(px) || 0
        const dur = Number(prepDuration.value) || 0
        const width = timeBlockWidth.value
        if (dur <= 0 || prepExpanded.value) return x / width
        if (x <= COLLAPSED_PREP_PX) return (x / COLLAPSED_PREP_PX) * dur
        return dur + (x - COLLAPSED_PREP_PX) / width
    }

    const totalTimelineWidthPx = computed(() => timeToPx(viewDuration.value))

    function toBattleTime(viewTime) {
        return (Number(viewTime) || 0) - (Number(prepDuration.value) || 0)
    }

    function formatAxisTimeLabel(viewTime) {
        const bt = toBattleTime(viewTime)
        if (!Number.isFinite(bt)) return ''
        const sign = bt < 0 ? '-' : ''
        const abs = Math.abs(bt)
        const totalFrames = Math.round(abs * 60)
        const s = Math.floor(totalFrames / 60)
        const f = totalFrames % 60
        if (f === 0) return `${sign}${s}s`
        return `${sign}${s}s ${f.toString().padStart(2, '0')}f`
    }

    const ELEMENT_COLORS = {
        "blaze": "#ff4d4f", "cold": "#00e5ff", "emag": "#ffbf00", "nature": "#52c41a", "physical": "#e0e0e0",
        "link": "#fdd900", "execution": "#a61d24", "dodge": "#69c0ff", "skill": "#ffffff", "ultimate": "#00e5ff", "attack": "#aaaaaa", "default": "#8c8c8c",
        'blaze_attach': '#ff4d4f', 'blaze_burst': '#ff7875', 'burning': '#f5222d',
        'cold_attach': '#00e5ff', 'cold_burst': '#40a9ff', 'frozen': '#1890ff', 'ice_shatter': '#bae7ff',
        'emag_attach': '#ffd700', 'emag_burst': '#fff566', 'conductive': '#ffec3d',
        'nature_attach': '#95de64', 'nature_burst': '#73d13d', 'corrosion': '#52c41a',
        'break': '#d9d9d9', 'armor_break': '#d9d9d9', 'stagger': '#d9d9d9',
        'knockdown': '#d9d9d9', 'knockup': '#d9d9d9', 'physical_vulnerable': '#bfbfbf',
        'skillwater': '#69c0ff', 'ultskilldebuff': '#ff7875', 'weaken': '#b37feb', 'endmin_debuff': '#8c8c8c',
        'magma_0': '#ff7a45', 'magma_1': '#ff4d4f', 'magma_4': '#d4380d',
    }

    const getColor = (key) => ELEMENT_COLORS[key] || ELEMENT_COLORS.default

    /** 敌方减益：含法术/自然/寒冷等附着与爆发、易伤、控制等 */
    const DEBUFF_ANOMALY_TYPES = new Set([
        'blaze_attach', 'blaze_burst', 'burning',
        'cold_attach', 'cold_burst', 'frozen', 'ice_shatter',
        'emag_attach', 'emag_burst', 'conductive',
        'nature_attach', 'nature_burst', 'corrosion',
        'armor_break', 'knockdown', 'knockup',
        'affix_slow', 'spell_vulnerable', 'physical_vulnerable',
        'skillwater', 'ultskilldebuff', 'stagger', 'weaken', 'endmin_debuff',
    ])
    const isDebuffAnomalyType = (type) => DEBUFF_ANOMALY_TYPES.has(type)

    /** 附着类：duration 为 0 时仍显示在 Boss 减益行（条带拉到时间轴末尾） */
    const ATTACH_LIKE_DEBUFF_TYPES = new Set([
        'blaze_attach', 'cold_attach', 'emag_attach', 'nature_attach',
    ])

    const DEBUFF_STACK_CAP = 4

    const debuffConsumptionListeners = ref([])

    function registerDebuffConsumptionListener(fn) {
        if (typeof fn !== 'function') return () => {}
        debuffConsumptionListeners.value = [...debuffConsumptionListeners.value, fn]
        return () => {
            debuffConsumptionListeners.value = debuffConsumptionListeners.value.filter(l => l !== fn)
        }
    }

    /**
     * 预留：敌方减益被消耗时调用（如模拟器/连线消耗逻辑接入）
     * @param {{ anomalyType?: string, atTime?: number, stacksConsumed?: number, sourceActionInstanceId?: string, meta?: object }} payload
     */
    function applyDebuffConsumption(payload) {
        debuffConsumptionListeners.value.forEach((listener) => {
            try {
                listener(payload || {})
            } catch (e) {
                console.warn('[timeline] debuff consumption listener', e)
            }
        })
    }

    const ENEMY_TIERS = [
        { labelKey: 'enemyTier.normal', label: '普通', value: 'normal', color: '#a0a0a0' },
        { labelKey: 'enemyTier.elite', label: '进阶', value: 'elite', color: '#52c41a' },
        { labelKey: 'enemyTier.champion', label: '精英', value: 'champion', color: '#d8b4fe' },
        { labelKey: 'enemyTier.head', label: '头目', value: 'head', color: '#ffd700' },
        { labelKey: 'enemyTier.boss', label: '领袖', value: 'boss', color: '#ff4d4f' }
    ]
    // ===================================================================================
    // 核心数据状态
    // ===================================================================================

    const isLoading = ref(true)
    const characterRoster = ref([])
    const iconDatabase = ref({})
    const enemyDatabase = ref([])
    const weaponDatabase = ref([])
    const equipmentDatabase = ref([])
    const equipmentCategories = ref([])
    const equipmentCategoryConfigs = ref({})
    const misc = ref({
        modifierDefs: [],
        weaponCommonModifiers: {},
        equipmentTemplates: {
            armor: { primary1: [0, 0, 0, 0], primary2: [0, 0, 0, 0], primary1Single: [0, 0, 0, 0] },
            gloves: { primary1: [0, 0, 0, 0], primary2: [0, 0, 0, 0], primary1Single: [0, 0, 0, 0] },
            accessory: { primary1: [0, 0, 0, 0], primary2: [0, 0, 0, 0], primary1Single: [0, 0, 0, 0] },
        },
        equipmentAdapterTable: {},
        domainConfig: {}
    })
    const activeEnemyId = ref('custom')
    const enemyCategories = ref([])
    const cycleBoundaries = ref([])

    const activeScenarioId = ref('default_sc')
    const scenarioList = ref([
        { id: 'default_sc', name: tr('timeline.scenario.defaultName', { index: 1 }), data: null }
    ])

    watchThrottled([weaponDatabase, misc], () => {
        if (isLoading.value) return
        syncAllWeaponModifiers()
    }, { deep: true, throttle: 600 })

    watchThrottled([equipmentDatabase], () => {
        if (isLoading.value) return
        syncAllEquipmentModifiers()
    }, { deep: true, throttle: 80 })

    // ══════════════════════════════════════════════════════════════════════
    // OPERATOR CONFIG STATE (track.growth)
    //
    // Each track stores *configuration choices* — NOT computed attributes.
    //
    // What belongs here (saved per track):
    //   promotion, characterLevel, skillLevels
    //
    // What does NOT belong here (derived at read time):
    //   base stats (looked up from wiki data via operatorStats.js)
    //   final stats (base + weapon/equipment deltas + buffs)
    //
    // Weapon/equipment config lives as separate fields on the track
    // (weaponId, equipArmorId, etc.) and is already persisted.
    //
    // ── Future calculation chain ──
    // 1. track.growth       → config choices (THIS)
    // 2. lookupBaseStats()  → per-level base attributes (operatorStats.js)
    // 3. track.weapon/equip → equipment config choices (already on track)
    // 4. weapon/equip deltas→ modifier aggregation (existing syncWeapon/Equipment)
    // 5. final display stats→ computed / selector (NOT stored)
    // 6. simulation input   → runtime (unchanged)
    // ══════════════════════════════════════════════════════════════════════
    const GROWTH_SKILL_KEYS = ['attack', 'skill', 'link', 'ultimate']
    const PROMO_CAPS = [20, 40, 60, 80, 90] // max character level at promo 0–4

    function createDefaultGrowth() {
        return {
            promotion: 4,
            characterLevel: 90,
            potentialLevel: 0, // 0-5; default by rarity: 6★→0, 5★/4★→5
            skillLevels: {
                attack:   { rank: 9, mastery: 3 },
                skill:    { rank: 9, mastery: 3 },
                link:     { rank: 9, mastery: 3 },
                ultimate: { rank: 9, mastery: 3 },
            },
            // Per-talent level: { talent_0: 0-N, talent_1: 0-N }
            // 0 = not activated, 1 = first stage unlocked, 2 = first upgrade, etc.
            // Max level per talent determined by stages count in talents.json.
            // Promotion constrains achievable max (can't exceed what promotion allows).
            // Default: max out at current promotion (like skill levels).
            talentLevels: {}, // populated per-operator by resolveTrackActiveEffects
        }
    }

    // Unified skill level helpers (shared by all consumers)
    function skillToUnified(s) { return s.rank < 9 ? s.rank : 9 + s.mastery }
    function skillFromUnified(u) {
        return u <= 9 ? { rank: Math.max(1, u), mastery: 0 }
                      : { rank: 9, mastery: Math.min(3, u - 9) }
    }
    function skillMaxUnified(promo) {
        if (promo <= 0) return 1
        if (promo === 1) return 3
        if (promo === 2) return 6
        if (promo === 3) return 9
        return 12
    }

    // ── Growth accessors (exposed as store methods) ──
    function getTrackGrowth(trackId) {
        const track = tracks.value.find(t => t.id === trackId)
        if (!track) return createDefaultGrowth()
        if (!track.growth) {
            track.growth = createDefaultGrowth()
            // Set rarity-aware potential default
            const charInfo = characterRoster.value.find(c => c.id === trackId)
            track.growth.potentialLevel = getDefaultPotentialLevel(charInfo?.rarity ?? 6)
            // Max out talent levels at default promotion
            const opData = loadOperator(trackId)
            const talents = opData.talents?.talents || []
            if (!track.growth.talentLevels) track.growth.talentLevels = {}
            for (const t of talents) {
                const maxLvl = getTalentMaxLevel(t, track.growth.promotion)
                track.growth.talentLevels[t.id] = maxLvl
            }
        }
        return track.growth
    }

    function setTrackPromotion(trackId, promo) {
        const g = getTrackGrowth(trackId)
        const oldPromo = g.promotion
        g.promotion = Math.max(0, Math.min(4, promo))
        const cap = PROMO_CAPS[g.promotion]
        const floor = g.promotion > 0 ? PROMO_CAPS[g.promotion - 1] : 1
        if (g.characterLevel > cap) g.characterLevel = cap
        if (g.characterLevel < floor) g.characterLevel = floor
        // Set skill levels to new max on promotion change
        const max = skillMaxUnified(g.promotion)
        for (const k of GROWTH_SKILL_KEYS) {
            const cur = skillToUnified(g.skillLevels[k])
            if (g.promotion > oldPromo) {
                // Promotion up: set to max
                g.skillLevels[k] = skillFromUnified(max)
            } else if (cur > max) {
                // Promotion down: clamp
                g.skillLevels[k] = skillFromUnified(max)
            }
        }
        // Set talent levels to new max on promotion change
        const opData = loadOperator(trackId)
        const talents = opData.talents?.talents || []
        if (!g.talentLevels) g.talentLevels = {}
        for (const t of talents) {
            const talentId = t.id
            const talentMax = getTalentMaxLevel(t, g.promotion)
            const cur = g.talentLevels[talentId] ?? talentMax
            if (g.promotion > oldPromo) {
                g.talentLevels[talentId] = talentMax
            } else if (cur > talentMax) {
                g.talentLevels[talentId] = talentMax
            }
        }
    }

    function setTrackCharacterLevel(trackId, level) {
        const g = getTrackGrowth(trackId)
        const cap = PROMO_CAPS[g.promotion]
        const floor = g.promotion > 0 ? PROMO_CAPS[g.promotion - 1] : 1
        g.characterLevel = Math.max(floor, Math.min(cap, level))
    }

    function setTrackSkillLevel(trackId, skillKey, unifiedLevel) {
        const g = getTrackGrowth(trackId)
        const max = skillMaxUnified(g.promotion)
        const clamped = Math.max(1, Math.min(max, unifiedLevel))
        g.skillLevels[skillKey] = skillFromUnified(clamped)
    }

    function getMaxPotentialLevel(trackId) {
        const opData = loadOperator(trackId)
        return opData.potentials?.maxPotential ?? 5
    }

    function setTrackPotentialLevel(trackId, level) {
        const g = getTrackGrowth(trackId)
        const max = getMaxPotentialLevel(trackId)
        g.potentialLevel = Math.max(0, Math.min(max, Math.round(level)))
        commitState()
    }

    /** Get default potentialLevel by rarity: 6★→0, others→5 */
    function getDefaultPotentialLevel(rarity) {
        return rarity >= 6 ? 0 : 5
    }

    /**
     * Compute the max achievable talent level given promotion and talent definition.
     * Each stage in the talent whose promotion requirement <= current promotion adds one level.
     * Level 0 = not activated.
     */
    function getTalentMaxLevel(talent, promotion) {
        if (!talent?.stages?.length) return 0
        // Level = stage index + 1. Count how many stages are reachable at current promotion.
        let maxLvl = 0
        for (let i = 0; i < talent.stages.length; i++) {
            const stage = talent.stages[i]
            if (stage.promotion != null && promotion >= stage.promotion) {
                maxLvl = i + 1
            }
        }
        return maxLvl
    }

    // ── Buff config dirty tracking ──
    // Marks a track as needing buff recalculation when config changes that
    // affect buffs (weapon, equipment set, talent activation/deactivation).
    // Pure stat changes (tier, level) don't set this flag.
    function markBuffConfigDirty(trackId) {
        const track = tracks.value.find(t => t.id === trackId)
        if (track) track._buffConfigDirty = true
    }
    function clearBuffConfigDirty(trackId) {
        const track = tracks.value.find(t => t.id === trackId)
        if (track) track._buffConfigDirty = false
    }
    function isBuffConfigDirty(trackId) {
        const track = tracks.value.find(t => t.id === trackId)
        return !!track?._buffConfigDirty
    }

    function setTrackTalentLevel(trackId, talentId, level) {
        const g = getTrackGrowth(trackId)
        if (!g.talentLevels) g.talentLevels = {}
        const opData = loadOperator(trackId)
        const talent = opData.talents?.talents?.find(t => t.id === talentId)
        const maxLvl = talent ? getTalentMaxLevel(talent, g.promotion) : 0
        const oldLevel = g.talentLevels[talentId] ?? maxLvl
        const newLevel = Math.max(0, Math.min(maxLvl, Math.round(level)))
        g.talentLevels[talentId] = newLevel
        // Mark dirty if talent activated (0→N) or deactivated (N→0)
        if ((oldLevel === 0 && newLevel > 0) || (oldLevel > 0 && newLevel === 0)) {
            markBuffConfigDirty(trackId)
        }
        commitState()
    }

    /** Get current talent level for a track, defaulting to max achievable */
    function getTrackTalentLevel(trackId, talentId) {
        const g = getTrackGrowth(trackId)
        if (g.talentLevels?.[talentId] !== undefined) return g.talentLevels[talentId]
        // Default: max out at current promotion
        const opData = loadOperator(trackId)
        const talent = opData.talents?.talents?.find(t => t.id === talentId)
        return talent ? getTalentMaxLevel(talent, g.promotion) : 0
    }

    // ── Base attribute lookup (wiki data → per-level stats) ──
    const _getWikiData = createWikiDataLoader()
    const _wikiIndex = import.meta.glob(
        '../external-data/warfarin-wiki/operators/index.json',
        { eager: true, import: 'default' }
    )
    const _wikiIndexArr = Object.values(_wikiIndex)[0] || []

    function _getWikiSlug(operatorId) {
        if (!operatorId) return null
        const entry = _wikiIndexArr.find(w => w.id === operatorId || w.id === operatorId.toUpperCase())
        return entry?.slug || null
    }

    /**
     * Look up an operator's base stats at a given level.
     * Pure lookup — no weapon/equipment/buff modifiers included.
     *
     * Priority: new static data (src/data/operators/) → wiki data fallback.
     *
     * @param {string} operatorId — character / track ID
     * @param {number} level — character level (1–90)
     * @returns {{ strength, agility, intellect, will, attack, hp } | null}
     */
    function resolveBaseStats(operatorId, level) {
        // Try new per-operator static data first (migrated operators only)
        const fromStatic = lookupOperatorStats(operatorId, level)
        if (fromStatic) return fromStatic

        // Fallback: wiki normalized data
        const slug = _getWikiSlug(operatorId)
        if (!slug) return null
        const wikiData = _getWikiData(slug)
        return lookupBaseStats(wikiData, level)
    }

    /**
     * Convenience: resolve base stats for a track using its current growth config.
     * @param {string} trackId — also the operatorId (track.id === operatorId in this project)
     * @returns {{ strength, agility, intellect, will, attack, hp } | null}
     */
    function resolveTrackBaseStats(trackId) {
        const track = tracks.value.find(t => t.id === trackId)
        if (!track) return null
        const g = getTrackGrowth(trackId)
        return resolveBaseStats(trackId, g.characterLevel)
    }

    // ── Final stats aggregation (base + weapon/equipment deltas) ──
    // Base attributes come from wiki level tables (6 fields).
    // track.stats holds weapon/equipment modifier deltas for all CORE_STATS fields.
    // Final = base + deltas.  Not persisted — call on demand.

    /** Fields that come from the wiki base-stats lookup */
    const BASE_STAT_FIELDS = ['strength', 'agility', 'intellect', 'will', 'attack', 'hp']

    // ══════════════════════════════════════════════════════════════════════
    // STATS LAYER MODEL
    //
    // Layer 1 — BASE STATS (resolveTrackBaseStats)
    //   Pure per-level lookup from stats.json.  6 fields only.
    //   Changes when: characterLevel changes.
    //
    // Layer 2 — CONFIGURED STATS (resolveTrackConfiguredStats)
    //   Base stats + weapon/equipment modifier deltas.  All CORE_STATS fields.
    //   Also resolves primary_ability / secondary_ability.
    //   This is the "build panel" value — what the character sheet shows
    //   before entering combat.
    //   Changes when: level, weapon, equipment, or refine tier changes.
    //
    // Layer 3 — DYNAMIC STATS (future — NOT yet implemented)
    //   Configured stats + combat buffs/debuffs/skill states.
    //   Changes every frame during simulation.
    //   Will be computed per-tick by the runtime, NOT stored on track.
    // ══════════════════════════════════════════════════════════════════════

    // ── Talent array row 1: main-attribute bonus per promotion stage ──
    // E1: +10, E2: +15, E3: +15, E4: +20 to the operator's main attribute
    const TALENT_ROW1_BONUSES = [0, 10, 15, 15, 20] // index = promotion stage

    /**
     * Compute the total talent row 1 bonus for a given promotion level.
     * Cumulative: promo 1→+10, promo 2→+25, promo 3→+40, promo 4→+60
     */
    function getTalentRow1Bonus(promotion) {
        let total = 0
        for (let i = 1; i <= Math.min(promotion, 4); i++) total += TALENT_ROW1_BONUSES[i]
        return total
    }

    /**
     * Layer 2: Configured stats — base attributes + weapon/equipment deltas + talent row 1 bonus.
     * This is the character's "build panel" value before combat buffs.
     *
     * @param {string} trackId
     * @returns {Object|null}  All CORE_STATS fields + primary/secondary_ability.
     */
    function resolveTrackConfiguredStats(trackId) {
        const track = tracks.value.find(t => t.id === trackId)
        if (!track) return null

        const base = resolveTrackBaseStats(trackId)
        const stats = track.stats || createDefaultStats()

        const result = {}
        for (const stat of CORE_STATS) {
            const deltaVal = Number(stats[stat.id]) || stat.default
            const baseVal = (base && BASE_STAT_FIELDS.includes(stat.id)) ? (base[stat.id] || 0) : 0
            result[stat.id] = baseVal + deltaVal
        }

        const opMeta = loadOperator(trackId).meta

        // Talent row 1: main-attribute bonus based on promotion
        const g = getTrackGrowth(trackId)
        if (opMeta?.mainAttribute && result[opMeta.mainAttribute] !== undefined) {
            result[opMeta.mainAttribute] += getTalentRow1Bonus(g.promotion)
        }

        // Talent + potential effects aggregation
        const activeEffects = resolveTrackActiveEffects(trackId)
        const allEffects = [
            ...(activeEffects.activeTalents?.flatMap(t => t.activeStage?.effects || []) || []),
            ...(activeEffects.activePotentials?.flatMap(p => p.effects || []) || []),
        ]
        // Phase 1: aggregate static stat_bonus and damage_bonus into result
        for (const eff of allEffects) {
            if (eff.scope !== 'static') continue
            if ((eff.type === 'stat_bonus' || eff.type === 'damage_bonus') && eff.stat && result[eff.stat] !== undefined) {
                if (eff.scaling) {
                    // Attribute-scaling effect: stat += sum(from attributes) × perPoint
                    // e.g., LIFENG 顿悟: attack_percent += (intellect + will) × 0.10
                    const fromAttrs = eff.scaling.from || []
                    const perPoint = eff.scaling.perPoint || 0
                    let attrSum = 0
                    for (const attr of fromAttrs) {
                        attrSum += result[attr] || 0
                    }
                    result[eff.stat] += attrSum * perPoint
                } else {
                    result[eff.stat] += eff.value || 0
                }
            }
        }
        // Carry gauge_modifier and non-static effects as metadata (not in CORE_STATS, but visible to consumers)
        result._activeEffects = allEffects
        result._potentialLevel = activeEffects.potentialLevel ?? 0

        // Apply equipment set passive stats (3-piece set bonus)
        const activeSets = getActiveSetBonusCategories(trackId)
        for (const cat of activeSets) {
            const cfg = getEquipmentCategoryConfig(cat)
            const override = getEquipmentCategoryOverride(cat)
            const passiveStats = override?.passiveStats ?? cfg?.passiveStats
            if (passiveStats) {
                for (const [stat, value] of Object.entries(passiveStats)) {
                    if (result[stat] !== undefined) {
                        result[stat] += Number(value) || 0
                    }
                }
            }
        }

        // Apply attack_percent to attack (ATK% from weapon common slots / passiveStats)
        // Formula: attack = floor(attack * (1 + attack_percent / 100))
        if (result.attack_percent) {
            result.attack = Math.floor(result.attack * (1 + result.attack_percent / 100))
        }

        // Resolve primary_ability / secondary_ability from operator's main/sub attribute.
        // primary_ability = main attribute total + any direct primary_ability modifier from weapon/equipment.
        const directPrimaryDelta = Number(stats.primary_ability) || 0
        const directSecondaryDelta = Number(stats.secondary_ability) || 0
        if (opMeta?.mainAttribute && result[opMeta.mainAttribute] !== undefined) {
            result.primary_ability = result[opMeta.mainAttribute] + directPrimaryDelta
        }
        if (opMeta?.subAttribute && result[opMeta.subAttribute] !== undefined) {
            result.secondary_ability = result[opMeta.subAttribute] + directSecondaryDelta
        }

        return result
    }

    // Backward-compat alias (used by buildSimulationTracks and OperatorInfoPanel)
    const resolveTrackFinalStats = resolveTrackConfiguredStats

    // ── Active talents & potentials aggregation ──
    // Resolves current talent levels and active potentials based on growth config.
    // Talent levels are independently configurable (not hardwired to promotion).
    // Promotion only constrains the max achievable level.
    function resolveTrackActiveEffects(trackId) {
        const g = getTrackGrowth(trackId)
        const opData = loadOperator(trackId)
        const talents = opData.talents?.talents || []
        const potentials = opData.potentials?.potentials || []

        const activeTalents = talents.map(t => {
            const currentLevel = getTrackTalentLevel(trackId, t.id)
            const maxLevel = getTalentMaxLevel(t, g.promotion)
            // Resolve which stage description is active at currentLevel
            // Level 0 = inactive, Level 1 = first stage, Level 2 = second stage, etc.
            let activeStage = null
            if (currentLevel > 0 && t.stages?.length) {
                const stageIdx = Math.min(currentLevel - 1, t.stages.length - 1)
                activeStage = t.stages[stageIdx] || null
            }
            return {
                id: t.id,
                name: t.name,
                icon: t.icon,
                currentLevel,
                maxLevel,
                maxPossibleLevel: t.stages?.length || 0,
                activeStage,
                defaultUnlock: t.defaultUnlock || false,
            }
        })

        const activePotentials = potentials
            .filter(p => g.potentialLevel >= p.level)
            .map(p => ({ level: p.level, description: p.description, effects: p.effects || [] }))

        return {
            promotion: g.promotion,
            potentialLevel: g.potentialLevel,
            activeTalents,
            activePotentials,
            totalPotentials: potentials.length,
        }
    }

    const createEmptyTrack = () => ({
        id: null,
        actions: [],
        growth: createDefaultGrowth(),
        initialGauge: 0,
        maxGaugeOverride: null,
        gaugeEfficiency: 100,
        originiumArtsPower: 0,
        weaponId: null,
        weaponLevel: 90,
        weaponCommon1Tier: WEAPON_POTENTIAL_MAX_TIER,
        weaponCommon2Tier: WEAPON_POTENTIAL_MAX_TIER,
        weaponBuffTier: WEAPON_POTENTIAL_MAX_TIER,
        weaponAppliedDeltas: {},
        equipmentAppliedDeltas: {},
        stats: createDefaultStats(),
        equipArmorId: null,
        equipGlovesId: null,
        equipAccessory1Id: null,
        equipAccessory2Id: null,
        equipArmorRefineTier: EQUIPMENT_REFINE_MAX_TIER,
        equipGlovesRefineTier: EQUIPMENT_REFINE_MAX_TIER,
        equipAccessory1RefineTier: EQUIPMENT_REFINE_MAX_TIER,
        equipAccessory2RefineTier: EQUIPMENT_REFINE_MAX_TIER,
        linkCdReduction: 0,
    })

    const createDefaultTracks = () => [
        createEmptyTrack(),
        createEmptyTrack(),
        createEmptyTrack(),
        createEmptyTrack(),
    ]

    const tracks = ref(createDefaultTracks())
    const connections = ref([])
    const characterOverrides = ref({})
    const weaponOverrides = ref({})
    const equipmentCategoryOverrides = ref({})
    const weaponStatuses = ref([])
    const teamBuffStatuses = ref([])
    const debuffStatuses = ref([])

    const connectionMap = computed(() => {
        const map = new Map()
        for (const conn of connections.value) {
            map.set(conn.id, conn)
        }
        return map
    })

    const actionMap = computed(() => {
        const map = new Map()
        for (let i = 0; i < tracks.value.length; i++) {
            const track = tracks.value[i]
            for (const action of track.actions) {
                map.set(action.instanceId, {
                    trackId: track.id,
                    trackIndex: i,
                    node: action,
                    type: 'action',
                    id: action.instanceId,
                })
            }
        }
        return map
    })

    const effectsMap = computed(() => {
        const map = new Map()
        for (const track of tracks.value) {
            for (const action of track.actions) {
                if (!action.physicalAnomaly || !action.physicalAnomaly.length) {
                    continue
                }
                let currentFlatIndex = 0
                for (let i = 0; i < action.physicalAnomaly.length; i++) {
                    const row = action.physicalAnomaly[i]
                    for (let j = 0; j < row.length; j++) {
                        const effect = row[j]
                        map.set(effect._id, {
                            id: effect._id,
                            node: effect,
                            actionId: action.instanceId,
                            rowIndex: i,
                            colIndex: j,
                            flatIndex: currentFlatIndex++,
                            type: 'effect'
                        })
                    }
                }
            }
        }
        return map
    })

    const statusMap = computed(() => {
        const map = new Map()
        for (const status of weaponStatuses.value) {
            if (!status?.id) continue
            const trackIndex = tracks.value.findIndex(t => t?.id && t.id === status.trackId)
            map.set(status.id, {
                id: status.id,
                node: status,
                trackId: status.trackId,
                trackIndex,
                type: 'status'
            })
        }
        return map
    })

    function setBaseBlockWidth(val) {
        const sanitizedVal = Math.min(ZOOM_LIMITS.MAX, Math.max(ZOOM_LIMITS.MIN, val))
        BASE_BLOCK_WIDTH.value = sanitizedVal
    }

    function getConnectionById(connectionId) {
        return connectionMap.value.get(connectionId)
    }

    function getActionById(actionId) {
        return actionMap.value.get(actionId)
    }

    function getEffectById(effectId) {
        return effectsMap.value.get(effectId)
    }

    function getStatusById(statusId) {
        return statusMap.value.get(statusId)
    }

    function resolveNode(nodeId) {
        return getActionById(nodeId) || getEffectById(nodeId) || getStatusById(nodeId)
    }

    function getNodesOfConnection(connectionId) {
        const conn = getConnectionById(connectionId)
        if (!conn) {
            return { fromNode: null, toNode: null }
        }

        const fromId = conn.fromNodeId || conn.fromEffectId || conn.from || null
        const toId = conn.toNodeId || conn.toEffectId || conn.to || null

        const fromNode = fromId ? resolveNode(fromId) : null
        const toNode = toId ? resolveNode(toId) : null

        return { fromNode, toNode }
    }

    function _getConnectionEndpointId(conn, side) {
        if (!conn) return null
        if (side === 'from') return conn.fromNodeId || conn.fromEffectId || conn.from || null
        return conn.toNodeId || conn.toEffectId || conn.to || null
    }

    function normalizeConnection(rawConn) {
        if (!rawConn) return null
        const conn = { ...rawConn }

        const fromId = _getConnectionEndpointId(conn, 'from')
        const toId = _getConnectionEndpointId(conn, 'to')

        if (fromId) conn.fromNodeId = fromId
        if (toId) conn.toNodeId = toId

        const fromNode = fromId ? resolveNode(fromId) : null
        const toNode = toId ? resolveNode(toId) : null

        if (!conn.fromNodeType && fromNode?.type) conn.fromNodeType = fromNode.type
        if (!conn.toNodeType && toNode?.type) conn.toNodeType = toNode.type

        if (fromNode?.type === 'effect') {
            conn.fromEffectId = fromNode.id
            conn.fromEffectIndex = fromNode.flatIndex
            conn.from = fromNode.actionId
        } else if (fromNode?.type === 'action') {
            conn.from = fromNode.id
        }

        if (toNode?.type === 'effect') {
            conn.toEffectId = toNode.id
            conn.toEffectIndex = toNode.flatIndex
            conn.to = toNode.actionId
        } else if (toNode?.type === 'action') {
            conn.to = toNode.id
        }

        return conn
    }

    function normalizeConnections(list) {
        if (!Array.isArray(list)) return []
        const out = []
        for (const conn of list) {
            const normalized = normalizeConnection(conn)
            if (normalized) out.push(normalized)
        }
        return out
    }

    function pruneDanglingConnections() {
        const before = connections.value.length
        connections.value = connections.value.filter(conn => {
            const fromId = _getConnectionEndpointId(conn, 'from')
            const toId = _getConnectionEndpointId(conn, 'to')
            if (!fromId || !toId) return false
            return !!resolveNode(fromId) && !!resolveNode(toId)
        })
        return before - connections.value.length
    }

    function _connectionTouchesAnyActionId(conn, actionIds) {
        if (!conn || !actionIds || actionIds.size === 0) return false
        const fromId = _getConnectionEndpointId(conn, 'from')
        const toId = _getConnectionEndpointId(conn, 'to')
        if (!fromId || !toId) return false

        const check = (nodeId) => {
            const node = resolveNode(nodeId)
            if (!node) return false
            if (node.type === 'action') return actionIds.has(node.id)
            if (node.type === 'effect') return actionIds.has(node.actionId)
            return false
        }

        return check(fromId) || check(toId)
    }

    function _connectionTouchesStatusId(conn, statusId) {
        if (!conn || !statusId) return false
        const fromId = _getConnectionEndpointId(conn, 'from')
        const toId = _getConnectionEndpointId(conn, 'to')
        return fromId === statusId || toId === statusId
    }

    function updateTrackGaugeEfficiency(trackId, value) {
        const track = tracks.value.find(t => t.id === trackId);
        if (track) {
            const cleanValue = snapMs(Number(value));

            track.gaugeEfficiency = cleanValue;
            if (!track.stats) track.stats = createDefaultStats();
            track.stats.ult_charge_eff = cleanValue;
            commitState();
        }
    }

    function updateTrackOriginiumArtsPower(trackId, value) {
        const track = tracks.value.find(t => t.id === trackId);
        if (track) {
            track.originiumArtsPower = value;
            if (!track.stats) track.stats = createDefaultStats()
            track.stats.originium_arts_power = Number(value) || 0
            commitState();
        }
    }

    function updateTrackLinkCdReduction(trackId, value) {
        const track = tracks.value.find(t => t.id === trackId);
        if (track) {
            track.linkCdReduction = clampPercent(value);
            if (!track.stats) track.stats = createDefaultStats()
            track.stats.link_cd_reduction = Number(track.linkCdReduction) || 0
            commitState();
        }
    }

    function updateTrackWeapon(trackId, weaponId) {
        const track = tracks.value.find(t => t.id === trackId);
        if (track) {
            track.weaponId = weaponId || null;
            if (selectedLibrarySource.value === 'weapon') {
                selectedLibrarySkillId.value = null;
                selectedLibrarySource.value = 'character';
            }
            weaponStatuses.value = weaponStatuses.value.filter(s => !(s.trackId === track.id && (!s.type || s.type === 'weapon')));
            pruneDanglingConnections()
            syncTrackWeaponModifiers(trackId)
            markBuffConfigDirty(trackId)
            commitState();
        }
    }

    function updateTrackWeaponTier(trackId, part, tier) {
        const track = tracks.value.find(t => t.id === trackId)
        if (!track) return
        const nextTier = clampTier9(tier)
        if (part === 'common1') track.weaponCommon1Tier = nextTier
        else if (part === 'common2') track.weaponCommon2Tier = nextTier
        else if (part === 'buff') track.weaponBuffTier = nextTier
        else return
        syncTrackWeaponModifiers(trackId)
        commitState()
    }

    function updateTrackEquipment(trackId, slotKey, equipmentId) {
        const track = tracks.value.find(t => t.id === trackId);
        if (!track) return;

        const normalizedId = equipmentId || null

        if (slotKey === 'armor') track.equipArmorId = normalizedId
        else if (slotKey === 'gloves') track.equipGlovesId = normalizedId
        else if (slotKey === 'accessory1') track.equipAccessory1Id = normalizedId
        else if (slotKey === 'accessory2') track.equipAccessory2Id = normalizedId

        const eq = getEquipmentById(normalizedId)
        if (!eq || Number(eq.level) !== 70) {
            updateTrackEquipmentTier(trackId, slotKey, 0, { commit: false })
        }

        syncTrackEquipmentModifiers(trackId)
        markBuffConfigDirty(trackId)
        commitState()
    }

    function updateTrackEquipmentTier(trackId, slotKey, tier, { commit = true } = {}) {
        const track = tracks.value.find(t => t.id === trackId)
        if (!track) return

        const next = clampEquipmentRefineTier(tier)
        const eq = getEquipmentById(getEquipmentIdForSlot(track, slotKey))
        const enforced = (eq && Number(eq.level) === 70) ? next : 0

        if (slotKey === 'armor') track.equipArmorRefineTier = enforced
        else if (slotKey === 'gloves') track.equipGlovesRefineTier = enforced
        else if (slotKey === 'accessory1') track.equipAccessory1RefineTier = enforced
        else if (slotKey === 'accessory2') track.equipAccessory2RefineTier = enforced
        else return

        syncTrackEquipmentModifiers(trackId)
        if (commit) commitState()
    }

    // ===================================================================================
    // 交互状态
    // ===================================================================================

    const activeTrackId = ref(null)
    const timelineScrollTop = ref(0)
    const timelineShift = ref(0)
    const timelineRect = ref({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 })

    const trackLaneRects = ref({})

    const showCursorGuide = ref(false)
    const cursorPosition = ref({ x: 0, y: 0 })
    const snapStep = ref(0.1)

    const draggingSkillData = ref(null)

    const selectedConnectionId = ref(null)
    const selectedActionId = ref(null)
    const selectedLibrarySkillId = ref(null)
    const selectedLibrarySource = ref('character')
    const selectedAnomalyId = ref(null)
    const selectedWeaponStatusId = ref(null)
    const weaponDetailOpen = ref(false)
    const selectedPotentialData = ref(null) // { level, description, potentialLevel }

    const selectedCycleBoundaryId = ref(null)
    const switchEvents = ref([])
    const selectedSwitchEventId = ref(null)
    const mainControlEvents = ref([])  // [{ id, trackId, time }] sorted by time
    const selectedMcEventId = ref(null)

    const multiSelectedIds = ref(new Set())
    const isBoxSelectMode = ref(false)
    const clipboard = ref(null)

    const isCapturing = ref(false)

    /**
     * Legality validation policy — the single source that feeds into simulate().
     * Three modes:
     *   "sandbox" — allow everything, record issues silently
     *   "audit"   — allow everything, record issues with warnings (验轴模式)
     *   "strict"  — block illegal actions in simulation
     *
     * validateSkillPlacement remains as a fast UI placement pre-check.
     */
    const legalityPolicy = ref('sandbox')

    /** Backward-compat: strictMode derived from legalityPolicy. */
    const strictMode = computed(() => legalityPolicy.value === 'strict')

    const LEGALITY_CYCLE = ['sandbox', 'audit', 'strict']

    // ── Timeline mode — controls skill library display scope ──
    // 'free':   show everything (current default — preserves full test capability)
    // 'normal': hide variants that lack allowedTypes (already handled by runtime auto-switch)
    // 'strict': hide ALL variants, show only base skills
    // NOTE: mode only affects ActionLibrary display. Already-placed actions are never removed.
    const timelineMode = ref('free')
    const TIMELINE_MODE_CYCLE = ['free', 'normal', 'strict']

    function cycleTimelineMode() {
        const idx = TIMELINE_MODE_CYCLE.indexOf(timelineMode.value)
        timelineMode.value = TIMELINE_MODE_CYCLE[(idx + 1) % TIMELINE_MODE_CYCLE.length]
    }

    // ── Timeline Editor Mode (Free / Realistic) ──
    const timelineEditorMode = ref('free')    // 'free' | 'realistic'
    const playheadTime = ref(0)               // seconds, realistic mode playhead position
    const validationResult = ref(null)        // { passed: bool, issues: [] }
    const validationDialogVisible = ref(false)
    const validationPassed = ref(false)       // gate for future feature pages

    function setTimelineEditorMode(mode) {
        if (mode !== 'free' && mode !== 'realistic') return
        const prev = timelineEditorMode.value
        timelineEditorMode.value = mode
        // Sync internal legality policy
        legalityPolicy.value = mode === 'realistic' ? 'strict' : 'sandbox'
        // Always show all skills (dimming handled separately in realistic mode)
        timelineMode.value = 'free'
        // When switching to realistic: set playhead after the latest existing action
        if (mode === 'realistic' && prev !== 'realistic') {
            let maxEnd = 0
            for (const track of tracks.value) {
                for (const action of track.actions) {
                    const end = (Number(action.startTime) || 0) + (Number(action.duration) || 0)
                    if (end > maxEnd) maxEnd = end
                }
            }
            playheadTime.value = snapMs(maxEnd)
        }
    }

    function setPlayheadTime(newTime) {
        if (timelineEditorMode.value !== 'realistic') return
        const snapped = snapMs(Math.max(0, newTime))
        if (snapped >= playheadTime.value) {
            // Forward move — allowed directly
            playheadTime.value = snapped
            return { requiresConfirmation: false }
        }
        // Backward move — check for actions that would be deleted
        const actionsToDelete = []
        for (const track of tracks.value) {
            for (const action of track.actions) {
                if (action.startTime > snapped) {
                    actionsToDelete.push({ trackId: track.id, action })
                }
            }
        }
        if (actionsToDelete.length === 0) {
            playheadTime.value = snapped
            return { requiresConfirmation: false }
        }
        return { requiresConfirmation: true, actionsToDelete, targetTime: snapped }
    }

    function confirmPlayheadRewind(targetTime) {
        commitState()
        const snapped = snapMs(Math.max(0, targetTime))
        for (const track of tracks.value) {
            track.actions = track.actions.filter(a => a.startTime <= snapped)
        }
        // Also remove weapon/set statuses after target time
        weaponStatuses.value = weaponStatuses.value.filter(s => s.startTime <= snapped)
        playheadTime.value = snapped
        commitState()
    }

    function advancePlayheadAfterPlacement(skill, startTime, trackId, instanceId) {
        if (timelineEditorMode.value !== 'realistic') return

        // Resolve effective duration: use variant override if conditions are met
        const variantOverride = instanceId ? computedEffectiveActions.value.get(instanceId) : null
        const duration = Number(variantOverride?.duration ?? skill.duration) || 0
        const isMc = trackId && trackId === getMainControlTrackAt(startTime)

        // Use ceil rounding to ensure playhead is at or past the action end,
        // avoiding false overlap detection due to floating point precision
        const ceilMs = v => Math.ceil(Number(v) * 1000) / 1000

        if (skill.type === 'ultimate') {
            // Ultimate always pauses the game — jump past animation
            playheadTime.value = ceilMs(startTime + (Number(skill.animationTime) || 1.5))
        } else if (skill.type === 'link') {
            // Link animation allows chaining more links — don't advance
        } else if (isMc) {
            // Main control operator is busy for skill duration — jump to end
            playheadTime.value = ceilMs(startTime + duration)
        }
        // Non-MC operators: playhead stays (their skills don't block gameplay)
    }

    // ── Realistic Mode: Playhead Movement & Playback ──
    const realisticMoveStep = ref(0.1)
    const MOVE_STEP_OPTIONS = [0.1, 0.5, 1, 5]
    const isPlaybackActive = ref(false)
    const PLAYBACK_SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.5, 2]
    const playbackSpeed = ref(1)
    let _playheadDirtyFlag = false

    function cycleMoveStep(direction) {
        const idx = MOVE_STEP_OPTIONS.indexOf(realisticMoveStep.value)
        const next = idx + direction
        if (next >= 0 && next < MOVE_STEP_OPTIONS.length) {
            realisticMoveStep.value = MOVE_STEP_OPTIONS[next]
        }
    }

    function movePlayheadByStep(direction) {
        if (timelineEditorMode.value !== 'realistic' || _warningActive) return
        stopPlayback()
        // Commit before first move after last commit (undo returns to pre-movement position)
        if (!_playheadDirtyFlag) {
            commitState()
            _playheadDirtyFlag = true
        }
        const newTime = snapMs(Math.max(0, Math.min(
            playheadTime.value + direction * realisticMoveStep.value,
            viewDuration.value
        )))
        if (direction < 0 && newTime < playheadTime.value) {
            // Backward — use setPlayheadTime for rewind guard
            const result = setPlayheadTime(newTime)
            return result
        }
        playheadTime.value = newTime
        return { requiresConfirmation: false }
    }

    /**
     * Shift+Left/Right: jump to action start/end boundaries.
     * direction: +1 = forward (right), -1 = backward (left)
     *
     * If playhead is inside an action:
     *   +1 → jump to that action's end
     *   -1 → jump to that action's start
     * If playhead is between actions:
     *   +1 → jump to next action's start
     *   -1 → jump to previous action's end
     */
    function jumpToActionBoundary(direction) {
        if (timelineEditorMode.value !== 'realistic' || _warningActive) return
        stopPlayback()
        const t = playheadTime.value
        const eps = 0.001

        // Collect all action boundaries across all tracks
        // Use variant-overridden duration when available
        const boundaries = []
        for (const track of tracks.value) {
            for (const action of track.actions) {
                const start = Number(action.startTime) || 0
                const variantOverride = computedEffectiveActions.value.get(action.instanceId)
                const dur = Number(variantOverride?.duration ?? action.duration) || 0
                const end = start + dur
                boundaries.push({ start, end })
            }
        }

        // Check if playhead is within an action (including at start, excluding end)
        const containing = boundaries.find(b => t >= b.start - eps && t < b.end - eps)
        // Check if playhead is exactly at the start of the containing action
        const atStart = containing && Math.abs(t - containing.start) < eps

        if (!_playheadDirtyFlag) {
            commitState()
            _playheadDirtyFlag = true
        }

        let target = null
        if (containing && !(atStart && direction < 0)) {
            // Inside an action: forward → end, backward → start
            // Exception: at start + backward → treat as "between" (find prev end)
            if (direction > 0) {
                target = containing.end
            } else {
                target = containing.start
            }
        } else {
            // Between actions (or at start going backward)
            if (direction > 0) {
                let nearest = Infinity
                for (const b of boundaries) {
                    if (b.start > t + eps && b.start < nearest) nearest = b.start
                }
                if (nearest < Infinity) target = nearest
            } else {
                let nearest = -Infinity
                for (const b of boundaries) {
                    if (b.end < t - eps && b.end > nearest) nearest = b.end
                }
                if (nearest > -Infinity) target = nearest
            }
        }

        if (target === null) return { requiresConfirmation: false }
        // For forward jumps to action end, use ceil to avoid floating point
        // precision issues where snapMs rounds down, causing overlap detection
        const isForwardToEnd = direction > 0 && containing
        const snappedTarget = isForwardToEnd
            ? Math.ceil(target * 1000) / 1000
            : snapMs(target)
        if (snappedTarget < t) {
            // Backward — go through normal rewind guard
            return setPlayheadTime(snappedTarget)
        }
        playheadTime.value = snappedTarget
        return { requiresConfirmation: false }
    }

    function togglePlayback() {
        if (timelineEditorMode.value !== 'realistic' || _warningActive) return
        if (isPlaybackActive.value) {
            stopPlayback()
        } else {
            // Commit before playback starts
            if (!_playheadDirtyFlag) {
                commitState()
                _playheadDirtyFlag = true
            }
            isPlaybackActive.value = true
        }
    }

    function stopPlayback() {
        isPlaybackActive.value = false
    }

    function cyclePlaybackSpeed(direction = 1) {
        const idx = PLAYBACK_SPEED_OPTIONS.indexOf(playbackSpeed.value)
        const next = idx + direction
        if (next >= 0 && next < PLAYBACK_SPEED_OPTIONS.length) {
            playbackSpeed.value = PLAYBACK_SPEED_OPTIONS[next]
        }
    }

    // ── Realistic Mode: Skill Shortcuts ──

    function findSkillForTrack(trackId, type) {
        // Find base (non-variant) skill of given type for a track's character
        const charInfo = characterRoster.value.find(c => c.id === trackId)
        if (!charInfo) return null
        // Search the full skill library for this character
        const allSkills = activeSkillLibrary.value
        // Filter by type, prefer non-variant base skill
        const candidates = allSkills.filter(s => s.type === type && !s.id.includes('_variant_'))
        return candidates[0] || allSkills.find(s => s.type === type) || null
    }

    /**
     * Find a skill of given type for a specific track's character.
     * Temporarily switches activeTrackId to read from activeSkillLibrary,
     * since skill objects are dynamically constructed from characterRoster fields.
     */
    function _findSkillForTrack(trackId, type) {
        const prevActiveId = activeTrackId.value
        const needSwitch = prevActiveId !== trackId
        if (needSwitch) activeTrackId.value = trackId
        const allSkills = activeSkillLibrary.value
        const match = allSkills.find(s => s.type === type && !s.id?.includes('_variant_'))
            || allSkills.find(s => s.type === type)
        if (needSwitch) activeTrackId.value = prevActiveId
        return match || null
    }

    function castSkillByShortcut(trackIndex, skillType) {
        if (timelineEditorMode.value !== 'realistic' || _warningActive) return
        const track = tracks.value[trackIndex]
        if (!track?.id) return

        const skill = _findSkillForTrack(track.id, skillType)
        if (!skill) {
            const label = skillType === 'skill' ? '战技' : skillType === 'ultimate' ? '终结技' : '连携技'
            ElMessage.warning({ message: `该角色没有${label}`, duration: 2000 })
            return
        }
        const avail = checkSkillAvailabilityAt(track.id, skill, playheadTime.value)
        if (!avail.available) {
            ElMessage.warning({ message: avail.reasons.join(', ') || '无法施放', duration: 2000 })
            return
        }
        _playheadDirtyFlag = false
        addSkillToTrack(track.id, skill, playheadTime.value)
    }

    function castLinkByShortcut() {
        if (timelineEditorMode.value !== 'realistic' || _warningActive) return
        const queue = linkQueueAtPlayhead.value
        if (!queue?.length) {
            ElMessage.warning({ message: '无可用连携技', duration: 2000 })
            return
        }
        const first = queue[0]
        if (first.isLocked) return  // operator busy, E does nothing silently
        if (first.onCooldown) return

        const linkSkill = _findSkillForTrack(first.trackId, 'link')
        if (!linkSkill) return
        _playheadDirtyFlag = false
        // skipConditions: queue's 6s window already validated the trigger condition
        addSkillToTrack(first.trackId, linkSkill, playheadTime.value, { skipConditions: true })
    }

    // ── Blocking warning (prevents input spam) ──
    let _warningActive = false

    function showBlockingWarning(msg) {
        if (_warningActive) return
        _warningActive = true
        stopPlayback()
        ElMessageBox.alert(msg, '提示', {
            confirmButtonText: '确认',
            showClose: true,
            closeOnPressEscape: true,
        }).finally(() => { _warningActive = false })
    }

    function isWarningActive() { return _warningActive }

    function showBlockingRewind(result) {
        if (_warningActive) return
        _warningActive = true
        stopPlayback()
        const count = result.actionsToDelete.length
        ElMessageBox.confirm(
            `将播放头移动到 ${result.targetTime.toFixed(1)}s 将删除 ${count} 个技能，是否继续？`,
            '确认回退',
            { confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning', closeOnPressEscape: true, showClose: true }
        ).then(() => {
            confirmPlayheadRewind(result.targetTime)
        }).catch(() => {}).finally(() => { _warningActive = false })
    }

    /**
     * Switch main control to a specific track (F1-F4) or cycle to next (Q).
     * Respects the 2s main control switch CD.
     */
    function switchMainControlTo(trackId) {
        if (timelineEditorMode.value !== 'realistic' || _warningActive) return
        const time = playheadTime.value
        const currentMc = getMainControlTrackAt(time)
        if (currentMc === trackId) return
        const ok = setMainControl(trackId, time)
        if (!ok) {
            showBlockingWarning('主控切换冷却中')
        }
    }

    function cycleMainControl() {
        if (timelineEditorMode.value !== 'realistic' || _warningActive) return
        const time = playheadTime.value
        const currentMc = getMainControlTrackAt(time)
        const validTracks = tracks.value.filter(t => t.id)
        if (validTracks.length === 0) return
        const currentIdx = validTracks.findIndex(t => t.id === currentMc)
        const nextIdx = (currentIdx + 1) % validTracks.length
        const nextTrack = validTracks[nextIdx]
        const ok = setMainControl(nextTrack.id, time)
        if (!ok) {
            showBlockingWarning('主控切换冷却中')
        }
    }

    function _cloneEffectsForAction(skillForClone) {
        const clonedAnomalies = skillForClone.physicalAnomaly ? JSON.parse(JSON.stringify(skillForClone.physicalAnomaly)) : []
        const anomalyRows = Array.isArray(clonedAnomalies?.[0]) ? clonedAnomalies : [clonedAnomalies]
        const effectIdMap = new Map()
        anomalyRows.forEach(row => {
            if (!Array.isArray(row)) return
            row.forEach(effect => {
                if (!effect) return
                const oldId = effect._id
                const newId = uid()
                effect._id = newId
                if (oldId) effectIdMap.set(oldId, newId)
            })
        })
        const clonedTicks = skillForClone.damageTicks ? JSON.parse(JSON.stringify(skillForClone.damageTicks)) : []
        clonedTicks.forEach(tick => {
            if (!tick || !Array.isArray(tick.boundEffects) || tick.boundEffects.length === 0) return
            tick.boundEffects = tick.boundEffects.map(id => effectIdMap.get(id) || id)
        })
        return { clonedAnomalies, clonedTicks }
    }

    /**
     * Get the main control operator's trackId at a given time.
     * Returns the trackId of whoever has main control, or null if no MC events.
     */
    function getMainControlTrackAt(time) {
        const validIds = new Set(tracks.value.map(t => t.id))
        const events = [...mainControlEvents.value]
            .filter(e => validIds.has(e.trackId))
            .sort((a, b) => a.time - b.time)
        if (events.length === 0) return tracks.value[0]?.id || null
        let current = events[0].trackId
        for (const ev of events) {
            if (ev.time > time + 0.0001) break
            current = ev.trackId
        }
        return current
    }

    /**
     * Cast a single basic attack for the main control operator at playhead time.
     * Uses the existing attack_auto logic which handles combo chaining.
     */
    // Check if a track is in ultimate enhancement window at the current playhead
    function _isUltimateActiveAt(trackId, time) {
        const track = tracks.value.find(t => t.id === trackId)
        if (!track) return false
        return track.actions?.some(a =>
            a.type === 'ultimate' && !a.isDisabled && (() => {
                const start = Number(a.startTime) || 0
                const animT = Number(a.animationTime) || 0
                const enhT = Number(a.enhancementTime) || 0
                let end = start + animT + enhT
                if (typeof ULTIMATE_ENHANCEMENT_EXTENDERS[trackId] === 'function') {
                    const metrics = getUltimateEnhancementMetrics(a.instanceId)
                    if (metrics?.finalEnd) end = metrics.finalEnd
                }
                return time >= start && time < end
            })()
        ) || false
    }

    // Get the attack segments to use (variant segments during ultimate, normal otherwise)
    function _getActiveAttackSegments(trackId) {
        const charInfo = characterRoster.value.find(c => c.id === trackId)
        if (!charInfo) return []
        if (_isUltimateActiveAt(trackId, playheadTime.value)) {
            const attackConds = charInfo.releaseConditions?.attack
            if (attackConds?.length) {
                const sorted = [...attackConds].sort((a, b) => (b.priority || 0) - (a.priority || 0))
                for (const cond of sorted) {
                    if (!cond.conditions?.some(c => c.type === 'ultimateActive')) continue
                    const variantSuffix = cond.result?.variantId?.replace(`${trackId}_variant_`, '')
                    const variant = charInfo.variants?.find(v => v.id === variantSuffix)
                    if (variant?.attack_segments?.length) return variant.attack_segments
                }
            }
        }
        return charInfo.attack_segments || []
    }

    function castAttackByShortcut() {
        if (timelineEditorMode.value !== 'realistic' || _warningActive) return
        const mcTrackId = getMainControlTrackAt(playheadTime.value)
        if (!mcTrackId) {
            ElMessage.warning({ message: '无主控干员', duration: 2000 })
            return
        }
        const attackSkill = _findSkillForTrack(mcTrackId, 'attack')
        if (!attackSkill) {
            ElMessage.warning({ message: '该角色没有普通攻击', duration: 2000 })
            return
        }
        _playheadDirtyFlag = false
        addSkillToTrack(mcTrackId, attackSkill, playheadTime.value)
    }

    /**
     * Complete the current attack combo through to execution (重击).
     * Detects the current combo state at playhead, places remaining
     * attack segments, then places execution at the end.
     */
    function castFullAttackSequence() {
        if (timelineEditorMode.value !== 'realistic' || _warningActive) return
        const mcTrackId = getMainControlTrackAt(playheadTime.value)
        if (!mcTrackId) {
            ElMessage.warning({ message: '无主控干员', duration: 2000 })
            return
        }
        const charInfo = characterRoster.value.find(c => c.id === mcTrackId)
        const rawSegs = _getActiveAttackSegments(mcTrackId).filter(s => (Number(s?.duration) || 0) > 0)
        if (rawSegs.length === 0) {
            ElMessage.warning({ message: '该角色没有普通攻击', duration: 2000 })
            return
        }

        const track = tracks.value.find(t => t.id === mcTrackId)
        if (!track) return

        // Detect current combo state (reuse same logic as attack_auto placement)
        const sorted = [...track.actions]
            .filter(a => !a.isDisabled && (Number(a.startTime) || 0) < playheadTime.value)
            .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0))

        let lastAtkEnd = -Infinity
        let lastDodgeEnd = -Infinity
        let prevSeqIdx = 0
        let cumulOtherTime = 0

        for (const action of sorted) {
            const aStart = Number(action.startTime) || 0
            const aDur   = Number(action.duration)  || 0
            if (action.kind === 'attack_auto_placed' || action.kind === 'attack_segment') {
                prevSeqIdx = Number(action.attackSequenceIndex) || 1
                lastAtkEnd = aStart + aDur
                cumulOtherTime = 0
            } else if (action.type === 'execution') {
                prevSeqIdx = 0
                lastAtkEnd = aStart + aDur
                cumulOtherTime = 0
            } else if (action.type === 'dodge') {
                lastDodgeEnd = aStart + aDur
                cumulOtherTime = 0
            } else if (action.type !== 'attack') {
                const refTime = Math.max(lastAtkEnd, lastDodgeEnd)
                if (aStart >= refTime) cumulOtherTime += aDur
            }
        }

        const total = rawSegs.length
        const refTime = Math.max(lastAtkEnd, lastDodgeEnd)
        const idleTime = (playheadTime.value - refTime) - cumulOtherTime
        let startIdx = 0
        if (prevSeqIdx > 0 && prevSeqIdx < total && idleTime <= 1) startIdx = prevSeqIdx

        _playheadDirtyFlag = false
        commitState()

        const ceilMs = v => Math.ceil(Number(v) * 1000) / 1000
        const atkGroupName = getI18nSkillType('attack')
        let cursor = playheadTime.value

        // Place remaining attack segments
        for (let i = startIdx; i < total; i++) {
            const seg = rawSegs[i]
            const derivedElem = seg?.element || charInfo?.element || 'physical'
            const resolvedSkill = {
                id: `${mcTrackId}_attack_auto`,
                type: 'attack',
                kind: 'attack_auto_placed',
                name: `${atkGroupName} ${i + 1}`,
                librarySource: 'character',
                element: derivedElem,
                duration: Number(seg?.duration) || 1,
                cooldown: 0,
                gaugeGain: Number(seg?.gaugeGain) || 0,
                damageTicks: seg?.damage_ticks ? JSON.parse(JSON.stringify(seg.damage_ticks)) : [],
                physicalAnomaly: seg?.anomalies ? JSON.parse(JSON.stringify(seg.anomalies)) : [],
                allowedTypes: Array.isArray(seg?.allowed_types) ? [...seg.allowed_types] : [],
                attackSequenceIndex: i + 1,
                attackSequenceTotal: total,
                attackGroupName: atkGroupName,
            }
            const { clonedAnomalies, clonedTicks } = _cloneEffectsForAction(resolvedSkill)
            track.actions.push({
                ...resolvedSkill,
                instanceId: `inst_${uid()}`,
                librarySource: 'character',
                sourceWeaponId: track.weaponId || null,
                physicalAnomaly: clonedAnomalies,
                damageTicks: clonedTicks,
                logicalStartTime: cursor,
                startTime: cursor,
            })
            cursor = ceilMs(cursor + (Number(seg?.duration) || 1))
        }

        track.actions.sort((a, b) => a.startTime - b.startTime)
        commitState()
        playheadTime.value = cursor
    }

    // ── Manual Save ──

    function manualSave() {
        // Trigger immediate auto-save by reading current state and writing to localStorage
        try {
            const currentSc = scenarioList.value.find(s => s.id === activeScenarioId.value)
            if (currentSc) {
                currentSc.data = {
                    tracks: tracks.value,
                    connections: connections.value,
                    characterOverrides: characterOverrides.value,
                    weaponOverrides: weaponOverrides.value,
                    equipmentCategoryOverrides: equipmentCategoryOverrides.value,
                    weaponStatuses: weaponStatuses.value,
                    teamBuffStatuses: teamBuffStatuses.value,
                    debuffStatuses: debuffStatuses.value,
                    prepDuration: prepDuration.value,
                    prepExpanded: prepExpanded.value,
                    systemConstants: systemConstants.value,
                    activeEnemyId: activeEnemyId.value,
                    customEnemyParams: customEnemyParams.value,
                    cycleBoundaries: cycleBoundaries.value,
                    switchEvents: switchEvents.value,
                    mainControlEvents: mainControlEvents.value,
                }
            }
            const snapshot = {
                version: '1.0.0',
                timestamp: Date.now(),
                scenarioList: JSON.parse(JSON.stringify(scenarioList.value)),
                activeScenarioId: activeScenarioId.value,
                systemConstants: systemConstants.value,
                activeEnemyId: activeEnemyId.value,
            }
            localStorage.setItem('endaxis_autosave', JSON.stringify(snapshot))
            ElMessage.success({ message: '已保存', duration: 1500 })
        } catch (err) {
            console.error('[manualSave] error:', err)
            ElMessage.error({ message: '保存失败', duration: 2000 })
        }
    }

    const hoveredActionId = ref(null)

    const cursorPosTimeline = computed(() => {
        return toTimelineSpace(cursorPosition.value.x, cursorPosition.value.y)
    })

    const cursorCurrentTime = computed(() => {
        const exactTime = pxToTime(cursorPosTimeline.value.x)
        const clamped = Math.min(Math.max(0, exactTime), viewDuration.value)
        return snapMs(clamped)
    })

    function setIsCapturing(val) { isCapturing.value = val }

    const isActionSelected = (id) => selectedActionId.value === id || multiSelectedIds.value.has(id)

    // ===================================================================================
    // 历史记录 (Undo/Redo)
    // ===================================================================================

    const historyStack = ref([])
    const historyIndex = ref(-1)
    const MAX_HISTORY = 50

    function commitState() {
        if (historyIndex.value < historyStack.value.length - 1) {
            historyStack.value = historyStack.value.slice(0, historyIndex.value + 1)
        }
        const snapshot = JSON.stringify({
            tracks: tracks.value,
            connections: connections.value,
            characterOverrides: characterOverrides.value,
            weaponOverrides: weaponOverrides.value,
            equipmentCategoryOverrides: equipmentCategoryOverrides.value,
            weaponStatuses: weaponStatuses.value,
            prepDuration: prepDuration.value,
            prepExpanded: prepExpanded.value,
            cycleBoundaries: cycleBoundaries.value,
            switchEvents: switchEvents.value,
            mainControlEvents: mainControlEvents.value,
            _playheadTime: playheadTime.value,
        })
        _playheadDirtyFlag = false
        historyStack.value.push(snapshot)
        if (historyStack.value.length > MAX_HISTORY) {
            historyStack.value.shift()
        } else {
            historyIndex.value++
        }
    }

    function undo() {
        if (historyIndex.value <= 0) return
        historyIndex.value--
        const prevSnapshot = JSON.parse(historyStack.value[historyIndex.value])
        restoreState(prevSnapshot)
    }

    function redo() {
        if (historyIndex.value >= historyStack.value.length - 1) return
        historyIndex.value++
        const nextSnapshot = JSON.parse(historyStack.value[historyIndex.value])
        restoreState(nextSnapshot)
    }

    function restoreState(snapshot) {
        const rawPrep = Number(snapshot?.prepDuration)
        if (snapshot?.prepDuration !== undefined && Number.isFinite(rawPrep) && rawPrep < MIN_PREP_DURATION) {
            shiftSnapshotTimes(snapshot, MIN_PREP_DURATION - rawPrep)
        }
        tracks.value = normalizeTracks(snapshot.tracks)
        connections.value = normalizeConnections(snapshot.connections)
        characterOverrides.value = snapshot.characterOverrides
        weaponOverrides.value = snapshot.weaponOverrides || {}
        equipmentCategoryOverrides.value = snapshot.equipmentCategoryOverrides || {}
        weaponStatuses.value = snapshot.weaponStatuses || []
        if (snapshot.prepDuration !== undefined) prepDuration.value = Math.max(MIN_PREP_DURATION, Number(snapshot.prepDuration) || 0)
        if (snapshot.prepExpanded !== undefined) prepExpanded.value = snapshot.prepExpanded !== false
        cycleBoundaries.value = snapshot.cycleBoundaries || []
        switchEvents.value = snapshot.switchEvents || []
        mainControlEvents.value = snapshot.mainControlEvents ? JSON.parse(JSON.stringify(snapshot.mainControlEvents)) : []
        clearSelection()
        // Restore playhead position from snapshot (realistic mode)
        if (timelineEditorMode.value === 'realistic' && snapshot._playheadTime !== undefined) {
            playheadTime.value = snapshot._playheadTime
        }
        stopPlayback()
    }

    // ===================================================================================
    // 方案管理逻辑 (Scenarios)
    // ===================================================================================

    function _createSnapshot() {
        return JSON.parse(JSON.stringify({
            tracks: tracks.value,
            connections: connections.value,
            characterOverrides: characterOverrides.value,
            weaponOverrides: weaponOverrides.value,
            equipmentCategoryOverrides: equipmentCategoryOverrides.value,
            weaponStatuses: weaponStatuses.value,
            teamBuffStatuses: teamBuffStatuses.value,
            debuffStatuses: debuffStatuses.value,
            prepDuration: prepDuration.value,
            prepExpanded: prepExpanded.value,
            systemConstants: systemConstants.value,
            activeEnemyId: activeEnemyId.value,
            customEnemyParams: customEnemyParams.value,
            cycleBoundaries: cycleBoundaries.value,
            switchEvents: switchEvents.value,
            mainControlEvents: mainControlEvents.value
        }))
    }

    function _loadSnapshot(data) {
        if (!data) return
        const normalized = normalizePrepConfig(JSON.parse(JSON.stringify(data)))
        const incoming = normalized.snapshot

        const incomingTracks = incoming.tracks
            ? JSON.parse(JSON.stringify(incoming.tracks))
            : createDefaultTracks()
        tracks.value = normalizeTracks(incomingTracks)
        connections.value = normalizeConnections(JSON.parse(JSON.stringify(incoming.connections || [])))
        characterOverrides.value = JSON.parse(JSON.stringify(incoming.characterOverrides || {}))
        weaponOverrides.value = JSON.parse(JSON.stringify(incoming.weaponOverrides || {}))
        equipmentCategoryOverrides.value = JSON.parse(JSON.stringify(incoming.equipmentCategoryOverrides || {}))
        weaponStatuses.value = JSON.parse(JSON.stringify(incoming.weaponStatuses || []))
        teamBuffStatuses.value = JSON.parse(JSON.stringify(incoming.teamBuffStatuses || []))
        debuffStatuses.value = JSON.parse(JSON.stringify(incoming.debuffStatuses || []))

        prepDuration.value = Math.max(MIN_PREP_DURATION, Number(incoming.prepDuration) || 0)
        prepExpanded.value = incoming.prepExpanded !== false

        if (incoming.systemConstants) {
            systemConstants.value = { ...systemConstants.value, ...incoming.systemConstants }
        }
        activeEnemyId.value = incoming.activeEnemyId || 'custom'
        if (incoming.customEnemyParams) {
            customEnemyParams.value = { ...customEnemyParams.value, ...incoming.customEnemyParams }
        }
        cycleBoundaries.value = incoming.cycleBoundaries ? JSON.parse(JSON.stringify(incoming.cycleBoundaries)) : []
        switchEvents.value = incoming.switchEvents ? JSON.parse(JSON.stringify(incoming.switchEvents)) : []
        mainControlEvents.value = incoming.mainControlEvents ? JSON.parse(JSON.stringify(incoming.mainControlEvents)) : []
        syncAllWeaponModifiers()
        syncAllEquipmentModifiers()
        clearSelection()
    }

    // ===================================================================================
    // 连线拖拽
    // ===================================================================================
    const enableConnectionTool = ref(false)

    const validConnectionTargetIds = ref(new Set())

    const connectionDragState = ref({
        isDragging: false,
        mode: 'create',
        sourceId: null,
        existingConnectionId: null,
        startPoint: { x: 0, y: 0 },
        sourcePort: 'right',
    })

    const connectionSnapState = ref({
        isActive: false,
        targetId: null,
        targetPort: null,
        snapPos: null, // {x, y}
    })

    function toggleConnectionTool() {
        enableConnectionTool.value = !enableConnectionTool.value
    }

    function createConnection(fromPortDir, targetPortDir, isConsumption = false, connectionData) {
        const rawConn = {
            id: `conn_${uid()}`,
            isConsumption,
            sourcePort: fromPortDir || 'right',
            targetPort: targetPortDir || 'left',
            ...connectionData
        }

        const newConn = normalizeConnection(rawConn)
        if (!newConn) return
        connections.value.push(newConn)
        commitState()
    }

    function switchScenario(targetId) {
        if (targetId === activeScenarioId.value) return

        const currentScenario = scenarioList.value.find(s => s.id === activeScenarioId.value)
        if (currentScenario) {
            currentScenario.data = _createSnapshot()
        }

        const targetScenario = scenarioList.value.find(s => s.id === targetId)
        if (!targetScenario) return

        if (targetScenario.data) {
            _loadSnapshot(targetScenario.data)
        } else {
            targetScenario.data = _createSnapshot()
        }

        activeScenarioId.value = targetId
        historyStack.value = []
        historyIndex.value = -1
        commitState()
    }

    function addScenario() {
        if (scenarioList.value.length >= MAX_SCENARIOS) return

        const currentScenario = scenarioList.value.find(s => s.id === activeScenarioId.value)
        if (currentScenario) currentScenario.data = _createSnapshot()

        const newId = `sc_${uid()}`
        const newName = tr('timeline.scenario.defaultName', { index: scenarioList.value.length + 1 })

        const emptySnapshot = {
            tracks: [{ id: null, actions: [] }, { id: null, actions: [] }, { id: null, actions: [] }, { id: null, actions: [] }],
            connections: [],
            characterOverrides: {},
            weaponOverrides: {},
            equipmentCategoryOverrides: {},
            weaponStatuses: [],
            teamBuffStatuses: [],
            debuffStatuses: [],
            prepDuration: 5,
            prepExpanded: true,
            systemConstants: { ...DEFAULT_SYSTEM_CONSTANTS }
        }

        scenarioList.value.push({ id: newId, name: newName, data: emptySnapshot })
        activeScenarioId.value = newId
        _loadSnapshot(emptySnapshot)

        historyStack.value = []
        historyIndex.value = -1
        commitState()
    }

    function duplicateScenario(sourceId) {
        if (scenarioList.value.length >= MAX_SCENARIOS) return

        const currentActive = scenarioList.value.find(s => s.id === activeScenarioId.value)
        if (currentActive) currentActive.data = _createSnapshot()

        const source = scenarioList.value.find(s => s.id === sourceId)
        if (!source) return

        const newId = `sc_${uid()}`
        const newName = `${source.name} (${tr('timeline.scenario.copySuffix')})`
        const newData = JSON.parse(JSON.stringify(source.data || _createSnapshot()))

        scenarioList.value.push({ id: newId, name: newName, data: newData })
        activeScenarioId.value = newId
        _loadSnapshot(newData)

        historyStack.value = []
        historyIndex.value = -1
        commitState()
    }

    function deleteScenario(targetId) {
        if (scenarioList.value.length <= 1) return

        const idx = scenarioList.value.findIndex(s => s.id === targetId)
        if (idx === -1) return

        if (targetId === activeScenarioId.value) {
            const nextSc = scenarioList.value[idx - 1] || scenarioList.value[idx + 1]
            switchScenario(nextSc.id)
        }
        scenarioList.value.splice(idx, 1)
    }

    // ===================================================================================
    // 辅助计算 (Getters & Helpers)
    // ===================================================================================

    const timeBlockWidth = computed(() => BASE_BLOCK_WIDTH.value)

    const ensureEffectId = (effect) => {
        if (!effect._id) effect._id = uid()
        return effect._id
    }

    const clampPercent = (val) => {
        const num = Number(val) || 0;
        if (num < 0) return 0;
        if (num > 100) return 100;
        return num;
    }

    const clampTier9 = (val) => {
        const num = Math.round(Number(val))
        if (!Number.isFinite(num)) return 1
        if (num < 1) return 1
        if (num > 9) return 9
        return num
    }

    const clampEquipmentRefineTier = (val) => {
        const num = Math.round(Number(val))
        if (!Number.isFinite(num)) return 0
        if (num < 0) return 0
        if (num > EQUIPMENT_REFINE_MAX_TIER) return EQUIPMENT_REFINE_MAX_TIER
        return num
    }

    const normalizeArray4 = (arr) => {
        const list = Array.isArray(arr) ? arr.slice(0, 4) : []
        while (list.length < 4) list.push(0)
        return list.map(v => Number(v) || 0)
    }

    const normalizeArray9 = (arr) => {
        const list = Array.isArray(arr) ? arr.slice(0, 9) : []
        while (list.length < 9) list.push(0)
        return list.map(v => Number(v) || 0)
    }

    const normalizeTrack = (track) => {
        if (!track) return createEmptyTrack()
        const merged = {
            ...createEmptyTrack(),
            ...track,
            actions: track.actions || []
        }

        const baseStats = createDefaultStats()
        const hasIncomingStats = track.stats && typeof track.stats === 'object'
        merged.stats = { ...baseStats, ...(hasIncomingStats ? track.stats : {}) }

        // Normalize growth (migration for legacy saves without growth field)
        const defaultGrowth = createDefaultGrowth()
        if (!merged.growth || typeof merged.growth !== 'object') {
            merged.growth = defaultGrowth
        } else {
            merged.growth = { ...defaultGrowth, ...merged.growth }
            merged.growth.skillLevels = { ...defaultGrowth.skillLevels, ...(merged.growth.skillLevels || {}) }
        }

        if (merged.weaponLevel === undefined || merged.weaponLevel === null) merged.weaponLevel = 90
        if (!merged.weaponAppliedDeltas || typeof merged.weaponAppliedDeltas !== 'object') merged.weaponAppliedDeltas = {}
        if (!merged.equipmentAppliedDeltas || typeof merged.equipmentAppliedDeltas !== 'object') merged.equipmentAppliedDeltas = {}

        merged.equipArmorRefineTier = clampEquipmentRefineTier(merged.equipArmorRefineTier)
        merged.equipGlovesRefineTier = clampEquipmentRefineTier(merged.equipGlovesRefineTier)
        merged.equipAccessory1RefineTier = clampEquipmentRefineTier(merged.equipAccessory1RefineTier)
        merged.equipAccessory2RefineTier = clampEquipmentRefineTier(merged.equipAccessory2RefineTier)

        if (!hasIncomingStats) {
            const eff = Number(track.gaugeEfficiency)
            if (Number.isFinite(eff)) merged.stats.ult_charge_eff = eff
            const link = Number(track.linkCdReduction)
            if (Number.isFinite(link)) merged.stats.link_cd_reduction = link
            const arts = Number(track.originiumArtsPower)
            if (Number.isFinite(arts)) merged.stats.originium_arts_power = arts
        }

        merged.gaugeEfficiency = Number(merged.stats.ult_charge_eff) || 0
        merged.linkCdReduction = clampPercent(merged.stats.link_cd_reduction)
        merged.originiumArtsPower = Number(merged.stats.originium_arts_power) || 0

        return merged
    }

    const normalizeTracks = (list = []) => list.map(t => normalizeTrack(t))

    const getCharacterElementColor = (characterId) => {
        const charInfo = characterRoster.value.find(c => c.id === characterId)
        if (!charInfo || !charInfo.element) return ELEMENT_COLORS.default
        return ELEMENT_COLORS[charInfo.element] || ELEMENT_COLORS.default
    }

    const getWeaponById = (weaponId) => {
        return weaponDatabase.value.find(w => w.id === weaponId)
    }

    const getModifierLabel = (modifierId) => {
        const found = (misc.value?.modifierDefs || []).find(d => d.id === modifierId)
        if (found?.label) return found.label
        const core = CORE_STATS.find(s => s.id === modifierId)
        if (core?.labelKey) {
            const translated = tr(core.labelKey)
            if (translated !== core.labelKey) return translated
        }
        return core?.label || modifierId || ''
    }

    const normalizeWeaponCommonSlots = (slots) => {
        const list = Array.isArray(slots) ? slots.slice(0, 2) : []
        while (list.length < 2) list.push({})
        return list.map(s => ({
            modifierId: typeof s?.modifierId === 'string' && s.modifierId.trim()
                ? s.modifierId.trim()
                : (typeof s?.key === 'string' && s.key.trim() ? s.key.trim() : null),
            size: (s?.size === 'large' || s?.size === 'medium' || s?.size === 'small') ? s.size : 'small'
        }))
    }

    const normalizeWeaponBuffBonuses = (bonuses) => {
        if (!Array.isArray(bonuses)) return []
        return bonuses.map(b => ({
            modifierId: typeof b?.modifierId === 'string' && b.modifierId.trim()
                ? b.modifierId.trim()
                : (typeof b?.key === 'string' && b.key.trim() ? b.key.trim() : null),
            values: normalizeArray9(b?.values)
        })).filter(b => b.modifierId)
    }

    const normalizeWeaponCommonModifiersTable = (table) => {
        const safe = (table && typeof table === 'object') ? table : {}
        const out = {}
        for (const [key, entry] of Object.entries(safe)) {
            if (!key) continue
            out[key] = {
                small: normalizeArray9(entry?.small),
                medium: normalizeArray9(entry?.medium),
                large: normalizeArray9(entry?.large)
            }
        }
        return out
    }

    const normalizeEquipmentAdapterTable = (table) => {
        const safe = (table && typeof table === 'object') ? table : {}
        const out = {}
        const normalizeOne = (entry) => {
            const raw = (entry && typeof entry === 'object') ? entry : {}
            return {
                armorSingle: normalizeArray4(raw.armorSingle),
                armorDual: normalizeArray4(raw.armorDual),
                glovesSingle: normalizeArray4(raw.glovesSingle),
                glovesDual: normalizeArray4(raw.glovesDual),
                accessorySingle: normalizeArray4(raw.accessorySingle),
                accessoryDual: normalizeArray4(raw.accessoryDual),
            }
        }
        for (const [key, entry] of Object.entries(safe)) {
            if (!key) continue
            out[key] = normalizeOne(entry)
        }
        return out
    }

    const normalizeDomainConfig = (incoming) => {
        const safe = (incoming && typeof incoming === 'object') ? incoming : {}
        const normalizeDomain = (domainLike) => {
            const raw = (domainLike && typeof domainLike === 'object') ? domainLike : {}
            const enabledRaw = Array.isArray(raw.enabled) ? raw.enabled : []
            const enabled = []
            const seen = new Set()
            for (const idLike of enabledRaw) {
                const id = typeof idLike === 'string' ? idLike.trim() : ''
                if (!id) continue
                if (seen.has(id)) continue
                seen.add(id)
                enabled.push(id)
            }
            const unitsRaw = (raw.units && typeof raw.units === 'object') ? raw.units : {}
            const units = {}
            for (const [id, unit] of Object.entries(unitsRaw)) {
                if (!id) continue
                if (unit !== 'flat' && unit !== 'percent') continue
                units[id] = unit
            }
            return { enabled, units }
        }

        return {
            weapon: normalizeDomain(safe.weapon),
            equipmentAdapter: normalizeDomain(safe.equipmentAdapter)
        }
    }

    const normalizeEquipmentAffixes = (level, affixesLike) => {
        const safe = (affixesLike && typeof affixesLike === 'object') ? affixesLike : {}
        const is70 = Number(level) === 70
        const size = is70 ? 4 : 1

        const normalizePrimary = (input) => {
            const raw = (input && typeof input === 'object') ? input : {}
            const modifierId = typeof raw.modifierId === 'string' && raw.modifierId.trim()
                ? raw.modifierId.trim()
                : (typeof raw.key === 'string' && raw.key.trim() ? raw.key.trim() : null)
            const vals = is70 ? normalizeArray4(raw.values) : [Number(Array.isArray(raw.values) ? raw.values[0] : raw.value) || 0]
            return {
                modifierId: modifierId || null,
                values: vals.slice(0, size)
            }
        }

        const normalizeAdapter = (input) => {
            const raw = (input && typeof input === 'object') ? input : {}
            const baseVals = is70 ? normalizeArray4(raw.values) : [Number(Array.isArray(raw.values) ? raw.values[0] : raw.value) || 0]
            const baseValues = baseVals.slice(0, size)

            const entriesRaw = Array.isArray(raw.entries) ? raw.entries : null
            let entries = []

            if (entriesRaw) {
                entries = entriesRaw.map((e) => {
                    const ent = (e && typeof e === 'object') ? e : {}
                    const modifierId = typeof ent.modifierId === 'string' && ent.modifierId.trim()
                        ? ent.modifierId.trim()
                        : (typeof ent.key === 'string' && ent.key.trim() ? ent.key.trim() : null)
                    const vals = is70 ? normalizeArray4(ent.values) : [Number(Array.isArray(ent.values) ? ent.values[0] : ent.value) || 0]
                    return { modifierId: modifierId || null, values: vals.slice(0, size) }
                })
            } else {
                const ids = Array.isArray(raw.modifierIds) ? raw.modifierIds : (raw.modifierId ? [raw.modifierId] : [])
                const cleaned = []
                for (const id of ids) {
                    if (typeof id !== 'string') continue
                    const trimmed = id.trim()
                    if (!trimmed) continue
                    if (!cleaned.includes(trimmed)) cleaned.push(trimmed)
                }
                entries = cleaned.map((modifierId) => ({ modifierId, values: [...baseValues] }))
            }

            const seen = new Set()
            const cleanedEntries = []
            for (const ent of entries) {
                const modifierId = typeof ent?.modifierId === 'string' ? ent.modifierId.trim() : ''
                if (!modifierId) continue
                if (seen.has(modifierId)) continue
                const vals = is70 ? normalizeArray4(ent.values) : [Number(Array.isArray(ent.values) ? ent.values[0] : ent.value) || 0]
                cleanedEntries.push({ modifierId, values: vals.slice(0, size) })
                seen.add(modifierId)
            }

            return {
                entries: cleanedEntries,
                modifierIds: cleanedEntries.map(e => e.modifierId),
                values: baseValues
            }
        }

        return {
            primary1: normalizePrimary(safe.primary1),
            primary2: normalizePrimary(safe.primary2),
            adapter: normalizeAdapter(safe.adapter)
        }
    }

    const normalizeEquipmentDatabase = (list) => {
        const safe = Array.isArray(list) ? list : []
        return safe.map(eq => {
            const base = { ...(eq || {}) }
            const is70 = Number(base.level) === 70
            const legacy = base.affixes70 && typeof base.affixes70 === 'object' ? base.affixes70 : null
            const affixesInput = (base.affixes && typeof base.affixes === 'object') ? base.affixes : (legacy || null)
            if (affixesInput) {
                base.affixes = normalizeEquipmentAffixes(base.level, affixesInput)
                if (!is70) {
                    base.affixes.primary1.values = base.affixes.primary1.values.slice(0, 1)
                    base.affixes.primary2.values = base.affixes.primary2.values.slice(0, 1)
                    base.affixes.adapter.values = base.affixes.adapter.values.slice(0, 1)
                    if (Array.isArray(base.affixes.adapter.entries)) {
                        base.affixes.adapter.entries.forEach(e => {
                            if (Array.isArray(e?.values)) e.values = e.values.slice(0, 1)
                        })
                    }
                }
            }
            return base
        })
    }

    const normalizeEquipmentTemplates = (templatesLike, fallback = null) => {
        const safe = (templatesLike && typeof templatesLike === 'object') ? templatesLike : {}
        const fb = (fallback && typeof fallback === 'object') ? fallback : {}

        const normalizeOne = (input, fbInput) => {
            const raw = (input && typeof input === 'object') ? input : {}
            const fbRaw = (fbInput && typeof fbInput === 'object') ? fbInput : {}
            return {
                primary1: normalizeArray4(raw.primary1 ?? fbRaw.primary1),
                primary2: normalizeArray4(raw.primary2 ?? fbRaw.primary2),
                primary1Single: normalizeArray4(raw.primary1Single ?? fbRaw.primary1Single),
            }
        }

        return {
            armor: normalizeOne(safe.armor, fb.armor),
            gloves: normalizeOne(safe.gloves, fb.gloves),
            accessory: normalizeOne(safe.accessory, fb.accessory),
        }
    }

    const normalizeEquipmentMiscConfig = (incoming) => {
        const safe = (incoming && typeof incoming === 'object') ? incoming : {}

        if (safe.equipmentTemplates || safe.equipmentAdapterTable) {
            return {
                equipmentTemplates: normalizeEquipmentTemplates(safe.equipmentTemplates),
                equipmentAdapterTable: normalizeEquipmentAdapterTable(safe.equipmentAdapterTable),
                domainConfig: normalizeDomainConfig(safe.domainConfig)
            }
        }

        const hasLegacyDeltas = Array.isArray(safe.equipmentRefineDeltas)
        const hasLegacyDefaults = !!(safe.equipment70SlotDefaults && typeof safe.equipment70SlotDefaults === 'object' && Object.keys(safe.equipment70SlotDefaults).length > 0)

        if (!hasLegacyDeltas && !hasLegacyDefaults) {
            return {
                equipmentTemplates: normalizeEquipmentTemplates({
                    armor: { primary1: [0, 0, 0, 0], primary2: [0, 0, 0, 0], primary1Single: [0, 0, 0, 0] },
                    gloves: { primary1: [0, 0, 0, 0], primary2: [0, 0, 0, 0], primary1Single: [0, 0, 0, 0] },
                    accessory: { primary1: [0, 0, 0, 0], primary2: [0, 0, 0, 0], primary1Single: [0, 0, 0, 0] },
                }),
                equipmentAdapterTable: {},
                domainConfig: normalizeDomainConfig(null)
            }
        }

        const legacyDeltas = normalizeArray4(safe.equipmentRefineDeltas)
        legacyDeltas[0] = 0
        const legacyDefaults = (safe.equipment70SlotDefaults && typeof safe.equipment70SlotDefaults === 'object') ? safe.equipment70SlotDefaults : {}

        const buildFromLegacy = (slotKey, baseFallback) => {
            const raw = (legacyDefaults[slotKey] && typeof legacyDefaults[slotKey] === 'object') ? legacyDefaults[slotKey] : {}
            const p1 = Number(raw.primary1 ?? baseFallback.primary1) || 0
            const p2 = Number(raw.primary2 ?? baseFallback.primary2) || 0
            const p1s = Number(raw.primary1Single ?? baseFallback.primary1Single) || 0
            const ladder = (base) => [0, 1, 2, 3].map(t => (Number(base) || 0) + (Number(legacyDeltas[t]) || 0))
            return { primary1: ladder(p1), primary2: ladder(p2), primary1Single: ladder(p1s) }
        }

        const gloves = buildFromLegacy('gloves', { primary1: 65, primary2: 43, primary1Single: 65 })
        const accessory = buildFromLegacy('accessory', { primary1: 32, primary2: 21, primary1Single: 32 })
        const armor = { primary1: [0, 0, 0, 0], primary2: [0, 0, 0, 0], primary1Single: [0, 0, 0, 0] }

        return { equipmentTemplates: normalizeEquipmentTemplates({ armor, gloves, accessory }), equipmentAdapterTable: {}, domainConfig: normalizeDomainConfig(null) }
    }

    const normalizeModifierDefs = (defs) => {
        const list = Array.isArray(defs) ? defs : []
        const seen = new Set()
        const out = []
        for (const def of list) {
            const id = typeof def?.id === 'string' ? def.id.trim()
                : (typeof def?.key === 'string' ? def.key.trim() : '')
            if (!id || seen.has(id)) continue
            out.push({ id, label: def?.label || id, note: def?.note, domainTags: def?.domainTags })
            seen.add(id)
        }
        return out
    }

    // ── Weapon-specific modifier ID remapping ──
    // Weapon common slot 'attack' and passiveStats 'attack' are ATK% (percentage).
    // Equipment data already stores 'attack_percent' for percentage values (scraped from wiki).
    // So only weapon sources need remapping.
    function remapWeaponModifierId(modId) {
        if (modId === 'attack') return 'attack_percent'
        return modId
    }

    // ── Weapon ATK by level ──
    // Weapons have baseAtk (Lv90 max). ATK at level L scales linearly.
    // Formula: ATK(L) = floor(baseAtk * (0.25 + 0.75 * (L - 1) / 89))
    // This gives ~25% at Lv1 and 100% at Lv90.
    function computeWeaponAtkAtLevel(baseAtk, level) {
        if (!baseAtk || !level) return 0
        const ratio = 0.25 + 0.75 * (Math.max(1, Math.min(90, level)) - 1) / 89
        return Math.floor(baseAtk * ratio)
    }

    function setTrackWeaponLevel(trackId, level) {
        const track = tracks.value.find(t => t.id === trackId)
        if (!track) return
        track.weaponLevel = Math.max(1, Math.min(90, Math.round(level)))
        syncTrackWeaponModifiers(trackId)
        commitState()
    }

    const computeWeaponDeltasForTrack = (track) => {
        const deltas = {}
        if (!track?.weaponId) return deltas

        const weapon = getWeaponById(track.weaponId)
        if (!weapon) return deltas

        // Weapon base ATK at current level
        const wLevel = track.weaponLevel || 90
        const weaponAtk = computeWeaponAtkAtLevel(weapon.baseAtk, wLevel)
        if (weaponAtk) deltas.attack = (deltas.attack || 0) + weaponAtk

        // Weapon passiveStats (static modifiers, not tier-dependent)
        if (weapon.passiveStats && typeof weapon.passiveStats === 'object') {
            for (const [modId, val] of Object.entries(weapon.passiveStats)) {
                if (modId === '_raw') continue
                const num = Number(val)
                if (!num) continue
                const targetId = remapWeaponModifierId(modId)
                deltas[targetId] = (deltas[targetId] || 0) + num
            }
        }

        // Common slot modifiers (tier 1-9)
        const slots = normalizeWeaponCommonSlots(weapon.commonSlots)
        const table = normalizeWeaponCommonModifiersTable(misc.value?.weaponCommonModifiers)

        const commonTiers = [clampTier9(track.weaponCommon1Tier), clampTier9(track.weaponCommon2Tier)]
        for (let i = 0; i < 2; i++) {
            const slot = slots[i]
            if (!slot?.modifierId) continue
            const entry = table[slot.modifierId]
            if (!entry) continue
            const ladder = entry[slot.size]
            const val = Number(ladder?.[commonTiers[i] - 1]) || 0
            if (val === 0) continue
            const targetId = remapWeaponModifierId(slot.modifierId)
            deltas[targetId] = (deltas[targetId] || 0) + val
        }

        // Buff bonuses (tier 1-9)
        const buffTier = clampTier9(track.weaponBuffTier)
        const bonuses = normalizeWeaponBuffBonuses(weapon.buffBonuses)
        for (const b of bonuses) {
            const val = Number(b.values[buffTier - 1]) || 0
            if (val !== 0) deltas[b.modifierId] = (deltas[b.modifierId] || 0) + val
        }

        const filtered = {}
        const stats = track?.stats && typeof track.stats === 'object' ? track.stats : {}
        for (const [modifierId, val] of Object.entries(deltas)) {
            if (!(modifierId in stats)) continue
            filtered[modifierId] = val
        }
        return filtered
    }

    const applyWeaponDeltasToTrack = (track, newDeltas) => {
        const old = (track.weaponAppliedDeltas && typeof track.weaponAppliedDeltas === 'object')
            ? track.weaponAppliedDeltas
            : {}

        if (!track.stats) track.stats = createDefaultStats()

        const keys = new Set([...Object.keys(old), ...Object.keys(newDeltas || {})])
        for (const modifierId of keys) {
            if (!(modifierId in track.stats)) continue
            const prev = Number(old[modifierId]) || 0
            const next = Number(newDeltas?.[modifierId]) || 0
            const diff = next - prev
            if (diff === 0) continue
            const current = Number(track.stats[modifierId]) || 0
            track.stats[modifierId] = current + diff
        }

        track.weaponAppliedDeltas = { ...(newDeltas || {}) }

        track.gaugeEfficiency = Number(track.stats.ult_charge_eff) || 0
        track.linkCdReduction = clampPercent(track.stats.link_cd_reduction)
        track.originiumArtsPower = Number(track.stats.originium_arts_power) || 0
    }

    function syncTrackWeaponModifiers(trackId) {
        if (!trackId) return
        const track = tracks.value.find(t => t.id === trackId)
        if (!track) return
        const newDeltas = computeWeaponDeltasForTrack(track)
        applyWeaponDeltasToTrack(track, newDeltas)
    }

    function syncAllWeaponModifiers({ commit = false } = {}) {
        for (const track of tracks.value) {
            if (!track?.id) continue
            syncTrackWeaponModifiers(track.id)
        }
        if (commit) commitState()
    }

    const getEquipmentById = (equipmentId) => {
        if (!equipmentId) return null
        return equipmentDatabase.value.find(e => e.id === equipmentId) || null
    }

    const getEquipmentIdForSlot = (track, slotKey) => {
        if (!track) return null
        if (slotKey === 'armor') return track.equipArmorId
        if (slotKey === 'gloves') return track.equipGlovesId
        if (slotKey === 'accessory1') return track.equipAccessory1Id
        if (slotKey === 'accessory2') return track.equipAccessory2Id
        return null
    }

    const getEquipmentRefineTierForSlot = (track, slotKey) => {
        if (!track) return 0
        if (slotKey === 'armor') return clampEquipmentRefineTier(track.equipArmorRefineTier)
        if (slotKey === 'gloves') return clampEquipmentRefineTier(track.equipGlovesRefineTier)
        if (slotKey === 'accessory1') return clampEquipmentRefineTier(track.equipAccessory1RefineTier)
        if (slotKey === 'accessory2') return clampEquipmentRefineTier(track.equipAccessory2RefineTier)
        return 0
    }

    const computeEquipmentDeltasForTrack = (track) => {
        const deltas = {}
        if (!track?.id) return deltas

        const slotKeys = ['armor', 'gloves', 'accessory1', 'accessory2']
        for (const slotKey of slotKeys) {
            const equipmentId = getEquipmentIdForSlot(track, slotKey)
            if (!equipmentId) continue
            const eq = getEquipmentById(equipmentId)
            if (!eq) continue
            const is70 = Number(eq.level) === 70
            const tier = is70 ? getEquipmentRefineTierForSlot(track, slotKey) : 0
            const affixes = eq.affixes ? normalizeEquipmentAffixes(eq.level, eq.affixes) : null
            if (!affixes) continue

            const pick = (values) => {
                if (!Array.isArray(values) || values.length === 0) return 0
                const idx = is70 ? tier : 0
                return Number(values[idx] ?? values[0]) || 0
            }

            // Equipment modifierIds are already correct in data (attack_percent for %, attack for flat)
            if (affixes.primary1?.modifierId) {
                const v = pick(affixes.primary1.values)
                const mid = affixes.primary1.modifierId
                if (v !== 0) deltas[mid] = (deltas[mid] || 0) + v
            }

            if (affixes.primary2?.modifierId) {
                const v = pick(affixes.primary2.values)
                const mid = affixes.primary2.modifierId
                if (v !== 0) deltas[mid] = (deltas[mid] || 0) + v
            }

            const entries = Array.isArray(affixes.adapter?.entries) ? affixes.adapter.entries : []
            if (entries.length > 0) {
                const isSingleAdapter = entries.filter(e => e?.modifierId).length === 1
                const slotBase = eq.slot === 'accessory1' || eq.slot === 'accessory2' ? 'accessory' : eq.slot
                for (const ent of entries) {
                    const id = typeof ent?.modifierId === 'string' ? ent.modifierId.trim() : ''
                    if (!id) continue
                    let v = pick(ent.values)
                    // Fallback to adapter table when piece values are 0
                    if (v === 0) {
                        const adapterTable = normalizeEquipmentAdapterTable(misc.value?.equipmentAdapterTable)
                        const ladderKey = `${slotBase}${isSingleAdapter ? 'Single' : 'Dual'}`
                        const ladder = adapterTable[id]?.[ladderKey]
                        if (ladder) v = pick(ladder)
                    }
                    if (v === 0) continue
                    deltas[id] = (deltas[id] || 0) + v
                }
            } else {
                const adapterIds = Array.isArray(affixes.adapter?.modifierIds) ? affixes.adapter.modifierIds : []
                if (adapterIds.length > 0) {
                    const v = pick(affixes.adapter.values)
                    if (v !== 0) {
                        for (const id of adapterIds) {
                            if (!id) continue
                            deltas[id] = (deltas[id] || 0) + v
                        }
                    }
                }
            }
        }

        const filtered = {}
        const stats = track?.stats && typeof track.stats === 'object' ? track.stats : {}
        for (const [modifierId, val] of Object.entries(deltas)) {
            if (!(modifierId in stats)) continue
            filtered[modifierId] = val
        }
        return filtered
    }

    const applyEquipmentDeltasToTrack = (track, newDeltas) => {
        const old = (track.equipmentAppliedDeltas && typeof track.equipmentAppliedDeltas === 'object')
            ? track.equipmentAppliedDeltas
            : {}

        if (!track.stats) track.stats = createDefaultStats()

        const keys = new Set([...Object.keys(old), ...Object.keys(newDeltas || {})])
        for (const modifierId of keys) {
            if (!(modifierId in track.stats)) continue
            const prev = Number(old[modifierId]) || 0
            const next = Number(newDeltas?.[modifierId]) || 0
            const diff = next - prev
            if (diff === 0) continue
            const current = Number(track.stats[modifierId]) || 0
            track.stats[modifierId] = current + diff
        }

        track.equipmentAppliedDeltas = { ...(newDeltas || {}) }
        track.gaugeEfficiency = Number(track.stats.ult_charge_eff) || 0
        track.linkCdReduction = clampPercent(track.stats.link_cd_reduction)
        track.originiumArtsPower = Number(track.stats.originium_arts_power) || 0
    }

    function syncTrackEquipmentModifiers(trackId) {
        if (!trackId) return
        const track = tracks.value.find(t => t.id === trackId)
        if (!track) return
        // Enforce: only Lv70 equipment can keep refine tiers
        const slotRules = [
            { slotKey: 'armor', id: track.equipArmorId, tierKey: 'equipArmorRefineTier' },
            { slotKey: 'gloves', id: track.equipGlovesId, tierKey: 'equipGlovesRefineTier' },
            { slotKey: 'accessory1', id: track.equipAccessory1Id, tierKey: 'equipAccessory1RefineTier' },
            { slotKey: 'accessory2', id: track.equipAccessory2Id, tierKey: 'equipAccessory2RefineTier' },
        ]
        for (const s of slotRules) {
            const eq = getEquipmentById(s.id)
            if (!eq || Number(eq.level) !== 70) {
                track[s.tierKey] = 0
            } else {
                track[s.tierKey] = clampEquipmentRefineTier(track[s.tierKey])
            }
        }
        const newDeltas = computeEquipmentDeltasForTrack(track)
        applyEquipmentDeltasToTrack(track, newDeltas)
    }

    function syncAllEquipmentModifiers({ commit = false } = {}) {
        for (const track of tracks.value) {
            if (!track?.id) continue
            syncTrackEquipmentModifiers(track.id)
        }
        if (commit) commitState()
    }

    const getEquipmentCategoryConfig = (category) => {
        if (!category) return null
        return equipmentCategoryConfigs.value?.[category] || null
    }

    const getEquipmentCategoryOverride = (category) => {
        if (!category) return null
        return equipmentCategoryOverrides.value?.[category] || null
    }

    function updateEquipmentCategoryOverride(category, patch) {
        if (!category || !patch) return
        if (!equipmentCategoryOverrides.value) equipmentCategoryOverrides.value = {}
        if (!equipmentCategoryOverrides.value[category]) equipmentCategoryOverrides.value[category] = {}
        Object.assign(equipmentCategoryOverrides.value[category], patch)
        commitState()
    }

    const getTrackEquipmentIds = (trackId) => {
        const track = tracks.value.find(t => t.id === trackId)
        if (!track) return []
        return [track.equipArmorId, track.equipGlovesId, track.equipAccessory1Id, track.equipAccessory2Id].filter(Boolean)
    }

    const getActiveSetBonusCategories = (trackId) => {
        const ids = getTrackEquipmentIds(trackId)
        const counts = new Map()
        for (const id of ids) {
            const eq = getEquipmentById(id)
            const cat = eq?.category
            if (!cat) continue
            counts.set(cat, (counts.get(cat) || 0) + 1)
        }
        return [...counts.entries()].filter(([, count]) => count >= 3).map(([cat]) => cat)
    }

    const getSetBonusDuration = (category) => {
        const override = getEquipmentCategoryOverride(category)
        const cfg = getEquipmentCategoryConfig(category)
        const duration = override?.setBonus?.duration ?? cfg?.setBonus?.duration
        const num = Number(duration)
        return Number.isFinite(num) ? Math.max(0, num) : 0
    }

    const getSetBonusIcon = (trackId, category) => {
        const track = tracks.value.find(t => t.id === trackId)
        if (!track || !category) return ''

        const equippedIds = [track.equipArmorId, track.equipGlovesId, track.equipAccessory1Id, track.equipAccessory2Id].filter(Boolean)
        for (const id of equippedIds) {
            const eq = getEquipmentById(id)
            if (eq?.category === category && eq?.icon) return eq.icon
        }

        const fallback = equipmentDatabase.value.find(e => e.category === category && e.icon)
        return fallback?.icon || ''
    }

    const teamTracksInfo = computed(() => tracks.value.map(track => {
        const charInfo = characterRoster.value.find(c => c.id === track.id)
        return { ...track, ...(charInfo || { name: tr('timelineGrid.track.selectOperator'), avatar: '', rarity: 0 }) }
    }))

    const activeWeapon = computed(() => {
        const track = tracks.value.find(t => t.id === activeTrackId.value)
        if (!track || !track.weaponId) return null
        return getWeaponById(track.weaponId) || null
    })

    const formatTimeLabel = (time) => {
        if (time === undefined || time === null) return '';
        const totalFrames = Math.round(time * 60);
        const s = Math.floor(totalFrames / 60);
        const f = totalFrames % 60;
        if (f === 0) return `${s}s`;
        return `${s}s ${f.toString().padStart(2, '0')}f`;
    };

    const activeSkillLibrary = computed(() => {
        i18n.global.locale.value
        const activeChar = characterRoster.value.find(c => c.id === activeTrackId.value)
        if (!activeChar) return []

        const TYPE_ORDER = {
            'attack': 1,
            'dodge': 2,
            'execution': 3,
            'skill': 4,
            'link': 5,
            'ultimate': 6
        }

        const getAnomalies = (list) => list || []
        const getAllowed = (list) => list || []

        const createBaseSkill = (suffix, type, name) => {
            const globalId = `${activeChar.id}_${suffix}`
            const globalOverride = characterOverrides.value[globalId] || {}
            const rawDuration = activeChar[`${suffix}_duration`] || 1
            const rawCooldown = activeChar[`${suffix}_cooldown`] || 0

            const rawTicks = activeChar[`${suffix}_damage_ticks`]
                ? JSON.parse(JSON.stringify(activeChar[`${suffix}_damage_ticks`]))
                : []

            let defaults = { spCost: 0, gaugeCost: 0, gaugeGain: 0, teamGaugeGain: 0, enhancementTime: 0, animationTime: 0 }

            if (suffix === 'skill') {
                defaults.spCost = activeChar.skill_spCost || systemConstants.value.skillSpCostDefault;
                defaults.gaugeGain = activeChar.skill_gaugeGain || 0;
                defaults.teamGaugeGain = activeChar.skill_teamGaugeGain || 0;
            } else if (suffix === 'link') {
                defaults.gaugeGain = activeChar.link_gaugeGain || 0
            } else if (suffix === 'ultimate') {
                const track = tracks.value.find(t => t.id === activeChar.id)
                defaults.gaugeCost = track ? resolveGaugeMax(activeChar.id, track, activeChar) : (activeChar.ultimate_gaugeMax || 100)
                defaults.gaugeGain = activeChar.ultimate_gaugeReply || 0
                defaults.enhancementTime = activeChar.ultimate_enhancementTime || 0
                defaults.animationTime = activeChar.ultimate_animationTime || 0.5
                if (activeChar.ultimate_forceMainControl) defaults.forceMainControl = true
            }

            const merged = { duration: rawDuration, cooldown: rawCooldown, icon: activeChar[`${suffix}_icon`] || "", ...defaults, ...globalOverride }

            const specificElement = activeChar[`${suffix}_element`]
            const derivedElement = specificElement || activeChar.element || 'physical'

            const finalDamageTicks = globalOverride.damageTicks || rawTicks
            const finalAnomalies = globalOverride.physicalAnomaly || getAnomalies(activeChar[`${suffix}_anomalies`])
            // skill_allowed_types is for variants only — base skills have no cast conditions
            // link_allowed_types is handled by the link queue system (link_trigger)
            // execution/ultimate allowed_types are used by legality checks at simulation time
            const finalAllowedTypes = (suffix === 'skill' || suffix === 'link')
                ? []
                : getAllowed(activeChar[`${suffix}_allowed_types`])

            return {
                id: globalId, type: type, name: name,
                librarySource: 'character',
                element: derivedElement,
                ...merged,
                damageTicks: finalDamageTicks,
                allowedTypes: finalAllowedTypes,
                physicalAnomaly: finalAnomalies,
            }
        }

        const createAttackLibrary = () => {
            normalizeAttackSegmentsForCharacter(activeChar)

            const groupId = `${activeChar.id}_attack`
            const groupOverrideRaw = characterOverrides.value[groupId] || {}
            const { duration: _ignoredDuration, ...groupOverride } = (groupOverrideRaw && typeof groupOverrideRaw === 'object') ? groupOverrideRaw : {}

            const derivedElement = activeChar.attack_element || activeChar.element || 'physical'
            const attackGroupName = getI18nSkillType('attack')

            const segmentSkills = (activeChar.attack_segments || []).slice(0, ATTACK_SEGMENT_COUNT).map((seg, idx) => {
                const segId = `${groupId}_seg${idx + 1}`
                const segOverride = characterOverrides.value[segId] || {}
                const mergedOverride = { ...groupOverride, ...(segOverride && typeof segOverride === 'object' ? segOverride : {}) }

                const rawDuration = Number(seg?.duration) || 0
                const rawTicks = seg?.damage_ticks ? JSON.parse(JSON.stringify(seg.damage_ticks)) : []
                const rawAnomalies = seg?.anomalies ? JSON.parse(JSON.stringify(seg.anomalies)) : []
                const rawAllowed = Array.isArray(seg?.allowed_types) ? [...seg.allowed_types] : []

                const merged = {
                    id: segId,
                    type: 'attack',
                    name: `${attackGroupName} ${idx + 1}`,
                    librarySource: 'character',
                    element: seg?.element || derivedElement,
                    icon: seg?.icon || '',
                    duration: rawDuration,
                    cooldown: 0,
                    gaugeGain: Number(seg?.gaugeGain) || 0,
                    ...mergedOverride,
                }

                const finalDamageTicks = mergedOverride.damageTicks || rawTicks
                const finalAnomalies = mergedOverride.physicalAnomaly || rawAnomalies
                const finalAllowedTypes = mergedOverride.allowedTypes || rawAllowed

                return {
                    ...merged,
                    kind: 'attack_segment',
                    attackSegmentIndex: idx + 1,
                    hiddenInLibraryGrid: true,
                    damageTicks: finalDamageTicks,
                    allowedTypes: finalAllowedTypes,
                    physicalAnomaly: finalAnomalies,
                }
            })

            const enabledSegments = segmentSkills.filter(s => (Number(s.duration) || 0) > 0).map((seg, idx, list) => ({
                ...seg,
                attackSequenceIndex: idx + 1,
                attackSequenceTotal: list.length,
                attackGroupName
            }))
            const totalDuration = enabledSegments.reduce((acc, s) => acc + (Number(s.duration) || 0), 0)

            const groupSkill = {
                id: groupId,
                type: 'attack',
                name: attackGroupName,
                librarySource: 'character',
                element: derivedElement,
                duration: totalDuration,
                kind: 'attack_group',
                attackSegments: enabledSegments,
                attackSegmentsAll: segmentSkills,
            }

            // 单次自动普攻：放入时间轴时根据上一段攻击自动选择段数
            const autoSkill = {
                id: `${activeChar.id}_attack_auto`,
                type: 'attack',
                kind: 'attack_auto',
                name: getI18nSkillType('attack_auto'),
                librarySource: 'character',
                element: derivedElement,
                duration: Number(enabledSegments[0]?.duration) || 1,
                damageTicks: [],
                physicalAnomaly: [],
            }

            return { groupSkill, autoSkill, segmentSkills }
        }

        const createVariantAttackLibrary = (variant) => {
            const groupId = `${activeChar.id}_variant_${variant.id}`
            const groupOverrideRaw = characterOverrides.value[groupId] || {}
            const { duration: _ignoredDuration, ...groupOverride } = (groupOverrideRaw && typeof groupOverrideRaw === 'object') ? groupOverrideRaw : {}

            const derivedElement = variant.element || activeChar.attack_element || activeChar.element || 'physical'
            const attackGroupName = variant.name || tr('timeline.attack.enhancedAttack')

            const segmentSkills = (variant.attackSegments || []).slice(0, ATTACK_SEGMENT_COUNT).map((seg, idx) => {
                const segId = `${groupId}_seg${idx + 1}`
                const segOverride = characterOverrides.value[segId] || {}
                const mergedOverride = { ...groupOverride, ...(segOverride && typeof segOverride === 'object' ? segOverride : {}) }

                const rawDuration = Number(seg?.duration) || 0
                const rawTicks = seg?.damageTicks ? JSON.parse(JSON.stringify(seg.damageTicks)) : []
                const rawAnomalies = seg?.physicalAnomaly ? JSON.parse(JSON.stringify(seg.physicalAnomaly)) : []
                const rawAllowed = Array.isArray(seg?.allowedTypes) ? [...seg.allowedTypes] : []

                const merged = {
                    id: segId,
                    type: 'attack',
                    name: `${attackGroupName} ${idx + 1}`,
                    librarySource: 'character',
                    element: seg?.element || derivedElement,
                    icon: seg?.icon || '',
                    duration: rawDuration,
                    cooldown: 0,
                    gaugeGain: Number(seg?.gaugeGain) || 0,
                    ...mergedOverride,
                }

                const finalDamageTicks = mergedOverride.damageTicks || rawTicks
                const finalAnomalies = mergedOverride.physicalAnomaly || rawAnomalies
                const finalAllowedTypes = mergedOverride.allowedTypes || rawAllowed

                return {
                    ...merged,
                    kind: 'attack_segment',
                    attackSegmentIndex: idx + 1,
                    hiddenInLibraryGrid: true,
                    damageTicks: finalDamageTicks,
                    allowedTypes: finalAllowedTypes,
                    physicalAnomaly: finalAnomalies,
                }
            })

            const enabledSegments = segmentSkills.filter(s => (Number(s.duration) || 0) > 0).map((seg, idx, list) => ({
                ...seg,
                attackSequenceIndex: idx + 1,
                attackSequenceTotal: list.length,
                attackGroupName
            }))
            const totalDuration = enabledSegments.reduce((acc, s) => acc + (Number(s.duration) || 0), 0)

            const groupSkill = {
                id: groupId,
                type: 'attack',
                name: attackGroupName,
                librarySource: 'character',
                element: derivedElement,
                duration: totalDuration,
                kind: 'attack_group',
                attackSegments: enabledSegments,
                attackSegmentsAll: segmentSkills,
            }

            return { groupSkill, segmentSkills }
        }

        const createVariantSkill = (variant) => {
            const globalId = `${activeChar.id}_variant_${variant.id}`
            const globalOverride = characterOverrides.value[globalId] || {}
            const defaults = {
                duration: 1, cooldown: 0, spCost: 0, spGain: 0, gaugeCost: 0, gaugeGain: 0,
                stagger: 0, teamGaugeGain: 0, element: activeChar.element || 'physical'
            }
            const merged = { ...defaults, ...variant, ...globalOverride }

            const finalAnomalies = globalOverride.physicalAnomaly || getAnomalies(variant.physicalAnomaly)
            const finalDamageTicks = globalOverride.damageTicks || (variant.damageTicks ? JSON.parse(JSON.stringify(variant.damageTicks)) : [])

            return {
                ...merged,
                id: globalId,
                librarySource: 'character',
                physicalAnomaly: finalAnomalies,
                damageTicks: finalDamageTicks,
                allowedTypes: getAllowed(variant.allowedTypes),
            }
        }

        const { groupSkill: attackGroupSkill, autoSkill: attackAutoSkill, segmentSkills: attackSegmentSkills } = createAttackLibrary()

        const createDodgeSkill = () => {
            const globalId = `${activeChar.id}_dodge`
            const globalOverride = characterOverrides.value[globalId] || {}

            const rawDuration = Number(activeChar.dodge_duration)
            const duration = Number.isFinite(rawDuration) ? Math.max(0, rawDuration) : 0.5

            return {
                id: globalId,
                type: 'dodge',
                name: getI18nSkillType('dodge'),
                librarySource: 'character',
                duration,
                damageTicks: [],
                physicalAnomaly: [],
                ...globalOverride,
            }
        }

        const standardSkills = [
            attackAutoSkill,
            attackGroupSkill,
            createDodgeSkill(),
            createBaseSkill('execution', 'execution', getI18nSkillType('execution')),
            createBaseSkill('skill', 'skill', getI18nSkillType('skill')),
            createBaseSkill('link', 'link', getI18nSkillType('link')),
            createBaseSkill('ultimate', 'ultimate', getI18nSkillType('ultimate'))
        ]

        const variantSkills = []
        const variantAttackSegmentSkills = []
        for (const v of (activeChar.variants || [])) {
            if (v?.type === 'attack' && Array.isArray(v.attackSegments)) {
                const { groupSkill, segmentSkills } = createVariantAttackLibrary(v)
                variantSkills.push(groupSkill)
                variantAttackSegmentSkills.push(...segmentSkills)
            } else {
                variantSkills.push(createVariantSkill(v))
            }
        }

        const allSkills = [...standardSkills, ...variantSkills, ...attackSegmentSkills, ...variantAttackSegmentSkills];

        const sorted = allSkills.sort((a, b) => {
            const weightA = TYPE_ORDER[a.type] || 99;
            const weightB = TYPE_ORDER[b.type] || 99;

            if (weightA !== weightB) {
                return weightA - weightB;
            }

            const isVariantA = a.id.includes('_variant_');
            const isVariantB = b.id.includes('_variant_');

            if (isVariantA !== isVariantB) {
                return isVariantA ? 1 : -1;
            }

            return 0;
        });

        const mainControlSkill = {
            id: `${activeChar.id}_main_control`,
            type: 'attack',
            kind: 'main_control',
            name: getI18nSkillType('main_control'),
            librarySource: 'character',
            element: activeChar.element || 'physical',
            duration: 0,
            cooldown: 0,
            gaugeGain: 0,
            damageTicks: [],
            physicalAnomaly: [],
        }

        // ── Timeline mode display filter ──
        // Only affects which skills appear in ActionLibrary.
        // Already-placed timeline actions are never affected.
        let filtered = sorted
        if (timelineMode.value === 'strict') {
            // Strict: only base skills (hide ALL variants)
            filtered = sorted.filter(s => !s.id.includes('_variant_'))
        } else if (timelineMode.value === 'normal') {
            // Normal: hide variants that lack allowedTypes (these already have
            // runtime auto-switch via enhancedMultipliers / enhancedActionIds).
            // Variants WITH allowedTypes are kept — users need them to express
            // conditional assumptions in the timeline.
            filtered = sorted.filter(s => {
                if (!s.id.includes('_variant_')) return true
                return Array.isArray(s.allowedTypes) && s.allowedTypes.length > 0
            })
        }
        // 'free': no filtering (full test capability preserved)

        return [...filtered, mainControlSkill];
    })

    const isWeaponSkillId = (id) => typeof id === 'string' && id.startsWith('weaponlib_')

    const activeWeaponSkillLibrary = computed(() => {
        i18n.global.locale.value
        const weapon = activeWeapon.value
        if (!weapon) return []

        const TYPE_ORDER = { weapon: 1, attack: 2, skill: 3, link: 4, ultimate: 5, execution: 6 }

        const rawList = Array.isArray(weapon.skills) && weapon.skills.length > 0
            ? weapon.skills
            : [{
                id: 'core',
                name: weapon.buffName || weapon.name || tr('weapon.skill'),
                type: 'weapon',
                duration: weapon.duration ?? 0,
                icon: weapon.icon || '/weapons/default.webp',
            }]

        return rawList.map((raw, idx) => {
            const libId = `weaponlib_${weapon.id}_${raw.id || idx}`
            const override = weaponOverrides.value[libId] || {}
            const baseDuration = raw.duration ?? weapon.duration ?? 0
            const durationVal = Number(baseDuration)
            const safeDuration = Number.isFinite(durationVal) ? durationVal : 0
            const baseCooldown = raw.cooldown ?? weapon.cooldown ?? 0
            const clonedAnomalies = raw.physicalAnomaly ? JSON.parse(JSON.stringify(raw.physicalAnomaly)) : []
            const clonedTicks = raw.damageTicks ? JSON.parse(JSON.stringify(raw.damageTicks)) : []

            const baseSkill = {
                id: libId,
                name: raw.name || weapon.buffName || weapon.name || tr('weapon.skill'),
                type: raw.type || 'weapon',
                librarySource: 'weapon',
                weaponId: weapon.id,
                duration: safeDuration,
                cooldown: Number(baseCooldown) || 0,
                icon: raw.icon || weapon.icon || '/weapons/default.webp',
                element: raw.element || weapon.element || 'physical',
                customColor: '#b37feb',
                gaugeCost: raw.gaugeCost || 0,
                gaugeGain: raw.gaugeGain || 0,
                teamGaugeGain: raw.teamGaugeGain || 0,
                spCost: raw.spCost || 0,
                spGain: raw.spGain || 0,
                triggerWindow: raw.triggerWindow || 0,
                physicalAnomaly: clonedAnomalies,
                damageTicks: clonedTicks,
                enhancementTime: raw.enhancementTime || 0,
                animationTime: raw.animationTime || 0,
            }

            return { ...baseSkill, ...override }
        }).sort((a, b) => {
            const weightA = TYPE_ORDER[a.type] || 99
            const weightB = TYPE_ORDER[b.type] || 99
            if (weightA !== weightB) return weightA - weightB
            return 0
        })
    })

    const activeSetBonusLibrary = computed(() => {
        if (!activeTrackId.value) return []
        const categories = getActiveSetBonusCategories(activeTrackId.value)
        if (!categories.length) return []

        return categories.map(cat => ({
            id: `setlib_${activeTrackId.value}_${cat}`,
            name: cat,
            type: 'set',
            librarySource: 'set',
            setCategory: cat,
            duration: getSetBonusDuration(cat),
            icon: getSetBonusIcon(activeTrackId.value, cat),
            customColor: '#2dd4bf'
        }))
    })

    function applyEnemyPreset(enemyId) {
        if (enemyId === activeEnemyId.value) return

        activeEnemyId.value = enemyId

        if (enemyId === 'custom') {
            // 切回自定义时，从备份恢复数值
            Object.assign(systemConstants.value, customEnemyParams.value)
        } else {
            // 切换到预设敌人
            const enemy = enemyDatabase.value.find(e => e.id === enemyId)
            if (enemy) {
                systemConstants.value.maxStagger = enemy.maxStagger
                systemConstants.value.staggerNodeCount = enemy.staggerNodeCount
                systemConstants.value.staggerNodeDuration = enemy.staggerNodeDuration
                systemConstants.value.staggerBreakDuration = enemy.staggerBreakDuration
                systemConstants.value.executionRecovery = enemy.executionRecovery
            }
        }
    }

    // ===================================================================================
    // 实体操作 (CRUD)
    // ===================================================================================

    function setTimelineShift(val) {
        const width = totalTimelineWidthPx.value
        const maxShift = width - timelineRect.value.width
        timelineShift.value = Math.min(Math.max(0, val), maxShift)
    }
    function setScrollTop(val) { timelineScrollTop.value = val }
    function setTimelineRect(width, height, top, right, bottom, left) { timelineRect.value = { width, height, top, left, right, bottom } }
    function setTrackLaneRect(trackId, rect) { trackLaneRects.value[trackId] = rect }
    function setNodeRect(nodeId, rect) { nodeRects.value[nodeId] = rect }
    function setCursorPosition(x, y) { cursorPosition.value = { x, y } }
    function toggleCursorGuide() { showCursorGuide.value = !showCursorGuide.value }
    function toggleBoxSelectMode() { if (!isBoxSelectMode.value) connectionDragState.value.isDragging = false; isBoxSelectMode.value = !isBoxSelectMode.value }
    function toggleSnapStep() {
        if (snapStep.value > 0.02) {
            snapStep.value = 1 / 60;
        } else {
            snapStep.value = 0.1;
        }
    }

    function setDraggingSkill(skill) { draggingSkillData.value = skill }

    const MAIN_CONTROL_CD = 2  // seconds

    // 计算在 baseEvents 下，每个 trackId 的"禁回"截止时间 Map<trackId, latestCooldownEnd>
    function _buildMainControlCooldowns(baseEvents) {
        const validIds = new Set(tracks.value.map(t => t.id))
        const sorted = [...baseEvents]
            .filter(e => validIds.has(e.trackId))
            .sort((a, b) => a.time - b.time)

        const cooldowns = new Map()  // trackId -> cooldownEndTime
        let cur = null
        for (const ev of sorted) {
            if (ev.trackId !== cur) {
                // cur loses control at ev.time → CD until ev.time + MAIN_CONTROL_CD
                const existing = cooldowns.get(cur) || 0
                cooldowns.set(cur, Math.max(existing, ev.time + MAIN_CONTROL_CD))
                cur = ev.trackId
            }
        }
        return cooldowns
    }

    // 强制设置主控（忽略 CD 限制），用于技能效果触发
    function forceSetMainControl(trackId, time) {
        const t = Number(time) || 0
        // 如果该角色在时间 t 已经是主控，无需添加新事件
        const segs = computedMainControlSegments.value.get(trackId) || []
        if (segs.some(seg => seg.start <= t && t < seg.end)) return
        // 移除同一时间槽其他角色的事件，避免冲突
        mainControlEvents.value = mainControlEvents.value.filter(e => e.trackId === trackId || e.time !== t)
        const idx = mainControlEvents.value.findIndex(e => e.time === t)
        if (idx >= 0) {
            mainControlEvents.value[idx] = { ...mainControlEvents.value[idx], trackId }
        } else {
            mainControlEvents.value.push({ id: `mc_${uid()}`, trackId, time: t })
        }
    }

    function setMainControl(trackId, time) {
        const validIds = new Set(tracks.value.map(tr => tr.id))
        const hasExisting = mainControlEvents.value.some(e => validIds.has(e.trackId))

        // 第一次放置：锚定到时间轴起点
        const t = hasExisting ? (Number(time) || 0) : 0

        // 放到起点时：移除其他角色在 t=0 的事件（避免同时刻冲突），不做 CD 校验
        if (t === 0) {
            mainControlEvents.value = mainControlEvents.value.filter(e => e.trackId === trackId || e.time !== 0)
            const idx = mainControlEvents.value.findIndex(e => e.time === 0)
            if (idx >= 0) {
                mainControlEvents.value[idx] = { ...mainControlEvents.value[idx], trackId }
            } else {
                mainControlEvents.value.push({ id: `mc_${uid()}`, trackId, time: 0 })
            }
            commitState()
            return true
        }

        // 校验：用不含当前时间槽的事件集合计算 CD
        const baseEvents = mainControlEvents.value.filter(e => e.time !== t)
        const cooldowns = _buildMainControlCooldowns(baseEvents)
        const cdEnd = cooldowns.get(trackId) || 0
        if (t < cdEnd) return false  // 在 CD 内，拒绝

        const idx = mainControlEvents.value.findIndex(e => e.time === t)
        if (idx >= 0) {
            mainControlEvents.value[idx] = { ...mainControlEvents.value[idx], trackId }
        } else {
            mainControlEvents.value.push({ id: `mc_${uid()}`, trackId, time: t })
        }
        commitState()
        return true
    }

    const computedMainControlCooldowns = computed(() => {
        const validIds = new Set(tracks.value.map(t => t.id))
        const events = [...mainControlEvents.value]
            .filter(e => validIds.has(e.trackId))
            .sort((a, b) => a.time - b.time)
        const result = new Map()  // trackId -> [{start, end}]
        const addCD = (trackId, start) => {
            if (!result.has(trackId)) result.set(trackId, [])
            result.get(trackId).push({ start, end: start + MAIN_CONTROL_CD })
        }
        let cur = null
        for (const ev of events) {
            if (ev.trackId !== cur) {
                if (cur !== null) addCD(cur, ev.time)
                cur = ev.trackId
            }
        }
        // 如果某角色在 CD 窗口内被强制切换为主控，将 CD 截断到强制事件时间点
        for (const [trackId, cds] of result) {
            result.set(trackId, cds.map(cd => {
                const forceEv = events.find(e => e.trackId === trackId && e.time > cd.start && e.time < cd.end)
                return forceEv ? { ...cd, end: forceEv.time } : cd
            }).filter(cd => cd.end > cd.start))
        }
        return result
    })

    function moveMainControl(eventId, newTime) {
        const t = Number(newTime) || 0
        const ev = mainControlEvents.value.find(e => e.id === eventId)
        if (!ev) return false

        // 拖到起点：成为"第一个主控"，移除其他角色在 t=0 的事件，不做 CD 校验
        if (t === 0) {
            mainControlEvents.value = mainControlEvents.value.filter(e => e.id === eventId || e.time !== 0)
            mainControlEvents.value = mainControlEvents.value.filter(e => e.id !== eventId)
            mainControlEvents.value.push({ id: eventId, trackId: ev.trackId, time: 0 })
            commitState()
            return true
        }

        const baseEvents = mainControlEvents.value.filter(e => e.id !== eventId)
        const cooldowns = _buildMainControlCooldowns(baseEvents)
        const cdEnd = cooldowns.get(ev.trackId) || 0
        if (t < cdEnd) return false
        mainControlEvents.value = mainControlEvents.value.filter(e => e.id !== eventId)
        mainControlEvents.value.push({ id: eventId, trackId: ev.trackId, time: t })
        commitState()
        return true
    }

    const computedMainControlSegments = computed(() => {
        const validIds = new Set(tracks.value.map(t => t.id))
        const events = [...mainControlEvents.value]
            .filter(e => validIds.has(e.trackId))
            .sort((a, b) => a.time - b.time)
        if (events.length === 0) return new Map()
        const result = new Map()
        const addSeg = (id, s, e) => {
            if (!result.has(id)) result.set(id, [])
            result.get(id).push({ start: s, end: e })
        }
        let cur = events[0].trackId
        let segStart = events[0].time
        for (const ev of events) {
            if (ev.trackId !== cur) {
                addSeg(cur, segStart, ev.time)
                cur = ev.trackId
                segStart = ev.time
            }
        }
        addSeg(cur, segStart, viewDuration.value)
        return result
    })

    function selectTrack(trackId) {
        activeTrackId.value = trackId
        clearSelection()
    }

    function selectLibrarySkill(skillId, source = 'character') {
        const normalizedSource = source || 'character'
        const isSame = (selectedLibrarySkillId.value === skillId && selectedLibrarySource.value === normalizedSource)
        if (skillId) {
            clearSelection()
            if (!isSame) {
                selectedLibrarySkillId.value = skillId
                selectedLibrarySource.value = normalizedSource
            } else {
                selectedLibrarySource.value = normalizedSource
            }
        } else {
            selectedLibrarySkillId.value = null
            selectedLibrarySource.value = normalizedSource
        }
    }

    function selectAction(instanceId) {
        const isSame = (instanceId === selectedActionId.value)
        clearSelection()
        if (!isSame) {
            selectedActionId.value = instanceId
            multiSelectedIds.value.add(instanceId)
        }
    }

    function setSelectedAnomalyId(id) { selectedAnomalyId.value = id }

    function selectAnomaly(instanceId, rowIndex, colIndex) {
        clearSelection()

        selectedActionId.value = instanceId
        multiSelectedIds.value.add(instanceId)

        const track = tracks.value.find(t => t.actions.some(a => a.instanceId === instanceId))
        const action = track?.actions.find(a => a.instanceId === instanceId)

        if (action && action.physicalAnomaly && action.physicalAnomaly[rowIndex]) {
            const effect = action.physicalAnomaly[rowIndex][colIndex]
            if (effect) {
                if (!effect._id) effect._id = uid()
                selectedAnomalyId.value = effect._id
            }
        }
    }

    function selectConnection(connId) {
        const isSame = (selectedConnectionId.value === connId)
        clearSelection()
        if (!isSame) {
            selectedConnectionId.value = connId
        }
    }

    function addSwitchEvent(time, characterId) {
        switchEvents.value.push({
            id: `sw_${uid()}`,
            time: time,
            characterId: characterId
        })
        commitState()
    }

    function updateSwitchEvent(id, time) {
        const event = switchEvents.value.find(e => e.id === id)
        if (event) {
            event.time = time
        }
    }

    function selectSwitchEvent(id) {
        const isSame = (selectedSwitchEventId.value === id)
        clearSelection()
        if (!isSame) {
            selectedSwitchEventId.value = id
        }
    }

    function selectMainControlEvent(id) {
        const isSame = (selectedMcEventId.value === id)
        clearSelection()
        if (!isSame) {
            selectedMcEventId.value = id
        }
    }

    function selectWeaponStatus(id) {
        const isSame = (selectedWeaponStatusId.value === id)
        clearSelection()
        if (!isSame) {
            selectedWeaponStatusId.value = id
        }
    }

    function selectCycleBoundary(id) {
        const isSame = (selectedCycleBoundaryId.value === id)
        clearSelection()
        if (!isSame) {
            selectedCycleBoundaryId.value = id
        }
    }

    function addCycleBoundary(time) {
        cycleBoundaries.value.push({
            id: `cb_${uid()}`,
            time: time
        })
        commitState()
    }

    function updateCycleBoundary(id, time) {
        const boundary = cycleBoundaries.value.find(b => b.id === id)
        if (boundary) {
            boundary.time = time
        }
    }

    function setHoveredAction(id) { hoveredActionId.value = id }

    function setMultiSelection(idsArray) {
        multiSelectedIds.value = new Set(idsArray)
        if (idsArray.length === 1) { selectedActionId.value = idsArray[0] } else { selectedActionId.value = null }
        selectedWeaponStatusId.value = null
    }

    function clearSelection() {
        selectedActionId.value = null
        selectedConnectionId.value = null
        selectedAnomalyId.value = null
        selectedCycleBoundaryId.value = null
        selectedSwitchEventId.value = null
        selectedWeaponStatusId.value = null
        weaponDetailOpen.value = false
        selectedPotentialData.value = null
        selectedMcEventId.value = null
        multiSelectedIds.value.clear()
        selectedLibrarySkillId.value = null
        selectedLibrarySource.value = 'character'
    }

    function toggleStrictMode() {
        const idx = LEGALITY_CYCLE.indexOf(legalityPolicy.value)
        legalityPolicy.value = LEGALITY_CYCLE[(idx + 1) % LEGALITY_CYCLE.length]
    }

    function _interpolateSeriesAt(points, time, valueKey) {
        if (!points || points.length === 0) return 0
        // Find the two surrounding points and linearly interpolate
        for (let i = points.length - 1; i >= 0; i--) {
            if (points[i].time <= time + 0.0001) {
                const p0 = points[i]
                const p1 = points[i + 1]
                if (!p1 || p1.time <= p0.time) return p0[valueKey]
                // Linear interpolation between p0 and p1
                const t = (time - p0.time) / (p1.time - p0.time)
                return p0[valueKey] + t * (p1[valueKey] - p0[valueKey])
            }
        }
        return points[0][valueKey]
    }

    function validateSkillPlacement(trackId, skill, startTime) {
        const track = tracks.value.find(t => t.id === trackId)
        if (!track) return { valid: false, reason: tr('timeline.strict.noTrack') }

        const skillDuration = Number(skill.duration) || 0

        if (skill.type === 'link') {
            const baseCooldown = Number(skill.cooldown) || 0
            if (baseCooldown > 0) {
                const cdReduction = Number(track.linkCdReduction) || 0
                const effectiveCd = baseCooldown * (1 - cdReduction / 100)
                const prevLink = [...track.actions]
                    .filter(a => a.type === 'link' && !a.isDisabled)
                    .sort((a, b) => b.startTime - a.startTime)
                    .find(a => a.startTime < startTime)
                if (prevLink) {
                    if (startTime < prevLink.startTime + effectiveCd) {
                        const remaining = snapMs(prevLink.startTime + effectiveCd - startTime)
                        return { valid: false, reason: tr('timeline.strict.linkCooldown', { remaining: remaining.toFixed(1) }) }
                    }
                }
            }
        }

        if (skill.type === 'ultimate') {
            const gaugeCost = Number(skill.gaugeCost) || 0
            if (gaugeCost > 0) {
                const gaugeData = calculateGaugeData(trackId)
                const gaugeAtTime = _interpolateSeriesAt(gaugeData, startTime, 'val')
                if (gaugeAtTime < gaugeCost - 0.01) {
                    return { valid: false, reason: tr('timeline.strict.gaugeInsufficient', { current: Math.floor(gaugeAtTime), required: gaugeCost }) }
                }
            }
        }

        const spCost = Number(skill.spCost) || 0
        if (spCost > 0) {
            const spPoints = calculateGlobalSpData()
            const spAtTime = _interpolateSeriesAt(spPoints, startTime, 'sp')
            if (spAtTime < spCost - 0.01) {
                return { valid: false, reason: tr('timeline.strict.spInsufficient', { current: Math.floor(spAtTime), required: spCost }) }
            }
        }

        if (skillDuration > 0) {
            const proposedEnd = startTime + skillDuration
            const overlapEps = 0.001 // 1ms tolerance for floating point at boundaries
            const overlap = track.actions.find(a => {
                if (a.isDisabled) return false
                const aStart = a.startTime
                const aDuration = Number(a.duration) || 0
                if (aDuration <= 0) return false
                const aEnd = aStart + aDuration
                return aStart < proposedEnd - overlapEps && aEnd > startTime + overlapEps
            })
            if (overlap) {
                return { valid: false, reason: tr('timeline.strict.overlap', { name: overlap.name || overlap.type }) }
            }
        }

        return { valid: true, reason: '' }
    }

    function _rebuildTrackBuffs(trackId) {
        const track = tracks.value.find(t => t.id === trackId)
        if (!track) return
        // Remove existing auto-generated weapon/set statuses for this track
        weaponStatuses.value = weaponStatuses.value.filter(s => s.trackId !== trackId)
        // Re-generate buffs for all existing actions on this track
        for (const action of track.actions) {
            _autoGenerateBuffs(trackId, action)
        }
        clearBuffConfigDirty(trackId)
    }

    function addSkillToTrack(trackId, skill, startTime, options = {}) {
        const track = tracks.value.find(t => t.id === trackId); if (!track) return

        // Realistic mode: recalculate buffs if config changed
        if (timelineEditorMode.value === 'realistic' && isBuffConfigDirty(trackId)) {
            _rebuildTrackBuffs(trackId)
        }

        // Realistic mode: enforce placement rules
        if (timelineEditorMode.value === 'realistic') {
            if (startTime < playheadTime.value - 0.001) return // reject placement before playhead
            const avail = checkSkillAvailabilityAt(trackId, skill, startTime, options)
            if (!avail.available) {
                ElMessage.warning({ message: avail.reasons.join(', ') || '无法施放', duration: 2500 })
                return
            }
        }

        if (strictMode.value) {
            const validation = validateSkillPlacement(trackId, skill, startTime)
            if (!validation.valid) {
                ElMessage.warning({ message: validation.reason, duration: 2500 })
                return
            }
        }

        const cloneEffectsForAction = (skillForClone) => {
            const clonedAnomalies = skillForClone.physicalAnomaly ? JSON.parse(JSON.stringify(skillForClone.physicalAnomaly)) : []
            const anomalyRows = Array.isArray(clonedAnomalies?.[0]) ? clonedAnomalies : [clonedAnomalies]
            const effectIdMap = new Map()

            anomalyRows.forEach(row => {
                if (!Array.isArray(row)) return
                row.forEach(effect => {
                    if (!effect) return
                    const oldId = effect._id
                    const newId = uid()
                    effect._id = newId
                    if (oldId) effectIdMap.set(oldId, newId)
                })
            })

            const clonedTicks = skillForClone.damageTicks ? JSON.parse(JSON.stringify(skillForClone.damageTicks)) : []
            clonedTicks.forEach(tick => {
                if (!tick || !Array.isArray(tick.boundEffects) || tick.boundEffects.length === 0) return
                tick.boundEffects = tick.boundEffects.map(id => effectIdMap.get(id) || id)
            })

            return { clonedAnomalies, clonedTicks }
        }

        const createActionFromSkill = (skillForCreate, actionStartTime) => {
            const { clonedAnomalies, clonedTicks } = cloneEffectsForAction(skillForCreate)
            return {
                ...skillForCreate,
                instanceId: `inst_${uid()}`,
                librarySource: skillForCreate.librarySource || 'character',
                sourceWeaponId: skillForCreate.weaponId || track.weaponId || null,
                physicalAnomaly: clonedAnomalies,
                damageTicks: clonedTicks,
                logicalStartTime: actionStartTime,
                startTime: actionStartTime
            }
        }

        if (skill?.kind === 'attack_auto') {
            const charInfo = characterRoster.value.find(c => c.id === track.id)
            const rawSegs = _getActiveAttackSegments(track.id).filter(s => (Number(s?.duration) || 0) > 0)
            if (rawSegs.length === 0) return

            const total = rawSegs.length
            const atkGroupName = getI18nSkillType('attack')

            // 放置时根据时间轴上已有动作判断段数
            const sorted = [...track.actions]
                .filter(a => !a.isDisabled && (Number(a.startTime) || 0) < startTime)
                .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0))

            let lastAtkEnd = -Infinity
            let lastDodgeEnd = -Infinity
            let prevSeqIdx = 0
            let cumulOtherTime = 0

            for (const action of sorted) {
                const aStart = Number(action.startTime) || 0
                const aDur   = Number(action.duration)  || 0
                if (action.kind === 'attack_auto_placed' || action.kind === 'attack_segment') {
                    prevSeqIdx = Number(action.attackSequenceIndex) || 1
                    lastAtkEnd = aStart + aDur
                    cumulOtherTime = 0
                } else if (action.type === 'execution') {
                    // Execution resets combo to 1a
                    prevSeqIdx = 0
                    lastAtkEnd = aStart + aDur
                    cumulOtherTime = 0
                } else if (action.type === 'dodge') {
                    // Dodge resets the combo timer (idle time restarts)
                    lastDodgeEnd = aStart + aDur
                    cumulOtherTime = 0
                } else if (action.type !== 'attack') {
                    // Skills pause the combo timer (their duration doesn't count as idle)
                    const refTime = Math.max(lastAtkEnd, lastDodgeEnd)
                    if (aStart >= refTime) cumulOtherTime += aDur
                }
            }

            const refTime = Math.max(lastAtkEnd, lastDodgeEnd)
            const idleTime = (startTime - refTime) - cumulOtherTime
            let nextIdx = 0
            if (prevSeqIdx > 0 && prevSeqIdx < total && idleTime <= 1) nextIdx = prevSeqIdx

            const seg = rawSegs[nextIdx]
            const seqIdx = nextIdx + 1
            const derivedElem = seg?.element || charInfo?.element || 'physical'

            const resolvedSkill = {
                id: `${track.id}_attack_auto`,
                type: 'attack',
                kind: 'attack_auto_placed',
                name: `${atkGroupName} ${seqIdx}`,
                librarySource: 'character',
                element: derivedElem,
                duration: Number(seg?.duration) || 1,
                cooldown: 0,
                gaugeGain: Number(seg?.gaugeGain) || 0,
                damageTicks: seg?.damage_ticks ? JSON.parse(JSON.stringify(seg.damage_ticks)) : [],
                physicalAnomaly: seg?.anomalies ? JSON.parse(JSON.stringify(seg.anomalies)) : [],
                allowedTypes: Array.isArray(seg?.allowed_types) ? [...seg.allowed_types] : [],
                attackSequenceIndex: seqIdx,
                attackSequenceTotal: total,
                attackGroupName: atkGroupName,
            }
            const newAction = createActionFromSkill(resolvedSkill, startTime)
            track.actions.push(newAction)
            track.actions.sort((a, b) => a.startTime - b.startTime)
            _autoGenerateBuffs(trackId, newAction)
            commitState()
            advancePlayheadAfterPlacement(resolvedSkill, startTime, trackId)
            return
        }

        if (skill?.kind === 'attack_group' && Array.isArray(skill.attackSegments)) {
            const segments = skill.attackSegments.filter(s => (Number(s?.duration) || 0) > 0)
            if (segments.length === 0) {
                return
            }

            const attackGroupInstanceId = `atkgrp_${uid()}`
            const attackSequenceTotal = segments.length
            const attackGroupName = skill.name || getI18nSkillType('attack')
            let cursor = startTime

            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i]
                const newAction = createActionFromSkill(seg, cursor)
                newAction.attackGroupInstanceId = attackGroupInstanceId
                newAction.attackSequenceIndex = i + 1
                newAction.attackSequenceTotal = attackSequenceTotal
                newAction.attackGroupName = attackGroupName
                track.actions.push(newAction)
                cursor += Number(seg.duration) || 0
            }

            track.actions.sort((a, b) => a.startTime - b.startTime)
            const representativeAction = track.actions.find(a => a.attackGroupInstanceId === attackGroupInstanceId)
            if (representativeAction) _autoGenerateBuffs(trackId, representativeAction)
            commitState()
            advancePlayheadAfterPlacement(skill, startTime, trackId)
            return
        }

        if (skill?.kind === 'attack_segment') {
            const idx = Number(skill.attackSequenceIndex) || Number(skill.attackSegmentIndex) || 0
            const total = Number(skill.attackSequenceTotal) || 0
            const newAction = createActionFromSkill(skill, startTime)
            if (idx > 0) {
                newAction.attackSequenceIndex = idx
                if (total > 0) {
                    newAction.attackSequenceTotal = total
                }
                newAction.attackGroupName = (typeof skill.attackGroupName === 'string' && skill.attackGroupName.trim())
                    ? skill.attackGroupName.trim()
                    : ((typeof skill.name === 'string' && skill.name.trim()) ? skill.name.trim().replace(/\s*\d+\s*$/, '') : getI18nSkillType('attack'))
            }
            track.actions.push(newAction)
            track.actions.sort((a, b) => a.startTime - b.startTime)
            _autoGenerateBuffs(trackId, newAction)
            commitState()
            advancePlayheadAfterPlacement(skill, startTime, trackId)
            return
        }

        const newAction = createActionFromSkill(skill, startTime)
        track.actions.push(newAction)
        track.actions.sort((a, b) => a.startTime - b.startTime)
        if (skill.type === 'link' || skill.type === 'ultimate') {
            const amount = skill.type === 'link' ? 0.5 : (Number(skill.animationTime) || 1.5);
            pushSubsequentActions(startTime, amount, newAction.instanceId);
        }
        _autoGenerateBuffs(trackId, newAction)
        if (skill.forceMainControl) {
            const effectTime = startTime + (Number(skill.animationTime) || 0)
            forceSetMainControl(trackId, effectTime)
        }
        commitState()
        advancePlayheadAfterPlacement(skill, startTime, trackId, newAction.instanceId)
    }

    function addWeaponStatus(trackId, skill, startTime) {
        if (!trackId) return
        const durationVal = Number(skill.duration) || 0
        const newStatus = {
            id: `wstatus_${uid()}`,
            trackId,
            weaponId: skill.weaponId || null,
            skillId: skill.id,
            name: skill.name || tr('weapon.effect'),
            icon: skill.icon || '',
            color: skill.customColor || '#b37feb',
            startTime: startTime,
            logicalStartTime: startTime,
            duration: durationVal > 0 ? durationVal : 0,
            type: 'weapon'
        }
        weaponStatuses.value.push(newStatus)
        commitState()
    }

    function addSetBonusStatus(trackId, setCategory, startTime) {
        if (!trackId || !setCategory) return
        const durationVal = getSetBonusDuration(setCategory)
        const newStatus = {
            id: `wstatus_${uid()}`,
            trackId,
            setCategory,
            name: setCategory,
            icon: getSetBonusIcon(trackId, setCategory),
            color: '#2dd4bf',
            startTime: startTime,
            logicalStartTime: startTime,
            duration: durationVal > 0 ? durationVal : 0,
            type: 'set'
        }
        weaponStatuses.value.push(newStatus)
        commitState()
    }

    // ── Auto-buff: trigger-to-action matching ──────────────────────────────

    const ANOMALY_TRIGGER_KEYWORDS = {
        'on_crystal_or_freeze_apply': ['crystal', 'freeze'],
        'on_freeze_apply': ['freeze'],
        'on_freeze_consume': ['freeze'],
        'on_burning_apply': ['burning'],
        'on_burning_or_conductive_apply': ['burning', 'conductive'],
        'on_conductive_apply': ['conductive'],
        'on_physical_anomaly': ['armor_break', 'knockdown', 'knockup'],
        'on_arts_anomaly_consume': ['burning', 'corrosion', 'conductive', 'nature_attach'],
        'on_arts_anomaly_apply': ['burning', 'corrosion', 'conductive', 'nature_attach'],
        'on_arts_attach_consume': ['nature_attach'],
        'on_arts_burst': ['burning', 'corrosion', 'conductive', 'nature_attach'],
        'on_break_consume': ['armor_break'],
        'on_break_apply_no_existing': ['armor_break'],
        'on_knockup': ['knockup'],
        'on_knockdown_or_weaken': ['knockdown'],
        'on_nature_attach': ['nature_attach'],
        'on_corrosion_consume': ['corrosion'],
    }

    function _getAnomalyTypesFromAction(action) {
        const anomalies = action?.physicalAnomaly
        if (!Array.isArray(anomalies) || anomalies.length === 0) return []
        const types = new Set()
        for (const row of anomalies) {
            if (!Array.isArray(row)) continue
            for (const eff of row) {
                if (eff?.type) types.add(eff.type)
            }
        }
        return [...types]
    }

    /**
     * Find all hit times at which a weapon trigger should fire.
     * Returns array of absolute times (actionStart + offset).
     * Returns empty array if the trigger doesn't match this action.
     *
     * Principle: "可以不触发但绝不能错误触发"
     * - Generic hit triggers (on_skill_hit, on_link, etc.): fire at first hit time
     * - Effect-specific triggers (on_skill_sp_restore, etc.): fire only when a hit
     *   has the required bound effect; if no hit has it, don't fire
     * - Anomaly triggers: fire at the anomaly effect's offset time
     */
    function _findTriggerHitTimes(trigger, action) {
        if (!trigger || trigger === '_unknown') return []
        if (trigger.startsWith('condition_')) return []

        const actionType = action.type
        const actionKind = action.kind
        const actionStart = Number(action.startTime) || 0
        const ticks = action.damageTicks || []
        const anomalyRows = action.physicalAnomaly || []

        // Helper: get first hit time, or actionStart if no ticks
        const firstHitTime = () => {
            if (ticks.length > 0) return snapMs(actionStart + (Number(ticks[0].offset) || 0))
            return actionStart
        }

        // Helper: check if action type matches
        const isSkill = actionType === 'skill'
        const isLink = actionType === 'link'
        const isUlt = actionType === 'ultimate'
        const isAttack = actionType === 'attack' || actionKind === 'attack_segment' || actionKind === 'attack_group'
        const isExecution = actionType === 'execution'

        switch (trigger) {
            // ── Generic action-type triggers: fire at first hit ──
            case 'on_skill':
            case 'on_skill_hit':
                return isSkill ? [firstHitTime()] : []
            case 'on_ultimate':
                return isUlt ? [firstHitTime()] : []
            case 'on_link':
                return isLink ? [firstHitTime()] : []
            case 'on_execution':
                return isExecution ? [firstHitTime()] : []
            case 'on_heavy_attack':
                return isAttack ? [firstHitTime()] : []
            case 'on_skill_or_ultimate_hit':
                return (isSkill || isUlt) ? [firstHitTime()] : []
            case 'on_skill_or_link_crit':
                return (isSkill || isLink) ? [firstHitTime()] : []

            // ── Effect-specific triggers: require bound effect on hit ──
            // "技能" in these descriptions = 泛指 (skill/link/ultimate)
            case 'on_skill_sp_restore_or_combo':
            case 'on_skill_sp_restore':
                // Don't fire at action level; need hit-bound SP restore or combo effect
                // For now: don't trigger (no false positives) until hits are properly bound
                return []
            case 'on_skill_heal':
            case 'on_link_heal':
                // Need hit-bound heal effect; not yet modeled
                return []

            // ── Effect-specific but safe to approximate at first hit ──
            case 'on_skill_break_apply':
            case 'on_skill_physical_fragile':
                // These check anomaly effects, use anomaly offset
                if (!isSkill) return []
                break // fall through to anomaly check below
            case 'on_skill_arts_anomaly_apply':
                if (!isSkill) return []
                break
            case 'on_skill_or_ultimate_cold_attach':
                if (!isSkill && !isUlt) return []
                break
            case 'on_link_knockup':
            case 'on_link_burst_or_physical_anomaly':
                if (!isLink) return []
                break
            default:
                break
        }

        // ── Anomaly-based triggers: use anomaly effect offset times ──
        const keywords = ANOMALY_TRIGGER_KEYWORDS[trigger]
        if (keywords) {
            const times = []
            const rows = Array.isArray(anomalyRows?.[0]) ? anomalyRows : (anomalyRows.length ? [anomalyRows] : [])
            for (const row of rows) {
                if (!Array.isArray(row)) continue
                for (const effect of row) {
                    if (!effect?.type) continue
                    if (keywords.includes(effect.type)) {
                        times.push(snapMs(actionStart + (Number(effect.offset) || 0)))
                    }
                }
            }
            return times
        }

        return []
    }

    function _countOverlappingStatuses(statusArray, buffName, weaponId, time) {
        return statusArray.filter(s => {
            if (s.name !== buffName) return false
            if (weaponId && s.weaponId !== weaponId) return false
            const end = s.startTime + (Number(s.duration) || 0)
            return time >= s.startTime && time < end
        }).length
    }

    function _autoGenerateBuffs(trackId, action) {
        const track = tracks.value.find(t => t.id === trackId)
        if (!track) return

        const weaponId = action.sourceWeaponId || track.weaponId
        const weapon = weaponId ? getWeaponById(weaponId) : null

        if (weapon && Array.isArray(weapon.triggeredBuffs)) {
        for (const buff of weapon.triggeredBuffs) {
            const hitTimes = _findTriggerHitTimes(buff.trigger, action)
            if (hitTimes.length === 0) continue

            const maxStacks = Number(buff.maxStacks) || 1
            const duration = Number(buff.duration) || 0
            if (duration <= 0) continue

            const buffName = buff.name || weapon.buffName || weapon.name
            const target = buff.target || 'self'

            // Create buff at each hit time (respecting maxStacks)
            for (const triggerTime of hitTimes) {
                const createBuff = (targetArray, id, extra) => {
                    const active = _countOverlappingStatuses(targetArray, buffName, weaponId, triggerTime)
                    if (active >= maxStacks) return
                    targetArray.push({
                        id,
                        name: buffName,
                        icon: weapon.icon || '',
                        startTime: triggerTime,
                        logicalStartTime: triggerTime,
                        duration,
                        sourceActionInstanceId: action.instanceId,
                        weaponId,
                        ...extra,
                    })
                }

                if (target === 'self') {
                    createBuff(weaponStatuses.value, `wstatus_${uid()}`, {
                        trackId, color: '#b37feb', type: 'weapon',
                    })
                } else if (target === 'team') {
                    createBuff(teamBuffStatuses.value, `tbuff_${uid()}`, {
                        color: '#faad14', type: 'team_buff', sourceTrackId: trackId, stacks: 1, maxStacks,
                    })
                } else if (target === 'enemy') {
                    createBuff(debuffStatuses.value, `dbuff_${uid()}`, {
                        color: '#ff4d4f', type: 'debuff', sourceTrackId: trackId, stacks: 1, maxStacks,
                    })
                } else if (target === 'others') {
                    tracks.value.forEach(otherTrack => {
                        if (otherTrack.id === trackId) return
                        createBuff(weaponStatuses.value, `wstatus_${uid()}`, {
                            trackId: otherTrack.id, color: '#b37feb', type: 'weapon',
                        })
                    })
                }
            }
        }
        }
    }

    // ── Team buff / debuff CRUD ────────────────────────────────────────────

    function addTeamBuffStatus(buffData, startTime, sourceTrackId) {
        const durationVal = Number(buffData.duration) || 0
        teamBuffStatuses.value.push({
            id: `tbuff_${uid()}`,
            name: buffData.name || '',
            icon: buffData.icon || '',
            color: buffData.color || '#faad14',
            startTime,
            logicalStartTime: startTime,
            duration: durationVal > 0 ? durationVal : 0,
            type: 'team_buff',
            sourceTrackId: sourceTrackId || null,
            sourceActionInstanceId: buffData.sourceActionInstanceId || null,
            weaponId: buffData.weaponId || null,
            stacks: Number(buffData.stacks) || 1,
            maxStacks: Number(buffData.maxStacks) || 1,
        })
        commitState()
    }

    function addDebuffStatus(buffData, startTime, sourceTrackId) {
        const durationVal = Number(buffData.duration) || 0
        debuffStatuses.value.push({
            id: `dbuff_${uid()}`,
            name: buffData.name || '',
            icon: buffData.icon || '',
            color: buffData.color || '#ff4d4f',
            startTime,
            logicalStartTime: startTime,
            duration: durationVal > 0 ? durationVal : 0,
            type: 'debuff',
            sourceTrackId: sourceTrackId || null,
            sourceActionInstanceId: buffData.sourceActionInstanceId || null,
            weaponId: buffData.weaponId || null,
            stacks: Number(buffData.stacks) || 1,
            maxStacks: Number(buffData.maxStacks) || 1,
        })
        commitState()
    }

    function removeTeamBuffStatus(id) {
        teamBuffStatuses.value = teamBuffStatuses.value.filter(s => s.id !== id)
        commitState()
    }

    function updateTeamBuffStatus(statusId, patch) {
        const status = teamBuffStatuses.value.find(s => s.id === statusId)
        if (!status) return
        Object.assign(status, patch)
        if (patch.startTime !== undefined) {
            status.logicalStartTime = status.startTime
        }
        commitState()
    }

    function removeDebuffStatus(id) {
        debuffStatuses.value = debuffStatuses.value.filter(s => s.id !== id)
        commitState()
    }

    function updateDebuffStatus(statusId, patch) {
        const status = debuffStatuses.value.find(s => s.id === statusId)
        if (!status) return
        Object.assign(status, patch)
        if (patch.startTime !== undefined) {
            status.logicalStartTime = status.startTime
        }
        commitState()
    }

    function removeCurrentSelection() {
        if (selectedWeaponStatusId.value) {
            const toDeleteId = selectedWeaponStatusId.value
            const before = weaponStatuses.value.length
            weaponStatuses.value = weaponStatuses.value.filter(s => s.id !== toDeleteId)
            const removed = before - weaponStatuses.value.length
            selectedWeaponStatusId.value = null
            if (removed > 0) {
                connections.value = connections.value.filter(conn => !_connectionTouchesStatusId(conn, toDeleteId))
                commitState()
                return { statusCount: removed, total: removed }
            }
        }
        const itemsToPull = [];

        const targets = new Set(multiSelectedIds.value);
        if (selectedActionId.value) targets.add(selectedActionId.value);

        targets.forEach(id => {
            const actionWrap = getActionById(id);
            const action = actionWrap ? actionWrap.node : null;

            if (action && (action.type === 'link' || action.type === 'ultimate')) {
                const amount = action.type === 'link' ? 0.5 : (Number(action.animationTime) || 1.5);
                itemsToPull.push({ time: action.startTime, amount });
            }
        });

        if (selectedMcEventId.value) {
            mainControlEvents.value = mainControlEvents.value.filter(e => e.id !== selectedMcEventId.value)
            selectedMcEventId.value = null
            commitState()
            return { total: 1 }
        }

        if (selectedSwitchEventId.value) {
            switchEvents.value = switchEvents.value.filter(s => s.id !== selectedSwitchEventId.value)
            selectedSwitchEventId.value = null
            commitState()
            return { total: 1 }
        }

        if (selectedCycleBoundaryId.value) {
            cycleBoundaries.value = cycleBoundaries.value.filter(b => b.id !== selectedCycleBoundaryId.value);
            selectedCycleBoundaryId.value = null;
            commitState();
            return { total: 1 };
        }

        let actionCount = 0;
        let connCount = 0;

        if (targets.size > 0) {
            tracks.value.forEach(track => {
                if (!track.actions || track.actions.length === 0) return;
                const initialLen = track.actions.length;
                track.actions = track.actions.filter(a => !targets.has(a.instanceId));
                if (track.actions.length < initialLen) {
                    actionCount += (initialLen - track.actions.length);
                    // Rebuild buffs if config was dirty
                    if (timelineEditorMode.value === 'realistic' && isBuffConfigDirty(track.id)) {
                        _rebuildTrackBuffs(track.id)
                    }
                }
            });
            const connBefore = connections.value.length
            connections.value = connections.value.filter(conn => !_connectionTouchesAnyActionId(conn, targets));
            connCount += (connBefore - connections.value.length)

            weaponStatuses.value = weaponStatuses.value.filter(s => !s.sourceActionInstanceId || !targets.has(s.sourceActionInstanceId))
            teamBuffStatuses.value = teamBuffStatuses.value.filter(s => !s.sourceActionInstanceId || !targets.has(s.sourceActionInstanceId))
            debuffStatuses.value = debuffStatuses.value.filter(s => !s.sourceActionInstanceId || !targets.has(s.sourceActionInstanceId))
        }

        if (selectedConnectionId.value) {
            const initialLen = connections.value.length;
            connections.value = connections.value.filter(c => c.id !== selectedConnectionId.value);
            if (connections.value.length < initialLen) connCount++;
            selectedConnectionId.value = null;
        }

        itemsToPull.sort((a, b) => b.time - a.time).forEach(item => {
            pullSubsequentActions(item.time, item.amount);
        });

        if (actionCount + connCount > 0) {
            clearSelection();
            commitState();
        }

        return { actionCount, connCount, total: actionCount + connCount };
    }

    function moveTrack(fromIndex, toIndex) {
        if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= tracks.value.length || toIndex >= tracks.value.length) {
            return
        }

        const temp = tracks.value[fromIndex]
        tracks.value[fromIndex] = tracks.value[toIndex]
        tracks.value[toIndex] = temp

        commitState()
    }

    function pasteSelection(targetStartTime = null) {
        if (!clipboard.value) return
        const { actions, connections: clipConns, baseTime } = clipboard.value
        const idMap = new Map()
        const globalEffectIdMap = new Map()

        let timeDelta = 0
        if (targetStartTime !== null) {
            timeDelta = targetStartTime - baseTime
        } else {
            timeDelta = (cursorCurrentTime.value >= 0) ? (cursorCurrentTime.value - baseTime) : 1.0
        }

        actions.forEach(item => {
            const track = tracks.value[item.trackIndex]
            if (!track) return
            const newId = `inst_${uid()}`
            idMap.set(item.data.instanceId, newId)
            const clonedAction = JSON.parse(JSON.stringify(item.data))

            if (clonedAction.physicalAnomaly && clonedAction.physicalAnomaly.length > 0) {
                const anomalyRows = Array.isArray(clonedAction.physicalAnomaly?.[0]) ? clonedAction.physicalAnomaly : [clonedAction.physicalAnomaly]
                anomalyRows.forEach(row => {
                    if (!Array.isArray(row)) return
                    row.forEach(effect => {
                        if (!effect) return
                        const oldId = effect._id
                        const newEffectId = uid()
                        effect._id = newEffectId
                        if (oldId) globalEffectIdMap.set(oldId, newEffectId)
                    })
                })
            }
            if (globalEffectIdMap.size > 0 && clonedAction.damageTicks) {
                clonedAction.damageTicks.forEach(tick => {
                    if (!tick || !Array.isArray(tick.boundEffects) || tick.boundEffects.length === 0) return
                    tick.boundEffects = tick.boundEffects.map(id => globalEffectIdMap.get(id) || id)
                })
            }
            const newStartTime = Math.max(0, item.data.startTime + timeDelta)
            const newAction = { ...clonedAction, instanceId: newId, startTime: newStartTime, logicalStartTime: newStartTime }
            track.actions.push(newAction)
            track.actions.sort((a, b) => a.startTime - b.startTime)
        })
        clipConns.forEach(conn => {
            const newFrom = idMap.get(conn.from)
            const newTo = idMap.get(conn.to)
            if (newFrom && newTo) {
                const newConn = {
                    ...conn,
                    id: `conn_${uid()}`,
                    from: newFrom,
                    to: newTo
                }

                if (conn.fromEffectId && globalEffectIdMap.has(conn.fromEffectId)) {
                    newConn.fromEffectId = globalEffectIdMap.get(conn.fromEffectId)
                }

                if (conn.toEffectId && globalEffectIdMap.has(conn.toEffectId)) {
                    newConn.toEffectId = globalEffectIdMap.get(conn.toEffectId)
                }
                connections.value.push(newConn)
            }
        })

        clearSelection()
        setMultiSelection(Array.from(idMap.values()))
        commitState()
    }

    function updateConnectionPort(connectionId, portType, direction) {
        const conn = connections.value.find(c => c.id === connectionId)
        if (conn) {
            if (portType === 'source') {
                conn.sourcePort = direction
            } else if (portType === 'target') {
                conn.targetPort = direction
            }
            commitState()
        }
    }

    function removeConnection(connId) {
        connections.value = connections.value.filter(c => c.id !== connId)
        commitState()
    }

    function updateConnection(id, payload) {
        const conn = connections.value.find(c => c.id === id)
        if (conn) { Object.assign(conn, payload); commitState(); }
    }

    function updateAction(actionId, patch) {
        let found = null;
        let trackRef = null;

        tracks.value.forEach(t => {
            const idx = t.actions.findIndex(a => a.instanceId === actionId);
            if (idx !== -1) {
                found = t.actions[idx];
                trackRef = t;
            }
        });

        if (found) {
            Object.assign(found, patch);
            if (patch.startTime !== undefined) {
                found.logicalStartTime = patch.startTime;
                refreshAllActionShifts();
            }
            commitState();
        }
    }

    function updateWeaponStatus(statusId, patch) {
        const status = weaponStatuses.value.find(s => s.id === statusId)
        if (!status) return
        Object.assign(status, patch)
        if (patch.startTime !== undefined) {
            status.logicalStartTime = status.startTime
        }
        commitState()
    }

    function updateLibrarySkill(skillId, props) {
        const targetMap = isWeaponSkillId(skillId) ? weaponOverrides.value : characterOverrides.value
        if (!targetMap[skillId]) targetMap[skillId] = {}
        Object.assign(targetMap[skillId], props)
        tracks.value.forEach(track => {
            if (!track.actions) return;
            track.actions.forEach(action => { if (action.id === skillId) { Object.assign(action, props) } })
        })
        commitState()
    }

    function changeTrackOperator(trackIndex, oldOperatorId, newOperatorId) {
        const track = tracks.value[trackIndex];
        if (track) {
            if (tracks.value.some((t, i) => i !== trackIndex && t.id === newOperatorId)) { alert(tr('timelineGrid.track.operatorAlreadyInUse')); return; }
            const actionIdsToDelete = new Set(track.actions.map(a => a.instanceId));
            if (actionIdsToDelete.size > 0) {
                connections.value = connections.value.filter(conn => !_connectionTouchesAnyActionId(conn, actionIdsToDelete));
            }
            if (oldOperatorId) {
                switchEvents.value = switchEvents.value.filter(s => s.characterId !== oldOperatorId);
                weaponStatuses.value = weaponStatuses.value.filter(s => s.trackId !== oldOperatorId);
                pruneDanglingConnections()
            }
            track.weaponId = null;
            syncTrackWeaponModifiers(oldOperatorId)
            track.equipArmorId = null;
            track.equipGlovesId = null;
            track.equipAccessory1Id = null;
            track.equipAccessory2Id = null;
            track.equipArmorRefineTier = EQUIPMENT_REFINE_MAX_TIER
            track.equipGlovesRefineTier = EQUIPMENT_REFINE_MAX_TIER
            track.equipAccessory1RefineTier = EQUIPMENT_REFINE_MAX_TIER
            track.equipAccessory2RefineTier = EQUIPMENT_REFINE_MAX_TIER
            syncTrackEquipmentModifiers(oldOperatorId)
            track.id = newOperatorId;
            track.weaponCommon1Tier = WEAPON_POTENTIAL_MAX_TIER
            track.weaponCommon2Tier = WEAPON_POTENTIAL_MAX_TIER
            track.weaponBuffTier = WEAPON_POTENTIAL_MAX_TIER
            track.actions = [];
            // Reset growth with rarity-aware defaults for the new operator
            const newChar = characterRoster.value.find(c => c.id === newOperatorId)
            track.growth = createDefaultGrowth()
            track.growth.potentialLevel = getDefaultPotentialLevel(newChar?.rarity ?? 6)
            // Max out all talent levels at default promotion (E4)
            const newOpData = loadOperator(newOperatorId)
            const newTalents = newOpData.talents?.talents || []
            if (!track.growth.talentLevels) track.growth.talentLevels = {}
            for (const t of newTalents) {
                const maxLvl = getTalentMaxLevel(t, track.growth.promotion)
                track.growth.talentLevels[t.id] = maxLvl
            }
            if (activeTrackId.value === oldOperatorId) activeTrackId.value = newOperatorId;
            if (selectedActionId.value && actionIdsToDelete.has(selectedActionId.value)) clearSelection();
            commitState();
        }
    }

    function clearTrack(trackIndex) {
        const track = tracks.value[trackIndex];
        if (!track) return;
        const oldOperatorId = track.id;
        const actionIdsToDelete = new Set(track.actions.map(a => a.instanceId));
        if (actionIdsToDelete.size > 0) {
            connections.value = connections.value.filter(conn => !_connectionTouchesAnyActionId(conn, actionIdsToDelete));
        }
        if (oldOperatorId) {
            switchEvents.value = switchEvents.value.filter(s => s.characterId !== oldOperatorId);
            weaponStatuses.value = weaponStatuses.value.filter(s => s.trackId !== oldOperatorId);
            pruneDanglingConnections()
        }
        track.weaponId = null;
        if (oldOperatorId) syncTrackWeaponModifiers(oldOperatorId)
        track.equipArmorId = null;
        track.equipGlovesId = null;
        track.equipAccessory1Id = null;
        track.equipAccessory2Id = null;
        track.equipArmorRefineTier = EQUIPMENT_REFINE_MAX_TIER
        track.equipGlovesRefineTier = EQUIPMENT_REFINE_MAX_TIER
        track.equipAccessory1RefineTier = EQUIPMENT_REFINE_MAX_TIER
        track.equipAccessory2RefineTier = EQUIPMENT_REFINE_MAX_TIER
        if (oldOperatorId) syncTrackEquipmentModifiers(oldOperatorId)
        track.id = null;
        track.weaponCommon1Tier = WEAPON_POTENTIAL_MAX_TIER
        track.weaponCommon2Tier = WEAPON_POTENTIAL_MAX_TIER
        track.weaponBuffTier = WEAPON_POTENTIAL_MAX_TIER
        track.actions = [];
        if (selectedActionId.value && actionIdsToDelete.has(selectedActionId.value)) clearSelection();
        commitState();
    }

    function updateTrackMaxGauge(trackId, value) { const track = tracks.value.find(t => t.id === trackId); if (track) { track.maxGaugeOverride = value; commitState(); } }
    function updateTrackInitialGauge(trackId, value) { const track = tracks.value.find(t => t.id === trackId); if (track) { track.initialGauge = value; commitState(); } }

    function removeAnomaly(instanceId, rowIndex, colIndex) {
        let action = null;
        for (const track of tracks.value) {
            const found = track.actions.find(a => a.instanceId === instanceId);
            if (found) { action = found; break; }
        }
        if (!action) return;
        const rows = action.physicalAnomaly || [];
        if (!rows[rowIndex]) return;

        const effectToDelete = rows[rowIndex][colIndex]
        const idToDelete = effectToDelete._id
        if (idToDelete) {
            connections.value = connections.value.filter(conn => {
                const fromId = _getConnectionEndpointId(conn, 'from')
                const toId = _getConnectionEndpointId(conn, 'to')
                return fromId !== idToDelete && toId !== idToDelete && conn.fromEffectId !== idToDelete && conn.toEffectId !== idToDelete
            })
        }
        rows[rowIndex].splice(colIndex, 1);
        if (rows[rowIndex].length === 0) rows.splice(rowIndex, 1);
        commitState();
    }

    function nudgeSelection(direction) {
        const targets = new Set(multiSelectedIds.value)
        if (selectedActionId.value) targets.add(selectedActionId.value)
        if (targets.size === 0) return

        const delta = direction * snapStep.value
        let hasChanged = false

        tracks.value.forEach(track => {
            track.actions.forEach(action => {
                if (targets.has(action.instanceId) && !action.isLocked) {
                    if (action.logicalStartTime === undefined) action.logicalStartTime = action.startTime

                    let newLogicalTime = snapMs(action.logicalStartTime + delta)
                    if (newLogicalTime < 0) newLogicalTime = 0

                    if (action.logicalStartTime !== newLogicalTime) {
                        action.logicalStartTime = newLogicalTime
                        hasChanged = true
                    }
                }
            })
        })

        if (hasChanged) {
            refreshAllActionShifts()
            commitState()
        }
    }

    function copySelection() {
        const targetIds = new Set(multiSelectedIds.value)
        if (selectedActionId.value) targetIds.add(selectedActionId.value)
        if (targetIds.size === 0) return
        const copiedActions = []
        let minStartTime = Infinity
        tracks.value.forEach((track, trackIndex) => {
            track.actions.forEach(action => {
                if (targetIds.has(action.instanceId)) {
                    copiedActions.push({ trackIndex: trackIndex, data: JSON.parse(JSON.stringify(action)) })
                    if (action.startTime < minStartTime) minStartTime = action.startTime
                }
            })
        })
        const copiedConnections = connections.value.filter(conn => targetIds.has(conn.from) && targetIds.has(conn.to)).map(conn => JSON.parse(JSON.stringify(conn)))
        clipboard.value = { actions: copiedActions, connections: copiedConnections, baseTime: minStartTime }
    }

    function alignActionToTarget(targetInstanceId, alignMode) {
        const sourceId = selectedActionId.value
        if (!sourceId || sourceId === targetInstanceId) return false

        const sourceInfo = getActionById(sourceId)
        const targetInfo = getActionById(targetInstanceId)

        if (!sourceInfo || !targetInfo) return false

        const sourceAction = sourceInfo.node
        if (sourceAction.isLocked) return false
        const targetAction = targetInfo.node

        const tStart = targetAction.startTime
        const tEnd = targetAction.startTime + targetAction.duration

        const sDur = sourceAction.duration
        const sourceTw = Math.abs(Number(sourceAction.triggerWindow || 0))

        let newStartTime = sourceAction.startTime

        // 计算对齐后的渲染位置
        switch (alignMode) {
            case 'RL': newStartTime = tStart - sDur; break // [前接]
            case 'LR': newStartTime = tEnd + sourceTw; break // [后接]
            case 'LL': newStartTime = tStart + sourceTw; break // [左对齐]
            case 'RR': newStartTime = tEnd - sDur; break // [右对齐]
        }

        newStartTime = snapMs(newStartTime)

        if (sourceAction.startTime !== newStartTime) {
            sourceAction.startTime = newStartTime
            sourceAction.logicalStartTime = newStartTime
            refreshAllActionShifts()

            tracks.value[sourceInfo.trackIndex].actions.sort((a, b) => a.startTime - b.startTime)
            commitState()
            return true
        }
        return false
    }

    const nodeRects = computed(() => {
        return useNewCompiler.value ? newNodeRects.value : legacyNodeRects.value;
    });

    const newNodeRects = computed(() => {
        const rects = {}
        const ACTION_BORDER = 2
        const LINE_GAP = 6
        const LINE_HEIGHT = 2

        compiledTimeline.value.actions.forEach(resAction => {
            const left = timeToPx(resAction.realStartTime)
            const width = timeToPx(resAction.realStartTime + resAction.realDuration) - timeToPx(resAction.realStartTime)
            const finalWidth = width < 2 ? 2 : width
            const trackRect = trackLaneRects.value[resAction.trackIndex]

            let y = 0
            if (trackRect) {
                y = trackRect.top
            }

            const rect = {
                left,
                width: finalWidth,
                right: left + finalWidth,
                height: trackRect?.height ?? 0,
                top: y - timelineRect.value.top,
            }

            let triggerWindowLayout = { hasWindow: false }
            if (resAction.triggerWindow && resAction.triggerWindow.hasWindow) {
                const twDuration = resAction.triggerWindow.duration
                const twStart = Math.max(0, resAction.realStartTime - twDuration)
                const twWidth = timeToPx(resAction.realStartTime) - timeToPx(twStart)

                const barYRelative = ACTION_BORDER + LINE_GAP - LINE_HEIGHT / 2

                const leftEdge = -ACTION_BORDER
                const barY = rect.top + rect.height + barYRelative - ACTION_BORDER
                const triggerBarRight = rect.left + leftEdge
                const triggerBarLeft = triggerBarRight - twWidth

                triggerWindowLayout = {
                    rect: {
                        left: triggerBarLeft,
                        right: triggerBarRight,
                        top: barY,
                        height: LINE_HEIGHT,
                        width: twWidth
                    },
                    localTransform: `translate(${leftEdge - twWidth}px, ${barYRelative}px)`,
                    hasWindow: true
                }
            }

            const barYRelative = ACTION_BORDER + LINE_GAP - LINE_HEIGHT / 2
            const leftEdge = -ACTION_BORDER
            const rightEdge = leftEdge + finalWidth + ACTION_BORDER
            const barY = rect.top + rect.height + barYRelative - ACTION_BORDER

            rects[resAction.id] = {
                rect,
                bar: {
                    top: barY,
                    relativeY: barYRelative,
                    leftEdge,
                    rightEdge
                },
                triggerWindow: undefined
            }
        })
        return rects
    });

    const legacyNodeRects = computed(() => {
        const rects = {}
        const ACTION_BORDER = 2
        const LINE_GAP = 6
        const LINE_HEIGHT = 2

        actionMap.value.forEach(action => {
            const effectiveDuration = computedEffectiveActions.value.get(action.id)?.duration ?? action.node.duration
            const end = getShiftedEndTime(action.node.startTime, effectiveDuration, action.id)
            const start = action.node.startTime || 0
            const left = timeToPx(start)
            const width = timeToPx(end) - timeToPx(start)
            const finalWidth = width < 2 ? 2 : width
            const trackRect = trackLaneRects.value[action.trackIndex]

            let y = 0
            if (trackRect) {
                y = trackRect.top
            }

            const rect = {
                left,
                width: finalWidth,
                right: left + finalWidth,
                height: trackRect?.height ?? 0,
                top: y - timelineRect.value.top,
            }

            // 计算触发窗口布局
            const rawTw = action.node.triggerWindow || 0
            const snappedWindow = Math.round(Math.abs(rawTw) * 10) / 10
            let triggerWindowLayout = null

            // 相对动作底部的位移
            const barYRelative = ACTION_BORDER + LINE_GAP - LINE_HEIGHT / 2
            const leftEdge = -ACTION_BORDER
            const rightEdge = leftEdge + finalWidth + ACTION_BORDER

            // 相对时间轴的位移
            // rect.top 包含一个 ACTION_BORDER，所以这里要减去
            const barY = rect.top + rect.height + barYRelative - ACTION_BORDER

            if (snappedWindow > 0) {
                const twStart = Math.max(0, start - snappedWindow)
                const twWidth = timeToPx(start) - timeToPx(twStart)

                const triggerBarRight = rect.left + leftEdge
                const triggerBarLeft = triggerBarRight - twWidth

                triggerWindowLayout = {
                    rect: {
                        left: triggerBarLeft,
                        right: triggerBarRight,
                        top: barY,
                        height: LINE_HEIGHT,
                        width: twWidth
                    },
                    localTransform: `translate(${leftEdge - twWidth}px, ${barYRelative}px)`,
                    hasWindow: true
                }
            } else {
                triggerWindowLayout = { hasWindow: false }
            }

            rects[action.id] = {
                rect,
                bar: {
                    top: barY,
                    relativeY: barYRelative,
                    leftEdge,
                    rightEdge
                },
                triggerWindow: triggerWindowLayout
            }
        })

        return rects
    })

    const effectLayouts = computed(() => {
        return useNewCompiler.value ? newEffectLayouts.value : legacyEffectLayouts.value;
    });

    const newEffectLayouts = computed(() => {
        const layoutMap = new Map()
        const ICON_SIZE = 20
        const BAR_MARGIN = 2
        const VERTICAL_GAP = 3
        const ACTION_BORDER = 2

        compiledTimeline.value.actions.forEach(resAction => {
            const actionRect = nodeRects.value[resAction.id]?.rect
            if (!actionRect) return

            resAction.effects.forEach(effect => {
                if (isDebuffAnomalyType(effect.node?.type)) return

                const effectId = effect.id

                const effectLeft = timeToPx(effect.realStartTime)

                const relativeX = effectLeft - actionRect.left
                const relativeY = (effect.rowIndex * (VERTICAL_GAP + ICON_SIZE)) + VERTICAL_GAP + ACTION_BORDER;
                const localTransform = `translate(${relativeX}px, ${-relativeY}px)`

                const absoluteTop = actionRect.top - relativeY - ICON_SIZE + ACTION_BORDER;
                const absoluteLeft = effectLeft + 1

                const iconRect = {
                    left: absoluteLeft,
                    width: ICON_SIZE,
                    right: absoluteLeft + ICON_SIZE,
                    height: ICON_SIZE,
                    top: absoluteTop
                };

                const displayDuration = effect.displayDuration

                let finalBarWidth = displayDuration > 0 ? (timeToPx(effect.realStartTime + displayDuration) - timeToPx(effect.realStartTime)) : 0;
                if (finalBarWidth > 0) {
                    finalBarWidth = Math.max(0, finalBarWidth - ICON_SIZE - BAR_MARGIN)
                }

                layoutMap.set(effectId, {
                    rect: iconRect,
                    localTransform,
                    barData: {
                        width: finalBarWidth,
                        isConsumed: effect.isConsumed,
                        displayDuration,
                        extensionAmount: effect.extensionAmount
                    },
                    data: effect.node,
                    actionId: resAction.id,
                    flatIndex: effect.flatIndex
                })

                if (effect.isConsumed) {
                    const barLeft = absoluteLeft + ICON_SIZE + BAR_MARGIN;
                    const barRight = barLeft + finalBarWidth;

                    const transferRect = {
                        left: barRight,
                        width: 0,
                        right: barRight,
                        height: ICON_SIZE,
                        top: absoluteTop
                    };
                    layoutMap.set(`${effectId}_transfer`, { rect: transferRect })
                }
            });
        });

        return layoutMap;
    });

    const legacyEffectLayouts = computed(() => {
        const layoutMap = new Map()
        const consumptionMap = new Map()

        connections.value.forEach(conn => {
            if (conn.isConsumption) {
                const fromEffectId = conn.fromEffectId || (conn.fromNodeType === 'effect' ? conn.fromNodeId : null)
                if (fromEffectId) {
                    consumptionMap.set(fromEffectId, conn)
                }
            }
        })

        const ICON_SIZE = 20
        const BAR_MARGIN = 2
        const VERTICAL_GAP = 3
        const ACTION_BORDER = 2

        actionMap.value.forEach(action => {
            const actionRect = nodeRects.value[action.id]?.rect

            if (!actionRect) return

            // 非攻击分段动作：若有变体条件结果，用变体的 physicalAnomaly 覆盖
            let _effectivePhysAnom = action.node.physicalAnomaly
            if (action.node.kind !== 'attack_segment') {
                const _condRes = computedActionConditionResults.value.get(action.id)
                if (_condRes?.variantId) {
                    const _charInfo = characterRoster.value.find(c => c.id === action.trackId)
                    const _variantSuffix = _condRes.variantId.replace(`${action.trackId}_variant_`, '')
                    const _variant = _charInfo?.variants?.find(v => v.id === _variantSuffix)
                    if (_variant?.physicalAnomaly !== undefined) _effectivePhysAnom = _variant.physicalAnomaly
                }
            }
            if (_effectivePhysAnom && _effectivePhysAnom.length > 0) {
                const rows = Array.isArray(_effectivePhysAnom[0])
                    ? _effectivePhysAnom
                    : [_effectivePhysAnom];

                let globalFlatIndex = 0

                rows.forEach((row, rowIndex) => {
                    row.forEach((effect, colIndex) => {
                        if (isDebuffAnomalyType(effect?.type)) return

                        const effectId = ensureEffectId(effect);
                        const myEffectIndex = globalFlatIndex++;

                        const originalOffset = Number(effect.offset) || 0;

                        // 计算图标的起始现实位置
                        const shiftedStartTimestamp = getShiftedEndTime(action.node.startTime, originalOffset, action.id);
                        const effectLeft = timeToPx(shiftedStartTimestamp);

                        // 相对动作的位置
                        const relativeX = effectLeft - actionRect.left
                        const relativeY = (rowIndex * (VERTICAL_GAP + ICON_SIZE)) + VERTICAL_GAP + ACTION_BORDER;
                        const localTransform = `translate(${relativeX}px, ${-relativeY}px)`

                        // 相对时间轴的位置
                        const absoluteTop = actionRect.top - relativeY - ICON_SIZE + ACTION_BORDER;
                        const absoluteLeft = effectLeft + 1

                        const iconRect = {
                            left: absoluteLeft,
                            width: ICON_SIZE,
                            right: absoluteLeft + ICON_SIZE,
                            height: ICON_SIZE,
                            top: absoluteTop
                        };

                        // 计算 Buff 的偏移后总时长
                        let finalDuration = getShiftedEndTime(shiftedStartTimestamp, effect.duration, action.id) - shiftedStartTimestamp;
                        let isConsumed = false

                        // 连线消耗逻辑
                        let conn = consumptionMap.get(effectId) || consumptionMap.get(`${action.id}_${myEffectIndex}`);

                        if (conn && conn.isConsumption) {
                            const targetTrack = tracks.value.find(t => t.actions.some(a => a.instanceId === conn.to));
                            const targetAction = targetTrack?.actions.find(a => a.instanceId === conn.to);
                            if (targetAction) {
                                const consumptionTime = targetAction.startTime - (conn.consumptionOffset || 0);
                                const cutDuration = consumptionTime - shiftedStartTimestamp;
                                const snappedCutDuration = snapMs(cutDuration);
                                if (snappedCutDuration >= 0) {
                                    finalDuration = Math.min(finalDuration, snappedCutDuration);
                                    isConsumed = true
                                }
                            }
                        }

                        let finalBarWidth = finalDuration > 0 ? (timeToPx(shiftedStartTimestamp + finalDuration) - timeToPx(shiftedStartTimestamp)) : 0;
                        if (finalBarWidth > 0) {
                            finalBarWidth = Math.max(0, finalBarWidth - ICON_SIZE - BAR_MARGIN)
                        }


                        layoutMap.set(effectId, {
                            rect: iconRect,
                            localTransform,
                            barData: {
                                width: finalBarWidth,
                                isConsumed,
                                displayDuration: finalDuration,
                                extensionAmount: snapMs(finalDuration - effect.duration)
                            },
                            data: effect,
                            actionId: action.id,
                            flatIndex: myEffectIndex
                        })

                        if (isConsumed) {
                            const barLeft = absoluteLeft + ICON_SIZE + BAR_MARGIN;
                            const barRight = barLeft + finalBarWidth;

                            // 时间条末端位置
                            const transferRect = {
                                left: barRight,
                                width: 0,
                                right: barRight,
                                height: ICON_SIZE,
                                top: absoluteTop
                            };
                            layoutMap.set(`${effectId}_transfer`, { rect: transferRect })
                        }
                    })
                })
            }
        })
        return layoutMap
    })

    const statusNodeRects = computed(() => {
        const map = new Map()
        const ICON_SIZE = 20
        const BAR_MARGIN = 2
        const WEAPON_OFFSET = 8
        const SET_OFFSET = 32

        for (const status of weaponStatuses.value) {
            if (!status?.id || !status.trackId) continue
            const trackIndex = tracks.value.findIndex(t => t?.id && t.id === status.trackId)
            if (trackIndex < 0) continue

            const trackRect = trackLaneRects.value[trackIndex]
            if (!trackRect) continue

            const start = Number(status.startTime) || 0
            const left = timeToPx(start)

            const offset = status.type === 'set' ? SET_OFFSET : WEAPON_OFFSET
            const top = (trackRect.top + trackRect.height + offset) - timelineRect.value.top

            const iconRect = {
                left,
                top,
                width: ICON_SIZE,
                height: ICON_SIZE,
                right: left + ICON_SIZE,
            }

            map.set(status.id, { rect: iconRect })

            const rawDuration = Number(status.duration) || 0
            const shiftedEnd = getShiftedEndTime(start, rawDuration, status.id)
            const baseFinalDuration = Math.max(0, shiftedEnd - start)

            let finalDuration = baseFinalDuration
            let isConsumed = false

            const cutTime = statusConsumptionTimeById.value?.get(status.id)
            if (Number.isFinite(cutTime)) {
                const cutDuration = cutTime - start
                if (cutDuration >= 0 && cutDuration < finalDuration - 0.0001) {
                    finalDuration = Math.max(0, cutDuration)
                    isConsumed = true
                }
            }

            if (isConsumed) {
                let finalBarWidth = finalDuration > 0 ? (timeToPx(start + finalDuration) - timeToPx(start)) : 0
                if (finalBarWidth > 0) {
                    finalBarWidth = Math.max(0, finalBarWidth - ICON_SIZE - BAR_MARGIN)
                }

                const barLeft = iconRect.left + ICON_SIZE + BAR_MARGIN
                const barRight = barLeft + finalBarWidth

                const transferRect = {
                    left: barRight,
                    width: 0,
                    right: barRight,
                    height: ICON_SIZE,
                    top: iconRect.top
                }
                map.set(`${status.id}_transfer`, { rect: transferRect })
            }
        }

        return map
    })

    const statusConsumptionTimeById = computed(() => {
        const map = new Map()

        const getNodeTime = (nodeWrap) => {
            if (!nodeWrap) return null
            if (nodeWrap.type === 'action') return Number(nodeWrap.node.startTime) || 0
            if (nodeWrap.type === 'status') return Number(nodeWrap.node.startTime) || 0
            if (nodeWrap.type === 'effect') {
                const actionWrap = getActionById(nodeWrap.actionId)
                if (!actionWrap) return null
                const offset = Number(nodeWrap.node?.offset) || 0
                return getShiftedEndTime(actionWrap.node.startTime, offset, actionWrap.id)
            }
            return null
        }

        for (const conn of connections.value) {
            if (!conn?.isConsumption) continue

            const fromId = _getConnectionEndpointId(conn, 'from')
            const toId = _getConnectionEndpointId(conn, 'to')
            if (!fromId || !toId) continue

            const fromNode = resolveNode(fromId)
            if (!fromNode || fromNode.type !== 'status') continue

            const toNode = resolveNode(toId)
            if (!toNode) continue

            const targetTime = getNodeTime(toNode)
            if (!Number.isFinite(targetTime)) continue

            const offset = Number(conn.consumptionOffset) || 0
            const consumptionTime = snapMs(targetTime - offset)

            const prev = map.get(fromId)
            if (prev === undefined || consumptionTime < prev) {
                map.set(fromId, consumptionTime)
            }
        }

        return map
    })

    function getNodeRect(id) {
        if (nodeRects.value[id]) return nodeRects.value[id]
        const effectLayout = effectLayouts.value.get(id)
        if (effectLayout) return effectLayout.rect
        const statusLayout = statusNodeRects.value.get(id)
        if (statusLayout) return statusLayout.rect
        return null
    }

    function toTimelineSpace(viewX, viewY) {
        return {
            x: viewX - timelineRect.value.left + timelineShift.value,
            y: viewY - timelineRect.value.top + timelineScrollTop.value
        }
    }

    function toViewportSpace(timelineX, timelineY) {
        return {
            x: timelineX - timelineShift.value + timelineRect.value.left,
            y: timelineY - timelineScrollTop.value + timelineRect.value.top
        }
    }


    // ===================================================================================
    // 右键菜单状态
    // ===================================================================================
    const contextMenu = ref({
        visible: false,
        x: 0,
        y: 0,
        targetId: null,
        time: 0
    })

    function openContextMenu(evt, instanceId = null, time = 0) {
        const timelinePos = toTimelineSpace(evt.clientX, evt.clientY)
        contextMenu.value = {
            visible: true,
            x: timelinePos.x,
            y: timelinePos.y,
            targetId: instanceId,
            time: time
        }
    }

    function closeContextMenu() {
        contextMenu.value.visible = false
    }

    // ===================================================================================
    // 动作属性切换 (锁定/静音/改色)
    // ===================================================================================

    function toggleActionLock(instanceId) {
        const info = getActionById(instanceId)
        if (info) {
            info.node.isLocked = !info.node.isLocked
            commitState()
        }
    }

    function toggleActionDisable(instanceId) {
        const info = getActionById(instanceId)
        if (info) {
            info.node.isDisabled = !info.node.isDisabled
            commitState()
        }
    }

    function setActionColor(instanceId, color) {
        const info = getActionById(instanceId)
        if (info) {
            info.node.customColor = color
            commitState()
        }
    }

    // ===================================================================================
    // 监控数据计算 (Monitor Data)
    // ===================================================================================
    const useNewCompiler = ref(false);

    function toggleNewCompiler() {
        useNewCompiler.value = !useNewCompiler.value;
    }

    // ── Build simulation-ready tracks: inject final stats (base + weapon/equipment deltas) ──
    // Also carries growth.skillLevels for future per-level multiplier selection.
    function buildSimulationTracks() {
        const effectiveActions = computedEffectiveActions.value
        return tracks.value.map(t => {
            if (!t.id) return t
            const finalStats = resolveTrackFinalStats(t.id)
            const growth = getTrackGrowth(t.id)
            const charInfo = characterRoster.value.find(c => c.id === t.id)

            // Attach variant data and release conditions to each action for engine-side evaluation
            let actions = (t.actions || []).map(action => {
                const enriched = { ...action }
                // Attach releaseConditions for this action type
                const condList = charInfo?.releaseConditions?.[action.type]
                if (condList?.length) {
                    enriched.releaseConditions = JSON.parse(JSON.stringify(condList))
                    // Attach referenced variants
                    const variantIds = new Set(condList.map(c => c.result?.variantId).filter(Boolean))
                    if (variantIds.size > 0 && charInfo.variants?.length) {
                        enriched.variants = charInfo.variants
                            .filter(v => variantIds.has(`${t.id}_variant_${v.id}`))
                            .map(v => JSON.parse(JSON.stringify(v)))
                    }
                }
                // Legacy: overlay variant damageTicks from computedEffectiveActions
                const eff = effectiveActions.get(action.instanceId)
                if (eff?.damageTicks) {
                    enriched.damageTicks = JSON.parse(JSON.stringify(eff.damageTicks))
                }
                return enriched
            })

            // Resolve gauge max with potential modifier so compiler/simulation uses correct cap
            const resolvedMaxGauge = charInfo ? resolveGaugeMax(t.id, t, charInfo) : null

            return {
                ...t,
                actions,
                stats: finalStats || t.stats,
                maxGaugeOverride: resolvedMaxGauge || t.maxGaugeOverride,
                _growth: growth, // sidecar — not consumed by compiler yet, but available
            }
        })
    }

    const compiledScenario = computed(() => {
        const currentScenario = scenarioList.value.find(s => s.id === activeScenarioId.value);
        if (!currentScenario) return null;
        const { timeline, actors, teamConfig, enemyConfig } = compileScenario(
            {
                ...currentScenario.data,
                tracks: buildSimulationTracks()
            }
            , { systemConstants: systemConstants.value });
        return { timeline, actors, teamConfig, enemyConfig };
    });

    const compiledTimeline = computed(() => {
        return compiledScenario.value?.timeline;
    });

    const simulation = computed(() => {
        const scenario = compiledScenario.value;
        if (!scenario) return null;
        const { timeline, teamConfig, enemyConfig, actors } = scenario;

        // Build db + equipment configs for the simulation pipeline.
        // This enables weapon triggered passives and set bonus registration.
        const db = {
            weaponDatabase: weaponDatabase.value,
            equipmentDatabase: equipmentDatabase.value,
        };

        // Build equipmentConfigs from tracks with auto set bonus detection.
        // CATEGORY_TO_SET_ID imported from registry.ts — single source of truth.
        const eqDb = db.equipmentDatabase || []
        const equipConfigs = tracks.value
            .filter(t => t.weaponId || t.equipArmorId || t.equipGlovesId || t.equipAccessory1Id || t.equipAccessory2Id)
            .map(t => {
                // Auto-detect set bonus from equipped item categories
                const equippedIds = [t.equipArmorId, t.equipGlovesId, t.equipAccessory1Id, t.equipAccessory2Id].filter(Boolean)
                let detectedSetId = undefined
                if (equippedIds.length >= 3 && eqDb.length > 0) {
                    const catCounts = new Map()
                    for (const eqId of equippedIds) {
                        const item = eqDb.find(e => e.id === eqId)
                        const cat = item?.category
                        if (cat) catCounts.set(cat, (catCounts.get(cat) || 0) + 1)
                    }
                    for (const [cat, count] of catCounts) {
                        if (count >= 3 && CATEGORY_TO_SET_ID[cat]) {
                            detectedSetId = CATEGORY_TO_SET_ID[cat]
                            break
                        }
                    }
                }

                return {
                    actorId: t.id,
                    weaponId: undefined,   // mapped inside registerEquipmentPassives
                    weaponDatabaseId: t.weaponId || undefined,
                    setId: detectedSetId,
                }
            })
            .filter(c => c.weaponDatabaseId || c.setId);

        // Collect action instanceIds that are in enhanced/variant state
        const enhancedIds = new Set(computedEffectiveActions.value.keys());

        // Build per-track skill level map for multiplier selection
        const skillLevelMap = {}
        for (const t of tracks.value) {
            if (!t.id) continue
            const g = getTrackGrowth(t.id)
            skillLevelMap[t.id] = {
                attack: skillToUnified(g.skillLevels.attack),
                skill: skillToUnified(g.skillLevels.skill),
                link: skillToUnified(g.skillLevels.link),
                ultimate: skillToUnified(g.skillLevels.ultimate),
            }
        }

        // Crit mode: "expected" for deterministic damage stats, "real" for actual simulation
        // TODO: expose this as a UI toggle per timeline mode
        const critMode = 'expected'

        try {
            return simulate(timeline, teamConfig, enemyConfig, actors, {
                equipmentConfigs: equipConfigs.length > 0 ? equipConfigs : undefined,
                db: (db.weaponDatabase?.length || db.equipmentDatabase?.length) ? db : undefined,
                critMode,
                legalityPolicy: legalityPolicy.value,
                enhancedActionIds: enhancedIds.size > 0 ? enhancedIds : undefined,
                skillLevelMap,
            });
        } catch (err) {
            console.error('[simulation] runtime error:', err)
            return null
        }
    });

    /**
     * Legality issues grouped by action instanceId.
     * Map<actionId, LegalityIssue[]>
     *
     * UI components can use this to show warning/error indicators on action nodes.
     * Issues come from the simulation engine's authoritative legality checker.
     */
    // Re-verify GAUGE_INSUFFICIENT using store's calculateGaugeData as fallback.
    // Check gauge just BEFORE the ultimate start (issue.time - epsilon),
    // because calculateGaugeData deducts gaugeCost at the same time point.
    function _filterGaugeIssues(issues) {
        return issues.filter(issue => {
            if (issue.code !== 'GAUGE_INSUFFICIENT') return true
            const gaugeData = calculateGaugeData(issue.actorId)
            const gaugeBeforeAction = _interpolateSeriesAt(gaugeData, issue.time - 0.001, 'val')
            const charI = characterRoster.value.find(c => c.id === issue.actorId)
            const trackObj = tracks.value.find(t => t.id === issue.actorId)
            const maxG = (charI && trackObj) ? resolveGaugeMax(issue.actorId, trackObj, charI) : 300
            return gaugeBeforeAction < maxG - 1
        })
    }

    const legalityIssuesByAction = computed(() => {
        const issues = _filterGaugeIssues(simulation.value?.legalityIssues ?? [])
        const map = new Map()
        for (const issue of issues) {
            if (!map.has(issue.actionId)) {
                map.set(issue.actionId, [])
            }
            map.get(issue.actionId).push(issue)
        }
        return map
    })

    /** Flat list of all legality issues, sorted by time. For panel/list views. */
    const sortedLegalityIssues = computed(() => {
        const issues = _filterGaugeIssues(simulation.value?.legalityIssues ?? [])
        return [...issues].sort((a, b) => a.time - b.time)
    })

    // ── Validation (Free Mode) ──

    function validateTimeline() {
        const scenario = compiledScenario.value
        if (!scenario) {
            validationResult.value = { passed: true, issues: [] }
            validationDialogVisible.value = true
            validationPassed.value = true
            return
        }
        const { timeline, teamConfig, enemyConfig, actors } = scenario
        const db = {
            weaponDatabase: weaponDatabase.value,
            equipmentDatabase: equipmentDatabase.value,
        }
        const eqDb = db.equipmentDatabase || []
        const equipConfigs = tracks.value
            .filter(t => t.weaponId || t.equipArmorId || t.equipGlovesId || t.equipAccessory1Id || t.equipAccessory2Id)
            .map(t => {
                const equippedIds = [t.equipArmorId, t.equipGlovesId, t.equipAccessory1Id, t.equipAccessory2Id].filter(Boolean)
                let detectedSetId = undefined
                if (equippedIds.length >= 3 && eqDb.length > 0) {
                    const catCounts = new Map()
                    for (const eqId of equippedIds) {
                        const item = eqDb.find(e => e.id === eqId)
                        const cat = item?.category
                        if (cat) catCounts.set(cat, (catCounts.get(cat) || 0) + 1)
                    }
                    for (const [cat, count] of catCounts) {
                        if (count >= 3 && CATEGORY_TO_SET_ID[cat]) {
                            detectedSetId = CATEGORY_TO_SET_ID[cat]
                            break
                        }
                    }
                }
                return {
                    actorId: t.id,
                    weaponId: undefined,
                    weaponDatabaseId: t.weaponId || undefined,
                    setId: detectedSetId,
                }
            })
            .filter(c => c.weaponDatabaseId || c.setId)

        const enhancedIds = new Set(computedEffectiveActions.value.keys())
        const skillLevelMap = {}
        for (const t of tracks.value) {
            if (!t.id) continue
            const g = getTrackGrowth(t.id)
            skillLevelMap[t.id] = {
                attack: skillToUnified(g.skillLevels.attack),
                skill: skillToUnified(g.skillLevels.skill),
                link: skillToUnified(g.skillLevels.link),
                ultimate: skillToUnified(g.skillLevels.ultimate),
            }
        }

        try {
            const result = simulate(timeline, teamConfig, enemyConfig, actors, {
                equipmentConfigs: equipConfigs.length > 0 ? equipConfigs : undefined,
                db: (db.weaponDatabase?.length || db.equipmentDatabase?.length) ? db : undefined,
                critMode: 'expected',
                legalityPolicy: 'strict',
                enhancedActionIds: enhancedIds.size > 0 ? enhancedIds : undefined,
                skillLevelMap,
            })
            // Filter GAUGE_INSUFFICIENT: always re-verify with store's calculateGaugeData
            // (authoritative source that accounts for all gaugeGain + efficiency)
            const rawIssues = result.legalityIssues ?? []
            const issues = _filterGaugeIssues(rawIssues)
            validationResult.value = {
                passed: issues.length === 0,
                issues: [...issues].sort((a, b) => a.time - b.time),
            }
            validationPassed.value = issues.length === 0
        } catch (err) {
            console.error('[validateTimeline] runtime error:', err)
            validationResult.value = { passed: false, issues: [], error: String(err) }
            validationPassed.value = false
        }
        validationDialogVisible.value = true
    }

    // ── Playhead Simulation (Realistic Mode) ──

    /**
     * Run simulation up to a target time for skill availability checking.
     * Filters compiled timeline actions to those starting <= targetTime,
     * then runs the full simulation pipeline.
     */
    function _runSimulationUpTo(targetTime) {
        const scenario = compiledScenario.value
        if (!scenario) return null
        const { timeline, teamConfig, enemyConfig, actors } = scenario

        // Filter timeline actions to only include those at or before targetTime
        const filteredActions = timeline.actions.filter(a => a.startTime <= targetTime)
        const filteredTimeline = { ...timeline, actions: filteredActions }

        const db = {
            weaponDatabase: weaponDatabase.value,
            equipmentDatabase: equipmentDatabase.value,
        }
        const eqDb = db.equipmentDatabase || []
        const equipConfigs = tracks.value
            .filter(t => t.weaponId || t.equipArmorId || t.equipGlovesId || t.equipAccessory1Id || t.equipAccessory2Id)
            .map(t => {
                const equippedIds = [t.equipArmorId, t.equipGlovesId, t.equipAccessory1Id, t.equipAccessory2Id].filter(Boolean)
                let detectedSetId = undefined
                if (equippedIds.length >= 3 && eqDb.length > 0) {
                    const catCounts = new Map()
                    for (const eqId of equippedIds) {
                        const item = eqDb.find(e => e.id === eqId)
                        const cat = item?.category
                        if (cat) catCounts.set(cat, (catCounts.get(cat) || 0) + 1)
                    }
                    for (const [cat, count] of catCounts) {
                        if (count >= 3 && CATEGORY_TO_SET_ID[cat]) {
                            detectedSetId = CATEGORY_TO_SET_ID[cat]
                            break
                        }
                    }
                }
                return {
                    actorId: t.id,
                    weaponId: undefined,
                    weaponDatabaseId: t.weaponId || undefined,
                    setId: detectedSetId,
                }
            })
            .filter(c => c.weaponDatabaseId || c.setId)

        const enhancedIds = new Set(computedEffectiveActions.value.keys())
        const skillLevelMap = {}
        for (const t of tracks.value) {
            if (!t.id) continue
            const g = getTrackGrowth(t.id)
            skillLevelMap[t.id] = {
                attack: skillToUnified(g.skillLevels.attack),
                skill: skillToUnified(g.skillLevels.skill),
                link: skillToUnified(g.skillLevels.link),
                ultimate: skillToUnified(g.skillLevels.ultimate),
            }
        }

        try {
            return simulate(filteredTimeline, teamConfig, enemyConfig, actors, {
                equipmentConfigs: equipConfigs.length > 0 ? equipConfigs : undefined,
                db: (db.weaponDatabase?.length || db.equipmentDatabase?.length) ? db : undefined,
                critMode: 'expected',
                legalityPolicy: 'strict',
                enhancedActionIds: enhancedIds.size > 0 ? enhancedIds : undefined,
                skillLevelMap,
            })
        } catch (err) {
            console.error('[playheadSimulation] runtime error:', err)
            return null
        }
    }

    const playheadSimulation = computed(() => {
        if (timelineEditorMode.value !== 'realistic') return null
        return _runSimulationUpTo(playheadTime.value)
    })

    /**
     * Map<skillId, { available: boolean, reasons: string[] }>
     * Shows which skills can be cast at the current playhead position.
     */
    const playheadSkillAvailability = computed(() => {
        if (timelineEditorMode.value !== 'realistic') return null
        const sim = playheadSimulation.value
        const result = new Map()
        const activeId = activeTrackId.value
        if (!activeId || !sim) return result

        const state = sim.state
        const time = playheadTime.value
        const actor = state.actors?.get(activeId)
        if (!actor) return result

        // Project SP at playhead time (accounts for regen between last event and playhead)
        const spSeriesData = projectSpSeries(sim.simLog, sim.state.getInitialSnapshot())
        const currentSp = _interpolateSeriesAt(spSeriesData, time, 'sp')

        for (const skill of activeSkillLibrary.value) {
            const reasons = []
            let available = true

            // SP check
            const spCost = Number(skill.spCost) || 0
            if (spCost > 0 && currentSp < spCost - 0.01) {
                available = false
                reasons.push('技力不足')
            }

            // Gauge check (ultimate)
            if (skill.type === 'ultimate') {
                const gauge = actor.getGauge()
                const maxGauge = actor.getMaxGauge()
                if (gauge < maxGauge - 0.01) {
                    available = false
                    reasons.push('能量不足')
                }
            }

            // Cooldown check
            const skillId = skill.skillId || skill.id
            if (skillId && actor.isOnCooldown && actor.isOnCooldown(skillId, time)) {
                available = false
                reasons.push('冷却中')
            }

            // Condition check (link skills with allowedTypes)
            if (skill.allowedTypes?.length > 0) {
                try {
                    const conditionMet = checkConditionsMet(skill.allowedTypes, state, time)
                    if (!conditionMet) {
                        available = false
                        reasons.push('施放条件未满足')
                    }
                } catch (e) {
                    // If condition check fails, don't block
                }
            }

            result.set(skill.id, { available, reasons })
        }
        return result
    })

    // ── Link Queue at Playhead (Realistic Mode) ──
    const linkQueueAtPlayhead = computed(() => {
        if (timelineEditorMode.value !== 'realistic') return []
        const sim = playheadSimulation.value
        if (!sim) return []

        // Collect already-cast links (needed by both projection and queue)
        const castLinks = []
        for (const track of tracks.value) {
            for (const a of track.actions) {
                if (a.type === 'link' && !a.isDisabled) castLinks.push({ trackId: track.id, time: Number(a.startTime) || 0 })
            }
        }

        // Build track configs from link_trigger conditions
        const trackConfigs = tracks.value.map((track, idx) => {
            const char = characterRoster.value.find(c => c.id === track.id)
            if (!char?.link_trigger?.trigger) return null
            return {
                trackId: track.id,
                trackIndex: idx,
                condition: char.link_trigger,
                avatar: char.avatar || '',
                linkCooldown: Number(char.link_cooldown) || 0,
            }
        }).filter(Boolean)
        if (!trackConfigs.length) return []

        const triggers = projectLinkTriggerSeries(sim.simLog, trackConfigs, castLinks, computedConvertEvents.value)

        // Collect locked operators (have active action at playhead time)
        const lockedIds = new Set()
        for (const cfg of trackConfigs) {
            try {
                const actor = sim.state.actors?.get(cfg.trackId)
                if (actor?.getActiveAction?.()) lockedIds.add(cfg.trackId)
            } catch {}
        }

        return computeLinkQueueAt(triggers, playheadTime.value, trackConfigs, lockedIds, sim.state, castLinks)
    })

    /**
     * Check skill availability at an arbitrary future time (for drag-to-future).
     * Runs a simulation up to targetTime and checks the specific skill.
     */
    function checkSkillAvailabilityAt(trackId, skill, targetTime, options = {}) {
        const sim = _runSimulationUpTo(targetTime)
        if (!sim) return { available: true, reasons: [] }

        const state = sim.state
        const actor = state.actors?.get(trackId)
        if (!actor) return { available: true, reasons: [] }

        const reasons = []
        let available = true

        // Project SP at targetTime using spSeries (accounts for regen between events)
        const spSeriesData = projectSpSeries(sim.simLog, sim.state.getInitialSnapshot())
        const currentSp = _interpolateSeriesAt(spSeriesData, targetTime, 'sp')
        const spCost = Number(skill.spCost) || 0
        if (spCost > 0 && currentSp < spCost - 0.01) {
            available = false
            reasons.push('技力不足')
        }

        if (skill.type === 'ultimate') {
            // Use store's gauge calculation (accounts for gaugeGain + efficiency) instead of simulation engine
            const gaugeData = calculateGaugeData(trackId)
            const gauge = _interpolateSeriesAt(gaugeData, targetTime, 'val')
            const charInfo = characterRoster.value.find(c => c.id === trackId)
            const trackObj = tracks.value.find(t => t.id === trackId)
            const maxGauge = (charInfo && trackObj) ? resolveGaugeMax(trackId, trackObj, charInfo) : (actor.getMaxGauge())
            if (gauge < maxGauge - 0.01) {
                available = false
                reasons.push(`能量不足 (${Math.floor(gauge)}/${maxGauge})`)
            }
        }

        const skillId = skill.skillId || skill.id
        if (skillId && actor.isOnCooldown && actor.isOnCooldown(skillId, targetTime)) {
            available = false
            reasons.push('冷却中')
        }

        // Skip condition check when casting from link queue (6s window handles it)
        if (!options.skipConditions && skill.allowedTypes?.length > 0) {
            try {
                const conditionMet = checkConditionsMet(skill.allowedTypes, state, targetTime)
                if (!conditionMet) {
                    available = false
                    reasons.push('施放条件未满足')
                }
            } catch (e) {
                // If condition check fails, don't block
            }
        }

        return { available, reasons }
    }

    const spSeries = computed(() => {
        if (!simulation.value) return [];
        return projectSpSeries(simulation.value.simLog, simulation.value.state.getInitialSnapshot());
    });

    const staggerSeries = computed(() => {
        if (!simulation.value) return [];
        return projectStaggerSeries(simulation.value.simLog, simulation.value.state.getInitialSnapshot(), compiledScenario.value.enemyConfig);
    });

    // ── Phase 4: Projected weapon/team/debuff buffs from simLog ──
    const _projectedBuffs = computed(() => {
        const sim = simulation.value
        if (!sim?.simLog?.length) return null
        const tIds = tracks.value.filter(t => t.id).map(t => t.id)
        const icons = {}
        for (const w of weaponDatabase.value) { if (w.id && w.icon) icons[w.id] = w.icon }
        return projectWeaponBuffTimeline(sim.simLog, tIds, icons)
    })

    // Effective statuses: prefer sim-projected, fallback to store auto-generated
    // Until engine weapon triggers cover all weapons, keep store's _autoGenerateBuffs results
    const effectiveWeaponStatuses = computed(() => {
        const projected = _projectedBuffs.value?.weaponStatuses || []
        // Use projected if available, otherwise all store statuses
        return projected.length > 0
            ? [...projected, ...weaponStatuses.value.filter(s => s.type === 'set')]
            : weaponStatuses.value
    })
    const effectiveTeamBuffStatuses = computed(() => {
        const projected = _projectedBuffs.value?.teamBuffStatuses || []
        return projected.length > 0 ? projected : teamBuffStatuses.value
    })
    const effectiveDebuffStatuses = computed(() => {
        const projected = _projectedBuffs.value?.debuffStatuses || []
        return projected.length > 0 ? projected : debuffStatuses.value
    })

    const timeContext = computed(() => compiledTimeline.value.timeContext);

    const legacyGlobalExtensions = computed(() => {
        const sources = [];
        tracks.value.forEach(track => {
            track.actions.forEach(action => {
                if (action.isDisabled || (action.triggerWindow || 0) < 0) return;
                if (action.type === 'link' || action.type === 'ultimate') {
                    sources.push({
                        logicalTime: action.logicalStartTime ?? action.startTime,
                        startTime: action.startTime,
                        type: action.type,
                        instanceId: action.instanceId,
                        animationTime: Number(action.animationTime) || 1.5
                    });
                }
            });
        });
        sources.sort((a, b) => a.logicalTime - b.logicalTime);

        const extensions = [];
        let cumulativeTime = 0;
        for (let i = 0; i < sources.length; i++) {
            const current = sources[i];
            const next = sources[i + 1];
            let amount = 0;

            if (current.type === 'ultimate') {
                amount = current.animationTime;
            } else {
                if (next) {
                    const gap = next.logicalTime - current.logicalTime;
                    amount = Math.min(0.5, Math.max(0.1, snapMs(gap)));
                } else {
                    amount = 0.5;
                }
            }
            const gameTime = current.startTime - cumulativeTime;
            extensions.push({
                time: current.startTime,
                gameTime: gameTime,
                amount: amount,
                sourceId: current.instanceId,
                logicalTime: current.logicalTime,
                cumulativeFreezeTime: cumulativeTime
            });
            cumulativeTime += amount;
        }
        return extensions;
    });

    const globalExtensions = computed(() => {
        return useNewCompiler.value ? compiledTimeline.value.timeExtensions : legacyGlobalExtensions.value;
    });

    function refreshAllActionShifts(excludeIds = []) {
        const excludeSet = new Set(Array.isArray(excludeIds) ? excludeIds : [excludeIds]);

        const allActions = tracks.value.flatMap(t => t.actions)
            .sort((a, b) => (a.logicalStartTime ?? a.startTime) - (b.logicalStartTime ?? b.startTime));

        const stopSources = allActions.filter(a => (a.type === 'link' || a.type === 'ultimate') && !a.isDisabled && (a.triggerWindow || 0) >= 0);

        let lastPhysicalEnd = 0;
        const sourceShiftMap = new Map();

        stopSources.forEach((source, index) => {
            const nextSource = stopSources[index + 1];

            const physicalStart = Math.max(source.logicalStartTime, lastPhysicalEnd);

            let amount = 0;
            if (source.type === 'ultimate') {
                amount = Number(source.animationTime) || 1.5;
            } else {
                if (nextSource) {
                    const gap = nextSource.logicalStartTime - source.logicalStartTime;
                    amount = Math.min(0.5, Math.max(0.1, snapMs(gap)));
                } else {
                    amount = 0.5;
                }
            }

            const shift = physicalStart - source.logicalStartTime;
            sourceShiftMap.set(source.instanceId, { shift, amount, physicalStart, physicalEnd: physicalStart + amount });

            lastPhysicalEnd = physicalStart + amount;
        });

        allActions.forEach(a => {
            if (excludeSet.has(a.instanceId)) return;

            const activeSource = [...stopSources].reverse().find(s => s.logicalStartTime <= a.logicalStartTime);

            if (activeSource) {
                const ctx = sourceShiftMap.get(activeSource.instanceId);

                if (a.instanceId === activeSource.instanceId) {
                    a.startTime = snapMs(ctx.physicalStart);
                } else {
                    const normalShiftedTime = a.logicalStartTime + ctx.shift;
                    a.startTime = snapMs(Math.max(normalShiftedTime, ctx.physicalEnd));
                }
            } else {
                a.startTime = a.logicalStartTime;
            }
        });

        tracks.value.forEach(t => t.actions.sort((a, b) => a.startTime - b.startTime));
    }

    function getShiftedEndTime(startTime, duration, excludeActionId = null) {
        if (useNewCompiler.value) {
            return timeContext.value.getShiftedEndTime(startTime, duration, excludeActionId);
        }

        let currentTimeLimit = startTime + duration;
        let processedExtensions = new Set();
        let changed = true;
        while (changed) {
            changed = false;
            globalExtensions.value.forEach(ext => {
                if (ext.sourceId !== excludeActionId && !processedExtensions.has(ext.sourceId) &&
                    ext.time >= startTime && ext.time < currentTimeLimit) {
                    currentTimeLimit += ext.amount;
                    processedExtensions.add(ext.sourceId);
                    changed = true;
                }
            });
        }
        return currentTimeLimit;
    }

    const ultimateEnhancementMetricsMap = computed(() => {
        const map = new Map()

        const getMetrics = (trackId, action) => {
            if (!action || action.type !== 'ultimate') return null
            const baseDuration = Number(action.enhancementTime) || 0
            if (baseDuration <= 0) return null

            const start = Number(action.startTime) || 0
            const enhStart = getShiftedEndTime(start, Number(action.duration) || 0, action.instanceId)

            let extraDuration = 0

            const extender = ULTIMATE_ENHANCEMENT_EXTENDERS[trackId]
            if (typeof extender === 'function') {
                const track = tracks.value.find(t => t.id === trackId)
                if (track) {
                    extraDuration = extender({
                        track,
                        enhStart,
                        baseDuration,
                        ultimateAction: action,
                        getShiftedEndTime,
                    })
                }
            }

            const finalEnd = getShiftedEndTime(enhStart, baseDuration + extraDuration, action.instanceId)
            const shiftedEnhDuration = finalEnd - enhStart
            const extensionAmount = snapMs(shiftedEnhDuration - baseDuration)

            return {
                enhStart,
                baseDuration,
                finalEnd,
                extensionAmount: Math.max(0, extensionAmount),
            }
        }

        for (const track of tracks.value) {
            if (!track?.id || !Array.isArray(track.actions)) continue
            for (const action of track.actions) {
                const metrics = getMetrics(track.id, action)
                if (!metrics) continue
                map.set(action.instanceId, metrics)
            }
        }

        return map
    })

    function getUltimateEnhancementMetrics(actionInstanceId) {
        return ultimateEnhancementMetricsMap.value.get(actionInstanceId) || null
    }

    function toGameTime(realTimeS) {
        if (useNewCompiler.value) {
            return timeContext.value.toGameTime(realTimeS);
        }

        const extensions = globalExtensions.value;

        for (const ext of extensions) {
            const freezeRealStart = ext.gameTime + ext.cumulativeFreezeTime;

            const freezeRealEnd = freezeRealStart + ext.amount;

            if (realTimeS >= freezeRealStart && realTimeS < freezeRealEnd) {
                return ext.gameTime;
            }

            if (realTimeS < freezeRealStart) {
                return realTimeS - ext.cumulativeFreezeTime;
            }
        }

        const last = extensions[extensions.length - 1];
        if (last) {
            const totalOffset = last.cumulativeFreezeTime + last.amount;
            return realTimeS - totalOffset;
        }

        return realTimeS;
    }

    function toRealTime(gameTimeS) {
        if (useNewCompiler.value) {
            return timeContext.value.toRealTime(gameTimeS);
        }

        const extensions = globalExtensions.value;
        const breakPoint = extensions.toReversed().find(e => e.gameTime <= gameTimeS);

        if (!breakPoint) return gameTimeS;

        if (gameTimeS === breakPoint.gameTime) {
            return gameTimeS + breakPoint.cumulativeFreezeTime;
        }

        return gameTimeS + breakPoint.cumulativeFreezeTime + breakPoint.amount;
    }

    function pushSubsequentActions(triggerTime, amount, excludeIds = []) {
        const excludeSet = new Set(Array.isArray(excludeIds) ? excludeIds : [excludeIds]);
        tracks.value.forEach(track => {
            track.actions.forEach(action => {
                if (!excludeSet.has(action.instanceId) && action.startTime >= triggerTime) {
                    action.startTime += amount;
                    if (action.logicalStartTime !== undefined) {
                        action.logicalStartTime += amount;
                    } else {
                        action.logicalStartTime = action.startTime;
                    }
                }
            });
            track.actions.sort((a, b) => a.startTime - b.startTime);
        });
    }

    function pullSubsequentActions(triggerTime, amount, excludeIds = []) {
        if (amount <= 0) return;
        const excludeSet = new Set(Array.isArray(excludeIds) ? excludeIds : [excludeIds]);
        tracks.value.forEach(track => {
            track.actions.forEach(action => {
                if (!excludeSet.has(action.instanceId) && action.startTime >= triggerTime) {
                    action.startTime = Math.max(0, action.startTime - amount);
                    if (action.logicalStartTime !== undefined) {
                        action.logicalStartTime = Math.max(0, action.logicalStartTime - amount);
                    } else {
                        action.logicalStartTime = action.startTime;
                    }
                }
            });
            track.actions.sort((a, b) => a.startTime - b.startTime);
        });
    }

    function calculateGlobalStaggerData() {
        const {
            maxStagger,
            staggerNodeCount,
            staggerNodeDuration,
            staggerBreakDuration
        } = systemConstants.value;

        const ORIGINIUM_ARTS_FACTOR = 0.005;

        const events = [];
        tracks.value.forEach(track => {
            if (!track.actions) return;
            const originiumArtsPower = Number(track.originiumArtsPower) || 0;
            const knockBonusMultiplier = 1 + originiumArtsPower * ORIGINIUM_ARTS_FACTOR;
            track.actions.forEach(action => {
                if (action.isDisabled || (action.triggerWindow || 0) < 0) return;

                // 收集所有失衡值变动事件，并进行时间对齐
                const effectTypeMap = new Map();
                if (action.physicalAnomaly && action.physicalAnomaly.length > 0) {
                    const rows = Array.isArray(action.physicalAnomaly[0])
                        ? action.physicalAnomaly
                        : [action.physicalAnomaly];
                    rows.forEach(row => {
                        row.forEach(effect => {
                            const id = ensureEffectId(effect);
                            effectTypeMap.set(id, effect.type);
                        })
                    })
                }

                if (action.damageTicks) {
                    action.damageTicks.forEach(tick => {
                        const staggerVal = Number(tick.stagger) || 0;
                        if (staggerVal > 0) {
                            const boundEffects = Array.isArray(tick.boundEffects) ? tick.boundEffects : [];
                            const hasKnockBinding = boundEffects.some(id => {
                                const type = effectTypeMap.get(id);
                                return type === 'knockup' || type === 'knockdown';
                            });
                            const bonusMultiplier = hasKnockBinding ? knockBonusMultiplier : 1;
                            const adjustedStagger = snapMs(staggerVal * bonusMultiplier);

                            const actualTickTime = getShiftedEndTime(action.startTime, Number(tick.offset) || 0, action.instanceId);
                            events.push({ time: snapMs(actualTickTime), change: adjustedStagger });
                        }
                    });
                }
            });
        });

        // 按物理时间排序
        events.sort((a, b) => a.time - b.time);

        const points = [{ time: 0, val: 0 }];
        const lockSegments = [];
        const nodeSegments = [];
        let currentVal = 0;
        let currentTime = 0;
        let lockedUntil = -1;
        const nodeStep = maxStagger / (staggerNodeCount + 1);
        const hasNodes = staggerNodeCount > 0;

        const advanceTime = (targetTime) => {
            const t = snapMs(targetTime);
            if (t > currentTime) {
                points.push({ time: t, val: currentVal });
                currentTime = t;
            }
        };

        events.forEach(ev => {
            advanceTime(ev.time);

            if (currentTime >= lockedUntil - 0.0001) {
                const prevVal = currentVal;
                currentVal += ev.change;

                // 触发失衡
                if (currentVal >= maxStagger - 0.0001) {
                    currentVal = 0;
                    // 击破时长受全局时间延长逻辑（时停）影响
                    const breakEnd = getShiftedEndTime(currentTime, staggerBreakDuration);
                    lockedUntil = snapMs(breakEnd);

                    lockSegments.push({ start: currentTime, end: lockedUntil });
                    points.push({ time: currentTime, val: 0 });
                }
                // 触发节点
                else if (hasNodes) {
                    const prevNodeIdx = Math.floor(prevVal / nodeStep + 0.0001);
                    const currNodeIdx = Math.floor(currentVal / nodeStep + 0.0001);

                    if (currNodeIdx > prevNodeIdx) {
                        // 节点锁定时间同样受延长逻辑影响
                        const nodeEnd = getShiftedEndTime(currentTime, staggerNodeDuration);
                        const finalNodeEnd = snapMs(nodeEnd);

                        nodeSegments.push({
                            start: currentTime,
                            end: finalNodeEnd,
                            thresholdVal: currNodeIdx * nodeStep
                        });
                    }
                }
            }
            points.push({ time: currentTime, val: currentVal });
        });

        if (currentTime < viewDuration.value) advanceTime(viewDuration.value);

        return { points, lockSegments, nodeSegments, nodeStep };
    }

    function calculateGlobalSpData() {
        const { maxSp, spRegenRate, initialSp, executionRecovery } = systemConstants.value;
        const prep = Math.max(MIN_PREP_DURATION, Number(prepDuration.value) || 0)
        const endTime = viewDuration.value

        const instantEvents = [];
        const pauseWindows = [];

        tracks.value.forEach(track => {
            track.actions.forEach(action => {
                if (action.isDisabled || (action.triggerWindow || 0) < 0) return;

                if (action.type === 'skill') {
                    pauseWindows.push({
                        start: snapMs(action.startTime),
                        end: snapMs(action.startTime + 0.5)
                    });
                }

                if (action.spCost > 0) {
                    instantEvents.push({
                        time: snapMs(action.startTime),
                        change: -Number(action.spCost)
                    });
                }

                if (action.spGain > 0) {
                    const actualEndTime = getShiftedEndTime(action.startTime, action.duration, action.instanceId);
                    instantEvents.push({ time: snapMs(actualEndTime), change: Number(action.spGain) });
                }

                if (action.type === 'execution') {
                    const actualEndTime = getShiftedEndTime(action.startTime, action.duration, action.instanceId);
                    instantEvents.push({
                        time: snapMs(actualEndTime),
                        change: Number(executionRecovery) || 0
                    });
                }

                if (action.damageTicks) {
                    action.damageTicks.forEach(tick => {
                        if (tick.sp > 0) {
                            const actualTickTime = getShiftedEndTime(action.startTime, tick.offset, action.instanceId);
                            instantEvents.push({ time: snapMs(actualTickTime), change: Number(tick.sp) });
                        }
                    });
                }
            });
        });

        // 战前准备：冻结全部 SP 变化
        if (prep > 0) {
            pauseWindows.push({ start: 0, end: snapMs(prep) })
        }

        globalExtensions.value.forEach(ext => {
            pauseWindows.push({
                start: snapMs(ext.time),
                end: snapMs(ext.time + ext.amount)
            });
        });

        const criticalTimes = new Set();
        criticalTimes.add(0);
        criticalTimes.add(snapMs(endTime));
        if (prep > 0) criticalTimes.add(snapMs(prep))

        instantEvents
            .filter(e => e.time >= prep - 0.0001)
            .forEach(e => criticalTimes.add(e.time));
        pauseWindows.forEach(w => {
            criticalTimes.add(w.start);
            criticalTimes.add(w.end);
        });

        const sortedTimes = Array.from(criticalTimes).sort((a, b) => a - b);

        const isPausedInterval = (t1, t2) => {
            const mid = (t1 + t2) / 2;
            return pauseWindows.some(w => mid >= w.start && mid < w.end);
        };

        const points = [];
        const parsedInit = Number(initialSp);
        let currentSp = isNaN(parsedInit) ? 200 : parsedInit;
        let prevTime = 0;

        for (let i = 0; i < sortedTimes.length; i++) {
            const now = sortedTimes[i];
            const dt = now - prevTime;

            if (dt > 0) {
                if (!isPausedInterval(prevTime, now)) {
                    if (currentSp < maxSp) {
                        const needed = maxSp - currentSp;
                        const potentialGain = dt * spRegenRate;

                        if (potentialGain > needed) {
                            const timeToCap = needed / spRegenRate;
                            points.push({ time: snapMs(prevTime + timeToCap), sp: maxSp });
                            currentSp = maxSp;
                        } else {
                            currentSp += potentialGain;
                        }
                    }
                }
            }

            points.push({ time: now, sp: currentSp });

            if (now < prep - 0.0001) {
                prevTime = now
                continue
            }

            const eventsNow = instantEvents.filter(e => e.time === now && e.time >= prep - 0.0001);
            if (eventsNow.length > 0) {
                eventsNow.forEach(e => {
                    currentSp += e.change;
                });
                if (currentSp > maxSp) currentSp = maxSp;
                points.push({ time: now, sp: currentSp });
            }
            prevTime = now;
        }

        return points;
    }

    function resolveGaugeMax(trackId, track, charInfo) {
        const libId = `${trackId}_ultimate`;
        const override = characterOverrides.value[libId];
        let base = (track.maxGaugeOverride && track.maxGaugeOverride > 0)
            ? track.maxGaugeOverride
            : ((override && override.gaugeCost) ? override.gaugeCost : (charInfo.ultimate_gaugeMax || 100));
        base = Number(base);
        if (!Number.isFinite(base) || base <= 0) base = 100;

        // Apply ult_gauge_cost potential modifier (e.g., P4: -15% gauge cost)
        const resolved = resolveTrackActiveEffects(trackId)
        const allEffects = [
            ...(resolved.activeTalents?.flatMap(t => t.activeStage?.effects || []) || []),
            ...(resolved.activePotentials?.flatMap(p => p.effects || []) || []),
        ]
        for (const eff of allEffects) {
            if (eff.type === 'gauge_modifier' && eff.stat === 'ult_gauge_cost' && eff.value) {
                if (eff.unit === 'percent') {
                    base = Math.round(base * (1 + eff.value / 100))
                } else {
                    base += eff.value
                }
            }
        }

        return Math.max(1, base);
    }

    function getTrackGaugeMax(trackId) {
        const track = tracks.value.find(t => t.id === trackId);
        if (!track) return 0;
        const charInfo = characterRoster.value.find(c => c.id === trackId);
        if (!charInfo) return 0;
        return resolveGaugeMax(trackId, track, charInfo);
    }

    const gaugeSeriesByTrackId = computed(() => {
        const sim = simulation.value
        const map = new Map()
        for (const track of tracks.value) {
            if (!track?.id) continue
            if (sim?.simLog?.length) {
                // Phase 1: project gauge from simLog (authoritative kernel)
                const charInfo = characterRoster.value.find(c => c.id === track.id)
                const maxGauge = charInfo ? resolveGaugeMax(track.id, track, charInfo) : 100
                const initialGauge = Number(track.initialGauge) || 0
                map.set(track.id, projGaugeSeries(sim.simLog, track.id, initialGauge, maxGauge, viewDuration.value))
            } else {
                // Fallback when simulation not available
                map.set(track.id, calculateGaugeData(track.id))
            }
        }
        return map
    })

    function calculateGaugeData(trackId) {
        const track = tracks.value.find(t => t.id === trackId);
        if (!track) return [];

        // Use configured stats (includes equipment bonuses) for efficiency
        const configuredStats = resolveTrackConfiguredStats(trackId)
        const efficiency = ((configuredStats?.ult_charge_eff ?? track.gaugeEfficiency ?? 100)) / 100;
        const charInfo = characterRoster.value.find(c => c.id === trackId);
        if (!charInfo) return [];

        const canAcceptTeamGauge = (charInfo.accept_team_gauge !== false);
        const GAUGE_MAX = resolveGaugeMax(trackId, track, charInfo);

        // 识别大招封禁区间（大招动画及强化期间不涨能）
        const blockWindows = [];
        if (track.actions) {
            track.actions.forEach(action => {
                if (action.type === 'ultimate' && !action.isDisabled) {
                    const start = snapMs(action.startTime);
                    const animT = Number(action.animationTime || 0);
                    const enhT = Number(action.enhancementTime || 0);

                    let end = null
                    if (typeof ULTIMATE_ENHANCEMENT_EXTENDERS[trackId] === 'function' && enhT > 0) {
                        const metrics = getUltimateEnhancementMetrics(action.instanceId)
                        if (metrics?.finalEnd) end = snapMs(metrics.finalEnd)
                    }

                    if (!end) {
                        end = snapMs(getShiftedEndTime(
                            action.startTime,
                            animT + enhT,
                            action.instanceId
                        ));
                    }

                    blockWindows.push({ start, end, sourceId: action.instanceId });
                }
            });
        }

        const isBlocked = (time, excludeId = null) => {
            const t = snapMs(time);
            const epsilon = 0.0001;
            return blockWindows.some(w =>
                w.sourceId !== excludeId &&
                t > w.start + epsilon &&
                t < w.end - epsilon
            );
        };

        const events = [];
        tracks.value.forEach(sourceTrack => {
            if (!sourceTrack.actions) return;
            sourceTrack.actions.forEach(action => {
                if (action.isDisabled || (action.triggerWindow || 0) < 0) return;

                // 自身动作能量变动
                const eff = computedEffectiveActions.value.get(action.instanceId)
                const effDuration     = eff?.duration      ?? action.duration
                const effGaugeGain    = eff?.gaugeGain     ?? action.gaugeGain
                const effTeamGaugeGain = eff?.teamGaugeGain ?? action.teamGaugeGain

                if (sourceTrack.id === trackId) {
                    // 消耗：在开始时刻发生
                    if (action.gaugeCost > 0) {
                        events.push({ time: snapMs(action.startTime), change: -Number(action.gaugeCost) });
                    }
                    // 自身回能：在最后一个 hit 时刻（有 damageTicks 时）或结束时刻触发
                    if (effGaugeGain > 0) {
                        const ticks = eff?.damageTicks || action.damageTicks
                        const lastTickOffset = Array.isArray(ticks) && ticks.length > 0
                            ? Math.max(...ticks.map(t => Number(t.offset) || 0))
                            : null
                        const triggerTime = lastTickOffset != null
                            ? snapMs(action.startTime + lastTickOffset)
                            : getShiftedEndTime(action.startTime, effDuration, action.instanceId);
                        if (!isBlocked(triggerTime, action.instanceId)) {
                            events.push({ time: snapMs(triggerTime), change: effGaugeGain * efficiency });
                        }
                    }
                }
                // 队友动作产生的全队回能
                else if (effTeamGaugeGain > 0 && canAcceptTeamGauge) {
                    const triggerTime = getShiftedEndTime(action.startTime, effDuration, action.instanceId);
                    if (!isBlocked(triggerTime, action.instanceId)) {
                        events.push({ time: snapMs(triggerTime), change: effTeamGaugeGain * efficiency });
                    }
                }
            });
        });

        // 排序所有变动事件
        events.sort((a, b) => a.time - b.time);

        const initialGauge = Number(track.initialGauge) || 0;
        let currentGauge = initialGauge > GAUGE_MAX ? GAUGE_MAX : initialGauge;
        const points = [{ time: 0, val: currentGauge, ratio: currentGauge / GAUGE_MAX }];

        // 模拟计算能量曲线
        events.forEach(ev => {
            points.push({ time: ev.time, val: currentGauge, ratio: currentGauge / GAUGE_MAX });
            currentGauge += ev.change;
            if (currentGauge > GAUGE_MAX) currentGauge = GAUGE_MAX;
            if (currentGauge < 0) currentGauge = 0;
            points.push({ time: ev.time, val: currentGauge, ratio: currentGauge / GAUGE_MAX });
        });

        points.push({ time: viewDuration.value, val: currentGauge, ratio: currentGauge / GAUGE_MAX });
        return points;
    }

    function getActiveOperatorSegments(trackId) {
        if (!trackId) return []
        const sorted = [...switchEvents.value].sort((a, b) => a.time - b.time)
        if (sorted.length === 0) return []

        const segments = []
        let isActive = false
        let segStart = 0

        for (const event of sorted) {
            if (event.characterId === trackId) {
                if (!isActive) {
                    segStart = event.time
                    isActive = true
                }
            } else {
                if (isActive) {
                    segments.push({ start: segStart, end: event.time })
                    isActive = false
                }
            }
        }

        if (isActive) {
            segments.push({ start: segStart, end: viewDuration.value })
        }

        return segments
    }

    const activeOperatorSegmentsByTrack = computed(() => {
        const map = new Map()
        for (const track of tracks.value) {
            if (!track?.id) continue
            map.set(track.id, getActiveOperatorSegments(track.id))
        }
        return map
    })

    // Default durations for direct anomaly types when gamedata duration is 0.
    // Values from anomaly/types.ts constants — not a new truth source.
    const DIRECT_ANOMALY_DEFAULT_DURATIONS = {
        burning: 10,     // BURN_DURATION
        frozen: 6,       // FREEZE_DURATION_BY_LEVEL[1]
        conductive: 12,  // CONDUCTION_DURATION_BY_LEVEL[1]
        corrosion: 15,   // CORROSION_DURATION
    }

    function _resolveAnomalyDebuffBarDuration(effectType, rawDur, effectStart, viewDur) {
        const d = Number(rawDur) || 0
        if (d > 0) return d
        if (!isDebuffAnomalyType(effectType)) return 0
        if (ATTACH_LIKE_DEBUFF_TYPES.has(effectType)) return ATTACH_DURATION
        // Direct anomaly types: use system default durations instead of tiny 0.35s fallback
        if (DIRECT_ANOMALY_DEFAULT_DURATIONS[effectType]) return DIRECT_ANOMALY_DEFAULT_DURATIONS[effectType]
        return 0.35
    }

    /**
     * 按时间轴切片计算层数：只在区间 [t0,t1) 内对与之重叠的附着实例加算，上限 4。
     * 未来时刻的附着不会影响过去时间段的层数显示。
     * 相邻切片若层数相同则合并为一条；层数变化时新段起点会再显示图标（与 TimelineGrid 条带一致）。
     */
    function _timeSliceAnomalyDebuffs(rawSegments, iconForType) {
        const byType = new Map()
        for (const seg of rawSegments) {
            const t = seg.anomalyType
            if (!byType.has(t)) byType.set(t, [])
            byType.get(t).push(seg)
        }
        const out = []
        let globalIdx = 0
        const eps = 1e-6

        for (const [atype, segs] of byType) {
            const crit = new Set()
            segs.forEach((s) => {
                crit.add(snapMs(s.startTime))
                crit.add(snapMs(s.endTime))
            })
            const times = [...crit].sort((a, b) => a - b)

            const fine = []
            for (let k = 0; k < times.length - 1; k++) {
                const t0 = times[k]
                const t1 = times[k + 1]
                if (t1 - t0 < eps) continue

                const active = segs.filter(
                    (s) => Math.max(s.startTime, t0) < Math.min(s.endTime, t1) - eps
                )
                if (active.length === 0) continue
                const stacks = Math.min(
                    DEBUFF_STACK_CAP,
                    active.reduce((a, s) => a + s.stacks, 0)
                )
                fine.push({ t0, t1, stacks, active })
            }

            const activeKey = (slice) =>
                slice.active
                    .map((s) => s.id)
                    .sort()
                    .join(',')

            let i = 0
            while (i < fine.length) {
                const tStart = fine[i].t0
                let tEnd = fine[i].t1
                const stacks = fine[i].stacks
                const activeFirst = fine[i].active
                const key0 = activeKey(fine[i])
                let j = i + 1
                while (
                    j < fine.length &&
                    fine[j].stacks === stacks &&
                    Math.abs(fine[j].t0 - tEnd) < eps &&
                    activeKey(fine[j]) === key0
                ) {
                    tEnd = fine[j].t1
                    j++
                }

                const dur = snapMs(tEnd - tStart)
                if (dur <= 0) {
                    i = j
                    continue
                }

                const icon = iconForType(atype, activeFirst[0])
                out.push({
                    id: `anomdebuff_seg_${atype}_${snapMs(tStart)}_${globalIdx++}`,
                    name: atype,
                    icon,
                    color: getColor(atype),
                    startTime: tStart,
                    logicalStartTime: tStart,
                    duration: dur,
                    type: 'debuff',
                    sourceTrackId: activeFirst[0].sourceTrackId || null,
                    sourceActionInstanceId: activeFirst[0].sourceActionInstanceId || null,
                    anomalyType: atype,
                    stacks,
                    maxStacks: DEBUFF_STACK_CAP,
                    isAnomalyDebuff: true,
                    isMergedAnomalyDebuff: j - i > 1,
                })
                i = j
            }
        }
        return out
    }

    // 法术附着 → 法术异常 映射（由 incoming 决定异常类型）
    const ATTACH_REACTION_MAP = {
        'blaze_attach': 'burning',
        'cold_attach':  'frozen',
        'emag_attach':  'conductive',
        'nature_attach':'corrosion',
    }
    const ATTACH_DURATION        = 30   // 法术附着持续时长（秒）
    const PHYSICAL_VUL_DURATION  = 30   // 破防持续时长（秒）
    /** 各法术异常反应的持续时长（秒）；导电由等级动态计算 */
    const ANOMALY_REACTION_DURATIONS = {
        burning:    10,
        frozen:     30,
        corrosion:  15,
    }

    /**
     * 法术附着碰撞精确反应表（incoming × existing → reaction type）
     * 同元素 → 爆发；异元素 → 以 existing 元素的异常类型命名
     */
    const ELEMENTAL_REACTION_MAP = {
        blaze_attach:  { blaze_attach: 'blaze_burst',   cold_attach: 'frozen',      emag_attach: 'conductive',  nature_attach: 'corrosion'  },
        cold_attach:   { blaze_attach: 'burning',        cold_attach: 'cold_burst',  emag_attach: 'conductive',  nature_attach: 'corrosion'  },
        emag_attach:   { blaze_attach: 'burning',        cold_attach: 'frozen',      emag_attach: 'emag_burst',  nature_attach: 'corrosion'  },
        nature_attach: { blaze_attach: 'burning',        cold_attach: 'frozen',      emag_attach: 'conductive',  nature_attach: 'nature_burst'},
    }
    const SPELL_BURST_TYPES = new Set(['blaze_burst', 'cold_burst', 'emag_burst', 'nature_burst'])

    /**
     * 对燃烧/导电/冻结/腐蚀片段应用交互规则（统一处理直接效果与附着反应生成的片段）。
     *   - 燃烧/导电/冻结：新实例直接覆盖旧实例（裁剪旧片段到新片段起始时刻）
     *   - 腐蚀：计时器直接重置为新持续时长（无论旧剩余时长），从当前已积累的减抗值继续，按等级高低决定速率/上限：
     *     - 高等级覆盖低等级：应用新等级速率/上限，从当前减抗值开始累积
     *     - 低等级覆盖高等级，当前减抗 >= 新上限：冻结在当前值（不增不减），仅刷新计时
     *     - 低等级覆盖高等级，当前减抗 < 新上限：应用新等级速率，从当前减抗继续累积至新上限
     *
     * 腐蚀片段额外字段：
     *   resStart            — 该片段起始时刻的减抗值（默认 = immediate 值）
     *   corrosionPerSecond  — 每秒减抗速率（默认由 stacks 推算）
     *   corrosionMaxValue   — 减抗上限（默认由 stacks 推算）
     */
    function _applyReactionInteractions(segs) {
        const OVERWRITE_TYPES = new Set(['burning', 'conductive', 'frozen'])
        const interactive = segs.filter(s => OVERWRITE_TYPES.has(s.anomalyType) || s.anomalyType === 'corrosion')
        if (interactive.length === 0) return segs

        const rest   = segs.filter(s => !OVERWRITE_TYPES.has(s.anomalyType) && s.anomalyType !== 'corrosion')
        const result = []

        interactive.sort((a, b) => a.startTime - b.startTime)

        /** 计算腐蚀片段在时刻 t 的当前减抗值（artsPower 暂不计入，mult = 1） */
        function _corrosionResAt(seg, t) {
            const level     = seg.stacks || 1
            const resStart  = seg.resStart          ?? (level * 1.2 + 2.4)
            const perSecond = seg.corrosionPerSecond ?? (level * 0.28 + 0.56)
            const maxValue  = seg.corrosionMaxValue  ?? (level * 4 + 8)
            const elapsed   = Math.max(0, t - seg.startTime)
            return Math.min(maxValue, resStart + perSecond * elapsed)
        }

        for (const seg of interactive) {
            const t    = seg.startTime
            const type = seg.anomalyType

            if (OVERWRITE_TYPES.has(type)) {
                // 覆盖：裁剪所有活跃的同类旧片段，然后加入新片段
                for (const s of result) {
                    if (s.anomalyType === type && s.endTime > t) s.endTime = t
                }
                result.push({ ...seg })
            } else {
                // 腐蚀：多等级叠加规则
                const newDur       = seg.endTime - seg.startTime
                const newLevel     = seg.stacks || 1
                const newPerSecond = seg.corrosionPerSecond ?? (newLevel * 0.28 + 0.56)
                const newMaxValue  = seg.corrosionMaxValue  ?? (newLevel * 4 + 8)
                const active = result.find(s => s.anomalyType === 'corrosion' && s.startTime <= t && s.endTime > t)

                if (active) {
                    const curRes    = _corrosionResAt(active, t)
                    const oldLevel  = active.stacks || 1
                    const mergedDur = newDur

                    // 终止旧片段
                    for (const s of result) {
                        if (s.anomalyType === 'corrosion' && s.endTime > t) s.endTime = t
                    }

                    if (newLevel > oldLevel) {
                        // 高等级覆盖低等级：从当前减抗开始，应用新等级速率/上限
                        result.push({
                            ...seg,
                            startTime:          t,
                            endTime:            snapMs(t + mergedDur),
                            resStart:           curRes,
                            corrosionPerSecond: newPerSecond,
                            corrosionMaxValue:  newMaxValue,
                        })
                    } else if (curRes >= newMaxValue) {
                        // 低等级（或同等级）且当前减抗 >= 新上限：冻结在当前值，仅刷新计时
                        result.push({
                            ...seg,
                            startTime:          t,
                            endTime:            snapMs(t + mergedDur),
                            stacks:             oldLevel,
                            resStart:           curRes,
                            corrosionPerSecond: 0,
                            corrosionMaxValue:  curRes,
                        })
                    } else {
                        // 低等级（或同等级）且当前减抗 < 新上限：从当前减抗继续累积至新上限
                        result.push({
                            ...seg,
                            startTime:          t,
                            endTime:            snapMs(t + mergedDur),
                            resStart:           curRes,
                            corrosionPerSecond: newPerSecond,
                            corrosionMaxValue:  newMaxValue,
                        })
                    }
                } else {
                    // 无活跃腐蚀：初始化新片段
                    result.push({
                        ...seg,
                        resStart:           newLevel * 1.2 + 2.4,
                        corrosionPerSecond: newPerSecond,
                        corrosionMaxValue:  newMaxValue,
                    })
                }
            }
        }

        return [...rest, ...result.filter(s => s.endTime > s.startTime)]
    }

    /**
     * 处理法术附着碰撞：当两种不同附着同时存在时，触发法术异常并清空原有附着。
     * 异常等级 = 被清空附着的当前层数；异常类型由 incoming 附着决定。
     * 返回前统一经 _applyReactionInteractions 处理覆盖/刷新规则。
     */
    function _applyAttachReactions(raw, iconForType) {
        const attachSegs = raw.filter(s => ATTACH_LIKE_DEBUFF_TYPES.has(s.anomalyType))
        const otherSegs  = raw.filter(s => !ATTACH_LIKE_DEBUFF_TYPES.has(s.anomalyType))
        if (attachSegs.length === 0) return _applyReactionInteractions(raw)

        // 按触发时间排序，同时刻按类型名稳定排序
        attachSegs.sort((a, b) => a.startTime - b.startTime || a.anomalyType.localeCompare(b.anomalyType))

        const resultAttachSegs = []
        const reactionSegs = []
        let idx = 0

        for (const seg of attachSegs) {
            const t            = seg.startTime
            const incomingType = seg.anomalyType

            // 在已接受的片段中，找当前时刻活跃的不同附着类型
            const activeDifferent = [...ATTACH_LIKE_DEBUFF_TYPES].find(t2 => {
                if (t2 === incomingType) return false
                return resultAttachSegs.some(s => s.anomalyType === t2 && s.startTime <= t && s.endTime > t)
            })

            if (activeDifferent) {
                const reactionType = ATTACH_REACTION_MAP[incomingType]

                // 计算已有附着的层数
                const existingStacks = Math.min(
                    DEBUFF_STACK_CAP,
                    resultAttachSegs
                        .filter(s => s.anomalyType === activeDifferent && s.startTime <= t && s.endTime > t)
                        .reduce((sum, s) => sum + s.stacks, 0)
                ) || 1

                // 裁剪已有附着到反应时刻
                for (const s of resultAttachSegs) {
                    if (s.anomalyType === activeDifferent && s.endTime > t) s.endTime = t
                }

                // 生成反应片段（实际持续时长；导电依据等级动态计算）
                const reactionDur = reactionType === 'conductive'
                    ? existingStacks * 6 + 6
                    : (ANOMALY_REACTION_DURATIONS[reactionType] ?? 5)
                reactionSegs.push({
                    id: `reaction_${reactionType}_${snapMs(t)}_${idx++}`,
                    anomalyType: reactionType,
                    startTime:   t,
                    endTime:     snapMs(t + reactionDur),
                    stacks:      existingStacks,
                    icon:        iconForType(reactionType, null),
                })
                // incoming 被消耗，不加入
            } else {
                // 同元素附着：若已有活跃层数则刷新计时器并叠加层数
                const activeSame = resultAttachSegs.filter(
                    s => s.anomalyType === incomingType && s.startTime <= t && s.endTime > t
                )
                if (activeSame.length > 0) {
                    const existingStacks = Math.min(
                        DEBUFF_STACK_CAP,
                        activeSame.reduce((sum, s) => sum + s.stacks, 0)
                    )
                    for (const s of resultAttachSegs) {
                        if (s.anomalyType === incomingType && s.endTime > t) s.endTime = t
                    }
                    resultAttachSegs.push({
                        ...seg,
                        stacks: Math.min(DEBUFF_STACK_CAP, existingStacks + seg.stacks),
                    })
                } else {
                    resultAttachSegs.push({ ...seg })
                }
            }
        }

        const filteredAttach = resultAttachSegs.filter(s => s.endTime > s.startTime)
        return _applyReactionInteractions([...otherSegs, ...filteredAttach, ...reactionSegs])
    }

    /** 物理异常触发类型 */
    const PHYSICAL_TRIGGER_TYPES = new Set(['armor_break', 'knockdown', 'knockup', 'stagger'])
    /** 消耗破防的类型（猛击/碎甲） */
    const PHYSICAL_CONSUME_TYPES = new Set(['stagger', 'armor_break'])
    /** 叠加破防层数的类型（击飞/倒地） */
    const PHYSICAL_ADDSTACK_TYPES = new Set(['knockup', 'knockdown'])
    const PHYSICAL_VULNERABLE_CAP = 4
    const PHYSICAL_CONSUME_DURATION = 0 // 消耗后占位时长（秒）— 消耗即清除，不显示残余

    /**
     * 从所有轨道动作中的物理异常事件，计算 physical_vulnerable 层数时间线。
     * 规则：
     *   - 任意物理异常 → 若无破防则生成 1 级破防（持续 30s）
     *   - 击飞/倒地（knockup/knockdown）→ 若已有破防则 +1 级，刷新 30s 计时
     *   - 猛击/碎甲（stagger/armor_break）→ 若已有破防则消耗全部，生成 5s 占位段
     *   - 破防到期（距上次触发超过 30s）则自动清除
     */
    function _computePhysicalVulnerable(rawSegments, viewDur, vulIcon) {
        const triggers = rawSegments
            .filter(s => PHYSICAL_TRIGGER_TYPES.has(s.anomalyType))
            .sort((a, b) => a.startTime - b.startTime || a.anomalyType.localeCompare(b.anomalyType))

        if (triggers.length === 0) return []

        const result = []
        let segIdx = 0
        let currentLevel = 0
        let currentStart = 0
        let expiresAt    = 0

        const makeSeg = (startTime, endTime, stacks, isConsume = false) => ({
            id: `phyvul_${isConsume ? 'consume' : 'seg'}_${segIdx++}`,
            name: 'physical_vulnerable',
            anomalyType: 'physical_vulnerable',
            startTime,
            duration: snapMs(endTime - startTime),
            stacks,
            maxStacks: PHYSICAL_VULNERABLE_CAP,
            color: getColor('physical_vulnerable'),
            icon: vulIcon,
            type: 'debuff',
            isAnomalyDebuff: true,
            isConsume,
            hideDuration: true,
        })

        for (const trig of triggers) {
            const t = trig.startTime
            const type = trig.anomalyType

            // 检查破防是否已到期
            if (currentLevel > 0 && t >= expiresAt) {
                result.push(makeSeg(currentStart, expiresAt, currentLevel))
                currentLevel = 0
                currentStart = 0
                expiresAt    = 0
            }

            if (currentLevel === 0) {
                // 无破防：任何物理异常生成 1 级破防
                currentLevel = 1
                currentStart = t
                expiresAt    = snapMs(t + PHYSICAL_VUL_DURATION)
            } else if (PHYSICAL_CONSUME_TYPES.has(type)) {
                // 消耗：关闭当前积累段，生成 5s 占位段
                result.push(makeSeg(currentStart, t, currentLevel))
                const consumeLevel = currentLevel
                result.push(makeSeg(t, snapMs(t + PHYSICAL_CONSUME_DURATION), consumeLevel, true))
                currentLevel = 0
                currentStart = 0
                expiresAt    = 0
            } else if (PHYSICAL_ADDSTACK_TYPES.has(type)) {
                // 叠层：关闭当前段，开新段（+1 级），刷新 30s 计时
                result.push(makeSeg(currentStart, t, currentLevel))
                currentLevel = Math.min(PHYSICAL_VULNERABLE_CAP, currentLevel + 1)
                currentStart = t
                expiresAt    = snapMs(t + PHYSICAL_VUL_DURATION)
            }
        }

        // 关闭最后一段（以到期时间为上限）
        if (currentLevel > 0) {
            result.push(makeSeg(currentStart, Math.min(expiresAt, viewDur), currentLevel))
        }

        return result
    }

    const computedPhysicalVulnerable = computed(() => {
        const viewDur = viewDuration.value
        const vulIcon = iconDatabase.value['break'] || iconDatabase.value['physical_vulnerable'] || ''
        const raw = []

        for (const track of tracks.value) {
            if (!track?.id || !track.actions) continue
            for (const action of track.actions) {
                if (action.isDisabled) continue
                const anomalies = action.physicalAnomaly
                if (!Array.isArray(anomalies) || anomalies.length === 0) continue
                const rows = Array.isArray(anomalies[0]) ? anomalies : [anomalies]
                const actionStart = Number(action.startTime) || 0

                for (const row of rows) {
                    if (!Array.isArray(row)) continue
                    for (const effect of row) {
                        if (!effect?.type || !PHYSICAL_TRIGGER_TYPES.has(effect.type)) continue
                        const offset = Number(effect.offset) || 0
                        const effectStart = snapMs(actionStart + offset)
                        raw.push({
                            id: `phytrig_${action.instanceId}_${effect._id || `${effect.type}_${offset}`}`,
                            anomalyType: effect.type,
                            startTime: effectStart,
                        })
                    }
                }
            }
        }

        return _computePhysicalVulnerable(raw, viewDur, vulIcon)
    })

    const computedAnomalyDebuffs = computed(() => {
        const viewDur = viewDuration.value
        const raw = []

        const resolveIcon = (effect, charInfo) => {
            let effectIcon = iconDatabase.value[effect.type] || ''
            if (charInfo?.exclusive_buffs) {
                const excl = charInfo.exclusive_buffs.find(b => b.key === effect.type)
                if (excl?.path) effectIcon = excl.path
            }
            return effectIcon
        }

        for (const track of tracks.value) {
            if (!track?.id || !track.actions) continue
            const charInfo = characterRoster.value.find(c => c.id === track.id)
            for (const action of track.actions) {
                if (action.isDisabled) continue
                let anomalies = action.physicalAnomaly
                if (!Array.isArray(anomalies) || anomalies.length === 0) continue
                const rows = Array.isArray(anomalies[0]) ? anomalies : [anomalies]
                const actionStart = Number(action.startTime) || 0

                for (const row of rows) {
                    if (!Array.isArray(row)) continue
                    for (const effect of row) {
                        if (!effect?.type || !isDebuffAnomalyType(effect.type)) continue
                        const offset = Number(effect.offset) || 0
                        const effectStart = snapMs(actionStart + offset)
                        const barDur = _resolveAnomalyDebuffBarDuration(effect.type, effect.duration, effectStart, viewDur)
                        if (barDur <= 0) continue

                        const endTime = snapMs(effectStart + barDur)
                        const stackVal = Math.min(DEBUFF_STACK_CAP, Math.max(1, Number(effect.stacks) || 1))

                        raw.push({
                            id: `anomdebuff_${action.instanceId}_${effect._id || `${effect.type}_${offset}`}`,
                            anomalyType: effect.type,
                            startTime: effectStart,
                            endTime,
                            stacks: stackVal,
                            sourceTrackId: track.id,
                            sourceActionInstanceId: action.instanceId,
                            icon: resolveIcon(effect, charInfo),
                            hideDuration: ATTACH_LIKE_DEBUFF_TYPES.has(effect.type),
                        })
                    }
                }
            }
        }

        const iconForType = (atype, sampleSeg) =>
            (sampleSeg && sampleSeg.icon) || iconDatabase.value[atype] || ''

        // 在反应计算前，应用 blaze_to_magma 转化：终止已被熔火吸收的 blaze_attach 段
        const converts = computedSelfBuffSimulation.value.convertEvents
        let processedRaw = raw
        if (converts.length) {
            processedRaw = []
            for (const seg of raw) {
                if (seg.anomalyType !== 'blaze_attach') { processedRaw.push(seg); continue }
                const applicable = converts
                    .filter(ev => ev.time > seg.startTime && ev.time <= seg.endTime)
                    .sort((a, b) => a.time - b.time)
                if (!applicable.length) { processedRaw.push(seg); continue }
                let curStacks = seg.stacks
                let segStart = seg.startTime
                for (const ev of applicable) {
                    if (ev.time > segStart && curStacks > 0)
                        processedRaw.push({ ...seg, startTime: segStart, endTime: ev.time, stacks: curStacks })
                    curStacks = Math.max(0, curStacks - ev.amount)
                    segStart = ev.time
                    if (curStacks === 0) break
                }
                if (curStacks > 0 && segStart < seg.endTime)
                    processedRaw.push({ ...seg, startTime: segStart, endTime: seg.endTime, stacks: curStacks })
            }
        }
        return _timeSliceAnomalyDebuffs(_applyAttachReactions(processedRaw, iconForType), iconForType)
    })

    // ── 角色自身 Buff（专属 buff 类型，如熔火）──────────────────────────────
    const SELF_BUFF_MAX_STACKS = 4

    // ── 释放条件求值引擎 ──────────────────────────────────────────────────

    function _evalOp(actual, op, expected) {
        switch (op) {
            case '>=': return actual >= expected
            case '<=': return actual <= expected
            case '>':  return actual > expected
            case '<':  return actual < expected
            case '==': return actual === expected
            case '!=': return actual !== expected
            default:   return false
        }
    }

    /** 对单个条件组求值，全部满足返回 true */
    function _evalConditions(conditions, state) {
        return conditions.every(c => {
            if (c.type === 'selfBuff') {
                const stacks = state.selfBuff[c.key] ?? 0
                return _evalOp(stacks, c.op, c.value)
            }
            if (c.type === 'ultimateActive') {
                return state.ultimateActive === true
            }
            return false
        })
    }

    /**
     * 单次顺序模拟，同时产出：
     *   selfBuffsByTrack         — Map<trackId, bar[]>  用于自身增益栏渲染
     *   conditionResultsByAction — Map<instanceId, result>  用于技能效果替换
     *
     * 将二者合并计算以消除循环依赖：自身 buff 堆叠状态 → 条件判断 → 消耗 buff / 选用变体 physicalAnomaly
     */
    const computedSelfBuffSimulation = computed(() => {
        const viewDur = viewDuration.value
        const selfBuffsByTrack = new Map()
        const conditionResultsByAction = new Map()
        const convertEvents = [] // [{ time, amount }]

        // 辅助：直接从原始轨道动作构建 blaze_attach 时间线（不依赖 computedAnomalyDebuffs，避免循环依赖）
        function _getBlazeStacksAt(time) {
            const blazeSegs = []
            for (const trk of tracks.value) {
                if (!trk?.id || !trk.actions) continue
                for (const act of trk.actions) {
                    if (act.isDisabled) continue
                    const anoms = act.physicalAnomaly
                    if (!Array.isArray(anoms) || anoms.length === 0) continue
                    const arows = Array.isArray(anoms[0]) ? anoms : [anoms]
                    const aStart = Number(act.startTime) || 0
                    for (const arow of arows) {
                        if (!Array.isArray(arow)) continue
                        for (const eff of arow) {
                            if (eff?.type !== 'blaze_attach') continue
                            const off = Number(eff.offset) || 0
                            const t0 = snapMs(aStart + off)
                            const dur = Number(eff.duration) || ATTACH_DURATION
                            const st = Math.min(DEBUFF_STACK_CAP, Math.max(1, Number(eff.stacks) || 1))
                            blazeSegs.push({ startTime: t0, endTime: t0 + dur, stacks: st })
                        }
                    }
                }
            }
            blazeSegs.sort((a, b) => a.startTime - b.startTime)
            // 同元素叠加逻辑（同 _applyAttachReactions 中的同元素分支）
            const builtBlaze = []
            for (const seg of blazeSegs) {
                const t = seg.startTime
                const activeSame = builtBlaze.filter(s => s.startTime <= t && s.endTime > t)
                if (activeSame.length > 0) {
                    const existingStacks = Math.min(DEBUFF_STACK_CAP, activeSame.reduce((sum, s) => sum + s.stacks, 0))
                    for (const s of builtBlaze) { if (s.endTime > t) s.endTime = t }
                    builtBlaze.push({ startTime: t, endTime: seg.endTime, stacks: Math.min(DEBUFF_STACK_CAP, existingStacks + seg.stacks) })
                } else {
                    builtBlaze.push({ ...seg })
                }
            }
            for (const seg of builtBlaze) {
                if (seg.startTime <= time && seg.endTime > time) return seg.stacks
            }
            return 0
        }

        // 跨 track 统计已消耗的 blaze_attach（处理同次模拟内的多次转化）
        let _blazeConsumedTotal = 0

        for (const track of tracks.value) {
            if (!track?.id || !track.actions) continue
            const charInfo = characterRoster.value.find(c => c.id === track.id)
            if (!charInfo?.exclusive_buffs?.length) continue

            const exclusiveKeySet = new Set(charInfo.exclusive_buffs.map(b => b.key))

            // 按 startTime 升序处理
            const sortedActions = [...track.actions]
                .filter(a => !a.isDisabled)
                .sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0))

            // 预计算终结技强化窗口：[start, end)
            const ultimateWindows = []
            if (charInfo.ultimate_enhancementTime) {
                const enhOffset = Number(charInfo.ultimate_animationTime) || 0
                const enhDur = Number(charInfo.ultimate_enhancementTime) || 0
                for (const act of sortedActions) {
                    if (act.type === 'ultimate') {
                        const tStart = (Number(act.startTime) || 0) + enhOffset
                        ultimateWindows.push({ start: tStart, end: tStart + enhDur })
                    }
                }
            }

            // 事件列表（按 buffPrefix 归类），order=0 消耗优先于 order=1 新增
            const eventsByPrefix = new Map() // prefix -> [{ time, order, stacks?, isConsume? }]

            // 运行时堆叠状态，供条件判断使用
            const stackState = {} // { prefix: currentStacks }

            for (const action of sortedActions) {
                const actionStart = Number(action.startTime) || 0

                // 1. 条件判断（基于当前 stackState 快照）
                let condResult = null
                if (charInfo.releaseConditions) {
                    const condList = charInfo.releaseConditions[action.type]
                    if (condList?.length) {
                        const ultimateActive = ultimateWindows.some(w => actionStart >= w.start && actionStart < w.end)
                        const state = { selfBuff: { ...stackState }, ultimateActive }
                        const sortedConds = [...condList].sort((a, b) => (b.priority || 0) - (a.priority || 0))
                        for (const cond of sortedConds) {
                            if (_evalConditions(cond.conditions, state)) {
                                condResult = cond.result
                                break
                            }
                        }
                    }
                }

                if (condResult) {
                    conditionResultsByAction.set(action.instanceId, condResult)

                    // 消耗 buff（order=0，同时刻先于新增执行）
                    if (condResult.consumeSelfBuffs?.length) {
                        for (const consume of condResult.consumeSelfBuffs) {
                            const prefix = consume.key
                            if ((stackState[prefix] || 0) > 0) {
                                if (!eventsByPrefix.has(prefix)) eventsByPrefix.set(prefix, [])
                                eventsByPrefix.get(prefix).push({ time: snapMs(actionStart), order: 0, isConsume: true })
                                stackState[prefix] = 0
                            }
                        }
                    }
                }

                // 2. 选取 physicalAnomaly：命中变体则用变体的，否则用 action 原始的
                let anomalies = action.physicalAnomaly
                if (condResult?.variantId) {
                    const variantSuffix = condResult.variantId.replace(`${track.id}_variant_`, '')
                    const variant = charInfo.variants?.find(v => v.id === variantSuffix)
                    if (variant) anomalies = variant.physicalAnomaly ?? []
                }
                if (!Array.isArray(anomalies) || anomalies.length === 0) continue

                const rows = Array.isArray(anomalies[0]) ? anomalies : [anomalies]
                for (const row of rows) {
                    if (!Array.isArray(row)) continue
                    for (const effect of row) {
                        if (!effect?.type) continue
                        const offset = Number(effect.offset) || 0
                        const effectTime = snapMs(actionStart + offset)

                        // 火焰附着 → 熔火 转化
                        if (effect.type === 'blaze_to_magma') {
                            const rawBlaze = _getBlazeStacksAt(effectTime)
                            const available = Math.max(0, rawBlaze - _blazeConsumedTotal)
                            const canAdd = SELF_BUFF_MAX_STACKS - (stackState['magma'] || 0)
                            const amount = Math.min(available, canAdd)
                            if (amount > 0) {
                                _blazeConsumedTotal += amount
                                convertEvents.push({ time: effectTime, amount })
                                if (!eventsByPrefix.has('magma')) eventsByPrefix.set('magma', [])
                                eventsByPrefix.get('magma').push({ time: effectTime, order: 1, stacks: amount })
                                stackState['magma'] = Math.min(SELF_BUFF_MAX_STACKS, (stackState['magma'] || 0) + amount)
                            }
                            continue
                        }

                        if (!exclusiveKeySet.has(effect.type)) continue
                        const stacks = Math.max(1, Number(effect.stacks) || 1)
                        const prefix = effect.type.replace(/_\d+$/, '')

                        if (!eventsByPrefix.has(prefix)) eventsByPrefix.set(prefix, [])
                        eventsByPrefix.get(prefix).push({ time: effectTime, order: 1, stacks })

                        stackState[prefix] = Math.min(SELF_BUFF_MAX_STACKS, (stackState[prefix] || 0) + stacks)
                    }
                }
            }

            // 3. 由事件列表生成可视化 bar
            const bars = []
            for (const [prefix, events] of eventsByPrefix) {
                events.sort((a, b) => a.time - b.time || a.order - b.order)

                let currentStacks = 0
                for (let i = 0; i < events.length; i++) {
                    const ev = events[i]
                    if (ev.isConsume) {
                        currentStacks = 0
                    } else {
                        currentStacks = Math.min(SELF_BUFF_MAX_STACKS, currentStacks + ev.stacks)
                    }
                    const nextTime = i + 1 < events.length ? events[i + 1].time : viewDur
                    if (currentStacks > 0) {
                        const stackKey = `${prefix}_${currentStacks}`
                        const stackExcl = charInfo.exclusive_buffs.find(b => b.key === stackKey)
                        const baseExcl  = charInfo.exclusive_buffs.find(b => b.key.startsWith(prefix + '_'))
                        bars.push({
                            id: `selfbuff_${track.id}_${prefix}_${i}`,
                            type: prefix,
                            name: stackExcl?.name || prefix,
                            icon: baseExcl?.path || '',
                            stackIcon: stackExcl?.path || baseExcl?.path || '',
                            startTime: ev.time,
                            endTime: snapMs(nextTime),
                            stacks: currentStacks,
                            color: '#ffa940',
                        })
                    }
                }
            }

            if (bars.length > 0) selfBuffsByTrack.set(track.id, bars)
        }

        return { selfBuffsByTrack, conditionResultsByAction, convertEvents }
    })

    const computedSelfBuffsByTrack = computed(() => {
        const sim = simulation.value
        if (sim?.simLog?.length) {
            // Phase 2.3: project self-buffs from simLog (authoritative)
            const exclusiveMap = new Map()
            for (const c of characterRoster.value) {
                if (c.exclusive_buffs?.length) exclusiveMap.set(c.id, c.exclusive_buffs)
            }
            return projectSelfBuffTimeline(sim.simLog, exclusiveMap, viewDuration.value)
        }
        return computedSelfBuffSimulation.value.selfBuffsByTrack
    })
    const computedActionConditionResults = computed(() => computedSelfBuffSimulation.value.conditionResultsByAction)
    const computedConvertEvents = computed(() => computedSelfBuffSimulation.value.convertEvents)

    /**
     * computedAnomalyDebuffsEffective
     * 在 computedAnomalyDebuffs 基础上应用 blaze_to_magma 转化消耗：
     * 在转化命中时刻将 blaze_attach 层数减少对应量。
     */
    const computedAnomalyDebuffsEffective = computed(() => {
        const base = computedAnomalyDebuffs.value
        const converts = computedSelfBuffSimulation.value.convertEvents
        if (!converts.length) return base

        const result = []
        for (const seg of base) {
            if (seg.anomalyType !== 'blaze_attach') {
                result.push(seg)
                continue
            }
            const applicable = converts
                .filter(ev => ev.time > seg.startTime && ev.time <= seg.startTime + seg.duration)
                .sort((a, b) => a.time - b.time)
            if (!applicable.length) {
                result.push(seg)
                continue
            }
            let currentStacks = seg.stacks
            let segStart = seg.startTime
            for (const ev of applicable) {
                if (ev.time > segStart && currentStacks > 0) {
                    result.push({ ...seg, startTime: segStart, duration: ev.time - segStart, stacks: currentStacks })
                }
                currentStacks = Math.max(0, currentStacks - ev.amount)
                segStart = ev.time
            }
            if (currentStacks > 0 && segStart < seg.startTime + seg.duration) {
                result.push({ ...seg, startTime: segStart, duration: seg.startTime + seg.duration - segStart, stacks: currentStacks })
            }
        }
        return result
    })

    /**
     * computedEffectiveActions
     * Map<instanceId, {duration, gaugeGain, teamGaugeGain}>
     * 当 conditionResult 命中变体时，用变体数据覆盖原 action 的关键字段，
     * 供 legacyNodeRects / calculateGaugeData 等计算使用。
     */
    const computedEffectiveActions = computed(() => {
        const map = new Map()
        for (const track of tracks.value) {
            if (!track?.id || !track.actions) continue
            const charInfo = characterRoster.value.find(c => c.id === track.id)
            if (!charInfo?.variants) continue

            for (const action of track.actions) {
                // Skip variant override for individual attack segments —
                // their duration/ticks are already resolved from variant attack_segments
                if (action.kind === 'attack_auto_placed' || action.kind === 'attack_segment') continue

                const condResult = computedActionConditionResults.value.get(action.instanceId)
                if (!condResult?.variantId) continue

                const variantSuffix = condResult.variantId.replace(`${track.id}_variant_`, '')
                const variant = charInfo.variants.find(v => v.id === variantSuffix)
                if (!variant) continue

                map.set(action.instanceId, {
                    duration:       variant.duration       ?? action.duration,
                    gaugeGain:      variant.gaugeGain      ?? action.gaugeGain,
                    teamGaugeGain:  variant.teamGaugeGain  ?? action.teamGaugeGain,
                    damageTicks:    variant.damageTicks     ?? undefined,
                })
            }
        }

        return map
    })

    // ══════════════════════════════════════════════════════════════════════
    // 伤害统计计算
    // ══════════════════════════════════════════════════════════════════════

    const ARTS_ELEMENTS = new Set(['blaze', 'emag', 'cold', 'nature'])
    const ELEM_DMG_KEY = { blaze: 'blaze_dmg', emag: 'emag_dmg', cold: 'cold_dmg', nature: 'nature_dmg', physical: 'physical_dmg' }
    const TYPE_DMG_KEY = { attack: 'attack_dmg_bonus', skill: 'skill_dmg_bonus', link: 'link_dmg_bonus', ultimate: 'ultimate_dmg_bonus' }

    function _calcHitDamage(attack, multiplier, element, skillType, stats, fragile, vulnerability, isBroken) {
        // 增伤乘区（内部加算）
        let bonusPct = 0
        bonusPct += stats[ELEM_DMG_KEY[element] || 'physical_dmg'] || 0
        if (ARTS_ELEMENTS.has(element)) bonusPct += stats.arts_dmg || 0
        bonusPct += stats[TYPE_DMG_KEY[skillType] || 'skill_dmg_bonus'] || 0
        bonusPct += stats.all_skill_dmg_bonus || 0
        const dmgBonus = 1 + bonusPct / 100

        const defense      = 0.5
        const resistance   = 1.0  // 暂不计入抗性（由外部传入，后续扩展）
        const staggerFactor = isBroken ? 1.3 : 1.0
        const fragileFactor = 1 + (fragile || 0) / 100
        const vulnFactor    = 1 + (vulnerability || 0) / 100

        // 期望暴击：crit_dmg 存储为 1.5 格式（=150%），默认 1.5
        const critRate = Math.min(stats.crit_rate || 0, 1)
        const critDmg  = (stats.crit_dmg > 1) ? stats.crit_dmg : 1.5
        const expectedCrit = 1 + critRate * (critDmg - 1)

        return attack * multiplier * dmgBonus * defense * resistance * staggerFactor * fragileFactor * vulnFactor * expectedCrit
    }

    /** 从 compiledScenario.timeline 提取 debuff 时间段（不受 DEBUFF_STACK_CAP 限制） */
    function _buildRawDebuffSegments(timeline) {
        const segments = []
        for (const action of timeline.actions) {
            for (const effect of action.effects) {
                const type = effect.node.type
                const startTime = effect.realStartTime
                const dur = Number(effect.realDuration) || 0
                if (dur <= 0) continue
                const value = Number(effect.node.stacks) || 0
                segments.push({ type, startTime, endTime: startTime + dur, value })
            }
        }
        return segments
    }

    /**
     * damageSummary — 全轴伤害汇总
     * 按 compiledScenario 实时计算，随轨道变化自动更新。
     * 仅计算有 multiplier 字段的 damage tick。
     */
    const damageSummary = computed(() => {
        const scenario = compiledScenario.value
        if (!scenario) return null

        const { timeline, actors } = scenario
        const actorStats = new Map(actors.map(a => [a.id, a.stats]))

        // debuff 时间段（原始值，不限制堆叠上限）
        const debuffSegs = _buildRawDebuffSegments(timeline)

        const byActor = new Map()  // actorId → { name, damage, actions: [] }
        let totalDamage = 0

        // ── AVYWENNA thunderlance tracking (per-actor persistent instances) ──
        // Lances are created by link (3× 雷枪) and ultimate (1× 强雷枪).
        // Skill recall: each surviving lance triggers independent damage.
        // Duration: 30s base (potential +20s not yet in system — future hook).
        const LANCE_BASE_DURATION = 30 // seconds
        const _avyLances = new Map() // trackId → [ { type: 'normal'|'strong', expiryTime } ]
        function _avyGetLances(trackId) {
            if (!_avyLances.has(trackId)) _avyLances.set(trackId, [])
            return _avyLances.get(trackId)
        }
        function _avyCleanExpired(trackId, currentTime) {
            const list = _avyGetLances(trackId)
            // Remove expired lances
            for (let i = list.length - 1; i >= 0; i--) {
                if (list[i].expiryTime <= currentTime) list.splice(i, 1)
            }
        }

        for (const action of timeline.actions) {
            const stats = actorStats.get(action.trackId)
            if (!stats) continue

            const skillType = action.node.type    // 'skill' | 'link' | 'ultimate' | 'attack'
            const element   = action.node.element || 'physical'

            let actionDmg = 0
            const ticks = []
            let unsupportedTickCount = 0

            // Build skill level for overlay
            const _g = getTrackGrowth(action.trackId)
            const _slType = skillType === 'attack' ? 'attack' : skillType
            const _unifiedLvl = _g?.skillLevels?.[_slType] ? skillToUnified(_g.skillLevels[_slType]) : 12
            const _tickCount = action.resolvedDamageTicks.length

            for (let _ti = 0; _ti < _tickCount; _ti++) {
                const rawTick = action.resolvedDamageTicks[_ti]
                // Apply multiplier overlay (same as simulator.ts)
                const tick = applySkillMultiplierOverlay(action.trackId, skillType, _ti, rawTick, false, _unifiedLvl, _tickCount)
                const mult = tick.multiplier
                if (!mult) { unsupportedTickCount++; continue }

                const t = tick.realTime

                // 找出该 tick 时刻所有生效的 debuff
                const active = debuffSegs.filter(d => t >= d.startTime && t < d.endTime)
                const spellFragile  = active.filter(d => d.type === 'spell_vulnerable').reduce((s, d) => s + d.value, 0)
                const physFragile   = active.filter(d => d.type === 'physical_vulnerable').reduce((s, d) => s + d.value, 0)
                // 法术伤害取 spell_vulnerable；物理取 physical_vulnerable
                const fragile = ARTS_ELEMENTS.has(element) ? spellFragile : physFragile

                const dmg = _calcHitDamage(stats.attack, mult, element, skillType, stats, fragile, 0, false)
                actionDmg += dmg
                ticks.push({ time: t, multiplier: mult, damage: dmg, fragile })
            }

            // ── AVYWENNA thunderlance: create / recall ──
            if (action.trackId === 'AVYWENNA') {
                const actionTime = action.realStartTime
                _avyCleanExpired(action.trackId, actionTime)

                if (skillType === 'link') {
                    // Link creates 3 normal lances
                    const lances = _avyGetLances(action.trackId)
                    for (let li = 0; li < 3; li++) {
                        lances.push({ type: 'normal', expiryTime: actionTime + LANCE_BASE_DURATION })
                    }
                } else if (skillType === 'ultimate') {
                    // Ultimate creates 1 strong lance
                    const lances = _avyGetLances(action.trackId)
                    lances.push({ type: 'strong', expiryTime: actionTime + LANCE_BASE_DURATION })
                } else if (skillType === 'skill') {
                    // Skill recall: each surviving lance triggers independent damage
                    const lances = _avyGetLances(action.trackId)
                    if (lances.length > 0) {
                        const recallTime = actionTime + 0.3 // 0.3s after skill start
                        const active = debuffSegs.filter(d => recallTime >= d.startTime && recallTime < d.endTime)
                        const spellFragile = active.filter(d => d.type === 'spell_vulnerable').reduce((s, d) => s + d.value, 0)
                        const physFragile = active.filter(d => d.type === 'physical_vulnerable').reduce((s, d) => s + d.value, 0)
                        const fragile = ARTS_ELEMENTS.has(element) ? spellFragile : physFragile

                        // Multipliers from skills.json: 雷枪伤害倍率 / 强雷枪伤害倍率
                        const opSkills = loadOperator('AVYWENNA').skills
                        const skillRows = opSkills?.skill?.levelData || []
                        const normalRow = skillRows.find(r => r.label === '雷枪伤害倍率')
                        const strongRow = skillRows.find(r => r.label === '强雷枪伤害倍率')
                        const levelIdx = Math.max(0, Math.min(11, _unifiedLvl - 1))
                        const normalMult = normalRow ? parseFloat(String(normalRow.values[levelIdx]).replace('%', '')) / 100 : 0
                        const strongMult = strongRow ? parseFloat(String(strongRow.values[levelIdx]).replace('%', '')) / 100 : 0

                        for (const lance of lances) {
                            const mult = lance.type === 'strong' ? strongMult : normalMult
                            if (mult > 0) {
                                const dmg = _calcHitDamage(stats.attack, mult, element, 'skill', stats, fragile, 0, false)
                                actionDmg += dmg
                                ticks.push({ time: recallTime, multiplier: mult, damage: dmg, fragile, lanceType: lance.type })
                            }
                        }
                        // Consume all lances on recall
                        lances.length = 0
                    }
                }
            }

            if (ticks.length === 0 && unsupportedTickCount === 0) continue

            totalDamage += actionDmg

            const trackId = action.trackId
            if (!byActor.has(trackId)) {
                const track = tracks.value.find(t => t.id === trackId)
                byActor.set(trackId, { trackId, name: track?.id || trackId, damage: 0, actions: [], hasUnsupported: false })
            }
            const actorEntry = byActor.get(trackId)
            actorEntry.damage += actionDmg
            if (unsupportedTickCount > 0) actorEntry.hasUnsupported = true
            actorEntry.actions.push({
                actionId: action.id,
                name: action.node.name,
                type: skillType,
                element,
                damage: actionDmg,
                ticks,
                unsupportedTickCount,
            })
        }

        return {
            totalDamage,
            byActor: [...byActor.values()].sort((a, b) => b.damage - a.damage),
        }
    })

    // ── E1: Manual damage stats snapshot (from simulation simLog) ──
    const damageStatsSnapshot = ref(null)

    /**
     * runDamageStats — 手动触发一次伤害统计
     * 从 simulation.simLog 聚合真实伤害（包含导电/腐蚀/武器被动等全部运行时效果）。
     * 结果写入 damageStatsSnapshot，DamageSummaryPanel 读取。
     */
    function runDamageStats() {
        const sim = simulation.value
        const scenario = compiledScenario.value
        if (!sim || !scenario) {
            damageStatsSnapshot.value = null
            return
        }

        const { timeline } = scenario
        // Build action metadata lookup: actionId → { trackId, name, type, element }
        const actionMeta = new Map()
        for (const action of timeline.actions) {
            actionMeta.set(action.id, {
                trackId: action.trackId,
                name: action.node.name || action.node.id || '',
                type: action.node.type,
                element: action.node.element || 'physical',
            })
        }

        const byActor = new Map()
        let totalDamage = 0

        // Aggregate DAMAGE_TICK entries (skill damage)
        for (const entry of sim.simLog) {
            if (entry.type === 'DAMAGE_TICK') {
                const { sourceId, damage, actionId } = entry.payload
                if (!damage || damage <= 0) continue
                totalDamage += damage

                if (!byActor.has(sourceId)) {
                    byActor.set(sourceId, { trackId: sourceId, name: sourceId, damage: 0, actions: new Map(), hasUnsupported: false })
                }
                const actor = byActor.get(sourceId)
                actor.damage += damage

                const aKey = actionId || '__unknown__'
                if (!actor.actions.has(aKey)) {
                    const meta = actionMeta.get(actionId) || {}
                    actor.actions.set(aKey, {
                        actionId: aKey,
                        name: meta.name || '未知',
                        type: meta.type || 'skill',
                        element: meta.element || 'physical',
                        damage: 0,
                        ticks: [],
                        unsupportedTickCount: 0,
                    })
                }
                actor.actions.get(aKey).damage += damage
            }

            // Aggregate ANOMALY_DAMAGE entries (burn DOT, reaction damage, burst, etc.)
            if (entry.type === 'ANOMALY_DAMAGE') {
                const { damage, tags } = entry.payload
                if (!damage || damage <= 0) continue
                totalDamage += damage

                const sourceId = tags?.sourceActorId || '__anomaly__'
                if (!byActor.has(sourceId)) {
                    byActor.set(sourceId, { trackId: sourceId, name: sourceId, damage: 0, actions: new Map(), hasUnsupported: false })
                }
                const actor = byActor.get(sourceId)
                actor.damage += damage

                // Group all anomaly damage under a single synthetic action per actor
                const aKey = `__anomaly_${sourceId}__`
                if (!actor.actions.has(aKey)) {
                    actor.actions.set(aKey, {
                        actionId: aKey,
                        name: '异常伤害',
                        type: 'anomaly',
                        element: 'nature',
                        damage: 0,
                        ticks: [],
                        unsupportedTickCount: 0,
                    })
                }
                actor.actions.get(aKey).damage += damage
            }
        }

        // Finalize: convert action Maps to sorted arrays
        const result = [...byActor.values()]
            .map(actor => ({
                ...actor,
                actions: [...actor.actions.values()].sort((a, b) => b.damage - a.damage),
            }))
            .sort((a, b) => b.damage - a.damage)

        damageStatsSnapshot.value = { totalDamage, byActor: result }
    }

    /**
     * anomalyDamageSummary — 异常伤害汇总
     * 独立计算法术爆发、法术异常触发（含燃烧 DoT）、冻结消耗及四种物理异常的伤害。
     * 来源：从轨道 physicalAnomaly 字段直接读取事件，按时间顺序模拟状态机。
     */
    const anomalyDamageSummary = computed(() => {
        const scenario = compiledScenario.value
        if (!scenario) return null

        const { actors, timeline } = scenario
        const actorStatsMap = new Map(actors.map(a => [a.id, a.stats]))

        // debuff 时间段（用于燃烧每 tick 查询法术脆弱）
        const debuffSegs = _buildRawDebuffSegments(timeline)

        // ─── 1. 收集所有法术附着事件与物理异常事件 ────────────────────────────
        const spellAttachRaw = []   // { time, type, stacks, trackId, endTime }
        const physRaw = []          // { time, type, stacks, trackId }

        for (const track of tracks.value) {
            if (!track?.id || !track.actions) continue
            if (!actorStatsMap.has(track.id)) continue

            for (const action of track.actions) {
                if (action.isDisabled) continue
                const anomalies = action.physicalAnomaly
                if (!Array.isArray(anomalies) || anomalies.length === 0) continue
                const rows = Array.isArray(anomalies[0]) ? anomalies : [anomalies]
                const actionStart = Number(action.startTime) || 0

                for (const row of rows) {
                    if (!Array.isArray(row)) continue
                    for (const effect of row) {
                        if (!effect?.type) continue
                        const offset = Number(effect.offset) || 0
                        const t = snapMs(actionStart + offset)
                        const stacks = Math.min(DEBUFF_STACK_CAP, Math.max(1, Number(effect.stacks) || 1))

                        if (ATTACH_LIKE_DEBUFF_TYPES.has(effect.type)) {
                            const dur = Number(effect.duration) || 0
                            spellAttachRaw.push({
                                time: t,
                                type: effect.type,
                                stacks,
                                trackId: track.id,
                                endTime: dur > 0 ? snapMs(t + dur) : Infinity,
                            })
                        } else if (PHYSICAL_TRIGGER_TYPES.has(effect.type)) {
                            physRaw.push({ time: t, type: effect.type, stacks, trackId: track.id })
                        }
                    }
                }
            }
        }

        // ─── 2. 处理法术附着碰撞（爆发 / 异常反应）────────────────────────────
        spellAttachRaw.sort((a, b) => a.time - b.time || a.type.localeCompare(b.type))

        // 活跃附着：attachType → 可变段列表 { stacks, startTime, endTime, trackId }
        const activeAttaches = new Map()
        for (const t of ATTACH_LIKE_DEBUFF_TYPES) activeAttaches.set(t, [])

        const byActor = new Map()   // trackId → { totalDamage, events[] }
        const getActor = (trackId) => {
            if (!byActor.has(trackId)) byActor.set(trackId, { trackId, totalDamage: 0, events: [] })
            return byActor.get(trackId)
        }

        // 冻结区间（用于物理异常阶段判断冻结消耗）
        const frozenIntervals = []  // { startTime, endTime (mutable), anomalyLevel }

        for (const ev of spellAttachRaw) {
            const t = ev.time
            const incomingType = ev.type
            const stats = actorStatsMap.get(ev.trackId)
            if (!stats) continue
            const artsPower = Number(stats.originium_arts_power) || 0

            // 查找活跃的相同类型和不同类型附着
            let sameTypeStacks = 0
            let diffType = null
            let diffTypeStacks = 0

            for (const [atype, segs] of activeAttaches) {
                const totalStacks = Math.min(
                    DEBUFF_STACK_CAP,
                    segs.filter(s => s.startTime <= t && s.endTime > t).reduce((s, seg) => s + seg.stacks, 0)
                )
                if (totalStacks === 0) continue
                if (atype === incomingType) sameTypeStacks = totalStacks
                else if (diffType === null) { diffType = atype; diffTypeStacks = totalStacks }
            }

            if (diffType !== null) {
                // 异元素反应 → 法术异常
                const reactionType = ELEMENTAL_REACTION_MAP[incomingType][diffType]
                const anomalyLevel = diffTypeStacks  // 1-indexed

                const actor = getActor(ev.trackId)
                const triggerDmg = calcSpellAnomalyTriggerDamage(stats.attack, anomalyLevel, artsPower)
                actor.totalDamage += triggerDmg
                actor.events.push({ time: t, type: reactionType + '_trigger', damage: triggerDmg, anomalyLevel })

                if (reactionType === 'burning') {
                    // 每秒独立计算，实时查询法术脆弱
                    let totalDotDmg = 0
                    for (let i = 0; i < 10; i++) {
                        const tickTime = t + i * 1000
                        const spellFragile = debuffSegs
                            .filter(d => d.type === 'spell_vulnerable' && tickTime >= d.startTime && tickTime < d.endTime)
                            .reduce((s, d) => s + d.value, 0)
                        const fragileFactor = 1 + spellFragile / 100
                        const tickDmg = calcCombustionDotTick(stats.attack, anomalyLevel, artsPower) * fragileFactor
                        totalDotDmg += tickDmg
                        actor.events.push({ time: tickTime, type: 'burning_dot', damage: tickDmg, anomalyLevel, spellFragile })
                    }
                    actor.totalDamage += totalDotDmg
                } else if (reactionType === 'frozen') {
                    frozenIntervals.push({ startTime: t, endTime: Infinity, anomalyLevel })
                }

                // 消耗现有附着
                for (const seg of activeAttaches.get(diffType)) {
                    if (seg.endTime > t) seg.endTime = t
                }
                // incoming 被消耗，不加入活跃列表
            } else if (sameTypeStacks > 0) {
                // 同元素爆发
                const reactionType = ELEMENTAL_REACTION_MAP[incomingType][incomingType]
                const actor = getActor(ev.trackId)
                const dmg = calcSpellBurstDamage(stats.attack, artsPower)
                actor.totalDamage += dmg
                actor.events.push({ time: t, type: reactionType, damage: dmg })

                // 消耗现有同元素附着
                for (const seg of activeAttaches.get(incomingType)) {
                    if (seg.endTime > t) seg.endTime = t
                }
                // incoming 被消耗
            } else {
                // 无碰撞 → 加入活跃列表
                activeAttaches.get(incomingType).push({
                    stacks: ev.stacks,
                    startTime: t,
                    endTime: ev.endTime,
                    trackId: ev.trackId,
                })
            }
        }

        // ─── 3. 处理物理异常事件 ──────────────────────────────────────────────
        physRaw.sort((a, b) => a.time - b.time)

        let physVulLevel = 0

        for (const ev of physRaw) {
            const t = ev.time
            const type = ev.type
            const stats = actorStatsMap.get(ev.trackId)
            if (!stats) continue
            const artsPower = Number(stats.originium_arts_power) || 0
            const actor = getActor(ev.trackId)

            // 检查目标是否处于冻结状态 → 触发冻结消耗
            const frozenIdx = frozenIntervals.findIndex(s => s.startTime <= t && s.endTime > t)
            if (frozenIdx !== -1) {
                const frozen = frozenIntervals[frozenIdx]
                const freezeDmg = calcFreezeConsumeDamage(stats.attack, frozen.anomalyLevel, artsPower)
                actor.totalDamage += freezeDmg
                actor.events.push({ time: t, type: 'ice_shatter', damage: freezeDmg, anomalyLevel: frozen.anomalyLevel })
                frozenIntervals[frozenIdx].endTime = t  // 冻结被消耗
            }

            // 若无破防则生成 1 级
            if (physVulLevel === 0) physVulLevel = 1

            if (PHYSICAL_ADDSTACK_TYPES.has(type)) {
                // 击飞/倒地：造成伤害 + 层数 +1
                const dmg = calcLiftKnockdownDamage(stats.attack, artsPower)
                actor.totalDamage += dmg
                actor.events.push({ time: t, type, damage: dmg, physVulLevel })
                physVulLevel = Math.min(PHYSICAL_VULNERABLE_CAP, physVulLevel + 1)
            } else if (type === 'stagger') {
                // 猛击：消耗全部破防层数
                const stacks = physVulLevel
                const dmg = calcCrushDamage(stats.attack, stacks, artsPower)
                actor.totalDamage += dmg
                actor.events.push({ time: t, type, damage: dmg, stacks })
                physVulLevel = 0
            } else if (type === 'armor_break') {
                // 碎甲：消耗全部破防层数
                const stacks = physVulLevel
                const dmg = calcBreachDamage(stats.attack, stacks, artsPower)
                actor.totalDamage += dmg
                actor.events.push({ time: t, type, damage: dmg, stacks })
                physVulLevel = 0
            }
        }

        const totalDamage = [...byActor.values()].reduce((s, a) => s + a.totalDamage, 0)
        return {
            totalDamage,
            byActor: [...byActor.values()].sort((a, b) => b.totalDamage - a.totalDamage),
        }
    })

    function togglePrepExpanded() {
        prepExpanded.value = !prepExpanded.value
        commitState()
    }

    function setPrepDuration(newDuration, { commit = true } = {}) {
        const next = Math.max(MIN_PREP_DURATION, Number(newDuration) || 0)
        const prev = Math.max(MIN_PREP_DURATION, Number(prepDuration.value) || 0)
        if (Math.abs(next - prev) < 0.0001) return

        const delta = next - prev

        // clamp so that no VT time becomes negative
        let minTime = Infinity
        tracks.value.forEach(t => {
            t.actions?.forEach(a => {
                const st = Number(a.startTime) || 0
                const lt = (a.logicalStartTime !== undefined) ? (Number(a.logicalStartTime) || 0) : st
                minTime = Math.min(minTime, st, lt)
            })
        })
        weaponStatuses.value.forEach(s => {
            const st = Number(s.startTime) || 0
            const lt = (s.logicalStartTime !== undefined) ? (Number(s.logicalStartTime) || 0) : st
            minTime = Math.min(minTime, st, lt)
        })
        cycleBoundaries.value.forEach(b => { minTime = Math.min(minTime, Number(b.time) || 0) })
        switchEvents.value.forEach(e => { minTime = Math.min(minTime, Number(e.time) || 0) })
        if (!Number.isFinite(minTime)) minTime = 0

        const minAllowedDelta = -minTime
        const appliedDelta = Math.max(delta, minAllowedDelta)

        const shiftVal = (v) => {
            const n = Number(v) || 0
            const out = n + appliedDelta
            return out < 0 ? 0 : out
        }

        tracks.value.forEach(track => {
            track.actions?.forEach(a => {
                a.startTime = shiftVal(a.startTime)
                if (a.logicalStartTime !== undefined) a.logicalStartTime = shiftVal(a.logicalStartTime)
                else a.logicalStartTime = a.startTime
            })
            track.actions?.sort((a, b) => a.startTime - b.startTime)
        })
        weaponStatuses.value.forEach(s => {
            s.startTime = shiftVal(s.startTime)
            if (s.logicalStartTime !== undefined) s.logicalStartTime = shiftVal(s.logicalStartTime)
            else s.logicalStartTime = s.startTime
        })
        teamBuffStatuses.value.forEach(s => {
            s.startTime = shiftVal(s.startTime)
            if (s.logicalStartTime !== undefined) s.logicalStartTime = shiftVal(s.logicalStartTime)
            else s.logicalStartTime = s.startTime
        })
        debuffStatuses.value.forEach(s => {
            s.startTime = shiftVal(s.startTime)
            if (s.logicalStartTime !== undefined) s.logicalStartTime = shiftVal(s.logicalStartTime)
            else s.logicalStartTime = s.startTime
        })
        cycleBoundaries.value.forEach(b => { b.time = shiftVal(b.time) })
        switchEvents.value.forEach(e => { e.time = shiftVal(e.time) })

        prepDuration.value = prev + appliedDelta
        refreshAllActionShifts()
        setTimelineShift(timelineShift.value)
        if (commit) commitState()
    }

    // ===================================================================================
    // 持久化与数据加载 (Persistence)
    // ===================================================================================

    const STORAGE_KEY = 'endaxis_autosave'

    function initAutoSave() {
        watchThrottled([tracks, connections, characterOverrides, weaponOverrides, equipmentCategoryOverrides, weaponStatuses, teamBuffStatuses, debuffStatuses, systemConstants, scenarioList, activeScenarioId, activeEnemyId, customEnemyParams, cycleBoundaries, switchEvents, mainControlEvents],
            ([newTracks, newConns, newOverrides, newWeaponOverrides, newEquipmentCatOverrides, newWeaponStatuses, newTeamBuffs, newDebuffs, newSys, newScList, newActiveId, newEnemyId, newCustomParams, newBoundaries, newSwEvents, newMcEvents]) => {

                if (isLoading.value) return

                const listToSave = JSON.parse(JSON.stringify(newScList))
                const currentSc = listToSave.find(s => s.id === newActiveId)

                if (currentSc) {
                    currentSc.data = {
                        tracks: newTracks,
                        connections: newConns,
                        characterOverrides: newOverrides,
                        weaponOverrides: newWeaponOverrides,
                        equipmentCategoryOverrides: newEquipmentCatOverrides,
                        weaponStatuses: newWeaponStatuses,
                        teamBuffStatuses: newTeamBuffs,
                        debuffStatuses: newDebuffs,
                        prepDuration: prepDuration.value,
                        prepExpanded: prepExpanded.value,
                        systemConstants: newSys,
                        activeEnemyId: newEnemyId,
                        customEnemyParams: newCustomParams,
                        cycleBoundaries: newBoundaries,
                        switchEvents: newSwEvents,
                        mainControlEvents: newMcEvents
                    }
                }

                const snapshot = {
                    version: '1.0.0',
                    timestamp: Date.now(),
                    scenarioList: listToSave,
                    activeScenarioId: newActiveId,
                    systemConstants: newSys,
                    activeEnemyId: newEnemyId
                }
                localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
            }, { deep: true, throttle: 500 })
    }

    function loadFromBrowser() {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            try {
                const data = JSON.parse(raw);

                if (!data.scenarioList) return false;

                if (data.systemConstants) systemConstants.value = { ...systemConstants.value, ...data.systemConstants };

                scenarioList.value = data.scenarioList.map(sc => {
                    const cloned = JSON.parse(JSON.stringify(sc))
                    if (cloned?.data) {
                        const normalized = normalizePrepConfig(cloned.data)
                        cloned.data = normalized.snapshot
                    }
                    return cloned
                })
                activeScenarioId.value = data.activeScenarioId || scenarioList.value[0].id

                const currentSc = scenarioList.value.find(s => s.id === activeScenarioId.value)
                if (currentSc && currentSc.data) {
                    _loadSnapshot(currentSc.data)
                } else {
                    tracks.value = createDefaultTracks();
                    connections.value = [];
                    characterOverrides.value = {};
                    weaponOverrides.value = {};
                    equipmentCategoryOverrides.value = {};
                    weaponStatuses.value = [];
                    teamBuffStatuses.value = [];
                    debuffStatuses.value = [];
                    cycleBoundaries.value = [];
                    switchEvents.value = [];
                    prepDuration.value = 5
                    prepExpanded.value = true
                }

                historyStack.value = []; historyIndex.value = -1; commitState();
                return true;
            } catch (e) { console.error("Auto-save load failed:", e) }
        }
        return false;
    }

    function resetProject() {
        localStorage.removeItem(STORAGE_KEY);
        tracks.value = createDefaultTracks();
        connections.value = [];
        characterOverrides.value = {};
        weaponOverrides.value = {};
        equipmentCategoryOverrides.value = {};
        weaponStatuses.value = [];
        teamBuffStatuses.value = [];
        debuffStatuses.value = [];
        cycleBoundaries.value = [];
        switchEvents.value = [];
        mainControlEvents.value = [];
        prepDuration.value = 5
        prepExpanded.value = true

        systemConstants.value = { ...DEFAULT_SYSTEM_CONSTANTS };

        activeEnemyId.value = 'custom';
        // 重置方案
        scenarioList.value = [{ id: 'default_sc', name: tr('timeline.scenario.defaultName', { index: 1 }), data: null }];
        activeScenarioId.value = 'default_sc';

        clearSelection();
        historyStack.value = [];
        historyIndex.value = -1;
        commitState();
    }


    async function fetchGameData() {
        try {
            isLoading.value = true
            // #region agent log
            fetch('http://127.0.0.1:7918/ingest/f5ff12b8-2ef1-4908-9a06-439961e59ee9', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '0c28b9' }, body: JSON.stringify({ sessionId: '0c28b9', location: 'timelineStore.js:fetchGameData', message: 'fetch start', data: { isLoading: isLoading.value }, timestamp: Date.now(), hypothesisId: 'H1' }) }).catch(() => {})
            // #endregion

            const data = await executeFetch()
            // #region agent log
            fetch('http://127.0.0.1:7918/ingest/f5ff12b8-2ef1-4908-9a06-439961e59ee9', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '0c28b9' }, body: JSON.stringify({ sessionId: '0c28b9', location: 'timelineStore.js:afterExecuteFetch', message: 'executeFetch resolved', data: { hasData: !!data, keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 8) : [] }, timestamp: Date.now(), hypothesisId: 'H1' }) }).catch(() => {})
            // #endregion

        if (data) {
            if (data.characterRoster) {
                characterRoster.value = data.characterRoster.sort((a, b) => (b.rarity || 0) - (a.rarity || 0))
                characterRoster.value.forEach(c => normalizeAttackSegmentsForCharacter(c))
            }
            if (data.ICON_DATABASE) {
                iconDatabase.value = data.ICON_DATABASE
            }
            if (data.enemyDatabase) {
                enemyDatabase.value = data.enemyDatabase
            }
            if (data.enemyCategories) {
                enemyCategories.value = data.enemyCategories
            }
            if (data.weaponDatabase) {
                weaponDatabase.value = (data.weaponDatabase || []).map(w => ({
                    ...w,
                    commonSlots: normalizeWeaponCommonSlots(w.commonSlots),
                    buffBonuses: normalizeWeaponBuffBonuses(w.buffBonuses),
                }))
            }
            if (data.equipmentDatabase) {
                equipmentDatabase.value = normalizeEquipmentDatabase(data.equipmentDatabase)
            } else {
                equipmentDatabase.value = []
            }
            if (data.equipmentCategories) {
                equipmentCategories.value = data.equipmentCategories
            } else {
                equipmentCategories.value = []
            }
            if (data.equipmentCategoryConfigs) {
                equipmentCategoryConfigs.value = data.equipmentCategoryConfigs
            } else {
                equipmentCategoryConfigs.value = {}
            }
            if (data.misc) {
                const eqCfg = normalizeEquipmentMiscConfig(data.misc)
                misc.value = {
                    modifierDefs: normalizeModifierDefs(data.misc?.modifierDefs),
                    weaponCommonModifiers: normalizeWeaponCommonModifiersTable(data.misc?.weaponCommonModifiers),
                    equipmentTemplates: eqCfg.equipmentTemplates,
                    equipmentAdapterTable: eqCfg.equipmentAdapterTable,
                    domainConfig: eqCfg.domainConfig,
                }
            } else {
                const eqCfg = normalizeEquipmentMiscConfig(null)
                misc.value = {
                    modifierDefs: [],
                    weaponCommonModifiers: {},
                    equipmentTemplates: eqCfg.equipmentTemplates,
                    equipmentAdapterTable: eqCfg.equipmentAdapterTable,
                    domainConfig: eqCfg.domainConfig,
                }
            }
        }

            historyStack.value = []
            historyIndex.value = -1
            commitState()

        } catch (error) {
            console.error("Load failed:", error)
        } finally {
            isLoading.value = false
        }
    }

    function getProjectData({ includeScenarios = null } = {}) {
        let listToExport = JSON.parse(JSON.stringify(scenarioList.value))

        if (includeScenarios) {
            const ids = Array.isArray(includeScenarios) ? includeScenarios : [includeScenarios];
            const allowedSet = new Set(ids);
            listToExport = listToExport.filter(s => allowedSet.has(s.id));
        }

        const currentSc = listToExport.find(s => s.id === activeScenarioId.value)
        if (currentSc) {
            currentSc.data = {
                tracks: tracks.value,
                connections: connections.value,
                characterOverrides: characterOverrides.value,
                weaponOverrides: weaponOverrides.value,
                equipmentCategoryOverrides: equipmentCategoryOverrides.value,
                weaponStatuses: weaponStatuses.value,
                teamBuffStatuses: teamBuffStatuses.value,
                debuffStatuses: debuffStatuses.value,
                prepDuration: prepDuration.value,
                prepExpanded: prepExpanded.value,
                activeEnemyId: activeEnemyId.value,
                customEnemyParams: customEnemyParams.value,
                cycleBoundaries: cycleBoundaries.value,
                switchEvents: switchEvents.value,
                mainControlEvents: mainControlEvents.value
            }
        }

        return {
            timestamp: Date.now(),
            version: '1.0.0',
            scenarioList: listToExport,
            activeScenarioId: activeScenarioId.value,
            systemConstants: systemConstants.value
        };
    }

    function exportProject({ filename } = {}) {
        const projectData = getProjectData();

        const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        const baseName = filename && filename.trim()
            ? filename.trim()
            : `endaxis_project_${new Date().toISOString().slice(0, 10)}.json`;
        link.download = baseName.toLowerCase().endsWith('.json') ? baseName : `${baseName}.json`;
        link.click();
        URL.revokeObjectURL(link.href)
    }

    async function exportShareString({ includeScenarios = null } = {}) {
        const projectData = getProjectData({ includeScenarios });
        const jsonString = JSON.stringify(projectData);
        return await compressGzip(jsonString);
    }

    async function importShareString(compressedStr) {
        try {
            const jsonString = await decompressGzip(compressedStr);
            if (!jsonString) return false;

            const data = JSON.parse(jsonString);
            return loadProjectData(data);
        } catch (e) {
            console.error("Import share code failed:", e);
            return false;
        }
    }

    function loadProjectData(data) {
        try {
            if (data.systemConstants) { systemConstants.value = { ...systemConstants.value, ...data.systemConstants }; }

            if (data.activeEnemyId) { activeEnemyId.value = data.activeEnemyId }

            if (data.customEnemyParams) {
                customEnemyParams.value = { ...customEnemyParams.value, ...data.customEnemyParams }
            }

            if (data.scenarioList) {
                // normalize & migrate legacy scenarios
                scenarioList.value = data.scenarioList.map(sc => {
                    const cloned = JSON.parse(JSON.stringify(sc))
                    if (cloned?.data) {
                        const normalized = normalizePrepConfig(cloned.data)
                        cloned.data = normalized.snapshot
                    }
                    return cloned
                })
                const validId = scenarioList.value.find(s => s.id === data.activeScenarioId) ? data.activeScenarioId : scenarioList.value[0].id
                activeScenarioId.value = validId

                const currentSc = scenarioList.value.find(s => s.id === activeScenarioId.value)
                if (currentSc && currentSc.data) {
                    _loadSnapshot(currentSc.data)
                } else {
                    tracks.value = createDefaultTracks();
                    connections.value = [];
                    characterOverrides.value = {};
                    weaponOverrides.value = {};
                    weaponStatuses.value = [];
                    teamBuffStatuses.value = [];
                    debuffStatuses.value = [];
                    cycleBoundaries.value = [];
                    switchEvents.value = [];
                    equipmentCategoryOverrides.value = {};
                    prepDuration.value = 5
                    prepExpanded.value = true
                }
            }

            clearSelection();
            historyStack.value = [];
            historyIndex.value = -1;
            commitState();
            return true;
        } catch (err) {
            console.error("Load project data failed:", err)
            return false
        }
    }

    async function importProject(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    const success = loadProjectData(data);
                    if (success) resolve(true);
                    else reject(new Error("Invalid data structure"));
                } catch (err) { reject(err) }
            };
            reader.readAsText(file)
        })
    }

    return {
        MAX_SCENARIOS, toTimelineSpace, toViewportSpace, toGameTime, toRealTime, toggleNewCompiler,
        systemConstants, isLoading, characterRoster, iconDatabase, tracks, connections, activeTrackId, timelineScrollTop, timelineShift, timelineRect, trackLaneRects, nodeRects, draggingSkillData,
        selectedActionId, selectedLibrarySkillId, selectedLibrarySource, selectedWeaponStatusId, multiSelectedIds, clipboard, isCapturing, setIsCapturing, showCursorGuide, isBoxSelectMode, cursorPosTimeline, cursorCurrentTime, cursorPosition, snapStep, strictMode, toggleStrictMode, validateSkillPlacement,
        selectedAnomalyId, setSelectedAnomalyId, updateTrackGaugeEfficiency,
        teamTracksInfo, activeSkillLibrary, activeWeaponSkillLibrary, BASE_BLOCK_WIDTH, setBaseBlockWidth, formatTimeLabel, ZOOM_LIMITS, timeBlockWidth, ELEMENT_COLORS, getCharacterElementColor, isActionSelected, hoveredActionId, setHoveredAction,
        fetchGameData, exportProject, importProject, exportShareString, importShareString, TOTAL_DURATION, selectTrack, changeTrackOperator, clearTrack, selectLibrarySkill, updateLibrarySkill, selectAction, updateAction, updateWeaponStatus,
        addSkillToTrack, setDraggingSkill, setTimelineShift, setScrollTop, setTimelineRect, setTrackLaneRect, setNodeRect, calculateGlobalSpData, calculateGaugeData, getTrackGaugeMax, calculateGlobalStaggerData, updateTrackInitialGauge, updateTrackMaxGauge, updateTrackOriginiumArtsPower, updateTrackLinkCdReduction, updateTrackWeapon,
        updateTrackWeaponTier, syncAllWeaponModifiers, getModifierLabel,
        removeConnection, updateConnection, updateConnectionPort, getColor, toggleCursorGuide, toggleBoxSelectMode, setCursorPosition, toggleSnapStep, nudgeSelection,
        setMultiSelection, clearSelection, copySelection, pasteSelection, removeCurrentSelection, undo, redo, commitState,
        removeAnomaly, initAutoSave, loadFromBrowser, resetProject, selectedConnectionId, selectConnection, selectAnomaly,
        alignActionToTarget, moveTrack,
        connectionMap, actionMap, effectsMap, getConnectionById, resolveNode, getNodesOfConnection, enableConnectionTool, connectionDragState, connectionSnapState, validConnectionTargetIds, createConnection, toggleConnectionTool,
        cycleBoundaries, selectedCycleBoundaryId, addCycleBoundary, updateCycleBoundary, selectCycleBoundary,
        contextMenu, openContextMenu, closeContextMenu,
        switchEvents, selectedSwitchEventId, addSwitchEvent, updateSwitchEvent, selectSwitchEvent, selectWeaponStatus,
        mainControlEvents, selectedMcEventId, selectMainControlEvent, setMainControl, computedMainControlSegments, computedMainControlCooldowns, moveMainControl,
        toggleActionLock, toggleActionDisable, setActionColor,
        globalExtensions, getShiftedEndTime, refreshAllActionShifts, getActionById, getEffectById,
        getUltimateEnhancementMetrics,
        statusMap, getStatusById, statusNodeRects, statusConsumptionTimeById,
        enemyDatabase, activeEnemyId, applyEnemyPreset, ENEMY_TIERS, enemyCategories,
        scenarioList, activeScenarioId, switchScenario, addScenario, duplicateScenario, deleteScenario,
        effectLayouts, getNodeRect, weaponDatabase, weaponOverrides, weaponStatuses, activeWeapon, getWeaponById, isWeaponSkillId, addWeaponStatus, weaponDetailOpen, selectedPotentialData,
        equipmentDatabase, equipmentCategories, equipmentCategoryConfigs, getEquipmentById, updateTrackEquipment, updateTrackEquipmentTier,
        equipmentCategoryOverrides, updateEquipmentCategoryOverride,
        activeSetBonusLibrary, addSetBonusStatus, getActiveSetBonusCategories,
        teamBuffStatuses, debuffStatuses, effectiveTeamBuffStatuses, effectiveDebuffStatuses, effectiveWeaponStatuses, addTeamBuffStatus, addDebuffStatus, removeTeamBuffStatus, removeDebuffStatus, updateTeamBuffStatus, updateDebuffStatus, DEBUFF_ANOMALY_TYPES, isDebuffAnomalyType, computedAnomalyDebuffs,
        DEBUFF_STACK_CAP, ATTACH_LIKE_DEBUFF_TYPES, registerDebuffConsumptionListener, applyDebuffConsumption,
        computedPhysicalVulnerable,
        computedSelfBuffsByTrack,
        computedActionConditionResults,
        computedConvertEvents,
        computedAnomalyDebuffsEffective,
        computedEffectiveActions,
        misc,
        prepDuration, prepExpanded, viewDuration, prepZoneWidthPx, totalTimelineWidthPx,
        timeToPx, pxToTime, formatAxisTimeLabel, togglePrepExpanded, setPrepDuration,
        useNewCompiler, compiledTimeline, spSeries, staggerSeries,
        gaugeSeriesByTrackId, legalityPolicy, legalityIssuesByAction, sortedLegalityIssues,
        timelineMode, cycleTimelineMode, TIMELINE_MODE_CYCLE,
        timelineEditorMode, setTimelineEditorMode, playheadTime, setPlayheadTime, confirmPlayheadRewind, advancePlayheadAfterPlacement,
        validationResult, validationDialogVisible, validationPassed, validateTimeline,
        playheadSimulation, playheadSkillAvailability, linkQueueAtPlayhead, checkSkillAvailabilityAt,
        realisticMoveStep, MOVE_STEP_OPTIONS, cycleMoveStep, movePlayheadByStep, jumpToActionBoundary,
        isPlaybackActive, playbackSpeed, togglePlayback, stopPlayback, cyclePlaybackSpeed,
        castSkillByShortcut, castLinkByShortcut, castAttackByShortcut, castFullAttackSequence,
        getMainControlTrackAt, switchMainControlTo, cycleMainControl, isWarningActive, showBlockingWarning, showBlockingRewind, manualSave,
        activeOperatorSegmentsByTrack,
        damageSummary,
        anomalyDamageSummary,
        damageStatsSnapshot, runDamageStats,
        // Operator growth (promotion, level, skill levels) + base stat lookup
        GROWTH_SKILL_KEYS, PROMO_CAPS, getTrackGrowth, setTrackPromotion, setTrackCharacterLevel, setTrackSkillLevel,
        skillToUnified, skillFromUnified, skillMaxUnified, createDefaultGrowth,
        resolveBaseStats, resolveTrackBaseStats, resolveTrackConfiguredStats, resolveTrackFinalStats,
        TALENT_ROW1_BONUSES, getTalentRow1Bonus,
        setTrackPotentialLevel, getDefaultPotentialLevel, getMaxPotentialLevel,
        setTrackTalentLevel, getTrackTalentLevel, getTalentMaxLevel,
        resolveTrackActiveEffects,
        computeWeaponAtkAtLevel, setTrackWeaponLevel,
    }
})