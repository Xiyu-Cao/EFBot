# C 分支 P3 — AVYWENNA runtime 一致性推进报告

---

## 1. 当前判断

AVYWENNA 雷枪/强雷枪逻辑现在同时在 damageSummary 和 simulation runtime 两条路径中生效。两条路径使用相同的逻辑（compile-time prepass），不存在不一致。

## 2. 之前的不一致

| 路径 | 修改前 | 修改后 |
|---|---|---|
| damageSummary (DamageSummaryPanel) | ✅ 含雷枪召回伤害 | ✅ 不变 |
| simulation (simLog → SP/stagger charts) | ❌ 无雷枪召回事件 | ✅ 含雷枪召回 DAMAGE_TICK + stagger |

修改后两条路径一致：link 创建 3 雷枪、ult 创建 1 强雷枪、skill 按存活数追加独立 DAMAGE_TICK events（含 stagger）。

## 3. 修改的文件

| 文件 | 改动 |
|---|---|
| `simulator.ts` | 在 action enqueue 循环中新增 AVYWENNA lance tracking + 召回时 enqueue 额外 DAMAGE_TICK events |

## 4. Runtime 最小路径

不修改 ActorState / SimulationEngine / handlers。在 `simulate()` 函数的 action setup 阶段（compile-time prepass）做 lance tracking，与 damageSummary 相同模式。

具体：
- 维护 `avyLances` 局部数组
- link ACTION → 添加 3 支 normal lance
- ultimate ACTION → 添加 1 支 strong lance
- skill ACTION → 为每支存活 lance enqueue 独立 DAMAGE_TICK（offset=0.3s，含 stagger）→ 清空 lances

## 5. 修改后 runtime 行为

| 场景 | 修改前 simulation | 修改后 simulation |
|---|---|---|
| AVYWENNA link → skill | simLog 只有 link damage + skill base damage | simLog 含 link + skill base + 3× 雷枪召回 damage ticks |
| AVYWENNA ult → skill | simLog 只有 ult damage + skill base damage | simLog 含 ult + skill base + 1× 强雷枪召回 damage tick |
| Stagger chart | 无召回 stagger | 含召回 stagger（normal=5, strong=10 per lance） |

## 6. 可收口

- AVYWENNA 雷枪基础机制：damageSummary + simulation 双路径一致 ✅
- ARCLIGHT / ALESH：无需继续 ✅
- simulation 健壮性：event handler try/catch 已就位 ✅

## 7. 阶段性实现

- **潜能 +20s 持续时间**：未接入（`LANCE_BASE_DURATION = 30` 常量）
- **倍率硬编码**：simulator.ts 中雷枪/强雷枪倍率表是 skills.json 的字面量副本。已验证与 skills.json 完全一致。未来如果倍率变动需同步更新。主真值源是 skills.json。
- **状态标签**：仍为 "wip"（WIP_OVERRIDE 保留）
- **variant "战技-回收雷枪"**：variant 的 1 tick 走默认路径，雷枪召回伤害由 prepass 追加

## 8. 双真值风险评估

| 项目 | 状态 |
|---|---|
| damageSummary ↔ simulation | ✅ 一致（相同逻辑） |
| 倍率来源 | skills.json 为主真值 → simulator.ts 硬编码副本。需保持同步 |
| 新机制表 | 无新 JSON / md 接入运行时 |

**后续收敛方向**：如果倍率表需要从 skills.json 动态读取（而非硬编码副本），可让 simulator.ts 也通过 import.meta.glob 读取。但当前 simulator.ts 是 TypeScript，glob 已在 skillMultipliers.ts 中就位，可从那里暴露一个查询函数。这是下一步收口项，不阻塞当前。

## 9. 前端直接可见变化

### Stagger chart 变化
- **界面**: 底部 ResourceMonitor 面板 → stagger chart
- **测试**: AVYWENNA 连携 → 战技 → 观察 stagger chart
- **修改前**: skill 时刻只有基础 5 stagger
- **修改后**: skill 时刻 5 (base) + 3×5 (3 normal lances) = 20 stagger

### SimLog 变化
- **不直接可见**，但影响任何消费 simLog 的系统
- 可通过 console 或 debug tools 验证

---

## 中心对话汇报

1. **分类**: C — AVYWENNA runtime 一致性
2. **改了哪些文件**: `simulator.ts`（AVYWENNA lance tracking + 召回时 enqueue extra DAMAGE_TICKs）
3. **行为变化**: simulation runtime 现在也包含雷枪/强雷枪召回伤害和 stagger，与 damageSummary 一致
4. **可收口**: AVYWENNA 基础雷枪机制 damageSummary + simulation 双路径一致
5. **阶段性实现**: 潜能 +20s 未接入；倍率表为 skills.json 的硬编码副本；状态仍 wip
6. **新真值源**: 无新外部真值源。simulator.ts 中的硬编码副本与 skills.json 完全一致
7. **下一步**: C 分支 AVYWENNA 基础工作完成。后续可收口或继续做潜能接入
8. **前端可见变化**: stagger chart 在 AVYWENNA skill 召回时显示更高的 stagger 值（含 lance stagger）。DamageSummary 不变（之前已生效）
