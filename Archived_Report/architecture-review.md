# EFBot 架构审查报告

> 生成日期：2026-03-24
> 目的：为排轴器升级为完整战斗模拟器提供重构决策依据
> 说明：本报告为只读分析，未修改任何代码

---

# 1. 项目目录结构

## 1.1 树状结构

```
E:\EFBot\                                   ← 仓库根（monorepo）
├── apps/
│   ├── endaxis-web/                        ← 主应用（Vue 3 + Vite）
│   │   ├── public/
│   │   │   └── gamedata.json               ★ 全角色技能数据（507KB）
│   │   └── src/
│   │       ├── api/
│   │       │   ├── fetchStrategy.js         数据加载策略
│   │       │   └── saveStrategy.js          项目保存策略
│   │       ├── components/                  Vue UI 组件
│   │       │   ├── ActionItem.vue           ★ 时间轴技能块编辑组件
│   │       │   ├── ActionLibrary.vue        技能库面板
│   │       │   ├── TimelineGrid.vue         ★ 时间轴网格（核心 UI）
│   │       │   ├── PropertiesPanel.vue      属性编辑面板
│   │       │   ├── DamageSummaryPanel.vue   伤害统计展示
│   │       │   ├── ResourceMonitor.vue      SP/体力资源监控
│   │       │   ├── ActionConnector.vue      连接线 UI
│   │       │   ├── ActionLinkPorts.vue      连接端口
│   │       │   ├── ConnectionPath.vue       SVG 连线
│   │       │   ├── ConnectionPreview.vue    拖拽预览
│   │       │   ├── ContextMenu.vue          右键菜单
│   │       │   ├── CustomNumberInput.vue    数字输入
│   │       │   └── GaugeOverlay.vue         能量槽覆盖层
│   │       ├── stores/
│   │       │   └── timelineStore.js         ★★ 核心 Pinia Store（6317 行）
│   │       ├── simulation/                  ★★ 战斗模拟引擎（全 TypeScript）
│   │       │   ├── compiler/
│   │       │   │   ├── compileScenario.ts   ★ 场景编译入口
│   │       │   │   ├── compileTimeline.ts   ★ 时间轴编译核心
│   │       │   │   ├── timeContext.ts       时间冻结映射
│   │       │   │   ├── types.ts             ★ 全部核心类型定义
│   │       │   │   ├── fixture/             测试用例数据
│   │       │   │   ├── compileScenario.test.ts
│   │       │   │   ├── compileTimeline.test.ts
│   │       │   │   └── timeContext.test.ts
│   │       │   ├── engine/
│   │       │   │   ├── SimulationEngine.ts  ★ 事件循环引擎
│   │       │   │   ├── createEngine.ts      引擎工厂
│   │       │   │   ├── PriorityQueue.ts     时间优先级事件队列
│   │       │   │   └── SimulationContext.ts 事件上下文
│   │       │   ├── events/
│   │       │   │   ├── event.types.ts       ★ SimEvent / SimLogEntry 类型
│   │       │   │   ├── EventHandler.ts      Handler 接口
│   │       │   │   ├── ActionStartHandler.ts SP 冻结/消耗
│   │       │   │   ├── ActionEndHandler.ts
│   │       │   │   ├── DamageHandler.ts     ★ 伤害处理（⚠ TODO 未完成）
│   │       │   │   ├── EffectStartHandler.ts ★ 异常触发 + 反应链
│   │       │   │   ├── EffectEndHandler.ts
│   │       │   │   ├── StaggerChangeHandler.ts 失衡计算
│   │       │   │   ├── SpChangeHandler.ts
│   │       │   │   └── SpRegenPauseHandler.ts
│   │       │   ├── state/
│   │       │   │   ├── types.ts             ★ ActorSnapshot/TeamConfig/EnemyConfig
│   │       │   │   ├── GameState.ts         ★ 全局战斗状态
│   │       │   │   ├── TeamState.ts         SP 管理
│   │       │   │   ├── EnemyState.ts        失衡/破防状态
│   │       │   │   ├── ActorState.ts        单角色状态（未充分使用）
│   │       │   │   ├── BaseGameState.ts     接口基类
│   │       │   │   ├── EffectManager.ts     ★ 效果堆叠/查询管理
│   │       │   │   └── EffectManager.test.ts
│   │       │   ├── effects/
│   │       │   │   ├── types.ts             ★ EffectTag / Effect 类 / EffectTrigger
│   │       │   │   ├── afflictionEffectMap.ts 预制效果实例映射表
│   │       │   │   └── scenarioAdapter.ts   ★ 异常类型字符串 → EffectTag 映射
│   │       │   ├── mechanics/
│   │       │   │   ├── reactions.ts         ★ 物理/元素反应矩阵
│   │       │   │   └── reactions.test.ts
│   │       │   ├── calculation/
│   │       │   │   ├── CalculationPipeline.ts ★ 修饰符管道（伤害/失衡计算架构）
│   │       │   │   └── type.ts              计算上下文接口
│   │       │   ├── projection/
│   │       │   │   ├── projectSpSeries.ts   SP 折线图投影
│   │       │   │   └── projectStaggerSeries.ts 失衡折线图投影
│   │       │   ├── fixture/
│   │       │   │   └── simulator.fixture.ts 模拟器测试数据
│   │       │   ├── simulator.ts             ★ 模拟器入口（编译→事件入队→run）
│   │       │   ├── simulator.test.ts
│   │       │   └── formatSimLogEntry.ts     日志格式化
│   │       ├── views/
│   │       │   ├── TimelineEditor.vue       ★ 主编辑页面
│   │       │   ├── DataEditor.vue           角色/武器/装备数据编辑（183KB）
│   │       │   ├── SimulatorView.vue        模拟结果展示
│   │       │   ├── TimelineEntry.vue
│   │       │   └── MobileTimelineViewer.vue
│   │       ├── utils/
│   │       │   ├── anomalyCalc.js           ★ 异常伤害公式（源石技艺伤害计算）
│   │       │   ├── coreStats.js             核心属性定义 + 默认值
│   │       │   ├── precision.js             时间精度工具
│   │       │   ├── assert.ts
│   │       │   └── gzipUtils.js
│   │       ├── composables/
│   │       │   ├── useDragConnection.js     拖拽连接逻辑
│   │       │   └── useShareProject.js       项目分享
│   │       ├── router/index.js
│   │       └── i18n/                        多语言
│   ├── tauri-ui/                            Tauri 跨平台包装
│   └── python-app/                          Python 辅助服务
└── docker-compose.yml
```

