# CLAUDE.md — EFBot (Endaxis) 开发指南

## 项目简介

Endaxis 是《明日方舟：终末地》的排轴编辑器与伤害模拟工具。前端 + 模拟引擎均为纯客户端 TypeScript 实现，无需后端即可完成全部计算。

线上地址: https://www.end-axis.com/

## 快速上手

```bash
cd apps/endaxis-web
npm install          # Node ^20.19.0 || >=22.12.0
npm run dev          # Vite dev server → http://localhost:1420
npm test             # Vitest 全量测试
npm run type-check   # vue-tsc 类型检查
npm run build        # 生产构建
```

Docker 开发环境:
```bash
docker-compose up    # python-app:8000 + endaxis-web:1420
```

## 目录结构

```
apps/
├── endaxis-web/                    # 主应用 (Vue 3 + TS)
│   └── src/
│       ├── simulation/             # ★ 核心模拟引擎 (纯 TS，无 Vue 依赖)
│       │   ├── anomaly/            #   异常子系统 (魔法附着→反应、物理异常)
│       │   ├── calculation/        #   伤害计算 (DamageResolver, 11 乘区, 攻击力公式)
│       │   ├── compiler/           #   场景编译 (ScenarioData → CompiledScenario)
│       │   ├── data/               #   游戏数据 (技能倍率, 天赋注册表, 常量)
│       │   ├── effects/            #   效果系统 (Effect, EffectTrigger, buff/debuff)
│       │   ├── engine/             #   事件引擎 (SimulationEngine, 优先队列, RNG)
│       │   ├── equipment/          #   装备系统 (套装/武器被动注册, DynamicBonus)
│       │   ├── events/             #   事件处理器 (DamageHandler, ActionHandler 等)
│       │   ├── fixture/            #   测试 fixture
│       │   ├── legality/           #   合法性校验 (sandbox/audit/strict)
│       │   ├── mechanics/          #   反应机制 (hit steps, reactions)
│       │   ├── projection/         #   资源投影 (SP/击碎/连携技触发序列)
│       │   ├── state/              #   运行时状态 (GameState, ActorState, EnemyState)
│       │   ├── simulator.ts        #   模拟入口 (simulate 函数)
│       │   └── runSimulation.ts    #   顶层入口 (compile + simulate)
│       ├── components/             #   Vue 组件 (排轴网格、技能库、属性面板)
│       ├── stores/                 #   Pinia 状态管理
│       ├── views/                  #   页面 (TimelineEditor, SimulatorView, DataEditor)
│       ├── data/operators/         #   角色数据 (~30 个角色目录)
│       ├── i18n/                   #   国际化 (zh-CN 为默认, 含 en)
│       └── utils/                  #   工具函数
├── python-app/                     # FastAPI 后端 (基本闲置，仅保留骨架)
└── tauri-ui/                       # Tauri 桌面端封装
```

## 模拟引擎架构

### 执行流水线

```
ScenarioData → compileScenario() → CompiledScenario → simulate() → SimulationResult
                  编译阶段                                 模拟阶段
```

1. **编译**: 解析场景数据，归一化 stats 默认值，解析时间线动作和连接关系，生成 ActorSnapshot
2. **模拟**: 事件驱动循环——优先队列按时间排序，逐事件分发到 Handler，Handler 可再入队下游事件

### 事件类型

```
ACTION_START / ACTION_END          — 动作生命周期
DAMAGE_TICK                        — 伤害结算
SP_CHANGE / SP_REGEN_PAUSE         — 技力变动
EFFECT_START / EFFECT_END          — 效果生命周期
STAGGER_CHANGE                     — 击碎值变动
APPLY_MAGIC_ATTACHMENT             — 魔法元素附着
APPLY_PHYSICAL_ANOMALY             — 物理异常施加
APPLY_DIRECT_ANOMALY               — 直接异常施加
ANOMALY_DAMAGE                     — 异常伤害结算
LEGALITY_ISSUE                     — 合法性问题
```

### 伤害公式

```
finalDamage = floor(
  ATK × skillMult
  × defense × crit × dmgBonus × amplify
  × combo × vulnerability × fragility × resistance
  × break × reduction × special
)
```

