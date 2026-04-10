# Phase 7 Report

202 tests pass, 0 TypeScript errors.

---

## 收掉的 TODO

| 原 TODO | 修复 |
|---|---|
| armorBreak 物理易伤 placeholder 15% | 改为调用 `calcBreachPhysVulnerability(stacks, artsPower)` 真值，写入 Effect.properties.physVulnPercent |
| multiplierZones 读 placeholder 15% | 改为从 enemy EffectManager 的 PHYSICAL_VULNERABLE 效果中读取 `physVulnPercent` 真值 |
| 碎甲物理易伤重复施加会产生多个 effect | 改为使用 `addOrRefreshBuff` 覆盖式写入（与导电覆盖逻辑一致） |
| PhysicalReactionResolver 不读 controlImmunities | 现在接收 `controlImmunities` 参数，按类型判断 |
| buff 过期只在计算时跳过 | `EffectManager.sweepExpired(currentTime)` + `ActorState.advanceTime` / `EnemyState.advanceTime` 自动清扫 |
| runSimulation 不自动注册装备 | `extractEquipmentConfigs` 从 ScenarioTrack 提取装备/武器配置，自动传入 simulate() |

---

## 修改文件清单

| 文件 | 操作 | 要点 |
|---|---|---|
| `anomaly/types.ts` | MODIFIED | `PHYSICAL_VULN_APPLIED` 增加 `physVulnPercent` / `vulnDuration` 字段 |
| `anomaly/PhysicalReactionResolver.ts` | REWRITTEN | 接入 `controlImmunities` + `artsPower`；armorBreak 调用 `calcBreachPhysVulnerability` 计算真值 |
| `anomaly/AnomalyHandlers.ts` | MODIFIED | `PHYSICAL_VULN_APPLIED` handler 写入真值 Effect；`ApplyPhysicalAnomalyHandler` 传入 controlImmunities + artsPower |
| `calculation/multiplierZones.ts` | MODIFIED | vulnerability zone 从 effect.properties.physVulnPercent 读真值，删除 placeholder |
| `state/EffectManager.ts` | MODIFIED | 新增 `sweepExpired(currentTime)` |
| `state/ActorState.ts` | MODIFIED | `advanceTime` 调用 `sweepExpired` |
| `state/EnemyState.ts` | MODIFIED | `advanceTime` 调用 `effects.sweepExpired` |
| `state/GameState.ts` | MODIFIED | `advanceTime` 遍历 actors 调用 `actor.advanceTime` |
| `equipment/registry.ts` | MODIFIED | 新增 `extractEquipmentConfigs`、`CATEGORY_TO_SET_ID`、`WEAPON_ID_TO_KEY` |
| `runSimulation.ts` | MODIFIED | 调用 `extractEquipmentConfigs` 自动注册 |
| `equipment/equipment.test.ts` | MODIFIED | 修复被 sweepExpired 影响的测试 |
| `calculation/phase7.test.ts` | NEW | 12 个新测试 |

---

## 新增测试 (12 个)

| 测试组 | 数量 | 覆盖 |
|---|---|---|
| armorBreak Real Vulnerability | 5 | 真值写入 effect、artsPower 缩放、进入 vulnerability zone、不影响 magic、覆盖不叠加 |
| Control Immunities | 3 | freeze immune + shatter 仍触发、launch immune 伤害保留、knockdown immune 伤害保留 |
| Auto-registration | 2 | extractEquipmentConfigs 正确解析、少于 3 件不激活 set |
| Buff Expiry Cleanup | 3 | sweepExpired 清除过期 buff、Infinity 不清除、enemy effects 也清除 |

---

## 自动读取数据源的字段

| 字段 | 数据源 | 读取方式 |
|---|---|---|
| 装备 category → set ID | `gamedata.json equipmentDatabase[].category` | `CATEGORY_TO_SET_ID` 映射 |
| 武器 id → weapon key | `gamedata.json weaponDatabase[].id` | `WEAPON_ID_TO_KEY` 映射 |
| 套组激活 (3+ 同 category) | `ScenarioTrack.equipArmorId/equipGlovesId/equipAccessory*Id` | `extractEquipmentConfigs` 计数 |
| 武器 ID | `ScenarioTrack.weaponId` | 直接读取 |

---

## 仍保留的 TODO

| 问题 | 优先级 | 说明 |
|---|---|---|
| controlImmunities 对 break 累积的影响 | P1 | 当前保守实现：即使 control immune 仍累积 break stacks，需实机确认 |
| weapon triggeredBuffs 半自动读取 | P1 | 当前仅映射 ID→注册函数，trigger/target/duration/maxStacks/stackCooldown 仍在手写 definitions |
| `WEAPON_ID_TO_KEY` 硬编码映射 | P2 | 理想情况应从 gamedata.json 元数据自动推导 |
| 蚀迹 +19.6% 攻击力 timelineStore 处理方式确认 | P2 | 需确认 buffBonuses delta 是否正确作为 percentBonus |
| UI 投影 vs simulation 结果对比工具 | P3 | 用于验证两套计算的一致性 |

---

## 下一阶段建议

1. **weapon triggeredBuffs 半自动读取** — 从 `gamedata.json` 读取 trigger/target/duration/maxStacks/stackCooldown 填入 EffectTrigger，definitions 只补 effects 数值
2. **compile pipeline 集成** — 将 `extractEquipmentConfigs` 的 `equipmentDatabase` 参数从 gamedata.json 自动传入
3. **更多 boss 模板** — 从 enemyDatabase 读取 defenseMultiplier / resist / controlImmunities（需游戏数据补充）
4. **armorBreak 控制免疫 vs break 累积** — 实机验证后确定
5. **第一批角色技能真实 multiplier** — 从 gamedata.json 的 `skill_damage_ticks` 读取或补充 multiplier 字段
