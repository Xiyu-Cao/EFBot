# DAPAN 勾芡 人工验证排障报告

> 日期：2026-04-04
> 类型：排障 + 修正

---

## 1. 根因分析

### 问题 1："猛击清破防有延迟"

**根因**：这不是 runtime 延迟，而是**时间偏移差异**。

已从代码确认（gamedata.json:6571-6596）：
- DAPAN link 的 damage tick offset = **1.76s**
- DAPAN link 的 stagger anomaly offset = **0.77s**

Anomaly（猛击/slam）在 0.77s 就已经处理了（handler 调用 clearBreak），但 damage tick 直到 1.76s 才出现在 simLog 中。如果前端观察的是 damage tick 时间，会感觉 break 清除"延迟了"——实际上 break 在 0.77s 就已清除，只是 damage 在 1.76s 才到。

**这是数据层面的正常时间偏移，runtime 无需修正。**

### 问题 2："四层猛击硬编码"

**根因**：gamedata.json 中 DAPAN link 的 anomaly 定义为 `stacks: 4`。

已从代码确认（gamedata.json:6590）：
```json
{ "type": "stagger", "stacks": 4, "duration": 0, "offset": 0.77 }
```

但 simulator.ts Route 2（physical anomaly）**不消费 `stacks` 字段**。每个 physicalAnomaly 条目只产生 1 个 APPLY_PHYSICAL_ANOMALY 事件。`stacks: 4` 是**描述性元数据**（表示这个猛击的强度/等级为 4），不是"连续施加 4 次"。

前端 UI 可能直接显示了 `stacks: 4` 作为"破防层数"标签。这是一个**展示层问题**，不是 runtime 逻辑问题。

**本轮不修改 gamedata 或展示层。**

### 问题 3："天赋没有正确生效"⭐ 这是真正的 bug

**根因**：`sourceMustBeWearer: true` 导致条件函数从未观察到队友建立的 break stacks。

已从代码确认的完整因果链：

1. TriggerProcessor（TriggerProcessor.ts:125-129）在 `sourceMustBeWearer: true` 时，如果事件 sourceActorId ≠ trigger owner，**直接跳过**，不会调用 condition
2. DAPAN 的勾芡 trigger 挂在 DAPAN 的 actor effects 上（ownerId = "DAPAN"）
3. 队友的 APPLY_PHYSICAL_ANOMALY 事件（sourceActorId = "TEAMMATE"）→ 被 sourceMustBeWearer 过滤 → **condition 从未被调用**
4. `lastBreakStacks` 永远是 0（从未被更新）
5. 当 DAPAN 自己的 slam 事件到来时，condition 终于被调用 → 看到 `physicalBreak === null` → 但 `lastBreakStacks === 0` → **返回 false**
6. 结果：**勾芡永远不触发**

---

## 2. 改了哪些文件

| 文件 | 改动类型 |
|------|---------|
| `simulation/simulator.ts` | registerTriggeredBuff 新增 `sourceMustBeWearer` 可选参数 |
| `simulation/data/talentConditionalRegistry.ts` | 1) descriptor 接口新增 `sourceMustBeWearer` 字段 2) registerTalentConditionals 传入 3) DAPAN descriptor 重写 |
| `simulation/data/talentConditionalRegistry.test.ts` | 1) makeRegisterTriggeredBuff 支持 sourceMustBeWearer 2) DAPAN 测试全部重写为真实场景 |

---

## 3. 每个文件具体修了什么

### simulator.ts

- `registerTriggeredBuff` opts 新增 `sourceMustBeWearer?: boolean`（默认 true，向后兼容）
- trigger 创建时：`sourceMustBeWearer: opts.sourceMustBeWearer !== false`
- 改动量：3 行

### talentConditionalRegistry.ts

- `TalentConditionalDescriptor` 接口新增 `sourceMustBeWearer?: boolean` 字段
- `registerTalentConditionals` 函数签名和调用处传入 `sourceMustBeWearer`
- **DAPAN descriptor 重写**：
  - `sourceMustBeWearer: false`（condition 需要观察所有来源的事件）
  - condition 改为：先更新 `lastBreakStacks`（所有事件），再检查 source === "DAPAN" + physicalType === slam/armorBreak + breakState === null
  - 不再依赖 condition 只在 DAPAN 事件时被调用的假设

### talentConditionalRegistry.test.ts

