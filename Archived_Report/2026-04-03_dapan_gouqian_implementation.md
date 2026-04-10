# DAPAN 勾芡 实现汇报

> 日期：2026-04-03
> 类型：最小实现

---

## 1. 改了哪些文件

| 文件 | 角色 |
|------|------|
| `simulation/data/talentConditionalRegistry.ts` | 核心实现 |
| `simulation/simulator.ts` | 极小补口 |
| `simulation/data/talentConditionalRegistry.test.ts` | 测试 |

---

## 2. 每个文件具体改了什么

### talentConditionalRegistry.ts

1. **descriptor 接口新增 `stackCountResolver` 字段**（可选）
   - 签名：`(e: any, ctx: any) => number`
   - 默认行为不变（其他角色不受影响）
   - 仅在有 stack 配置时生效

2. **registerTalentConditionals 函数签名更新**
   - registerTriggeredBuff 的 opts 参数新增 `stackCountFn`
   - 在调用 registerTriggeredBuff 时将 `desc.stackCountResolver` 传入

3. **DAPAN descriptor 新增**
   - 使用 IIFE 包裹，产生共享闭包（`lastBreakStacks` / `consumedStacks`）
   - `event: "APPLY_PHYSICAL_ANOMALY"`
   - `condition`: 
     - Gate 1: `physicalType` 必须是 `slam` 或 `armorBreak`（只有这两种清除 break）
     - Gate 2: handler 后 `physicalBreak === null`（break 确实被清除了）
     - Gate 3: `lastBreakStacks > 0`（确实有 stacks 被消耗，不是从未有过 break）
     - 非清除型事件（launch/knockdown）仍会更新 `lastBreakStacks` 追踪值
   - `stackCountResolver`: 读取并重置 `consumedStacks`（由 condition 写入）
   - 增伤区：`damage_bonus/physical_dmg` → `[{ stat: "physical_dmg", value: 4/6 }]`（增伤区，无 zone 指定 = damageBonus）
   - stack: `{ group: "dapan_gouqian", max: 4 }`，duration: 10s

### simulator.ts

1. **registerTriggeredBuff opts 新增 `stackCountFn`**（可选）
2. **trigger action 中**：如果 `opts.stackCountFn` 存在且 stack 配置存在，`const count = stackCountFn(e, ctx)`，循环添加 `count` 次（替代固定 1 次）
3. 总改动：~5 行核心逻辑

### talentConditionalRegistry.test.ts

1. **makeRegisterTriggeredBuff 更新**：opts 新增 `stackCountFn`，trigger action 中增加循环逻辑（镜像 simulator.ts 的改动）
2. **新增 `aggregateDynamicBonuses` import**
3. **新增 8 个 DAPAN 测试用例**

---

## 3. 为什么选 stackCountResolver 而不是 actionOverride

- `stackCountResolver` 是一个**更窄的补口**：它只控制"每次触发添加多少个 stack"，默认行为完全不变
- `actionOverride` 会开放任意自定义 action 执行，等于绕开了 registerTriggeredBuff 的标准 buff 添加逻辑，未来维护风险更高
- DAPAN 的需求本质就是"N stacks per trigger"，不需要完全自定义的 action
- stackCountResolver 的语义清晰、可测试，且不影响其他 5 个已注册角色

---

## 4. 新增测试（8 个，全部通过）

| # | 测试名 | 验证内容 |
|---|--------|---------|
| 1 | 无 break 时不触发 | slam 在无 break 敌人上 → 0 buff stacks |
| 2 | 清 1 层 break → 加对应层 buff | 1 break stack + launch(+1) → slam 清 2 → 2 buff stacks |
| 3 | 清 4 层 break → 加 4 层 buff | 4 break stacks + launch(+1) → slam 清 5 → cap at 4 buff stacks |
| 4 | 超过 max 时不溢出 | 7 break stacks 消耗 → 仍然只有 4 buff stacks |
| 5 | buff 10s 后过期 | t=1 创建，t=12 检查 → aggregateDynamicBonuses = 0 |
| 6 | DAPAN 非 link 技能不触发 | knockup/launch 不清除 break → 0 buff stacks |
| 7 | 其他角色 slam 不触发 | sourceMustBeWearer 过滤 → 0 buff stacks |
| 8 | 数据驱动 value | value=6(E2) × 3 stacks = 18% physical_dmg bonus |

**全部 29 个 talentConditionalRegistry 测试通过。全 simulation 测试套件 293 passed / 12 failed（pre-existing）。**

---

## 5. 前端验证

1. **排轴设置**：添加 DAPAN，设置 E1+ 晋升并开启天赋 0（勾芡）
2. **构造 break**：先让其他角色（或 DAPAN 自身的 knockup 技能）积累 break stacks
3. **放置 DAPAN 连携技**：stagger/slam 应清除 break
4. **观察 simLog**：break cleared 后应紧接出现 DAPAN 的 `dapan_gouqian_stack` buff
5. **观察 DamageSummaryPanel**：DAPAN 后续物理伤害应提升（增伤区加成）
6. **观察 buff 过期**：10s 后伤害应回落

---

## 6. 已知限制 / 简化假设

1. **condition 追踪依赖事件序列**：condition 通过观察每个 APPLY_PHYSICAL_ANOMALY 事件来更新 `lastBreakStacks`。如果 break stacks 被非 APPLY_PHYSICAL_ANOMALY 事件修改（当前代码中不存在这种情况），追踪值可能偏差。

2. **sourceMustBeWearer 限制**：只有 DAPAN 自身的 APPLY_PHYSICAL_ANOMALY 事件才能触发。如果游戏中勾芡应该在队友清除 break 时也触发，需要后续调整（当前人工拍板语义未明确此场景）。

3. **slam 的直接触发路径**：当前测试通过直接注入 APPLY_PHYSICAL_ANOMALY 事件来模拟。在真实排轴中，DAPAN 连携技的 `stagger` effect → 映射为 `slam` → handler 处理。这条链在现有 simulator.ts 的路由中已经可用。

4. **闭包状态重置**：实现过程中发现 IIFE 闭包在多次 simulate() 间不重置的问题。已修复为 conditionFactory 模式——每次 registerTalentConditionals 被调用时，`conditionFactory()` 生成全新的闭包，`stackCountResolver` 通过 `_current` 引用同一闭包。多次模拟间状态正确隔离。