## 1.2 重点文件列表

| 文件路径 | 作用 |
|---|---|
| `public/gamedata.json` | 所有角色的技能完整数据，包括 duration/spCost/damageTicks/anomalies，是数据驱动的核心 |
| `src/stores/timelineStore.js` | **6317 行的巨型 Pinia Store**，负责时间轴状态、编辑历史、序列化/反序列化、compile + simulate 的调用入口，以及若干特殊武器逻辑（LAEVATAIN 等） |
| `src/simulation/compiler/types.ts` | 定义整个系统最核心的数据类型：`Action`、`ResolvedAction`、`ResolvedEffect`、`ResolvedTimeline`、`ScenarioData` 等 |
| `src/simulation/compiler/compileTimeline.ts` | 时间轴编译核心：把游戏时间（用户放置位置）转换成考虑冻结后的真实时间，解析每个技能的 damageTick 和 effect |
| `src/simulation/compiler/compileScenario.ts` | 编译入口：normalize 轨道数据 → compileTimeline → 返回 `CompiledScenario` |
| `src/simulation/simulator.ts` | 把 `ResolvedTimeline` 转为事件队列并调用 engine.run()，**是连接 compiler 和 engine 的桥梁** |
| `src/simulation/engine/SimulationEngine.ts` | 事件循环核心，按时间优先级处理所有 SimEvent |
| `src/simulation/events/event.types.ts` | 定义 8 种事件类型（ACTION_START/END/DAMAGE_TICK/EFFECT_START/END/SP_CHANGE/STAGGER_CHANGE/SP_REGEN_PAUSE）及 SimLogEntry |
| `src/simulation/events/DamageHandler.ts` | **⚠ 伤害处理器：`damage` 字段直接传 0，`// TODO: 伤害计算` 至今未实现** |
| `src/simulation/state/EffectManager.ts` | 效果管理器：add/remove/hasTag/getByTag，支持堆叠（REFRESH_DURATION / INDEPENDENT / ADD_DURATION） |
| `src/simulation/effects/types.ts` | `Effect` 类定义，包含 tags/duration/maxStacks/stackStrategy/triggers，以及所有元素和物理异常的静态工厂方法 |
| `src/simulation/mechanics/reactions.ts` | 元素反应矩阵（4×4）+ 物理异常反应链，是反应系统的核心逻辑 |
| `src/simulation/effects/scenarioAdapter.ts` | **关键映射层**：将 gamedata 里的字符串类型（如 `"armor_break"`）映射到内部 EffectTag（如 `"PHYSICAL_BREACH"`） |
| `src/simulation/calculation/CalculationPipeline.ts` | 修饰符管道架构，目前仅实现了 `OriginiumArtsModifier`（击飞/倒地时的失衡加成），伤害管道尚未构建 |
| `src/utils/anomalyCalc.js` | 源石技艺伤害公式库（燃烧 DOT、爆发、冻结消耗等），目前只被 Store 引用用于展示，未接入引擎 |

