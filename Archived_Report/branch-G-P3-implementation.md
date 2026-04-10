# G-P3 实施报告

## 1. 修改文件
- 路径: `src/components/ActionItem.vue`
- 修改类型: 新增 `unsupportedTooltip` computed + 给 unsupported tag 加 `title` 属性
- 是否最小范围: **是**。1 个文件，2 处极小改动（1 个 computed + 1 个 title 绑定）

## 2. 具体实现
- unsupported tooltip 如何判断: 读 `props.action.damageTicks.length`。0 ticks → 辅助/增幅型；>0 ticks → 缺数据
- 非直接伤害技能显示什么: hover 时 `"该技能为辅助/增幅型，不直接造成伤害"`
- 缺数据/缺倍率技能显示什么: hover 时 `"该技能的伤害倍率数据暂缺"`
- 是否改动了 tag 本文案: **否**。tag 仍显示"未支持"，只增加了 hover title

## 3. 行为变化
- 哪类用户误解被减少了: 用户 hover XAIHI/SNOWSHINE/ANTAL/AKEKURI/LAEVATAIN 的辅助型技能"未支持"tag 时，看到"辅助/增幅型，不直接造成伤害"，不会误以为系统 bug
- supported / wip 是否受影响: **否**。`unsupportedTooltip` 只在 `skillStatus === 'unsupported'` 时有值
- DamageSummary 是否受影响: **否**。DamageSummaryPanel 未修改

## 4. 验证情况
- 做了哪些验证:
  - Build 成功
  - 代码级模拟：9 个 unsupported 技能全部得到正确 tooltip 分类
  - Category A (6 个无 ticks): "辅助/增幅型" ✅
  - ROSSI:skill/ultimate (有 ticks 缺数据): "倍率数据暂缺" ✅
  - ROSSI:link (0 ticks): "辅助/增幅型" ✅
- 能确认什么: tooltip 逻辑正确，分类与 P2 审计一致
- 不能确认什么: 未实际运行页面验证 hover 交互。但 `title` 是原生 HTML 属性，浏览器自动处理 hover 展示

## 5. 风险与备注
- 是否改动状态判定逻辑: **否**
- 是否引入新的真值源或平行 registry: **无**。判断依据是 `props.action.damageTicks.length`，这是 gamedata 已有数据，不是新来源

## 6. 给 G 分支收口的建议

**可以收口。**

G 分支已完成:
- P0: 支持状态系统审计 ✅
- P1: 过时 WIP override 清理（ARCLIGHT/ALESH → supported）✅
- P2: MVP 上线边界审计 + unsupported 语义分析 + 上线说明文案 ✅
- P3: ActionItem unsupported tooltip 区分 ✅

剩余非阻塞项:
- 上线说明文案由中心对话决定放置位置（报告 §5 已提供）
- unsupported 拆分为两种枚举 → 不必要（tooltip 已足够区分）
- ROSSI 数据补全 → 归 E/数据分支

G 分支可以向主会话汇报收口。
