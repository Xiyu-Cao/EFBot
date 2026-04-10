# POGRANICHNK 上游技能真值补口审计

> 审计时间: 2026-04-03
> 前置已完成: runtime_conditional adapter + POGRANICHNK 代码接入 + 17 个自动化测试通过
> 目标: 找出阻塞 POGRANICHNK 前端实战验证的最小上游缺口

---

## A. 真值定义落在哪些文件

| 层级 | 文件 | 内容 |
|------|------|------|
| 静态技能定义 | `data/operators/POGRANICHNK/skills.json` | 12 级倍率表（战技/连携/终结/普攻），含碎甲层数→SP 回复映射 |
| 天赋定义 | `data/operators/POGRANICHNK/talents.json` | 活着的旗帜（runtime_conditional）+ 战术教导（parsed_unimplemented） |
| gamedata 编译数据 | `public/gamedata.json` → POGRANICHNK 条目 | action tick 定义、anomaly 定义、variant 定义 |
| 倍率运行时 | `simulation/data/skillMultipliers.ts` | 无硬编码 overlay，走 skills.json per-level fallback |
| 状态注册 | `simulation/data/skillStatusRegistry.ts` | 无 WIP_OVERRIDES，所有技能报 "wip"（estimated） |
| conditional 注册 | `simulation/data/talentConditionalRegistry.ts` | SP 累加器 + ATK% stack 描述符已注册 |

---

## B. 战技当前到底缺什么

### 战技基础 action（粉碎阵线）[已从代码确认]

gamedata.json 中的基础 skill action：

```json
skill_damage_ticks: [
  { offset: 0.93, sp: 0, stagger: 5, boundEffects: [] },
  { offset: 1.27, sp: 0, stagger: 5, boundEffects: [] }
]
skill_anomalies: []          // ← 空！基础 action 不施加任何异常
skill_spCost: 100
skill_gaugeGain: 6.5
```

**关键发现：基础 skill action 的两个 tick 的 sp 均为 0，且 anomalies 为空数组。**

### 战技 variants（碎甲一/二/三/四）[已从代码确认]

gamedata.json 中有 4 个战技 variant：

| Variant | 碎甲层数 | 第 2 tick SP | physicalAnomaly |
|---------|---------|-------------|-----------------|
| 战技碎甲一 | 1 | 5 | `armor_break, stacks:1, duration:12` |
| 战技碎甲二 | 2 | 10 | `armor_break, stacks:2, duration:18` |
| 战技碎甲三 | 3 | 20 | `armor_break, stacks:3, duration:24` |
| 战技碎甲四 | 4 | 30 | `armor_break, stacks:4, duration:30` |

**variant 中有完整的碎甲效果 + SP 回复定义。**

### 结论：战技不是"缺数据"，而是"用户需在排轴中选择正确的 variant"

| 维度 | 状态 | 说明 |
|------|------|------|
| 物理异常 (armor_break) | ✅ 数据存在于 variant | variant 的 physicalAnomaly 有 armor_break 定义 |
| SP 回复 | ✅ 数据存在于 variant | variant 的第 2 tick 有 sp: 5/10/20/30 |
| 基础 action | ⚠️ 无异常无 SP | 如果用户放置的是基础 skill action（非 variant），则无碎甲无 SP 回复 |
| variant → runtime 路由 | ✅ 已有路径 | simulator.ts 中 physicalAnomaly → APPLY_PHYSICAL_ANOMALY 路由已存在 |
| runtime 碎甲消费 | ✅ 已有路径 | PhysicalReactionResolver 处理 armorBreak → physical vulnerable |

**实际阻塞点**：如果前端测试时用户放置了基础 skill 而非碎甲 variant → 无碎甲 → 无 SP 回复 → 天赋不触发。**这不是代码缺口，而是排轴操作问题。**

但需注意：基础 action 的 `skill_allowed_types: ["armor_break","break","ice_shatter"]` 说明该技能可以绑定碎甲效果。在 DataEditor/PropertiesPanel 中，用户可以手动添加 armor_break 效果。variant 是另一种预置方式。

---

## C. 终结技 buff 当前到底缺什么

### 终结技 action [已从代码确认]

gamedata.json 中的 ultimate action：