**关于新旧代码区分：**

- **原项目已有**：`components/` 下的 UI 组件、`stores/timelineStore.js` 的大部分轨道编辑逻辑、`views/TimelineEditor.vue`
- **二开新增**：整个 `src/simulation/` 目录（全 TypeScript，有单测，架构清晰，明显是重新设计的）、`utils/anomalyCalc.js`、`utils/coreStats.js`
- **重度修改**：`timelineStore.js` 末段新增了 `compileScenario` 和 `simulate` 的调用，以及 `ULTIMATE_ENHANCEMENT_EXTENDERS` / `LAEVATAIN` 特殊武器逻辑

---

# 2. 技能数据定义

## 2.1 技能系统组织方式总结

技能数据**集中存放在 `public/gamedata.json`**，每个角色是一个对象，包含普攻（attack_segments）、战技（skill_*）、连携（link_*）、终结技（ultimate_*）四类技能的完整字段。**这是纯数据层**，不含任何逻辑代码。

数据从 `gamedata.json` 被 `timelineStore.js` 加载后，经用户在 `TimelineEditor` 中操作，转为 `Action` 对象挂在 `ScenarioTrack.actions[]` 上。技能效果触发后进入 `simulation/` 中用代码处理。

整体判断：**95% 纯数据驱动，5% 代码硬编码**（如 SP 冻结时长 0.5s/1.5s、`LAEVATAIN` 武器的特殊时间扩展逻辑）。

## 2.2 关键文件

1. `public/gamedata.json` — 所有技能的原始数据
2. `src/simulation/compiler/types.ts` — `Action` 接口（技能在系统内的标准表示）
3. `src/simulation/effects/types.ts` — `Effect` 类（buff/debuff 数据结构）
4. `src/simulation/effects/scenarioAdapter.ts` — 数据层到引擎层的类型映射
5. `src/utils/anomalyCalc.js` — 异常伤害的计算公式（目前未接入引擎）

## 2.3 关键代码片段

### `compiler/types.ts` — Action 接口（技能在系统内的标准表示）

```typescript
// src/simulation/compiler/types.ts:154-183
export interface Action {
  id: string;
  instanceId: string;
  type: ActionType;           // "execution" | "skill" | "link" | "ultimate" | "attack"
  name: string;
  startTime: number;
  logicalStartTime: number;
  cooldown: number;
  spCost: number;
  spGain?: number;
  element: string;
  librarySource?: string;
  icon?: string;
  gaugeCost: number;
  gaugeGain: number;
  teamGaugeGain: number;
  enhancementTime?: number;
  duration: number;
  triggerWindow?: number;
  animationTime?: number;
  isDisabled?: boolean;
  weaponId?: string | null;
  sourceWeaponId?: string | null;
  allowedTypes: string[];
  damageTicks: DamageTick[];        // 伤害段：offset/sp/stagger/multiplier
  physicalAnomaly: Anomaly[][];     // 2D 数组：rows×cols 的效果矩阵
  isLocked?: boolean;
  customBars?: any[];
  customColor?: string | null;
}

export interface DamageTick {
  offset: number;           // 相对技能开始时间的偏移（秒）
  sp: number;               // 该 tick 恢复的 SP
  stagger: number;          // 失衡值
  boundEffects?: string[];  // 绑定的 effect _id（同时触发）
  multiplier?: number;      // 伤害倍率（0 或缺省=无伤害数据）
}

export interface Anomaly {
  _id: string;
  offset: number;
  duration: number;
  type: string;       // 对应 scenarioAdapter 里的 key，如 "armor_break"
  sp?: number;
  stagger?: number;
  stacks: number | string;
}
```

