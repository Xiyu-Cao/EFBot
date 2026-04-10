# G-P2 审计与方案报告

---

## 1. 当前 unsupported 项语义分类

### Category A: 非直接伤害技能（6 个）
本来就不产生伤害 tick，gamedata 中 damage_ticks = 0

| 技能 | 名称 | 实际功能 | 为什么 unsupported |
|---|---|---|---|
| LAEVATAIN:ultimate | 黄昏 | 强化后续普攻 | 无"伤害倍率"行，只有"强化普攻倍率" |
| XAIHI:skill | 分布式拒绝服务 | 治疗 + 法术增幅 | 治疗/增幅技能，无倍率行 |
| XAIHI:ultimate | 栈溢出 | 寒冷/自然增幅 | 增幅型终结，无倍率行 |
| SNOWSHINE:link | 极地救援 | 治疗连携 | 治疗技能，无倍率行 |
| ANTAL:ultimate | 超频时刻 | 电磁/灼热增幅 | 增幅终结，无倍率行 |
| AKEKURI:ultimate | 小队，集结！ | SP 恢复 | 回能终结，无倍率行 |

**对用户是否误导**: **中等风险**。用户看到排轴上的红色"未支持"tag，可能误以为"这个技能坏了/系统少算了"，而实际是"这个技能本来就不直接打伤害"。

**DamageSummary 中的表现**: 这 6 个技能有 0 ticks → **不出现在 DamageSummary 中**。只有 ActionItem timeline 条上有"未支持"tag。

### Category B: 真正缺数据（3 个）

| 技能 | 名称 | 实际功能 | 为什么 unsupported |
|---|---|---|---|
| ROSSI:skill | (无名) | 应有直接伤害 | ROSSI 无 wiki 数据，skills.json 为空 |
| ROSSI:link | (无名) | 未知 | 同上，且 gamedata 中 0 ticks |
| ROSSI:ultimate | (无名) | 应有直接伤害 | 同上 |

**对用户是否误导**: **不误导**。ROSSI 确实缺数据，"未支持"准确。

## 2. 当前文案/标签语义审计

### "处理中"（ActionItem 黄色 tag）
- 当前语义: 基础倍率可算，但专属机制/精度未完整
- 用户可能理解: "这个技能在开发中，数字可能不太准"
- **准确度: 好**。语义诚实，不会严重误导

### "未支持"（ActionItem 红色 tag）
- 当前语义: 完全缺 multiplier，伤害为 0
- 用户可能理解: "这个技能坏了 / 没做好 / 系统少算了"
- **准确度: 对 Category B（ROSSI）准确，对 Category A（治疗/增幅）容易误导**
- 混淆风险: 用户看到 XAIHI 战技"未支持"，可能以为"治疗没算进去"或"系统有 bug"

### "未支持"（DamageSummary 技能行红色标签）
- 当前语义: 该 action 的所有 ticks 的 multiplier 都为 0
- 用户可能理解: "这个技能没有算入总伤"
- **准确度: 准确**。只对 ROSSI 这种有 tick 但无 multiplier 的情况触发
- Category A 的 6 个技能有 0 ticks → 根本不出现在 DamageSummary → 不会触发此标签

### "部分未支持"（DamageSummary 技能行）
- 当前语义: 部分 ticks 有 multiplier，部分没有
- **当前几乎不会触发**。B 分支的 multi-tick 映射已覆盖了绝大多数情况
- 准确度: 准确（如果真出现的话）

### "部分未计入"（DamageSummary 角色行）
- 当前语义: 该角色有至少一个 action 含 unsupported ticks
- **只对 ROSSI 触发**（ROSSI skill/ult 有 ticks 但无 multiplier）
- 准确度: 准确

## 3. MVP 上线视角评估

### 当前是否可以作为 MVP 上线: **是**

