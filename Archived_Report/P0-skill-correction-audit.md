# P0 个别技能真值校正 + UI 补口审计

---

## 总览结论

| 子任务 | 现状 | 分类 |
|---|---|---|
| A. ARDELIA 连携腐蚀 duration | 代码已通，**纯数据真值不对**（gamedata 写 10s，实际 7s） | 只差真值 |
| B. ARDELIA 战技消耗腐蚀 → vulnerable | **机制未落地**。有参考模式（consume_conduction），但无实现 | 需新实现 |
| C. ESTELLA physical_vulnerable | **代码已通**（Route 2.7 + T9 时序修正）。但存在"是否需要冻结前提"的条件问题 | 需人工核对条件 |
| D. Boss debuff 栏异常显示 | debuff 栏是**编译期**计算，不读 simulation 运行时状态。机制已设计（类型/颜色/过滤都齐），但 direct anomaly（burning 等）可能因 duration=0 显示为极短条 | UI 小修 + 数据适配 |

---

## A. ARDELIA 连携腐蚀 duration 审计

### 1. 涉及文件

| 文件 | 作用 |
|---|---|
| `public/gamedata.json` | ARDELIA link_anomalies: `[{type:"corrosion", stacks:1, duration:10, offset:2.4}]` |
| `src/simulation/simulator.ts` Route 2.5 | DIRECT_ANOMALY_MAP 路由 `corrosion` → APPLY_DIRECT_ANOMALY，传 durationOverride |
| `src/simulation/anomaly/EnemyStatusState.ts` | `applyCorrosion(level, sourceActorId, time, durationOverride?)` |

### 2. 当前状态

腐蚀施加链路**已完整打通**：
- Route 2.5 捕获 `corrosion` → enqueue `APPLY_DIRECT_ANOMALY`
- durationOverride 从 `resolvedEffect.node.duration`（=10）读取并传入
- `applyCorrosion` 使用 durationOverride（10）而非默认 CORROSION_DURATION（15）
- 腐蚀在 simulation 中正确生效（用户已确认管理员可受腐蚀影响）

### 3. 缺口

**纯数据真值错误**：gamedata 中 `duration: 10`，游戏实际为 **7 秒**（潜能 5 后 +4s = 11 秒）。

### 4. 最小修复

改 `public/gamedata.json` 中 ARDELIA link_anomalies 的 `duration: 10` → `duration: 7`。

### 5. 双真值源风险

无。duration 只从 gamedata 一条路径读入。

### 6. 潜能 5 的 +4s 扩展

`src/data/operators/ARDELIA/potentials.json` 潜能 5 记录了 "连携技腐蚀持续时间+4s"。当前 potentialLevel 影响 configuredStats 的 static effects，但 duration 扩展不在 static 路径上。后续需要在 simulation 层读取 potential effect 并动态调整 durationOverride。**本轮只改 gamedata 基础值，potential 扩展标记 TODO。**

---

## B. ARDELIA 战技"消耗腐蚀 → vulnerable"审计

### 1. 当前仓库状态

**无任何实现**。`skill_anomalies: []`（空），`skill_damage_ticks.boundEffects: []`（空）。

### 2. 技能描述（skills.json）

> "骑上多利先生冲撞目标，对目标造成自然伤害，若目标处于腐蚀状态，消耗其腐蚀状态，并对其施加物理脆弱与法术脆弱。"

### 3. 关键数值（skills.json levelData）

| 字段 | M3 值 |
|---|---|
| 伤害倍率 | 320% |
| 脆弱效果（%） | 20% |
| 脆弱效果持续时间 | 30s |

### 4. 机制分析

需要的逻辑：
1. ARDELIA 战技命中 → 检查 `enemy.status.corrosion` 是否存在
2. 如果存在 → 消耗腐蚀（`status.corrosion = null`）→ 施加 physical_vulnerable + spell_vulnerable
3. 如果不存在 → 只造成普通伤害

### 5. 参考模式

`consume_conduction` in `DamageHandler.ts:26-42`：
- 通过 `boundEffects` tag 在伤害结算后触发
- 检查 `enemy.status.conduction`，如存在则置 null
- 但 consume_conduction **只消耗**，不施加新效果

ARDELIA 需要扩展此模式：**消耗 + 条件施加**。

### 6. 建议实施方向

**方案 A（最小，推荐）**：在 `DamageHandler.processPostDamageEffects` 中新增 `"consume_corrosion_apply_vuln"` tag 处理。同时在 gamedata 中给 ARDELIA skill_damage_ticks 加上此 boundEffect。