- 乘区之间: 乘法
- 乘区内部: 加法 (如 dmgBonus = 1 + bonus1 + bonus2)
- ATK = floor(truncTo1dp(primary_ability × 1.5 + secondary_ability × 0.5) + flatBonus) × (1 + percentBonus)
- 详见 `calculation/DamageResolver.ts`, `calculation/attackFormula.ts`, `calculation/multiplierZones.ts`

### 核心数据结构

| 结构 | 位置 | 说明 |
|------|------|------|
| `ScenarioData` | `compiler/types.ts` | 场景输入 (tracks, connections, systemConstants, customEnemyParams) |
| `CompiledScenario` | `compiler/types.ts` | 编译输出 (timeline, actors, teamConfig, enemyConfig, diagnostics) |
| `GameState` | `state/GameState.ts` | 运行时状态容器 (team, enemy, actors, currentTime) |
| `ActorSnapshot` | `state/types.ts` | 角色快照 (stats, resources, cooldowns, activeBuffs) |
| `Effect` | `effects/types.ts` | 效果对象 (tags, duration, stacks, triggers, properties) |
| `DynamicBonus` | `equipment/types.ts` | 装备动态加成 (stat, value, zone) |
| `DamageContext` | `calculation/type.ts` | 伤害上下文 (source, target, multiplier, tags, state) |
| `DamageTags` | `calculation/damageTypes.ts` | 伤害标签 (damageSource, damageType, damageSchool, canCrit) |

### 关键设计模式

- **注册表模式**: 装备被动 (`equipment/registry.ts`)、天赋条件 (`data/talentConditionalRegistry.ts`)、事件处理器均通过注册表分发，避免在核心循环中硬编码 if-else
- **事件驱动**: 所有状态变更通过入队事件完成，Handler 处理事件并入队下游事件
- **不可变快照**: 状态变更创建新对象而非原地修改
- **组合优于继承**: Effect 通过 EffectTrigger 组合行为，无深层继承链
- **诊断系统**: DiagnosticCollector 收集编译/运行时问题，与 simLog (游戏事件记录) 分离
- **嵌套递归执行模型** (`SimulationEngine`):
  - 每个事件递归处理：handler → 即时trigger → 级联子事件(递归) → scoped deferred trigger → deferred级联(递归)
  - 每个事件有独立的 deferred scope：后效在子树完成后触发，不是帧末
  - 实现嵌套 `特效 → 伤害 → 后效` 生命周期
  - `runLegacy()` 保留旧扁平模型作为备份（未启用）
  - 安全限制：最大递归深度 500
- **触发模式** (`EffectTrigger.deferred`):
  - 默认（`false`）：事件发生后立即插入结算（深度优先）
  - 延迟（`true`）：事件子树完整处理后才执行（用于消耗类后效，如结晶消耗→天赋触发）
  - "xx后"的真实含义 = 触发动作的完整子树结算完毕后，不是帧末
- **帧快照** (`ctx.frameSnapshot`):
  - 帧开始时快照敌人状态（附着层数/破防层数等）
  - 消耗类 handler 从快照读倍率（如别礼连携 hit2 读寒冷附着层数）
- **法术爆发**:
  - 同元素附着达到 4 层 → burst damage，附着**不清空**
  - 仅物理异常和法术异常清空附着
- **终结技冷却**: `data/operators/ultimateCooldowns.json` 存储各角色终结技 CD，`ActionEndHandler` 读取

## 编码规范

### 命名

| 类别 | 风格 | 示例 |
|------|------|------|
| 函数 | camelCase | `simulate()`, `registerEquipmentPassives()` |
| 类 | PascalCase | `DamageResolver`, `SimulationEngine`, `Effect` |
| 常量 | UPPER_SNAKE_CASE | `SP_REGEN_RATE`, `PHYSICAL_BONUS` |
| 接口/类型 | PascalCase | `DamageContext`, `ActorSnapshot`, `SimEventType` |
| 类文件 | PascalCase | `DamageResolver.ts`, `GameState.ts` |
| 函数/工具文件 | camelCase | `simulator.ts`, `attackFormula.ts` |
| 测试文件 | `.test.ts` 后缀 | `simulator.test.ts`, `simulator.behavior.test.ts` |

### 注释

