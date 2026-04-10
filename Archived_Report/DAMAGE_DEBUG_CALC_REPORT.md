# Damage Debug Calculator 报告

> 时间：2026-03-30
> 基线：266 tests pass, 0 TS errors
> 入口：`/#/debug-calc`
> 标注：TEMP DEBUG TOOL — SAFE TO DELETE

---

## 1. 新增文件

| 文件 | 作用 |
|---|---|
| `src/debug-tools/damage-calculator/types.ts` | 输入/输出类型 + 默认值工厂 |
| `src/debug-tools/damage-calculator/calculateDamage.ts` | 纯计算函数，复用 `computeEffectiveAttack` |
| `src/debug-tools/damage-calculator/formatBreakdown.ts` | 文本格式化（复制用） |
| `src/debug-tools/damage-calculator/DamageDebugCalculator.vue` | 主组件（三栏布局） |
| `src/debug-tools/damage-calculator/README.md` | 使用与删除说明 |
| `src/router/index.js` | +1 行路由（带 TEMP 注释） |

---

## 2. 入口

浏览器访问 `/#/debug-calc`。页面内有 "← Back to Timeline" 链接返回主页。

---

## 3. 面板来源

- **干员列表**：直接 fetch `/gamedata.json` 的 `characterRoster`（只用于选择参考，不绑定 stats）
- **武器列表**：直接 fetch `/gamedata.json` 的 `weaponDatabase`（选择后自动填入 `passiveStats.attack`）
- **ATK 公式**：复用 `simulation/calculation/attackFormula.ts` 的 `computeEffectiveAttack`

不依赖 timelineStore、不依赖 legality、不依赖 simulation runtime。

---

## 4. 手填乘区

| 区 | 默认值 | 说明 |
|---|---|---|
| Skill Multiplier | 1.0 | 直接乘，输入 2.03 = 203% |
| Defense Zone | 0.5 | 默认减半 |
| Damage Bonus Zone | 1.0 | 增伤区最终乘数 |
| Amplification Zone | 1.0 | 增幅区 |
| Vulnerability Zone | 1.0 | 易伤区 |
| Resistance Zone | 1.0 | 抗性/减伤 |
| Break Zone | 1.0 | 失衡区 |
| Other Zone | 1.0 | 其他修正 |

**规则**：所有乘区输入即最终乘数，不做 auto +1。输入 1.1 就乘 1.1。

---

## 5. 输出

- Non-Crit / Crit / Expected / Total 四个结果卡片
- 完整逐步 breakdown（每一步显示 label + value + formula）
- "Copy Breakdown" 按钮 → 纯文本复制到剪贴板

---

## 6. TEMP_DEBUG_ONLY 标注位置

- `types.ts` 文件头注释
- `calculateDamage.ts` 文件头注释
- `formatBreakdown.ts` 文件头注释
- `DamageDebugCalculator.vue` 顶部注释
- 页面 UI header 红色 badge "TEMP DEBUG TOOL"
- `router/index.js` 路由行注释

---

## 7. 最小使用示例

1. 打开 `/#/debug-calc`
2. Base ATK = 780
3. Primary Ability = 57, Secondary Ability = 43
4. Skill Multiplier = 3.5（管理员战技 M3 = 350%）
5. Defense Zone = 0.5
6. 其余默认
7. → 结果：Non-Crit = 723, Crit = 1084（假设 +50% crit dmg）

---

## 8. 为什么不会污染主系统

- 不依赖 timelineStore / legality / simulation state
- 唯一的 simulation 依赖是纯函数 `computeEffectiveAttack`（只读，无副作用）
- gamedata 通过独立 fetch 加载，不共享 store 实例
- 路由隔离，不出现在主 UI 导航中

## 9. 如何删除

删除 `src/debug-tools/damage-calculator/` 整个目录 + `router/index.js` 中的一行路由。无其他文件依赖。

## 10. 当前限制

- 干员/武器/装备的 stats 不自动合并（gamedata 无角色基础 stats），需手动输入 ATK
- 没有预设模板（如"管理员 M3 全套"）
- 不支持多段 rotation，只支持单 hit
- 不支持 anomaly damage 计算（用途不同）
