# C 分支 P2 — AVYWENNA 雷枪实现报告

---

## 1. 当前判断

AVYWENNA 雷枪/强雷枪召回伤害已实现为 damageSummary compile-time prepass。从"完全 WIP"变为"基础可跑的阶段性支持"。

## 2. 持续时间确认

- **30s 固定**，所有技能等级（R1~M3）一致
- **潜能 +20s**: 潜能系统未实现。`LANCE_BASE_DURATION = 30` 作为常量，未来潜能接入时改此值即可
- **按"创建时固定"**: 每个实例在创建时确定 expiryTime，不随后续状态变化

## 3. 实例状态位置

在 `damageSummary` computed 内部的局部变量 `_avyLances`（per-trackId Map）。

**为什么不放 simulation state**: damageSummary 是独立的 compile-time 预计算路径，不走 simulation 引擎。把逻辑放这里避免了改 ActorState/SimulationEngine，是当前最小改动。

**双轨风险**: simulation runtime 路径不包含此逻辑 → simulation 输出不含雷枪召回伤害。但当前 damageSummary 是用户直接看到的伤害面板，simulation 输出未被直接展示。如果未来需要统一，再做方案 B（runtime 层实现）。

## 4. 修改的文件

| 文件 | 改动 |
|---|---|
| `timelineStore.js` | damageSummary computed 内新增 AVYWENNA 雷枪 tracking：link 创建 3 支、ult 创建 1 支、skill 召回时按存活实例追加独立伤害 |
| `skillStatusRegistry.ts` | AVYWENNA:skill WIP_OVERRIDE 描述更新 |

## 5. Runtime 行为变化

| 技能 | 修改前 | 修改后 |
|---|---|---|
| AVYWENNA link | 只计算连携直接伤害 380% M3 | 同 + 创建 3 支雷枪（30s） |
| AVYWENNA ultimate | 只计算终结直接伤害 950% M3 | 同 + 创建 1 支强雷枪（30s） |
| AVYWENNA skill（无雷枪时） | 只计算基础 150% M3 | 不变 |
| AVYWENNA skill（有雷枪时） | 只计算基础 150% M3 | 基础 150% + 每支雷枪 168% + 每支强雷枪 432% 独立计算 |

示例：link → 5s → ult → 2s → skill 召回
- Base: 150%
- 3× normal lance: 3 × 168% = 504%
- 1× strong lance: 432%
- **总计: 1086% M3**

## 6. 已支持部分

- 雷枪实例创建（link 3 支 / ult 1 支）
- 实例独立持续时间（30s，创建时固定）
- 实例到期自动清理
- 召回时按存活实例数计算独立伤害
- Per-level 倍率（R1~M3）
- 新实例不刷新旧实例

## 7. 阶段性实现 / 假设

- **潜能 +20s**: 未接入（`LANCE_BASE_DURATION = 30` 常量，未来改值即可）
- **simulation runtime 路径**: 未接入（只在 damageSummary prepass 中生效）
- **variant "战技-回收雷枪"**: 未特殊处理（当前 variant 的 1 tick 走默认 overlay，雷枪召回伤害由 prepass 追加）
- **状态标签**: 仍为 "wip"（WIP_OVERRIDE 保留）

## 8. 未引入新真值源

- 雷枪倍率来自 skills.json（`雷枪伤害倍率` / `强雷枪伤害倍率`行）
- 实例 tracking 是 damageSummary 内部局部变量
- 无新的 JSON / md / 平行机制表

## 9. 前端直接可见变化

### 变化: AVYWENNA skill 在有雷枪时 DamageSummary 伤害大幅增加

- **界面**: 底部 DamageSummary 面板
- **测试操作**:
  1. 给一个 track 放 AVYWENNA
  2. 在排轴上依次放: 连携技 → 等几秒 → 战技
  3. 观察 DamageSummary 中 AVYWENNA 战技那一行
- **修改前**: 只显示基础战技伤害（150% M3 对应的数值）
- **修改后**: 显示 150% + 3×168% = 654% M3 对应的总伤害（假设 3 支雷枪存活）
- **进一步测试**: 连携 → 终结 → 战技 → 应看到 150% + 3×168% + 1×432% = 1086% 对应伤害
- **skill level 联动**: 改技能等级 → 伤害跟着变

---

## 中心对话汇报

1. **分类**: C — 专属机制 / AVYWENNA 雷枪实现
2. **改了哪些文件**: `timelineStore.js`（damageSummary 内 lance tracking）、`skillStatusRegistry.ts`（WIP 描述更新）
3. **行为变化**: AVYWENNA skill 在有雷枪/强雷枪存活时，DamageSummary 显示召回伤害（每支独立计算），从"只有基础 150%"变为"基础 + 每支 lance 独立伤害"
4. **可收口**: AVYWENNA 基础雷枪机制已可用
5. **阶段性实现**: 潜能 +20s 未接入；simulation runtime 路径未接入；状态仍为 wip
6. **新真值源**: 无。倍率来自 skills.json
7. **下一步**: 用户测试确认；如需 simulation runtime 一致性，走方案 B（ActorState 层）
8. **前端可见变化**: DamageSummary 中 AVYWENNA 战技伤害在有雷枪时大幅增加。测试：连携→战技 应看到 3 支雷枪的额外伤害
