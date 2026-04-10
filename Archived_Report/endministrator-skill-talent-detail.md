# 管理员技能/天赋详情接入新静态数据 — 完成报告

## 改了哪些文件

| 文件 | 改动 |
|---|---|
| `AbilityExpansionOverlay.vue` | 导入 `loadOperator`；`mainAttribute` / `talents` / `selectSkill` / `selectMainAttribute` 优先读新静态数据；技能描述含当前等级倍率 |
| `PropertiesPanel.vue` | 在 AE 模式技能详情顶部新增"技能说明"区块，显示 `aeSelectedItem.description` |

## 管理员哪些详情走新结构

### 技能（skills.json）
- 技能名称（如 `构成序列`）
- 技能描述文本
- 当前等级对应的倍率数据（自动读取 `levelData[当前等级]`，格式如 `伤害倍率: 350%`）

### 天赋（talents.json）
- 天赋名称
- 天赋图标
- 解锁/强化阶段（`unlockStage` / `upgradeStage`）
- 分阶段描述（`[解锁] xxx` / `[强化] xxx`，替代旧的原始拼接文本）

### 主属性（talents.json）
- 主属性名称 + 图标
- 副属性信息（`副属性为力量`）

## UI 消费点

| 消费点 | 数据来源 |
|---|---|
| 能力扩展右侧详情 → 点击技能 | skills.json 描述 + 当前等级倍率（"技能说明"区块） |
| 能力扩展右侧详情 → 点击天赋 | talents.json 分阶段描述 |
| 能力扩展右侧详情 → 点击主属性 | talents.json 主/副属性 |

## 其他干员

仍走旧入口。`loadOperator()` 对未迁移干员返回 null 字段，所有读取点都有 fallback：
- `opData.value.skills?.[sk.key]` → null → 用旧的 label/icon
- `opData.value.talents?.talents` → null → 走 wiki parseTalentEntries
- `opData.value.talents?.mainAttribute` → null → 走 wiki meta.main_attribute

## 新结构字段不完整时的 fallback

- skills.json 缺失 → `staticSkill` 为 null → 描述为空字符串，名称用旧 label
- talents.json 缺失 → `staticTalents` 为 null → 走 wiki 解析 → 走 exclusive_buffs
- levelData 某行缺失 → 显示 `—`

## 去哪里验证

1. **进入能力扩展模式 → 选中管理员**
2. **点击任一技能（如"战技"）**
   - 右侧详情顶部应出现"技能说明"区块
   - 显示 `构成序列` 的描述 + 当前等级倍率（如 M3: `伤害倍率: 350%`）
   - 调整技能等级后再点击，倍率数值应跟着变
3. **点击天赋1（本质瓦解）**
   - 右侧详情应显示：`[解锁] 当敌人附着的源石结晶被消耗后，自身攻击力+15%...`
   - 以及 `[强化] ...攻击力+30%...`
4. **点击主属性**
   - 右侧详情应显示：`该干员的主属性为敏捷。副属性为力量。`
5. **切换到其他干员 → 同样操作**
   - 天赋详情应走旧数据（原始拼接文本），不崩溃
