# 计算内核游戏机制完整审计报告

> 2026-04-09 | 目的：为重构计算内核提供完整的游戏规则和公式参考

---

## 一、伤害计算系统

### 1.1 总伤害公式

```
finalDamage = floor(
  ATK × skillMult
  × defense × crit × dmgBonus × amplify
  × combo × vulnerability × fragility × resistance
  × break × reduction × special
)
```

**11 个乘区**（乘区之间相乘，乘区内部相加）：

| # | 乘区 | 计算方式 | 备注 |
|---|------|---------|------|
| 1 | 防御区 | 0.5（默认） | 可配置 |
| 2 | 暴击区 | 1.0 或 (1 + totalCritDmg%) | 二元暴击 |
| 3 | 增伤区 | 1 + (bonus% / 100) | 属性/元素/技能类型增伤 |
| 4 | 增幅区 | 1 + (bonus% / 100) | zone="amplify" |
| 5 | 连击区 | 1 + (bonus% / 100) | zone="combo" |
| 6 | 易伤区 | 1 + (total% / 100) | 导电/碎甲/动态 |
| 7 | 脆弱区 | 1 + (total% / 100) | 物理/法术/元素分别判定 |
| 8 | 抗性区 | 1 + resistReduction×0.01 - baseResist×0.01 | 整数抗性值 |
| 9 | 失衡区 | 1.3（失衡时）或 1.0 | |
| 10 | 减伤区 | 1.0（占位） | 未使用 |
| 11 | 特殊区 | 1.0 或角色特定 | 潜能修正等 |

### 1.2 攻击力公式

```
ATK = floor(
  ((baseAttack × (1 + percentBonus) + flatBonus)
   × (1 + truncate1(primaryAbility × 0.5) / 100
        + truncate1(secondaryAbility × 0.2) / 100))
)
```

- `truncate1(v)` = `floor(v × 10) / 10`（截断到1位小数）
- 最终 ATK 向下取整

### 1.3 暴击系统

- 基础暴击率：5%
- 基础暴击伤害：50%（倍率 1.5）
* 基础暴击率和基础暴击伤害放到角色数据里。

- 暴击判定：`roll < rate/100` → 暴击
- 暴击倍率：`1 + totalCritDmg%`
- 暴击率上限：100%
- 燃烧 DoT 不可暴击（canCrit=false）

**两种模式**：
- `real`：每次 hit 独立 roll
- `expected`：确定性期望值 `1 + rate × critDmgRatio`

---

## 二、资源系统

### 2.1 技力（SP）

| 参数 | 值 |
|------|-----|
| 自然回复速率 | 8/秒 |
| 上限 | 300 |
| 默认战技消耗 | 100 |
| trueSP/refundSP | 分离，消耗优先 refundSP |

- 仅 trueSP 消耗产生终结技充能
- trueSP 和 refundSP 的区分由技能效果明确标注（不按来源自动判断）
- 消耗时优先消耗 refundSP


### 2.2 终结技能量（Gauge）

```
baseCharge = trueSPConsumed × 6.5 / 100
actualCharge = baseCharge × (ult_charge_eff / 100)
```

- `ult_charge_eff` 基础值 100（= 1.0倍），装备/天赋叠加
- 终结技期间不获得能量（blockWindow）

---

## 三、异常系统

### 3.1 法术附着

| 参数 | 值 |
|------|-----|
| 持续时间 | 30秒 |
| 最大层数 | 4 |
| 元素类型 | fire/cold/electro/nature |

**同元素叠加**：+1 层，刷新持续时间；触发法术爆发（不清空附着）

**异元素反应**：消耗双方附着，触发法术异常
- fire → 燃烧（burning）
- cold → 冻结（frozen）
- electro → 导电（conduction）
- nature → 腐蚀（corrosion）
- 异常等级 = 被消耗元素层数

### 3.2 法术异常