### `effects/scenarioAdapter.ts` — 数据类型到引擎 EffectTag 的映射

```typescript
// src/simulation/effects/scenarioAdapter.ts
export const SCNEARIO_EFFECT_TYPE_MAP = {
  armor_break:   "PHYSICAL_BREACH",
  stagger:       "PHYSICAL_CRUSH",
  knockdown:     "PHYSICAL_KNOCK_DOWN",
  knockup:       "PHYSICAL_LIFT",
  blaze_attach:  "ELEMENT_HEAT",
  emag_attach:   "ELEMENT_ELECTRIC",
  cold_attach:   "ELEMENT_CRYO",
  nature_attach: "ELEMENT_NATURE",
} satisfies Record<string, EffectTag>;
```

> ⚠ **关键漏洞**：`gamedata.json` 中有些技能的 `type` 字段（如 `"pograni_buff"`）**不在这个映射表里**，会被 `simulator.ts` 中的 `if (!tag) return` 静默跳过，不进入模拟引擎。

### `simulator.ts` — 模拟入口（编译结果 → 事件队列）

```typescript
// src/simulation/simulator.ts
export function simulate(timeline, teamConfig, enemyConfig, actors) {
  const engine = createEngine(teamConfig, enemyConfig, actors, timeline);

  timeline.actions.forEach((action) => {
    engine.enqueue({ type: "ACTION_START", time: action.realStartTime, payload: { ... } });
    engine.enqueue({ type: "ACTION_END",   time: action.realStartTime + action.realDuration, payload: { ... } });

    action.resolvedDamageTicks.forEach((tick) => {
      engine.enqueue({
        type: "DAMAGE_TICK",
        time: tick.realTime,
        payload: { damage: 0, ... },  // ← 硬编码为 0
      });
    });

    action.effects.forEach((resolvedEffect) => {
      const tag = SCNEARIO_EFFECT_TYPE_MAP[resolvedEffect.node.type];
      if (!tag) return;  // 未知类型静默跳过
      engine.enqueue({ type: "EFFECT_START", time: ..., payload: { effect: AfflictionEffectMap[tag].snapshot() } });
    });
  });

  return { state: engine.run(), simLog: engine.getSimLog() };
}
```

## 2.4 结构判断

**不适合继续扩展，应该局部重构。** 具体问题：

1. `DamageTick.multiplier` 字段已经在类型定义里，但 `simulator.ts` 里把 `damage` 硬编码为 `0` 传给引擎，伤害公式根本没有被接入
2. `scenarioAdapter.ts` 的映射表只有 8 个条目，大量自定义 buff 类型（如角色专属 buff）会被静默忽略，无错误提示
3. `physicalAnomaly` 命名是历史遗留，实际包含元素异常，字段语义不准确
4. `Action` 接口里有 3 个 `@deprecated` 字段没有清理（`gaugeEfficiency`/`originiumArtsPower`/`linkCdReduction` 在 `ScenarioTrack` 上）

---

# 3. 时间轴 / Buff / 状态 / Simulation 核心

## 3.1 模块关系

```
用户操作
    ↓
timelineStore.js (Pinia)          ← 所有 UI 状态 + 数据状态混在一起（6317 行）
    │  tracks / connections / weaponStatuses / characterOverrides
    │  historyStack（Undo/Redo）
    │  selectedActionId / multiSelectedIds / clipboard
    │
    ↓ 调用
compileScenario()                 ← src/simulation/compiler/compileScenario.ts
    │  normalize tracks → ActionNode[]
    │  DEFAULT_SYSTEM_CONSTANTS（maxSp=300, spRegenRate=8, ...）
    ↓
compileTimeline()                 ← src/simulation/compiler/compileTimeline.ts
    │  calculateTimeShifts()      → 计算连携/终结技的冻结偏移
    │  resolveAction()            → 算出每个技能的 realStartTime/realDuration
    │  resolveConsumption()       → 处理 buff 消耗连线
    ↓
ResolvedTimeline                  ← 编译结果（actions / actionMap / effectMap / timeContext）
    ↓
simulate()                        ← src/simulation/simulator.ts
    │  把 ResolvedTimeline → 事件队列
    ↓
createEngine()                    ← src/simulation/engine/createEngine.ts
    │  注册 8 个 EventHandler
    ↓
engine.run()                      ← SimulationEngine（事件循环）
    │  PriorityQueue 按时间出队
    │  state.advanceTime(dt)      ← GameState（team SP + enemy 失衡 + actor）
    │  handler.handle(event, ctx)
    ↓
SimLogEntry[]                     ← 结果日志，传回 timelineStore，触发 UI 更新
```

