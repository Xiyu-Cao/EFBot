/**
 * Generate wiki-row → existing-hit candidate mapping.
 *
 * Usage: node scripts/generate-hit-mapping.mjs
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";

const MAPPED_DIR = join(import.meta.dirname, "../src/external-data/warfarin-wiki/operators/mapped-skills");
const EXTRACTED_DIR = join(import.meta.dirname, "../src/external-data/warfarin-wiki/operators/extracted-skills");
const OUT_DIR = join(import.meta.dirname, "../src/external-data/warfarin-wiki/operators/hit-mapping");
const REVIEW_DIR = join(import.meta.dirname, "../src/external-data/warfarin-wiki/operators/review-tables");
mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Gamedata tick counts
// ---------------------------------------------------------------------------

const gd = JSON.parse(readFileSync(join(import.meta.dirname, "../public/gamedata.json"), "utf8"));
const gdChars = {};
for (const c of gd.characterRoster) {
  gdChars[c.id] = {
    skill: c.skill_damage_ticks?.length || 0,
    link: c.link_damage_ticks?.length || 0,
    ultimate: c.ultimate_damage_ticks?.length || 0,
  };
}

// Wiki ID → gamedata ID mapping
const WIKI_TO_GD = {
  CHEN_QIANYU: "CHENQIANYU",
  DA_PAN: "DAPAN",
  LAST_RITE: "LASTRITE",
  POGRANICHNIK: "POGRANICHNK",
};
function toGdId(wikiId) {
  return WIKI_TO_GD[wikiId] || wikiId;
}

// ---------------------------------------------------------------------------
// Hit mapping logic
// ---------------------------------------------------------------------------

const BASE_DAMAGE_CLASSES = new Set([
  "base_damage_candidate",
  "multi_hit_damage_candidate",
  "finisher_damage_candidate",
]);

function mapRows(mappedSkill, skillTypeKey, gdTickCount) {
  const { rowMappings, levels } = mappedSkill;
  const results = [];

  // Separate rows by classification
  const baseDamageRows = [];
  const extraRows = [];
  const excludeRows = [];

  for (const rm of rowMappings) {
    if (rm.includeInSkillMultiplier === true && BASE_DAMAGE_CLASSES.has(rm.classification)) {
      baseDamageRows.push(rm);
    } else if (rm.includeInSkillMultiplier === "needs_review" || rm.classification === "extra_damage_candidate") {
      extraRows.push(rm);
    } else if (rm.includeInSkillMultiplier === false) {
      excludeRows.push(rm);
    } else {
      extraRows.push(rm);
    }
  }

  // Try to align base damage rows to gamedata ticks
  const tickAligned = baseDamageRows.length === gdTickCount;
  const tickCountInfo = `wiki_base_rows=${baseDamageRows.length}, gd_ticks=${gdTickCount}`;

  for (let i = 0; i < baseDamageRows.length; i++) {
    const rm = baseDamageRows[i];
    const m3Val = getM3(rm.label, levels);
    let mappedTarget, confidence;

    if (tickAligned) {
      mappedTarget = `tick_${i}`;
      confidence = "high";
    } else if (gdTickCount === 1 && baseDamageRows.length === 1) {
      mappedTarget = "tick_0";
      confidence = "high";
    } else if (gdTickCount > 0) {
      mappedTarget = i < gdTickCount ? `tick_${i}` : "overflow_needs_mapping";
      confidence = i < gdTickCount ? "medium" : "low";
    } else {
      mappedTarget = `candidate_hit_${i}`;
      confidence = "low";
    }

    results.push({
      label: rm.label,
      classification: rm.classification,
      mappedTarget,
      mappingConfidence: confidence,
      m3Value: m3Val,
      category: "default_body_hit",
      notes: tickAligned
        ? `Aligned to gamedata tick ${i} (${tickCountInfo})`
        : `Tick count mismatch (${tickCountInfo}); best-effort assignment`,
    });
  }

  // Extra / conditional rows
  for (const rm of extraRows) {
    const m3Val = getM3(rm.label, levels);
    const cat = categorizeExtra(rm);
    results.push({
      label: rm.label,
      classification: rm.classification,
      mappedTarget: cat.target,
      mappingConfidence: cat.confidence,
      m3Value: m3Val,
      category: cat.category,
      notes: cat.notes,
    });
  }

  // Excluded rows
  for (const rm of excludeRows) {
    const m3Val = getM3(rm.label, levels);
    results.push({
      label: rm.label,
      classification: rm.classification,
      mappedTarget: "not_runtime_multiplier",
      mappingConfidence: "high",
      m3Value: m3Val,
      category: "excluded",
      notes: `${rm.classification}: not a damage multiplier`,
    });
  }

  return results;
}

function getM3(label, levels) {
  return levels?.["M3"]?.rows?.[label] || null;
}

function categorizeExtra(rm) {
  const l = rm.label;
  if (/处决/.test(l)) return { target: "conditional_extra", confidence: "high", category: "execution_attack", notes: "Execution attack — separate hit type, not default combo" };
  if (/下落/.test(l)) return { target: "conditional_extra", confidence: "high", category: "fall_attack", notes: "Fall/aerial attack — separate hit type, not default combo" };
  if (/追加.*倍率/.test(l)) return { target: "conditional_extra", confidence: "medium", category: "conditional_extra_hit", notes: "Extra hit triggered by condition; not default multiplier" };
  if (/额外.*倍率/.test(l)) return { target: "conditional_extra", confidence: "medium", category: "conditional_extra_hit", notes: "Extra damage on condition; not default multiplier" };
  if (/击碎结晶/.test(l)) return { target: "conditional_extra", confidence: "medium", category: "conditional_extra_hit", notes: "Crystal shatter bonus — conditional" };
  if (/消耗每层附着/.test(l)) return { target: "conditional_extra", confidence: "medium", category: "per_stack_extra", notes: "Per-stack consumption damage — conditional, scales with stacks" };
  if (/强化.*段伤害/.test(l)) return { target: "special_branch", confidence: "medium", category: "enhanced_variant", notes: "Enhanced hit variant — condition-dependent, not default" };
  if (/终结技期间.*倍率/.test(l)) return { target: "special_branch", confidence: "medium", category: "ult_phase_override", notes: "Skill multiplier changes during ultimate phase — separate context" };
  if (/强化普攻.*段/.test(l)) return { target: "special_branch", confidence: "medium", category: "ult_enhanced_normal", notes: "Normal attack override during ult — separate tick set" };
  if (/幻影追击/.test(l)) return { target: "conditional_extra", confidence: "medium", category: "character_specific_extra", notes: "Character-specific extra hit mechanic" };
  if (/空中连斩/.test(l)) return { target: "conditional_extra", confidence: "medium", category: "aerial_combo", notes: "Aerial combo — separate hit context" };
  if (/对.*冻结.*敌人|对非.*敌人/.test(l)) return { target: "special_branch", confidence: "medium", category: "conditional_branch", notes: "Damage branch based on target state — need to confirm which is default" };
  if (/施加冻结伤害/.test(l)) return { target: "conditional_extra", confidence: "medium", category: "conditional_extra_hit", notes: "Bonus damage when applying freeze" };
  if (/强力攻击/.test(l)) return { target: "special_branch", confidence: "medium", category: "ult_heavy_hit", notes: "Heavy attack during ult phase — separate hit type" };
  if (/额外攻击/.test(l)) return { target: "special_branch", confidence: "medium", category: "ult_extra_attack", notes: "Extra attack during ult — separate hit" };
  if (/提前降下/.test(l)) return { target: "special_branch", confidence: "medium", category: "early_trigger_variant", notes: "Variant for early activation" };
  if (/强雷枪/.test(l)) return { target: "special_branch", confidence: "medium", category: "enhanced_variant", notes: "Enhanced weapon skill — condition-dependent" };
  if (/脆弱/.test(l)) return { target: "not_runtime_multiplier", confidence: "high", category: "excluded", notes: "Fragility value, not damage" };
  if (/增幅上限/.test(l)) return { target: "not_runtime_multiplier", confidence: "high", category: "excluded", notes: "Amplification cap, not damage" };
  return { target: "needs_manual_mapping", confidence: "low", category: "unknown", notes: "Cannot auto-classify; needs human review" };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const files = readdirSync(MAPPED_DIR).filter(f => f.endsWith(".json"));
const allMappings = [];
const summary = { total_rows: 0, by_category: {}, by_confidence: {}, by_operator: {}, operators: [] };

for (const file of files) {
  const mapped = JSON.parse(readFileSync(join(MAPPED_DIR, file), "utf8"));
  const extracted = JSON.parse(readFileSync(join(EXTRACTED_DIR, file), "utf8"));
  const gdId = toGdId(mapped.id);
  const gdTicks = gdChars[gdId] || { skill: 0, link: 0, ultimate: 0 };

  const result = { id: mapped.id, gdId, slug: mapped.slug, skills: {} };
  const opStats = { id: mapped.id, total: 0, categories: {}, confidences: {}, needsManual: 0 };

  for (const [typeKey, skill] of Object.entries(mapped.skills)) {
    const gdCount = typeKey === "normalAttack" ? 0 : (gdTicks[typeKey] || 0);
    const rows = mapRows(skill, typeKey, gdCount);

    result.skills[typeKey] = {
      name: skill.name,
      type: skill.type,
      gdTickCount: gdCount,
      mappings: rows,
    };

    for (const r of rows) {
      summary.total_rows++;
      opStats.total++;
      summary.by_category[r.category] = (summary.by_category[r.category] || 0) + 1;
      opStats.categories[r.category] = (opStats.categories[r.category] || 0) + 1;
      summary.by_confidence[r.mappingConfidence] = (summary.by_confidence[r.mappingConfidence] || 0) + 1;
      opStats.confidences[r.mappingConfidence] = (opStats.confidences[r.mappingConfidence] || 0) + 1;
      if (r.mappedTarget === "needs_manual_mapping") opStats.needsManual++;

      allMappings.push({ characterId: mapped.id, skillTypeKey: typeKey, skillName: skill.name, ...r });
    }
  }

  summary.by_operator[mapped.id] = opStats.total;
  summary.operators.push(opStats);

  writeFileSync(join(OUT_DIR, `${mapped.slug}.json`), JSON.stringify(result, null, 2), "utf8");
}

// Sort operators by complexity
summary.operators.sort((a, b) => {
  const aComp = (a.categories.conditional_extra_hit || 0) + (a.categories.ult_phase_override || 0) + (a.categories.ult_enhanced_normal || 0) + (a.categories.conditional_branch || 0) + a.needsManual;
  const bComp = (b.categories.conditional_extra_hit || 0) + (b.categories.ult_phase_override || 0) + (b.categories.ult_enhanced_normal || 0) + (b.categories.conditional_branch || 0) + b.needsManual;
  return bComp - aComp;
});

writeFileSync(join(OUT_DIR, "_summary.json"), JSON.stringify(summary, null, 2), "utf8");

// ---------------------------------------------------------------------------
// Generate skills-needing-second-pass.md
// ---------------------------------------------------------------------------

const secondPass = [];
for (const m of allMappings) {
  if (["conditional_extra", "special_branch", "needs_manual_mapping"].includes(m.mappedTarget)) {
    secondPass.push(m);
  }
}

// Group by character + skill
const grouped = new Map();
for (const item of secondPass) {
  const key = `${item.characterId}::${item.skillTypeKey}::${item.skillName}`;
  if (!grouped.has(key)) grouped.set(key, { characterId: item.characterId, skillTypeKey: item.skillTypeKey, skillName: item.skillName, items: [] });
  grouped.get(key).items.push(item);
}

let md = `# Skills Needing Second Pass Review\n\n`;
md += `> Generated: ${new Date().toISOString()}\n`;
md += `> Total skills with conditional/extra rows: ${grouped.size}\n`;
md += `> Total rows needing review: ${secondPass.length}\n\n`;

md += `## Priority Guide\n\n`;
md += `- **Critical**: Skills with conditional branches that change the default multiplier\n`;
md += `- **Important**: Skills with ult-phase overrides or enhanced variants\n`;
md += `- **Standard**: Universal execution/fall attacks (24 operators, same pattern)\n\n`;
md += `---\n\n`;

// Separate universal (execution/fall on normalAttack) from character-specific
const universal = [];
const specific = [];
for (const [, group] of grouped) {
  if (group.skillTypeKey === "normalAttack" && group.items.every(i => ["execution_attack", "fall_attack"].includes(i.category))) {
    universal.push(group);
  } else {
    specific.push(group);
  }
}

md += `## Character-Specific Skills (${specific.length} skills)\n\n`;
md += `These need individual human review.\n\n`;

for (const group of specific) {
  md += `### ${group.characterId} — ${group.skillTypeKey}: ${group.skillName}\n\n`;
  const cats = [...new Set(group.items.map(i => i.category))];
  md += `**Categories**: ${cats.join(", ")}\n\n`;

  // Why needs review
  const reasons = [];
  if (group.items.some(i => i.category === "conditional_branch")) reasons.push("Has conditional damage branches (different multipliers based on target state)");
  if (group.items.some(i => i.category === "ult_phase_override")) reasons.push("Skill multipliers change during ultimate phase");
  if (group.items.some(i => i.category === "ult_enhanced_normal")) reasons.push("Normal attacks are overridden during ultimate");
  if (group.items.some(i => i.category === "conditional_extra_hit")) reasons.push("Extra hits triggered by specific conditions");
  if (group.items.some(i => i.category === "per_stack_extra")) reasons.push("Damage scales with attachment stacks");
  if (group.items.some(i => i.category === "enhanced_variant")) reasons.push("Enhanced variant of base hit, condition-dependent");
  if (group.items.some(i => i.category === "character_specific_extra")) reasons.push("Character-specific extra hit mechanic");
  if (group.items.some(i => i.category === "ult_heavy_hit" || i.category === "ult_extra_attack")) reasons.push("Separate hit type during ultimate phase");
  if (reasons.length === 0) reasons.push("Needs classification confirmation");

  md += `**Why**: ${reasons.join("; ")}\n\n`;
  md += `| Label | M3 | Category | Target | Confidence |\n`;
  md += `|---|---|---|---|---|\n`;
  for (const item of group.items) {
    md += `| ${item.label} | ${item.m3Value || "—"} | ${item.category} | ${item.mappedTarget} | ${item.mappingConfidence} |\n`;
  }
  md += `\n**Suggested review**: ${reasons[0]}\n\n`;
}

md += `---\n\n## Universal Normal Attack Extras (${universal.length} operators)\n\n`;
md += `All operators have 处決攻撃倍率 and 下落攻撃倍率 on normal attack.\n`;
md += `These are separate hit types, not part of the default 5-hit combo.\n\n`;
md += `| Operator | 処決 M3 | 下落 M3 |\n`;
md += `|---|---|---|\n`;
for (const group of universal) {
  const exec = group.items.find(i => i.category === "execution_attack");
  const fall = group.items.find(i => i.category === "fall_attack");
  md += `| ${group.characterId} | ${exec?.m3Value || "—"} | ${fall?.m3Value || "—"} |\n`;
}

writeFileSync(join(REVIEW_DIR, "skills-needing-second-pass.md"), md, "utf8");

// ---------------------------------------------------------------------------
// Console report
// ---------------------------------------------------------------------------

console.log("=== Hit Mapping Report ===\n");
console.log(`Total rows: ${summary.total_rows}`);
console.log("\nBy category:");
for (const [k, v] of Object.entries(summary.by_category).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(30)} ${v}`);
}
console.log("\nBy confidence:");
for (const [k, v] of Object.entries(summary.by_confidence).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${v}`);
}

console.log("\n--- Top 5 most complex operators ---");
for (const op of summary.operators.slice(0, 5)) {
  const cats = Object.entries(op.categories).filter(([k]) => k !== "excluded" && k !== "default_body_hit").map(([k, v]) => `${k}=${v}`).join(", ");
  console.log(`  ${op.id}: ${cats || "none"}`);
}

console.log("\n--- Top 10 skills for priority review ---");
const prioritySkills = [...specific].sort((a, b) => b.items.length - a.items.length).slice(0, 10);
for (const s of prioritySkills) {
  console.log(`  ${s.characterId} ${s.skillTypeKey}:${s.skillName} — ${s.items.length} conditional rows`);
  for (const i of s.items.slice(0, 3)) {
    console.log(`    ${i.label} = ${i.m3Value || "?"} → ${i.category}`);
  }
}

console.log(`\nOutput: ${OUT_DIR}`);
console.log(`Second pass: ${join(REVIEW_DIR, "skills-needing-second-pass.md")}`);
