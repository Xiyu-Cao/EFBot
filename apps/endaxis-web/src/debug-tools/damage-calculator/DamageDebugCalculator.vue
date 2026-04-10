<!--
  TEMP DEBUG TOOL — NOT IN PRODUCTION FLOW — SAFE TO DELETE AFTER DAMAGE VALIDATION
  Standalone single-hit damage calculator for manual verification.
-->
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { createDefaultInput, type DamageCalcInput } from './types'
import { calculateDamage } from './calculateDamage'
import { formatBreakdownText } from './formatBreakdown'

// --- Gamedata loading (standalone, no timelineStore dependency) ---
const characters = ref<any[]>([])
const weapons = ref<any[]>([])
const selectedCharId = ref('')
const selectedWeaponId = ref('')
const copyFeedback = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/gamedata.json')
    const data = await res.json()
    characters.value = (data.characterRoster || []).sort((a: any, b: any) => b.rarity - a.rarity)
    weapons.value = data.weaponDatabase || []
  } catch (e) {
    console.error('[DamageDebugCalc] Failed to load gamedata:', e)
  }
})

// --- Input state ---
const input = ref<DamageCalcInput>(createDefaultInput())
const useAttackOverride = ref(false)

// --- Auto-populate from character selection ---
function onCharSelect() {
  const char = characters.value.find((c: any) => c.id === selectedCharId.value)
  if (!char) return
  // gamedata doesn't have base stats per character, but we can note the element
  // Users will fill in ATK manually or from wiki data
}

function onWeaponSelect() {
  const wpn = weapons.value.find((w: any) => w.id === selectedWeaponId.value)
  if (!wpn) return
  if (wpn.passiveStats?.attack) {
    input.value.baseAttack = wpn.passiveStats.attack
  }
}

// --- Calculation ---
const result = computed(() => calculateDamage(input.value))

// --- Copy ---
function copyBreakdown() {
  const text = formatBreakdownText(input.value, result.value)
  navigator.clipboard.writeText(text).then(() => {
    copyFeedback.value = 'Copied!'
    setTimeout(() => { copyFeedback.value = '' }, 1500)
  }).catch(() => {
    copyFeedback.value = 'Failed'
    setTimeout(() => { copyFeedback.value = '' }, 1500)
  })
}

// --- Helpers ---
function n(v: number | string) {
  if (typeof v === 'number') return v.toLocaleString()
  return v
}
</script>

