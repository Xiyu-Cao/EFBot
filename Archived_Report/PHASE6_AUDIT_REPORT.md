# Phase 6 局部精修审计报告

## 审查结论：建议合并

189 tests pass, 0 TypeScript errors.

---

## 修复项列表

| # | 严重程度 | 文件 | 修复内容 |
|---|---|---|---|
| 1 | MEDIUM | `utils/anomalyCalc.js` | `calcSpellBurstDamage` 签名增加 `artsPower` 参数（默认 0 保持兼容），消除 burst 不吃 artsPower 的公式分叉 |
| 2 | MEDIUM | `stores/timelineStore.js` | 调用 `calcSpellBurstDamage(stats.attack, artsPower)` 传入 artsPower，UI 投影与 simulation 对齐 |
| 3 | MEDIUM | `anomaly/types.ts` + `PhysicalReactionResolver.ts` + `AnomalyHandlers.ts` | `PHYSICAL_DAMAGE` outcome 增加 `breakStacks` 字段；resolver 在 clear 之前捕获；handler 使用 outcome 中的 stacks 而非读 state（修复 slam/armorBreak 永远 stacks=0 的 bug） |
| 4 | LOW | `calculation/multiplierZones.ts` | 删除未使用的 `CONDUCTION_PERCENT_BY_LEVEL` 导入 |
| 5 | LOW | `utils/anomalyCalc.js` | 修正冗余 identity alias `calcBreachPhysVulnerability as calcBreachPhysVulnerability` |

---

## 仍未解决的问题

| 问题 | 原因 | 建议 |
|---|---|---|
| armorBreak 物理易伤仍为 placeholder 15% | 需要 `calcBreachPhysVulnerability` 的结果写入 effect properties；当前 effect 系统不存储 debuff 数值 | 下一阶段：在 armorBreak 处调用 `calcBreachPhysVulnerability` 并存储到 effect |
| `controlImmunities` 结构已定义但 `PhysicalReactionResolver` 尚未读取 | 需要修改 resolver 检查 config | 下一阶段：resolver 根据 `config.controlImmunities` 跳过控制效果但保留伤害 |
| UI 投影函数不走乘区管线 | 这些是 UI 预估显示用，有意不走全管线 | 保持现状，UI 层标注"仅供参考" |
| 蚀迹 +19.6% 攻击力的 timelineStore 处理方式 | 需确认 timelineStore 的 `buffBonuses` delta 机制是否正确将此作为 percentBonus 而非 flatBonus 处理 | 需实测确认 |
| buff 过期仍只在计算时跳过，未从 EffectManager 清理 | 内存效率问题，不影响正确性 | P2 优先级 |

---

## 必须等后续真实规则/实机验证的问题

1. **armorBreak 物理易伤的精确数值** — 公式已有 (`calcBreachPhysVulnerability`)，但需确认 armorBreak 消耗的层数如何影响最终值
2. **boss 具体法抗/物抗数值** — `gamedata.json` 的 `enemyDatabase` 不含此字段，需要从游戏客户端提取
3. **控制免疫的具体 boss 清单** — 哪些 boss 免疫哪些控制类型，需要实测数据
