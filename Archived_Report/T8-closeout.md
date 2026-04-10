# T8 收口报告

---

## 本轮完成的改动

### 1. 通用 enemy debuff 聚合补口

**文件**：
- `src/simulation/equipment/types.ts` — 新增 `aggregateEnemyZoneBonuses(state, zone, tags?)`
- `src/simulation/calculation/multiplierZones.ts` — `computeFragilityZone` 和 `computeVulnerabilityZone` 各加 1 行 target-side 读取

**效果**：enemy.effects 上的 dynamicBonuses 现在可被 fragility / vulnerability zone 消费。`registerTriggeredBuff({ target: "enemy" })` 对这两个 zone 可用。

### 2. GILBERTA spell_vulnerable 路由

**文件**：`src/simulation/simulator.ts` — Route 2.8

**效果**：GILBERTA 终结技的 `spell_vulnerable` → enemy.effects 上创建 `{ stat: "arts_dmg", value: 12, zone: "fragility" }` → 法术伤害增加 12%（5s）。数值来源：`calcConductionDebuff.spellVulnerability`。

### 3. 暴击基线问题定位与临时修复

**发现**：
- `critSystem.ts` 硬编码 `BASE_CRIT_RATE = 5%`、`BASE_CRIT_DAMAGE = 50%`（1.5x）
- simulation 默认用 `Math.random` → 伤害在非暴击/暴击间随机跳变
- PERLICA 战技：非暴击 1412，暴击 2118（比值 = 1.5）

**文件**：`src/stores/timelineStore.js` — simulation computed 内新增 `TEMP_FORCE_NO_CRIT_FOR_DAMAGE_STATS = true`，传 `rng: { deterministicCrits: 'neverCrit' }`

**效果**：所有 simulation run 强制不暴击，伤害统计结果确定性化。

**回收标记**：搜索 `TEMP_FORCE_NO_CRIT` 即可定位（仅 1 处）。后续正式暴击模式上线后需替换或移除。

### 4. 测试文档修正（v2）

**文件**：`reports/T8-test-cases-v2.md`

**修正内容**：
- 所有角色 ATK 计算包含天赋 Row 1 主属性加成（E4 累计 +60）
- 明确暴击已强制关闭

---

## 人工验证结果

| 测试 | 预期 | 实测 | 状态 |
|---|---|---|---|
| PERLICA 战技基线 | 1412 | 1412 | ✅ |
| GILBERTA spell_vulnerable + PERLICA 战技 | 1581 (+12%) | 正确 | ✅ |
| ENDMINISTRATOR 战技（含天赋 passive） | 1503 | 1503 | ✅ |
| 腐蚀影响管理员伤害 | 有效 | 有效 | ✅ |

---

## 已知待处理项（本轮不做）

| 项目 | 说明 |
|---|---|
| Boss debuff 栏不显示异常 | UI 读 `debuffStatuses` ref，不读 simulation EnemyStatusState。不影响计算，后续 UI 任务处理 |
| ARDELIA 连携腐蚀 duration | gamedata 写 10s，游戏实际 7s（潜能 5 后 11s）。后续修技能数据时校正 |
| ARDELIA 战技消耗腐蚀 → 施加物理/法术脆弱 | 复合技能机制，未实现，标记 TODO |
| ESTELLA physical_vulnerable 触发验证 | 编译应包含全部 3 个 anomaly group，Route 2.7 应捕获。如仍不生效需进一步排查时序 |
| `isEffectActive` 不检查 startTime 下界 | Route 2.7/2.8 在 setup 阶段注册的 effect 从 time=0 即活跃。后续考虑加 startTime 下界检查 |
| 暴击临时开关回收 | `TEMP_FORCE_NO_CRIT_FOR_DAMAGE_STATS` 需在正式暴击模式上线后移除 |

---

## 本轮改动文件汇总

| 文件 | 改动 |
|---|---|
| `src/simulation/equipment/types.ts` | +`aggregateEnemyZoneBonuses` 函数 |
| `src/simulation/calculation/multiplierZones.ts` | fragility/vulnerability zone 加 target-side 读取 |
| `src/simulation/simulator.ts` | Route 2.8 spell_vulnerable + import |
| `src/stores/timelineStore.js` | TEMP_FORCE_NO_CRIT 临时开关 |
