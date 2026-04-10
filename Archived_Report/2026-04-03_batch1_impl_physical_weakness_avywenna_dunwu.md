# 第一批实现汇报：LIFENG physical_weakness + AVYWENNA 委婉手段 + LIFENG 顿悟

> 日期：2026-04-03
> 类型：最小实现 + 测试

---

## 1. LIFENG physical_weakness（物理脆弱 enemy debuff）

### 处理的分类
enemy debuff → 脆弱乘区（fragility zone）

### 改了哪些文件
- `simulation/simulator.ts` — 新增 Route 2.6.5：`physical_weakness` → enemy PHYSICAL_WEAKNESS fragility debuff

### 改变了什么
- `physical_weakness` effect type 不再触发 UNKNOWN_EFFECT_TYPE 警告
- 命中时在 enemy.effects 上添加 `PHYSICAL_WEAKNESS` Effect，携带 `DynamicBonus { stat: "physical_dmg", value: percent, zone: "fragility" }`
- percent 值从 effect node 的 `stacks` 字段读取（fixture 中为 5）
- duration 从 effect node 的 `duration` 字段读取（fixture 中为 10s）
- 使用 addOrRefreshBuff（不叠加，重复命中刷新持续时间）

### 新增测试
- `simulator.behavior.test.ts` — "physical_weakness effect routing" (1 test)
  - 验证 enemy 获得 PHYSICAL_WEAKNESS fragility debuff
  - 验证不再产生 UNKNOWN_EFFECT_TYPE diagnostic
  - 验证 DynamicBonus 值和 zone 正确

### 前端验证
- 排轴放置 LIFENG 战技 → simLog 不再有 physical_weakness 的 UNKNOWN_EFFECT_TYPE
- DamageSummaryPanel 中后续物理伤害应提升（fragility zone 加成）

### 已知限制
- 真实 gamedata.json 中 LIFENG 战技使用的是 `physical_vulnerable`（已有路由），不是 `physical_weakness`
- `physical_weakness` 主要出现在 fixture 测试数据中
- 两者都已有路由：`physical_vulnerable` → 易伤区，`physical_weakness` → 脆弱区

---

## 2. AVYWENNA 委婉手段（电磁脆弱 enemy debuff）

### 处理的分类
enemy debuff → 脆弱乘区（fragility zone），通过 talentConditionalRegistry 触发

### 改了哪些文件
- `data/operators/AVYWENNA/talents.json` — 将 talent_1 两个 stage 的 effects 从 parsed_unimplemented 结构化为 `damage_bonus/emag_dmg/runtime_conditional`
- `simulation/data/talentConditionalRegistry.ts` — 新增 AVYWENNA descriptor

### 改变了什么
- AVYWENNA 终结技的 DAMAGE_TICK 触发时，通过 TriggerProcessor 在 enemy.effects 上添加 `avywenna_emag_fragility` Effect
- DynamicBonus: `{ stat: "emag_dmg", value: 6/10, zone: "fragility" }`（通过 bonusOverride 路由到 fragility zone）
- 持续 10s，不叠加（refresh 模式）
- 值从 _activeEffects 数据驱动（E2=6%, E3=10%）
- 非终结技不触发（condition 检查 action type === ultimate）

### 新增测试
- `talentConditionalRegistry.test.ts` — "AVYWENNA 委婉手段 (Subtle Means)" (4 tests)
  - 终结技 DAMAGE_TICK 后 enemy 获得 emag fragility
  - 非终结技不触发
  - 重复终结技命中 refresh（不叠加）
  - 数据驱动（value=10 时 aggregateEnemyZoneBonuses 返回 10）

### 前端验证
- 排轴中为 AVYWENNA 设置 E2+ 晋升并开启天赋 1
- 放置终结技 → simLog 中应看到 buff start
- 后续电磁伤害在 DamageSummaryPanel 中应提升

### 已知限制
- 天赋描述说"终结技雷枪·决颤命中敌人时"，但当前实现是在任意终结技 DAMAGE_TICK 时触发（没有按技能 ID 过滤）。由于 AVYWENNA 只有一个终结技，这在实际中等效
- sourceMustBeWearer: true → 只有 AVYWENNA 自身的终结技触发

---

## 3. LIFENG 顿悟（static 属性缩放 ATK%）

### 处理的分类
static/self stat scaling → 攻击力乘区（attack_percent）

### 改了哪些文件
- `data/operators/LIFENG/talents.json` — 将 talent_0 两个 stage 的 effects 从 parsed_unimplemented 结构化为带 `scaling` 字段的 `stat_bonus/attack_percent/static`
- `stores/timelineStore.js` — `resolveTrackConfiguredStats` 中增加 scaling 分支

### 改变了什么
- LIFENG 天赋 0（顿悟）开启时，`attack_percent` 加上 `(intellect + will) × perPoint`
  - E1: perPoint = 0.10 → intellect=100 + will=50 → +15%
  - E2: perPoint = 0.15 → intellect=100 + will=50 → +22.5%
- 这个值进入 `result.attack_percent`，和武器/装备的 ATK% 同乘区
- 最终被 `attack = floor(attack * (1 + attack_percent / 100))` 消费
- talents.json 中用 `scaling: { from: ["intellect", "will"], perPoint: 0.10 }` 表达，可复用于未来其他属性缩放天赋

### 新增测试
- `simulation/data/attributeScaling.test.ts` — 9 tests
  - 低档 intellect=100 + will=50 → 15%
  - 高档 intellect=100 + will=50 → 22.5%
  - 低档 intellect=200 + will=100 → 30%
  - 高档 intellect=200 + will=100 → 45%
  - 零属性 → 0%
  - 缺失属性 → 0%
  - 单属性 → 仅该属性参与
  - talents.json 数据格式验证（两个 stage 的 scaling 字段正确）

### 前端验证
- 在 OperatorInfoPanel 中设置 LIFENG 天赋 0 为开启状态
- 在 StatsDetailOverlay 中观察 LIFENG 的 ATK 值 → 应比纯基础值更高
- 关闭天赋 → ATK 值回落

### 已知限制
- scaling 来源显示：当前 StatsDetailOverlay 不会单独标注"来自顿悟天赋"的加成，它会合并进 attack_percent 总值。后续如需拆分来源显示，需在 UI 层补口
- 没有引入新的真值源：scaling 公式在 talents.json 中声明，在 store 的 resolveTrackConfiguredStats 中消费

---

## 汇总

| 条目 | 状态 | 新增测试 | 涉及文件 |
|------|------|---------|---------|
| LIFENG physical_weakness | 已收口 | 1 test | simulator.ts |
| AVYWENNA 委婉手段 | 已收口 | 4 tests | talents.json + talentConditionalRegistry.ts |
| LIFENG 顿悟 | 已收口 | 9 tests | talents.json + timelineStore.js |

**所有新增测试通过（14/14）。全 simulation 测试套件中 12 个预先存在的失败不受影响。**

**没有引入新的真值源或临时覆盖层。**

### 下一步建议
1. DAPAN 勾芡 — 需先补口 registerTriggeredBuff 的 stackCountFn
2. ARCLIGHT 荒野游人 — 需先补口 target="team"
