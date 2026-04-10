# G-P1 实施报告

## 1. 修改文件
- 路径: `src/simulation/data/skillStatusRegistry.ts`
- 修改类型: WIP_OVERRIDES 条目清理 + 理由文本更新
- 改动是否最小范围: **是**。1 个文件，1 处 object literal 修改

## 2. 具体改动
- 删除了哪些过时 override:
  - `"ALESH:link"` — 移除（C 分支确认 variant 系统端到端工作，底层 SM status=verified）
  - `"ARCLIGHT:skill"` — 移除（C 分支确认 variant 系统端到端工作，底层 SM status=verified）
- 保留了哪些 override:
  - `"AVYWENNA:skill"` — 保留为 wip
- 更新了哪些理由文本:
  - `AVYWENNA:skill` 从 `"雷枪召回伤害已接入(damageSummary), 潜能持续时间加成未接入"` 更新为 `"雷枪召回基础机制已可用; 潜能+20s持续时间未接入"`

## 3. 行为变化
- ARCLIGHT:skill: **wip → supported**。ActionItem 不再显示"处理中"黄色 tag
- ALESH:link: **wip → supported**。ActionItem 不再显示"处理中"黄色 tag
- AVYWENNA:skill: **wip → wip（不变）**。仍显示"处理中"。只是内部理由文本更准确
- 是否影响其他状态: **否**。其他角色/技能不在 WIP_OVERRIDES 中，不受此改动影响

## 4. 验证情况
- 做了哪些验证:
  - Build 成功（无编译错误）
  - 代码级逻辑跟踪：移除 ALESH:link override → `getSkillDisplayStatus` 走 SM entry → `status=verified` → 返回 "supported" ✅
  - 代码级逻辑跟踪：移除 ARCLIGHT:skill override → 同上 → "supported" ✅
  - 代码级逻辑跟踪：AVYWENNA:skill 仍在 WIP_OVERRIDES → 仍返回 "wip" ✅
  - 抽检不相关角色（ENDMINISTRATOR/TANGTANG/ROSSI）→ 走 hasSkillsJsonMultiplier 或 unsupported 路径，不受影响 ✅
- 能确认什么: 状态判定逻辑正确，修改范围完全符合预期
- 不能确认什么: 未实际运行页面验证 ActionItem tag 渲染。但 ActionItem 只读 `getSkillDisplayStatus()` 返回值，逻辑路径已经过代码级验证

## 5. 风险与备注
- 本次是否改动了状态判定逻辑: **否**。只改了数据（WIP_OVERRIDES 内容），未动 `getSkillDisplayStatus` 函数
- 本次是否改动了 UI 聚合逻辑: **否**。ActionItem.vue 和 DamageSummaryPanel.vue 均未修改
- 是否引入新的真值源或临时覆盖层: **无**

## 6. 给 G 分支下一步（P2）的建议

本轮 WIP_OVERRIDE 清理已完成，状态收口到位。

P2 建议方向（按优先级）:

1. **MVP 上线清单整理**: 梳理"当前项目从状态角度看，哪些可以直接上线，哪些需要额外提示"
2. **unsupported 语义细化**: 当前 9 个 unsupported 全是非直接伤害技能。可考虑是否需要区分"无伤害技能（非 bug）"和"缺数据技能（bug/WIP）"两种不同的 unsupported 含义
3. **上线前 checklist**: 确认导出/分享功能、数据完整性、性能等非机制层面的上线准备项

以上都不应越界到 B/C/D/E/F 分支的工作范围。
