<script setup>
import { inject, computed } from 'vue'
import DamageOverview from './DamageOverview.vue'
import CharacterDetailPanel from './CharacterDetailPanel.vue'
import SkillDetailPanel from './SkillDetailPanel.vue'
import BuffDetailPanel from './BuffDetailPanel.vue'

const state = inject('damageCalcState')

const selectedType = computed(() => state.selectedItem.value?.type || null)
</script>

<template>
  <div class="detail-panel">
    <div class="panel-header">
      <span class="panel-title">
        {{ selectedType === 'character' ? '角色属性' :
           selectedType === 'action' ? '技能详情' :
           selectedType === 'buff' ? 'Buff 详情' :
           '伤害总览' }}
      </span>
      <button
        v-if="selectedType"
        class="close-btn"
        @click="state.clearSelection()"
        title="返回总览"
      >&#x2715;</button>
    </div>

    <div class="panel-body">
      <CharacterDetailPanel
        v-if="selectedType === 'character'"
        :track-id="state.selectedItem.value.trackId"
      />
      <SkillDetailPanel
        v-else-if="selectedType === 'action'"
        :action-id="state.selectedItem.value.actionId"
        :actor-id="state.selectedItem.value.actorId"
      />
      <BuffDetailPanel
        v-else-if="selectedType === 'buff'"
        :buff-id="state.selectedItem.value.buffId"
        :start-time="state.selectedItem.value.startTime"
      />
      <DamageOverview v-else />
    </div>
  </div>
</template>

<style scoped>
.detail-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #22242c;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #2a2c34;
  border-bottom: 1px solid #444;
  flex-shrink: 0;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: #e0e0e0;
}

.close-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: #888;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 14px;
}

.close-btn:hover {
  background: #444;
  color: #e0e0e0;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
</style>