- 代码逻辑注释用英文: `// Step 1: Compute effective ATK from the attack formula`
- UI / 数据相关可用中文: `const ATTACK_SEGMENT_COUNT = 5 // 攻击段数`
- 类/函数用 JSDoc 注释
- 用 `// ── Section Name ──` 分隔逻辑段落

### TypeScript

- **strict mode 全开** (noUnusedLocals, noUnusedParameters, noFallthroughCasesInSwitch)
- 路径别名: `@/*` → `./src/*`
- 允许 JS 文件 (allowJs: true)，但不检查 JS (checkJs: false)
- simulation/ 目录内全部使用 TypeScript

## 测试

```bash
npm test                          # 全量运行 (Vitest)
npx vitest run --reporter=verbose # 带详细输出
npx vitest run src/simulation/calculation/  # 运行指定目录
```

### 测试约定

- 测试文件与源文件同目录，后缀 `.test.ts` 或 `.behavior.test.ts`
- 使用 `fixture/` 目录存放可复用的测试场景
- 辅助函数: `makeAction()`, `makeStats()`, `makeActor()`, `makeEngine()` 用于快速构建测试上下文
- 支持 snapshot 测试 (Vitest snapshots in `__snapshots__/`)
- 数值断言优先用 `toBe()` (精确整数) 或 `toBeCloseTo()` (浮点)

### 当前测试状态

24 个测试文件，332 个用例 (318 通过 / 14 失败)。
- 失败集中在 `skillMultipliers.test.ts`、`phase8-10.test.ts`、`legality.test.ts`：overlay/legality 重构后断言未同步
- vitest 需 pin 4.0.17 版本（4.1.2 有 `@/` 路径解析问题）

## 已实现的系统

### Effect/Buff 系统
- **EffectManager**: 支持 add/remove/removeByTag/removeByEffectId/consumeStacks/consumeStackGroup
- **声明式 BoundEffect ops**: `boundEffectOps.ts` 定义操作类型 + `registerBoundEffectOps()` 编译为 handler
- **DamageHandler registry**: pre/post damage handler 注册表（`preDamageRegistry`/`postDamageRegistry`），已导出
- **TalentConditionalDescriptor + postAction**: 天赋触发后支持附带副作用
- **Buff 元数据**: `buffMetadata.ts` 包含所有 buff 图标/名称，莱万汀熔火 per-layer-icon

### 效果路由（38 种全部归类）
- **Route 1**: ���素附着 (blaze/cold/emag/nature_attach) + burst 类统一→附着
- **Route 2**: 物理异常 (stagger/knockdown/knockup) + 直接异常 (burning/conductive/frozen/corrosion)
- **Route 2.6**: break 直接破防 + physical_weakness/physical_vulnerable/spell_vulnerable
- **Route 2.9**: skillBuffZoneRegistry 路由 (增幅/增伤/脆弱/载体 buff)
- **载体 buff**: 支持 carrierOnly + independent stacks + defaultDuration + per-layer icon

### 暴击系统（双模式）
- `"real"`: 每个 hit 独立 roll，二元暴击/不暴击
- `"expected"`: 概率加权期望乘区 `1 + rate × critDmgRatio`，确定性
- DynamicBonus 支持 `crit_rate`/`crit_dmg` stat + `"crit"` zone
- DamageResult 携带 `isCrit` 字段

### 载体消耗系统 (`carrierConsumptionHandlers.ts`)
已实现角色: ENDMIN(结晶 immediate+deferred 拆分+P2权能映射), POGRANICHNK(铁誓+破防SP+P5 SP×1.2+战术教导), LAEVATAIN(熔火consume_magma boundEffect+燃烧+灼心4层条件), TANGTANG(涡流+SP), WULFGARD(异常消耗 immediate+deferred 拆分, 优先级 burn>conduction>freeze>corrosion, +P3+P5), ARCLIGHT(P1 SP+强制导电), ROSSI(暴击buff+附着消耗+沸血), LASTRITE(幻影P1/P5+连携消耗 last-tick+天赋deferred+倍率合并), ALESH(寒冷消耗 frameSnapshot+冻结+SP+珍鳞概率+P3全队ATK), YVONNE(附着消耗 frameSnapshot+冻结前置+倍率合并+冰点天赋), DAPAN(备料消耗+CD恢复+P5额外破防), ANTAL(连携技重新施加+P5聚焦计时器), GILBERTA(破防加成+P2+引力模式锁定), XAIHI(智识增幅), FLUORITE(P5附着→CD减+炸弹buff+天赋落井下石), AKEKURI(终结技combo+P3全队ATK+P5延长), ESTELLA(碎冰→SP返还), AVYWENNA(雷枪命中→gauge+P1)