**等级系数**：
```
spellLevelCoef(level) = 1 + (level - 1) / 196
physLevelCoef(level) = 1 + (level - 1) / 392
```

**源石技艺强度乘数**：
```
artsPowerDamageMult(p) = 1 + p × 0.01
artsPowerDebuffMult(p) = 1 + (2p) / (300 + p)
artsPowerStaggerMult(p) = 1 + p × 0.005
```

| 异常类型 | 倍率公式 | 持续时间 |
|---------|----------|---------|
| 法术爆发 | 1.6 × spellLevelCoef × artsPowerDmg | 瞬发 |
| 法术异常触发 | 0.8 × (1+level) × spellLevelCoef × artsPowerDmg | 瞬发 |
| 燃烧 DoT | 0.12 × (1+level) × spellLevelCoef × artsPowerDmg /tick | 10秒（每秒1tick） |
* 冻结为持续时间内如果目标受到物理异常或者被施加破防时触发碎冰效果。
| 碎冰 | 1.2 × (1+level) × spellLevelCoef × artsPowerDmg | 瞬发 |

*这里真的需要标注瞬发吗？理论上都是技能的某个hit有施加附着的效果，会在技能处理的同时处理附着效果。

**导电**：
```
spellVulnerability = (level + 2) × 4 × artsPowerDebuffMult
duration = level × 6 + 6 秒 (12/18/24/30)
```

**腐蚀**：
```
immediate = (level × 1.2 + 2.4) × artsPowerDebuffMult
perSecond = (level × 0.28 + 0.56) × artsPowerDebuffMult
maxValue = (level × 4 + 8) × artsPowerDebuffMult
duration = 15秒
```



### 3.3 破防系统

破防是独立状态（非物理异常）：
- 层数 1-4，持续时间 30秒
- 由技能直接施加，或物理异常在无破防时自动施加

### 3.4 物理异常（4种：击飞、倒地、猛击、碎甲）

**前提**：目标必须有破防状态。如果目标没有破防，任意物理异常效果改为施加一层破防。

| 类型 | 伤害倍率 | 后续效果 |
|------|---------|---------|
| 击飞 | 1.2 × physLevelCoef × artsPowerDmg | +破防层数，刷新计时 |
| 倒地 | 1.2 × physLevelCoef × artsPowerDmg | +破防层数，刷新计时 |
| 猛击 | 1.5 × (1+stacks) × physLevelCoef × artsPowerDmg | 消耗所有破防层数 |
| 碎甲 | 0.5 × (1+stacks) × physLevelCoef × artsPowerDmg | 消耗所有破防层数 + 施加物理脆弱 |

**碎甲物理脆弱**：
```
physVulnPercent = (stacks + 2) × 4 × artsPowerDebuffMult
duration = stacks × 6 + 6 秒
```

### 3.5 失衡系统

失衡是独立数值条（与破防无关）：
- 敌人有**失衡值**（0 → maxStagger）
- 技能 hit 的 stagger 字段增加失衡值
- **失衡节点**：到达特定阈值，触发效果（如连携技条件）
- **进入失衡状态**：失衡值达到最大值
  - 打断敌人行动
  - 下一次普攻变为**处决**（仅一次，切换角色不会重置）
  - **1.3 独立增伤乘区**在失衡状态持续期间生效
- 失衡状态持续一段时间后恢复

注意区分三个事件：**获得失衡值**、**到达失衡节点**、**进入失衡状态**



---

## 四、事件引擎架构

### 4.1 嵌套递归执行模型

```
主循环:
  1. 收集当前帧所有事件 (FRAME_EPSILON = 0.0001)
  2. 快照敌方状态 (frameSnapshot)
  3. 逐事件处理 processEventWithCascade()

事件处理:
  1. 推入 deferred scope
  2. 执行 handler + 即时触发器 (TriggerProcessor)
  3. 递归处理级联的同帧子事件
  4. 弹出 scope: 执行 deferred 触发器
  5. 如果 deferred 产生新事件 → 继续级联
```