```json
ultimate_damage_ticks: [
  { offset: 2.47, sp: 0,   stagger: 10, boundEffects: [] },            // 进军
  { offset: 2.53, sp: 7.5, stagger: 0,  boundEffects: ["m9q4vrs"] },   // 袭扰 1
  { offset: 2.53, sp: 7.5, stagger: 0,  boundEffects: ["dy0miki"] },   // 袭扰 2
  { offset: 2.53, sp: 7.5, stagger: 0,  boundEffects: ["jnrk1xi"] },   // 袭扰 3
  { offset: 2.53, sp: 7.5, stagger: 0,  boundEffects: ["vv7yqfc"] },   // 袭扰 4
  { offset: 2.53, sp: 30,  stagger: 15, boundEffects: ["vkah20e"] }    // 决胜
]

ultimate_anomalies: [[
  { type: "pograni_buff", stacks: 1, duration: 0, offset: 2.53, _id: "m9q4vrs" },
  { type: "pograni_buff", stacks: 2, duration: 0, offset: 2.53, _id: "dy0miki" },
  { type: "pograni_buff", stacks: 3, duration: 0, offset: 2.53, _id: "jnrk1xi" },
  { type: "pograni_buff", stacks: 4, duration: 0, offset: 2.53, _id: "vv7yqfc" },
  { type: "pograni_buff", stacks: 5, duration: 0, offset: 2.53, _id: "vkah20e" }
]]
```

### 终结技在 runtime 中的行为

终结技的 6 个 tick 全部在 simulator.ts 中入队为 DAMAGE_TICK 事件。每个 tick 的 `sp` 字段（7.5 / 7.5 / 7.5 / 7.5 / 30）会被 DamageHandler 入队为 SP_CHANGE 事件（reason="damage"）。

**6 个 tick 共产生 SP 回复**：7.5 × 4 + 30 = **60 SP**。

`pograni_buff`（铁誓）效果通过 ultimate_anomalies 定义，由 simulator.ts 的效果路由处理。但 `pograni_buff` 不在 `ELEMENT_ATTACH_MAP` / `PHYSICAL_ANOMALY_MAP` / `DIRECT_ANOMALY_MAP` 中 → 走 **legacy EFFECT_START fallback 路径**。

### 终结技的实际缺口

| 维度 | 状态 | 说明 |
|------|------|------|
| 进军伤害 (tick 0) | ✅ 有倍率 | 通过 skills.json per-level |
| 袭扰伤害 (tick 1-4) | ✅ 有倍率 | 通过 skills.json 3-row group map 分配 |
| 决胜伤害 (tick 5) | ✅ 有倍率 | 通过 skills.json 3-row group map 分配 |
| SP 回复 (per tick) | ✅ 有数据 | tick.sp = 7.5/7.5/7.5/7.5/30 → SP_CHANGE events |
| 铁誓 buff (pograni_buff) | ⚠️ 路由不通 | `pograni_buff` 不在三个 anomaly MAP 中，走 legacy EFFECT_START 路径，但该路径已标注"not used by main loop" |

**铁誓 buff 的实际影响**：在当前简化模型中，终结技的 6 个 tick 已经固化为 gamedata 定义（不是动态反应式触发）。铁誓 buff 本应用于"消耗铁誓触发袭扰/决胜"的反应式机制，但 gamedata 已将其简化为固定 6 tick。**铁誓 buff 的缺失不影响终结技的伤害和 SP 回复，因为这些已经是固定 tick。**

---

## D. 为什么前端排轴中无法自然观察到天赋 conditional 触发

### 完整阻塞链路

```
1. 用户在排轴中放置 POGRANICHNK 的 skill action
   → 如果放的是基础 action（非碎甲 variant）
   → tick.sp = 0（两个 tick 都无 SP 回复）
   → 无 SP_CHANGE 事件
   → 天赋累加器不累计
   → 天赋不触发

2. 即使使用碎甲 variant（如"战技碎甲四"）
   → tick 2 有 sp: 30
   → DamageHandler 入队 SP_CHANGE(spChange=30, reason="damage")
   → 天赋累加器 += 30（需 80 才触发一次）
   → 需要多次使用技能才能触发

3. 同时放置 link action
   → 基础 link 3 tick: sp=5+7+23 = 35
   → SP_CHANGE 事件产生（reason="damage"）
   → 天赋累加器 += 35

4. 同时放置 ultimate action
   → 6 tick: sp=0+7.5+7.5+7.5+7.5+30 = 60
   → SP_CHANGE 事件产生（reason="damage"）
   → 天赋累加器 += 60
```

**实际数值估算**：
- 1 次碎甲四 skill: sp = 30 (tick)
- 1 次 link: sp = 35 (tick)
- skill 结束时 spGain: 取决于 skills.json 定义 [需验证具体 spGain 值]
- 1 次 ult: sp = 60 (tick)

**如果排轴包含 1 skill(碎甲四) + 1 link**：tick SP = 30 + 35 = 65。加上 skill/link 的 spGain（如果有），可能接近但不到 80。需要至少 2 组操作才能触发一次天赋。

**关键问题**：前端测试时如果使用了基础 skill（无 variant）→ tick sp = 0 → 只有 spGain 回复（通常较低）→ 需要非常多操作才能累计到 80。

---

## E. 最值得先做的最小缺口

### 结论：不需要改代码。需要的是一个正确的测试排轴。