**方案 B（备选）**：在 simulator.ts 中用 registerTriggeredBuff 注册 ARDELIA 专属 trigger（监听 DAMAGE_TICK，condition 检查 actorId + 腐蚀状态）。

方案 A 更贴合现有 consume_conduction 模式。

### 7. 脆弱数值来源

skills.json levelData 中已有"脆弱效果"行（M3 = 20%）和"脆弱效果持续时间"行（30s）。**不需要用 calcBreachPhysVulnerability 公式** — 这里是技能直接指定的固定值。

### 8. 需人工核对

- 物理脆弱和法术脆弱的百分比是否相同（均为 20%）还是分别不同
- 脆弱 30s 是否物理/法术共享同一持续时间
- 消耗腐蚀是否在伤害计算前还是后（影响本次伤害是否吃到脆弱）

### 9. 冲突风险

如果同时存在 ESTELLA 的 physical_vulnerable（Route 2.7）和 ARDELIA 施加的 physical_vulnerable，两者 id 相同（`"PHYSICAL_VULNERABLE"`），会被 `addOrRefreshBuff` 覆盖。这是正确行为（后者刷新前者）。spell_vulnerable 同理（id `"SPELL_VULNERABLE"`）。

---

## C. ESTELLA physical_vulnerable 时序审计

### 1. 涉及文件

| 文件 | 作用 |
|---|---|
| `public/gamedata.json` | ESTELLA link_anomalies: 3 groups（ice_shatter / knockup / physical_vulnerable） |
| `src/simulation/simulator.ts` Route 2.7 | 捕获 `physical_vulnerable` → addOrRefreshBuff on enemy.effects |
| `src/simulation/equipment/types.ts` | `isEffectActive` 已包含 startTime 下界检查（T9 修正） |

### 2. 当前状态

编译器将**全部 3 个 anomaly group**无条件编译进 action.effects。Route 2.7 在 setup 阶段创建 PHYSICAL_VULNERABLE Effect on enemy.effects。T9 修正了 `isEffectActive` 的 startTime 下界，效果现在只在 `[startTime, startTime+duration)` 内活跃。

### 3. 条件问题

技能描述："如果命中处于冻结状态的敌人，还会造成额外伤害并施加物理脆弱。"

**当前实现无条件检查** — physical_vulnerable 无论是否冻结都会施加。这与游戏描述不一致。

### 4. gamedata 数值

- `physical_vulnerable stacks: 1, duration: 6, offset: 0.63`
- 潜能 1：+3s → duration 应为 9s（但 potentials 的 duration 扩展未接入 runtime）

### 5. 需人工核对

- physical_vulnerable 的百分比值：当前用 `calcBreachPhysVulnerability(1, artsPower)`（= 12%@ap=0）。但如果 ESTELLA skills.json 中有专属脆弱百分比字段，应以该字段为准
- 冻结条件是否必须（如果必须，需要在 Route 2.7 加 condition 检查）
- 非冻结目标命中时，是否只触发 knockup 而不触发 physical_vulnerable

### 6. 当前前端可观察

由于 Route 2.7 在 setup 阶段无条件注册，目前 physical_vulnerable 应该始终生效（只要时间窗口内）。如果用户测试发现不生效，说明有其他问题。

---

## D. Boss debuff 栏异常显示审计

### 1. 涉及文件

| 文件 | 作用 |
|---|---|
| `src/components/TimelineGrid.vue:589-590` | 从 `store.debuffStatuses` + `store.computedAnomalyDebuffsEffective` 组合渲染 |
| `src/stores/timelineStore.js:5644-5723` | `computedAnomalyDebuffs` — 从编译期 `action.physicalAnomaly` 数据计算 debuff 段 |
| `src/stores/timelineStore.js:5976-6000` | `computedAnomalyDebuffsEffective` — 在 computedAnomalyDebuffs 基础上做转换 |
| `src/stores/timelineStore.js:260-267` | `DEBUFF_ANOMALY_TYPES` — 已包含 burning/frozen/conductive/corrosion |
| `src/stores/timelineStore.js:247-250` | 颜色定义 — 已为全部异常类型定义颜色 |

### 2. 关键发现：debuff 栏是编译期计算

**确认事实**：Boss debuff 栏**不读 simulation 运行时状态（EnemyStatusState）**。它读的是 `computedAnomalyDebuffsEffective`，这是从编译期 `action.physicalAnomaly` 数据用状态机推算的。

### 3. 为什么异常不显示

`burning / conductive / frozen / corrosion` 这些 direct anomaly 类型已在 `DEBUFF_ANOMALY_TYPES` 中注册，颜色也已定义。但实际显示取决于：

