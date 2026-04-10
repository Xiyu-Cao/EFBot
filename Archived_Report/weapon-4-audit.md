# 四把武器审计结果

---

## 1. 总览表

| 武器名 | ID | 主路径位置 | entry | baseAtk | 等级ATK链 | passiveStats | commonSlots | triggeredBuffs | 配置链 | 属性链 | simulation 链 | 估算值 | 状态判断 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **光荣记忆** | wpn_sword_0017 | gamedata.json | ✅ | 490 ✅ | ✅ | `attack: 19.6` ✅→ATK% | agility+crit_rate ✅ | 1 个 `on_skill_break_apply` ❌ 未识别 | ✅ | ✅ | ❌ triggeredBuff 被跳过 | 无 | **基础可用，被动未接入** |
| **狼之绯** | wpn_sword_0022 | gamedata.json | ✅ | 495 ⚠️估算 | ✅ | `{}` 空 | agility+crit_rate ✅ | `[]` 空 | ✅ | ✅ | ✅ | baseAtk 估算 | **基础可用，baseAtk 待验证** |
| **落草** | wpn_pistol_0011 | gamedata.json | ✅ | 505 ✅ | ✅ | `cold_dmg: 44.8` ✅ | 2× null ⚠️ 被跳过 | 1 个 ✅ + 1 个 `_unknown` ❌ | ✅ | ✅ | ⚠️ 部分 | 无 | **基础可用，部分被动未接入** |
| **望乡** | wpn_pistol_0007 | gamedata.json | ✅ | 490 ✅ | ✅ | `attack: 19.6` ✅→ATK% | agility+cold_dmg ✅ | 1 个 `_unknown` + 无效 stat `cold_nature_dmg` ❌ | ✅ | ✅ | ❌ triggeredBuff 被跳过 | 无 | **基础可用，被动完全未接入** |

---

## 2. 逐武器审计

### 光荣记忆 (wpn_sword_0017)

- **数据所在文件**: `public/gamedata.json` → `weaponDatabase`
- **当前主路径 entry**: ✅ 存在
- **已有字段**: id, name, type, rarity, icon, baseAtk(490), commonSlots(agility+crit_rate large), passiveStats(`attack: 19.6`)
- **缺失字段**: triggeredBuffs 的 trigger 类型 `on_skill_break_apply` 不在 `TRIGGER_EVENT_MAP` 中；effects 数组为空；buffName 为空
- **字段存在但未消费**: triggeredBuffs entry 存在但因 trigger 未识别而在 simulation 中被跳过
- **当前真正被消费的链路**:
  - baseAtk → `computeWeaponAtkAtLevel` → 武器攻击力 ✅
  - passiveStats.attack → `remapWeaponModifierId` → `attack_percent` → ATK% 乘区 ✅
  - commonSlots → agility/crit_rate delta ✅
- **估算值/占位值**: 无
- **当前状态**: **基础可用**（攻击力 + 词条 + 面板加成 ✅），被动未接入（`on_skill_break_apply` 需要在 weaponDataAdapter 新增 trigger mapping + effects 数据补全）
- **最小补齐建议**:
  - 主路径必需: 无（基础已完整）
  - 增强项: (1) `weaponDataAdapter.ts` 新增 `on_skill_break_apply` 映射 (2) triggeredBuffs effects 数据补全 (3) buffName 补上

### 狼之绯 (wpn_sword_0022)

- **数据所在文件**: `public/gamedata.json` → `weaponDatabase`
- **当前主路径 entry**: ✅ 存在
- **已有字段**: id, name, type, rarity, icon, baseAtk(495⚠️估算), commonSlots(agility+crit_rate large)
- **缺失字段**: passiveStats 为空（可能有面板加成但未填）；triggeredBuffs 为空（可能有被动但未填）；buffName 为空
- **字段存在但未消费**: 无（字段为空，没有"存在但未消费"的问题）
- **当前真正被消费的链路**:
  - baseAtk(495) → 武器攻击力 ✅
  - commonSlots → agility/crit_rate delta ✅
