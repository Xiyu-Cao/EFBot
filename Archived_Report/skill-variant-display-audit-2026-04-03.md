# 技能变体展示 / 执行分层 + 排轴模式分层 总审计

> 审计时间: 2026-04-03
> 范围: 技能变体数据→展示→执行全链路 + 模式分层可行性
> 原则: 测试阶段保留全部能力，为上线期模式分层做结构准备

---

## A. 前端技能列表与技能变体的展示路径

### 关键文件 [已从代码确认]

| 文件 | 职责 |
|------|------|
| `public/gamedata.json` | 数据源：character.variants[] 定义所有变体 |
| `stores/timelineStore.js:2085-2398` | 生成 activeSkillLibrary：基础技能 + 变体技能合并排序 |
| `components/ActionLibrary.vue` | 渲染技能面板：过滤 hiddenInLibraryGrid 后直接展示 |

### 生成流程 [已从代码确认]

```
gamedata.json → character.variants[]
    ↓
timelineStore.activeSkillLibrary (computed)
    ├─ 基础技能：createBaseSkill() × 6种 (attack/dodge/execution/skill/link/ultimate)
    └─ 变体技能：
         ├─ attack 变体 → createVariantAttackLibrary()
         └─ 其他变体 → createVariantSkill()
    ↓ 合并后按 TYPE_ORDER 排序，同类型内变体排在基础技能之后
    ↓
ActionLibrary.vue
    ├─ 过滤：filter(s => !s.hiddenInLibraryGrid)
    └─ 渲染：所有技能统一 .skill-item/.skill-card 样式
```

### 变体识别方式 [已从代码确认]

唯一识别方式是 ID 字符串包含 `_variant_`（timelineStore.js:2374）。**没有任何专用字段**（无 category / visibility / internal / displayMode）。

---

## B. 技能变体分类

### 总量 [已从代码确认]

**28 个变体，分布在 11 个角色中**（总共 25 个角色）。

### 按目的分类 [已从代码确认]

#### 1. 强化型（9 个）—— 条件满足后的增强版技能

| 角色 | 变体名 | 类型 | 触发条件 (allowedTypes) |
|------|--------|------|----------------------|
| ARDELIA | 强化战技 | skill | spell_vulnerable, physical_vulnerable |
| LAEVATAIN | 强化重击 | attack | blaze_attach 等 |
| LAEVATAIN | 大招内强化战技 | skill | blaze_attach 等 |
| LAEVATAIN | 强化战技 | skill | blaze_attach 等 |
| LIFENG | 强化终结技 | ultimate | knockdown, break 等 |
| ALESH | 强化战技一/二/三/四 | skill × 4 | frozen, cold_attach 等 |

**特点**：名称含"强化"，有 allowedTypes 定义触发条件。
**未来方向**：适合内部化——用户放置基础技能，runtime 在条件满足时自动切换到强化执行。

#### 2. 段数/层数型（12 个）—— 不同命中段数或效果层数

| 角色 | 变体名 | 类型 | 说明 |
|------|--------|------|------|
| POGRANICHNK | 连携破防一/二/三 | link × 3 | 1/2/3 段命中 |
| POGRANICHNK | 战技碎甲一/二/三/四 | skill × 4 | 消耗 1-4 层破防 |
| TANGTANG | 战技涡流一/二 | skill × 2 | 涡流状态 1/2 段 |
| TANGTANG | 终结技涡流一/二 | ultimate × 2 | 涡流状态 1/2 段 |
| ROSSI | 二段连携 | link | 条件满足时额外一段 |

**特点**：名称含数字（一二三四），表示层数/段数差异。
**未来方向**：部分适合内部化（如碎甲层数可由 runtime 根据 break stacks 决定），部分在测试期仍需手动选择。

#### 3. 上下文型（3 个）—— 特定状态下的执行变体

| 角色 | 变体名 | 类型 | 说明 |
|------|--------|------|------|
| LAEVATAIN | 大招内战技 | skill | 终结技期间的技能版本 |
| TANGTANG | 终结技无涡流 | ultimate | 无涡流时的终结技 |
| AVYWENNA | 战技-回收雷枪 | skill | 召回雷枪的特殊执行 |

**特点**：依赖特定上下文（终结技进行中/涡流状态/雷枪存在）。
**未来方向**：适合内部化——runtime 根据当前状态自动选择。

#### 4. 无触发条件型（4 个）—— 没有 allowedTypes 的变体

