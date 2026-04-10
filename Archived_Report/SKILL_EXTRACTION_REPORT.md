# 技能表提纯报告

> 时间：2026-03-25
> 结果：24/24 干员技能提取成功，96 个技能，0 warning
> 存储：`src/external-data/warfarin-wiki/operators/extracted-skills/`
> 影响：266 tests pass, 0 TS errors — simulation 完全不受影响

---

## 1. 提取结果

全部 24 个干员均提取到 4 个技能（normalAttack / skill / link / ultimate），共 96 个技能条目。

每个技能含 12 级数据（1-9 + M1/M2/M3），按 label→value 键值对存储。

---

## 2. 目录结构

```
extracted-skills/
  _summary.json           — 全量汇总 (per-operator skill count + warnings)
  endministrator.json     — 24 个独立 JSON
  gilberta.json
  ...
```

---

## 3. 单个文件 schema

```json
{
  "id": "ENDMINISTRATOR",
  "slug": "endministrator",
  "skills": {
    "normalAttack": {
      "name": "毁伤序列",
      "type": "普通攻击",
      "type_key": "normalAttack",
      "level_headers": ["1","2",...,"M3"],
      "row_labels": ["普攻第一段倍率", "普攻第二段倍率", ...],
      "levels": {
        "1": { "rows": { "普攻第一段倍率": "23%", ... } },
        "M3": { "rows": { "普攻第一段倍率": "51%", ... } }
      }
    },
    "skill": { ... },
    "link": { ... },
    "ultimate": { ... }
  },
  "source": { "url": "...", "fetched_at": "...", "extracted_at": "..." }
}
```

---

## 4. M3 级 Spot Check 摘要

### 管理员 ENDMINISTRATOR
| 技能 | 关键数据 |
|---|---|
| 战技 | 伤害倍率=350%, 失衡值=10 |
| 连携技 | CD=15s, 伤害=100%, 击碎结晶=400% |
| 终结技 | 伤害=800%, 额外伤害=600%, 失衡=25 |

### 洁尔佩塔 GILBERTA
| 技能 | 关键数据 |
|---|---|
| 战技 | 牵引伤害=219%, 爆炸伤害=130% |
| 连携技 | CD=19s, 伤害=315% |
| 终结技 | 能量=90, 伤害=750%, 法术脆弱=30% |

### 莱万汀 LAEVATAIN
| 技能 | 关键数据 |
|---|---|
| 战技 | 初始爆炸=140%, 追加伤害=770%, 终结技期间追加=900% |
| 连携技 | CD=9s, 伤害=540%, 1/2/3+敌人充能=25/30/35 |
| 终结技 | 能量=300, 持续=15s, 强化普攻1-4段=146%/182%/260%/456% |

### 陈千语 CHEN_QIANYU
| 技能 | 关键数据 |
|---|---|
| 战技 | 伤害=380%, 失衡=10, 浮空=2.5s |
| 连携技 | CD=15s, 伤害=270% |
| 终结技 | 能量=70, 斩击=81%, 终结一击=1023% |

### 波格拉尼奇尼克 POGRANICHNIK
| 技能 | 关键数据 |
|---|---|
| 战技 | 第一段=192%, 第二段=238%, 消耗1-4层破防恢复=5/15/25/35 |
| 连携技 | CD=17s, 三段伤害=95%/122%/149%, 强化第三段=297% |
| 终结技 | 能量=90, 进军=300%, 袭扰=100%, 决胜=450% |

---

## 5. 后续可做

| 项 | 说明 |
|---|---|
| 批量更新 skillMultipliers.ts | 用 M3 倍率百分比 ÷ 100 写入，标记 source="warfarin-wiki M3" |
| 对齐 gamedata tick 结构 | 将 wiki row labels 映射到 gamedata tick 顺序 |
| 提取天赋/潜能 | 当前 extracted-skills 只含技能，天赋/潜能仍在 normalized 层 |
| 增量刷新 | 新版本上线后重抓 + 对比 diff |
