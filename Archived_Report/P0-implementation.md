# P0 技能真值校正 + UI 补口实施报告

---

## 1. 处理的分类

P0：个别技能真值校正 + boss debuff 栏 UI 小修

## 2. 实际改了哪些文件

| 文件 | 改动 |
|---|---|
| `public/gamedata.json` | ARDELIA 连携腐蚀 duration 10→7；ARDELIA 战技 boundEffect 加 `consume_corrosion_apply_vuln`；ESTELLA 连携 boundEffect 加 `estella_phys_vuln_if_frozen` |
| `src/simulation/events/DamageHandler.ts` | +3 imports；新增 `estella_phys_vuln_if_frozen` handler（冻结条件 physical_vulnerable）；新增 `consume_corrosion_apply_vuln` handler（消耗腐蚀→物理+法术脆弱） |
| `src/simulation/simulator.ts` | Route 2.7 排除 ESTELLA（她的 physical_vulnerable 改走 boundEffect 条件路径） |
| `src/stores/timelineStore.js` | `_resolveAnomalyDebuffBarDuration` 新增 direct anomaly 默认持续时间回退（burning=10s, frozen=6s, conductive=12s, corrosion=15s） |

## 3. 每个文件改了什么

### gamedata.json
- ARDELIA link_anomalies corrosion `duration: 10` → `duration: 7`（真值校正）
- ARDELIA skill_damage_ticks boundEffects 加 `"consume_corrosion_apply_vuln"`
- ESTELLA link_damage_ticks boundEffects 加 `"estella_phys_vuln_if_frozen"`

### DamageHandler.ts
**`estella_phys_vuln_if_frozen`**：检查 `enemy.status.freeze` 是否活跃且未碎冰 → 如果是，创建 PHYSICAL_VULNERABLE Effect（12%，6s）on enemy.effects

**`consume_corrosion_apply_vuln`**：检查 `enemy.status.corrosion` → 如果存在：清除腐蚀 + 创建 PHYSICAL_VULNERABLE（tag+physVulnPercent）和 SPELL_VULNERABLE（dynamicBonuses arts_dmg fragility）。脆弱百分比和持续时间从 ARDELIA skills.json `getSkillsJsonRowByLabel` 读取（M3: 20%, 30s）。

### simulator.ts
Route 2.7 条件改为 `effectType === "physical_vulnerable" && action.trackId !== "ESTELLA"`。ESTELLA 的 physical_vulnerable 改由 boundEffect 条件路径处理。

### timelineStore.js
`_resolveAnomalyDebuffBarDuration` 新增 `DIRECT_ANOMALY_DEFAULT_DURATIONS` 映射，direct anomaly 类型（burning/frozen/conductive/corrosion）在 gamedata duration=0 时回退到系统默认持续时间。

## 4. 前端可直接观察到什么变化

- **ARDELIA 连携腐蚀**：duration 从 10s → 7s（boss debuff 栏应显示更短的腐蚀条）
- **ARDELIA 战技 + 腐蚀目标**：消耗腐蚀后物理伤害和法术伤害都增加（20%@M3，30s）
- **ESTELLA 连携**：只有目标处于冻结状态时才施加物理脆弱；非冻结目标不再错误获得脆弱
- **Boss debuff 栏**：`burning`（如 WULFGARD 终结技）现在应显示为 10s 条；`corrosion` 显示为 7s（ARDELIA 连携）或 15s（反应产生）；`conductive`/`frozen` 同理

## 5. 已可收口

| 项目 | 状态 |
|---|---|
| A. ARDELIA 连携腐蚀基础 duration | ✅ 已修正为 7s |
| B. ARDELIA 战技消耗腐蚀→双脆弱 | ✅ 已实现，数值从 skills.json 读取 |
| C. ESTELLA physical_vulnerable 冻结条件 | ✅ 已改为条件触发 |
| D. Boss debuff 栏 direct anomaly 显示 | ✅ duration 回退已修正 |

## 6. 仍是阶段性 / TODO

| 项目 | 说明 |
|---|---|
| ARDELIA 潜能 5 腐蚀 +4s | 当前 potentials.json 无结构化 effects → 无法自动接入 durationOverride。需后续补结构化数据 |
| ESTELLA 潜能 1 脆弱 +3s | 同上，duration 扩展未接入 runtime |
| ARDELIA 战技 consume_corrosion 的脆弱不影响本次 hit | 当前采用 post-damage 语义（同 consume_conduction），腐蚀消耗和脆弱施加在本次伤害结算后。如果游戏实际是"本次 hit 也吃脆弱"，需要改为 pre-damage |
| ESTELLA physical_vulnerable 数值来源 | 当前用 calcBreachPhysVulnerability(1,0)=12%。如果 ESTELLA skills.json 有专属脆弱百分比字段应以之为准（待人工核对） |
| 编译期 anomaly 状态机与 runtime 一致性 | Boss debuff 栏是编译期计算，reaction-produced anomaly 的显示依赖编译期状态机准确性 |

## 7. 新增真值源或临时覆盖层

**没有新增真值源。**
- ARDELIA 脆弱数值从 skills.json `getSkillsJsonRowByLabel("ARDELIA", "skill", "脆弱效果")` 读取
- ESTELLA 数值用 `calcBreachPhysVulnerability(1, 0) = 12`（现有公式）
- Boss debuff 栏的 duration 回退值与 `anomaly/types.ts` 中常量一致
- ARDELIA corrosion duration 修正是 gamedata 真值校正，不是覆盖层

## 8. 一句话状态结论

| 子任务 | 结论 |
|---|---|
| A. ARDELIA 连携腐蚀 duration | ✅ 基础 7s 已修正。潜能 5 +4s 待后续 |
| B. ARDELIA 战技消耗腐蚀 | ✅ post-damage 消耗 + 双脆弱施加已实现，数值从 skills.json 读取 |
| C. ESTELLA physical_vulnerable | ✅ 改为冻结条件触发，Route 2.7 不再无条件注册 |
| D. Boss debuff 栏 | ✅ direct anomaly duration 回退已修正，burning/frozen/conductive/corrosion 应可正常显示 |
