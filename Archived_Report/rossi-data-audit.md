# ROSSI（洛茜）+ 狼之绯 数据缺口审计报告

---

## 1. 审计范围

**实际检查的位置**:
- `src/data/operators/ROSSI/` — 5 个文件全部检查
- `public/gamedata.json` — characterRoster 中 ROSSI entry
- `src/external-data/warfarin-wiki/operators/index.json` — ROSSI 不在索引中
- `src/external-data/warfarin-wiki/operators/normalized/` — 无 rossi.json
- `public/avatars/ROSSI/` — 7 个图标文件
- `public/weapons/sword/` — wpn_sword_0022.webp 存在
- warfarin.wiki/cn/operators/rossi — 线上页面有完整数据

**schema 对照样本**: ENDMINISTRATOR（同为 6 星近卫/物理/剑）

## 2. ROSSI 当前状态

### 已有文件
| 文件 | 存在 | 内容状态 |
|---|---|---|
| `meta.json` | ✅ | **几乎全空**：profession="unknown", mainAttribute="", icons 全空, nameEn="" |
| `stats.json` | ✅ | **levels 为空对象**（0 个等级条目） |
| `skills.json` | ✅ | **全空壳**：4 个技能均为 name="", levelData=[], description="" |
| `talents.json` | ✅ | **全空**：mainAttribute=null, talents=[], exclusiveBuffs=[] |
| `ability-expansion.json` | ✅ | 结构完整但 unlocks 全空（因为 talents 为空） |

### gamedata.json 中已有字段
- id/name/rarity/element/weapon: ✅
- avatar: ✅ (有文件)
- skill_icon/link_icon/ultimate_icon: **全空**
- damage_ticks: skill 1 tick, link 0 tick, ultimate 1 tick
- exclusive_buffs: 空数组
- variants: 有 1 个 "二段连携"

### wiki 线上数据（warfarin.wiki 有完整页面）
- 基础信息: 6★ 近卫 物理 主属性=敏捷 ✅
- 等级属性表: 有 milestone（1/20/40/60/80/90）✅
- 技能倍率: 4 个技能全部有 12 级完整倍率表 ✅
- 天赋: 斫痕（E1 解锁）+ 沸血（E2 解锁）✅
- 潜能: 5 条 ✅

### 主路径最小必需补数清单

| 文件 | 需补内容 | 数据来源 |
|---|---|---|
| `meta.json` | profession, mainAttribute, subAttribute, icons, nameEn | wiki 基础表 + avatars 目录 |
| `stats.json` | 完整 1-90 级属性表 | wiki 属性表（需爬取 full table）或用 milestone 插值 |
| `skills.json` | 4 个技能的 name, description, levelHeaders, levelData | wiki 技能表 |
| `talents.json` | mainAttribute, subAttribute, 2 个天赋条目, exclusiveBuffs | wiki 天赋描述 |
| `ability-expansion.json` | unlocks 填充（talent_0 at E1, talent_1 at E2） | 天赋解锁规则 |
| `gamedata.json` | ROSSI entry: skill_icon, link_icon, ultimate_icon | avatars 目录已有图标 |

## 3. 新武器（狼之绯）当前状态

### 武器主路径
`public/gamedata.json` → `weaponDatabase` 数组

### 已有字段
| 字段 | 值 | 状态 |
|---|---|---|
| id | wpn_sword_0022 | ✅ |
| name | 狼之绯 | ✅ |
| type | sword | ✅ |
| rarity | 6 | ✅ |
| icon | /weapons/sword/wpn_sword_0022.webp | ✅（文件存在）|
| commonSlots | agility(large) + crit_rate(large) | ✅ |
| buffBonuses | [] | ✅（无 buff tier 是正常的）|
| **baseAtk** | **undefined** | ❌ **缺失** |
| **passiveStats** | {} | ❓ 可能有词条但未填 |
| **triggeredBuffs** | [] | ❓ 可能有被动但未填 |
| **buffName** | "" | ❓ 可能有名称但未填 |
| **duration** | 0 | ❓ 被动持续时间未知 |

### wiki 状态
warfarin.wiki/cn/gear/wpn_sword_0022 → **404 不存在**。狼之绯是新武器，wiki 尚未收录。

### 主路径最小必需补数清单