- **估算值**: **baseAtk=495 是估算值**（6 星剑范围 490-510，wiki 无此武器页面）
- **当前状态**: **基础可用，数据不完整**。baseAtk 需游戏内验证；passive/triggeredBuffs 完全缺失（wiki 无页面，只能从游戏内获取）
- **最小补齐建议**:
  - 主路径必需: baseAtk 精确值（需游戏内验证）
  - 增强项: passiveStats + triggeredBuffs + buffName（需游戏内数据）

### 落草 (wpn_pistol_0011)

- **数据所在文件**: `public/gamedata.json` → `weaponDatabase`
- **当前主路径 entry**: ✅ 存在
- **已有字段**: id, name, type, rarity, icon, baseAtk(505), passiveStats(`cold_dmg: 44.8`), triggeredBuffs(2 条)
- **缺失字段**: commonSlots 两个槽的 modifierId 均为 null（被跳过 = 无词条加成）；第 2 个 triggeredBuff trigger=`_unknown`
- **字段存在但未消费**:
  - triggeredBuff[0] `on_skill_or_ultimate_cold_attach`: ✅ 已识别，effects 有 `cold_dmg +56%` → **已被 simulation 消费**
  - triggeredBuff[1] `_unknown`: ❌ 未识别，effects 有 `arts_dmg +16.8%` 对 enemy → **未被消费**
  - commonSlots: 两个 null → **被跳过，无词条加成**
- **当前真正被消费的链路**:
  - baseAtk(505) → 武器攻击力 ✅
  - passiveStats.cold_dmg(44.8) → cold_dmg delta ✅
  - triggeredBuff[0]: cold_dmg +56% buff → simulation ✅
- **估算值**: 无
- **当前状态**: **基础可用，部分被动和词条未接入**
- **最小补齐建议**:
  - 主路径必需: commonSlots 两个槽的 modifierId 需要实际值（wiki 或游戏内确认）
  - 增强项: triggeredBuff[1] trigger 从 `_unknown` 更新为实际 trigger 类型 + buffName

### 望乡 (wpn_pistol_0007)

- **数据所在文件**: `public/gamedata.json` → `weaponDatabase`
- **当前主路径 entry**: ✅ 存在
- **已有字段**: id, name, type, rarity, icon, baseAtk(490), passiveStats(`attack: 19.6`), commonSlots(agility+cold_dmg large)
- **缺失字段**: triggeredBuff trigger=`_unknown` 且 effects 包含无效 stat `cold_nature_dmg`（不在 CORE_STATS）
- **字段存在但未消费**:
  - triggeredBuff `_unknown` → **完全未被消费**（trigger 未识别 + stat 无效）
- **当前真正被消费的链路**:
  - baseAtk(490) → 武器攻击力 ✅
  - passiveStats.attack(19.6) → `attack_percent` ✅
  - commonSlots agility/cold_dmg → delta ✅
- **估算值**: 无
- **当前状态**: **基础可用，被动完全未接入**
- **最小补齐建议**:
  - 主路径必需: 无（基础面板数值已完整）
  - 增强项: (1) triggeredBuff trigger 从 `_unknown` 更新为实际类型 (2) `cold_nature_dmg` 需拆分为 `cold_dmg` + `nature_dmg` 两个有效 stat (3) buffName

---

## 3. 现有链路结论

### 已真正进入现有主路径的部分

| 链路 | 光荣记忆 | 狼之绯 | 落草 | 望乡 |
|---|---|---|---|---|
| 武器攻击力（baseAtk → 计算链） | ✅ | ✅（估算值） | ✅ | ✅ |
| 面板加成（passiveStats → delta） | ✅ ATK% | ❌ 空 | ✅ cold_dmg | ✅ ATK% |
| 词条（commonSlots → delta） | ✅ agi+crit | ✅ agi+crit | ❌ 2×null | ✅ agi+cold |
| 被动（triggeredBuffs → simulation） | ❌ trigger 未识别 | N/A（空） | ⚠️ 1/2 识别 | ❌ trigger 未识别 |

