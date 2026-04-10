# 技能 Buff 乘区分类报告

日期: 2026-04-04

## 分类规则

| 描述特征 | 乘区 | Zone Key |
|----------|------|----------|
| "XX增幅" | 增幅区 | `amplify` |
| "造成的XX伤害增加" | 增伤区 | `damageBonus` |
| "受到的XX伤害增加" / "XX脆弱" | 脆弱区 | `fragility` |
| 未写明最大层数 | 独立 buff，同时生效 | `stackBehaviour: "independent"` |

---

## 已分类 — 增幅区 (amplify)

### 1. `fire_enhance` — 灼热增幅
- **角色**: 安塔尔 (ANTAL) 终结技
- **目标**: 全队
- **数值**: 8%–20% (Lv1–M3)
- **持续**: 12 秒
- **叠加**: 独立 (无最大层数说明)
- **skills.json label**: `灼热增幅效果`
- **状态**: ✅ 已接入路由

### 2. `pulse_enhance` — 电磁增幅
- **角色**: 安塔尔 (ANTAL) 终结技
- **目标**: 全队
- **数值**: 8%–20% (Lv1–M3)
- **持续**: 12 秒
- **叠加**: 独立
- **skills.json label**: `电磁增幅效果`
- **状态**: ✅ 已接入路由

### 3. `cryst_enhance` — 寒冷增幅
- **角色**: 塞希 (XAIHI) 终结技
- **目标**: 全队
- **数值**: 11%–24% (Lv1–M3)，另有智识加成
- **持续**: 12 秒
- **叠加**: 独立
- **skills.json label**: `基础寒冷增幅效果`
- **状态**: ✅ 已接入路由
- **注意**: 智识加成部分 (每点 +0.014%–0.03%，上限 30%–36%) 尚未实现

### 4. `natural_enhance` — 自然增幅
- **角色**: 塞希 (XAIHI) 终结技
- **目标**: 全队
- **数值**: 11%–24% (Lv1–M3)，另有智识加成
- **持续**: 12 秒
- **叠加**: 独立
- **skills.json label**: `基础自然增幅效果`
- **状态**: ✅ 已接入路由
- **注意**: 同上，智识加成未实现

### 5. `spell_enhance` — 法术增幅
- **角色**: 塞希 (XAIHI) 战技
- **目标**: 敌方 (对导电目标施加)
- **数值**: 9%–15% (Lv1–M3)
- **持续**: 25 秒
- **叠加**: 刷新 (无法叠加)
- **skills.json label**: `法术增幅效果`
- **状态**: ⚠️ 需人工确认 — 描述为"增幅"但施加对象是敌方，需确认实际乘区归属

---

## 已有路由 — 脆弱区 (fragility)

以下效果已在 simulator.ts 中有专用路由，不经过 skillBuffZoneRegistry:

### `physical_weakness` — 物理脆弱 (脆弱区)
- **角色**: 李风 (LIFENG) 战技
- **数值**: 5%–12% (Lv1–M3)
- **持续**: 12 秒
- **路由**: Route 2.6.5

### `physical_vulnerable` — 物理脆弱/破防 (易伤区)
- **角色**: 阿黛莉亚 (ARDELIA) 战技 (via boundEffect)，艾丝黛拉 (ESTELLA) 连携技 (via boundEffect)
- **路由**: Route 2.7 + boundEffect `consume_corrosion_apply_vuln` / `estella_phys_vuln_if_frozen`

### `spell_vulnerable` — 法术脆弱 (脆弱区)
- **角色**: 洁尔佩塔 (GILBERTA) 终结技，阿黛莉亚 (ARDELIA) 战技 (via boundEffect)
- **数值**: GILBERTA 18%–30% + 每层破防 1.8%–3%
- **持续**: GILBERTA 5 秒
- **路由**: Route 2.8
- **注意**: GILBERTA 的破防层数加成逻辑尚未实现

---

## 已有路由 — 天赋 (talentConditionalRegistry)

| 角色 | 天赋 | 效果 | Zone | 状态 |
|------|------|------|------|------|
| WULFGARD | 灼热獠牙 | 灼热伤害+20/30% | damageBonus | ✅ |
| CHENQIANYU | 斩锋 | 攻击力+4/8%×5层 | attackPercent | ✅ |
| DAPAN | 勾芡 | 物理伤害+4/6%×4层 | damageBonus | ✅ |
| AVYWENNA | 委婉手段 | 电磁脆弱6/10% | fragility (enemy) | ✅ |
| POGRANICHNK | 活着的旗帜 | 攻击力+4/8%×3层 | attackPercent | ✅ |
| ARCLIGHT | 荒野游人 | 全队电磁伤害+智识×% | damageBonus (team) | ✅ |

---

## 需人工确认

### `spell_enhance` — 法术增幅 (塞希战技)
- **问题**: 描述说"增幅"但施加对象是敌方 (对导电目标施加法术增幅)
- **当前处理**: 标记 `needsReview: true`，不进入路由
- **需确认**: 此效果在游戏中属于增幅区还是脆弱区？

### `affix_slow` — 缓速 (洁尔佩塔终结技)
- **问题**: 缓速是控制效果，不属于伤害乘区
- **当前处理**: 标记 `needsReview: true`，不进入路由
- **建议**: 跳过，不需要伤害乘区路由

### `antal_buff` — 聚焦 (安塔尔战技)
- **问题**: 战技描述为自身附加聚焦状态，但具体伤害加成效果不明
- **当前处理**: 标记 `needsReview: true`
- **需确认**: 聚焦的实际数值效果和乘区归属

### `skill_seraph` — 天使形态 (塞希战技)
- **问题**: 战技变身/模式切换，不直接是伤害 buff
- **当前处理**: 标记 `needsReview: true`
- **需确认**: 是否有附带的隐式伤害加成

---

## 未实现天赋 (需后续开发)

| 角色 | 天赋 | 描述 | 推测乘区 | 备注 |
|------|------|------|----------|------|
| ENDMINISTRATOR | 现实静滞 | 附着源石结晶的敌人受到物理伤害+10/20% | fragility (enemy) | "受到的"→脆弱区 |
| XAIHI | 启动进程 | 寒冷附着/冻结目标受到寒冷伤害+7/10% | fragility (enemy) | "受到的"→脆弱区 |
| ROSSI | 斫痕 | 目标受到物理+灼热伤害+6/12% | fragility (enemy) | "受到的"→脆弱区 |
| LASTRITE | 低温症 | 寒冷脆弱=消耗附着层数×2/4% | fragility (enemy) | 明确"脆弱" |
| LASTRITE | 低温脆性 | 寒冷脆弱效果×1.2/1.5 | special (multiplier) | 对已有脆弱的乘算 |
| PERLICA | 歼灭协议 | 对失衡敌人造成伤害+20/30% | damageBonus | "造成的"→增伤区 |
| FLUORITE | 落井下石 | 对缓速目标造成伤害+10/20% | damageBonus | "造成的"→增伤区 |
| EMBER | 以铁还铁 | 受击后攻击力+6/9%×3层 | attackPercent | 攻击力% |

---

## 实现文件

| 文件 | 说明 |
|------|------|
| `src/simulation/data/skillBuffZoneRegistry.ts` | 技能 buff 乘区注册表 (新建) |
| `src/simulation/simulator.ts` Route 2.9 | 路由：从注册表读取 zone 信息，生成 DynamicBonus Effect |