| 字段 | 必需度 | 理由 | 来源 |
|---|---|---|---|
| baseAtk | **必须** | `computeWeaponAtkAtLevel()` 依赖它。undefined → 武器攻击力 = 0 | 需要从游戏内获取或参照同稀有度武器估算 |
| passiveStats | 增强 | 如果有面板加成应填入 | 需游戏内数据 |
| triggeredBuffs | 增强 | 如果有被动技能应填入 | 需游戏内数据 |
| buffName | 增强 | 显示用 | 需游戏内数据 |

## 4. 链路影响判断

### 会直接导致退化的缺口

| 缺口 | 影响 |
|---|---|
| stats.json levels 为空 | `resolveBaseStats('ROSSI', level)` 返回 null → 基础属性全 0 → 有效攻击力 = 0 |
| skills.json levelData 为空 | `getSkillMultiplierFromData` 返回 undefined → overlay 无倍率 → DamageSummary 显示"未支持" |
| meta.json mainAttribute 为空 | `resolveTrackConfiguredStats` 无法计算 primary_ability → 能力值加成 = 0 |
| gamedata skill_icon 为空 | 技能库中图标不显示（纯视觉）|
| 武器 baseAtk undefined | 装备狼之绯后武器攻击力 = NaN → 属性面板异常 |

### 补完后最可能立刻改变的结果

| 补数动作 | MVP 可见改善 |
|---|---|
| stats.json 填入 90 级属性 | ROSSI 基础属性从全 0 变为真实值 |
| skills.json 填入倍率表 | ROSSI 从"未支持"变为"处理中"，DamageSummary 出现非零伤害 |
| meta.json 填入 mainAttribute | 能力值详情和攻击力公式正确 |
| gamedata.json 补 icon 路径 | 技能库图标正常显示 |
| 武器 baseAtk 补值 | 装备狼之绯后武器攻击力正常 |

## 5. 最小可落地方案

### 本轮建议先补（可用现有脚本 + wiki 数据自动化）

1. **运行现有 scraper** `scrape-warfarin-wiki.mjs` 补抓 ROSSI（wiki 页面已存在）
2. **运行 `generate-operator-data.js`** 重新生成 ROSSI 的 5 个文件（脚本已支持通过 wiki normalized data 生成）
3. **补 gamedata.json 中 ROSSI 的 icon 路径**:
   - skill_icon: `/avatars/ROSSI/icon_skill_wulfa_01.webp`
   - link_icon: `/avatars/ROSSI/icon_combo_skill_wulfa_01.webp`
   - ultimate_icon: `/avatars/ROSSI/icon_ultimate_skill_wulfa_01.webp`
4. **武器 baseAtk 补估算值**: 参照同稀有度 6 星剑（490-510 范围），先用 495 作为保守估算

### 后续再处理（不在本轮）

| 项目 | 归属 |
|---|---|
| ROSSI 天赋专属机制（爪印斫痕 DOT + 增伤） | C 分支角色专属 |
| ROSSI 沸血天赋（暴击触发额外灼热伤害） | C 分支角色专属 |
| 狼之绯 被动 / triggeredBuffs | E 分支武器数据（需游戏内验证）|
| ROSSI 潜能效果 | 潜能系统（不存在）|

## 6. 风险与边界

| 内容 | 归属 | 为什么不在本轮 |
|---|---|---|
| 天赋效果（DOT + 增伤 + 暴击追加伤害）| C 分支 | 需要 runtime 专属机制 |
| 技能倍率精度校验 | B 分支 | 基础倍率接入即可，精度后续校验 |
| UI 状态标签升级 | G 分支 | 补数后自动从 unsupported → wip |
| 狼之绯 wiki 数据 | 外部 | wiki 尚未收录，只能估算 baseAtk |

## 7. 变更准备结论

**下一轮可以开始实施最小补数。**

优先改动顺序:
1. 运行 scraper 补抓 ROSSI wiki 数据 → 生成 wiki normalized JSON
2. 运行 generate-operator-data.js 重新生成 ROSSI operator folder
3. 手动补 gamedata.json 中 ROSSI 的 3 个 icon 路径
4. 手动补 gamedata.json 中狼之绯的 baseAtk（估算值 495）

预计改动文件: 6-7 个（5 个 operator folder JSON + gamedata.json + 可能更新 wiki index/normalized）

## 8. 额外声明

- 不直接实施改动 ✅
- 不引入平行 schema ✅
- 不引入临时覆盖层 ✅
- **未发现新的真值源风险**: 所有补数都走现有主路径（operator folder + gamedata.json）
