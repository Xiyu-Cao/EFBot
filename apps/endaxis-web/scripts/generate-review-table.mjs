/**
 * Generate human-reviewable table of all needs_review skill mapping entries.
 *
 * Usage: node scripts/generate-review-table.mjs
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";

const MAPPED_DIR = join(import.meta.dirname, "../src/external-data/warfarin-wiki/operators/mapped-skills");
const EXTRACTED_DIR = join(import.meta.dirname, "../src/external-data/warfarin-wiki/operators/extracted-skills");
const OUT_DIR = join(import.meta.dirname, "../src/external-data/warfarin-wiki/operators/review-tables");
mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Suspected category heuristics
// ---------------------------------------------------------------------------

function guessSuspectedCategory(label, skillType, classification) {
  if (/处决/.test(label)) return "execution_attack — separate hit type, not part of normal combo";
  if (/下落/.test(label)) return "fall_attack — aerial hit, separate from ground combo";
  if (/追加.*倍率/.test(label)) return "conditional_extra_hit — triggered by specific condition (e.g. crystal, stack)";
  if (/额外.*倍率/.test(label)) return "conditional_extra_hit — extra damage on specific condition";
  if (/击碎结晶/.test(label)) return "conditional_extra_hit — crystal consumption bonus damage";
  if (/消耗每层附着/.test(label)) return "per_stack_extra — scales with attachment stacks, conditional";
  if (/强化.*倍率/.test(label)) return "enhanced_variant — upgraded version of base hit, condition-dependent";
  if (/终结技期间/.test(label)) return "ult_phase_skill_variant — skill multiplier changes during ultimate, separate context";
  if (/强化普攻/.test(label)) return "ult_enhanced_normal — normal attack override during ultimate phase";
  if (/幻影追击/.test(label)) return "phantom_chase — character-specific extra hit mechanic";
  if (/空中连斩/.test(label)) return "aerial_combo — aerial attack variant, separate hit context";
  if (/对.*冻结.*敌人/.test(label)) return "conditional_damage_branch — different multiplier based on target state";
  if (/对非.*敌人/.test(label)) return "conditional_damage_branch — different multiplier for un-debuffed target";
  if (/施加冻结/.test(label)) return "conditional_extra_hit — bonus damage when applying freeze";
  if (/强力攻击/.test(label)) return "ult_heavy_hit — heavy attack during ultimate, separate hit type";
  if (/额外攻击/.test(label)) return "ult_extra_attack — extra attack during ultimate phase";
  if (/提前降下/.test(label)) return "early_trigger_variant — variant damage for early activation";
  if (/强雷枪/.test(label)) return "enhanced_variant — upgraded weapon skill, condition-dependent";
  if (/水龙卷.*脆弱/.test(label)) return "status_value_conditional — fragility value based on count, not damage";
  if (/智识提升增幅上限/.test(label)) return "stat_scaling_cap — amplification cap, status value not damage";
  return "unclear — needs human review to determine category";
}

function assignPriority(label, classification, skillType) {
  // High: things that look most like real damage multipliers that could be missed
  if (/终结技期间.*倍率|强化普攻.*倍率/.test(label)) return "high";
  if (/追加.*倍率|额外.*倍率/.test(label) && skillType !== "normalAttack") return "high";
  if (/击碎结晶|消耗每层附着额外伤害/.test(label)) return "high";
  if (/幻影追击|空中连斩/.test(label)) return "high";
  if (/对.*冻结.*敌人|对非.*敌人/.test(label)) return "high";
  if (/施加冻结伤害|强化伤害|强力攻击|额外攻击/.test(label)) return "high";
  if (/强化第.*段伤害|提前降下/.test(label)) return "medium";
  if (/强雷枪/.test(label)) return "medium";
  // Medium: execution/fall are universal, clear semantics, less urgent
  if (/处决/.test(label)) return "medium";
  if (/下落/.test(label)) return "low";
  // Low: status-like values that leaked into needs_review
  if (/脆弱|增幅上限/.test(label)) return "low";
  return "medium";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const files = readdirSync(MAPPED_DIR).filter(f => f.endsWith(".json"));
const reviewItems = [];

for (const file of files) {
  const mapped = JSON.parse(readFileSync(join(MAPPED_DIR, file), "utf8"));
  const extracted = JSON.parse(readFileSync(join(EXTRACTED_DIR, file), "utf8"));

  for (const [typeKey, skill] of Object.entries(mapped.skills)) {
    for (const rm of skill.rowMappings) {
      if (rm.includeInSkillMultiplier !== "needs_review") continue;

      // Get values from extracted skill levels
      const exSkill = extracted.skills[typeKey];
      const valuesByLevel = {};
      let m3Value = null;
      if (exSkill) {
        for (const [lvl, data] of Object.entries(exSkill.levels)) {
          const v = data.rows[rm.label];
          if (v !== undefined) valuesByLevel[lvl] = v;
        }
        m3Value = valuesByLevel["M3"] || null;
      }

      reviewItems.push({
        characterId: mapped.id,
        characterSlug: mapped.slug,
        skillType: skill.type,
        skillTypeKey: typeKey,
        skillName: skill.name,
        label: rm.label,
        classification: rm.classification,
        includeInSkillMultiplier: rm.includeInSkillMultiplier,
        suggestedTickGroup: rm.suggestedTickGroup,
        m3Value,
        valuesByLevel,
        suspectedCategory: guessSuspectedCategory(rm.label, typeKey, rm.classification),
        reviewPriority: assignPriority(rm.label, rm.classification, typeKey),
        notes: "",
      });
    }
  }
}

// Sort by priority then character
const priorityOrder = { high: 0, medium: 1, low: 2 };
reviewItems.sort((a, b) => {
  const p = priorityOrder[a.reviewPriority] - priorityOrder[b.reviewPriority];
  if (p !== 0) return p;
  return a.characterId.localeCompare(b.characterId);
});

// --- Write JSON ---
writeFileSync(
  join(OUT_DIR, "skill-mapping-needs-review.json"),
  JSON.stringify(reviewItems, null, 2),
  "utf8",
);

// --- Write Markdown ---
let md = `# Skill Mapping — Needs Review\n\n`;
md += `> Generated: ${new Date().toISOString()}\n`;
md += `> Total items: ${reviewItems.length}\n\n`;

// Summary tables
const byPriority = { high: 0, medium: 0, low: 0 };
const byOp = {};
const bySkillType = {};
const byKeyword = {};
for (const item of reviewItems) {
  byPriority[item.reviewPriority]++;
  byOp[item.characterId] = (byOp[item.characterId] || 0) + 1;
  bySkillType[item.skillTypeKey] = (bySkillType[item.skillTypeKey] || 0) + 1;
  // keyword extraction
  for (const kw of ["处决", "下落", "追加", "强化", "终结技期间", "额外", "条件", "幻影", "冻结", "结晶", "脆弱", "空中"]) {
    if (item.label.includes(kw)) {
      byKeyword[kw] = (byKeyword[kw] || 0) + 1;
    }
  }
}

md += `## Summary\n\n`;
md += `| Priority | Count |\n|---|---|\n`;
for (const [k, v] of Object.entries(byPriority)) md += `| ${k} | ${v} |\n`;

md += `\n| Skill Type | Count |\n|---|---|\n`;
for (const [k, v] of Object.entries(bySkillType).sort((a, b) => b[1] - a[1])) md += `| ${k} | ${v} |\n`;

md += `\n| Keyword | Count |\n|---|---|\n`;
for (const [k, v] of Object.entries(byKeyword).sort((a, b) => b[1] - a[1])) md += `| ${k} | ${v} |\n`;

md += `\n| Operator | Count |\n|---|---|\n`;
for (const [k, v] of Object.entries(byOp).sort((a, b) => b[1] - a[1])) md += `| ${k} | ${v} |\n`;

// Detail table
md += `\n---\n\n## Review Items\n\n`;
md += `| # | Priority | Operator | Skill | Label | M3 | Suspected Category | Tick Group |\n`;
md += `|---|---|---|---|---|---|---|---|\n`;
reviewItems.forEach((item, i) => {
  md += `| ${i + 1} | ${item.reviewPriority} | ${item.characterId} | ${item.skillTypeKey}:${item.skillName} | ${item.label} | ${item.m3Value || "—"} | ${item.suspectedCategory.split(" — ")[0]} | ${item.suggestedTickGroup || "—"} |\n`;
});

writeFileSync(join(OUT_DIR, "skill-mapping-needs-review.md"), md, "utf8");

// --- Console report ---
console.log("=== Review Table Generated ===\n");
console.log(`Total items: ${reviewItems.length}`);
console.log(`  high:   ${byPriority.high}`);
console.log(`  medium: ${byPriority.medium}`);
console.log(`  low:    ${byPriority.low}`);

console.log("\n--- Top 5 operators by review count ---");
const topOps = Object.entries(byOp).sort((a, b) => b[1] - a[1]).slice(0, 5);
for (const [opId, count] of topOps) {
  console.log(`\n  ${opId} (${count} items):`);
  const opItems = reviewItems.filter(i => i.characterId === opId);
  const top3 = opItems.sort((a, b) => priorityOrder[a.reviewPriority] - priorityOrder[b.reviewPriority]).slice(0, 3);
  for (const item of top3) {
    console.log(`    [${item.reviewPriority}] ${item.skillTypeKey}: ${item.label} = ${item.m3Value || "?"}`);
    console.log(`         → ${item.suspectedCategory.split(" — ")[0]}`);
  }
}

console.log(`\nOutput: ${OUT_DIR}`);
