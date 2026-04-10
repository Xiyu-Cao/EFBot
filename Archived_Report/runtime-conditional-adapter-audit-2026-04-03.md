# Runtime Conditional 通用分发层审计报告

> 审计时间: 2026-04-03
> 前置已完成: P1-A (resistance_ignore) + ICD 暴露 + boundEffect 注册表化
> 原则: 只审计不实现；区分"已从仓库确认"和"推测"

---

## A. 所有 runtime_conditional 数据的完整形态

### 涉及文件 [已从代码确认]

12 个干员的 `data/operators/*/talents.json` 中存在 `scope: "runtime_conditional"` 效果。

### 效果对象字段清单 [已从代码确认]

**所有 24 个 runtime_conditional 效果对象的字段完全一致**，均为 6 个字段：

| 字段 | 类型 | 说明 | 所有效果均有 |
|------|------|------|-------------|
| `type` | string | 效果类型: `"stat_bonus"` / `"damage_bonus"` / `"gauge_modifier"` | ✅ |
| `stat` | string | 目标属性: `"attack_percent"` / `"blaze_dmg"` / `"physical_dmg"` / `"ult_gauge_gain"` | ✅ |
| `value` | number | 数值 | ✅ |
| `unit` | string | 单位: `"percent"` / `"flat"` | ✅ |
| `scope` | string | 固定 `"runtime_conditional"` | ✅ |
| `note` | string | 人类可读描述 | ✅ |

**不存在的字段**：duration、maxStacks、trigger、target、consume、cooldown、condition、event 等触发语义字段在数据中**完全不存在**。所有触发语义（事件类型、条件、持续时间、叠层规则、ICD）只能从天赋描述文本中推断。

### type 分布 [已从代码确认]

| type | 干员数 | 效果数(含升级) |
|------|--------|---------------|
| `stat_bonus` (stat=`attack_percent`) | 8 | 16 |
| `damage_bonus` (stat=`blaze_dmg` / `physical_dmg`) | 2 | 4 |
| `gauge_modifier` (stat=`ult_gauge_gain`) | 2 | 4 |

---

## B. 是否存在可抽象的一致结构

### 最小公共子集 [已从代码确认]

**有**。所有 24 个效果对象结构完全一致（6 个固定字段，无变体）。公共子集就是全集：

```typescript
interface RuntimeConditionalEffect {
  type: "stat_bonus" | "damage_bonus" | "gauge_modifier";
  stat: string;
  value: number;
  unit: "percent" | "flat";
  scope: "runtime_conditional";
  note: string;
}
```

### 主要不一致点

不一致不在**数据结构**层面，而在**语义层面**：

1. **effect.type 的实际含义与天赋描述不总是对应**：
   - LIFENG/CATCHER 的 type=`stat_bonus`, stat=`attack_percent` 在描述中是"额外造成 X% 攻击力的伤害"（extra damage instance），而非"攻击力+X%"（buff）
   - ROSSI talent_0 的 type=`stat_bonus`, stat=`attack_percent` 在描述中是"每秒受到攻击力 X% 的物理伤害"（DOT），而非 buff

2. **触发语义完全不在数据中**：
   - 事件类型、条件、持续时间、叠层、ICD 只在 description 文本中
   - adapter 必须通过"角色→触发描述符"映射来补充这些信息

3. **gauge_modifier 走的不是 DynamicBonus 管线**：
   - ALESH/AVYWENNA 的效果是终结技能量增加，不是伤害加成
   - registerTriggeredBuff 的 action 当前只做 addBuff/addStack，无 gauge 修改能力

---

## C. 角色分类清单

### A 类：已有事件即可支持，self buff / refresh / stack

| 干员 | 天赋 | 事件 | buff 模式 | 说明 |
|------|------|------|----------|------|
| **WULFGARD** | 灼热獠牙 | APPLY_DIRECT_ANOMALY | refresh, 10s | ✅ 已实现 |
| **CHENQIANYU** | 斩锋 | DAMAGE_TICK | stack(5), 10s | ✅ 已实现 |

**A 类中没有尚未实现的角色。** 这两个是仅有的"现有事件 + 纯 self buff"的角色。

### B 类：已有事件基本够用，但有额外复杂性

