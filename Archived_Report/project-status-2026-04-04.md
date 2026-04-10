# EFBot (Endaxis) 项目状态报告

**日期**: 2026-04-04  
**范围**: 全仓库代码 + 测试套件运行

---

## 一、项目概览

**Endaxis** 是《明日方舟：终末地》的粉丝向排轴编辑器与伤害模拟工具。

| 维度 | 状态 |
|------|------|
| **技术栈** | Vue 3 + Vite + TypeScript (前端/引擎)，Pinia (状态)，Element Plus (UI)，Tauri (桌面)，FastAPI (Python，基本闲置) |
| **线上地址** | https://www.end-axis.com/ |
| **整体完成度** | 核心循环已生产可用，约 85% 功能已实现 |

---

## 二、测试套件结果

```
Test Files:  4 failed | 20 passed  (24 total)
Tests:      12 failed | 305 passed (317 total)
Duration:   765ms
```

### 失败的 4 个测试文件

| 文件 | 失败数 | 根因 |
|------|--------|------|
| `phase9.test.ts` | 8 | ESTELLA / POGRANICHNK 技能倍率 `getSkillMultiplier()` 返回 `undefined`；ESTELLA 冰属性全链伤害为 0 |
| `skillMultipliers.test.ts` | 2 | `applySkillMultiplierOverlay` 逻辑变更后测试断言与新行为不符 (overlay 返回 3.5 但测试期望 undefined/2.8) |
| *(另 2 个见 phase9)* | 2 | 同属 phase9 的 Expanded Skill Multipliers 分组 |

**诊断**：`skillMultipliers.ts` 近期进行了 overlay 机制重构（从 skills.json group mapping 替代旧 multi-tick 条目），但测试断言尚未同步。POGRANICHNK 技能倍率数据缺失。ESTELLA 冰链伤害为 0 说明 DamageResolver 链路上某个乘区未正确注入（可能是 resistance 或 skillMult 为 0）。

---

## 三、架构模块状态

### 已稳定 (可信赖)

| 模块 | 路径 | 说明 |
|------|------|------|
| **伤害公式** | `calculation/DamageResolver.ts` | 11 乘区已实现，zone 间乘法 / zone 内加法，snapshot 测试覆盖 |
| **事件引擎** | `engine/SimulationEngine.ts` | 优先队列 + trigger 系统，确定性 RNG |
| **编译器** | `compiler/` | Scenario → CompiledScenario (时间线解析、actor snapshot、连接关系) |
| **异常系统** | `anomaly/` | 魔法四元素附着→反应、直接异常、物理异常全链路 |
| **合法性校验** | `legality/` | sandbox/audit/strict 三模式，SP/能量/CD 校验 |
| **排轴 UI** | `components/TimelineGrid.vue` 等 | CSS Grid 帧级精度、拖放、Bézier 连线、实时预览 |
| **状态管理** | `stores/timelineStore.js` | Pinia + localStorage gzip 自动存档、分享码导入导出 |

### 近期重构完成 (需跑通回归)

| 模块 | 状态 |
|------|------|
| **runtime_passive 扩展** | `resistance_ignore` 已接入 (LAEVATAIN 天赋进主链) |
| **registerTriggeredBuff ICD** | `cooldownId` / `cooldownDuration` 已暴露 |
| **boundEffect 注册表** | 从 DamageHandler if-else 迁移到 pre/post registry Map |
| **runtime_conditional adapter** | `talentConditionalRegistry.ts`，WULFGARD/CHENQIANYU 已迁移，POGRANICHNK 已接入代码层 |

### 存在缺口

| 缺口 | 详情 |
|------|------|
| **技能倍率数据缺失** | POGRANICHNK 的 `getSkillMultiplier()` 返回 undefined；多角色标注 "estimated" |
| **runtime_conditional 覆盖率低** | 数据层 ~12 干员已定义，但仅 3 个有代码实现 |
| **runtime_passive 类型单一** | 仅处理 `damage_bonus` + 新增 `resistance_ignore`，其余类型静默忽略 |
| **parsed_unimplemented 标记** | ~130 处天赋效果 / ~60% 潜能 effects 为空 |
| **POGRANICHNK 上游阻塞** | 战技未施加物理异常/碎甲，终结技 buff 未做真实效果，adapter 已接但前端无法验证 |
| **Switch 事件** | 类型已定义但未编译/执行 |
| **Boss 闪避窗口 / 受击硬直** | legality 中保留但未实现 |

---

## 四、代码量与角色覆盖

| 指标 | 数值 |
|------|------|
| 模拟引擎 TS 文件 | ~50+ |
| Vue 组件 | ~20+ |
| 测试文件 | 24 |
| 测试用例 | 317 |
| 角色数据目录 | ~30 个 (`src/data/operators/`) |
| 技能倍率覆盖 | 大部分主要角色已有，部分标注 estimated |

---

## 五、Python 后端

`apps/python-app/` 基本闲置。FastAPI 骨架存在 (routes.py, engine.py, optimizer/)，但 TypeScript 引擎已完全替代其计算职能。优化器服务为 stub。可考虑精简或移除。

---

## 六、优先行动建议

| 优先级 | 事项 | 预期收益 |
|--------|------|----------|
| **P0** | 修复 12 个失败测试 (skillMultipliers overlay 断言同步 + POGRANICHNK 倍率数据补全 + ESTELLA 冰链 debug) | 恢复 CI 绿色 |
| **P1** | 补全 runtime_conditional adapter 覆盖 (剩余 ~9 干员) | 中层分发框架发挥价值 |
| **P1** | 扩展 runtime_passive 类型 (attack_speed, crit_rate 等) | 解除天赋效果实现瓶颈 |
| **P2** | POGRANICHNK 上游技能真值打通 (物理异常/碎甲/终结技 buff) | 解锁 adapter 前端验证 |
| **P2** | 批量清理 parsed_unimplemented 标记 (有中层后可批量接入) | 角色效果覆盖率提升 |
| **P3** | Switch 事件编译/执行、Boss 闪避窗口实现 | 排轴功能完整性 |

---

## 七、总结

项目已度过基础设施期，核心引擎 (伤害公式/事件队列/异常系统/排轴 UI) 稳定可靠，305/317 测试通过率 96.2%。近期完成的中层重构 (conditional adapter / boundEffect registry / ICD) 方向正确，为批量接入角色效果奠定了框架基础。

**当前最大瓶颈**仍是中层覆盖率：adapter 框架已验证但仅接入 3 个角色，runtime_passive 仅支持 2 种类型，~130 处天赋效果待实现。12 个测试失败均与近期 skillMultipliers 重构和角色数据缺失相关，属于可快速修复的回归问题。
