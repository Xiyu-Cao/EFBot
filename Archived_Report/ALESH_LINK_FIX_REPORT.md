# ALESH — link: 凿孔底钓术 修正报告

> 时间：2026-03-30
> 基线：266 tests pass, 0 TS errors

---

## 1. 改了哪些文件

| 文件 | 修改 |
|---|---|
| `public/gamedata.json` | ALESH `link_damage_ticks`: 1 tick → 2 ticks (offsets 0.32s, 1.08s) |
| `simulation/data/skillMultipliers.ts` | +`enhancedMultipliers?` 字段；+ALESH link entry (verified, 2-hit split) |
| `simulation/calculation/phase10.test.ts` | 更新 verified status 测试断言 |

---

## 2. 单 hit → 双 hit

**gamedata.json**: `link_damage_ticks` 从 `[{offset: 1.27}]` 改为 `[{offset: 0.32}, {offset: 1.08}]`。`compileTimeline` 读取此数组生成 2 个 `resolvedDamageTick`，`simulator.ts` 据此排入 2 个独立 `DAMAGE_TICK` 事件，各自独立结算 buff/crit。

**skillMultipliers.ts**: `ALESH.link.multipliers = [0.7444, 2.2556]`（2 元素对应 2 tick）。

---

## 3. 命中时间

`gamedata.json` ALESH `link_damage_ticks`:
- hit1: offset `0.32` (对应 00:19 = 19 帧 @60fps)
- hit2: offset `1.08` (对应 01:05 = 65 帧 @60fps)

---

## 4. 强化效果

**原先**：wiki "强化伤害倍率 480%" 在 mapped-skills 中标记为 `needs_manual_mapping`，runtime 无任何实现。

**现在**：
- `SkillMultiplierEntry` 新增 `enhancedMultipliers?: number[]` 字段
- ALESH link 存储 `enhancedMultipliers: [1.191, 3.609]`（480% 按同比例拆 2 hit）
- `getSkillMultiplier` 和 `applySkillMultiplierOverlay` 支持 `useEnhanced` 参数
- **不新增 hit 数，不新增额外伤害段**；强化只替换总倍率，复用相同 2-hit 结构

---

## 5. 倍率验证

```
Split ratio: hit1 = 33/133 (0.2481), hit2 = 100/133 (0.7519), sum = 1.0000

Default (M3 = 300%):
  hit1 = 0.7444 (74.4%)
  hit2 = 2.2556 (225.6%)
  total = 3.0000

Enhanced (M3 = 480%):
  hit1 = 1.1910 (119.1%)
  hit2 = 3.6090 (360.9%)
  total = 4.8000
```

---

## 6. 数据来源

- 倍率：复用 `extracted-skills/alesh.json` 的 wiki 数据（M3 默认 300%、强化 480%）
- 未引入新真值源
- `skillMultipliers.ts` 仍是唯一倍率入口，gamedata tick 结构仍是唯一 hit 结构入口
