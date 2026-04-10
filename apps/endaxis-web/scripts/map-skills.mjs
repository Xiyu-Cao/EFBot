/**
 * Generate "mapped-skills" — classify each wiki row label
 * into damage candidate / status / resource / etc.
 *
 * Usage: node scripts/map-skills.mjs
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";

const IN_DIR = join(
  import.meta.dirname,
  "../src/external-data/warfarin-wiki/operators/extracted-skills",
);
const OUT_DIR = join(
  import.meta.dirname,
  "../src/external-data/warfarin-wiki/operators/mapped-skills",
);
mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Classification rules (ordered: first match wins)
// ---------------------------------------------------------------------------

const RULES = [
  // --- Cooldown / cost ---
  { pattern: /^冷却时间/, cls: "cooldown_or_cost", include: false, tick: null },
  { pattern: /^所需终结技能量/, cls: "cooldown_or_cost", include: false, tick: null },

  // --- Stagger / break ---
  { pattern: /失衡值/, cls: "stagger_or_break_value", include: false, tick: null },

  // --- Resource gain ---
  { pattern: /恢复技力|返还技力|技力恢复|技力返还/, cls: "resource_gain", include: false, tick: null },
  { pattern: /获得终结技能量|终结技能量/, cls: "resource_gain", include: false, tick: null },
  { pattern: /技力恢复上限/, cls: "resource_gain", include: false, tick: null },

  // --- Status duration ---
  { pattern: /持续时间|时长（秒）|存在时间/, cls: "status_duration", include: false, tick: null },
  { pattern: /封印时间/, cls: "status_duration", include: false, tick: null },

  // --- Status / buff / debuff values ---
  { pattern: /脆弱效果|脆弱倍率|脆弱持续/, cls: "status_value", include: false, tick: null },
  { pattern: /增幅效果|增幅持续/, cls: "status_value", include: false, tick: null },
  { pattern: /虚弱效果|虚弱持续/, cls: "status_value", include: false, tick: null },
  { pattern: /缓速效果/, cls: "status_value", include: false, tick: null },
  { pattern: /庇护效果/, cls: "status_value", include: false, tick: null },
  { pattern: /护盾/, cls: "status_value", include: false, tick: null },
  { pattern: /治疗/, cls: "status_value", include: false, tick: null },
  { pattern: /概率/, cls: "status_value", include: false, tick: null },
  { pattern: /连击持续/, cls: "status_value", include: false, tick: null },
  { pattern: /导电时长/, cls: "status_duration", include: false, tick: null },
  { pattern: /腐蚀持续/, cls: "status_duration", include: false, tick: null },
  { pattern: /每点意志/, cls: "status_value", include: false, tick: null },
  { pattern: /每点防御力/, cls: "status_value", include: false, tick: null },
  { pattern: /每点智识/, cls: "status_value", include: false, tick: null },
  { pattern: /每层暴击率|满层暴击伤害|最大叠加层数/, cls: "status_value", include: false, tick: null },
  { pattern: /每层破防提升/, cls: "status_value", include: false, tick: null },
  { pattern: /浮空时间/, cls: "status_duration", include: false, tick: null },
  { pattern: /施加冻结获得/, cls: "resource_gain", include: false, tick: null },
  { pattern: /额外获得终结技能量/, cls: "resource_gain", include: false, tick: null },
  { pattern: /基础获得终结技能量/, cls: "resource_gain", include: false, tick: null },
  { pattern: /持续治疗间隔|持续伤害间隔/, cls: "status_duration", include: false, tick: null },
  { pattern: /每处涡流技力/, cls: "resource_gain", include: false, tick: null },
  { pattern: /法术脆弱持续/, cls: "status_duration", include: false, tick: null },
  { pattern: /涡流持续|古老图形持续/, cls: "status_duration", include: false, tick: null },
  { pattern: /法术增幅效果|法术增幅持续|支援晶体持续/, cls: "status_value", include: false, tick: null },
  { pattern: /护盾转化比例/, cls: "status_value", include: false, tick: null },
  { pattern: /铁誓持续/, cls: "status_duration", include: false, tick: null },
  { pattern: /战技范围提升|战技伤害提升/, cls: "status_value", include: false, tick: null },
  { pattern: /猛击伤害额外提升/, cls: "status_value", include: false, tick: null },
  { pattern: /消耗每层附着额外获得/, cls: "resource_gain", include: false, tick: null },
  { pattern: /施放能量次数/, cls: "status_value", include: false, tick: null },

  // --- Normal attack hits (base damage) ---
  { pattern: /^普攻第(\S+)段倍率$/, cls: "base_damage_candidate", include: true, tick: (m) => `normal_hit_${m[1]}` },

  // --- Execution / finisher ---
  { pattern: /^处决攻击倍率/, cls: "finisher_damage_candidate", include: "needs_review", tick: () => "execution" },
  { pattern: /^下落攻击倍率/, cls: "extra_damage_candidate", include: "needs_review", tick: () => "fall_attack" },
  { pattern: /^终结一击/, cls: "finisher_damage_candidate", include: true, tick: () => "finisher" },
  { pattern: /^终结伤害倍率/, cls: "finisher_damage_candidate", include: true, tick: () => "finisher" },

  // --- Multi-hit numbered damage ---
  { pattern: /^第(\S+)段伤害倍率$/, cls: "multi_hit_damage_candidate", include: true, tick: (m) => `hit_${m[1]}` },
  { pattern: /^斩击伤害倍率/, cls: "base_damage_candidate", include: true, tick: () => "slash" },
  { pattern: /^斩击基础伤害倍率/, cls: "base_damage_candidate", include: true, tick: () => "slash_base" },
  { pattern: /^空中连斩伤害倍率/, cls: "extra_damage_candidate", include: "needs_review", tick: () => "aerial_combo" },

  // --- Generic damage multiplier (single "伤害倍率") ---
  { pattern: /^伤害倍率$/, cls: "base_damage_candidate", include: true, tick: () => "main" },

  // --- Named damage variants (extra/conditional) ---
  { pattern: /^爆炸伤害倍率/, cls: "base_damage_candidate", include: true, tick: () => "explosion" },
  { pattern: /^牵引伤害倍率/, cls: "base_damage_candidate", include: true, tick: () => "pull" },
  { pattern: /^射击伤害倍率/, cls: "base_damage_candidate", include: true, tick: () => "shot" },
  { pattern: /^雷枪伤害倍率/, cls: "base_damage_candidate", include: true, tick: () => "thunder_lance" },
  { pattern: /^强雷枪伤害倍率/, cls: "extra_damage_candidate", include: "needs_review", tick: () => "strong_thunder_lance" },
  { pattern: /^冰刺伤害倍率/, cls: "base_damage_candidate", include: true, tick: () => "ice_spike" },
  { pattern: /^每段伤害倍率/, cls: "base_damage_candidate", include: true, tick: () => "per_hit" },
  { pattern: /^单个水龙卷伤害倍率/, cls: "base_damage_candidate", include: true, tick: () => "waterspout" },
  { pattern: /^巨浪伤害倍率/, cls: "base_damage_candidate", include: true, tick: () => "wave" },
  { pattern: /^提前降下巨浪伤害倍率/, cls: "extra_damage_candidate", include: "needs_review", tick: () => "early_wave" },
  { pattern: /^能量伤害倍率/, cls: "base_damage_candidate", include: true, tick: () => "energy" },
  { pattern: /^普通攻击伤害倍率/, cls: "base_damage_candidate", include: true, tick: () => "ult_normal_hit" },
  { pattern: /^强力攻击伤害倍率/, cls: "extra_damage_candidate", include: "needs_review", tick: () => "ult_heavy_hit" },
  { pattern: /^持续伤害倍率/, cls: "anomaly_or_reaction_damage", include: false, tick: () => "dot" },
  { pattern: /^持续伤害总倍率/, cls: "anomaly_or_reaction_damage", include: false, tick: () => "dot_total" },
  { pattern: /^持续伤害每段倍率/, cls: "anomaly_or_reaction_damage", include: false, tick: () => "dot_per_tick" },

  // --- Extra / conditional damage (needs_review) ---
  { pattern: /^追加伤害倍率/, cls: "extra_damage_candidate", include: "needs_review", tick: () => "extra" },
  { pattern: /^额外伤害倍率/, cls: "extra_damage_candidate", include: "needs_review", tick: () => "extra" },
  { pattern: /^额外攻击伤害倍率/, cls: "extra_damage_candidate", include: "needs_review", tick: () => "extra_attack" },
  { pattern: /^击碎结晶伤害倍率/, cls: "extra_damage_candidate", include: "needs_review", tick: () => "crystal_shatter" },
  { pattern: /^强化伤害倍率/, cls: "extra_damage_candidate", include: "needs_review", tick: () => "enhanced" },
  { pattern: /^幻影追击伤害倍率/, cls: "extra_damage_candidate", include: "needs_review", tick: () => "phantom_chase" },
  { pattern: /^消耗每层附着额外伤害/, cls: "extra_damage_candidate", include: "needs_review", tick: () => "per_stack_extra" },
  { pattern: /^对非冻结敌人/, cls: "extra_damage_candidate", include: "needs_review", tick: () => "vs_unfrozen" },
  { pattern: /^对冻结敌人/, cls: "extra_damage_candidate", include: "needs_review", tick: () => "vs_frozen" },
  { pattern: /^强化第(\S+)段伤害倍率/, cls: "extra_damage_candidate", include: "needs_review", tick: (m) => `enhanced_hit_${m[1]}` },
  { pattern: /^施加冻结伤害倍率/, cls: "extra_damage_candidate", include: "needs_review", tick: () => "freeze_apply" },
  { pattern: /^基础伤害倍率/, cls: "base_damage_candidate", include: true, tick: () => "base" },
  { pattern: /^初始爆炸伤害倍率/, cls: "base_damage_candidate", include: true, tick: () => "initial_explosion" },

  // --- Ultimate-enhanced normal attacks ---
  { pattern: /^终结技期间第(\S+)段倍率/, cls: "extra_damage_candidate", include: "needs_review", tick: (m) => `ult_phase_hit_${m[1]}` },
  { pattern: /^终结技期间追加攻击倍率/, cls: "extra_damage_candidate", include: "needs_review", tick: () => "ult_phase_extra" },
  { pattern: /^强化普攻第(\S+)段倍率/, cls: "extra_damage_candidate", include: "needs_review", tick: (m) => `ult_enhanced_normal_${m[1]}` },

  // --- Named sub-phase damage ---
  { pattern: /^进军伤害倍率/, cls: "multi_hit_damage_candidate", include: true, tick: () => "advance" },
  { pattern: /^袭扰伤害倍率/, cls: "multi_hit_damage_candidate", include: true, tick: () => "harass" },
  { pattern: /^决胜伤害倍率/, cls: "finisher_damage_candidate", include: true, tick: () => "decisive" },

  // --- Catch-all for anything with 倍率 we missed ---
  { pattern: /倍率/, cls: "unknown_needs_review", include: "needs_review", tick: () => "unknown_mult" },
];

function classifyLabel(label) {
  for (const rule of RULES) {
    const m = label.match(rule.pattern);
    if (m) {
      return {
        classification: rule.cls,
        includeInSkillMultiplier: rule.include,
        suggestedTickGroup: typeof rule.tick === "function" ? rule.tick(m) : rule.tick,
      };
    }
  }
  return {
    classification: "unknown_needs_review",
    includeInSkillMultiplier: "needs_review",
    suggestedTickGroup: null,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const files = readdirSync(IN_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
const report = { total: 0, operators: [], classification_totals: {} };

for (const file of files) {
  const data = JSON.parse(readFileSync(join(IN_DIR, file), "utf8"));
  const { id, slug, skills, source } = data;

  const mapped = {
    id,
    slug,
    skills: {},
    source: { ...source, mapped_at: new Date().toISOString() },
  };

  const opReport = { id, slug, skills: {} };

  for (const [typeKey, skill] of Object.entries(skills)) {
    const rowMappings = skill.row_labels.map((label) => {
      const cls = classifyLabel(label);
      return { label, ...cls };
    });

    mapped.skills[typeKey] = {
      name: skill.name,
      type: skill.type,
      level_headers: skill.level_headers,
      levels: skill.levels,
      rowMappings,
    };

    // Count classifications
    const counts = {};
    for (const rm of rowMappings) {
      counts[rm.classification] = (counts[rm.classification] || 0) + 1;
      report.classification_totals[rm.classification] =
        (report.classification_totals[rm.classification] || 0) + 1;
    }

    const needsReview = rowMappings.filter(
      (r) => r.includeInSkillMultiplier === "needs_review",
    ).length;

    opReport.skills[typeKey] = {
      name: skill.name,
      total_rows: rowMappings.length,
      counts,
      needs_review: needsReview,
      damage_candidates: rowMappings
        .filter((r) => r.includeInSkillMultiplier === true)
        .map((r) => r.label),
    };
  }

  writeFileSync(join(OUT_DIR, `${slug}.json`), JSON.stringify(mapped, null, 2), "utf8");
  report.operators.push(opReport);
  report.total++;
}

// Write report
const REPORT_PATH = join(OUT_DIR, "..", "mapped-skills-report.json");
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");

// --- Console output ---
console.log("=== Skill Mapping Report ===\n");
console.log(`Operators: ${report.total}`);
console.log("\nClassification totals:");
for (const [cls, count] of Object.entries(report.classification_totals).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cls.padEnd(35)} ${count}`);
}

// Spot check
const samples = ["endministrator", "gilberta", "laevatain", "chen-qianyu", "pogranichnik"];
console.log("\n--- Spot Check ---");
for (const slug of samples) {
  const m = JSON.parse(readFileSync(join(OUT_DIR, `${slug}.json`), "utf8"));
  console.log(`\n  ${m.id}:`);
  for (const [key, skill] of Object.entries(m.skills)) {
    const inc = skill.rowMappings.filter((r) => r.includeInSkillMultiplier === true);
    const excl = skill.rowMappings.filter((r) => r.includeInSkillMultiplier === false);
    const review = skill.rowMappings.filter((r) => r.includeInSkillMultiplier === "needs_review");
    console.log(`    ${key} (${skill.name}):`);
    if (inc.length) console.log(`      INCLUDE: ${inc.map((r) => r.label + " → " + r.suggestedTickGroup).join(", ")}`);
    if (review.length) console.log(`      REVIEW:  ${review.map((r) => r.label + " → " + r.suggestedTickGroup).join(", ")}`);
    if (excl.length) console.log(`      EXCLUDE: ${excl.map((r) => r.label).join(", ")}`);
  }
}

console.log(`\nOutput: ${OUT_DIR}`);
console.log(`Report: ${REPORT_PATH}`);
