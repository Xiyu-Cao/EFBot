# Phase 7 收口审计报告

## 结论：建议合并

202 tests pass, 0 TypeScript errors.

---

## 审查发现与修复

| # | 严重程度 | 文件 | 问题 | 修复 |
|---|---|---|---|---|
| 1 | LOW | `PhysicalReactionResolver.ts` | launch/knockdown 的 `if (!isControlImmune)` 和 `else` 分支代码完全相同（dead branch） | 合并为无条件执行 + 清晰 TODO 注释 |
| 2 | LOW | `runSimulation.ts` | `(scenario as any).equipmentDatabase` 裸 `as any` | 改为显式类型交叉 `ScenarioData & { equipmentDatabase?: ... }` |

---

## 确认无问题的检查项

| 检查项 | 结果 |
|---|---|
| armorBreak 异常伤害 vs 物理易伤 debuff 是否分离 | 完全分离：`PHYSICAL_DAMAGE` outcome 走 `getBreachMultiplier`，`PHYSICAL_VULN_APPLIED` outcome 走 `calcBreachPhysVulnerability` |
| placeholder 15% 是否残留 | 无残留。`multiplierZones.ts` 中无 `15` 字面量 |
| 物理易伤覆盖逻辑 | 使用 `addOrRefreshBuff`，与导电覆盖一致 |
| 物理易伤只影响物理伤害 | `tags.damageSchool === "physical"` 守卫，测试覆盖（armorBreak vuln does NOT affect magic damage） |
| freeze immune 时 debuff/shatter | freeze debuff 仍保留（`EnemyStatusState` 不检查免疫），shatter 仍触发（resolver 注释明确） |
| launch/knockdown immune 时伤害 | `PHYSICAL_DAMAGE` outcome 无条件产生，`isControlImmune` 只控制未来可能的控制状态跳过 |
| sweepExpired tag 清理 | `updateTags(eff, -1)` 在删除时正确调用 |
| sweepExpired Map 迭代安全性 | JS Map spec 允许迭代时删除，安全 |
| GameState.advanceTime 覆盖所有 actor | `for (const actor of this.actors.values())` 遍历 + `actor.advanceTime` |
| extractEquipmentConfigs 不会重复注册 | 每个 track 只产生一个 config entry |
| definitions.ts 无 stats 突变 | 仅有注释中提到 `stats`，无实际 `+=` / `*=` |

---

## 仍保留的 TODO

| 问题 | 优先级 | 说明 |
|---|---|---|
| weapon triggeredBuffs 半自动读取 | **P0 — 第八阶段第一优先** | 当前 trigger/target/duration/maxStacks/stackCooldown 仍在 definitions.ts 手写，应从 gamedata.json 读取 |
| compile pipeline 完整数据传递 | **P0** | `runSimulation` 的 `equipmentDatabase` 需要 UI 层或 compile 层传入才能生效；当前无 `equipmentDatabase` 则 set bonus 检测被跳过 |
| 更多 boss template 真值 | P1 | gamedata.json 的 enemyDatabase 不含 defenseMultiplier / resist / controlImmunities |
| controlImmunities 对 break 累积的影响 | P1 | 当前保守实现（仍累积），需实机确认 |
| skill_damage_ticks multiplier 真值 | P1 | gamedata.json 的 ticks 无 multiplier 字段 |
| 蚀迹武器 ID 未确认 | P2 | `WEAPON_ID_TO_KEY` 中 `wpn_staff_0006` 标注 TODO |

---

## 第八阶段是否有阻塞风险

**无阻塞**。理由：

1. `extractEquipmentConfigs` 的 `equipmentDatabase` 参数是 optional — 缺失时 gracefully 跳过 set detection，weapon 仍正常
2. `CATEGORY_TO_SET_ID` 和 `WEAPON_ID_TO_KEY` 是纯数据映射 — 第八阶段可自由扩展
3. `registerEquipmentPassives` 接口稳定 — 新增装备只需添加 definitions 函数 + registry 映射
4. `DynamicBonus.zone` 判别字段已覆盖所有当前乘区 — triggeredBuffs 半自动读取可直接映射到此
5. `sweepExpired` 不会影响 triggeredBuffs 的 trigger 注册（passive effects duration=Infinity，不会被清扫）
