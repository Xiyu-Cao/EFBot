/**
 * Warfarin Wiki operator data scraper.
 *
 * Usage:  node scripts/scrape-warfarin-wiki.mjs
 *
 * Fetches all operator pages from warfarin.wiki,
 * saves raw + normalized JSON to src/external-data/warfarin-wiki/operators/.
 *
 * Does NOT modify any simulation runtime files.
 */

import { parse } from "node-html-parser";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const BASE = "https://warfarin.wiki";
const INDEX_URL = `${BASE}/cn/operators`;
const OUT_DIR = join(
  import.meta.dirname,
  "../src/external-data/warfarin-wiki/operators",
);

mkdirSync(join(OUT_DIR, "raw"), { recursive: true });
mkdirSync(join(OUT_DIR, "normalized"), { recursive: true });
mkdirSync(join(OUT_DIR, "snapshots"), { recursive: true });

const DELAY_MS = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 1. Fetch index page
// ---------------------------------------------------------------------------

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) EFBot-DataCollector/1.0",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

async function fetchOperatorIndex() {
  console.log(`Fetching index: ${INDEX_URL}`);
  const html = await fetchHtml(INDEX_URL);
  const root = parse(html);

  // Find operator cards/links — look for links to /cn/operators/<slug>
  const links = root.querySelectorAll('a[href*="/cn/operators/"]');
  const operators = [];
  const seen = new Set();

  for (const a of links) {
    const href = a.getAttribute("href") || "";
    const match = href.match(/\/cn\/operators\/([a-z0-9_-]+)$/i);
    if (!match) continue;
    const slug = match[1];
    if (slug === "" || seen.has(slug)) continue;
    seen.add(slug);

    // Try to extract metadata from parent card
    const card = a.closest(".operator-card, .card, [class*=operator], tr, li") || a;
    const text = card.textContent.trim();

    operators.push({
      slug,
      name_zh: a.textContent.trim() || text.split(/\s/)[0],
      url: `${BASE}/cn/operators/${slug}`,
    });
  }

  console.log(`  Found ${operators.length} operators`);
  return operators;
}

// ---------------------------------------------------------------------------
// 2. Parse detail page
// ---------------------------------------------------------------------------

function extractText(el) {
  return el ? el.textContent.trim() : "";
}

