# Talent Conditional Registry 扩展候选审计与推进方案

> 日期：2026-04-03
> 类型：候选审计 + 最小改动方案

---

## 1. 当前 registry 现状确认

### 已接入的 3 个角色

| 角色 | 天赋 | 事件 | 机制 | 测试覆盖 |
|------|------|------|------|----------|
| WULFGARD | 灼热獠牙 | APPLY_DIRECT_ANOMALY | burn时→blaze_dmg buff, 10s, refresh | 2 tests |
| CHENQIANYU | 斩锋 | DAMAGE_TICK | skill/link/ult命中→ATK% stack, max 5, 10s | 2 tests |
| POGRANICHNK | 活着的旗帜 | SP_CHANGE | SP累积80→ATK% stack, max 3, 20s (conditionFactory) | 8 tests |

### registerTriggeredBuff 能力

- 支持 refresh（无叠层）和 independent-duration stacking
- 支持 cooldownId + cooldownDuration (ICD)
- 支持 self / enemy target
- sourceMustBeWearer 硬编码为 true
- DynamicBonus 映射通过 mapEffectToBonus：
  - `damage_bonus/{element}_dmg` → damageBonus zone ✓
  - `stat_bonus/attack_percent` → attackPercent zone ✓
  - `stat_bonus/originium_arts_power` → **不支持**（返回 undefined）
  - `gauge_modifier/*` → **不支持**

### extractSourceId 能力

TriggerProcessor 从 event.payload 提取 sourceId 的顺序：`actorId → sourceId → sourceActorId`

| 事件类型 | payload 中的 source 字段 | sourceMustBeWearer 可用 |
|----------|--------------------------|------------------------|
| DAMAGE_TICK | sourceId ✓ | ✓ |
| SP_CHANGE | actorId ✓ | ✓ |
| APPLY_DIRECT_ANOMALY | sourceActorId ✓ | ✓ |
| APPLY_MAGIC_ATTACHMENT | sourceActorId ✓ | ✓ |
| APPLY_PHYSICAL_ANOMALY | sourceActorId ✓ | ✓ |
| ANOMALY_DAMAGE | tags.sourceActorId (嵌套) | **✗ 无法直接提取** |
| ACTION_START / ACTION_END | actorId ✓ | ✓ |

---

## 2. 全角色 runtime_conditional 数据盘点

### 有结构化 runtime_conditional 数据（不含已接入的 3 个）

| 角色 | 天赋 | 效果 type/stat | 触发描述 | 事件可表达？ |
|------|------|---------------|----------|-------------|
| **DAPAN** | 勾芡 | damage_bonus/physical_dmg +4/6% | 每消耗1层破防后，10s，max 4 | ✓ APPLY_PHYSICAL_ANOMALY |
| **ENDMINISTRATOR** | 本质瓦解 | stat_bonus/attack_percent +15/30% | 源石结晶被消耗后，15s，不叠加 | △ 需检测 attachment 消耗 |
| **CATCHER** | 全局思维 | stat_bonus/attack_percent +30/45% | 终结技最后一击产生冲击波 | ✗ **实际是额外伤害实例** |
| **EMBER** | 以铁还铁 | stat_bonus/attack_percent +6/9% | 受到敌人伤害后，7s，max 3 | ✗ **无 incoming damage 事件** |
| **FLUORITE** | 捉摸不定 | stat_bonus/attack_percent +10/20% | 20%概率免疫法术伤害后，10s | ✗ **无 incoming damage + RNG** |
| **LIFENG** | 伏魔 | stat_bonus/attack_percent +50/100% | 造成倒地时，额外伤害 | ✗ **实际是额外伤害实例** |
| **ROSSI** | 斫痕 | stat_bonus/attack_percent +25/30% | 战技命中→施加 DoT + 增伤 | ✗ **需 DoT 系统 + enemy debuff** |
| **ROSSI** | 沸血 | stat_bonus/attack_percent +12/24% | 对标记目标暴击时额外伤害 | ✗ **需 crit 触发 + 额外伤害** |
| **ALESH** | 闪冻锁鲜 | gauge_modifier/ult_gauge_gain | 命中时获得终结技能量 | ✗ **需 gauge runtime 路径** |
| **AVYWENNA** | 高效派送 | gauge_modifier/ult_gauge_gain | 命中时获得终结技能量 | ✗ **需 gauge runtime 路径** |

### 有结构化 runtime_passive 数据（已由 simulator.ts 处理）

