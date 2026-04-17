<script setup>
import { computed, ref } from 'vue'
import { inject } from 'vue'
import { useTimelineStore } from '@/stores/timelineStore.js'

const props = defineProps({
  trackId: { type: String, required: true },
})

const state = inject('damageCalcState')
const store = useTimelineStore()

const char = computed(() => store.characterRoster.find(c => c.id === props.trackId))
const growth = computed(() => store.getTrackGrowth(props.trackId))
const configuredStats = computed(() => store.resolveTrackConfiguredStats(props.trackId))
const baseStats = computed(() => store.resolveTrackBaseStats(props.trackId))

// ATK breakdown
const atkExpanded = ref(false)
const atkBreakdown = computed(() => {
  const cs = configuredStats.value
  const bs = baseStats.value
  const track = store.tracks.find(t => t.id === props.trackId)
  if (!cs || !bs || !track) return null

  const operatorAtk = bs.attack || 0
  const weaponAtkFlat = Number(track.weaponAppliedDeltas?.attack) || 0
  const weaponAtkPct = Number(track.weaponAppliedDeltas?.attack_percent) || 0
  const equipAtkFlat = Number(track.equipmentAppliedDeltas?.attack) || 0
  const baseRawAtk = operatorAtk + weaponAtkFlat + equipAtkFlat
  const atkPercentTotal = weaponAtkPct
  const baseTotal = atkPercentTotal ? Math.floor(baseRawAtk * (1 + atkPercentTotal / 100)) : baseRawAtk

  const primary = cs.primary_ability || 0
  const secondary = cs.secondary_ability || 0
  const truncate = (v) => Math.floor(v * 10) / 10
  const primaryPct = truncate(primary * 0.5)
  const secondaryPct = truncate(secondary * 0.2)
  const abilityPct = primaryPct + secondaryPct
  const finalAtk = Math.floor(baseTotal * (1 + abilityPct / 100))

  return { final: finalAtk, baseTotal, baseRawAtk, operatorAtk, weaponAtk: weaponAtkFlat, equipAtk: equipAtkFlat, atkPercentTotal, abilityPct, primary, secondary, primaryPct, secondaryPct }
})

// Damage stats from summary
const actorDamageSummary = computed(() => {
  const summary = state.fullDamageSummary.value
  if (!summary) return null
  return summary.byActor.find(a => a.actorId === props.trackId) || null
})

// Weapon info
const weapon = computed(() => {
  const track = store.tracks.find(t => t.id === props.trackId)
  if (!track?.weaponId) return null
  return store.getWeaponById(track.weaponId)
})

// Equipment info
const EQUIP_SLOTS = [
  { key: 'equipArmorId', label: '护甲' },
  { key: 'equipGlovesId', label: '手套' },
  { key: 'equipAccessory1Id', label: '饰品1' },
  { key: 'equipAccessory2Id', label: '饰品2' },
]

function getEquipName(slotKey) {
  const track = store.tracks.find(t => t.id === props.trackId)
  if (!track) return null
  const equipId = track[slotKey]
  if (!equipId) return null
  const eq = store.getEquipmentById(equipId)
  return eq?.name || equipId
}

function fmtDmg(n) {
  if (!n || n === 0) return '0'
  if (n >= 1e4) return (n / 1e4).toFixed(1) + '万'
  return n.toLocaleString('zh-CN')
}

function pct(part, total) {
  if (!total) return '0%'
  return (part / total * 100).toFixed(1) + '%'
}