| 干员 | 天赋 | 事件 | 额外复杂性 | 可行性 |
|------|------|------|-----------|--------|
| **POGRANICHNK** | 活着的旗帜 | SP_CHANGE | 需累加器(每回复80SP触发一次)；数据只含 attack_percent，**缺 originium_arts_power +4/8** | 可用 condition 闭包做累加；arts_power 需补数据或硬编码第二项 bonus |
| **DAPAN** | 勾芡 | APPLY_PHYSICAL_ANOMALY | 描述说"每消耗1层破防"，但 APPLY_PHYSICAL_ANOMALY 在 break 存在时才产生消耗；需条件检查 target break 状态 | [推测] 可能可行，需验证 PhysicalReactionResolver 触发 APPLY_PHYSICAL_ANOMALY 的时序——消耗 break stacks 是在 handler 内部还是产出的事件本身就包含"消耗了几层" |

### C 类：需要新增 runtime 事件

| 干员 | 天赋 | 需要的新事件 | 理由 |
|------|------|-------------|------|
| **ENDMINISTRATOR** | 本质瓦解 | ATTACHMENT_CONSUMED 或类似 | "源石结晶被消耗后"——结晶是 ENDMINISTRATOR 独有 debuff，消耗发生在内部，无事件产出 |
| **EMBER** | 以铁还铁 | DAMAGE_TAKEN | "受到来自敌人的伤害后"——当前事件系统只有出向伤害，无入向伤害事件 |
| **FLUORITE** | 捉摸不定 | DAMAGE_BLOCKED 或概率机制 | "有20%的概率免疫法术伤害"——需要概率判定 + 伤害免疫事件，当前均不存在 |

### D 类：本质不是 registerTriggeredBuff 型 conditional

| 干员 | 天赋 | 实际语义 | 为什么不是 buff | 数据的 type/stat/value 含义 |
|------|------|----------|---------------|--------------------------|
| **LIFENG** | 伏魔 | 击倒时**额外造成 50/100% ATK 物理伤害** | 是一次性 extra damage instance，不是 buff | value=50/100 表示伤害倍率，不是 ATK% buff |
| **CATCHER** | 全局思维 | 终结技最后一击**产生 2/3 次冲击波，每次造成 30/45% ATK 物理伤害** | 是多次 extra damage instances | value=30/45 表示单次冲击波倍率 |
| **ROSSI** | 斫痕 | 战技命中后**对目标施加 DOT(每秒 25/30% ATK 物理伤害) + 易伤(物理/灼热+6/12%)** | 是 enemy debuff + DOT，不是 self buff | value=25/30 表示 DOT 倍率；+6/12% 易伤不在结构化数据中 |
| **ROSSI** | 沸血 | 对标记敌人暴击时**额外触发 12/24% ATK 灼热伤害** | 是 extra damage on crit，非 buff | value=12/24 表示额外伤害倍率 |
| **ALESH** | 闪冻锁鲜 | 附近冻结/结晶 → **获得 3/4 终结技能量**；自身冻结额外 +6/8 | gauge_modifier，不走 DynamicBonus | value=3/4 是终能点数，非伤害加成 |
| **AVYWENNA** | 高效派送 | 雷枪命中 → **获得 3/4 终结技能量** | gauge_modifier；雷枪是 compile-time prepass | value=3/4 是终能点数 |

---

## D. WULFGARD / CHENQIANYU 两个样例的共同模式

### 共同模式 [已从代码确认]

```
1. 从 _activeEffects 中找到匹配的 effect (按 type + stat)
2. 读取 effect.value
3. 确定 trigger 配置:
   - event 类型 (APPLY_DIRECT_ANOMALY / DAMAGE_TICK)
   - condition 回调
   - duration (硬编码 10s)
   - stack 配置 (无 / {group, max})
4. 构造 DynamicBonus:
   - stat → DynamicBonusStat 映射
   - zone 选择 (默认 damageBonus / 或 attackPercent)
5. 调用 registerTriggeredBuff()
```

### 各自依赖的已有事件 [已从代码确认]

| | WULFGARD | CHENQIANYU |
|---|---|---|
| 事件 | APPLY_DIRECT_ANOMALY | DAMAGE_TICK |
| 条件 | `e.payload?.anomalyType === "burn"` | `action.node.type ∈ {skill, link, ultimate}` |
| 持续时间 | 10s | 10s |
| 叠层 | 无（refresh） | 5 层 independent |
| ICD | 无 | 无 |
| 数据→bonus 映射 | `blaze_dmg → { stat: "blaze_dmg", value }` | `attack_percent → { stat: "all_dmg", value, zone: "attackPercent" }` |

### 可复用的部分

1. `registerTriggeredBuff()` helper — 完全可复用
2. `_activeEffects` 过滤模式 (`scope === "runtime_conditional" && e.value`) — 可复用
3. effect.value 读取 — 可复用

### 不可复用（样例级写法）的部分

