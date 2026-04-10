# Legality 与 UI 收口报告

> 时间：2026-03-24
> 基线：266 tests pass, 0 TS errors
> 结论：UI strictMode 与 simulation legalityPolicy 已收口为同一条数据流

---

## 1. 修改清单

| 文件 | 操作 |
|---|---|
| `stores/timelineStore.js` | +`legalityPolicy` computed (从 strictMode 派生)，simulate 传参，+`legalityIssuesByAction` computed，导出 |

**只改了 1 个文件。** 无 Vue 组件改动、无 i18n 改动、无 simulation 层改动。

---

## 2. UI 和 simulation legality 分工

```
用户切换 strictMode toggle
        ↓
strictMode (boolean ref)
        ↓
legalityPolicy = computed(() => strictMode ? 'strict' : 'sandbox')
        ↓
simulate(..., { legalityPolicy })
        ↓
engine → ActionStartHandler → checkActionLegality()
        ↓
simulation.legalityIssues   ← 权威结果
        ↓
legalityIssuesByAction = computed(Map<actionId, issues[]>)
        ↓
UI 节点可读取并渲染
```

| 层 | 职责 | 是否改变 |
|---|---|---|
| `strictMode` ref | UI 开关状态 | 保留原样 |
| `toggleStrictMode()` | 切换按钮 handler | 保留原样 |
| `validateSkillPlacement()` | 放置时快速预检（UI 投影数据） | 保留原样 |
| `legalityPolicy` computed | 从 strictMode 派生，传入 simulate | **新增** |
| engine `checkActionLegality` | 执行时权威检查（runtime state） | 已有 |
| `legalityIssuesByAction` computed | 按 actionId 分组的 issue map | **新增** |

### 两层校验关系

- **`validateSkillPlacement`** = 放置预检。在 simulation 运行前、用 UI 投影数据快速判断。用于拖放时 UX 反馈。
- **`checkActionLegality`** = 执行权威。在 simulation runtime 中、用真实状态判断。是 legality 的最终真值。

两者规则方向一致（SP/gauge/CD），但数据源不同（投影 vs runtime）。不矛盾，不需要合并成一个。

---

## 3. 三种模式在 UI 上的表现

| 模式 | strictMode | legalityPolicy | 放置行为 | 执行行为 | 节点显示 |
|---|---|---|---|---|---|
| **sandbox** | false | `"sandbox"` | 允许放置 | 允许执行 | `legalityIssuesByAction` 可展示 warning badge |
| **audit** | — | `"audit"` | 允许放置 | 允许执行 | issues with resolution=`warned` |
| **strict** | true | `"strict"` | 放置前预检拦截 | blocked action 跳过执行 | issues with resolution=`blocked` |

当前 UI toggle 只在 sandbox ↔ strict 间切换。audit 模式可通过后续 UI 扩展支持（改 `legalityPolicy` 计算逻辑即可）。

---

## 4. legalityIssuesByAction 使用方式

```js
const store = useTimelineStore()

// 获取某个 action 的 legality issues
const issues = store.legalityIssuesByAction.get(action.instanceId) ?? []

// 判断是否有 error
const hasError = issues.some(i => i.severity === 'error')
const isBlocked = issues.some(i => i.resolution === 'blocked')

// 渲染 badge / tooltip
// <div v-if="hasError" class="legality-badge error">!</div>
```

---

## 5. 仍为 TODO

| 项 | 说明 |
|---|---|
| Vue 组件渲染 legality badge | `legalityIssuesByAction` 数据已就绪，需 UI 组件消费 |
| audit 模式 UI 入口 | 当前 toggle 只切 sandbox↔strict，可扩展为三态选择器 |
| Action overlap 移入 engine | 当前仅 UI validateSkillPlacement 检查，engine 未实现 |
| 角色专属条件 | `endmin_debuff`, `magma_*`, `combo` 仍 assumed met |
| Boss dodge window / hitstun | 预留了 issue code，未实现 |
