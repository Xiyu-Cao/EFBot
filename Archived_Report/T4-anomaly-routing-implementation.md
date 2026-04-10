# T4 异常主路径切换实施报告

---

## 1. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `src/simulation/simulator.ts` | +1 import, +2 路由映射表（共 12 行），重写 action.effects 循环（新增 Route 1 + Route 2 分支，保留 Route 3 legacy fallback） |

仅 1 个文件。未改 `scenarioAdapter.ts`（不需要，映射在 simulator.ts 中完成）。

## 2. 主循环里哪些 effect 不再走旧 EFFECT_START 路径

全部 8 种已知 scenario effect type：

- `blaze_attach`, `cold_attach`, `emag_attach`, `nature_attach`
- `armor_break`, `stagger`, `knockdown`, `knockup`

## 3. 哪些 effect 现在改走 APPLY_MAGIC_ATTACHMENT

| scenario effect type | element payload |
|---|---|
| `blaze_attach` | `"fire"` |
| `cold_attach` | `"cold"` |
| `emag_attach` | `"electro"` |
| `nature_attach` | `"nature"` |

→ `ApplyMagicAttachmentHandler` → `resolveMagicAttachment()` → 跨元素反应 → `applyAnomalyDebuff()` → `EnemyStatusState` 更新

## 4. 哪些 effect 现在改走 APPLY_PHYSICAL_ANOMALY

| scenario effect type | physicalType payload |
|---|---|
| `armor_break` | `"armorBreak"` |
| `stagger` | `"slam"` |
| `knockdown` | `"knockdown"` |
| `knockup` | `"launch"` |

→ `ApplyPhysicalAnomalyHandler` → `resolvePhysicalAnomaly()` → 破甲易伤 / PHYSICAL_VULN_APPLIED → `enemy.effects`

## 5. 是否保留了旧模块但不再作为主入口

**是。** 以下全部保留未删：

- `ReactionRegistry` (`mechanics/reactions.ts`)
- `AfflictionEffectMap` (`effects/afflictionEffectMap.ts`)
- `EffectStartHandler` (`events/EffectStartHandler.ts`)
- `SCNEARIO_EFFECT_TYPE_MAP` (`effects/scenarioAdapter.ts`)
- Effect 静态工厂方法 (`effects/types.ts`)

`simulator.ts` 中保留了 legacy fallback 分支（Route 3），当遇到非元素/非物理的未知 effect type 时仍走旧路径。但当前已知的 8 种 effect 全部走新路径。

## 6. 日志 / 前端可观察变化

### 之前

- simLog 出现 `EFFECT_START: ELEMENT_NATURE` → `REACTION_OCCURRED: Arts Reaction` → `EFFECT_START: ELEMENT_CORROSION`
- 伤害数值不变（腐蚀不减抗、导电不易伤）

### 现在

- simLog 出现 `ANOMALY_STATUS_CHANGE: nature attachment 1 stacks` → 跨元素时 `ANOMALY_STATUS_CHANGE: corrosion applied (level N)`
- 腐蚀存在时，**物理伤害增加**（通过 resistance zone 减抗）
- 导电存在时，**法术伤害增加**（通过 vulnerability zone 易伤）
- 燃烧产生 DOT（`ANOMALY_DAMAGE` tick 每秒）
- 冻结可被碎冰（`ICE_SHATTER_DAMAGE`）

## 7. 潜在兼容性风险

| 风险 | 影响 | 评估 |
|---|---|---|
| 旧 ReactionRegistry 不再被主循环触发 | 依赖旧反应链的测试可能需要更新 | **低** — 已验证 83 个异常/伤害/装备测试全部通过 |
| EFFECT_START 不再为元素附着创建 EffectManager tag | 如果 UI 依赖 `enemy.effects.hasTag("ELEMENT_NATURE")` 做展示 | **低** — 新路径通过 `EnemyStatusState` 跟踪附着状态，更准确 |
| `blockedActionIds` 检查 | 旧 EFFECT_START 路径有 `blockedActionIds` 检查，新 anomaly handler 没有 | **极低** — legality 检查是独立子系统，且 anomaly 事件在 hitSteps 中也不做此检查 |

## 8. 测试结果

- 异常/伤害/装备/反应相关测试：**83 全通过，0 新增失败**
- 全量测试：254 pass / 12 fail — 12 个失败均为 phase8/phase9 中 `getSkillMultiplier` 返回 undefined 的预存问题，与本次改动无关

## 9. 技术细节

### 新增路由映射（simulator.ts 顶部）

```typescript
const ELEMENT_ATTACH_MAP: Record<string, MagicElement> = {
  blaze_attach: "fire",
  cold_attach: "cold",
  emag_attach: "electro",
  nature_attach: "nature",
};

const PHYSICAL_ANOMALY_MAP: Record<string, PhysicalAnomalyType> = {
  armor_break: "armorBreak",
  stagger: "slam",
  knockdown: "knockdown",
  knockup: "launch",
};
```

### action.effects 循环路由逻辑

```
effectType ──→ ELEMENT_ATTACH_MAP 命中？──→ enqueue APPLY_MAGIC_ATTACHMENT
         │
         └──→ PHYSICAL_ANOMALY_MAP 命中？──→ enqueue APPLY_PHYSICAL_ANOMALY
         │
         └──→ 其它 ──→ legacy EFFECT_START 路径（保留兼容）
```

## 10. 未做的事

- 未删除旧模块（ReactionRegistry / AfflictionEffectMap / EffectStartHandler）
- 未改 DamageResolver / multiplierZones / EnemyStatusState / AnomalyHandlers
- 未做天赋 / 潜能 / runtime_conditional 相关
- 未做 UI 改动
- 未新增 registry / effect 表
