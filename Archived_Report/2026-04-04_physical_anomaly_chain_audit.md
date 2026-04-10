# 物理异常主链定点审计

> 日期：2026-04-04
> 类型：定点审计（不含实现）

---

## A. 物理异常完整主链（已从代码确认）

```
1. action.effects (physicalAnomaly 数组)
   └─ compileTimeline.ts:125-168 → 每个 physicalAnomaly 条目编译为 1 个 resolvedEffect
      └─ node.type = "stagger" / "knockup" / "knockdown" / "armor_break"

2. simulator.ts Route 2 (line 366-378)
   └─ effectType → PHYSICAL_ANOMALY_MAP 查表
      └─ "stagger" → "slam", "knockup" → "launch", "knockdown" → "knockdown", "armor_break" → "armorBreak"
   └─ 入队 APPLY_PHYSICAL_ANOMALY { physicalType, sourceActorId, targetId }
   └─ 注意：node.stacks 字段在此处被完全忽略，不传入 payload

3. ApplyPhysicalAnomalyHandler (AnomalyHandlers.ts:272-288)
   └─ 调用 resolvePhysicalAnomaly(status, physicalType, sourceActorId, time, controlImmunities, artsPower)

4. PhysicalReactionResolver (PhysicalReactionResolver.ts:28-127)
   ┌─ 第一步：冰冻碎冰检查 (line 40-49)
   ├─ 分支 A：!hasBreak() → addBreakStack → return [BREAK_CHANGED] ← 早返回
   └─ 分支 B：hasBreak() → 按 physicalType 分支：
      ├─ launch / knockdown → damage + addBreakStack（不清除 break）
      ├─ armorBreak → damage + clearBreak + PHYSICAL_VULN_APPLIED
      └─ slam → damage + clearBreak

5. emitOutcomes (AnomalyHandlers.ts:58-253)
   └─ BREAK_CHANGED → simLog "break N stacks"
   └─ BREAK_CLEARED → simLog "break cleared"
   └─ PHYSICAL_DAMAGE → enqueue ANOMALY_DAMAGE
   └─ PHYSICAL_VULN_APPLIED → addOrRefreshBuff on enemy.effects

6. TriggerProcessor (runs after handler)
   └─ 评估 DAPAN 勾芡等触发器
```

### 关键路径：hasBreak() 的判定

```ts
hasBreak(): boolean {
  return this.physicalBreak !== null && this.physicalBreak.stacks > 0;
}
```

- `physicalBreak === null` → hasBreak() = false → **走分支 A（addBreakStack，早返回）**
- `physicalBreak.stacks > 0` → hasBreak() = true → **走分支 B（按 type 反应）**

**physicalBreak 从 null 变为非 null 的唯一入口是 `addBreakStack()`。physicalBreak stacks 上限 = PHYSICAL_BREAK_MAX_STACKS = 4。**

---

## B. 类型归一化（已从代码确认）

### 外部 → 内部映射

| gamedata type | PHYSICAL_ANOMALY_MAP key | 内部 runtime type | 实际行为 |
|---|---|---|---|
| `stagger` | `stagger` | `slam` | 有 break → damage + clearBreak；无 break → addBreakStack |
| `knockup` | `knockup` | `launch` | 有 break → damage + addBreakStack；无 break → addBreakStack |
| `knockdown` | `knockdown` | `knockdown` | 有 break → damage + addBreakStack；无 break → addBreakStack |
| `armor_break` | `armor_break` | `armorBreak` | 有 break → damage + clearBreak + physVuln；无 break → addBreakStack |

### 映射在所有路径都生效？

**是的。** `PHYSICAL_ANOMALY_MAP` 只有一个消费点（simulator.ts:367），所有 physicalAnomaly 效果都走这个路由。

### DAPAN link 当前走到的 internal type

**已确认：DAPAN link 的 `type: "stagger"` → `slam`。** 这个映射是正确的。

---

## C. 物理异常是否有类似法术附着的两阶段逻辑？

### 法术附着链（对比参照，已从代码确认）

```
MagicReactionResolver.resolveMagicAttachment(status, element, sourceActorId, time):
  Case 1: 无附着 → 创建新附着 (1 stack)
  Case 2: 同元素 → 叠层 + burst damage（每次同元素都 burst，不是只有第 4 次）
  Case 3: 异元素 → 清除附着 + cross-reaction (anomaly debuff + damage)
```

