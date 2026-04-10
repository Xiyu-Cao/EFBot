# Warfarin Wiki 数据采集报告

> 时间：2026-03-25
> 结果：24/24 干员采集成功，0 error，0 warning
> 存储：`src/external-data/warfarin-wiki/operators/`
> 影响：266 tests pass, 0 TS errors — simulation 完全不受影响

---

## 1. 采集结果

| 干员 | ID | 稀有度 | 元素 | 职业 | 技能数 |
|---|---|---|---|---|---|
| 汤汤 | TANGTANG | 5 | 自然 | 辅卫 | 4 |
| 管理员 | ENDMINISTRATOR | 6 | 物理 | 近卫 | 4 |
| 砺锋 | LIFENG | 5 | 物理 | 近卫 | 4 |
| 余烬 | EMBER | 6 | 灼热 | 游侠 | 4 |
| 洁尔佩塔 | GILBERTA | 6 | 自然 | 术师 | 4 |
| 阿黛拉 | ARDELIA | 5 | 灼热 | 术师 | 4 |
| 波格拉尼奇尼克 | POGRANICHNIK | 6 | 物理 | 近卫 | 4 |
| 伊冯 | YVONNE | 5 | 电磁 | 近卫 | 4 |
| 莱万汀 | LAEVATAIN | 5 | 灼热 | 近卫 | 4 |
| 末祭 | LAST_RITE | 6 | 寒冷 | 术师 | 4 |
| 陈千雨 | CHEN_QIANYU | 5 | 物理 | 近卫 | 4 |
| 初雪 | SNOWSHINE | 5 | 寒冷 | 辅卫 | 4 |
| 夏栀 | XAIHI | 5 | 自然 | 辅卫 | 4 |
| 珀里卡 | PERLICA | 5 | 自然 | 游侠 | 4 |
| 乌尔法德 | WULFGARD | 5 | 物理 | 重装 | 4 |
| 弧光 | ARCLIGHT | 6 | 电磁 | 术师 | 4 |
| 阿蕾莎 | ALESH | 5 | 灼热 | 术师 | 4 |
| 维维安娜 | AVYWENNA | 6 | 物理 | 辅卫 | 4 |
| 大盘 | DA_PAN | 5 | 物理 | 重装 | 4 |
| 艾丝黛拉 | ESTELLA | 5 | 寒冷 | 近卫 | 4 |
| 接球手 | CATCHER | 5 | 电磁 | 游侠 | 4 |
| 安陶 | ANTAL | 6 | 电磁 | 游侠 | 4 |
| 氟石 | FLUORITE | 5 | 自然 | 术师 | 4 |
| 赤瞳 | AKEKURI | 5 | 灼热 | 近卫 | 4 |

---

## 2. 目录结构

```
src/external-data/warfarin-wiki/operators/
  manifest.json          — 抓取元数据 (时间/总数/状态)
  index.json             — 全干员索引 (id/slug/name/rarity/element/profession)
  raw/
    endministrator.json  — 24 个原始 JSON (sections + all_tables + page structure)
  normalized/
    endministrator.json  — 24 个标准化 JSON (meta + stats + skills + talents + potentials)
  snapshots/
    endministrator.html  — 24 个 HTML 快照 (完整原始页面)
```

---

## 3. 技能数据示例（管理员 M3 级）

```
普通攻击 毁伤序列:
  普攻第一段倍率: 51%
  普攻第二段倍率: 61%
  普攻第三段倍率: 68%
  普攻第四段倍率: 78%
  普攻第五段倍率: 90%

战技 构成序列:
  伤害倍率: 350%
  失衡值: 10

连携技 锁闭序列:
  冷却时间: 15s
  伤害倍率: 100%
  击碎结晶伤害倍率: 400%
  封印时间: 5s

终结技 轰击序列:
  伤害倍率: 800%
  额外伤害倍率: 600%
  失衡值: 25
```

---

## 4. 数据字段说明

### normalized JSON schema

```typescript
{
  id: string;           // ENDMINISTRATOR
  slug: string;         // endministrator
  name_zh: string;      // 管理员
  name_en: string|null; // Endministrator
  meta: {
    rarity: number|null;
    element: string|null;
    profession: string|null;
    weapon_type: string|null;
    main_attribute: string|null;
    sub_attribute: string|null;
  };
  stats: { tables: string[][][] };
  talents: string[];
  potentials: string[];
  skills: Array<{
    name: string;                  // 毁伤序列
    type: string;                  // 普通攻击|战技|连携技|终结技
    descriptions: string[];
    level_headers: string[];       // ["1","2"..."9","M1","M2","M3"]
    data_rows: Array<{
      label: string;               // 伤害倍率
      values: string[];            // ["156%","171%"..."350%"]
    }>;
  }>;
  source: { url, fetched_at, parser_version };
}
```

---

## 5. 脚本

`scripts/scrape-warfarin-wiki.mjs` — 可重复运行，覆盖 normalized / raw / snapshots。
依赖：`node-html-parser` (devDependency)。
延迟：800ms/请求。

---

## 6. 后续可做

| 项 | 说明 |
|---|---|
| 将 M3 倍率写入 skillMultipliers.ts | 需手动确认百分比→小数映射规则后批量更新 |
| 提取基础属性到 stats 表 | 当前 stats.tables 保存了 raw 表格，可进一步 normalize |
| 天赋/潜能结构化 | 当前为纯文本，可进一步解析 |
| 增量抓取 | 当前全量覆盖，可加 etag / hash 做增量 |
