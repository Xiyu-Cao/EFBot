<template>
  <div class="app">
    <header>
      <h1>EFBot 战斗伤害模拟器</h1>
      <span class="status" :class="backendStatus">{{ statusText }}</span>
    </header>

    <main>
      <!-- ── 角色选择 ── -->
      <section class="panel">
        <h2>角色 / 装备</h2>
        <select v-model="selectedCharacter">
          <option value="">-- 选择角色 --</option>
          <option v-for="c in characters" :key="c.id" :value="c">
            {{ c.name }}
          </option>
        </select>
      </section>

      <!-- ── 技能时间轴参数 ── -->
      <section class="panel">
        <h2>模拟参数</h2>
        <label>
          战斗时长（帧）
          <input v-model.number="params.duration_frames" type="number" min="1" />
        </label>
        <label>
          Buff 叠层上限
          <input v-model.number="params.max_buff_stacks" type="number" min="1" max="30" />
        </label>
        <button @click="runSimulation" :disabled="!selectedCharacter || loading">
          {{ loading ? "计算中…" : "运行 DPS 模拟" }}
        </button>
      </section>

      <!-- ── 结果面板 ── -->
      <section class="panel result" v-if="result">
        <h2>模拟结果</h2>
        <p>平均 DPS：<strong>{{ result.average_dps?.toFixed(2) }}</strong></p>
        <p>总伤害：<strong>{{ result.total_damage?.toLocaleString() }}</strong></p>
        <p>战斗时长：<strong>{{ result.duration_seconds?.toFixed(2) }}s</strong></p>
      </section>

      <!-- ── AI 寻优（预留入口）── -->
      <section class="panel optimize">
        <h2>AI 最优输出轴 <span class="badge">即将推出</span></h2>
        <p>接入优化模块后，AI 将自动搜索技能释放顺序使 DPS 最大化。</p>
        <button disabled>启动 AI 寻优</button>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";

const backendStatus = ref("unknown");
const statusText = ref("检查后端…");
const characters = ref([]);
const selectedCharacter = ref("");
const loading = ref(false);
const result = ref(null);

const params = ref({
  duration_frames: 3600,
  max_buff_stacks: 10,
});

const API = "/api"; // proxied to http://localhost:8000 via vite

onMounted(async () => {
  try {
    const res = await fetch(`${API}/health`);
    if (res.ok) {
      backendStatus.value = "online";
      statusText.value = "后端在线";
      await loadCharacters();
    }
  } catch {
    backendStatus.value = "offline";
    statusText.value = "后端离线";
  }
});

async function loadCharacters() {
  const res = await fetch(`${API}/characters`);
  characters.value = await res.json();
}

async function runSimulation() {
  if (!selectedCharacter.value) return;
  loading.value = true;
  result.value = null;
  try {
    const res = await fetch(`${API}/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        character_id: selectedCharacter.value.id,
        ...params.value,
      }),
    });
    result.value = await res.json();
  } finally {
    loading.value = false;
  }
}
</script>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0d1117; color: #e6edf3; font-family: system-ui, sans-serif; }

.app { max-width: 900px; margin: 0 auto; padding: 2rem; }

header {
  display: flex; align-items: center; gap: 1rem;
  padding-bottom: 1.5rem; border-bottom: 1px solid #30363d;
}
h1 { font-size: 1.5rem; }
h2 { font-size: 1rem; color: #8b949e; margin-bottom: 1rem; }

.status {
  padding: .25rem .75rem; border-radius: 999px; font-size: .8rem;
}
.online  { background: #1f6feb; }
.offline { background: #da3633; }
.unknown { background: #6e7681; }

main { display: grid; gap: 1rem; margin-top: 1.5rem; }

.panel {
  background: #161b22; border: 1px solid #30363d;
  border-radius: 8px; padding: 1.25rem;
}

select, input {
  width: 100%; padding: .5rem; margin-top: .25rem;
  background: #0d1117; border: 1px solid #30363d;
  border-radius: 6px; color: #e6edf3;
}

label { display: block; margin-bottom: .75rem; font-size: .9rem; }

button {
  margin-top: .5rem; padding: .6rem 1.25rem;
  background: #1f6feb; color: #fff; border: none;
  border-radius: 6px; cursor: pointer; font-size: .9rem;
}
button:disabled { opacity: .4; cursor: not-allowed; }

.result strong { color: #58a6ff; }
.result p { margin-bottom: .5rem; }

.optimize { border-color: #3d2b1f; }
.optimize h2 { color: #d29922; }
.optimize p  { font-size: .875rem; color: #8b949e; margin-bottom: .75rem; }
.badge {
  font-size: .65rem; padding: .1rem .4rem;
  background: #3d2b1f; color: #d29922;
  border-radius: 4px; vertical-align: middle;
}
</style>
