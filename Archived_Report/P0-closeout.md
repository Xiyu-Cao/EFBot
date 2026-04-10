# P0 收口报告

---

## 1. 分类

P0：个别技能真值校正 + UI 补口 — 最终收口验证

## 2. 本轮是否改了代码

上一步已完成 ESTELLA pre-damage 修正 + 15% 真值替换。本轮收口验证确认所有改动正确，**无额外代码变更**。

## 3. A/B/C/D 四项当前状态

### A. ARDELIA 连携腐蚀 duration — ✅ 已收口

- gamedata 已从 `duration: 10` 修正为 `duration: 7`
- Route 2.5（DIRECT_ANOMALY_MAP）正确路由 `corrosion` → APPLY_DIRECT_ANOMALY
- durationOverride = 7 正确传入 `applyCorrosion`
- **潜能 5 +4s（→11s）**：当前 potentials.json 无结构化 effect → 未接入 runtime。标记 TODO

### B. ARDELIA 战技消耗腐蚀 — ⚠ 阶段性临时实现

- `consume_corrosion_apply_vuln` boundEffect 正常工作
- DamageHandler post-damage 处理：检查 `enemy.status.corrosion` → 消耗 → 施加 PHYSICAL_VULNERABLE + SPELL_VULNERABLE
- 脆弱数值从 skills.json 读取（M3: 20%, 30s）
- **本次 hit 不吃新施加的脆弱**（post-damage 语义，与 consume_conduction 一致）
- 后续 hit 正确吃到双脆弱
- ESTELLA 的 pre-damage 调整未影响此处逻辑（已验证 consume_corrosion_apply_vuln 仍在 processPostDamageEffects 中）

### C. ESTELLA physical_vulnerable — ✅ 已彻底修正

四项核对结果：
1. ✅ **只有 frozen 目标才施加**：检查 `status.freeze` 存在、未过期、未碎冰
2. ✅ **施加时点在 damage resolve 之前**：pre-damage boundEffect 处理，在 `resolver.resolve()` 之前执行
3. ✅ **当前 hit 吃到该脆弱**：PHYSICAL_VULNERABLE effect 在 enemy.effects 中先于伤害计算注册 → `computeVulnerabilityZone` 读到
4. ✅ **数值来自 skills.json**：`getSkillsJsonRowByLabel("ESTELLA", "link", "物理脆弱倍率")` → M3 = 15%（替代了旧的 12% 公式值）

Route 2.7 已排除 ESTELLA（`action.trackId !== "ESTELLA"`），不再无条件注册。

### D. Boss debuff 栏 — ✅ 已收口

- `DIRECT_ANOMALY_DEFAULT_DURATIONS` 正常：burning=10s, frozen=6s, conductive=12s, corrosion=15s
- `_resolveAnomalyDebuffBarDuration` 在 gamedata duration=0 时回退到系统默认值
- 本轮修改未影响此逻辑

## 4. 已正式收口

| 项目 | 状态 |
|---|---|
| ARDELIA 连携腐蚀基础 duration（7s） | ✅ |
| ESTELLA physical_vulnerable（冻结条件 + pre-damage + 15%） | ✅ |
| Boss debuff 栏 direct anomaly 显示 | ✅ |

## 5. 仍是阶段性实现

| 项目 | 说明 |
|---|---|
| ARDELIA 战技 consume_corrosion_apply_vuln | 临时 boundEffect 方案，后续应迁移到 releaseConditions + variant 体系 |
| ARDELIA 潜能 5 腐蚀 +4s | potentials.json 无结构化 effect，duration 扩展未接入 runtime |
| ESTELLA 潜能 1 脆弱 +3s | 同上 |

## 6. 新增真值源或临时覆盖层

无。所有数值从 gamedata.json / skills.json 现有主路径读取。

## 7. 后续建议（不在本轮实施）

1. **ARDELIA 战技 → variant 化**：在 `releaseConditions` 中扩展 `enemyHasAnomaly` 条件类型，`result` 中支持 `consumeEnemyAnomaly`。ARDELIA 战技迁移到强化战技 variant（gamedata 已有 `variants[0]`）。可同时覆盖其他需要 enemy 状态检测的角色。

2. **潜能 duration 扩展通用方案**：在 potentials.json 中补结构化 effect（如 `{ type: "duration_extension", target: "link_corrosion", value: 4 }`），在 simulation 层读取并传入 durationOverride。

3. **pre-damage boundEffect 通用化**：当前 ESTELLA 的 pre-damage 处理是在 `handle()` 中硬编码 `includes("estella_phys_vuln_if_frozen")`。如果后续有更多 pre-damage 效果，考虑将 boundEffects 分为 `preDamageEffects` 和 `postDamageEffects` 两个数组。

---

### 给主会话的简明总结

P0 四项子任务已全部处理完毕：

- **ARDELIA 连携腐蚀 duration** 已从错误值 10s 修正为游戏真值 7s，潜能 5 +4s 留作 TODO
- **ESTELLA physical_vulnerable** 已彻底修正：改为冻结条件触发 + pre-damage 时序（当前 hit 可吃到）+ 数值从 skills.json 读取（M3 = 15%，替代旧的 12%）
- **ARDELIA 战技消耗腐蚀** 当前用 boundEffect 临时方案实现（post-damage 消耗 + 双脆弱施加）。后续更干净的方向是接入 releaseConditions + variant 体系（gamedata 已有强化战技 variant），扩展 `enemyHasAnomaly` 条件类型
- **Boss debuff 栏** direct anomaly duration 回退已修正，burning/frozen/conductive/corrosion 可正常显示