1. **角色 ID 分发**：`if (actorId === "WULFGARD")` — 这是要被 adapter 替代的核心
2. **effect 查找逻辑**：`conditionals.find(e => e.type === "damage_bonus" && e.stat === "blaze_dmg")` — 每个角色的 type+stat 匹配不同
3. **触发配置硬编码**：event、condition、duration、stack 全部硬编码在 if 块内
4. **bonus 映射硬编码**：`{ stat: "blaze_dmg", value }` vs `{ stat: "all_dmg", value, zone: "attackPercent" }` — 两者映射方式不同

### CHENQIANYU 的一个隐式映射问题 [已从代码确认]

数据层 `stat: "attack_percent"` 被映射为 runtime 层 `{ stat: "all_dmg", zone: "attackPercent" }`。这个映射是隐式的——数据中没有"这是 attackPercent zone"的信息，是硬编码在角色 if 块里的。adapter 需要显式处理 `stat_bonus + attack_percent` → `DynamicBonus { stat: "all_dmg", zone: "attackPercent" }` 的映射。

---

## E. 最小 adapter 应落在哪个文件

### 比较

| 方案 | 优势 | 劣势 |
|------|------|------|
| **simulator.ts 附近 helper** | 改动最小；与现有 registerTriggeredBuff 紧密配合 | simulator.ts 已较大（400+行），继续增长会难维护 |
| **单独 talentConditionalAdapter.ts** | 职责清晰；测试容易隔离 | 新增文件；需要暴露 registerTriggeredBuff 或传入注册函数 |
| **simulation/data/ 目录下新文件** | 与 skillMultipliers.ts / skillStatusRegistry.ts 同级，模式一致 | 同上 |

### 建议 [推测]

**新建 `simulation/data/talentConditionalRegistry.ts`**。理由：

1. `simulation/data/` 目录已有 `skillMultipliers.ts`（技能倍率映射）和 `skillStatusRegistry.ts`（技能状态映射），再加一个 talent conditional 映射是同一类职责
2. 注册表内容是"角色+天赋 → 触发描述符"的静态映射，属于数据层而非引擎层
3. simulator.ts 只需调一个 `registerTalentConditionals(actors, registerTriggeredBuff)` 函数，替换现有的 if-else 块
4. 不需要暴露 engine 细节——adapter 接收 `registerTriggeredBuff` 作为回调参数即可

---

## F. 最小 adapter 的输入输出

### 输入

**一个 actor 的 conditionals 数组 + actorId + 注册回调**：

```
输入: (actorId: string, conditionals: ActiveEffect[], register: typeof registerTriggeredBuff)
```

不需要传入 actor 全量信息。conditionals 已经是过滤后的 `scope === "runtime_conditional"` 效果列表。

### 输出

**直接调用 register()**。不需要中间层 descriptor。

理由：
- 当前只有 2+N 个角色需要注册，不需要"先产出 descriptor 再统一注册"的间接层
- registerTriggeredBuff 的签名已经是足够好的"注册描述符"
- 如果未来需要序列化/审查 trigger 配置，再加 descriptor 中间层不迟

### 是否需要标准 descriptor 中间层

**本轮不需要。** 理由：

1. descriptor 中间层的价值在于"可序列化、可审查、可测试"
2. 当前只是把 if-else 搬到 Map 查找 + 函数调用，复杂度不够高到需要中间层
3. 如果未来角色超过 10 个且需要 UI 展示"哪些 conditional 已激活"，再引入

### 核心设计：trigger 描述符 Map

adapter 的核心是一个静态 Map，key 是 `actorId`，value 是一个函数，负责从 conditionals 中取值并调用 register：

```
Map<actorId, (conditionals, register) => void>
```

这个 Map 里的每个 entry 就是当前 simulator.ts 里一个 `if (actorId === "XXX") { ... }` 块的等价物，只是从内联 if-else 搬到了声明式注册。

### effect.type + effect.stat → DynamicBonus 的映射

需要一个小工具函数处理已知的映射：

| effect.type | effect.stat | DynamicBonus.stat | DynamicBonus.zone |
|---|---|---|---|
| `damage_bonus` | `blaze_dmg` | `"blaze_dmg"` | default(damageBonus) |
| `damage_bonus` | `physical_dmg` | `"physical_dmg"` | default(damageBonus) |
| `stat_bonus` | `attack_percent` | `"all_dmg"` | `"attackPercent"` |

这个映射是确定性的，不依赖角色。可以做成通用函数。

---

## G. 本轮最小支持矩阵

### 支持