**法术附着有明确的"读取已有状态 → 根据新来元素决定反应类型"两阶段逻辑。**

### 物理异常链（已从代码确认）

```
PhysicalReactionResolver.resolvePhysicalAnomaly(status, physicalType, ...):
  分支 A: !hasBreak() → addBreakStack（不看 physicalType，所有类型一律加层）← 扁平
  分支 B: hasBreak() → switch(physicalType) 决定反应
```

**物理异常也有两阶段：先检查 hasBreak()，再按 type 分支。但分支 A（无 break）是完全扁平的——无论什么 physicalType，都只是 addBreakStack。slam 和 launch 在无 break 时行为完全相同。**

**两者的关键差异**：
- 法术附着：Case 2（同元素）和 Case 3（异元素）都**在已有附着上做反应**
- 物理异常：只有 hasBreak()=true 时才分 type 做反应；hasBreak()=false 时**所有类型一律加层**

---

## D. DAPAN link 为什么表现成"刷新破防层数"

**已从代码确认的完整因果链：**

### 场景：DAPAN link 是第一个物理异常（之前无 break stacks）

1. DAPAN link 产生 APPLY_PHYSICAL_ANOMALY { physicalType: "slam" }
2. Handler 调用 resolvePhysicalAnomaly
3. `!status.hasBreak()` → true（physicalBreak === null）
4. **进入分支 A → addBreakStack() → physicalBreak = { stacks: 1 }**
5. **return [BREAK_CHANGED]** → **从未进入 slam switch case**
6. simLog 记录 "break 1 stacks"
7. 前端看到：破防从 0 变成 1（"增加了 1 层"）

### 场景：DAPAN link 是后续物理异常（之前已有 break stacks）

1. 假设之前队友打了 3 次，break stacks = 3
2. DAPAN link 产生 APPLY_PHYSICAL_ANOMALY { physicalType: "slam" }
3. `!status.hasBreak()` → false（stacks = 3 > 0）
4. **进入分支 B → switch("slam") → damage + clearBreak()**
5. simLog 记录 "break cleared"
6. 前端看到：破防被清除 ✓

**结论：DAPAN link 的"刷新破防"现象，发生在敌人当前没有 break stacks 的情况下。此时 slam 和 launch/knockdown 行为完全相同——都只是 addBreakStack。只有当 hasBreak()=true 时，slam 才会走到 consume break 路径。**

### 用户观察到"刷新/续上"的可能原因

1. **排轴中 DAPAN link 是第一个打出的物理异常** → 走分支 A → addBreakStack → 看起来像"刷新"
2. **或者之前的 break stacks 已经因为 `PHYSICAL_BREAK_DURATION`(30s) 超时过期了** → physicalBreak 回到 null → 再来 slam 又走分支 A
3. **或者同一时间多个物理异常排列太近**，break 在前一个事件中被某个 slam/armorBreak 消耗了，后续的 slam 又走到分支 A

---

## E. 法术附着链 vs 物理异常链对比

### 法术附着链完整文件清单

| 文件 | 职责 |
|------|------|
| `simulator.ts` Route 1 | `ELEMENT_ATTACH_MAP` 路由 → APPLY_MAGIC_ATTACHMENT 事件 |
| `anomaly/events.ts` | ApplyMagicAttachmentEvent 类型定义 |
| `anomaly/AnomalyHandlers.ts` | ApplyMagicAttachmentHandler → 调用 resolver |
| `anomaly/MagicReactionResolver.ts` | 三路分支（无附着/同元素/异元素）→ outcomes |
| `anomaly/EnemyStatusState.ts` | magicAttachment 状态管理 |

### 物理异常链完整文件清单

| 文件 | 职责 |
|------|------|
| `simulator.ts` Route 2 | `PHYSICAL_ANOMALY_MAP` 路由 → APPLY_PHYSICAL_ANOMALY 事件 |
| `anomaly/events.ts` | ApplyPhysicalAnomalyEvent 类型定义 |
| `anomaly/AnomalyHandlers.ts` | ApplyPhysicalAnomalyHandler → 调用 resolver |
| `anomaly/PhysicalReactionResolver.ts` | 两路分支（无 break / 有 break → 4 type switch）→ outcomes |
| `anomaly/EnemyStatusState.ts` | physicalBreak 状态管理 |

