<script setup>
/**
 * Stats Detail overlay — shows full attribute breakdown.
 * Replaces the timeline workspace area (same position as AbilityExpansionOverlay).
 */
import { computed, ref } from 'vue'
import { useTimelineStore } from '../stores/timelineStore.js'
import { loadOperator } from '../data/operators/loader.js'

const store = useTimelineStore()
const emit = defineEmits(['close'])

const char = computed(() => store.characterRoster.find(c => c.id === store.activeTrackId))
const growth = computed(() => store.getTrackGrowth(store.activeTrackId))
const configuredStats = computed(() => store.resolveTrackConfiguredStats(store.activeTrackId))
const baseStats = computed(() => store.resolveTrackBaseStats(store.activeTrackId))
const opMeta = computed(() => loadOperator(store.activeTrackId).meta)

// ATK breakdown
const atkExpanded = ref(true)

const atkBreakdown = computed(() => {
  const cs = configuredStats.value
  const bs = baseStats.value
  const track = store.tracks.find(t => t.id === store.activeTrackId)
  if (!cs || !bs || !track) return null

  const operatorAtk = bs.attack || 0
  // Weapon baseAtk (level-based) is in weaponAppliedDeltas.attack
  // Weapon ATK% is in weaponAppliedDeltas.attack_percent
  const weaponAtkFlat = Number(track.weaponAppliedDeltas?.attack) || 0
  const weaponAtkPct = Number(track.weaponAppliedDeltas?.attack_percent) || 0
  const equipAtkFlat = Number(track.equipmentAppliedDeltas?.attack) || 0
  const baseRawAtk = operatorAtk + weaponAtkFlat + equipAtkFlat
  // Apply ATK% bonus
  const atkPercentTotal = weaponAtkPct
  const baseTotal = atkPercentTotal ? Math.floor(baseRawAtk * (1 + atkPercentTotal / 100)) : baseRawAtk

  // Ability multiplier (matches attackFormula.ts logic)
  const primary = cs.primary_ability || 0
  const secondary = cs.secondary_ability || 0
  const truncate = (v) => Math.floor(v * 10) / 10
  const primaryPct = truncate(primary * 0.5)
  const secondaryPct = truncate(secondary * 0.2)
  const abilityPct = primaryPct + secondaryPct

  const mainAttrLabel = opMeta.value?.mainAttributeLabel || '主能力'
  const subAttrLabel = opMeta.value?.subAttributeLabel || '副能力'

  const finalAtk = Math.floor(baseTotal * (1 + abilityPct / 100))

  return {
    final: finalAtk,
    baseTotal,
    baseRawAtk,
    operatorAtk,
    weaponAtk: weaponAtkFlat,
    equipAtk: equipAtkFlat,
    atkPercentTotal,
    abilityPct,
    primaryPct, primaryLabel: mainAttrLabel,
    secondaryPct, secondaryLabel: subAttrLabel,
  }
})

// Full attribute list for display
const STAT_SECTIONS = [
  { title: '核心属性', items: [
    { id: 'hp', label: '生命值', icon: '♥' },
    { id: '_effectiveAtk', label: '攻击力', icon: '⚔', expandable: true },
    { id: 'strength', label: '力量' },
    { id: 'agility', label: '敏捷' },
    { id: 'intellect', label: '智识' },
    { id: 'will', label: '意志' },
  ]},
  { title: '其他属性', items: [
    { id: 'crit_rate', label: '暴击率', suffix: '%' },
    { id: 'crit_dmg', label: '暴击伤害', suffix: '%' },
    { id: 'originium_arts_power', label: '源石技艺强度' },
    { id: '_res_physical', label: '物理抗性' },
    { id: '_res_blaze', label: '灼热抗性' },
    { id: '_res_emag', label: '电磁抗性' },
    { id: '_res_cold', label: '寒冷抗性' },
    { id: '_res_nature', label: '自然抗性' },
    { id: '_res_beyond', label: '超域抗性' },
    { id: 'healing_effect', label: '治疗效率加成', suffix: '%' },
    { id: 'link_cd_reduction', label: '连携技冷却缩减', suffix: '%' },
    { id: 'ult_charge_eff', label: '终结技充能效率', suffix: '%' },
    { id: 'physical_dmg', label: '物理伤害加成', suffix: '%' },
    { id: 'blaze_dmg', label: '灼热伤害加成', suffix: '%' },
    { id: 'emag_dmg', label: '电磁伤害加成', suffix: '%' },
    { id: 'cold_dmg', label: '寒冷伤害加成', suffix: '%' },
    { id: 'nature_dmg', label: '自然伤害加成', suffix: '%' },
    { id: 'attack_dmg_bonus', label: '普攻伤害加成', suffix: '%' },
    { id: 'skill_dmg_bonus', label: '战技伤害加成', suffix: '%' },
    { id: 'link_dmg_bonus', label: '连携技伤害加成', suffix: '%' },
    { id: 'ultimate_dmg_bonus', label: '终结技伤害加成', suffix: '%' },
    { id: 'all_skill_dmg_bonus', label: '全技能伤害加成', suffix: '%' },
    { id: 'broken_dmg_bonus', label: '对失衡目标伤害加成', suffix: '%' },
  ]},
]

