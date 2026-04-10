# C 分支 P0 审计报告

---

## 1. 当前 C 分支对现状的判断

3 个角色的倍率数据已经由 B 分支处理好，但 runtime 行为层存在 3 类不同程度的缺口：

- **ARCLIGHT**: 倍率数据完整（verified），enhanced 结构定义正确，但第 3 个 tick 从未被生成，conduction 消耗绑定也缺失 → **需要生成 + 绑定**
- **ALESH**: 倍率数据完整（verified），enhanced 分两组 multipliers 定义正确，但 enhanced 触发条件不存在 → **需要条件判定桥接**
- **AVYWENNA**: 基础倍率可从 skills.json 拿到，但 persistent buff instance 状态机完全不存在 → **需要从 0 构建**

## 2. 三个角色/机制的当前实现缺口

### ARCLIGHT:skill — conditional_extra_hit

**已有**:
- `skillMultipliers.ts`: `enhancedMultipliers: [1.01, 1.01, 4.05]` 定义正确
- `simulator.ts`: `isEnhanced` flag 传入 `applySkillMultiplierOverlay` 正确
- `DamageHandler.ts`: `consume_conduction` 后处理逻辑存在

**缺口** (2 个):
1. **第 3 个 tick 从未被创建**: gamedata 只有 2 个 damage_ticks，compiler 只映射 gamedata 中的 ticks。即使 `isEnhanced=true`，overlay 只能给已有的 2 个 tick 填 multiplier，不会凭空创建第 3 个。
2. **conduction 消耗未绑定到 tick**: DamageHandler 支持 `boundEffects: ["consume_conduction"]`，但没有代码在 ARCLIGHT enhanced 态的第 3 tick 上设置这个字段。

**最小修改路径**:
- 在 `compileTimeline` 或 `simulator` 中，对 ARCLIGHT enhanced skill action 注入第 3 个 tick（offset、stagger 取自 gamedata 注释或已知时序）
- 在注入的 tick 上设置 `boundEffects: ["consume_conduction"]`
- 不需要改 DamageHandler（已有 consume 逻辑）

### ALESH:link — enhanced variant trigger

**已有**:
- `skillMultipliers.ts`: default `[0.7444, 2.2556]` + enhanced `[1.1910, 3.6090]` 都对
- 2 hit 结构不变，enhanced 只替换倍率

**缺口** (1 个):
1. **enhanced 触发条件不存在**: 当前 `enhancedActionIds` 来自 `computedEffectiveActions`，但那个 computed 只处理 duration/gauge 变体，不处理"珍鳞/稀有捕获"条件。结果：ALESH link 永远用 default 300%，从不用 enhanced 480%。

**最小修改路径**:
- 在排轴器中，ALESH link 的 enhanced 态应当由用户在 UI 上手动标记（就像现有 variant 系统），而非由 runtime 自动判定
- 或者：如果当前 `computedEffectiveActions` 已能标记 variant action，只需确保 ALESH link 可以被标记为 enhanced
- 不需要新建条件判定引擎

### AVYWENNA:skill — persistent buff instance

**已有**:
- skills.json 有基础倍率行
- WIP_OVERRIDE 明确标记未实现

**缺口** (完全缺失):
1. 没有 persistent entity / buff instance 状态机
2. 没有 "每次施放产生独立实例" 的逻辑
3. 没有 "每个现存实例触发独立伤害" 的结算逻辑
4. 不是"改几行就能通"的问题

**最小修改路径（本轮不建议全做）**:
- 最小方案：先不实现 instance 累积，只按"最近一次雷枪"计算基础伤害。标 WIP。
- 完整方案：需要在 simulation state 中新增 persistent buff tracker，在 DamageHandler 中按 instance count 乘算。这是 P1+ 的工作。

## 3. 建议修改的最小文件范围

### P1 优先级（本轮可做）

**ARCLIGHT 3rd tick 注入**:
- `simulator.ts` — 在 enhanced action 的 tick 循环前，检查 ARCLIGHT:skill enhanced 并注入第 3 tick
- 或 `compileTimeline.ts` — 在编译阶段为 enhanced ARCLIGHT:skill 添加第 3 tick
- 不动 DamageHandler（已有 consume 逻辑）
- 涉及文件：1 个

**ALESH enhanced 触发**:
- `timelineStore.js` 的 `computedEffectiveActions` — 确认 ALESH link 可以被标为 enhanced
- 或在 UI 层（ActionItem / TimelineGrid）提供手动 enhanced 标记
- 涉及文件：1-2 个

### P1+ 或 P2（本轮标 WIP）

**AVYWENNA instance**:
- 需要新增 persistent buff tracker in simulation state
- 需要 DamageHandler 扩展 per-instance scaling
- 涉及文件：3-5 个
- 建议本轮只标 WIP，不做实现

## 4. 修改后应改变的 runtime 行为

| 改动 | 修改前 | 修改后 |
|---|---|---|
| ARCLIGHT:skill enhanced | 2 tick × [1.01, 1.01] | 3 tick × [1.01, 1.01, 4.05]，第 3 tick 消耗 conduction |
| ALESH:link enhanced | 永远用 300% default | 用户可标记 enhanced → 使用 480% |
| AVYWENNA | skills.json 基础倍率有值，无 instance | 本轮不改，继续 WIP |

## 5. 仍然是阶段性实现

- ARCLIGHT 3rd tick 的触发条件（敌人是否有 conduction）目前只能由用户手动标记 enhanced
- ALESH enhanced 的自动判定（珍鳞状态）不做，先手动标记
- AVYWENNA 完全 WIP

## 6. 未引入新真值源

审计阶段不涉及新数据源。后续 P1 实现时遵守：角色专属逻辑落在 runtime 单一位置。

## 7. 下一步建议

1. **P1 优先做 ARCLIGHT 3rd tick 注入** — 因为数据完整、规则清晰、改动最小（1 个文件）
2. **P1 同时做 ALESH enhanced 桥接** — 确认现有 variant 系统能否直接复用
3. **AVYWENNA 推到 P2** — 需要设计 persistent instance 状态机，不适合最小实现