### 天赋实现（22+ 个）
talentConditionalRegistry: WULFGARD/CHENQIANYU/DAPAN/AVYWENNA/POGRANICHNK/ARCLIGHT/XAIHI/LIFENG×2/ROSSI/ALESH/AKEKURI/PERLICA/ESTELLA
runtime_passive: LAEVATAIN(resistance_ignore, 4层熔火条件判定), ENDMIN(physical_dmg fragility)
carrierConsumption 路径: ESTELLA(同病相怜), ALESH(钓鳞老手), AVYWENNA(高效派送)
multiplierZones: FLUORITE(落井下石)
其他: GILBERTA(信使的歌声 SpChangeHandler), LIFENG 顿悟(static scope)

### 潜能 (~85 个已生效)
- `stat_bonus`/`damage_bonus` (static): 42 个
- `gauge_modifier/ult_gauge_cost`: 全部生效
- SP 返还: ENDMIN P1, ARCLIGHT P1, LAEVATAIN P1, TANGTANG P1
- 复合/条件: AKEKURI P1/P3/P5, PERLICA P3, ESTELLA P5, WULFGARD P3/P5, LIFENG P1/P5, ARDELIA P1, GILBERTA P2, YVONNE P4, ANTAL P5, AVYWENNA P1, DAPAN P5
- 参数修正 (`potentialModifiers.ts`): 倍率(7) + CD(5) + 持续时间(7)
- 异常独立乘区: LAEVATAIN P3 burn×1.5, AVYWENNA P5 emag脆弱×1.15
- 逻辑覆盖: ARCLIGHT P5, POGRANICHNK P3
- Buff 值修正: ARCLIGHT P3, XAIHI P1/P5, ANTAL P1, TANGTANG P3
- Inline: LASTRITE P1/P5, PERLICA P4, POGRANI P5, FLUORITE P5
- 条件暴击: YVONNE 冰点天赋(P2/P3, data-driven), YVONNE P3
- 跨角色: POGRANICHNK 战术教导, ENDMIN P2 权能映射, GILBERTA 信使的歌声, ALESH P3 愿者上钩
- 天赋: PERLICA 歼灭协议(失衡+20/30%), FLUORITE 落井下石(缓速+10/20%)

### 合法性校验
- SP/Gauge/Cooldown/条件 校验完整
- 终结技必须满能量 (`gauge >= maxGauge`)
- 连携技条件映射 17 种 + antal_buff/endmin_debuff
- `skill_allowed_types` / `link_allowed_types` 仅用于变体判定，基础战技和连携技不检查这些条件
- 拟真模式下连携技施放由 link queue 系统控制（见下方）
- **临时**: 同轨道动作互斥（`BLOCK_SAME_TRACK_OVERLAP` in ActionStartHandler，随时可移除）

### 装备套装系统
- 21 套中 12 套已实现触发效果（definitions.ts + registry.ts）
- 全 21 套常驻属性已通过 `equipmentCategoryConfigs.passiveStats` 自动注入
- 常驻注入位置: `timelineStore.js` → `resolveTrackConfiguredStats`（attack_percent 应用前）
- 5 套需 HP/治疗/受击系统；4 套无套装效果

### 技能打断系统（已设计，暂未启用）
- 数据模型已就绪: `Action.checkpoints`, `Anomaly.detached`, `ActionType: "dodge"`, `ResolvedAction.cancelledFromSegment`
- 编译逻辑已就绪: `compileTimeline.ts` → `resolveInterruptions()`（当前注释禁用）
- 运行时逻辑已就绪: DamageHandler/simulator.ts 的 cancelled segment 跳过检查
- 莱万汀熔火消耗已移至 hit boundEffect（`consume_magma` in preDamageRegistry）
- 待填: 各角色技能的 checkpoint offset 帧数据、闪避 action 持续时间