- 最大递归深度：500
- 同帧事件按入队顺序 FIFO
- 先特效后伤害：效果在 DAMAGE_TICK 之前入队

### 4.2 触发器系统

- **即时触发** (deferred=false)：事件发生后立即插入结算
- **延迟触发** (deferred=true)：事件子树完整处理后才执行
- 触发器有冷却时间 (ICD)、条件判定、源必须是持有者等约束

### 4.3 效果生命周期

- 创建 → 附着到 actor/enemy → 响应事件 → 过期/消耗 → 移除
- 堆叠行为：refresh（刷新所有层）、independent（各层独立计时）、add_duration（延长）

---

## 五、连携技触发系统

### 5.1 触发条件类型（共17种）

**重击相关**：on_heavy_attack（+ require/require_not 附加条件）
**失衡/破防**：on_stagger, on_stagger_or_node, on_break, on_break_stacks
**异常施加**：on_anomaly_apply, on_frozen, on_magic_attachment, on_attachment
**附着特定**：on_cold_attach_or_burst, on_conduction_apply_or_consume
**消耗特定**：on_anomaly_or_crystal_consume, on_effect_consumed
**混合**：on_physical_anomaly_or_attachment, on_link_damage, on_slam_or_armor_break

### 5.2 队列规则

- 6秒窗口：触发后开启，窗口内再次触发刷新持续时间
- 排序：同时触发按轨道 1→4，不同时按触发顺序
- CD 期间不触发
- E 键施放队列首位，被锁定则无效（不跳过）

---

## 六、角色特殊层数 Buff 系统

角色特殊层数作为普通 buff 处理，标记 `type: "stack"` 区分于常规 buff/debuff。

### 6.1 堆叠规则

- 最大层数：根据角色不同而不同（如熔火4层、涡流2层）
- 有的无持续时间（熔火），有的有持续时间（涡流）
- 可能附带副效果（如涡流给附近敌人缓速）
- 后续可能有"根据身上 buff 数量给效果"的角色

### 6.2 已知特殊层数

| 角色 | buff | 最大层数 | 持续时间 | 副效果 |
|------|------|---------|---------|--------|
| 莱万汀 | 熔火 | 4 | 无限 | 无 |
| 汤汤 | 涡流 | 2 | 有 | 附近敌人缓速 |

### 6.3 blaze_to_magma 转换（莱万汀天赋）

1. 重击命中时，读取敌方灼热附着层数
2. 计算可转换量 = min(附着层数, maxMagma - 当前熔火层数)
3. 消耗敌方灼热附着，增加自身熔火层数

---

## 七、变体选择系统

变体选择独立于 buff 系统，在技能施放时检测条件。

### 7.1 条件判定

- 按 priority 降序检查 releaseConditions
- 条件类型：
  - selfBuff：检查角色身上特殊层数 buff 的堆叠数
  - ultimateActive：检查是否在终结技增强窗口内
  - 未来可能扩展更多条件类型
- 首个匹配的条件组决定变体
- 变体可能消耗 buff（consumeSelfBuffs）：施放时立即扣除

---

## 八、潜能修正系统

### 7.1 倍率修正（乘法）

| 角色 | 潜能 | 技能类型 | 倍率 | 条件 |
|------|------|---------|------|------|
| 陈千语 | P3 | skill/link/ultimate | ×1.1 | 全 tick |
| 洁尔佩塔 | P5 | link | ×1.3 | 全 tick |
| 别礼 | P3 | link/ultimate | ×1.15 | 全 tick |
| 汤汤 | P3 | skill | ×1.1 | 全 tick |
| 汤汤 | P5 | ultimate | ×1.15 | 全 tick |
| 艾尔黛拉 | P5 | link | ×1.2 | 全 tick |
| 埃特拉 | P3 | skill | ×1.4 | 仅首 tick |