| 角色 | 天赋 | 效果 | 当前处理 | 准确性 |
|------|------|------|----------|--------|
| LAEVATAIN | 灼心 | resistance_ignore +10/15/20 | simulator.ts 永久 buff → resistance zone | ✓ 正确（无条件被动） |
| ENDMINISTRATOR | 现实静滞 | damage_bonus/physical_dmg +10/20% | simulator.ts 永久 buff → fragility zone | △ 偏差：应仅对有附着的敌人生效 |
| XAIHI | 启动进程 | damage_bonus/cold_dmg | simulator.ts 永久 buff → fragility zone | △ 需确认原始描述条件 |

---

## 3. A/B/C 分类

### A 类：可直接接 registry

**DAPAN（勾芡）**

- 数据：✓ damage_bonus/physical_dmg 已结构化，scope=runtime_conditional
- 事件：APPLY_PHYSICAL_ANOMALY 已有，payload 含 `physicalType` + `sourceActorId`
- 条件：`e.payload.physicalType === "armorBreak"`
- 映射：mapEffectToBonus 已支持 `damage_bonus/physical_dmg` → `[{ stat: "physical_dmg", value }]`
- 语义解读：
  - "每消耗1层破防" → 最简解读：每次 armorBreak 应用于敌人时触发 1 层
  - 物理异常系统中，armorBreak 应用即产生 APPLY_PHYSICAL_ANOMALY 事件
  - 替代解读：仅在 4 层 break 被消耗（armorBreak reaction）时一次获得全部层数——但这需要状态检测且 max 4 = break 层数，等效于上面的简单解读在长时间战斗中的效果
  - **建议先用简单解读上线，标注为可能需要游戏内验证**
- 不需要新系统 ✓

### B 类：需少量工作后可接

**ENDMINISTRATOR（本质瓦解）**

- 数据：✓ stat_bonus/attack_percent 已结构化，scope=runtime_conditional
- 事件：需要检测"魔法附着被消耗"
  - **方案 A**：APPLY_MAGIC_ATTACHMENT + 条件检测 handler 后 attachment 为 null（检测同元素爆裂）
  - **方案 B**：ANOMALY_DAMAGE + 条件检测 tags.damageSource === "magicAttachmentBurst" || "magicAnomalyDirect"
- 问题：
  - 方案 A：能捕捉同元素爆裂（attachment → null），但可能遗漏异元素反应（attachment 变为新元素 1 层）
  - 方案 B：能准确捕捉所有消耗场景，但 ANOMALY_DAMAGE 的 sourceActorId 嵌套在 tags 中，`extractSourceId` 无法提取，`sourceMustBeWearer` 失效
- 解决路径：方案 A 先上线（覆盖最常见的同元素爆裂），异元素反应触发标注为已知限制
- 映射：mapEffectToBonus 已支持 `stat_bonus/attack_percent` → attackPercent zone ✓
- 不需要新系统，但需要有状态条件 ✓

### C 类：本轮不该进

| 角色 | 原因 |
|------|------|
| CATCHER | "冲击波"是额外伤害实例，不是 buff。数据标注为 attack_percent 但描述是"造成 ATK 30% 的物理伤害"，需要额外伤害系统 |
| LIFENG | "额外造成 ATK 50% 物理伤害"同上，是额外伤害实例 |
| EMBER | 需要"受到敌人伤害"事件，当前模拟器是单向伤害模型（玩家→敌人），无 incoming damage 事件 |
| FLUORITE | 同 EMBER + 需要 20% RNG 触发概率 |
| ROSSI | 天赋 0 需要 DoT tick 系统（爪印每秒伤害）+ enemy debuff 状态追踪；天赋 1 需要暴击触发额外伤害 |
| ALESH / AVYWENNA | gauge_modifier/ult_gauge_gain，mapEffectToBonus 不支持，runtime 无 gauge 修改路径 |
| 所有 parsed_unimplemented 角色 | ARCLIGHT/ESTELLA/GILBERTA/TANGTANG/LASTRITE 等的未结构化天赋，经逐一审读描述：要么是复杂机制（计数器+属性缩放+全队 buff），要么是防御性效果（概率免疫、减伤），要么是区域效果——均非当前 ROI 优先项 |

---

## 4. 本轮推荐推进角色

### 选择：DAPAN + ENDMINISTRATOR（共 2 个）

| 排序 | 角色 | 理由 |
|------|------|------|
| 1 | **DAPAN** | 数据完备，事件直接可用，条件最简单（physicalType 匹配），0 系统改动，最高确定性 |
| 2 | **ENDMINISTRATOR** | 数据完备，APPLY_MAGIC_ATTACHMENT 可用，条件稍复杂（需检测 attachment 消耗），但角色价值极高（物理主C + 异常消耗核心定位）。talent_1 的 runtime_passive 已经在运行，talent_0 接上后该角色双天赋都进入 runtime |

