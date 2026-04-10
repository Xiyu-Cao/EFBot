# 普通模式技能详情切换到 operator folder — 完成报告

## 1. 改了哪些文件

| 文件 | 改动 |
|---|---|
| `PropertiesPanel.vue` | 导入 `loadOperator`；新增 `staticSkillData` computed；header 名称优先用静态数据；技能说明区块统一为两种模式共享 |

## 2. 普通模式技能详情现在的读取优先级

```
1. staticSkillData (loadOperator → skills.json)
   ├── 技能名称: staticSkillData.name || targetData.name
   └── 技能描述: staticSkillData.description（独立 section）
2. targetData (store.activeSkillLibrary → gamedata)
   └── 数值属性: duration, cooldown, damageTicks, anomalies 等（不变）
```

也就是说：
- **名称 + 描述** → 优先新静态数据
- **数值属性（时长/冷却/伤害tick等）** → 仍从 targetData/gamedata 读取（这些是 simulation 用的运行时数据，不属于静态说明）

## 3. 与 AE 模式统一的字段

| 字段 | 普通模式 | AE 模式 | 来源 |
|---|---|---|---|
| 技能名称 | `staticSkillData.name` | `opData.skills[key].name` | 同一个 skills.json |
| 技能描述 | `staticSkillData.description` | `aeSelectedItem.description`（含等级倍率） | 同一个 skills.json |
| 技能图标 | 暂仍从 targetData | 从 char.skill_icon | 后续可统一 |

AE 模式的描述额外包含当前等级倍率（由 AbilityExpansionOverlay 的 `selectSkill` 拼接），普通模式只显示基础描述。

## 4. fallback 行为

- `staticSkillData` 为 null（operator 无文件夹/skills.json 缺失）→ 名称用 `targetData.name`，描述 section 隐藏
- `staticSkillData.name` 为空字符串 → 名称用 `targetData.name`
- `staticSkillData.description` 为空字符串 → 描述 section 隐藏
- ROSSI（无 wiki 数据）验证通过：名称/描述都 graceful fallback，不崩溃

## 5. 旧入口保留

是。`targetData` 体系（store.activeSkillLibrary → gamedata 驱动的数值属性）完全保留。新数据只用于名称和描述文本。

## 6. 下一步建议

- **OperatorInfoPanel 的技能 compact 显示**：目前技能名称仍用通用标签（"战技"等），可切到新数据的实际技能名
- **去除 AbilityExpansionOverlay 中的 wiki normalized glob**：已被 operator folder 全量替代，可移除以减小 bundle
- **技能图标统一**：当前图标仍从 `char.skill_icon`/`targetData` 读取，可逐步切到 `skills.json.icon`