- `makeRegisterTriggeredBuff` 新增 `sourceMustBeWearer` 参数支持
- DAPAN 测试全部重写，核心变化：
  - 使用 TEAMMATE actor 通过 APPLY_PHYSICAL_ANOMALY 事件建立 break stacks（不再手动 `buildBreakStacks`）
  - 新增"OTHER actor builds stacks, DAPAN slam clears"的真实场景测试
  - 所有测试都走完整 handler → TriggerProcessor 链路

---

## 4. 哪个旧路径被移除或绕开了

没有旧硬编码被移除。核心改动是：

- **从 `sourceMustBeWearer: true`（默认）改为 `sourceMustBeWearer: false`（DAPAN 专用）**
- 这使得 TriggerProcessor 不再跳过非 DAPAN 来源的 APPLY_PHYSICAL_ANOMALY 事件
- condition 自行检查 `sourceId !== "DAPAN"` 来过滤，只在 DAPAN 自身 slam 时返回 true

其他 5 个已注册角色（WULFGARD / CHENQIANYU / POGRANICHNK / AVYWENNA）的行为不受影响（它们没有设置 sourceMustBeWearer，默认 true）。

---

## 5. 为什么之前单元测试通过但前端仍失败

之前的测试用 `buildBreakStacks()` 手动在 EnemyStatusState 上设置 break stacks，然后发送 DAPAN 自己的 launch + slam。这种模式下：

1. `buildBreakStacks` 直接改状态，不走事件 → 不触发 TriggerProcessor
2. DAPAN 的 launch 事件（sourceMustBeWearer=true → condition 被调用）→ condition 看到 break stacks → 更新 lastBreakStacks ✓
3. DAPAN 的 slam 事件 → condition 看到 break cleared + lastBreakStacks > 0 → 触发 ✓

**测试通过是因为 break stacks 是手动设置的，且 DAPAN 自己的 launch 恰好更新了追踪值。**

但在真实前端中：
- break stacks 由**队友**的 APPLY_PHYSICAL_ANOMALY 事件建立
- 这些事件的 sourceActorId ≠ DAPAN
- sourceMustBeWearer=true → condition 从未被调用 → lastBreakStacks 永远是 0

**测试测到了错误的抽象层**——它测的是"DAPAN 自己建 break 自己清"的场景，不是"队友建 break、DAPAN 清"的真实场景。

---

## 6. 新增/重写的测试

8 个测试，全部重写为更贴近真实链路：

| # | 测试 | 真实场景覆盖 |
|---|------|-------------|
| 1 | 无 break 时不触发 | DAPAN slam on fresh enemy → no buff |
| 2 | **OTHER builds 3 stacks, DAPAN slam clears** | 核心真实场景 ✓ |
| 3 | 正确匹配消耗层数 | TEAMMATE 2 launches → DAPAN slam → 2 buff stacks |
| 4 | max 4 上限 | 6+ stacks consumed → capped at 4 |
| 5 | 10s 过期 | buff 到期后 aggregateDynamicBonuses = 0 |
| 6 | knockup 不触发 | DAPAN launch on broken enemy → no buff |
| 7 | 他人 slam 不触发 | OTHER slam clears break → DAPAN no buff |
| 8 | 数据驱动值 | value=6(E2) × 2 stacks = 12% |

---

## 7. 前端重新验证方式

1. 排轴中放 2+ 个角色
2. 先让队友角色的物理异常技能（knockup/knockdown）积累 break stacks
3. 放置 DAPAN 连携技（stagger/slam）清除 break
4. 验证点：
   - simLog 中 break cleared 后出现 `dapan_gouqian_stack` buff
   - buff 层数 = 消耗的 break 层数（最多 4）
   - DamageSummaryPanel 中 DAPAN 后续物理伤害提升
   - 10s 后伤害回落

---

## 8. 已知限制

1. **"stacks: 4" 显示问题**：gamedata.json 中 DAPAN link anomaly 的 `stacks: 4` 是描述性元数据。如果前端 UI 直接将其显示为"4 层破防"，这是展示层问题，本轮不修。

2. **只有 DAPAN 自身 slam 触发**：condition 检查 `sourceId !== "DAPAN"` → 如果队友的 slam 清除了 break，DAPAN 不受益。游戏中是否应该这样需人工确认。

3. **单次 anomaly = 单次事件**：gamedata 中 `stacks: 4` 不会产生 4 次 APPLY_PHYSICAL_ANOMALY 事件，只产生 1 次。如果游戏中 stagger stacks:4 应该施加 4 次独立的 slam，需要在 simulator.ts Route 2 中做循环——但这影响所有角色的物理异常，本轮不改。
