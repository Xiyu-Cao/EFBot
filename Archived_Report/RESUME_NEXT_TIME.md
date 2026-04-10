# 下次恢复指南

**当前状态**：Phase 10 完成。251 tests pass, 0 TS errors. 可继续开发。

## 先看什么

1. `HANDOFF.md` — 完整上下文
2. `PHASE10_REPORT.md` — 最新改了什么
3. `data/skillMultipliers.ts` — 15 个 estimated 条目待核对

## 先跑什么

```bash
cd E:/EFBot/apps/endaxis-web
npx vitest run          # 251 tests
npx vue-tsc --noEmit    # 0 errors
```

## 下次先干什么

**P0**：
1. 实机核对 skill multiplier 值 → 改 `status: "verified"` + 填 `source`
2. 把 timelineStore 的 `CATEGORY_TO_SET` 改为从 `registry.ts` 导入（消除重复）

**P1**：
3. 确认蚀迹武器 ID（gamedata 里是 "作品：蚀象" wpn_funnel_0006）
4. 扩更多 TRIGGER_EVENT_MAP 条目

## 关键文件

| 文件 | 干什么 |
|---|---|
| `data/skillMultipliers.ts` | 技能倍率真值 — 所有待核对项在这里 |
| `equipment/definitions.ts` | 装备/武器触发效果 — 只改 action 逻辑 |
| `equipment/registry.ts` | ID 映射 + 注册入口 |
| `calculation/anomalyDamageCalc.ts` | 异常公式唯一真值 |
| `calculation/multiplierZones.ts` | 11 个乘区 |
| `stores/timelineStore.js:3951` | UI simulation 入口 |

## 不要做的事

- 不要在 `definitions.ts` 加 `stats +=`（静态词条已在 timelineStore delta 里）
- 不要在 `multiplierZones.ts` 的 special zone 再乘 artsPower（已内含在异常倍率中）
- 不要重复 `CATEGORY_TO_SET` 映射（应从 registry 导入）