## 3.2 关键文件列表

| 文件 | 职责 |
|---|---|
| `stores/timelineStore.js` (6317L) | **所有时间轴编辑状态 + 调用 compile/simulate 的入口**，UI 状态与战斗数据严重耦合 |
| `simulation/compiler/types.ts` | `Action` / `ResolvedAction` / `ResolvedTimeline` / `ScenarioData` 等核心类型，是整个系统的类型契约 |
| `simulation/compiler/compileTimeline.ts` | 时间冻结偏移计算（`calculateTimeShifts`）+ 真实时间解析（`resolveAction`）+ 消耗连线处理（`resolveConsumption`） |
| `simulation/simulator.ts` | 把编译结果翻译成事件队列，是 compiler ↔ engine 的桥接层（⚠ 伤害数值硬编码为 0） |
| `simulation/engine/SimulationEngine.ts` | 事件循环：PriorityQueue 按时间出队 → handler 处理 → state 推进 |
| `simulation/state/GameState.ts` | 战斗全局状态：`TeamState`（SP）+ `EnemyState`（失衡）+ `Map<id, ActorState>` |
| `simulation/state/EffectManager.ts` | 效果管理器：add/remove/hasTag，支持 `REFRESH_DURATION` 堆叠策略 |
| `simulation/mechanics/reactions.ts` | 元素反应矩阵（4×4）+ 物理异常反应链（`ReactionRegistry.check()`） |
| `simulation/calculation/CalculationPipeline.ts` | 修饰符管道架构（目前仅 `OriginiumArtsModifier` 一个修饰符，伤害管道空白） |

## 3.3 关键数据结构

### `ResolvedAction`（编译后的技能块）

```typescript
// src/simulation/compiler/types.ts:213-228
export interface ResolvedAction extends ActionNode {
  startTime: number;           // 游戏逻辑时间（用户放置位置）
  realStartTime: number;       // 真实物理时间（考虑冻结偏移后）
  duration: number;            // 游戏逻辑持续时间
  realDuration: number;        // 真实持续时间（含冻结延长）
  isInterrupted: boolean;
  effects: ResolvedEffect[];
  resolvedDamageTicks: ResolvedDamageTick[];
  triggerWindow: { hasWindow: boolean; startTime: number; duration: number };
  extensionAmount: number;     // 因冻结产生的延长量
  freezeDuration?: number;     // 该技能本身产生的冻结时长
}
```

### `EffectManager`（效果堆叠逻辑）

```typescript
// src/simulation/state/EffectManager.ts
private handleStacking(existing: Effect, incoming: Effect): Effect {
  if (existing.currentStacks < existing.maxStacks) {
    existing.currentStacks = Math.min(
      existing.maxStacks,
      existing.currentStacks + incoming.currentStacks
    );
  }
  if (existing.stackStrategy === "REFRESH_DURATION") {
    existing.startTime = incoming.startTime; // 刷新持续时间
  }
  return existing;
}
```

### `ActorSnapshot`（单角色状态快照）

```typescript
// src/simulation/state/types.ts
export interface ActorSnapshot {
  id: string;
  stats: ActorStats;
  resources: { hp: number; gauge: number };
  cooldowns: Map<string, number>;          // ⚠ 从未被写入/读取
  activeBuffs: Map<string, ResolvedEffect>; // ⚠ 从未被写入，是空 Map
  activeAction?: ResolvedAction;            // ⚠ 从未被设置
}
```

> ⚠ `ActorState` 中的 `cooldowns`、`activeBuffs`、`activeAction` 在 `processActors` 中被初始化为空，在整个引擎执行过程中没有任何 handler 写入这些字段。角色自身的 buff 是死字段。

## 3.4 最值得重构的 3 个位置

### 位置 1：`stores/timelineStore.js`（6317 行）— UI 状态与战斗数据混在一起

该文件同时承担了"UI 交互状态（selected、clipboard、历史堆栈）"、"项目数据（tracks、connections）"、"编译调用"、"模拟调用"、"特殊武器逻辑（LAEVATAIN enhancer）"五种职责。任何一个维度的改动都需要在这个巨型文件里操作，极难维护。特殊武器逻辑（`ULTIMATE_ENHANCEMENT_EXTENDERS`）本不该在 UI store 里。

