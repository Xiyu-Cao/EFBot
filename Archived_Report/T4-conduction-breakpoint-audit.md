# T4 导电不影响伤害断点定位

---

## 测试现象

- 狼卫战技先挂灼热附着
- 佩丽卡战技再挂电磁附着
- 系统显示灼热转化为 1 级导电
- 但别礼终结技在"有导电"和"无导电"两种情况下，伤害都为 2656，完全一致

## 根因

DamageSummary 面板**完全不走 simulation 引擎**，使用的是独立简化伤害公式 `_calcHitDamage()`。

### 关键代码证据

**`timelineStore.js` line 6150** — DamageSummary 调用点：
```javascript
const dmg = _calcHitDamage(stats.attack, mult, element, skillType, stats, fragile, 0, false)
//                                                                          ↑ vulnerability 硬编码 = 0
```

**`timelineStore.js` line 6042-6063** — `_calcHitDamage` 函数体：
```javascript
const defense      = 0.5
const resistance   = 1.0  // 暂不计入抗性（由外部传入，后续扩展）
// ...
const vulnFactor    = 1 + (vulnerability || 0) / 100  // vulnerability 传入 0 → 始终 1.0
```

### DamageSummary 不消费的运行时状态

| 状态 | simulation 引擎 | DamageSummary |
|---|---|---|
| 导电 (conduction) → 法术易伤 | **消费** — `computeVulnerabilityZone` | **不消费** — vulnerability=0 |
| 腐蚀 (corrosion) → 减抗 | **消费** — `computeResistanceZone` | **不消费** — resistance=1.0 |
| 元素附着/反应 | **消费** — `APPLY_MAGIC_ATTACHMENT` → `MagicReactionResolver` | **不追踪** |
| 武器触发 buff | **消费** — TriggerProcessor → dynamicBonuses | **不消费** |
| 天赋 runtime_passive | **消费** — fragility zone | **部分** — 仅通过 debuff segments |
| 失衡加成 | **消费** — break zone 1.3 | **不消费** — isBroken=false |

---

## 逐项检查结果

### 1. 导电状态链路 — simulation 引擎内正确

- `APPLY_MAGIC_ATTACHMENT(fire)` → `APPLY_MAGIC_ATTACHMENT(electro)` → `resolveMagicAttachment()` 检测跨元素
- `CROSS_ELEMENT_ANOMALY["electro"] = "conduction"` → `applyAnomalyDebuff()` → `status.applyConduction(1, sourceActorId, time)`
- `EnemyStatusState.conduction = { level: 1, expiresAt: time + 12, sourceActorId }`
- 导电持续 12 秒（`CONDUCTION_DURATION_BY_LEVEL[1] = 12`）
- simulation 的 `computeVulnerabilityZone` 能正确消费

### 2. vulnerability zone 读取导电 — 逻辑正确

`multiplierZones.ts:200-214`：

- 读 `target.status.conduction`
- 检查 `time < conduction.expiresAt`
- 检查 `tags.damageSchool === "magic"`
- `calcConductionDebuff(level=1, artsPower=0)` → `spellVulnerability = (1+2)*4*1 = 12`
- 结果：vulnerability zone = `1 + 12/100 = 1.12`（+12% 法术易伤）

### 3. 别礼终结技的伤害标签 — 属于导电影响范围

- LASTRITE `meta.json`: `"element": "cold"`
- `actionElementToDamageType("cold")` → damageType = `"cold"`
- `getDamageSchool("cold")` → damageSchool = `"magic"`
- **`damageSchool === "magic"` → 满足导电生效条件**

### 4. 断点判定

| 假设 | 判定 | 依据 |
|---|---|---|
| A. 状态没进 EnemyStatusState | **排除** | simulation 链路完整，已有测试验证 |
| B. 别礼不吃这类易伤 | **排除** | cold → magic school → 满足 conduction 条件 |
| C. 数值映射有问题 | **排除** | `calcConductionDebuff(1, 0)` 正确返回 12% |
| **D. DamageSummary 不读 simulation 结果** | **确认** | `_calcHitDamage` 使用独立公式，vulnerability=0，resistance=1.0 |

---

## 最小修复方案（仅方案，不实施）

### 目标

让 DamageSummary 面板显示的伤害数值来自 simulation 引擎的真实计算结果，而非独立简化公式。

### 方案

在 `timelineStore.js` 中，让 `damageSummary` computed 从 simulation 的 simLog 读取已计算好的伤害值，替代 `_calcHitDamage` 独立计算。

### 具体做法

| 步骤 | 改什么 |
|---|---|
| 1 | 确保 `simulationResult`（或等价 computed）可被 `damageSummary` 依赖 |
| 2 | 从 simLog 中提取 `DAMAGE_TICK` 条目，按 `actionId` 聚合 damage |
| 3 | `damageSummary` 按 actionId 匹配 simLog 的真实 damage 值，替代 `_calcHitDamage` |

### 改动范围

只改 1 个文件：`src/stores/timelineStore.js`（damageSummary computed）

### 不需要改

- `simulator.ts` — 已正确运行
- `multiplierZones.ts` — 已正确消费
- `EnemyStatusState` — 已正确存储
- `_calcHitDamage` — 保留作为 fallback，但 damageSummary 主路径改读 simLog

### 不做

- 不在 DamageSummary 中重新实现异常状态机
- 不改 UI 组件
- 不改天赋/潜能
- 不做大重构

### 风险

低。simulation 引擎已有完整测试覆盖，simLog 的 damage 值就是真实公式输出。

### 修复后预期效果

- 有导电时：别礼终结技 damage = 2656 × 1.12 ≈ 2974
- 有腐蚀时：物理伤害通过减抗增加（取决于腐蚀等级和持续时间）
- 所有 simulation 运行时 buff/debuff 自动反映在 DamageSummary 面板