| 角色 | 变体名 | 类型 | 说明 |
|------|--------|------|------|
| YVONNE | 强化重击 | attack | 无 allowedTypes |
| ARCLIGHT | 强化战技 | skill | allowedTypes = [] |
| WULFGARD | 强化战技 | skill | allowedTypes = [] |
| ALESH | 强化连携 | link | allowedTypes = [] |

**特点**：这些变体已经通过现有的 `enhancedMultipliers` / `enhancedActionIds` 机制在 simulator 中处理（如 ARCLIGHT 的导电消耗强化）。它们在 gamedata 中保留是为了让用户可以手动放置强化版本。
**未来方向**：最适合内部化——已有 runtime 自动切换机制。

---

## C. "基础技能 → 技能变体"的结构关联

### 当前状态 [已从代码确认]

**不存在显式的基础→变体关联字段。** 变体通过以下隐式方式与基础技能关联：

1. **同一 character 的 variants[] 数组**：变体定义在角色数据的 `variants` 字段中
2. **变体的 type 字段**：`type: "skill"` 表示它是 skill 类型的变体
3. **变体的 allowedTypes 字段**：定义触发条件，但不直接引用基础技能 ID

**缺少的关联**：
- 没有 `baseSkillId` 字段指向基础技能
- 没有 `parentVariant` 字段表示变体层级
- 没有 `variantGroup` 字段将同组变体归类

### 最小关联补口 [推测]

如果要建立关联，最小方案是在变体数据上增加一个 `variantCategory` 字段（纯元数据，不影响 runtime）：

```json
{
  "id": "v_123",
  "name": "强化战技",
  "type": "skill",
  "variantCategory": "enhanced",  // 新增：enhanced / hitCount / contextual / internal
  ...
}
```

或者更轻量：在 timelineStore 的 `createVariantSkill()` 中，基于名称/allowedTypes 自动推断分类，不需要改 gamedata schema。

---

## D. 模式切换基础设施

### 已有基础 [已从代码确认]

| 设施 | 位置 | 当前用途 | 可否复用 |
|------|------|---------|---------|
| `legalityPolicy` ref | timelineStore.js:1078 | 控制仿真合法性策略 (sandbox/audit/strict) | **可作为参考模式**，但语义不同 |
| `LEGALITY_CYCLE` 循环 | timelineStore.js:1083 | 三态循环切换 | 可参考 UI 模式切换模式 |
| `toggleStrictMode()` | timelineStore.js:2817 | 按钮循环切换 | UI 入口可复用 |
| `hiddenInLibraryGrid` | timelineStore.js:2187 | 隐藏攻击段（已在用） | **可扩展为变体过滤** |

### 缺少的基础设施

1. **排轴模式 ref**：当前不存在 `timelineMode` 或 `variantDisplayMode`
2. **技能过滤层**：ActionLibrary.vue 当前只过滤 `hiddenInLibraryGrid`，无模式相关过滤
3. **变体分类字段**：变体数据上没有 category/visibility 字段

### 最小模式结构 [推测]

```javascript
// timelineStore.js
const timelineMode = ref('free')  // 'free' | 'normal' | 'strict'
const TIMELINE_MODE_CYCLE = ['free', 'normal', 'strict']
```

然后在 `activeSkillLibrary` computed 的排序步骤之后，加一个过滤步骤：
- `free` → 显示所有（当前行为）
- `normal` → 隐藏"无触发条件型"变体（allowedTypes 空或不存在）
- `strict` → 只显示基础技能（隐藏所有变体）

---

## E. 展示层/执行层分离的最小补口点

### 最合理的分离位置 [推测]

**在 `activeSkillLibrary` computed 的末尾加过滤层**（timelineStore.js ~L2382 之后）。

理由：
1. 这是唯一控制"用户在 ActionLibrary 中看到什么"的位置
2. 不影响 compile / runtime（那些读的是 timeline 上已放置的 action，不读 library）
3. 不需要改 gamedata schema
4. 已有 `hiddenInLibraryGrid` 先例

### 方案

```javascript
// 在排序之后，返回之前
if (timelineMode.value === 'strict') {
  return sorted.filter(s => !s.id.includes('_variant_'))
}
if (timelineMode.value === 'normal') {
  return sorted.filter(s => {
    if (!s.id.includes('_variant_')) return true  // 基础技能始终显示
    // 有 allowedTypes 的变体在 normal 模式下也显示（用户需要手动选择条件分支）
    return s.allowedTypes && s.allowedTypes.length > 0
  })
}
return sorted  // free 模式：全部显示
```

### 不需要改的层