### 位置 2：`simulation/simulator.ts` 中的 `damage: 0` 和 `scenarioAdapter` 的静默跳过

- `damage: 0` 意味着当前 `DamageHandler` 完全没有实际伤害计算，只做了日志记录和转发 STAGGER/SP 事件
- `SCNEARIO_EFFECT_TYPE_MAP` 只有 8 个条目，gamedata 中存在的自定义 buff 类型（如角色专属 buff）全部静默忽略，不报错也不进引擎
- 如果要支持"自动触发装备/天赋"，这里是扩展最困难的地方

### 位置 3：`ActorState` 的 `cooldowns`/`activeBuffs`/`activeAction` — 架构声明了但未实现

类型定义里这三个字段暗示"引擎会追踪角色 CD 和主动 buff"，但在整个 simulation 流程中，这些字段从不被写入。这意味着"释放合法性校验（CD 检查）"完全缺失，角色自身 buff（而非 boss 异常状态）也完全无法追踪。

## 3.5 架构判断

**可以保留的部分：**
- 整个 `simulation/` 目录的架构设计——事件驱动 + 编译器模式 + 类型完善，是本项目最有价值的部分
- `EffectManager` + `ReactionRegistry` + `CalculationPipeline` 的组合，扩展性很好
- `compileTimeline` 的时间冻结处理逻辑（有完整单测）

**应该抽成 headless core 的部分：**
- `simulation/` 整体已经基本独立，只需要把 `timelineStore.js` 中的 `ULTIMATE_ENHANCEMENT_EXTENDERS` / `createOwnSkillLinkEnhancer` 迁移进 `simulation/compiler/` 里
- 伤害计算公式（`anomalyCalc.js`）应该接入 `CalculationPipeline`，成为引擎的一部分而非只被 UI store 调用

**不适合继续堆功能的部分：**
- `timelineStore.js` 目前的结构——任何新的游戏机制（合法性校验、被动触发）都不该再往这里加

---

# 4. 一个最复杂技能的完整实现路径

## 4.1 技能选择

选择 **LAEVATAIN 角色的终结技**，原因：
1. 有特殊时间扩展机制（终结技持续时间随轨道内其他技能动态递推）
2. 有 `animationTime` 控制冻结时长
3. 走完了从 gamedata → store 特殊处理 → compileTimeline → simulate → engine 的完整链路
4. `ULTIMATE_ENHANCEMENT_EXTENDERS` 只有 LAEVATAIN 一个条目，是全项目唯一的武器专属编译时逻辑

## 4.2 文件路径

1. `apps/endaxis-web/public/gamedata.json` — 技能原始数据（duration/animationTime/damageTicks）
2. `apps/endaxis-web/src/stores/timelineStore.js:38-78` — `createOwnSkillLinkEnhancer` + `ULTIMATE_ENHANCEMENT_EXTENDERS`
3. `apps/endaxis-web/src/simulation/compiler/compileScenario.ts` — 场景规范化
4. `apps/endaxis-web/src/simulation/compiler/compileTimeline.ts:23-81` — `calculateTimeShifts`（冻结量计算）
5. `apps/endaxis-web/src/simulation/compiler/compileTimeline.ts:84-205` — `resolveAction`（真实时间计算）
6. `apps/endaxis-web/src/simulation/simulator.ts` — 编译结果 → 事件队列
7. `apps/endaxis-web/src/simulation/events/ActionStartHandler.ts` — SP 冻结触发
8. `apps/endaxis-web/src/simulation/events/DamageHandler.ts` — 伤害（⚠ 未完成）+ 转发 STAGGER/SP
9. `apps/endaxis-web/src/simulation/events/EffectStartHandler.ts` — 异常触发 + 反应

## 4.3 调用链

