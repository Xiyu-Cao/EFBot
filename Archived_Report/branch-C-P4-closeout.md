# C 分支 P4 — 收口与去重报告

---

## 1. 当前判断

C 分支核心工作已完成。AVYWENNA 倍率来源已收敛到 skills.json 单真值源。

## 2. AVYWENNA 倍率来源收敛

| 位置 | 修改前 | 修改后 |
|---|---|---|
| `timelineStore.js` damageSummary | ✅ 从 `loadOperator().skills` 读取 | 不变 |
| `simulator.ts` runtime | ⚠️ 字面量硬编码副本 | ✅ 通过 `getSkillsJsonRowByLabel()` 从 skills.json 读取 |

**双真值源风险已消除**。simulator.ts 不再维护独立的倍率副本。两条路径都从 skills.json 读取。

## 3. 修改的文件

| 文件 | 改动 |
|---|---|
| `skillMultipliers.ts` | 新增 `getSkillsJsonRowByLabel()` — 按行标签从 skills.json 读取倍率数组 |
| `simulator.ts` | 导入 `getSkillsJsonRowByLabel`；用动态查询替换 AVYWENNA 硬编码倍率表 |

## 4. 修改后行为

**无行为变化**。倍率数值完全相同（之前的硬编码就是从 skills.json 手工抄的）。只是来源从"编码时手工复制"变为"运行时从 skills.json 读取"。

## 5. C 分支收口判断

### 已完成（可收口）

| 项目 | 状态 |
|---|---|
| ARCLIGHT 3rd tick + conduction consume | ✅ 通过 variant 系统工作 |
| ALESH enhanced link | ✅ 通过 variant 系统工作 |
| simulation 健壮性（event handler try/catch） | ✅ 已修复 |
| AVYWENNA 雷枪基础机制（damageSummary） | ✅ 已实现 |
| AVYWENNA 雷枪基础机制（simulation runtime） | ✅ 已实现 |
| AVYWENNA damageSummary ↔ simulation 一致性 | ✅ 已一致 |
| AVYWENNA 倍率来源单真值化 | ✅ 本轮完成 |

### 仍保留 WIP（增强项，非阻塞）

| 项目 | 原因 | 阻塞 MVP？ |
|---|---|---|
| AVYWENNA 潜能 +20s | 潜能系统不存在 | ❌ |
| AVYWENNA 完整 runtime 状态机 | 当前 prepass 方案足够 MVP | ❌ |
| skillStatusRegistry AVYWENNA:skill 仍为 wip | 正确反映当前状态 | ❌ |

### 建议：C 分支可以阶段性收口

理由：
1. 三个目标角色（ARCLIGHT / ALESH / AVYWENNA）的核心机制都已到位
2. 无双真值源残留
3. 无未修复的连通性断点
4. 剩余项全部是增强型（潜能、完整状态机），不阻塞 MVP

## 6. 前端直接可见变化

**本轮没有明显前端直接可见变化**。

本轮是纯内部去重（硬编码副本 → 动态查询），倍率数值完全相同。用户在 DamageSummary 或排轴中看到的数字不会有任何变化。

如果后续 skills.json 中 AVYWENNA 的雷枪倍率被更新，simulator.ts 会自动跟随，不需要手动同步 — 这是去重的实际收益。

---

## 中心对话汇报

1. **分类**: C — 专属机制 / 角色特殊逻辑（P4 收口）
2. **改了哪些文件**: `skillMultipliers.ts`（新增 `getSkillsJsonRowByLabel`）、`simulator.ts`（硬编码倍率表替换为动态查询）
3. **行为变化**: 无外部行为变化。内部：AVYWENNA runtime 倍率从硬编码副本改为从 skills.json 动态读取
4. **可收口**: C 分支全部核心工作完成（3 个角色 + 健壮性 + 倍率单真值源）
5. **阶段性实现**: 潜能 +20s 未接入（潜能系统不存在）；AVYWENNA 仍标 wip；prepass 方案足够 MVP
6. **新真值源**: 无。反而消除了一份硬编码副本
7. **下一步**: C 分支可阶段性收口。后续如果需要，再开新轮做潜能接入或完整状态机
8. **前端可见变化**: 本轮无。去重是内部质量改进，不影响用户可见结果