| 层 | 为什么不需要改 |
|----|--------------|
| gamedata.json | 不需要加字段——分类可由代码推断 |
| compiler / compileScenario | 不管模式如何，已放置的 action 照常编译 |
| simulator / runtime | 不管模式如何，执行层行为不变 |
| DamageHandler / multiplierZones | 不受影响 |

---

## F. 哪些变体必须保留，哪些适合内部化

### 必须保留给测试的（free 模式中始终显示）

**全部 28 个变体**。测试阶段不删除任何变体。free 模式完整保留当前行为。

### 未来适合内部化的（normal/strict 模式中隐藏）

| 类型 | 数量 | 原因 | 内部化方式 |
|------|------|------|-----------|
| **无触发条件型** (ARCLIGHT/WULFGARD/ALESH/YVONNE) | 4 | 已有 enhancedMultipliers 机制 | runtime 自动切换 |
| **段数/层数型** (POGRANICHNK 碎甲/连携) | 7 | 段数应由 runtime 根据 break stacks 决定 | compile 或 runtime 阶段自动选 variant |
| **上下文型** (LAEVATAIN 大招内/TANGTANG 无涡流) | 3 | 状态由 runtime 判断 | runtime 自动切换 |

### 仍需用户选择的（normal 模式保留）

| 类型 | 数量 | 原因 |
|------|------|------|
| **有触发条件的强化型** (ARDELIA/LIFENG/ALESH 强化) | 9 | 用户需要在排轴中表达"这里我假设条件满足" |
| **AVYWENNA 回收雷枪** | 1 | 特殊操作，用户明确选择 |
| **TANGTANG 涡流一/二** | 4 | 用户需表达涡流状态假设 |
| **ROSSI 二段连携** | 1 | 用户需表达触发条件假设 |

---

## G. 最小低风险补口建议

### 推荐：新增 `timelineMode` ref + activeSkillLibrary 末尾过滤

**改动范围**：

| 文件 | 改动 |
|------|------|
| `stores/timelineStore.js` | 新增 `timelineMode` ref + `TIMELINE_MODE_CYCLE` + 在 activeSkillLibrary 末尾加过滤逻辑 (~15行) |
| `stores/timelineStore.js` | 导出 `timelineMode` + 切换函数 |

**行为**：
- `free`（默认）：当前行为完全不变
- `normal`：隐藏无 allowedTypes 的变体（4个）
- `strict`：隐藏所有变体（28个）

**不需要改**：ActionLibrary.vue（已有 filter 管线）、gamedata.json、compiler、simulator。

**风险**：极低——默认值 `free` 意味着不改变任何现有行为。

### 不推荐本轮做的

- 给 gamedata.json 加 variantCategory 字段（需要数据迁移）
- 实现 runtime 自动 variant 切换（需要新的 compile/runtime 系统）
- 给 ActionLibrary.vue 加 variant badge/分区 UI（视觉改动，风险中等）

---

## H. 最容易破坏当前测试能力的改动

| 改动 | 风险 | 原因 |
|------|------|------|
| 删除变体数据 | **极高** | 已放置的排轴会引用失效 |
| 默认隐藏变体 | **高** | 测试用户无法找到需要的变体 |
| 改变 variant ID 格式 | **高** | 已有排轴中的 action ID 引用会断裂 |
| 改变 createVariantSkill 签名 | **中** | 可能破坏数据传递链路 |
| 新增过滤层但默认值不是 free | **中** | 不知道改了的用户会困惑 |
| 只在 activeSkillLibrary 末尾加过滤，默认 free | **极低** | 不改变任何现有行为 |

---

## 结论

### 现状概括

28 个变体分布在 11 个角色中，按目的可分为强化型(9)、段数型(12)、上下文型(3)、无条件型(4)。当前全部以一等公民身份显示在 ActionLibrary 中，与基础技能无视觉区分。已有 `legalityPolicy` 三态切换基础设施可参考但不直接复用。

### 最小补口

在 `timelineStore.js` 中新增 `timelineMode` ref（free/normal/strict），在 `activeSkillLibrary` 末尾按模式过滤变体。默认值 `free` 确保零行为变化。改动约 15 行，风险极低。

### 分层原则

- **free 模式**：完整保留当前测试能力（28 个变体全部可见）
- **normal 模式**：隐藏"无 allowedTypes"的 4 个变体（已有 runtime 自动切换机制的强化型）
- **strict 模式**：隐藏全部 28 个变体，只显示基础技能
- **已放置的 variant action 不受模式影响**——模式只控制 ActionLibrary 展示，不控制 compile/runtime