为什么不选更多：
- 剩余 A/B 类候选为 0——其他角色全部因事件/系统缺失落入 C 类
- 强行拉 C 类进来会牵出新系统（额外伤害实例、incoming damage、gauge），ROI 骤降

---

## 5. 每个角色的最小改动方案

### DAPAN（勾芡）

**现在缺什么**：只缺 registry descriptor + 测试

**改动文件**：
1. `simulation/data/talentConditionalRegistry.ts` — 新增 DAPAN descriptor
2. `simulation/data/talentConditionalRegistry.test.ts` — 新增 DAPAN 测试

**descriptor 设计**：
```ts
DAPAN: [
  {
    effectMatch: { type: "damage_bonus", stat: "physical_dmg" },
    carrierId: "talent_cond_dapan_gouqian",
    event: "APPLY_PHYSICAL_ANOMALY",
    condition: (e: any) => e.payload?.physicalType === "armorBreak",
    buffId: "dapan_physical_stack",
    duration: 10,
    stack: { group: "dapan_gouqian", max: 4 },
  },
],
```

**前端验证**：
- 在 free 模式下，为 DAPAN 排轴放置带 armorBreak 效果的技能
- 触发后在 DamageSummaryPanel 观察后续物理伤害是否增加
- simLog 中应能看到 DAPAN 的 physical_dmg stack buff 出现

**测试计划**：
- 触发 APPLY_PHYSICAL_ANOMALY(armorBreak) → 检查 1 层 buff
- 多次触发 → 检查叠层 (max 4)
- 非 armorBreak 类型 → 不触发
- 10s 后层数过期
- 数据驱动（value 从 _activeEffects 读取）

---

### ENDMINISTRATOR（本质瓦解）

**现在缺什么**：registry descriptor + 条件函数 + 测试

**改动文件**：
1. `simulation/data/talentConditionalRegistry.ts` — 新增 ENDMINISTRATOR descriptor
2. `simulation/data/talentConditionalRegistry.test.ts` — 新增 ENDMINISTRATOR 测试

**descriptor 设计**（方案 A：基于 APPLY_MAGIC_ATTACHMENT）：
```ts
ENDMINISTRATOR: [
  {
    effectMatch: { type: "stat_bonus", stat: "attack_percent" },
    carrierId: "talent_cond_endministrator_essence_collapse",
    event: "APPLY_MAGIC_ATTACHMENT",
    condition: (e: any, ctx: any) => {
      // After handler: if attachment was consumed (burst/reaction), it will be null
      const att = ctx.state.enemy.status.attachment;
      return att === null;
    },
    buffId: "endministrator_atk_buff",
    duration: 15,
    // 不叠加 = refresh 模式（无 stack 配置）
  },
],
```

**已知限制**：
- 方案 A 仅检测同元素爆裂（attachment → null）
- 异元素反应后 attachment 可能变为新元素 1 层（非 null），此时不触发
- 后续可改为方案 B（ANOMALY_DAMAGE + 扩展 extractSourceId 或添加 sourceMustBeWearer 选项）

**前端验证**：
- 排轴中为 ENDMINISTRATOR 放置同元素附着技能 4 次（如 4 次 cold_attach）
- 第 4 次触发爆裂→消耗→应在 simLog 中看到 ATK buff 出现
- 后续伤害应显示增加

**测试计划**：
- 触发 4 次同元素 APPLY_MAGIC_ATTACHMENT → 第 4 次后检查 buff 存在
- 触发 3 次（未爆裂）→ buff 不存在
- 15s 后 buff 过期
- 重复爆裂 → buff refresh（不叠加）
- 数据驱动（value 从 _activeEffects 读取）

---

## 6. 推荐实现顺序

### 先做：DAPAN
- 最简单、确定性最高
- 0 系统改动，纯 descriptor + test
- 10-15 分钟完成

### 再做：ENDMINISTRATOR
- 稍复杂（condition 需状态检测）
- 但 descriptor 模式完全一致
- 有已知限制需标注
- 15-20 分钟完成

### 本轮不做：
- 所有 C 类角色
- CATCHER/LIFENG 的"额外伤害"效果
- EMBER/FLUORITE 的 incoming damage 触发
- ROSSI 的 DoT 系统
- ALESH/AVYWENNA 的 gauge 路径
- 任何 parsed_unimplemented 天赋的结构化（本轮无 ROI）