function calcResistance(x) {
  if (!x || x <= 0) return 0
  return Math.round(x / (x + 1000) * 100)
}

function getStatValue(id) {
  if (id === '_effectiveAtk') return atkBreakdown.value?.final ?? 0
  const cs = configuredStats.value
  if (!cs) return 0
  if (id === '_res_physical') return calcResistance(cs.agility || 0)
  if (id === '_res_blaze' || id === '_res_emag' || id === '_res_cold' || id === '_res_nature')
    return calcResistance(cs.intellect || 0)
  if (id === '_res_beyond') return 0
  return cs[id] ?? 0
}

function formatStatValue(item) {
  const v = getStatValue(item.id)
  return item.suffix ? v + item.suffix : v
}
</script>

<template>
  <div class="sd-overlay">
    <!-- Top bar -->
    <div class="sd-top-bar">
      <div class="sd-top-title">能力值详情</div>
      <div class="sd-top-char" v-if="char">{{ char.name }} · Lv.{{ growth.characterLevel }} · 精英化 {{ growth.promotion }}</div>
      <button class="sd-close-btn" @click="emit('close')">✕ 返回排轴</button>
    </div>

    <!-- Scrollable content -->
    <div class="sd-body">
      <div class="sd-content">

        <template v-for="section in STAT_SECTIONS" :key="section.title">
          <div class="sd-section-title">{{ section.title }}</div>

          <template v-for="item in section.items" :key="item.id">
            <!-- ATK row with expand -->
            <template v-if="item.expandable && item.id === '_effectiveAtk'">
              <div class="sd-stat-row sd-stat-expandable" @click="atkExpanded = !atkExpanded">
                <span class="sd-stat-icon" v-if="item.icon">{{ item.icon }}</span>
                <span class="sd-stat-label">{{ item.label }}</span>
                <span class="sd-stat-value">{{ atkBreakdown?.final ?? 0 }}</span>
                <span class="sd-expand-arrow">{{ atkExpanded ? '▾' : '▸' }}</span>
              </div>

              <div v-if="atkExpanded && atkBreakdown" class="sd-atk-detail">
                <div class="sd-detail-group">
                  <div class="sd-detail-header">
                    <span>基础总值</span>
                    <span class="sd-detail-val">{{ atkBreakdown.baseTotal }}</span>
                  </div>
                  <div class="sd-detail-row">
                    <span>基础攻击力</span>
                    <span class="sd-detail-val">{{ atkBreakdown.baseRawAtk }}</span>
                  </div>
                  <div class="sd-detail-row" style="padding-left:28px;">
                    <span>干员攻击力</span>
                    <span class="sd-detail-val">{{ atkBreakdown.operatorAtk }}</span>
                  </div>
                  <div class="sd-detail-row" v-if="atkBreakdown.weaponAtk" style="padding-left:28px;">
                    <span>武器攻击力</span>
                    <span class="sd-detail-val">{{ atkBreakdown.weaponAtk }}</span>
                  </div>
                  <div class="sd-detail-row" v-if="atkBreakdown.equipAtk" style="padding-left:28px;">
                    <span>装备攻击力</span>
                    <span class="sd-detail-val">{{ atkBreakdown.equipAtk }}</span>
                  </div>
                  <div class="sd-detail-row" v-if="atkBreakdown.atkPercentTotal">
                    <span>百分比加成</span>
                    <span class="sd-detail-val sd-detail-pct">+{{ atkBreakdown.atkPercentTotal.toFixed(1) }}%</span>
                  </div>
                </div>
                <div class="sd-detail-group">
                  <div class="sd-detail-header">
                    <span>能力值加成</span>
                    <span class="sd-detail-val sd-detail-pct">+{{ atkBreakdown.abilityPct.toFixed(1) }}%</span>
                  </div>
                  <div class="sd-detail-row">
                    <span>来自{{ atkBreakdown.primaryLabel }}的攻击加成</span>
                    <span class="sd-detail-val sd-detail-pct">+{{ atkBreakdown.primaryPct.toFixed(1) }}%</span>
                  </div>
                  <div class="sd-detail-row">
                    <span>来自{{ atkBreakdown.secondaryLabel }}的攻击加成</span>
                    <span class="sd-detail-val sd-detail-pct">+{{ atkBreakdown.secondaryPct.toFixed(1) }}%</span>
                  </div>
                </div>
              </div>
            </template>

            <!-- Normal stat row -->
            <div v-else class="sd-stat-row">
              <span class="sd-stat-icon" v-if="item.icon">{{ item.icon }}</span>
              <span class="sd-stat-label">{{ item.label }}</span>
              <span class="sd-stat-value">{{ formatStatValue(item) }}</span>
            </div>
          </template>
        </template>

      </div>
    </div>
  </div>