```
【定义层】
gamedata.json
  └─ ultimate_duration / animationTime / damageTicks / ultimate_anomalies

【Store 层 - UI 到数据桥接】
timelineStore.js
  ├─ 用户在 TimelineEditor 拖入 LAEVATAIN 终结技块
  ├─ ULTIMATE_ENHANCEMENT_EXTENDERS["LAEVATAIN"] = createOwnSkillLinkEnhancer()
  │     ↓ 递推 200 次，把轨道内所有 skill/link 的时长累加到 extraDuration
  │     → 修改终结技的 duration（动态延长）
  └─ 触发 compileScenario() + simulate()

【编译层】
compileScenario.ts
  ├─ normalizeTracks() → 补齐 stats 默认值
  ├─ processActors()   → 生成 ActorSnapshot[]（cooldowns/activeBuffs 为空 Map）
  └─ compileTimeline(actions, connections)
        ↓
calculateTimeShifts(startSortedActions)
  ├─ 找出所有 type=ultimate 且 triggerWindow>=0 的 action
  ├─ amount = source.animationTime || 1.5  ← 终结技冻结时长
  ├─ 计算 realStart（考虑上一个冻结的 lastRealEnd）
  └─ 返回 sourceShiftMap / timeExtensions
        ↓
resolveAction(item, stopSources, sourceShiftMap, timeCtx)
  ├─ realStartTime = max(normalShifted, ctx.realEnd)
  ├─ realDuration = timeCtx.getShiftedEndTime(...)
  ├─ resolvedDamageTicks = damageTicks.map → { realTime, realOffset, time }
  └─ resolvedEffects = physicalAnomaly 展开 → ResolvedEffect[]
        ↓
ResolvedTimeline { actions, actionMap, effectMap, timeExtensions, timeContext }

【模拟层】
simulator.ts: simulate(timeline, teamConfig, enemyConfig, actors)
  ├─ createEngine() → 注册 8 个 EventHandler
  ├─ 遍历 timeline.actions：
  │   ├─ enqueue ACTION_START  (time=realStartTime)
  │   ├─ enqueue ACTION_END    (time=realStartTime + realDuration)
  │   ├─ 遍历 resolvedDamageTicks → enqueue DAMAGE_TICK (damage=0 ⚠)
  │   └─ 遍历 effects → SCNEARIO_EFFECT_TYPE_MAP[type]
  │         if (!tag) return  ← 自定义 buff 在此丢失
  │         enqueue EFFECT_START
  └─ engine.run()

【引擎层 - 事件处理】
PriorityQueue 按 time 出队：

  t=realStartTime: ACTION_START
    → ActionStartHandler
      → SP_REGEN_PAUSE (duration: animationTime || 1.5)
      → SP_CHANGE (spChange: -spCost)

  t=tick.realTime: DAMAGE_TICK
    → DamageHandler
      → simLog("DAMAGE_TICK", damage=0)  ← 仅记录，无实际计算
      → STAGGER_CHANGE (stagger: tick.stagger)
      → SP_CHANGE (spChange: +tick.sp)

  t=effect.realStartTime: EFFECT_START
    → EffectStartHandler
      → ReactionRegistry.check(enemy.effects, incoming)
          → 物理/元素反应判断 → 生成 EFFECT_END + 新 EFFECT_START
      → enemy.effects.add(incoming)
      → simLog("EFFECT_APPLIED")
      → enqueue EFFECT_END (time=effect.startTime + effect.duration)

  t=realStartTime+realDuration: ACTION_END
    → ActionEndHandler → simLog("ACTION_END")
```

## 4.4 关键代码片段

### `timelineStore.js:38-78` — LAEVATAIN 特殊时间扩展（位于 store 中而非编译器）

```javascript
const createOwnSkillLinkEnhancer = ({ linkSubtract = 0.0 } = {}) => {
    return ({ track, enhStart, baseDuration, ultimateAction, getShiftedEndTime }) => {
        const epsilon = 0.0001
        const processed = new Set()
        let extraDuration = 0

        let guard = 0
        while (guard++ < 200) {
            const currentEnd = getShiftedEndTime(
                enhStart, baseDuration + extraDuration, ultimateAction.instanceId
            )
            let foundAny = false
            for (const a of (track?.actions || [])) {
                if (!a || a.isDisabled || (a.triggerWindow || 0) < 0) continue
                if (a.type !== 'skill' && a.type !== 'link') continue
                if (processed.has(a.instanceId)) continue
                const t = Number(a.startTime) || 0
                if (t + epsilon < enhStart) continue
                if (t >= currentEnd - epsilon) continue
                // 累加 delta
                extraDuration += delta
                foundAny = true
            }
            if (!foundAny) break
        }
        return extraDuration
    }
}

const ULTIMATE_ENHANCEMENT_EXTENDERS = {
    ['LAEVATAIN']: createOwnSkillLinkEnhancer({ linkSubtract: 0.5 }),
}
```