<template>
  <div class="ddc-container">
    <header class="ddc-header">
      <h1>Damage Debug Calculator</h1>
      <span class="ddc-temp-badge">TEMP DEBUG TOOL</span>
      <router-link to="/timeline" class="ddc-back">← Back to Timeline</router-link>
    </header>

    <div class="ddc-grid">
      <!-- ============ PANEL 1: Base Selection ============ -->
      <section class="ddc-panel">
        <h2>1. Base Panel</h2>

        <div class="ddc-row">
          <label>Character</label>
          <select v-model="selectedCharId" @change="onCharSelect">
            <option value="">-- select --</option>
            <option v-for="c in characters" :key="c.id" :value="c.id">
              {{ c.name }} ({{ c.rarity }}★ {{ c.element }})
            </option>
          </select>
        </div>

        <div class="ddc-row">
          <label>Weapon</label>
          <select v-model="selectedWeaponId" @change="onWeaponSelect">
            <option value="">-- select --</option>
            <option v-for="w in weapons" :key="w.id" :value="w.id">
              {{ w.name || w.id }}
            </option>
          </select>
        </div>

        <div class="ddc-divider"></div>

        <div class="ddc-row">
          <label>Base ATK</label>
          <input type="number" v-model.number="input.baseAttack" />
        </div>
        <div class="ddc-row">
          <label>ATK% Bonus</label>
          <input type="number" v-model.number="input.percentAttackBonus" step="0.01" />
          <span class="ddc-hint">decimal (0.15 = 15%)</span>
        </div>
        <div class="ddc-row">
          <label>ATK Flat Bonus</label>
          <input type="number" v-model.number="input.flatAttackBonus" />
        </div>
        <div class="ddc-row">
          <label>Primary Ability</label>
          <input type="number" v-model.number="input.primaryAbility" />
        </div>
        <div class="ddc-row">
          <label>Secondary Ability</label>
          <input type="number" v-model.number="input.secondaryAbility" />
        </div>

        <div class="ddc-divider"></div>

        <div class="ddc-row">
          <label>
            <input type="checkbox" v-model="useAttackOverride" />
            ATK Override
          </label>
          <input type="number" v-model.number="input.attackOverride"
                 :disabled="!useAttackOverride"
                 :class="{ 'ddc-disabled': !useAttackOverride }" />
          <span class="ddc-hint">skip formula, use this ATK directly</span>
        </div>

        <div class="ddc-panel-result">
          Used ATK: <strong>{{ result.usedAttack }}</strong>
        </div>
      </section>

      <!-- ============ PANEL 2: Hit & Zones ============ -->
      <section class="ddc-panel">
        <h2>2. Hit & Multiplier Zones</h2>

        <div class="ddc-row">
          <label>Skill Multiplier</label>
          <input type="number" v-model.number="input.skillMultiplier" step="0.01" />
          <span class="ddc-hint">{{ (input.skillMultiplier * 100).toFixed(0) }}%</span>
        </div>
        <div class="ddc-row">
          <label>Hit Note</label>
          <input type="text" v-model="input.hitNote" placeholder="e.g. 管理员战技 M3" />
        </div>
        <div class="ddc-row">
          <label>Hit Count</label>
          <input type="number" v-model.number="input.hitCount" min="1" />
        </div>

        <div class="ddc-divider"></div>

        <div class="ddc-row">
          <label>
            <input type="checkbox" v-model="input.isCrit" />
            Force Crit
          </label>
        </div>
        <div class="ddc-row">
          <label>Crit Rate (%)</label>
          <input type="number" v-model.number="input.critRate" step="0.1" />
        </div>
        <div class="ddc-row">
          <label>Crit DMG (%)</label>
          <input type="number" v-model.number="input.critDmg" step="0.1" />
          <span class="ddc-hint">+{{ input.critDmg }}% → {{ (1 + input.critDmg/100).toFixed(2) }}x</span>
        </div>

        <div class="ddc-divider"></div>
        <p class="ddc-zone-note">All zones are final multipliers. Input what you want multiplied. No auto +1.</p>

        <div class="ddc-row">
          <label>Defense Zone</label>
          <input type="number" v-model.number="input.defenseZone" step="0.01" />
          <span class="ddc-hint">default 0.5</span>
        </div>
        <div class="ddc-row">
          <label>Damage Bonus Zone</label>
          <input type="number" v-model.number="input.damageBonusZone" step="0.01" />
        </div>
        <div class="ddc-row">
          <label>Amplification Zone</label>
          <input type="number" v-model.number="input.amplificationZone" step="0.01" />
        </div>
        <div class="ddc-row">
          <label>Vulnerability Zone</label>
          <input type="number" v-model.number="input.vulnerabilityZone" step="0.01" />
        </div>
        <div class="ddc-row">
          <label>Resistance Zone</label>
          <input type="number" v-model.number="input.resistanceZone" step="0.01" />
        </div>
        <div class="ddc-row">
          <label>Break Zone</label>
          <input type="number" v-model.number="input.breakZone" step="0.01" />
        </div>
        <div class="ddc-row">
          <label>Other Zone</label>
          <input type="number" v-model.number="input.otherZone" step="0.01" />
        </div>
      </section>

      <!-- ============ PANEL 3: Results ============ -->
      <section class="ddc-panel ddc-results">
        <h2>3. Results</h2>

        <div class="ddc-result-grid">
          <div class="ddc-result-card">
            <div class="ddc-result-label">Non-Crit</div>
            <div class="ddc-result-value">{{ n(result.nonCritDamage) }}</div>
          </div>
          <div class="ddc-result-card ddc-crit">
            <div class="ddc-result-label">Crit ({{ result.critMultiplier.toFixed(2) }}x)</div>
            <div class="ddc-result-value">{{ n(result.critDamage) }}</div>
          </div>
          <div class="ddc-result-card ddc-expected">
            <div class="ddc-result-label">Expected ({{ input.critRate }}% CR)</div>
            <div class="ddc-result-value">{{ n(Math.round(result.expectedDamage)) }}</div>
          </div>
          <div v-if="input.hitCount > 1" class="ddc-result-card ddc-total">
            <div class="ddc-result-label">Total ({{ input.hitCount }} hits)</div>
            <div class="ddc-result-value">{{ n(Math.round(result.totalDamage)) }}</div>
          </div>
        </div>

        <div class="ddc-divider"></div>

        <h2>4. Breakdown</h2>
        <div class="ddc-breakdown">
          <div v-for="(step, i) in result.breakdown" :key="i" class="ddc-step"
               :class="{ 'ddc-step-sep': String(step.value) === '' }">
            <span class="ddc-step-label">{{ step.label }}</span>
            <span class="ddc-step-value">{{ typeof step.value === 'number' ? n(step.value) : step.value }}</span>
            <span v-if="step.formula" class="ddc-step-formula">{{ step.formula }}</span>
          </div>
        </div>

        <button class="ddc-copy-btn" @click="copyBreakdown">
          {{ copyFeedback || '📋 Copy Breakdown' }}
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.ddc-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 16px;
  font-family: 'Roboto Mono', 'Consolas', monospace;
  font-size: 13px;
  color: #ddd;
  background: #111;
  min-height: 100vh;
}
.ddc-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  border-bottom: 1px solid #333;
  padding-bottom: 8px;
}
.ddc-header h1 { font-size: 18px; margin: 0; color: #fff; }
.ddc-temp-badge {
  font-size: 9px;
  padding: 2px 6px;
  border-radius: 3px;
  background: #ff4d4f;
  color: #fff;
  font-weight: 700;
}
.ddc-back {
  margin-left: auto;
  color: #8bb4e0;
  text-decoration: none;
  font-size: 12px;
}

.ddc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
  align-items: start;
}