### 物理异常相较法术附着缺了什么？

**物理异常不缺文件层，架构对称。缺的是分支 A 的语义精细度。**

法术附着：所有三种 case 都有独立的反应逻辑（即使 case 1 最简单）。
物理异常：分支 A（无 break）对所有 physicalType 一视同仁，只做 addBreakStack。

**这在游戏语义上是否正确？**

如果游戏中 slam 对无 break 目标确实只是"加 1 层 break"，那当前代码是正确的。但如果游戏中 slam 对无 break 目标应该有不同行为（比如不加层，或者直接造成伤害），那需要修正分支 A。

**根据人工验证反馈，当前行为（slam 无 break → 加层）看起来与游戏预期不符。**

---

## F. 最小修正建议

### 核心问题明确

DAPAN link（slam）在敌人无 break 时，走分支 A（addBreakStack）而不是分支 B（slam reaction）。这是 PhysicalReactionResolver 的行为，不是 DAPAN 特有的。

### 方案选择

**方案 A（最小，DAPAN 专用近似）**：不改 PhysicalReactionResolver，在 DAPAN 的 conditionFactory 中处理——当 slam 事件后 break 从 null 变为 stacks=1（说明走了分支 A），condition 也认为这是一次"消耗"（消耗 0 层，加了 1 层）。但这不解决"slam 应该消耗 break 而不是加层"的底层问题。

**方案 B（改 PhysicalReactionResolver）**：让 slam/armorBreak 在无 break 时也走反应路径——但不清除（因为没有什么可清除的），而是只造成 damage 不加 stack。这改变了所有角色的 slam/armorBreak 行为。

**方案 C（推荐，最小改 resolver）**：在 PhysicalReactionResolver 的分支 A 中，让 slam 和 armorBreak **也产生 damage + 不加 break stack**，而非简单 addBreakStack。具体：

```ts
if (!status.hasBreak()) {
  // slam/armorBreak on unbroken target: damage but don't add break stack
  if (physicalType === "slam" || physicalType === "armorBreak") {
    outcomes.push({
      type: "PHYSICAL_DAMAGE",
      physicalType,
      sourceActorId,
      breakStacks: 0, // no stacks to consume
    });
    return outcomes;
  }
  // launch/knockdown: add 1 break stack (existing behavior)
  status.addBreakStack(time);
  outcomes.push({ type: "BREAK_CHANGED", stacks: status.getBreakStacks() });
  return outcomes;
}
```

但这需要确认游戏中 slam 对无 break 目标是否应该造成 anomaly damage。如果不应该（只是"没效果"），改更简单。

### 必改 / 可选 / 不该动

| 文件 | 判断 | 理由 |
|------|------|------|
| `anomaly/PhysicalReactionResolver.ts` | **必改** | 分支 A 需要区分 slam/armorBreak vs launch/knockdown |
| `anomaly/AnomalyHandlers.ts` | 不需要改 | handler 只是调用 resolver，不需要修改 |
| `simulation/simulator.ts` | 不需要改 | 路由和映射正确 |
| `data/talentConditionalRegistry.ts` | **可能需微调** | DAPAN 条件逻辑可能需要适配新的 resolver 行为 |
| `anomaly/PhysicalReactionResolver.test.ts` 或 `anomaly/anomaly.test.ts` | **必补测试** | 验证新分支行为 |

### 不该动

- EnemyStatusState 接口
- 事件类型
- AnomalyHandlers
- 前端展示层
- 其他角色的 descriptor

---

## 附：回答"为什么表现成刷新破防层数"

**因为 PhysicalReactionResolver 在 `!hasBreak()` 时对所有 physicalType 一视同仁调用 `addBreakStack()`。slam 和 launch 在无 break 时行为完全相同。只有当已有 break stacks 时，slam 才会走到"consume break"的专用路径。**

如果前端排轴中 DAPAN link 在其他角色还未建立 break stacks 时就触发，slam 就只会表现成"加了 1 层 break"。这不是映射错误或路由错误，而是 resolver 的分支 A 没有区分 physicalType 的问题。