</template>

<style scoped>
.sd-overlay {
  background: #1e2028; display: flex; flex-direction: column;
  width: 100%; height: 100%; min-height: 0;
}

.sd-top-bar {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 16px; background: rgba(255,255,255,0.03);
  border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0;
}
.sd-top-title { font-size: 14px; font-weight: 700; color: #e2e8f0; }
.sd-top-char { font-size: 11px; color: #999; }
.sd-close-btn {
  margin-left: auto; padding: 4px 12px;
  background: rgba(255,255,255,0.06); border: 1px solid #555;
  color: #ccc; border-radius: 4px; cursor: pointer; font-size: 11px; font-family: inherit;
}
.sd-close-btn:hover { background: rgba(255,255,255,0.12); }

.sd-body { flex: 1; overflow: auto; padding: 16px; }
.sd-content { max-width: 600px; }

.sd-section-title {
  font-size: 11px; font-weight: 700; color: #888;
  text-transform: uppercase; letter-spacing: 1px;
  padding: 12px 0 6px; border-bottom: 1px solid rgba(255,255,255,0.06); margin-bottom: 4px;
}

.sd-stat-row {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 8px; border-bottom: 1px solid rgba(255,255,255,0.03);
}
.sd-stat-expandable { cursor: pointer; }
.sd-stat-expandable:hover { background: rgba(255,255,255,0.04); }
.sd-stat-icon { font-size: 13px; width: 18px; text-align: center; flex-shrink: 0; }
.sd-stat-label { font-size: 13px; color: #ccc; flex: 1; }
.sd-stat-value { font-size: 13px; font-weight: 600; color: #e2e8f0; font-family: 'Roboto Mono', monospace; }
.sd-expand-arrow { font-size: 11px; color: #888; width: 16px; text-align: center; }

/* ATK breakdown */
.sd-atk-detail {
  padding: 4px 0 8px 26px;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}
.sd-detail-group { margin-bottom: 8px; }
.sd-detail-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 4px 8px; font-size: 12px; font-weight: 600; color: #bbb;
  background: rgba(255,255,255,0.02); border-radius: 3px; margin-bottom: 2px;
}
.sd-detail-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 2px 8px 2px 16px; font-size: 11px; color: #999;
}
.sd-detail-val { font-family: 'Roboto Mono', monospace; font-size: 12px; color: #e2e8f0; }
.sd-detail-pct { color: #4ade80; }
</style>