// Stat display sections
const STAT_SECTIONS = [
  { label: '暴击率', key: 'crit_rate', suffix: '%' },
  { label: '暴击伤害', key: 'crit_dmg', suffix: '%' },
  { label: '物理伤害加成', key: 'physical_dmg', suffix: '%' },
  { label: '灼热伤害加成', key: 'blaze_dmg', suffix: '%' },
  { label: '寒冷伤害加成', key: 'cold_dmg', suffix: '%' },
  { label: '电磁伤害加成', key: 'emag_dmg', suffix: '%' },
  { label: '自然伤害加成', key: 'nature_dmg', suffix: '%' },
  { label: '普攻伤害加成', key: 'attack_dmg_bonus', suffix: '%' },
  { label: '战技伤害加成', key: 'skill_dmg_bonus', suffix: '%' },
  { label: '连携伤害加成', key: 'link_dmg_bonus', suffix: '%' },
  { label: '终结伤害加成', key: 'ultimate_dmg_bonus', suffix: '%' },
  { label: '全技能伤害加成', key: 'all_skill_dmg_bonus', suffix: '%' },
  { label: '破防伤害加成', key: 'broken_dmg_bonus', suffix: '%' },
  { label: '源石技艺强度', key: 'originium_arts_power', suffix: '' },
  { label: '终结技充能效率', key: 'ult_charge_eff', suffix: '%' },
  { label: '连携技CD缩减', key: 'link_cd_reduction', suffix: '%' },
]

const displayStats = computed(() => {
  const cs = configuredStats.value
  if (!cs) return []
  return STAT_SECTIONS.filter(s => {
    const val = cs[s.key]
    // Show if non-zero (or non-default for some stats)
    if (s.key === 'crit_rate') return true // always show crit
    if (s.key === 'crit_dmg') return true
    if (s.key === 'ult_charge_eff') return val !== 100
    return val && val !== 0
  }).map(s => ({
    ...s,
    value: cs[s.key] || 0,
  }))
})
</script>

<template>
  <div class="character-detail">
    <!-- Character header -->
    <div class="char-header" v-if="char">
      <div class="char-element-dot" :style="{ background: store.getColor(char.element) }" />
      <div class="char-name">{{ char.name }}</div>
      <div class="char-level" v-if="growth">
        Lv.{{ growth.characterLevel }} 精英{{ growth.promotion }}
      </div>
    </div>

    <!-- Damage summary for this actor -->
    <div class="damage-summary" v-if="actorDamageSummary">
      <div class="dmg-total">{{ fmtDmg(actorDamageSummary.totalDamage) }}</div>
      <div class="dmg-label">
        角色总伤害 · {{ actorDamageSummary.hitCount }}次 · {{ actorDamageSummary.critCount }}暴击
      </div>
      <!-- Per-action breakdown -->
      <div class="action-breakdown">
        <div
          v-for="action in actorDamageSummary.actions"
          :key="action.actionId"
          class="action-row"
          @click="state.selectAction(action.actionId, trackId)"
        >
          <span class="action-name">{{ action.name }}</span>
          <span class="action-dmg">{{ fmtDmg(action.totalDamage) }}</span>
          <span class="action-pct">{{ pct(action.totalDamage, actorDamageSummary.totalDamage) }}</span>
        </div>
      </div>
    </div>

    <!-- ATK display -->
    <div class="section-title">属性</div>
    <div class="stats-section" v-if="atkBreakdown">
      <div class="stat-row clickable" @click="atkExpanded = !atkExpanded">
        <span class="stat-label">攻击力 (ATK)</span>
        <span class="stat-value highlight">{{ atkBreakdown.final }}</span>
        <span class="expand-icon">{{ atkExpanded ? '▾' : '▸' }}</span>
      </div>
      <div v-if="atkExpanded" class="atk-breakdown">
        <div class="breakdown-row">
          <span>干员基础</span><span>{{ atkBreakdown.operatorAtk }}</span>
        </div>
        <div class="breakdown-row" v-if="atkBreakdown.weaponAtk">
          <span>+ 武器</span><span>{{ atkBreakdown.weaponAtk }}</span>
        </div>
        <div class="breakdown-row" v-if="atkBreakdown.equipAtk">
          <span>+ 装备</span><span>{{ atkBreakdown.equipAtk }}</span>
        </div>
        <div class="breakdown-row" v-if="atkBreakdown.atkPercentTotal">
          <span>× ATK%</span><span>{{ (1 + atkBreakdown.atkPercentTotal / 100).toFixed(3) }}</span>
        </div>
        <div class="breakdown-row sub">
          <span>= 基础攻击</span><span>{{ atkBreakdown.baseTotal }}</span>
        </div>
        <div class="breakdown-row" v-if="atkBreakdown.abilityPct">
          <span>× 能力加成</span><span>{{ (1 + atkBreakdown.abilityPct / 100).toFixed(4) }}</span>
        </div>
        <div class="breakdown-row sub">
          <span>= 最终攻击</span><span class="highlight">{{ atkBreakdown.final }}</span>
        </div>
      </div>
    </div>

    <!-- Base attributes -->
    <div class="stats-section" v-if="configuredStats">
      <div class="stat-row" v-if="configuredStats.strength">
        <span class="stat-label">力量</span>
        <span class="stat-value">{{ configuredStats.strength }}</span>
      </div>
      <div class="stat-row" v-if="configuredStats.agility">
        <span class="stat-label">敏捷</span>
        <span class="stat-value">{{ configuredStats.agility }}</span>
      </div>
      <div class="stat-row" v-if="configuredStats.intellect">
        <span class="stat-label">智力</span>
        <span class="stat-value">{{ configuredStats.intellect }}</span>
      </div>
      <div class="stat-row" v-if="configuredStats.will">
        <span class="stat-label">意志</span>
        <span class="stat-value">{{ configuredStats.will }}</span>
      </div>
    </div>

    <!-- Combat stats -->
    <div class="stats-section">
      <div v-for="stat in displayStats" :key="stat.key" class="stat-row">
        <span class="stat-label">{{ stat.label }}</span>
        <span class="stat-value">{{ stat.value }}{{ stat.suffix }}</span>
      </div>
    </div>

    <!-- Equipment -->
    <div class="section-title">装备</div>
    <div class="equip-section">
      <div class="equip-row">
        <span class="equip-label">武器</span>
        <span class="equip-name">{{ weapon?.name || '未装备' }}</span>
      </div>
      <div v-for="slot in EQUIP_SLOTS" :key="slot.key" class="equip-row">
        <span class="equip-label">{{ slot.label }}</span>
        <span class="equip-name">{{ getEquipName(slot.key) || '未装备' }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.character-detail {
  padding: 12px;
}

.char-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid #333;
  margin-bottom: 12px;
}