### 7.2 冷却缩减（秒）

陈千语P5 link -3s, 洁尔佩塔P5 link -2s, 骏卫P5 link -2s, 汤汤P1 link -2s, 艾尔黛拉P5 link -2s

### 7.3 持续时间修正

埃特拉P1 物理脆弱+3s, 大潘P2 备料+10s, 昼雪P3 冻结+2s, 莱万汀P3 燃烧×1.5, 佩丽卡P1 导电×1.75, 艾尔黛拉P5 腐蚀+4s, 艾维文娜P2 雷枪+20s

---

## 九、载体消耗处理器（按角色）

### 已实现角色列表

| 角色 | 载体 | 触发 | 消耗效果 |
|------|------|------|---------|
| 管理员 | 源石结晶 | 物理异常 | 碎裂伤害 + ATK buff + 队友半值 |
| 骏卫 | 铁誓 | 物理异常 | 袭扰伤害 + SP回复 + 决胜强化 |
| 莱万汀 | 熔火 | 战技 | 层数决定追加伤害倍率 |
| 艾维文娜 | 雷枪 | 战技 | 召回所有雷枪造成伤害 |
| 别礼 | 低温灌注 | 重击 | 幻影追击伤害 |
| 埃特拉 | 碎冰 | 物理异常 | SP返还 |
| 赛希 | 支援晶体 | 重击 | 法术增幅 |
| 洛茜 | 爪印斫痕 | 战技 hit | 物理+灼热脆弱 |
| 汤汤 | 涡流 | 战技 | SP返还 + 水龙卷生成 |
| 洁尔佩塔 | 引力锁定 | 破防 | 法术脆弱 |
| 萤石 | 粘性炸弹 | 终结技/自动 | 引爆伤害 |
| 秋栗 | 连击 | SP恢复 | ATK堆叠 |
| 大潘 | 备料 | 猛击/碎甲 | 物理伤害堆叠 |
| 弧光 | 荒野游人 | 导电消耗 | 团队电磁增伤 |
| 阿列什 | 钓鳞 | 冻结 | 终结技能量 |

---

## 十、天赋条件触发器（按角色）

已在 `talentConditionalRegistry.ts` 注册的触发器：
秋栗（SP恢复→ATK）、狼卫（燃烧→灼热增伤）、陈千语（命中→ATK）、大潘（破防→物伤）、骏卫（SP累计→士气）、弧光（导电消耗→电磁增伤）、赛希（连携冰附→冰脆弱）、黎风（倒地→额外伤害，P5每15秒强化）、洛茜（战技hit→爪印脆弱）、佩丽卡（导电→ATK）、埃特拉P5（冻结→能量）、阿列什（冻结→能量）

---

## 十一、关键常量汇总

| 类别 | 常量 | 值 |
|------|------|-----|
| 时序 | 帧精度 | 0.0001秒 |
| 时序 | 最大递归深度 | 500 |
| 附着 | 法术附着持续 | 30秒 |
| 附着 | 最大层数 | 4 |
| 异常 | 燃烧持续 | 10秒 |
| 异常 | 冻结持续 | 6/7/8/9秒 (level 1-4) |
| 异常 | 导电持续 | 12/18/24/30秒 (level 1-4) |
| 异常 | 腐蚀持续 | 15秒 |
| 破防 | 破防持续 | 30秒 |
| 破防 | 最大层数 | 4 |
| SP | 回复速率 | 8/秒 |
| SP | 上限 | 300 |
| SP | 默认战技消耗 | 100 |
| 充能 | 基础公式 | trueSP × 6.5% |
| 暴击 | 基础暴击率 | 5% |
| 暴击 | 基础暴击伤害 | 50% |
| 防御 | 默认防御倍率 | 0.5 |
| 连携 | 触发窗口 | 6秒 |
| Buff | 特殊层数上限 | 因角色而异 |
