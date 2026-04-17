# 伤害计算页面 — 工作报告 (2026-04-16)

## 概述

新增独立伤害计算页面（路由 `/damage`，访问 `#/damage`），用于查看已排完时间轴的伤害结果。左侧竖向时间线展示技能时序，右侧交互面板展示角色属性/技能伤害/buff 详情。

**核心原则**: 不修改任何现有功能代码。所有逻辑放在新文件中，仅 `router/index.js` 添加一行路由注册。

## 架构

```
useDamageCalcState.ts (composable)
  ├─ 读取 store.tracks / characterRoster / weaponDatabase / systemConstants
  ├─ 调用 buildV2Inputs() → simulate() → projections
  ├─ 管理 selectedItem 选中状态
  └─ watch track 变更 → 自动重跑 simulate

DamageCalcView.vue (页面壳)
  ├─ DamageCalcHeader — 总伤害/DPS/暴击率/暴击模式切换
  ├─ VerticalTimeline — 竖向时间线容器
  │   ├─ TimeRuler — 时间刻度
  │   ├─ TimeColumn × 4 — 角色列（技能块按时间定位）
  │   └─ EnemyStatusTrack — 附着/异常/破防状态
  └─ DetailPanel — 右侧面板 hub
      ├─ DamageOverview — 默认总览（角色伤害条 + 元素分布）
      ├─ CharacterDetailPanel — 角色属性 + ATK 分解 + 装备
      ├─ SkillDetailPanel — 技能总伤 + hit 明细
      │   └─ HitBreakdownTable — per-hit 表格
      └─ BuffDetailPanel — buff 来源/目标/持续时间
```

## 文件清单

### 新建 (14 个)
| 路径 | 说明 |
|------|------|
| `views/DamageCalcView.vue` | 页面壳，grid 布局 1fr + 360px |
| `composables/useDamageCalcState.ts` | 状态 composable |
| `simulation/v2/damageCalcProjections.ts` | 新投影函数 + re-export 现有投影 |
| `components/damage-calc/DamageCalcHeader.vue` | 顶部栏 |
| `components/damage-calc/VerticalTimeline.vue` | 竖向时间线容器 |
| `components/damage-calc/TimeRuler.vue` | 时间刻度 |
| `components/damage-calc/TimeColumn.vue` | 角色列 |
| `components/damage-calc/EnemyStatusTrack.vue` | 敌方状态列 |
| `components/damage-calc/DetailPanel.vue` | 右侧面板路由 |
| `components/damage-calc/DamageOverview.vue` | 默认总览 |
| `components/damage-calc/CharacterDetailPanel.vue` | 角色详情 |
| `components/damage-calc/SkillDetailPanel.vue` | 技能详情 |
| `components/damage-calc/HitBreakdownTable.vue` | per-hit 表格 |
| `components/damage-calc/BuffDetailPanel.vue` | buff 详情 |

### 修改 (1 个)
| 路径 | 变更 |
|------|------|
| `router/index.js` | 添加 `/damage` 路由（1 行） |

## 新投影函数 (damageCalcProjections.ts)

| 函数 | 输入 | 输出 | 用途 |
|------|------|------|------|
| `projectHitDamageDetails()` | events | `Map<actionId, HitDamageDetail[]>` | 按技能分组的 per-hit 伤害 |
| `projectFullDamageSummary()` | events + tracksMeta | `FullDamageSummary` | 带角色/技能名称的完整汇总 |
| `extractBuffDetail()` | events + buffId + time | `BuffDetail` | buff 生命周期详情 |

同时 re-export 现有 11 个投影函数，方便一站式导入。

## 数据流

```
进入页面
  → composable.onMounted → runSimulation()
  → buildV2Inputs(store.tracks, ...) → V2Inputs
  → simulate(builds, skills, enemy, config, triggers) → SimulationResult
  → projectFullDamageSummary / projectHitDamageDetails / project*Bars
  → Vue 组件纯渲染

装备变更
  → store.updateTrackWeapon/Equipment
  → composable watch(store.tracks) 触发
  → runSimulation() → 投影更新 → UI 自动刷新
```

## 交互

| 操作 | 结果 |
|------|------|
| 点击角色列表头 | 右侧显示角色属性 + ATK 分解 + 装备 + 该角色技能伤害列表 |
| 点击技能块 | 右侧显示技能头部 + per-hit 伤害表（#/时间/倍率/元素/伤害/暴击/失衡）|
| 点击角色技能列表项 | 跳转到该技能的 hit 明细 |
| 暴击模式切换 | expected ↔ real，重跑 simulate |
| 返回按钮 | router.push('/timeline') |
| 无选中 | 显示伤害总览（角色伤害条 + 元素分布） |

## 已发现的 kernel 问题

**multiplierRef 未解析** — kernel.ts Phase 4 (line 687) 直接读 `hit.damage.multiplier`，但 V2 角色数据全部使用 `multiplierRef` 对象。已与内核负责人沟通。

修复后伤害计算页面无需额外改动即可正常显示。

## 延后项

- **11 乘区 zones 展开**: 需 kernel 在 DamageEvent 中附带 `DamageResult.zones` 数据
- **入口按钮**: 等现有 UI 组件稳定后在 ValidationResultDialog 或 header 添加
- **buff 条叠加在竖向时间线**: Phase 5 润色
- **失衡曲线可视化**: Phase 5 润色
- **per-hit 暴击控制**: 允许用户指定某些 hit 强制暴击/不暴击

## 验证

- `vue-tsc --noEmit` ✓ 无类型错误
- `vitest` ✓ 现有测试无退步（14 failed = 预存失败）
- dev server ✓ 正常启动
- 页面加载 ✓（kernel multiplierRef 修复后伤害正常显示）
