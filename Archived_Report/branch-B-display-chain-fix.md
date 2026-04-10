# B 分支 — 显示状态/伤害统计链路修复

---

## 1. "未支持"标签的真实来源

- **组件**: `ActionItem.vue` line 8, 32, 645
- **调用**: `getSkillDisplayStatus(track.id, type)` → `skillStatusRegistry.ts`
- **链路正确**: ActionItem 确实调用了 skillStatusRegistry
- **问题不在 registry**: registry 代码正确（P1 已修改），但它依赖 `hasSkillsJsonMultiplier()` → `getSkillMultiplierFromData()` → `_getSkillsDataModules()` → `import.meta.glob`

## 2. DamageSummary 的真实来源

- **组件**: `DamageSummaryPanel.vue` line 9
- **数据**: `store.damageSummary` → `compiledScenario.value.timeline.actions`
- **问题**: damageSummary 读取的是 **编译后原始 tick**（`tick.multiplier === 0`），不是 simulation 后的。`applySkillMultiplierOverlay` 只在 `simulator.ts` 的 `simulate()` 中调用，damageSummary 绕过了它。

## 3. 两个根因

### 根因 A: `import.meta.glob` 未被 Vite 转译 ⚠️

```typescript
// 旧代码 (skillMultipliers.ts line 201)
_skillsDataCache = (import.meta as any).glob?.('../../data/operators/*/skills.json', { eager: true }) || {};
```

`(import.meta as any)` 的 `as any` 类型断言使 Vite 的静态分析无法识别 `import.meta.glob()` 调用。Vite 只转译它能静态检测到的 `import.meta.glob(...)` 模式。结果：glob 在构建后变成运行时调用，返回 `undefined`，fallback 到 `{}`。

**影响**: `hasSkillsJsonMultiplier()` 始终返回 `false` → 所有无 SM entry 的技能都显示 "unsupported"。`getSkillMultiplierFromData()` 始终返回 `undefined` → 所有技能的 per-level 倍率查表完全失效。

### 根因 B: damageSummary 未应用 multiplier overlay ⚠️

`damageSummary` computed 直接读 `compiledScenario.value.timeline.actions[*].resolvedDamageTicks[*].multiplier`，这些是编译器产出的原始值（全为 0）。`applySkillMultiplierOverlay` 只在 `simulate()` 内部调用，damageSummary 不走 simulate。

**影响**: 即使 glob 修复后 overlay 能正确填入 multiplier，damageSummary 仍然看到全 0 → 显示 "未支持"。

## 4. 修复内容

| 文件 | 修改 | 修复了什么 |
|---|---|---|
| `skillMultipliers.ts` | `(import.meta as any).glob?.(...)` → `import.meta.glob(...)` 直接调用 | 根因 A: glob 现在被 Vite 正确转译 |
| `timelineStore.js` | `damageSummary` computed 中对每个 tick 调用 `applySkillMultiplierOverlay` | 根因 B: damageSummary 现在使用 overlay 后的 multiplier |
| `timelineStore.js` | 新增 `import { applySkillMultiplierOverlay }` | 支持上条修改 |

## 5. P1/P2 汇报与真实页面不一致的结论

P1/P2 的所有代码逻辑改动本身是正确的（匹配精度、group mapping、SM 清理）。但有两个致命的连通性断点：

1. **glob 断点**: skills.json 数据在构建后不可达，所有 per-level 查表、显示状态感知、multi-tick 映射 **全部空转**
2. **damageSummary 断点**: 即使 overlay 正常工作（simulator.ts 里的 simulation 结果确实有非零 multiplier），DamageSummaryPanel 读的不是 simulation 输出，而是编译器原始数据

修复这两个断点后，P1/P2 的所有改动才能真正生效。

## 6. 排轴器可直接看到的变化

### 测试 1: 技能标签从"未支持"→"处理中"
- **界面**: 排轴主区域，任意技能方块
- **测试角色**: 任意非 ROSSI 角色的战技/连携/终结
- **修改前**: 所有技能显示红色"未支持"标签
- **修改后**: 有 skills.json 倍率行的技能显示黄色"处理中"标签；ARCLIGHT:skill/ult 和 ALESH:link 显示无标签（supported）

### 测试 2: DamageSummary 从 0 → 非零伤害
- **界面**: 底部 DamageSummary 面板
- **测试角色**: ENDMINISTRATOR 战技（单 tick，最简单）
- **修改前**: 显示 0 伤害 + "未支持"
- **修改后**: 显示非零伤害（M3 时倍率 3.5，应看到明显数值）
- **进一步测试**: 改技能等级 M3→RANK1 → 伤害应明显降低

### 测试 3: 多 tick 技能有伤害
- **角色**: POGRANICHNK 终结技（6 tick，3 行 group mapping）
- **修改前**: 全 0
- **修改后**: 进军+袭扰+决胜各有对应伤害

---

## 中心对话汇报

1. **分类**: B — 显示状态/伤害统计链路修复（紧急断点修复）
2. **改了哪些文件**: `skillMultipliers.ts`（glob 语法修复）、`timelineStore.js`（damageSummary 加 overlay + import）
3. **行为变化**: (a) 技能标签从全部"未支持"恢复为正确的 supported/wip/unsupported 分类；(b) DamageSummary 从全 0 恢复为基于 multiplier 的真实伤害计算
4. **可收口**: glob 断点和 damageSummary 断点都是一次性修复
5. **阶段性实现**: P1/P2 的倍率映射逻辑本身不变，现在终于能真正生效
6. **新真值源**: 无
7. **排轴器可见变化**: (a) 技能方块标签变化：红色"未支持"→黄色"处理中"或无标签 (b) DamageSummary 面板从 0→非零伤害 (c) 改技能等级→伤害跟着变
8. **下一步**: 让用户实际测试确认修复效果，然后继续 B 分支剩余工作