### 连携技触发队列系统
- **投影函数**: `projection/projectLinkTriggerSeries.ts` 扫描 simLog 事件，检测连携技触发时机
- **事件型条件**: 区别于旧的状态检查（`checkConditionsMet`），新系统基于 simLog 事件匹配
- **6s 窗口**: 条件触发后开启 6s 可施放窗口，窗口内再次触发刷新持续时间但不改变队列位置
- **队列排序**: 同时触发按轨道 1→4 排序，不同时触发按触发顺序排列
- **冷却期间不触发**: 从 castLinks + linkCooldown 计算冷却窗口，CD 内事件不会开启窗口
- **E 键施放**: 只施放队列首位，若该干员被锁定（如引导中）则 E 无效（不跳过）
- **skipConditions**: 从队列施放时 `addSkillToTrack` 跳过 `checkConditionsMet`（6s 窗口已做判定）
- **数据格式**: `link_trigger` 字段在 gamedata.json characterRoster 中，结构化条件对象
- **UI**: TimelineGrid.vue 播放头旁显示圆形头像 + SVG 倒计时环，仅播放头高亮时可见

**触发条件类型**:
```
on_heavy_attack          — 主控重击（STAGGER 事件 + 来源是 attack 类型）
  + require / require_not — 附加状态检查（如 frozen、break、magic_attachment）
on_stagger               — 任意失衡事件
on_stagger_or_node       — 失衡或失衡节点
on_break                 — 敌人进入破防
on_break_stacks          — 破防达到 N 层（min_stacks）
on_slam_or_armor_break   — 猛击或碎甲（PHYSICAL_CRUSH/BREACH 效果施加）
on_anomaly_apply         — 异常施加（types 过滤: burn/frozen/corrosion/conduction）
on_frozen                — 敌人进入冻结
on_magic_attachment      — 任意法术附着
on_attachment            — 指定元素附着达到 N 层（elements + min_stacks）
on_cold_attach_or_burst  — 寒冷附着或法术爆发
on_conduction_apply_or_consume — 导电施加或消耗
on_anomaly_or_crystal_consume  — 异常/结晶被消耗
on_physical_anomaly_or_attachment — 物理异常或法术附着
on_link_damage           — 其他干员连携技造成伤害
on_effect_consumed       — 指定效果被消耗（effect_id，非自然到期）
```

**附着 vs 异常区分**:
- 附着（法术附着）: ANOMALY_STATUS_CHANGE 中有 `element` + `stacks` 字段（fire/cold/electro/nature）
- 异常（法术异常）: ANOMALY_STATUS_CHANGE 中有 `anomalyType` 字段（burn/frozen/corrosion/conduction）
- 两者在 simLog 中 payload 互斥，不会混淆

**已配置 link_trigger 的角色 (21/25)**:
重击触发: PERLICA/ARDELIA/YVONNE/LIFENG/AVYWENNA
失衡/破防: AKEKURI/CHENQIANYU/DAPAN/POGRANICHNK
异常/附着: LAEVATAIN/GILBERTA/ESTELLA/WULFGARD/ARCLIGHT/TANGTANG/LASTRITE/FLUORITE/ANTAL
特殊: ENDMINISTRATOR(连携伤害)/XAIHI(晶体消耗)
未配置(不可模拟): EMBER/CATCHER/SNOWSHINE(受击/HP)/ROSSI(描述为空)

### SP 系统
- trueSP / refundSP 分离，消耗优先 refundSP
- 仅 trueSP 消耗产生终结技充能
- "恢复"(reason=damage) = trueSP，"返还"(reason=skill) = refundSP

## 开发原则

- **不要**在 `simulator.ts` 里新增 `if(actorId === "XXX")` 特判——用注册表/handler 模式
- 载体 buff 消耗 (consumed) 和到期消失 (expired) 分别处理（`EFFECT_END.type` 区分）
- 新角色效果优先检查 `talentConditionalRegistry` / `carrierConsumptionHandlers` / `skillBuffZoneRegistry` 是否可复用
- 长报告输出到 `reports/` 目录

## 待处理文档

**最新审计**: `reports/implementation-audit-2026-04-08.md`
- 天赋: 22 已实现 / 22 未实现（多数被受击/HP 阻塞）
- 潜能: ~85 已生效 / ~12 未实现
- 武器: 45/56 触发武器正常，6 把触发缺失 + 3 把 stat 不可映射
- 装备套装: 12/21 触发效果 + 全 21 套常驻自动注入；5 套需 HP/治疗系统
- 最大阻塞: 受击/护盾/HP 系统 (~22 项)