| 项 | 说明 |
|---|---|
| A 类角色自动注册 | WULFGARD / CHENQIANYU 从 if-else 迁移到 adapter Map |
| effect.type → DynamicBonus 通用映射 | `damage_bonus` → 对应 stat/zone；`stat_bonus(attack_percent)` → attackPercent zone |
| refresh 模式 | 无 stack 参数 = addOrRefreshBuff |
| stack 模式 | stack: { group, max } = addStackWithIndependentDuration |
| ICD (透传) | cooldownId + cooldownDuration 已暴露 |
| 触发描述符按 actorId 查找 | Map<actorId, handler> |

### 暂不支持

| 项 | 理由 |
|---|---|
| gauge_modifier 类效果 | registerTriggeredBuff 的 action 只做 addBuff/addStack，不修改 gauge。ALESH/AVYWENNA 需要另一种 action 路径。**不在本轮扩展** |
| extra damage instance (D 类) | LIFENG/CATCHER/ROSSI 需要在 trigger action 中 enqueue DAMAGE_TICK 而非 addBuff。**本质上不是 buff 型 conditional，不应走此通道** |
| SP 累加器模式 | POGRANICHNK 需在 condition 闭包中维护累加状态。adapter 可以支持（condition 是任意回调），但**数据不完整**（缺 arts_power bonus）。建议先补数据再接入 |
| 新事件类型 | ENDMINISTRATOR/EMBER/FLUORITE 需要的事件不存在。**不在本轮新增** |
| enemy debuff 型 | ROSSI talent_0 需要 target=enemy 的 DOT + 易伤。**语义超出 buff 范畴** |
| 从 talents.json 自动推断触发语义 | 触发配置仍需手写在 adapter 中，只是不再内联到 simulator.ts |

### 双真值源风险提醒

- adapter 中的触发配置（event、condition、duration、stack）是**代码层硬编码**
- talents.json 中的 value 是**数据层真值**
- 二者必须配合才能正确注册
- 如果 talent description 变化（如天赋持续时间从 10s 改为 15s），adapter 的硬编码 duration 不会自动更新
- **这不是新的双真值源**——之前在 simulator.ts 的 if-else 里就是这样，adapter 只是把它从分散的 if-else 收编到一个 Map

---

## H. 第一批验证角色推荐

### 结论：第一批验证角色是 WULFGARD + CHENQIANYU（迁移验证）

理由：
- 它们是唯二已实现的 conditional，迁移到 adapter 后可以直接对比行为是否一致
- 不引入任何新角色 → 纯结构重构，零行为变化
- 伤害统计面板可用于 A/B 对比验证（迁移前后数值应完全一致）

### 如果要加第三个新角色

**推荐不在本轮加新角色。** 理由：

1. **POGRANICHNK** 最接近 A/B 类，但：
   - 需要 SP 累加器模式（condition 闭包中维护状态）
   - 天赋数据只含 attack_percent，**缺 originium_arts_power +4/8**——需先补数据
   - SP_CHANGE 事件的 `reason` 字段区分 "skill"/"damage"/"execution"，需要只统计 reason==="skill" 且 spChange > 0 的恢复量 [已从代码确认]
   - 这些额外复杂性会让 adapter 的"最小验证"变成"最小验证 + 累加器 + 数据补全"

2. **DAPAN** 的"每消耗1层破防"需要验证 APPLY_PHYSICAL_ANOMALY 事件是否在 break 消耗时触发 [需运行验证]

3. 所有其他角色要么需新事件(C类)，要么不是 buff 型(D类)

**建议**：adapter 本体 + WULFGARD/CHENQIANYU 迁移先做。POGRANICHNK 作为 adapter 完成后的第一个新角色，单独一步接入（同时补 talent 数据）。

---

## 补充：最容易引入双真值源或特判回潮的位置

### 1. effect.type+stat → DynamicBonus 映射函数

如果这个映射函数做得不够通用，后续角色可能绕过它直接硬编码 bonus。**建议**：映射函数覆盖所有已知 type+stat 组合，未知组合抛 diagnostic warning。

### 2. adapter Map 中的触发配置 vs 天赋描述

adapter 中的 duration/stack/condition 是硬编码的，来源是人工阅读天赋描述。如果天赋描述更新但 adapter 没改 → 不一致。**这是已知的结构性限制**，不是本轮能解决的。长期方案是扩展 talents.json 的 effect schema 加入触发字段。

### 3. simulator.ts 中的残留 if-else

迁移后必须完全删除原有的 WULFGARD/CHENQIANYU if-else。如果保留旧代码作为"fallback" → 形成双注册路径。**必须确保旧代码完全被 adapter 替代后删除**。
