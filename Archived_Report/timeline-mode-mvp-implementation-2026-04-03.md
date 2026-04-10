# 排轴模式分层 MVP 骨架实现报告

> 实现时间: 2026-04-03
> 分类: G. 上线准备 / MVP 策略 — 技能变体展示/执行分层 + 排轴模式分层最小落地

---

## 1. 改了哪些文件

| 文件 | 改动 | 行号 |
|------|------|------|
| `stores/timelineStore.js` | 新增 `timelineMode` ref（默认 `'free'`）+ `TIMELINE_MODE_CYCLE` + `cycleTimelineMode()` | L1085-1096 |
| `stores/timelineStore.js` | `activeSkillLibrary` 末尾新增模式过滤层（free/normal/strict） | L2411-2428 |
| `stores/timelineStore.js` | 导出 `timelineMode, cycleTimelineMode, TIMELINE_MODE_CYCLE` | ~L7025 |

---

## 2. 行为变化

### 默认 free 模式：零行为变化

`filtered = sorted`，不执行任何过滤。技能库返回内容与改动前完全一致。所有 28 个变体 + 所有基础技能均可见。

### normal 模式：隐藏 4 个无 allowedTypes 的变体

被隐藏的变体：

| 角色 | 变体名 | 类型 | 隐藏原因 |
|------|--------|------|---------|
| YVONNE | 强化重击 | attack | allowedTypes = undefined |
| ARCLIGHT | 强化战技 | skill | allowedTypes = [] |
| WULFGARD | 强化战技 | skill | allowedTypes = [] |
| ALESH | 强化连携 | link | allowedTypes = [] |

其余 24 个有 allowedTypes 的变体仍然显示。所有基础技能不受影响。

这 4 个变体已有 runtime 自动切换机制（enhancedMultipliers / enhancedActionIds），不需要用户手动放置。

### strict 模式：隐藏全部 28 个变体

只显示基础技能（attack/dodge/execution/skill/link/ultimate + main_control）。

### 已放置的 action 不受影响

模式只控制 ActionLibrary 展示列表。已放置到时间轴上的 variant action 在任何模式切换后均保留不变。

---

## 3. 过滤规则说明

### free（默认）

```
返回全部技能（当前行为不变）
```

### normal

```
基础技能（id 不含 _variant_）→ 始终显示
变体技能 → 仅当 allowedTypes 非空时显示
```

依据：无 allowedTypes 的变体已通过 enhancedMultipliers 等机制在 runtime 自动处理，不需要用户手动选择。有 allowedTypes 的变体代表用户需要手动表达的条件假设（如"此处使用碎甲四变体"）。

### strict

```
基础技能 → 显示
变体技能（id 含 _variant_）→ 全部隐藏
```

---

## 4. 已可收口

- 模式骨架已建立（`timelineMode` ref + 三态循环 + `cycleTimelineMode()`）
- 展示层过滤已可工作（free/normal/strict 三种行为已实现）
- free 模式完整保留当前测试能力
- 已放置的 variant action 不受模式切换影响
- 全局测试 271 通过，零新增失败

---

## 5. 仍是阶段性实现

| 项 | 状态 | 说明 |
|---|---|---|
| UI 入口 | **尚未接入** | `cycleTimelineMode()` 已导出但还没有按钮调用它 |
| normal 模式规则 | **MVP 规则** | 仅基于 allowedTypes 是否为空判断，未来可能需要细化 |
| 展示→执行自动切换 | **未实装** | 模式只控制"用户能看到什么"，不控制 runtime 自动选变体 |
| 视觉区分 | **无** | 变体在 ActionLibrary 中仍与基础技能使用相同样式 |
| 变体分类字段 | **未新增** | gamedata.json 无 variantCategory 字段，分类靠代码推断 |

---

## 6. 新真值源

**没有引入新的真值源。**

`timelineMode` 是纯展示控制状态，不影响数据定义、编译或运行时。过滤逻辑仅读取已有字段（`id` 包含 `_variant_`、`allowedTypes` 数组是否为空），不创建任何新的数据分类层。

---

## 7. 用户在前端能直接看到什么变化

**当前什么都看不到**——默认值 `free` 意味着行为与之前完全一致。

要验证模式效果，当前需要在浏览器控制台手动切换：

```javascript
// 在 Vue Devtools 或控制台中获取 store 实例后：
store.cycleTimelineMode()  // free → normal → strict → free
```

或等后续在 ActionLibrary 面板加一个切换按钮。

### 验证方式

1. **free 模式**：ActionLibrary 技能列表与改动前完全一致
2. **切到 normal**：ARCLIGHT/WULFGARD/ALESH/YVONNE 的强化变体消失，其他变体仍在
3. **切到 strict**：所有变体消失，只剩基础技能
4. **切回 free**：全部恢复
5. **已放置的 variant action**：任何模式下均保留在时间轴上

---

## 8. 下一步建议

| 优先级 | 项 | 说明 |
|--------|---|------|
| 1 | UI 切换入口 | 在 ActionLibrary 或工具栏加一个 timelineMode 切换按钮 |
| 2 | 视觉区分 | 给变体技能加 badge/标记/分区 |
| 3 | normal 规则细化 | 根据实际使用反馈调整哪些变体在 normal 下可见 |
| 后续 | 展示→执行自动切换 | 用户放置基础技能，runtime 在条件满足时自动用变体执行 |