**效果结算规则**: `reports/buff-timing-audit.md`
- 核心：先特效后伤害，嵌套递归，scoped deferred
- 消耗类判定移后规则（技能检查条件→消耗在伤害后）
- 已验证案例：佩丽卡、管理员+显赫声名+点剑、埃特拉冻结、别礼连携

**套装数据模板**: `reports/equipment-set-data-template.md`
- 全 21 套数据已填入（用户提供）

**历史文件**（已迁移至 `Archived_Report/`）:
- `pending-effects-audit.md`、`pending-skills-talents-2026-04-05.md`、`weapon-equipment-audit.md`、`skill-todo-2026-04-05.md` 等

## 其他注意事项

- Python 后端 (`apps/python-app/`) 基本闲置，TypeScript 引擎已完全替代其计算职能
- i18n 默认 zh-CN，localStorage key: `endaxis_locale`
- 场景数据通过 localStorage 持久化，使用 gzip 压缩
- 支持 PNG 水印嵌入和分享码导入导出
- ENDMINISTRATOR 潜能 3-5 在游戏内不可获取（最高 2 潜）
- vitest 需使用 `npx vitest@4.0.17 run` 运行（4.1.2 有模块解析 bug）
- 武器触发 buffs 数据在 `gamedata.json` weaponDatabase，_unknown trigger 已全部修复
- 角色 hit 位置数据在 `gamedata.json` characterRoster `{suffix}_damage_ticks`
- 终结技冷却数据在 `data/operators/ultimateCooldowns.json`
- 叠层 buff 默认 refresh 所有层持续时间（`addStackWithRefreshDuration`），仅 POGRANICHNK 士气用 independent
- 载体 independent buff 重新施放时先清空旧层再创建新层（Route 2.9）
- GILBERTA 战技引力模式期间锁定自身操作（`ISSUE_GLOBAL_ACTION_LOCK` 合法性检查）
- 攻击力公式：`ATK = floor(((base+weapon) × (1+pct%) + flat) × (1 + primary×0.5% + secondary×0.2%))`

## 前端：拟真排轴系统（已实现）

排轴编辑器双模式（自由/拟真），通过 `timelineEditorMode` 切换：
- **自由模式**: 无约束放置，切换到拟真前自动验证时间轴
- **拟真模式**: playhead 驱动，模拟游戏内技能释放流程

### 拟真模式核心功能
- **Playhead 移动**: 左右方向键（步长可调 0.1/0.5/1/5s）、Shift+左右跳转到技能边界
- **播放**: 空格键播放/暂停，播放时 playhead 固定在视口中心滚动时间轴，倍速 0.25/0.5/0.75/1/1.5/2x（+/- 调节）
- **技能快捷键**: 1-4 放战技、Alt+1-4 放终结技、E 放连携技（从队列）、A 放普攻、Shift+A 补全到重击
- **主控切换**: Q 顺序切换、F1-4 直接切换，2s 内置 CD
- **撤销/重做**: 快照含 playheadTime，技能放置/回退/移动均可撤销
- **保存**: Ctrl+S 立即持久化，伤害统计按钮也触发保存
- **时间回溯**: 向左移动时自动删除后方技能（带确认弹窗）
- **连携技队列**: 事件型条件触发 6s 窗口，圆形头像+倒计时环显示在 playhead 旁
- **技能可用性**: ActionLibrary 中不可用技能变灰，拖放到 playhead 前方被拒绝
- **浮点精度修复**: overlap 检查 1ms epsilon 容差，playhead 跳转用 Math.ceil 避免舍入误差
- **变体技能**: advancePlayheadAfterPlacement 使用 computedEffectiveActions 获取变体持续时间
- **阻塞弹窗**: `_warningActive` 锁防止操作期间重复弹窗

### 待实现
- 连携技队列 UI 细节优化（头像显示已基本完成，交互待打磨）
- 受击/HP 触发的连携技（EMBER/CATCHER/SNOWSHINE，需受击系统）
- 验证通过后进入新功能页面（待设计）
