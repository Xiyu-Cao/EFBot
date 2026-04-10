/**
 * Extract skill tables from normalized warfarin-wiki data
 * into a clean "extracted-skills" intermediate layer.
 *
 * Usage: node scripts/extract-skills.mjs
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";

const NORM_DIR = join(
  import.meta.dirname,
  "../src/external-data/warfarin-wiki/operators/normalized",
);
const OUT_DIR = join(
  import.meta.dirname,
  "../src/external-data/warfarin-wiki/operators/extracted-skills",
);
mkdirSync(OUT_DIR, { recursive: true });

const TYPE_MAP = {
  "普通攻击": "normalAttack",
  "战技": "skill",
  "连携技": "link",
  "终结技": "ultimate",
};

function pivotSkill(skill) {
  const { level_headers, data_rows } = skill;
  const levels = {};

  for (let i = 0; i < level_headers.length; i++) {
    const key = level_headers[i];
    const rows = {};
    for (const row of data_rows) {
      if (i < row.values.length) {
        rows[row.label] = row.values[i];
      }
    }
    levels[key] = { rows };
  }

  return {
    name: skill.name,
    type: skill.type,
    type_key: TYPE_MAP[skill.type] || skill.type,
    level_headers,
    row_labels: data_rows.map((r) => r.label),
    levels,
  };
}

// --- Main ---

const files = readdirSync(NORM_DIR).filter((f) => f.endsWith(".json"));
const summary = [];
const warnings = [];

for (const file of files) {
  const data = JSON.parse(readFileSync(join(NORM_DIR, file), "utf8"));
  const { id, slug, skills, source } = data;

  const extracted = {
    id,
    slug,
    skills: {},
    _skill_count: 0,
    source: {
      ...source,
      extracted_at: new Date().toISOString(),
    },
  };

  const opWarnings = [];

  for (const skill of skills) {
    const typeKey = TYPE_MAP[skill.type];
    if (!typeKey) {
      opWarnings.push(`unknown skill type: ${skill.type} (${skill.name})`);
      continue;
    }

    if (extracted.skills[typeKey]) {
      opWarnings.push(`duplicate skill type: ${typeKey} (${skill.name})`);
    }

    if (skill.data_rows.length === 0) {
      opWarnings.push(`${typeKey}: no data rows`);
    }

    if (skill.level_headers.length !== 12) {
      opWarnings.push(
        `${typeKey}: expected 12 level headers, got ${skill.level_headers.length}`,
      );
    }

    extracted.skills[typeKey] = pivotSkill(skill);
    extracted._skill_count++;
  }

  writeFileSync(
    join(OUT_DIR, `${slug}.json`),
    JSON.stringify(extracted, null, 2),
    "utf8",
  );

  summary.push({
    id,
    slug,
    skill_count: extracted._skill_count,
    skill_types: Object.keys(extracted.skills),
    warnings: opWarnings,
  });

  if (opWarnings.length > 0) {
    warnings.push(...opWarnings.map((w) => `${id}: ${w}`));
  }
}

// Write summary
writeFileSync(
  join(OUT_DIR, "_summary.json"),
  JSON.stringify(
    {
      total: summary.length,
      extracted_at: new Date().toISOString(),
      operators: summary,
      warnings,
    },
    null,
    2,
  ),
  "utf8",
);

// --- Console report ---
console.log("=== Skill Extraction Report ===\n");
console.log(`Total operators: ${summary.length}`);
console.log(
  `All 4 skills: ${summary.filter((s) => s.skill_count === 4).length}`,
);
console.log(`Warnings: ${warnings.length}`);
if (warnings.length > 0) {
  warnings.forEach((w) => console.log(`  WARN: ${w}`));
}

console.log("\n--- Per-operator ---");
for (const s of summary) {
  const w = s.warnings.length > 0 ? ` [${s.warnings.length} warn]` : "";
  console.log(
    `  ${s.id.padEnd(20)} ${s.skill_count} skills: ${s.skill_types.join(", ")}${w}`,
  );
}

// --- Spot check: M3 values for 5 operators ---
const spotCheck = ["endministrator", "gilberta", "laevatain", "chen-qianyu", "pogranichnik"];
console.log("\n--- Spot Check: M3 Level ---");
for (const slug of spotCheck) {
  const d = JSON.parse(readFileSync(join(OUT_DIR, `${slug}.json`), "utf8"));
  console.log(`\n  ${d.id} (${d.slug}):`);
  for (const [key, skill] of Object.entries(d.skills)) {
    const m3 = skill.levels["M3"];
    if (!m3) {
      console.log(`    ${key}: no M3 data`);
      continue;
    }
    const entries = Object.entries(m3.rows)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    console.log(`    ${key} (${skill.name}): ${entries}`);
  }
}

console.log(`\nOutput: ${OUT_DIR}`);