.char-element-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.char-name {
  font-size: 16px;
  font-weight: 600;
  color: #e0e0e0;
}

.char-level {
  font-size: 12px;
  color: #888;
  margin-left: auto;
}

.damage-summary {
  padding: 10px;
  background: #2a2c34;
  border-radius: 6px;
  margin-bottom: 16px;
}

.dmg-total {
  font-size: 20px;
  font-weight: 700;
  color: #ffd700;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.dmg-label {
  font-size: 11px;
  color: #888;
  margin-top: 2px;
  margin-bottom: 8px;
}

.action-breakdown {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.action-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}

.action-row:hover {
  background: #333;
}

.action-row .action-name {
  flex: 1;
  color: #ccc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-row .action-dmg {
  color: #ffd700;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.action-row .action-pct {
  color: #888;
  width: 40px;
  text-align: right;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.section-title {
  font-size: 11px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 12px 0 6px;
  padding-left: 2px;
}

.stats-section {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-bottom: 8px;
}

.stat-row {
  display: flex;
  align-items: center;
  padding: 4px 6px;
  font-size: 12px;
}

.stat-row.clickable {
  cursor: pointer;
  border-radius: 3px;
}

.stat-row.clickable:hover {
  background: #2a2c34;
}

.stat-label {
  flex: 1;
  color: #aaa;
}

.stat-value {
  color: #e0e0e0;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.stat-value.highlight {
  color: #ffd700;
}

.expand-icon {
  color: #666;
  margin-left: 6px;
  font-size: 10px;
}

.atk-breakdown {
  padding: 4px 8px 8px 20px;
  margin-bottom: 4px;
}

.breakdown-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #999;
  padding: 2px 0;
  font-family: 'JetBrains Mono', 'Consolas', monospace;
}

.breakdown-row.sub {
  color: #ccc;
  border-top: 1px solid #333;
  margin-top: 2px;
  padding-top: 4px;
}

.breakdown-row .highlight {
  color: #ffd700;
}

.equip-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.equip-row {
  display: flex;
  align-items: center;
  padding: 4px 6px;
  font-size: 12px;
}

.equip-label {
  width: 50px;
  color: #888;
  flex-shrink: 0;
}

.equip-name {
  color: #ccc;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
