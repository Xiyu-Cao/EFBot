# 左侧栏页签重组报告

> 时间：2026-03-31
> 基线：266 tests pass, 0 TS errors

---

## 1. 修改的文件

只改了 `components/ActionLibrary.vue`：
- script: 新增 `activePanelTab` ref（'skills' / 'operator' / 'equipment'）
- template: 主 tabs 改为三页签 + 技能页内嵌子 tabs；各 settings panel 的 `v-if` 条件改为按 `activePanelTab` 切换
- style: +sub-tab 样式

---

## 2. 三个页签内容

### 技能页（activePanelTab === 'skills'）
- 子 tabs：干员技能库 / 武器BUFF库 / 套装BUFF库
- 显示对应的 skill card 列表（拖拽逻辑不变）
- 不显示任何 stats 配置面板

### 干员页（activePanelTab === 'operator'）
- 初始充能
- ���能上限
- 充能效率
- 连携技冷却缩减
- 源石技艺强度

### 装备页（activePanelTab === 'equipment'）
- 武器数值（通用词条1/2等级、专属buff等级）
- 装备精锻（甲/手/饰1/饰2 精锻等级）

---

## 3. 耦合情况

完全移动，无残留。原先三个 tab 各自的 settings panel 通过修改 `v-if` 条件从 `activeLibraryTab === 'xxx'` 改为 `activePanelTab === 'operator'` / `activePanelTab === 'equipment'`，内容和交互逻辑零改动。

---

## 4. 是否只做了分组排版调整

**是**。所有字段内容、数值逻辑、输入控件、拖拽行为均未修改。只改了 tab 条件和 template 结构顺序。