1. action 的 `physicalAnomaly` 数据中是否包含这些类型 → **包含**（如 WULFGARD ultimate 有 `burning`）
2. `_resolveAnomalyDebuffBarDuration` 能否为这些类型计算正确 duration：
   - 如果 gamedata `duration > 0`（如 ARDELIA corrosion duration=10），**能正确显示**
   - 如果 gamedata `duration = 0`（如 WULFGARD burning duration=0），回退到默认 0.35s → **几乎不可见**
3. 编译期状态机是否能追踪跨元素反应产生的异常 → **已有 ANOMALY_REACTION_DURATIONS 映射**

**最可能原因**：
- WULFGARD `burning` 的 gamedata duration=0 → debuff 条只有 0.35s 宽，几乎看不到
- 通过附着反应产生的异常（如 fire+electro→conduction）可能被编译期状态机正确追踪，但显示为系统默认持续时间
- 或者编译期状态机的反应检测与 runtime 的 MagicReactionResolver 行为不完全一致

### 4. 最小补口方向

**方案 A（推荐）**：不改 UI 组件，只修 `_resolveAnomalyDebuffBarDuration` 对 direct anomaly 类型的 duration 回退逻辑：
- `burning` duration=0 时 → 回退到 `ANOMALY_REACTION_DURATIONS.burning`（10s）
- `corrosion` duration=0 时 → 回退到 15s
- `conductive` duration=0 时 → 回退到 `CONDUCTION_DURATION_BY_LEVEL[1]`（12s）
- `frozen` duration=0 时 → 回退到 `FREEZE_DURATION_BY_LEVEL[1]`（6s）

**方案 B（更大但更准确）**：让 debuff 栏从 simulation simLog / EnemyStatusState 读取运行时状态而非编译期推算。改动面大，本轮不推荐。

### 5. 双真值源风险

方案 A 的 duration 回退值（10s/15s/12s/6s）与 `anomaly/types.ts` 中的常量一致，不新增真值源。

---

## E. 建议给人工的测试点

### E1. ARDELIA 连携腐蚀持续时间

| 项 | 内容 |
|---|---|
| 技能 | ARDELIA 连携技 |
| 要确认 | 腐蚀实际持续时间 |
| 测试方法 | 游戏内释放 ARDELIA 连携 → 观察腐蚀 debuff 图标从出现到消失的秒数 |
| 记录数据 | 持续时间（秒）。潜能 0 时应为 7s，潜能 5 时应为 11s |

### E2. ARDELIA 战技消耗腐蚀后的脆弱数值

| 项 | 内容 |
|---|---|
| 技能 | ARDELIA 战技（目标已有腐蚀时） |
| 要确认 | 物理脆弱和法术脆弱的百分比、持续时间、是否相同 |
| 测试方法 | 先施加腐蚀 → 释放 ARDELIA 战技 → 观察目标 debuff 栏出现的脆弱图标和数值 |
| 记录数据 | 物理脆弱%、法术脆弱%、持续时间。Skills.json 记录 M3 = 20%、30s，需游戏验证 |

### E3. ARDELIA 战技不消耗腐蚀时的行为

| 项 | 内容 |
|---|---|
| 技能 | ARDELIA 战技（目标无腐蚀时） |
| 要确认 | 无腐蚀时是否完全不施加脆弱 |
| 测试方法 | 不施加腐蚀 → 直接释放 ARDELIA 战技 → 观察目标是否出现脆弱 debuff |
| 记录数据 | 有/无脆弱 debuff |

### E4. ESTELLA 连携物理脆弱条件

| 项 | 内容 |
|---|---|
| 技能 | ESTELLA 连携技 |
| 要确认 | 物理脆弱是否需要目标处于冻结状态才施加 |
| 测试方法 | 1) 不冻结目标 → 释放 ESTELLA 连携 → 观察是否有物理脆弱。2) 冻结目标 → 释放连携 → 观察 |
| 记录数据 | 冻结/非冻结下是否出现物理脆弱 debuff，脆弱百分比，持续时间 |

### E5. ESTELLA 连携物理脆弱数值

| 项 | 内容 |
|---|---|
| 技能 | ESTELLA 连携技（命中冻结目标时） |
| 要确认 | 物理脆弱的百分比值和持续时间 |
| 测试方法 | 冻结目标 → 释放连携 → 观察脆弱数值。对比 skills.json 是否有脆弱效果行 |
| 记录数据 | 物理脆弱%、持续时间。gamedata 写 6s，潜能 1 +3s → 9s |