function parseTable(tableEl) {
  if (!tableEl) return null;
  const rows = [];
  for (const tr of tableEl.querySelectorAll("tr")) {
    const cells = tr.querySelectorAll("th, td").map((c) => extractText(c));
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function parseTables(root) {
  return root.querySelectorAll("table").map((t) => parseTable(t));
}

function parseSections(root) {
  // Extract all heading + content pairs
  const sections = [];
  const headings = root.querySelectorAll("h1, h2, h3, h4");
  for (const h of headings) {
    const title = extractText(h);
    const level = parseInt(h.tagName.replace("H", ""), 10);
    // Collect content until next heading of same or higher level
    let content = [];
    let next = h.nextElementSibling;
    while (next && !/^H[1-4]$/i.test(next.tagName)) {
      content.push(next.outerHTML);
      next = next.nextElementSibling;
    }
    sections.push({ title, level, html: content.join("\n") });
  }
  return sections;
}

function parseOperatorMeta(root) {
  const meta = {};
  const text = root.textContent;

  // Rarity from star display
  const rarityMatch = text.match(/(\d)★/);
  if (rarityMatch) meta.rarity = rarityMatch[1];

  // Extract from <th>label</th><td>value</td> pairs
  const thLabels = {
    "元素": "element",
    "伤害类型": "element",
    "职业": "profession",
    "武器": "weapon_type",
    "武器类型": "weapon_type",
    "主属性": "main_attribute",
    "副属性": "sub_attribute",
    "名字": "name_zh_cell",
    "英语名字": "name_en_cell",
    "稀有度": "rarity_cell",
  };

  for (const th of root.querySelectorAll("th")) {
    const label = extractText(th);
    const key = thLabels[label];
    if (key) {
      const td = th.nextElementSibling;
      if (td && td.tagName === "TD") {
        meta[key] = extractText(td);
      }
    }
  }

  // Use cell-extracted name_en if no other source
  if (!meta.name_en && meta.name_en_cell) meta.name_en = meta.name_en_cell;
  // Use cell rarity if regex missed
  if (!meta.rarity && meta.rarity_cell) {
    const m = meta.rarity_cell.match(/(\d)/);
    if (m) meta.rarity = m[1];
  }
  // Clean up temp keys
  delete meta.name_zh_cell;
  delete meta.name_en_cell;
  delete meta.rarity_cell;

  // English name: look for <h1> or <h2> that contains ascii-only word(s) near the operator name
  // Or fallback: check og:title, title tag, or prominent English text
  const h1Text = extractText(root.querySelector("h1"));
  // Also try to find English in structured data / JSON-LD
  const jsonLd = root.querySelector('script[type="application/ld+json"]');
  if (jsonLd) {
    try {
      const ld = JSON.parse(jsonLd.textContent);
      if (ld.name) meta.name_en = ld.name;
    } catch {}
  }

  // Fallback: check if h1 contains English name after Chinese
  const enInH1 = h1Text.match(/[\u4e00-\u9fff]+\s*[|·\s]\s*([A-Za-z][\w\s-]+)/);
  if (enInH1 && !meta.name_en) meta.name_en = enInH1[1].trim();

  // Last resort: check meta tags
  if (!meta.name_en) {
    const ogTitle = root.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      const ogText = ogTitle.getAttribute("content") || "";
      const enInOg = ogText.match(/([A-Za-z][\w\s-]{2,})/);
      if (enInOg) meta.name_en = enInOg[1].trim();
    }
  }

  return meta;
}

function parseSkillSection(root) {
  /**
   * The wiki renders all skills inside ONE <table>.
   * Structure per skill:
   *   <thead> contains <h3>SkillName</h3> + <div>skill type (普通攻击/战技/etc)</div>
   *   <tbody> contains:
   *     - first <tr>: description block
   *     - level selector row (1-9, M1-M3 tabs)
   *     - data rows: <td>label</td><td>value</td>...
   *
   * Strategy: find all <thead> that contain <h3>, extract skill name + type,
   * then walk following <tbody> to get description and data rows.
   */
  const skills = [];

  // Each skill spans TWO consecutive sibling <table> elements:
  //   table A: <thead> with h3 skill name + <tbody> with description
  //   table B: <thead> with level headers (1-9,M1-M3) + <tbody> with data rows
  const allTables = root.querySelectorAll("table");
  const skillTypeLabels = ["普通攻击", "战技", "连携技", "终结技"];

  for (let ti = 0; ti < allTables.length; ti++) {
    const tableA = allTables[ti];
    const h3 = tableA.querySelector("h3");
    if (!h3) continue;

    const name = extractText(h3);
    const theadText = extractText(tableA.querySelector("thead") || tableA);
    const skillType = skillTypeLabels.find(l => theadText.includes(l)) || null;
    if (!skillType) continue;

    // Description from tableA's tbody
    const descriptions = [];
    const tbodyA = tableA.querySelector("tbody");
    if (tbodyA) {
      const text = extractText(tbodyA);
      if (text.length > 5) descriptions.push(text);
    }

    // Data from the next table (tableB)
    const dataRows = [];
    let levelHeaders = [];
    const tableB = allTables[ti + 1];
    if (tableB && !tableB.querySelector("h3")) {
      // Level headers from tableB's thead cells
      const theadB = tableB.querySelector("thead");
      if (theadB) {
        const cells = theadB.querySelectorAll("td, th");
        if (cells.length > 1) {
          levelHeaders = cells.map(c => extractText(c)).filter(t => t.length > 0);
        } else {
          // Fallback: split concatenated text
          const hText = extractText(theadB);
          const m3Match = hText.match(/^(\d+)(M[123].*)/);
          if (m3Match) {
            levelHeaders = [...m3Match[1].split(""), ...m3Match[2].match(/M[123]/g)];
          } else {
            levelHeaders = hText.match(/\d|M[123]/g) || [];
          }
        }
      }

      // Data rows from tableB's tbody
      const tbodyB = tableB.querySelector("tbody");
      if (tbodyB) {
        for (const tr of tbodyB.querySelectorAll("tr")) {
          const cells = tr.querySelectorAll("td, th");
          if (cells.length < 2) continue;
          const label = extractText(cells[0]);
          if (!label) continue;
          const values = [];
          for (let i = 1; i < cells.length; i++) {
            values.push(extractText(cells[i]));
          }
          if (values.some(v => v.length > 0)) {
            dataRows.push({ label, values });
          }
        }
      }
    }

    skills.push({
      name,
      type: skillType,
      descriptions,
      level_headers: levelHeaders,
      data_rows: dataRows,
    });
  }

  return skills;
}

function parseStatsTable(root) {
  // Find stats tables (strength/agility/wisdom/etc)
  const tables = root.querySelectorAll("table");
  const statsTables = [];

  for (const t of tables) {
    const text = t.textContent;
    if (
      text.includes("力量") &&
      text.includes("敏捷") &&
      text.includes("攻击力")
    ) {
      statsTables.push(parseTable(t));
    }
  }

  return statsTables;
}

function parseTalents(root) {
  const talents = [];
  const text = root.textContent;
  // Look for talent section content
  const headings = root.querySelectorAll("h1, h2, h3, h4");
  for (const h of headings) {
    if (extractText(h).includes("天赋")) {
      let el = h.nextElementSibling;
      while (el && !/^H[1-3]$/i.test(el.tagName)) {
        const t = extractText(el);
        if (t.length > 5) talents.push(t);
        el = el.nextElementSibling;
      }
      break;
    }
  }
  return talents;
}

function parsePotentials(root) {
  const potentials = [];
  const headings = root.querySelectorAll("h1, h2, h3, h4");
  for (const h of headings) {
    if (extractText(h).includes("潜能")) {
      let el = h.nextElementSibling;
      while (el && !/^H[1-3]$/i.test(el.tagName)) {
        const t = extractText(el);
        if (t.length > 2) potentials.push(t);
        el = el.nextElementSibling;
      }
      break;
    }
  }
  return potentials;
}

async function scrapeOperator(slug) {
  const url = `${BASE}/cn/operators/${slug}`;
  console.log(`  Fetching: ${slug}`);
  const html = await fetchHtml(url);
  const root = parse(html);

  // Save HTML snapshot
  writeFileSync(join(OUT_DIR, "snapshots", `${slug}.html`), html, "utf-8");

  // --- Raw extraction ---
  const raw = {
    source_url: url,
    fetched_at: new Date().toISOString(),
    page_title: extractText(root.querySelector("title") || root.querySelector("h1")),
    slug,
    html_path: `snapshots/${slug}.html`,
    sections: parseSections(root),
    all_tables: parseTables(root),
    full_text_length: root.textContent.length,
  };

  // --- Normalized extraction ---
  const meta = parseOperatorMeta(root);
  const statsTables = parseStatsTable(root);
  const skills = parseSkillSection(root);
  const talents = parseTalents(root);
  const potentials = parsePotentials(root);

  // Extract clean Chinese name from h1
  const h1El = root.querySelector("h1");
  const h1Text = extractText(h1El);
  // Take only CJK characters from start of h1
  const zhMatch = h1Text.match(/^([\u4e00-\u9fff\u00b7·]+)/);
  const cleanNameZh = zhMatch ? zhMatch[1] : h1Text.split(/\s/)[0];

  const normalized = {
    id: slug.replace(/-/g, "_").toUpperCase(),
    slug,
    name_zh: cleanNameZh,
    name_en: meta.name_en || null,
    meta: {
      rarity: meta.rarity ? parseInt(meta.rarity) : null,
      element: meta.element || null,
      profession: meta.profession || null,
      weapon_type: meta.weapon_type || null,
      main_attribute: meta.main_attribute || null,
      sub_attribute: meta.sub_attribute || null,
    },
    stats: {
      tables: statsTables,
    },
    talents,
    potentials,
    skills,
    source: {
      url,
      fetched_at: raw.fetched_at,
      parser_version: "1.0.0",
    },
  };

  return { raw, normalized };
}

// ---------------------------------------------------------------------------
// 3. Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== Warfarin Wiki Operator Scraper ===\n");

  const operators = await fetchOperatorIndex();
  const manifest = {
    source: INDEX_URL,
    fetched_at: new Date().toISOString(),
    total: operators.length,
    operators: [],
    warnings: [],
  };

  const index = [];

  for (const op of operators) {
    try {
      const { raw, normalized } = await scrapeOperator(op.slug);

      writeFileSync(
        join(OUT_DIR, "raw", `${op.slug}.json`),
        JSON.stringify(raw, null, 2),
        "utf-8",
      );
      writeFileSync(
        join(OUT_DIR, "normalized", `${op.slug}.json`),
        JSON.stringify(normalized, null, 2),
        "utf-8",
      );

      const warnings = [];
      if (!normalized.meta.rarity) warnings.push("missing rarity");
      if (!normalized.meta.element) warnings.push("missing element");
      if (normalized.skills.length === 0) warnings.push("no skills parsed");
      if (normalized.stats.tables.length === 0) warnings.push("no stats tables");
      const skillsWithData = normalized.skills.filter(s => s.data_rows && s.data_rows.length > 0);
      if (normalized.skills.length > 0 && skillsWithData.length === 0)
        warnings.push("skills found but no data_rows parsed");

      manifest.operators.push({
        slug: op.slug,
        name_zh: normalized.name_zh,
        id: normalized.id,
        status: warnings.length > 0 ? "partial" : "ok",
        warnings,
      });

      if (warnings.length > 0) {
        manifest.warnings.push(
          ...warnings.map((w) => `${op.slug}: ${w}`),
        );
        console.log(`    WARN: ${warnings.join(", ")}`);
      } else {
        console.log(`    OK`);
      }

      index.push({
        id: normalized.id,
        slug: op.slug,
        name_zh: normalized.name_zh,
        name_en: normalized.name_en,
        rarity: normalized.meta.rarity,
        element: normalized.meta.element,
        profession: normalized.meta.profession,
      });
    } catch (err) {
      console.log(`    ERROR: ${err.message}`);
      manifest.operators.push({
        slug: op.slug,
        name_zh: op.name_zh,
        status: "error",
        error: err.message,
      });
      manifest.warnings.push(`${op.slug}: fetch/parse error — ${err.message}`);
    }

    await sleep(DELAY_MS);
  }

  // Write manifest and index
  writeFileSync(
    join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );
  writeFileSync(
    join(OUT_DIR, "index.json"),
    JSON.stringify(index, null, 2),
    "utf-8",
  );

  // Summary
  const ok = manifest.operators.filter((o) => o.status === "ok").length;
  const partial = manifest.operators.filter((o) => o.status === "partial").length;
  const errors = manifest.operators.filter((o) => o.status === "error").length;
  console.log(`\n=== Done ===`);
  console.log(`Total: ${manifest.total}`);
  console.log(`OK: ${ok}, Partial: ${partial}, Errors: ${errors}`);
  console.log(`Warnings: ${manifest.warnings.length}`);
  console.log(`Output: ${OUT_DIR}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