.ddc-panel {
  background: #1a1a2e;
  border: 1px solid #333;
  border-radius: 6px;
  padding: 12px;
}
.ddc-panel h2 {
  font-size: 13px;
  color: #aaa;
  margin: 0 0 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.ddc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.ddc-row label {
  min-width: 130px;
  color: #999;
  font-size: 12px;
  flex-shrink: 0;
}
.ddc-row input[type="number"],
.ddc-row input[type="text"],
.ddc-row select {
  background: #222;
  border: 1px solid #444;
  color: #fff;
  padding: 3px 6px;
  border-radius: 3px;
  font-family: inherit;
  font-size: 12px;
  width: 100px;
}
.ddc-row select { width: 200px; }
.ddc-row input[type="checkbox"] { width: auto; margin-right: 4px; }
.ddc-hint { color: #666; font-size: 10px; }
.ddc-disabled { opacity: 0.3; }

.ddc-divider {
  border-top: 1px solid #333;
  margin: 10px 0;
}

.ddc-zone-note {
  color: #666;
  font-size: 10px;
  margin: 0 0 8px;
  font-style: italic;
}

.ddc-panel-result {
  background: #222;
  padding: 6px 10px;
  border-radius: 4px;
  margin-top: 8px;
  color: #8bb4e0;
}

/* Results */
.ddc-result-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.ddc-result-card {
  background: #222;
  border-radius: 4px;
  padding: 8px;
  text-align: center;
}
.ddc-result-label { font-size: 10px; color: #888; margin-bottom: 2px; }
.ddc-result-value { font-size: 20px; font-weight: 700; color: #fff; }
.ddc-crit .ddc-result-value { color: #ff6b6b; }
.ddc-expected .ddc-result-value { color: #ffd700; }
.ddc-total .ddc-result-value { color: #69db7c; }

/* Breakdown */
.ddc-breakdown {
  background: #181828;
  border-radius: 4px;
  padding: 8px;
  max-height: 400px;
  overflow-y: auto;
}
.ddc-step {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 0;
  border-bottom: 1px solid #222;
}
.ddc-step-sep { border-bottom: 1px solid #444; margin: 4px 0; }
.ddc-step-label { color: #999; min-width: 170px; flex-shrink: 0; }
.ddc-step-value { color: #fff; font-weight: 600; min-width: 80px; }
.ddc-step-formula { color: #555; font-size: 11px; }

.ddc-copy-btn {
  margin-top: 10px;
  width: 100%;
  padding: 6px;
  background: #333;
  border: 1px solid #555;
  color: #ccc;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
}
.ddc-copy-btn:hover { background: #444; color: #fff; }
</style>
