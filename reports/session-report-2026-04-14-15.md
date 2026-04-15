# Session Report 2026-04-14~15

## Overview

V2 kernel 完整管线从零搭建到可用状态。实现了 kernel → projections → frontend 的完整 buff/debuff 显示流水线，清理了所有 V1 计算路径，并完成了多项前端改进。

## 主要改动

### V2 Kernel 管线（新建）

**新文件**:
- `simulation/v2/storeAdapter.ts` — Store 状态→V2 kernel 输入桥接（CharacterBuild + PlacedSkill + EnemyConfig + resolveRef）
- `simulation/v2/v2ProjectionAdapter.ts` — V2 投影输出→UI 数据格式适配

**kernel.ts 扩展**:
- `processEffect` 从 8 种扩展到 13 种 effect type（新增 buff_apply, buff_consume, consume_attachment, delayed_damage, sp_consume）
- TriggerProcessor 集成到四阶段模型（Phase 5: trigger evaluation）
- 全局 hit 排序（所有技能的 hit 按绝对时间排序处理，替代按技能顺序）
- 条件校验系统（SP/Gauge/CD，validateConditions 模式）
- 打断优先级（attack:1 < skill:2 < link:3 < dodge:4 < ultimate:5）
- 附着/破防/失衡过期事件（advanceTime 返回过期信息）
- magic_attachment 支持 delay 参数
- stack_buff_apply 自动从 buffMetadata 读取 maxLayers
- stack_buff_consume 跨角色搜索（trigger 消耗其他角色的 buff）
- break_change 事件携带 physicalType + sourceId
- attachment_change 事件携带 sourceId

**projections.ts 扩展**:
- `projectHitEffects()` — 提取所有可见效果（附着/buff/破防/异常/追加攻击）
- `projectBreakBars()` — 破防持续时间条
- break 消耗标记（consumedBy）

**triggers.ts 扩展**:
- TriggerState 增加 `activeBuffIds`（actor + enemy）
- 新增条件类型: actor_has_buff, enemy_has_buff, consumed_buff
- buildTriggerState 合并所有 actor 的 stackBuffs

### V1 清理

**全面禁用的 V1 计算路径**:
- `simulation` computed（V1 simulate）→ return null
- `_projectedBuffs`, `spSeries`, `staggerSeries` → return empty
- `computedAnomalyDebuffs`, `computedSelfBuffSimulation`, `computedPhysicalVulnerable`, `computedAnomalyDebuffsEffective` → return empty / V2 数据
- `_runSimulationUpTo`（拟真模式）→ return null
- `runDamageStats` → return
- `legalityIssuesByAction`, `sortedLegalityIssues` → return empty
- `effectiveWeaponStatuses` / `effectiveTeamBuffStatuses` / `effectiveDebuffStatuses` → V2 only
- `gaugeSeriesByTrackId` → V2 kernel 投影 + fallback 手动计算

**前端清理**:
- 删除 DamageSummaryPanel、LegalityIssuePanel 引用
- 删除伤害统计按钮
- 删除 track reorder controls（上下箭头+拖动）
- 删除"自身增益"/"状态"标签
- 删除 ActionItem 的"未支持"/"处理中"标签 + legality badge
- 删除 vite-plugin-vue-devtools
- 删除 legality 相关 CSS

### 前端 Buff 显示系统

- **合并 self-buff 行**: weapon-status-layer + self-buff-layer → mergedBuffsByTrack 统一渲染
- **Hit 效果图标**: 技能条上方显示 hit 产出的效果图标（附着/buff/破防/异常），按时间分组堆叠
- **追加攻击 tick marker**: trigger 产出的 DamageEvent 显示为元素色 tick marker
- **消耗标记**: break bar 被猛击/碎甲消耗时在末尾显示对应图标
- **颜色系统**: resolveBuffColor() 根据 buffId 关键词自动推断元素色
- **图标框统一**: self-buff、附着、debuff 行都用圆角方框 + 边框色
- **层数显示**: 有 maxStacks 显示 current/max，否则只显示 current
- **附着行**: 破防纳入附着行显示（ATTACH_LIKE_DEBUFF_TYPES）
- **SP/Gauge 曲线**: 从 V2 kernel sp_change/gauge_change 事件投影

### 角色数据

**POGRANICHNK**:
- 铁誓 trigger: physical_anomaly（排除 break_applied）+ link_hit（sourceMustBeOwner）
- 铁誓 maxStacks 修复: buffMetadata maxLayers=5
- ironOathRaidByLink / ironOathFinaleByLink 新增

**LASTRITE**:
- 幻影追击 trigger 链路调通: buff_apply → heavy_attack_hit(deferred) → delayed_damage + magic_attachment + buff_consume
- magic_attachment delay 参数支持
- lastrite_low_temp_infusion 加入 buffMetadata

**adapter.ts**:
- V2 角色清空 variants（kernel 内部处理）
- 清空 *_anomalies（V2 effects 在 hit.effects 里）
- execution action 映射
- aerial action 映射
- UNSUPPORTED_IDS: EMBER/CATCHER/SNOWSHINE

### 其他改进

- 缩放上限 1200→250（显示 500%）
- 触控板 pinch-to-zoom 速度修复（基于 deltaY 动态缩放）
- 开局满终结技能量开关（initialGaugeFull）
- Skill.isHeavyAttack 标记替代 stagger 判定
- aerial_hit trigger 事件类型
- 下落攻击加入技能库

## 架构状态

```
Store 状态 → storeAdapter → V2 Kernel simulate() → SimEvent[]
                                                         ↓
                                              projections (8+3 个)
                                                         ↓
                                          v2ProjectionAdapter → UI 格式
                                                         ↓
                                              Vue 组件纯渲染
```

所有计算集中在 V2 kernel，前端只做：放置技能 + 角色配置 + 渲染 kernel 输出。

## 待实现

1. 普攻连段系统（连段窗口、闪避刷新、技能不中断）
2. 技能打断系统（checkpoint、优先级、角色特殊规则）
3. 真实排轴模式（放技能自动 simulate）
4. 主控 buff 跟随
5. 伤害计算模式（新页面）
6. Buff 前端渲染完善（点击交互+详情面板）
7. 10 个新角色数据录入
