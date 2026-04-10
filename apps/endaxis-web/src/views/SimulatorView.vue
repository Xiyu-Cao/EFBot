<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { API_BASE } from '@/utils/api.js'

const router = useRouter()

const backendStatus = ref('unknown')
const statusText = ref('检查引擎…')
const characters = ref([])
const selectedCharacterId = ref('')
const loading = ref(false)
const result = ref(null)

const params = ref({
  duration_frames: 3600,
  max_buff_stacks: 10,
})

async function waitForBackend(maxRetries = 15, interval = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${API_BASE}/health`)
      if (res.ok) return true
    } catch { /* sidecar still starting */ }
    await new Promise(r => setTimeout(r, interval))
  }
  return false
}

onMounted(async () => {
  const ready = await waitForBackend()
  if (ready) {
    backendStatus.value = 'online'
    statusText.value = '计算引擎在线'
    await loadCharacters()
  } else {
    backendStatus.value = 'offline'
    statusText.value = '计算引擎离线'
  }
})

async function loadCharacters() {
  const res = await fetch(`${API_BASE}/characters`)
  characters.value = await res.json()
}

async function runSimulation() {
  if (!selectedCharacterId.value) return
  loading.value = true
  result.value = null
  try {
    const res = await fetch(`${API_BASE}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character_id: selectedCharacterId.value,
        ...params.value,
      }),
    })
    result.value = await res.json()
  } catch (e) {
    ElMessage.error('模拟请求失败: ' + e.message)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="simulator-layout">
    <header class="sim-header">
      <div class="sim-header-left">
        <button class="ea-btn ea-btn--ghost sim-back-btn" @click="router.push('/timeline')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          排轴工具
        </button>
        <h1 class="sim-title">EFBot 战斗伤害模拟器</h1>
      </div>
      <span class="sim-status" :class="backendStatus">{{ statusText }}</span>
    </header>

    <main class="sim-main">
      <div class="sim-grid">
        <section class="sim-panel">
          <h2 class="sim-panel-title">角色 / 装备</h2>
          <el-select
            v-model="selectedCharacterId"
            placeholder="-- 选择角色 --"
            size="large"
            style="width: 100%"
          >
            <el-option
              v-for="c in characters"
              :key="c.id"
              :label="c.name"
              :value="c.id"
            />
          </el-select>
        </section>

        <section class="sim-panel">
          <h2 class="sim-panel-title">模拟参数</h2>
          <div class="sim-form-row">
            <label>战斗时长（帧）</label>
            <el-input-number
              v-model="params.duration_frames"
              :min="1"
              :step="600"
              size="large"
              style="width: 100%"
            />
          </div>
          <div class="sim-form-row">
            <label>Buff 叠层上限</label>
            <el-input-number
              v-model="params.max_buff_stacks"
              :min="1"
              :max="30"
              size="large"
              style="width: 100%"
            />
          </div>
          <el-button
            type="primary"
            size="large"
            :loading="loading"
            :disabled="!selectedCharacterId"
            @click="runSimulation"
            style="width: 100%; margin-top: 12px"
          >
            {{ loading ? '计算中…' : '运行 DPS 模拟' }}
          </el-button>
        </section>

        <section class="sim-panel sim-result" v-if="result">
          <h2 class="sim-panel-title">模拟结果</h2>
          <div class="sim-stat">
            <span class="sim-stat-label">平均 DPS</span>
            <span class="sim-stat-value">{{ result.average_dps?.toFixed(2) }}</span>
          </div>
          <div class="sim-stat">
            <span class="sim-stat-label">总伤害</span>
            <span class="sim-stat-value">{{ result.total_damage?.toLocaleString() }}</span>
          </div>
          <div class="sim-stat">
            <span class="sim-stat-label">战斗时长</span>
            <span class="sim-stat-value">{{ result.duration_seconds?.toFixed(2) }}s</span>
          </div>
        </section>

        <section class="sim-panel sim-optimize">
          <h2 class="sim-panel-title">
            AI 最优输出轴
            <span class="sim-badge">即将推出</span>
          </h2>
          <p class="sim-optimize-desc">接入优化模块后，AI 将自动搜索技能释放顺序使 DPS 最大化。</p>
          <el-button size="large" disabled style="width: 100%">启动 AI 寻优</el-button>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.simulator-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #18181c;
  overflow: auto;
}

.sim-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid #2a2a2e;
  flex-shrink: 0;
}

.sim-header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.sim-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid #333;
  color: #888;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}
.sim-back-btn:hover {
  color: #ffd700;
  border-color: #ffd700;
}

.sim-title {
  font-size: 18px;
  font-weight: 600;
  color: #f0f0f0;
  margin: 0;
}

.sim-status {
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 500;
}
.sim-status.online {
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  border: 1px solid rgba(34, 197, 94, 0.3);
}
.sim-status.offline {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.3);
}
.sim-status.unknown {
  background: rgba(107, 114, 128, 0.15);
  color: #6b7280;
  border: 1px solid rgba(107, 114, 128, 0.3);
}

.sim-main {
  flex: 1;
  padding: 24px;
  overflow: auto;
}

.sim-grid {
  max-width: 700px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sim-panel {
  background: #1e1e22;
  border: 1px solid #2a2a2e;
  padding: 20px;
}

.sim-panel-title {
  font-size: 13px;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0 0 16px 0;
}

.sim-form-row {
  margin-bottom: 12px;
}
.sim-form-row label {
  display: block;
  font-size: 13px;
  color: #aaa;
  margin-bottom: 6px;
}

.sim-result .sim-stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid #2a2a2e;
}
.sim-result .sim-stat:last-child {
  border-bottom: none;
}
.sim-stat-label {
  font-size: 14px;
  color: #888;
}
.sim-stat-value {
  font-size: 18px;
  font-weight: 700;
  color: #ffd700;
  font-family: 'Roboto Mono', 'Consolas', monospace;
}

.sim-optimize {
  border-color: rgba(255, 215, 0, 0.15);
}
.sim-optimize .sim-panel-title {
  color: #d4a017;
  display: flex;
  align-items: center;
  gap: 8px;
}
.sim-badge {
  font-size: 10px;
  padding: 2px 6px;
  background: rgba(255, 215, 0, 0.1);
  color: #d4a017;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
}
.sim-optimize-desc {
  font-size: 13px;
  color: #666;
  margin: 0 0 12px;
}
</style>