### `DamageHandler.ts` — 伤害处理实际内容

```typescript
export class DamageHandler implements EventHandler<DamageTickEvent> {
  handle(e: DamageTickEvent, ctx: SimulationContext) {
    // TODO: 伤害计算

    ctx.simLog({ type: "DAMAGE_TICK", ..., payload: { damage: e.payload.damage } });
    // e.payload.damage 从 simulator.ts 传入时固定为 0

    if (e.payload.tickData.stagger > 0) {
      ctx.queue.enqueue({ type: "STAGGER_CHANGE", ... });
    }
    if (e.payload.tickData?.sp > 0) {
      ctx.queue.enqueue({ type: "SP_CHANGE", ... });
    }
  }
}
```

### `CalculationPipeline.ts` — 管道架构（唯一实现的修饰符）

```typescript
// 当前唯一实现的修饰符：击飞/倒地状态下的失衡加成
export const OriginiumArtsModifier: ModifierFn<StaggerContext> = (ctx, result) => {
  const hasKnock = ctx.target.effects.hasTag("PHYSICAL_LIFT")
                || ctx.target.effects.hasTag("PHYSICAL_KNOCK_DOWN");
  if (!hasKnock) return;
  const artsPower = ctx.source.stats.originium_arts_power || 0;
  const multiplier = 1 + artsPower * 0.005;
  result.finalValue = result.finalValue * multiplier;
  result.breakdown.push({
    source: "Knock Bonus", type: "MULTIPLIER", value: multiplier, ...
  });
};
```

## 4.5 暴露出的架构问题

| 问题 | 具体表现 | 影响 |
|---|---|---|
| **伤害计算缺失** | `DamageHandler` 全是 `// TODO`，damage 传 0 | 无法做"自动伤害计算"，`DamageTick.multiplier` 从未被消费 |
| **自定义 buff 盲区** | `SCNEARIO_EFFECT_TYPE_MAP` 只有 8 条，大量角色专属 buff 静默丢失 | 模拟结果缺失大量 buff 效果，无报错 |
| **特殊武器逻辑在 Store 里** | `createOwnSkillLinkEnhancer` 放在 UI store 而非 compiler | 编译器无法独立运行 headless，武器扩展无法统一管理 |
| **ActorState 是空壳** | `cooldowns`/`activeBuffs`/`activeAction` 声明了但从不被写入 | CD 合法性校验完全不可能实现，角色自身 buff 无法追踪 |
| **`EffectTrigger` 架构声明了但没使用** | `Effect` 类有 `triggers: EffectTrigger[]` 字段，但没有任何 handler 遍历触发它 | 装备/天赋的"被动触发"逻辑无法实现 |

---

# 5. 总结

## 5.1 当前项目更像什么？

更像 **UI 排轴器 + 半成品模拟器**。时间轴编辑、SP/失衡时序可视化已经完成度很高；而"自动伤害计算"、"合法性校验"、"装备/天赋被动触发"三个核心模拟功能要么是 TODO，要么是空字段声明了没有实现。目前 `simulate()` 真正在算的只有 SP 变化和失衡值，伤害输出是 0。

## 5.2 如果目标是做成"自动合法性校验 + 自动触发 + 自动伤害计算"，最优先重构哪一层？

**最优先：打通 `DamageHandler` 的伤害计算链路。** 具体步骤：

1. 在 `simulator.ts` 的 `DAMAGE_TICK` 入队时，根据 `tick.multiplier` + `ActorSnapshot.stats` 计算基础伤害，通过 `CalculationPipeline` 应用修饰符
2. 扩展 `SCNEARIO_EFFECT_TYPE_MAP`，支持角色专属 buff 类型，并让 `EffectTrigger` 机制真正被引擎消费（在 `EffectStartHandler` 或单独的 `TriggerHandler` 里遍历 `effect.triggers`）
3. 把 `timelineStore.js` 里的 `ULTIMATE_ENHANCEMENT_EXTENDERS` 迁移进 `simulation/compiler/`，让编译器能 headless 运行

## 5.3 用一句话概括当前代码库最大的问题

> **引擎架构设计得很好，但伤害计算是空洞（`damage: 0`），大量角色专属 buff 被静默丢弃，所有"被动触发"机制的类型接口已声明却从未被引擎执行——系统目前只是一个精确的时间轴可视化器和 SP/失衡计时器，不是真正的伤害模拟器。**
