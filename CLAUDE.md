# CLAUDE.md — EFBot (Endaxis) 开发指南

## 项目简介

Endaxis 是《明日方舟：终末地》的排轴编辑器与伤害模拟工具。基于 [end-axis](https://github.com/floating-sky/end-axis) 二次开发，当前已独立演化，核心模拟引擎（V2 kernel）和大部分前端逻辑为全新实现。前端 + 模拟引擎均为纯客户端 TypeScript，无需后端即可完成全部计算。

> 2026-04-21 完成 V1 清理：`simulation/` 下只剩 `compiler/`（提供 timeline 编译）和 `v2/`（唯一计算路径）。

线上地址: https://www.endfieldbot.com
beta版: https://www.endfeildbot.com

## 快速上手

```bash
cd apps/endaxis-web
npm install          # Node ^20.19.0 || >=22.12.0
npm run dev          # Vite dev server → http://localhost:1420
npm test             # Vitest 全量测试
npm run type-check   # vue-tsc 类型检查
npm run build        # 生产构建
```

## 目录结构

```
apps/endaxis-web/src/
├── simulation/                 # ★ 核心模拟引擎 (纯 TS，无 Vue 依赖)
│   ├── v2/                    # ☆ V2 计算内核（唯一活跃计算路径）
│   │   ├── characters/        #   角色数据文件 + adapter.ts
│   │   ├── equipment/         #   装备套装定义
│   │   ├── weapons/           #   武器定义
│   │   ├── kernel.ts          #   主循环（全局 hit 排序 + 5 阶段模型）
│   │   ├── damage.ts          #   11 乘区伤害计算
│   │   ├── projections.ts     #   EventLog → UI 数据投影
│   │   ├── storeAdapter.ts    #   Store → kernel 输入桥接
│   │   ├── buffMetadata.ts    #   buff 图标/名称注册表
│   │   └── ...                #   anomaly/effects/resources/triggers/types
│   └── compiler/              #   排轴编译（Store 场景 → ResolvedTimeline）
├── components/                #   Vue 组件
├── stores/                    #   Pinia 状态管理
├── views/                     #   页面 (TimelineEditor, DamageCalcView 等)
├── data/operators/            #   角色数据 (~30 个角色目录)
├── i18n/                      #   国际化 (zh-CN 为默认, 含 en)
└── utils/                     #   工具函数
```

> `compiler/` 只负责把 Store 的 tracks/actions 规范化成 ResolvedTimeline（处理连携技推移、checkpoints、TimeContext 等），**不做任何计算**。所有伤害/资源/状态逻辑全在 `v2/` 里。

## V2 计算内核（当前活跃系统）

位置: `apps/endaxis-web/src/simulation/v2/`

所有计算集中在 V2 kernel。V1 已于 2026-04-21 全部删除，不再有"保留但禁用"的死代码。

### 三层架构

```
Layer 1: characterBuild.ts     角色数据 → stat breakdown（战斗中不可变）
Layer 2: kernel.ts + 模块      技能序列 → 逐 hit 结算 → SimEvent[]
Layer 3: projections.ts        SimEvent[] → UI 数据（纯投影，不参与计算）
```

### 完整管线

```
Store 状态 → storeAdapter.ts → V2 Kernel simulate() → SimEvent[]
                                                          ↓
                                               projections.ts (11 个投影)
                                                          ↓
                                           v2ProjectionAdapter.ts → UI 格式
                                                          ↓
                                                  Vue 组件纯渲染
```

前端只做：放置技能 + 角色配置 + 渲染 kernel 输出。

### Hit 执行模型 (kernel.ts)

```
Phase A: 按技能 startTime 处理技能级操作（SP/gauge/variant/interrupt/action_start）
         收集所有 hit 到 globalHits[]
Phase B: globalHits 按绝对时间排序，逐个处理:
  Phase 1: Effects（状态变更 + 收集 effectDamages 和 deferredActions）
  Phase 2: Effect damages（猛击/碎甲等效果伤害）
  Phase 3: Deferred actions（消耗清理、天赋 buff 施加）
  Phase 4: Hit 本体伤害 + 失衡
  Phase 5: Trigger evaluation（触发器事件 + immediate/deferred trigger 执行）
```

### 核心原则

- 所有效果基于具体 hit 触发，**先特效后伤害**
- 效果链完整结算后才轮到 hit 本体伤害
- 天赋/武器效果通过 PassiveTrigger 事件驱动
- **前端 = kernel 结果的投影**，不做任何前端独立计算
- **修复在 kernel 不在投影层**（状态过期等逻辑都在 kernel 处理）
- 全局 hit 排序确保跨技能 hit 按真实时间顺序处理

### 角色数据文件 (`v2/characters/`)

每个角色一个 TypeScript 文件，包含:
- Part 1: 静态数据（identity, levelStats, skillData, talents, potentials）
- Part 2: 内核效果（skills 含 hit timing/duration/detach, triggers 含天赋/潜能触发）
- 通过 `adapter.ts` 转换为前端管线格式，自动覆盖 gamedata.json 数据
- 新角色只需: 写 `characters/xxx.ts` + `adapter.ts` 注册 `V2_MODULES` + `buffMetadata` 加图标

**V2-ready 角色**: ENDMINISTRATOR, POGRANICHNK, LASTRITE, LIFENG, ARCLIGHT
**不支持角色**: EMBER, CATCHER, SNOWSHINE（需敌方攻击/治疗系统）

### 模块速查

| 文件 | 功能 |
|------|------|
| `types.ts` | 类型定义（Skill, Hit, EventLog, PassiveTrigger 等） |
| `kernel.ts` | 主循环（5 阶段模型 + 条件校验 + 打断） |
| `damage.ts` | 11 乘区伤害 + MultiplierRef + 暴击 |
| `anomaly.ts` | 附着/反应/物理异常/破防/失衡 |
| `resources.ts` | SP(trueSP/refundSP) + Gauge |
| `effects.ts` | Buff 管理 + Stack buff + 变体选择 |
| `triggers.ts` | 触发器处理器（immediate/deferred + ICD + 条件） |
| `projections.ts` | 11 个投影函数 |
| `storeAdapter.ts` | Store → kernel 输入桥接 |
| `damageCalcProjections.ts` | 伤害计算页面专用投影 |
| `v2ProjectionAdapter.ts` | V2 投影 → UI 格式适配 |
| `characters/adapter.ts` | V2_MODULES 注册 + UNSUPPORTED_IDS |

### 伤害公式

```
finalDamage = floor(
  ATK × skillMult
  × defense × crit × dmgBonus × amplify
  × combo × vulnerability × fragility × resistance
  × break × reduction × special
)
```

- 乘区之间: 乘法；乘区内部: 加法 (如 dmgBonus = 1 + bonus1 + bonus2)
- ATK = floor(truncTo1dp(primary × 1.5 + secondary × 0.5) + flat) × (1 + pct%)
- 详见 `v2/damage.ts`

### 打断优先级

终结技(5) > 闪避(4) > 连携技(3) > 战技(2) > 普攻(1)

## 编码规范

### 命名

| 类别 | 风格 | 示例 |
|------|------|------|
| 函数 | camelCase | `simulate()`, `resolveDamage()` |
| 类 | PascalCase | `BuffManager`, `GaugeState` |
| 常量 | UPPER_SNAKE_CASE | `SP_REGEN_RATE`, `SP_CAP` |
| 接口/类型 | PascalCase | `DamageContext`, `CharacterBuild` |
| 类文件 | PascalCase | — |
| 函数/工具文件 | camelCase | `kernel.ts`, `damage.ts` |
| 测试文件 | `.test.ts` 后缀 | `kernel.test.ts`, `storeAdapter.test.ts` |

### 注释

- 代码逻辑注释用英文
- UI / 数据相关可用中文
- 类/函数用 JSDoc 注释
- 用 `// ── Section Name ──` 分隔逻辑段落

### TypeScript

- **strict mode 全开** (noUnusedLocals, noUnusedParameters, noFallthroughCasesInSwitch)
- 路径别名: `@/*` → `./src/*`
- simulation/ 目录内全部使用 TypeScript

## 测试

```bash
npm test                                     # 全量运行 (Vitest)
npx vitest@4.0.17 run --reporter=verbose     # 带详细输出（必须 pin 4.0.17）
npx vitest@4.0.17 run src/simulation/v2/     # 运行指定目录
```

- 测试文件与源文件同目录，后缀 `.test.ts`
- 数值断言: `toBe()` (精确整数) 或 `toBeCloseTo()` (浮点)
- vitest **必须** pin 4.0.17（4.1.2 有 `@/` 路径解析 bug）
- 当前: 6 测试文件，79 用例全部通过（V1 测试随引擎一起于批次 4 删除）

## 开发原则

- **不要**在核心代码里写 `if(actorId === "XXX")` 特判——用注册表/handler 模式
- 新角色效果优先检查现有 trigger/effect type 是否可复用，再考虑新增
- 载体 buff 消耗 (consumed) 和到期消失 (expired) 分别处理
- **前端 = kernel 投影**: 前端不做模拟/预测，全部显示来自 V2 kernel 事件
- **修复在 kernel**: 状态过期、buff 生命周期等逻辑在 kernel 处理，不在投影层 hack
- 长报告输出到 `reports/` 目录

## 前端：拟真排轴系统

排轴编辑器双模式（自由/拟真），通过 `timelineEditorMode` 切换：
- **自由模式**: 无约束放置
- **拟真模式**: playhead 驱动，模拟游戏内技能释放流程

### 拟真模式快捷键

| 操作 | 快捷键 |
|------|--------|
| Playhead 移动 | ←→（步长可调 0.1/0.5/1/5s） |
| 跳转技能边界 | Shift+←→ |
| 播放/暂停 | 空格 |
| 调倍速 | +/- (0.25~2x) |
| 放战技 | 1-4 |
| 放终结技 | Alt+1-4 |
| 放连携技 | E（从队列） |
| 放普攻 | A / Shift+A（补全到重击） |
| 切主控 | Q 顺序 / F1-4 直接 |
| 撤销/重做 | Ctrl+Z / Ctrl+Shift+Z |
| 保存 | Ctrl+S |

### 连携技队列系统

- 基于 simLog 事件匹配触发条件（非旧状态检查），6s 可施放窗口
- 触发条件数据在 `gamedata.json` characterRoster 的 `link_trigger` 字段
- UI: playhead 旁显示圆形头像 + SVG 倒计时环
- 21/25 角色已配置触发条件（EMBER/CATCHER/SNOWSHINE/ROSSI 未配置）

### 时间轴行布局

每条干员轨 (`.track-row`) 由三段构成:
- **技能轴** (`.track-lane`, 固定 50px + 2px 封底): 技能方块 + 主控黄色上描边 + 主控 CD 紫色上描边 + 充能曲线 SVG + 主控切换 handle；所有原 state-sub-track 的元素已合并于此 (2026-04-18 重构)
- **连携技 CD 间隙** (`--track-cd-gap`, 10px): 预留给未来的连携技 CD 条
- **自身 Buff 行** (`.self-buff-track`, 动态高度): 每轨独立，高度 = `lane数 × 24 + 4`，lane 由 `_assignLanes` 按 startTime 无冲突分配；**不继承** track-lane 的 tick 背景

Self-buff 显示两种模式（全局开关，工具栏 chevron 切换）:
- **展开** (`selfBuffExpanded=true`): 显示全部 buff
- **折叠** (默认): 仅显示已 pin 的 buff；pin key = `buffId || name`，**按 buff 类型 pin**（同 buff 所有实例一起被 pin）
- localStorage: `endaxis_self_buff_expanded` / `endaxis_pinned_buffs`
- Pin 交互 (Alt+Click / 详情面板开关) 待做，参见 `project_ult_charge_full_effect.md` 之外的 P2-3 队列

### 伤害计算页面

路由 `/damage`，竖向时间线 + 右侧详情面板。详见 `reports/damage-calc-page-2026-04-16.md`。

## 游戏机制速查

- **SP 系统**: trueSP/refundSP 分离，消耗优先 refundSP，仅 trueSP 消耗产生终结技充能
- **法术爆发**: 同元素附着达 4 层 → burst damage，附着不清空；仅物理/法术异常清空附着
- **暴击双模式**: `"real"` 独立 roll / `"expected"` 概率加权期望值
- **攻击力**: `ATK = floor(((base+weapon) × (1+pct%) + flat) × (1 + primary×0.5% + secondary×0.2%))`

## 关键数据位置

| 数据 | 位置 |
|------|------|
| 角色 V2 数据 | `v2/characters/*.ts` |
| 武器触发 buffs | `gamedata.json` weaponDatabase |
| 角色 hit timing | `gamedata.json` characterRoster `{suffix}_damage_ticks` |
| 终结技 CD | `data/operators/ultimateCooldowns.json` |
| Buff 图标/名称 | `buffMetadata.ts` |
| 连携技触发条件 | `gamedata.json` characterRoster `link_trigger` |
| 装备套装数据 | `reports/equipment-set-data-template.md` |

## 参考文档

| 文档 | 内容 |
|------|------|
| `reports/v2-skill-hit-template.md` | 角色技能 hit 数据模板 |
| `reports/v2-skill-hit-confirmed.md` | 已确认的 hit 数据 |
| `reports/v2-combat-glossary.md` | 战斗术语对照 |
| `reports/damage-calc-page-2026-04-16.md` | 伤害计算页面设计 |
| `reports/buff-timing-audit.md` | 效果结算规则 |
| `reports/kernel-mechanics-audit-2026-04-09.md` | V2 内核力学规格说明书 |
| `reports/trigger-timing-refactor-2026-04-17.md` | 触发器时机重构记录 |

## 其他

- i18n 默认 zh-CN，localStorage key: `endaxis_locale`
- 场景数据通过 localStorage 持久化，使用 gzip 压缩
- ENDMINISTRATOR 潜能 3-5 在游戏内不可获取（最高 2 潜）
- Python 后端已移除（2026-04-16），SimulatorView 和 `/api` proxy 一并清理，纯客户端架构

## 待办事项

| 优先级 | 任务 | 状态 | 说明 |
|--------|------|------|------|
| **P0** | V2 角色数据 | 5/25 完成 | 需手动测算 hit timing/duration 等数据后提供，当前：ENDMINISTRATOR、POGRANICHNK、LASTRITE、LIFENG、ARCLIGHT |
| **P1** | 伤害计算系统 | 骨架已搭建 | 路由 `/damage`，等排轴系统完整后再完善（11 乘区展开、buff 叠加等） |
| **P2** | 武器 & 装备词条 | 待核对 | 武器/装备套装数据核对 + 部分特殊词条需单独处理逻辑 |
| **P3** | 重击 duration 重测 | 待测 | ENDMINISTRATOR/POGRANICHNK/LASTRITE 的重击 duration 需用接普攻方式重测（当前为移动取消，偏大）。这三个角色不常作为主控，优先级低 |