经过审计确认：
1. **碎甲 variant 数据完整**——physicalAnomaly + SP 回复都在 variant 中定义
2. **variant → runtime 路由已存在**——simulator.ts 中 physicalAnomaly 路由到 APPLY_PHYSICAL_ANOMALY
3. **SP_CHANGE 事件从 tick.sp 正确产生**——DamageHandler L236-248
4. **天赋累加器正确响应 SP_CHANGE**——17 个自动化测试验证

**真正的阻塞不是代码缺口，而是前端测试排轴没有使用碎甲 variant**。

### 最小验证方案

在前端排轴中：
1. 添加 POGRANICHNK track
2. 放置 **碎甲四 variant**（`战技碎甲四`）而非基础 skill → 这会产生 sp=30 + armor_break
3. 放置 **link action** → 产生 sp=5+7+23=35
4. 放置 **ultimate action** → 产生 sp=60
5. 以上组合 tick SP 合计 = 30 + 35 + 60 = 125 → 超过 80 阈值
6. 点击"伤害统计"→ 观察是否有伤害提升

### 但如果经人工测试确认 variant 放置后仍然无效

那问题可能在以下任一环节 [推测/需运行验证]：
- variant 的 physicalAnomaly 是否被 compileScenario 正确编译到 ResolvedTimeline
- physicalAnomaly 中 armor_break 是否被 simulator.ts 的效果路由正确识别
- SP_CHANGE 事件是否被 TriggerProcessor 传递到天赋 trigger

这些需要运行时验证，不是静态审计能确认的。

---

## F. 前端最适合观察哪些信号

### 按优先级排序

| 优先级 | 观察窗口 | 验证什么 | 可信度 |
|--------|---------|---------|--------|
| 1 | **伤害统计面板** | 碎甲四 variant + link + ult 排轴中，后期技能伤害是否高于前期（天赋叠层效果） | 高（如果天赋生效，ATK% 加成直接体现在伤害数值上） |
| 2 | **Boss debuff 栏** | 碎甲 variant 使用后，boss 是否出现 armor_break / physical_vulnerable debuff | 高（直观确认碎甲是否施加成功） |
| 3 | **simLog（开发者工具）** | SP_CHANGE 条目：观察 spChange 值和 reason，确认累计是否达到 80 | 中（需查看 console） |
| 4 | **simLog EFFECT_START** | 是否出现 `pogranichnk_morale_stack_N` 的 effect 创建日志 | 中（确认 buff 是否被创建） |

---

## G. 明确留到后续的部分

| 项目 | 留后续的理由 |
|------|------------|
| originium_arts_power runtime 消费 | 需要 ActorState 动态字段 + 异常公式读取点改造，超出最小补口范围 |
| 铁誓 buff (pograni_buff) 反应式消耗机制 | gamedata 已将终结技简化为固定 6 tick，反应式机制属于终结技真值精修 |
| 连携 variant 动态选择（根据碎甲层数自动选 1/2/3 hit） | 需要 runtime variant 选择器，属于新系统 |
| 天赋 2 "战术教导"（队友获得士气激昂） | 标记 parsed_unimplemented，需 team-wide buff 机制 |
| 全角色 physical anomaly 真值校正 | 不应混进本轮 |
| 全角色 ult buff runtime 接入 | 不应混进本轮 |
| extra damage / enemy debuff 通用系统 | 不应混进本轮 |
| 新 runtime 事件（DAMAGE_TAKEN / CRYSTAL_CONSUMED 等） | 不应混进本轮 |

---

## 结论

### 最小阻塞点

**不是代码缺口。** 碎甲 variant 数据完整、SP 回复链路完整、天赋触发器已通过自动化测试验证。阻塞来自前端排轴测试时**未使用碎甲 variant**（使用了基础 skill action，其 tick sp=0 且无 anomaly）。

### 建议先补战技还是先补终结技

**两者都不需要代码层补口。** 建议：
1. 先在前端排轴中使用 **碎甲四 variant**（而非基础 skill）进行测试
2. 如果碎甲 variant 排轴仍然观察不到天赋效果 → 再查 variant 编译/路由层
3. 终结技的固定 6 tick 已经能产生 60 SP 回复，不需要额外改动

### 前端第一观察窗口

**Boss debuff 栏**——确认碎甲 variant 使用后 boss 出现 armor_break debuff。如果 debuff 出现 → 碎甲路由正常 → SP 回复正常 → 天赋应触发。如果 debuff 不出现 → 问题在 variant 编译或效果路由。

### 需要人工游戏内核对的部分

- 碎甲层数→SP 回复的真值映射（skills.json 中的 5/10/20/30 数值）[需游戏内验证]
- 连携技实际命中段数选择规则（当前 gamedata 3 个 link variant 靠用户手动选择）[需游戏内验证]
- 终结技袭扰/决胜的实际触发条件（当前简化为固定 6 tick）[需游戏内验证]