理由:
1. 25 个角色中 24 个有完整 skills.json 数据（仅 ROSSI 缺失）
2. 75 个 skill/link/ultimate 技能中：3 supported + 63 wip + 9 unsupported
3. 63 个 wip 的基础伤害已经能算（skills.json 全量覆盖）
4. 9 个 unsupported 中 6 个本来就不产直接伤害
5. DamageSummary 面板的 tick-level 判断准确，不会伪造数值
6. simulation 健壮性修复已到位，不会因单个报错崩溃全局

### 可以上线的前提:
- 用户理解"处理中"意味着精度可能不完整
- 用户理解"未支持"可能包含"本来就不直接打伤害"的技能
- 项目有一个简短的总说明

### 必须附带的限制说明:
- 见下方 §5 推荐文案

### 暂时不需要阻塞上线的问题:
- Category A 的"未支持"文案不够精准 → 不影响伤害计算正确性
- ROSSI 缺数据 → 只影响 ROSSI 一个角色
- 潜能系统未接入 → 不影响基础伤害
- 部分多 tick 的 tick 内分配是估算 → wip 标签已告知用户

## 4. 最小修正方案（不实施）

### 主方案: 仅改 ActionItem 的 unsupported tooltip

**修改目标**: 对 ActionItem 的"未支持"tag 补充 tooltip，区分"无伤害数据"和"非伤害型技能"

**建议修改文件**: `ActionItem.vue`（1 个文件，极小改动）

**具体改什么**:
- 给 `.skill-unsupported-tag` 加 `title` 属性
- 当该技能在 gamedata 中有 0 damage ticks 时：tooltip = "该技能为辅助/增幅型，不直接造成伤害"
- 当该技能有 damage ticks 但缺 multiplier 时：tooltip = "该技能的伤害倍率数据暂缺"

**为什么是最小范围**: 不改状态逻辑、不改 registry、不改 DamageSummary、不新增状态枚举。只是在已有 tag 上加 hover 提示。

**预期用户可感知变化**: hover "未支持" tag 时看到不同解释文案。

### 备选方案: 不改代码，仅在产品层面加总说明

如果不想改任何代码，可以只在产品介绍/帮助/首屏提示中写一段 MVP 说明（见 §5），不改任何组件。

## 5. 推荐的上线说明文案

```
排轴伤害计算 · 当前版本说明

本版本支持大多数干员的基础伤害倍率计算，技能等级（RANK 1~M3）已接入。

技能状态标识：
· 无标签 — 倍率已校验，计算结果可参考
· 处理中 — 基础倍率已接入，部分专属机制仍在完善中
· 未支持 — 该技能的伤害数据暂缺，或该技能为辅助/增幅/治疗型

注意事项：
· 武器/装备属性已接入面板，攻击力百分比加成已正确进入乘区
· 部分多段技能的段内分配为估算值
· 潜能系统尚未接入
· 个别角色（洛茜）因缺少 wiki 数据源，当前完全未支持
```

## 6. 风险与边界

| 项目 | 归属 |
|---|---|
| ActionItem tooltip 修正 | G 分支可解决 |
| 上线说明文案 | G 分支可解决 |
| "未支持"拆分为两种状态枚举 | 超出 G 分支（需改 registry + UI，归 D 分支） |
| 辅助/治疗技能效果接入计算 | 超出 G 分支（归 C/runtime 分支） |
| ROSSI 数据补全 | 超出 G 分支（归 E/数据分支） |

**是否需要新增真值源或平行状态系统**: **无**。主方案只改 UI tooltip，不动状态逻辑。

## 7. 给 G 分支下一步（P3）的建议

P3 建议做两件事:

1. **实施主方案**: ActionItem.vue 的 unsupported tooltip 区分（极小改动，1 文件）
2. **把上线说明文案提交给主会话审阅**: 不由 G 分支自行上线，而是作为建议文案交给中心对话决定放在哪里

不建议在 P3 继续做:
- 不拆分 unsupported 为两种状态枚举（成本不低，MVP 阶段不必要）
- 不补 ROSSI 数据（归 E 分支）
- 不做大规模 UI 精修
