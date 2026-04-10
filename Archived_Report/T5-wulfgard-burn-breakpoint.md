# T5 WULFGARD 终结技燃烧断点定位

---

## 问题现象

- 附着转化型燃烧（fire + electro → conduction）正常
- WULFGARD 终结技"强制施加燃烧"不生效
- CHENQIANYU 叠层正常

## 根因

WULFGARD 终结技的 anomaly effect type 是 `"burning"`（直接施加燃烧异常），不是 `"blaze_attach"`（元素附着）。

`"burning"` 不在 simulator.ts 的任何路由映射中：
- 不在 `ELEMENT_ATTACH_MAP`（只含 blaze_attach/cold_attach/emag_attach/nature_attach）
- 不在 `PHYSICAL_ANOMALY_MAP`（只含 armor_break/stagger/knockdown/knockup）
- 不在 `SCNEARIO_EFFECT_TYPE_MAP`（同上 8 种）

结果：`"burning"` 触发 `UNKNOWN_EFFECT_TYPE` 诊断警告 → 效果被丢弃。

## 数据对照

### WULFGARD 各技能的 anomaly type

| 技能 | anomaly type | 路由 | 结果 |
|---|---|---|---|
| 战技 | `"blaze_attach"` | `ELEMENT_ATTACH_MAP` → `APPLY_MAGIC_ATTACHMENT(fire)` | **正常** |
| 连携 | `"blaze_attach"` | 同上 | **正常** |
| 终结技 | `"burning"` | **无映射** → 跳过 | **不生效** |

### 与 PERLICA 导电的对照

| 场景 | 数据链 | 运行路径 | 结果 |
|---|---|---|---|
| WULFGARD 战技 + PERLICA 战技 | `blaze_attach` + `emag_attach` | APPLY_MAGIC_ATTACHMENT × 2 → MagicReactionResolver → 跨元素反应 → conduction | **正常** |
| PERLICA 连携 | `"conductive"` | **无映射** → 跳过 | 不生效（但用户未单独测试这条） |
| WULFGARD 终结技 | `"burning"` | **无映射** → 跳过 | **不生效** |

用户观察到的"导电正常"来自 fire+electro 附着跨元素反应，不是来自 `"conductive"` 直接效果。

## 影响范围

同样未路由的直接异常类型：

| type | 角色 | 对应 anomalyType |
|---|---|---|
| `"burning"` | WULFGARD ultimate | `"burn"` |
| `"conductive"` | PERLICA link, ARCLIGHT ultimate | `"conduction"` |
| `"frozen"` | YVONNE skill/link, SNOWSHINE ultimate | `"freeze"` |
| `"corrosion"` | ARDELIA link | `"corrosion"` |

## 最小改动实施方案（仅方案，不实施）

### 做什么

在 `simulator.ts` 的 effect 路由循环中新增 Route 2.5：直接异常映射。

### 映射

```
burning    → APPLY_DIRECT_ANOMALY { anomalyType: "burn", level: stacks }
conductive → APPLY_DIRECT_ANOMALY { anomalyType: "conduction", level: stacks }
frozen     → APPLY_DIRECT_ANOMALY { anomalyType: "freeze", level: stacks }
corrosion  → APPLY_DIRECT_ANOMALY { anomalyType: "corrosion", level: stacks }
```

### 改动范围

仅 `simulator.ts`：+1 映射 const（4 行）+ 路由分支（~15 行）

### 复用

完全复用现有 `APPLY_DIRECT_ANOMALY` 事件 + `ApplyDirectAnomalyHandler` + `EnemyStatusState.applyBurn/Conduction/Freeze/Corrosion()`。不需要新增 handler 或 state。

### 不做

- 不处理角色专属效果（endmin_debuff, pograni_buff 等 ~25 种）
- 不做 UI
- 不改 schema