### "看起来有但未走通链路"的字段
- 光荣记忆 triggeredBuffs: entry 存在但 trigger `on_skill_break_apply` 未识别 + effects 为空
- 落草 triggeredBuff[1]: trigger `_unknown` + effects 虽有值但未消费
- 望乡 triggeredBuff: trigger `_unknown` + stat `cold_nature_dmg` 不在 CORE_STATS
- 落草 commonSlots: 两个 null → 被安全跳过但无加成

### 当前系统真正依赖的最小必需项
- `baseAtk`: 必须有数字（非 undefined/null）→ 4 把都已有
- `commonSlots[*].modifierId`: 有则消费，null 则跳过 → 安全
- `passiveStats.*`: 有则消费 → 安全
- `triggeredBuffs[*].trigger`: 必须在 `TRIGGER_EVENT_MAP` 中才被消费

---

## 4. 最小补齐建议（仅建议，不实施）

### 建议 1: 落草 commonSlots 补实际 modifierId
- **文件**: `public/gamedata.json` → 落草 entry → commonSlots
- **目的**: 让落草的两个词条槽产生实际 delta（当前 null 被跳过 = 无加成）
- **需要数据**: 需从 wiki 或游戏内确认两个槽的 modifierId 和 size
- **不会引入新真值源**: 改的是现有 gamedata.json

### 建议 2: 狼之绯 baseAtk 精确化
- **文件**: `public/gamedata.json` → 狼之绯 entry → baseAtk
- **目的**: 将估算值 495 替换为实际值
- **需要数据**: 游戏内确认（wiki 暂无页面）
- **不会引入新真值源**

### 建议 3: 望乡/光荣记忆/落草 triggeredBuff trigger 补正
- **文件**: `public/gamedata.json` → 各武器 triggeredBuffs → trigger 字段
- **目的**: 将 `_unknown` / `on_skill_break_apply` 更新为系统可识别的 trigger 类型
- **可能还需**: `weaponDataAdapter.ts` 新增 trigger 映射（如 `on_skill_break_apply`）
- **不会引入新真值源**

### 建议 4: 望乡 stat `cold_nature_dmg` 拆分
- **文件**: `public/gamedata.json` → 望乡 triggeredBuffs → effects → stat
- **目的**: 将无效 stat `cold_nature_dmg` 拆为 `cold_dmg` + `nature_dmg`
- **不会引入新真值源**

---

## 5. 修改前风险点

| 武器 | 风险 | 严重度 |
|---|---|---|
| 光荣记忆 | 被动"破防时终结伤害+33.6%"不生效（trigger 未识别 + effects 空） | 中 — 面板数值正确，但 simulation 缺增伤 |
| 狼之绯 | baseAtk=495 可能偏差 ±5-15 | 低 — 攻击力偏差 <3% |
| 狼之绯 | passiveStats/triggeredBuffs 为空 → 武器被动完全不生效 | 中 — 如果武器有被动则缺失 |
| 落草 | commonSlots 2×null → 无词条加成 | 中 — 缺少 2 个词条位的面板加成 |
| 落草 | triggeredBuff[1] `_unknown` → 对敌 arts_dmg+16.8% 不生效 | 中 — simulation 缺增伤 |
| 望乡 | triggeredBuff `_unknown` + 无效 stat → 被动完全不生效 | 中 — simulation 缺增伤 |
| 望乡 | `cold_nature_dmg` 不在 CORE_STATS → 即使 trigger 修复也无法正确消费 | 中 |

---

# 审计结论（一句话版）

**光荣记忆、落草、望乡**的基础面板数值（攻击力 + 词条 + passiveStats）已完整接入，但 triggeredBuffs 被动效果均未能进入 simulation（trigger 未识别/stat 无效）。**狼之绯**基础可用但 baseAtk 为估算值且 passiveStats/triggeredBuffs 完全为空。四把武器均不存在主链路阻断风险，但 simulation 精度受限于被动未接入。
