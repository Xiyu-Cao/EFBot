# Endaxis

**明日方舟：终末地** 排轴编辑器与伤害模拟工具

基于 [end-axis](https://github.com/floating-sky/end-axis) 二次开发，核心模拟引擎与大部分前端逻辑已全面重写。

线上地址: https://www.endfieldbot.com

## 功能

- **排轴编辑器** — 双模式（自由摆放 / 拟真模拟），支持技能放置、连携技队列、普攻连段
- **V2 伤害模拟引擎** — 逐 hit 结算，11 乘区伤害公式，buff/debuff/异常/失衡完整模拟
- **处决系统** — 失衡期间自动触发处决，两遍模拟精确判定
- **导出** — 长图导出（PNG，内嵌数据码可导入）、JSON 方案文件、分享码
- **多方案管理** — 最多 10 个方案快速切换对比
- **国际化** — 中文（默认）/ English

## 当前状态

> Beta — 核心功能可用，角色数据持续补充中

| 类别 | 状态 |
|------|------|
| V2 角色数据 | 3/25 完成（ENDMINISTRATOR, POGRANICHNK, LASTRITE） |
| 排轴编辑器 | 可用（自由 + 拟真模式） |
| 伤害计算页面 | 骨架已搭建，待完善 |
| 武器 & 装备 | 数据已录入，部分特殊效果待实现 |

## 本地运行

```bash
cd apps/endaxis-web
npm install          # Node ^20.19.0 || >=22.12.0
npm run dev          # http://localhost:1420
npm test             # Vitest 测试
npm run type-check   # vue-tsc 类型检查
```

## 技术栈

- **前端**: Vue 3 + Vite + Pinia + Element Plus
- **模拟引擎**: 纯 TypeScript，无后端依赖
- **编译器**: 自研时间轴编译系统（时间冻结、效果解析、打断检测）
- **测试**: Vitest

## 致谢

- [end-axis](https://github.com/floating-sky/end-axis) — 原始项目
- [明日方舟：终末地](https://endfield.hypergryph.com/) — 游戏数据来源

## License

MIT
