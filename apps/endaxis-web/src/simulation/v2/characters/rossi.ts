/**
 * ROSSI (洛茜) — V2 Character Data
 *
 * Element: physical
 * Weapon type: sword
 * Main attribute: agility, Sub attribute: intellect
 *
 * NOTE — current state:
 * - 战技 basic (3 hit, 110f) is the default; 强化版 (basic + 4 狼之珀 sub-hits,
 *   192f) auto-selected via the `enemyHasBreak` SkillVariant condition.
 * - 狼之珀 = 4 sub-hits (1f apart, equal 第二段倍率 × 0.25 share). Sub-hit 1
 *   carries the talent_0 vuln + 25-tick DOT.
 * - Talent 0 (斫痕): vuln + DOT effects inlined on 狼之珀 sub-hit 1.
 * - Talent 1 (沸血): trigger fires on crit on 斫痕 target → extra blaze damage.
 * - Hit timings are user's median measurements; refine via HitTimingTuner.
 */

import type { Skill, PassiveTrigger, DamageElement, HitEffect, Hit, SkillVariant, VariantCondition } from "../types";
import { registerScaleByResolver } from "../valueSource";

// ═══════════════════════════════════════════════════════════════════
// Module-level: register custom scaleBy resolver for talent_1 burning ×1.5
// ═══════════════════════════════════════════════════════════════════
//
// Talent_1 沸血 P3 description: "若目标同时处于燃烧状态，则上述伤害和治疗效果
// 提升至1.5倍". Implemented as a scaleBy multiplier on the talent_1 delayed_damage.
// `enemy.anomalies?.burning?.active` is read at trigger fire time.

registerScaleByResolver("rossi_burning_mult", (ctx) => {
  return ctx.enemy?.anomalies?.burning?.active ? 1.5 : 1.0;
});

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

const f = (frames: number) => frames / 60;

// ═══════════════════════════════════════════════════════════════════
// Part 1: Static Character Data
// ═══════════════════════════════════════════════════════════════════

export const identity = {
  id: "ROSSI",
  name: "洛茜",
  nameEn: "Rossi",
  rarity: 6,
  profession: "guard",
  element: "physical" as DamageElement,
  weaponType: "sword",
  mainAttribute: "agility" as const,
  subAttribute: "intellect" as const,
  maxPotential: 5,
};

export const promotionCaps = [20, 40, 60, 80, 90];

export { default as levelStats } from "../../../data/operators/ROSSI/stats.json";
export { default as skillData } from "../../../data/operators/ROSSI/skills.json";

// ── Talents (UI/documentation; kernel effects inlined in skill hits where needed) ──

export const talents = [
  {
    id: "talent_0",
    name: "斫痕",
    stages: [
      {
        promotion: 1,
        description: "战技狼之珀命中后施加爪印斫痕状态：每秒受 ATK×25% 物理伤害；物理/灼热伤害 +6%；持续 15s；不可叠加",
        dotMultiplier: 25,
        vuln: 6,
        duration: 15,
      },
      {
        promotion: 2,
        description: "强化版：DOT 30%，vuln +12%，持续 25s",
        dotMultiplier: 30,
        vuln: 12,
        duration: 25,
      },
    ],
  },
  {
    id: "talent_1",
    name: "沸血",
    stages: [
      {
        promotion: 2,
        description: "斫痕状态敌人受暴击伤害时额外触发 12% ATK 灼热伤害",
        // damageMultiplier is read by resolveTalentValues — exposes via multiplierFromTalent.
        // P3 potential adds +8 via talent_enhance valueBonus (potentials.json), making total 20 here.
        damageMultiplier: 12,
      },
      {
        promotion: 3,
        description: "强化版：24% ATK 灼热伤害；P3 潜能进一步加 +8% → 32% 总倍率",
        damageMultiplier: 24,
      },
    ],
  },
];

// ── Potentials (consumed by panel.ts for cooldown_modifier; full effects live in potentials.json) ──

export const potentials = [];

// ═══════════════════════════════════════════════════════════════════
// Part 2: Kernel Effects — Talent 0 (斫痕) inlined effects on hit4 sub-hit 1
// ═══════════════════════════════════════════════════════════════════
//
// Mechanic: 斫痕 fires on **狼之珀 命中** (= Phase 1 of sub-hit 1), NOT on the
// damage event after. This is what allows all 4 狼之珀 sub-hits to eat the +12%
// 灼热脆弱 — vuln is applied to enemy.buffManager in sub-hit 1's Phase 1, then
// every sub-hit's Phase 4 body damage reads it from enemy state.
//
// Talent_0 effects (sub-hit 1 only; sub-hits 2-4 carry no effects):
//   • Vuln: 物理脆弱 / 灼热脆弱 +12% target=enemy, 25s duration (P2 stage)
//   • DOT: 30% ATK 物理 every 1s for 25 ticks (P2 stage)
//
// Implementation uses ONLY the standard "先特效后伤害" model — no time hacks
// (no delay<0, no `early-1-frame`-style scheduling). The behavior emerges from
// kernel's documented effect-processing rules:
//   • Phase 1 runs effect array in declaration order
//   • delayed_damage with delay=0 is a SYNCHRONOUS damage emit at evaluation time
//     (computes against enemy state at THAT moment in the array)
//   • Phase 4 hit body damage rolls AFTER all Phase 1 effects, sees their state
//
// Effect array order (significant under the standard model above):
//   [0]   DOT tick 1 (delay=0)        → state = pre-vuln  (no buff_apply ran yet) → 167
//   [1]   buff_apply 物理脆弱 to enemy
//   [2]   buff_apply 灼热脆弱 to enemy
//   [3+]  DOT ticks 2..25 (delays 1..24) → state at firing time has vuln           → 187
//
// Then in Phase 4, sub-hit 1 body damage sees 灼热脆弱 → 517.
// Sub-hits 2/3/4 (later in time) fire their own Phase 4 with vuln already on
// enemy.buffManager → also 517 each.
//
// DOT damages set skipSourceTypeBonus=true (talent damage shouldn't pick up P1's
// 战技伤害+15%). school/element bonuses + vuln still apply normally.

/** Stage values for 斫痕 — looked up by talent_0 level (1 = 精英化1, 2 = 精英化2).
 *  Used by makeZhuoHenEffects to build stage-appropriate effect array. */
interface ZhuoHenStage {
  dotMultiplier: number;  // ATK% per tick
  dotDuration: number;    // total ticks at 1s intervals
  vulnValue: number;      // 物理 / 灼热 脆弱 percent
  vulnDuration: number;   // seconds
}
const ZHUOHEN_STAGES: Record<number, ZhuoHenStage> = {
  1: { dotMultiplier: 25, dotDuration: 15, vulnValue: 6,  vulnDuration: 15 },
  2: { dotMultiplier: 30, dotDuration: 25, vulnValue: 12, vulnDuration: 25 },
};

/** Build 斫痕 effect array for a specific talent_0 stage. Returns [] when
 *  talent_0 is locked (caller selects the no-talent variant instead).
 *
 *  斫痕 = a single compound debuff `rossi_zhuohen` that bundles 物理脆弱 +
 *  灼热脆弱 into one named state (one buff bar, one icon — matches the in-game
 *  presentation where 爪印斫痕 is a unified status, not two stacked debuffs).
 *  The two stat modifiers live inside the buff via `modifiers: []`, and any
 *  trigger gating (e.g. fevorousBlood's "is target in 斫痕?") just checks the
 *  one buff id. */
function makeZhuoHenEffects(stage: ZhuoHenStage): HitEffect[] {
  const effects: HitEffect[] = [];
  // 1. First DOT tick BEFORE the buff_apply (order matters: this tick fires
  //    against pre-vuln enemy state, subsequent ticks against post-vuln).
  // hideFromHits keeps these out of the per-hit damage breakdown — treated as
  // a debuff DOT in the UI (analogous to 燃烧), not as N+ extra rows under
  // 战技 hit3. Damage still counts in totals.
  effects.push({
    type: "delayed_damage",
    params: {
      delay: 0,
      multiplier: stage.dotMultiplier,
      element: "physical",
      school: "physical",
      canCrit: true,
      skipSourceTypeBonus: true,
      hideFromHits: true,
      triggerName: "爪印斫痕",
    },
  });
  // 2. Apply the compound 爪印斫痕 debuff — ONE buff with TWO modifiers
  //    (物理脆弱 + 灼热脆弱). Single buff bar, single icon, atomic application.
  effects.push({
    type: "buff_apply",
    params: {
      buffId: "rossi_zhuohen",
      target: "enemy",
      duration: stage.vulnDuration,
      modifiers: [
        { stat: "physical_dmg", zone: "vulnerability", value: stage.vulnValue },
        { stat: "blaze_dmg",    zone: "vulnerability", value: stage.vulnValue },
      ],
    },
  });
  // 3. Subsequent DOT ticks
  for (let i = 1; i < stage.dotDuration; i++) {
    effects.push({
      type: "delayed_damage",
      params: {
        delay: i,
        multiplier: stage.dotMultiplier,
        element: "physical",
        school: "physical",
        canCrit: true,
        skipSourceTypeBonus: true,
        hideFromHits: true,
        triggerName: "爪印斫痕",
      },
    });
  }
  return effects;
}

// ═══════════════════════════════════════════════════════════════════
// Part 3: Skills — Attack Segments
// ═══════════════════════════════════════════════════════════════════

const a1: Skill = {
  id: "rossi_a1", type: "attack", name: "A1",
  element: "physical", duration: f(24), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(16), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第一段倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a2: Skill = {
  id: "rossi_a2", type: "attack", name: "A2",
  element: "physical", duration: f(56), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(32), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第二段倍率", share: 0.5 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(44), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第二段倍率", share: 0.5 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a3: Skill = {
  id: "rossi_a3", type: "attack", name: "A3",
  element: "physical", duration: f(97), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(63), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第三段倍率", share: 0.5 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(81), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第三段倍率", share: 0.5 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a4: Skill = {
  id: "rossi_a4", type: "attack", name: "A4",
  element: "physical", duration: f(165), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(105), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 0.2 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(110), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 0.2 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(119), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 0.2 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(123), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 0.2 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(140), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第四段倍率", share: 0.2 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const a5: Skill = {
  id: "rossi_a5", type: "attack", name: "A5（重击）", isHeavyAttack: true,
  element: "physical", duration: f(245), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(197), checkpointIndex: 0, damage: { multiplierRef: { label: "普攻第五段倍率", share: 1 }, stagger: 18, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

const execution: Skill = {
  id: "rossi_execution", type: "execution", name: "处决",
  element: "physical", duration: f(163), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(13), checkpointIndex: 0, damage: { multiplierRef: { label: "处决攻击倍率", share: 0.1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(35), checkpointIndex: 0, damage: { multiplierRef: { label: "处决攻击倍率", share: 0.1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
    { offset: f(81), checkpointIndex: 0, damage: { multiplierRef: { label: "处决攻击倍率", share: 0.8 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [{ type: "sp_restore", params: { amount: 100, isTrueSP: true, fromExecutionRecovery: true } }], standardLogic: true },
  ],
  checkpoints: [],
};

// 下落攻击 (4 组测量平均, XYZ → f): duration 85f (125/126/125/125 XYZ → 85/86/85/85),
// hit1 @ 48f (49/48/48/48 raw).
const aerialAttack: Skill = {
  id: "rossi_aerial", type: "attack", name: "下落攻击",
  element: "physical", duration: f(85), spCost: 0, cooldown: 0,
  hits: [
    { offset: f(48), checkpointIndex: 0, damage: { multiplierRef: { label: "下落攻击倍率", share: 1 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "attack" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

// ═══════════════════════════════════════════════════════════════════
// Part 4: Skills — 战技 血红之影 (basic 普通版 + 强化版 variant on 破防)
// ═══════════════════════════════════════════════════════════════════
//
// Hit timing (frames; averaged from user 7 测组 for hit1-3, 4 测组 for hit4):
//   Basic 战技 duration:        110f (1.83s, XYZ from 150 avg ×3 sets)
//   强化战技 duration:           192f (3.20s, XYZ from 311.5 avg ×4 sets)
//   hit1 = 35f, hit2 = 47f, hit3 = 73f (击飞 5失衡)  ← hit1-3 are IDENTICAL between basic / 强化
//   hit4 = 139f (狼之珀 first sub-hit; sub-hits 2-4 at 140/141/142f, 1f apart per user)
//
// 第一段倍率 split: 30/30/40 across hit1/hit2/hit3 (reverse-engineered from 369/369/492).
//
// 狼之珀 (强化 only) = 4 sub-hits, 第二段倍率 × 0.25 each. Each independently canCrit=true
// (real mode rolls per sub-hit; observed 1 sub-hit crit → 775).
// Sub-hit 1 carries talent_0 effects (vuln + DOT) — only fires once per cast.
// 10 失衡分摊到 4 个 sub-hit (2.5 each); maintains correct total even if sub-hits drop.
//
// 强化 trigger: at action_start, if `enemy.breakStacks > 0` → 强化 variant overrides
// duration + hits to include the 4 狼之珀 sub-hits. Otherwise basic version fires.

// Shared hit1-3 (identical between basic and 强化). Factored as a function so each call
// site gets fresh Hit objects (effects[] arrays mutate when traversed, so don't share).
function makeSkillHits123(): Hit[] {
  return [
    { offset: f(35), checkpointIndex: 0, damage: { multiplierRef: { label: "第一段伤害倍率", share: 0.30 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "skill" }, effects: [], standardLogic: true },
    { offset: f(47), checkpointIndex: 0, damage: { multiplierRef: { label: "第一段伤害倍率", share: 0.30 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "skill" }, effects: [], standardLogic: true },
    {
      offset: f(73), checkpointIndex: 0,
      damage: { multiplierRef: { label: "第一段伤害倍率", share: 0.40 }, stagger: 5, element: "physical", canCrit: true, school: "physical", sourceType: "skill" },
      effects: [{ type: "physical_anomaly", params: { physicalType: "launch" } }],
      standardLogic: true,
    },
  ];
}

// 狼之珀 — ONE in-game hit that rolls 4 separate damage instances (each
// independently crits) within 3 frames. Modeled as 1 Hit at 139f carrying:
//   • the main damage roll (第二段倍率 × 0.25, stagger 15 at M3)
//   • 3 delayed_damage effects at +1/+2/+3 frame delays, also at 第二段倍率
//     × 0.25, also canCrit (each gets its own critEventKey via the kernel).
// This naturally collapses 4 ticks to one "landing event" (one hit_damage
// trigger fires, one SP-refund triggers, etc.) without needing silentTriggers
// on multiple Hit entries.
//
// Note on stagger: kernel hit.stagger is a literal number — no mastery scaling
// yet (M0-M2 = 10/12, M3 = 15 per skills.json "第二段失衡值"). 15 is hardcoded
// for now; refine when staggerRef lands.
function makeWolfPearlExtraDamages(): HitEffect[] {
  // 3 of the 4 damage rolls land 1/2/3 frames after the main; the kernel emits
  // each as its own damage event with an independent crit roll.
  return [1, 2, 3].map((dframes) => ({
    type: "delayed_damage" as const,
    params: {
      delay: f(dframes),
      multiplierRef: { label: "第二段伤害倍率", share: 0.25 },
      element: "blaze" as const,
      school: "magic" as const,
      canCrit: true,
      triggerName: "狼之珀",
    },
  }));
}

/** Build the 强化战技 hits array for a given 斫痕 stage. Optional `extraSubHit1Effects`
 *  appended to sub-hit 1 (used by P1 potential to add SP refund). */
function makeEnhancedHits(zhuoHenEffects: HitEffect[], extraSubHit1Effects: HitEffect[] = []): Hit[] {
  // 狼之珀 hit: main damage + 斫痕 effects + 3 extra damage rolls + (optional)
  // P1 SP refund. Effect ordering matters: 斫痕 DOT/vuln 在前 (Phase 1 runs
  // declaration order so DOT tick 0 fires pre-vuln, vuln then applied for
  // subsequent ticks; see makeZhuoHenEffects). 3 extra damages last.
  const wolfPearlHit: Hit = {
    offset: f(139), checkpointIndex: 0,
    damage: { multiplierRef: { label: "第二段伤害倍率", share: 0.25 }, stagger: 15, element: "blaze", canCrit: true, school: "magic", sourceType: "skill" },
    effects: [...zhuoHenEffects, ...extraSubHit1Effects, ...makeWolfPearlExtraDamages()],
    standardLogic: true,
  };
  return [...makeSkillHits123(), wolfPearlHit];
}

// Base skill: 普通版 (3 hits, duration 110f). Fires when target is NOT 破防.
const skill: Skill = {
  id: "rossi_skill", type: "skill", name: "血红之影",
  element: "physical", duration: f(110), spCost: 100, cooldown: 0,
  hits: makeSkillHits123(),
  checkpoints: [],
};

// P1 potential: 狼之珀命中敌人后返还10点技力. Counts as 1 landing per cast → fires
// on sub-hit 1 only (other sub-hits have silentTriggers + no effects).
const P1_SP_REFUND_EFFECT: HitEffect = {
  type: "sp_restore",
  params: { amount: 10, isTrueSP: false },
};

// 强化 variants — three flavours keyed by talent_0 unlock level. Priority
// cascade: highest level matching wins. enhanced_p2 (priority 30) matches at
// talent_0 ≥ 2; enhanced_p1 (20) at ≥ 1; enhanced_no_talent (10) is the
// fallback when enemy is broken but talent_0 isn't unlocked yet (promotion 0).
//
// Each variant has a separate "with P1 potential" entry to gate the SP refund.
// That gives 6 enhanced variants total — manageable thanks to makeEnhancedHits().
function buildEnhancedVariant(id: string, priority: number, condTalent: VariantCondition | null, condPotential: VariantCondition | null, zhuoHenStage: ZhuoHenStage | null): SkillVariant {
  const zhuoHenEffects = zhuoHenStage ? makeZhuoHenEffects(zhuoHenStage) : [];
  const spRefund = condPotential ? [P1_SP_REFUND_EFFECT] : [];
  const conditions: VariantCondition[] = [{ type: "enemyHasBreak" }];
  if (condTalent) conditions.push(condTalent);
  if (condPotential) conditions.push(condPotential);
  return {
    id, priority, conditions,
    overrides: { duration: f(192), hits: makeEnhancedHits(zhuoHenEffects, spRefund) },
  };
}

// 6 enhanced variants — priority cascade picks the right combination of
// (talent_0 level) × (P1 potential present).
const ZH_P1 = ZHUOHEN_STAGES[1]!;
const ZH_P2 = ZHUOHEN_STAGES[2]!;
const enh_p2_p1pot     = buildEnhancedVariant("rossi_skill_enh_p2_p1pot",     35, { type: "talentLevel", talentId: "talent_0", op: ">=", value: 2 }, { type: "potentialLevel", op: ">=", value: 1 }, ZH_P2);
const enh_p2_nopot     = buildEnhancedVariant("rossi_skill_enh_p2_nopot",     30, { type: "talentLevel", talentId: "talent_0", op: ">=", value: 2 }, null,                                          ZH_P2);
const enh_p1_p1pot     = buildEnhancedVariant("rossi_skill_enh_p1_p1pot",     25, { type: "talentLevel", talentId: "talent_0", op: ">=", value: 1 }, { type: "potentialLevel", op: ">=", value: 1 }, ZH_P1);
const enh_p1_nopot     = buildEnhancedVariant("rossi_skill_enh_p1_nopot",     20, { type: "talentLevel", talentId: "talent_0", op: ">=", value: 1 }, null,                                          ZH_P1);
const enh_notalent_p1pot = buildEnhancedVariant("rossi_skill_enh_notalent_p1pot", 15, null, { type: "potentialLevel", op: ">=", value: 1 }, null);
const enh_notalent_nopot = buildEnhancedVariant("rossi_skill_enh_notalent_nopot", 10, null, null,                                           null);

// ═══════════════════════════════════════════════════════════════════
// Part 5: Skills — 连携技 (燎影时刻)
// ═══════════════════════════════════════════════════════════════════
//
// Link first cast (default link) — 5 hits at 第一段伤害倍率:
//   hit1, hit2: share 0.35 (大伤害, 实测 336 each at M3 + P1 link_dmg_bonus +15%)
//   hit3-5:     share 0.10 (小伤害, 实测 96 each)
//   验证: 2 × 0.35 + 3 × 0.10 = 1.0 ✓
//
// Hit timings (avg of 5 measurements, frames): 27 / 65 / 83 / 91 / 98
// duration: 154f (avg of 4 measurements). hit3 @ 83f = detach point — after that,
// hit4/5 fire automatically without requiring character action.
//
// hit2 effect: 终结技充能 +10 (gauge_gain).
//
// 第二段 ("二次施放") = link2nd, placed manually in [92f, 92f+6s = 452f] after
// the first cast — same 6s window as a standard link queue.
// 精确衔接 = link2ndPrecise, placed in [123f, 167f] sub-window → triggers
// precision variant with longer animation + extra +1 break stack on enemy.
//
// CD model: 第一段 and 第二段 share a single CD bucket `rossi_link_group`.
//   - 第一段 (cd=15s) writes its expiry as `end + cooldownStartOffset + 15s`
//     where the offset (= window length 92f+6s minus 第一段 duration 154f) makes
//     the CD start at the window close — matching game behaviour when 第二段
//     is never placed.
//   - 第二段 (cd=15s, no offset) writes `end + 15s`; kernel Math.max-extends
//     the bucket so a later expiry wins. 第二段 skips its own CD check
//     (gated by requiresPreviousAction window instead).

// Window in frames: 92f open, 92f + 6s (= 360f) → 452f close. Match the standard
// 6-second link queue window.
const LINK_WINDOW_MIN_F = 92;
const LINK_WINDOW_MAX_F = 452;
// CD-start offset for 第一段: from action_end to window_close (= 452f - 154f).
const LINK_PRIMARY_CD_OFFSET_FRAMES = LINK_WINDOW_MAX_F - 154;

const link: Skill = {
  id: "rossi_link", type: "link", name: "燎影时刻 (第一段)",
  element: "physical", duration: f(154), spCost: 0, cooldown: 15,
  detach: f(83),
  // Shared CD bucket with 第二段 — kernel Math.max-extends on write.
  cooldownGroup: "rossi_link_group",
  // CD timer starts at 第二段-window-close, not at 第一段 end.
  cooldownStartOffset: f(LINK_PRIMARY_CD_OFFSET_FRAMES),
  // Release condition (per skill description): "当有敌人同时处于破防和法术附着状态时可以发动"
  releaseConditions: [
    { type: "enemy_has_break", params: {} },
    { type: "enemy_has_attachment", params: {} },
  ],
  hits: [
    // Big hit 1 @ 27f (35% share)
    { offset: f(27), checkpointIndex: 0, damage: { multiplierRef: { label: "第一段伤害倍率", share: 0.35 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "link" }, effects: [], standardLogic: true },
    // Big hit 2 @ 65f (35% share) + 终结技充能 +10
    {
      offset: f(65), checkpointIndex: 0,
      damage: { multiplierRef: { label: "第一段伤害倍率", share: 0.35 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "link" },
      effects: [{ type: "gauge_gain", params: { amount: 10 } }],
      standardLogic: true,
    },
    // Small hit 3 @ 83f (10% share) — also the detach point
    { offset: f(83), checkpointIndex: 0, damage: { multiplierRef: { label: "第一段伤害倍率", share: 0.10 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "link" }, effects: [], standardLogic: true },
    // Small hit 4 @ 91f (10% share)
    { offset: f(91), checkpointIndex: 0, damage: { multiplierRef: { label: "第一段伤害倍率", share: 0.10 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "link" }, effects: [], standardLogic: true },
    // Small hit 5 @ 98f (10% share)
    { offset: f(98), checkpointIndex: 0, damage: { multiplierRef: { label: "第一段伤害倍率", share: 0.10 }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "link" }, effects: [], standardLogic: true },
  ],
  checkpoints: [],
};

// ─── Link 第二段 (二次施放, 燎影时刻 2nd cast) ──────────────────────
//
// Modeled as a single placeable Skill (link2nd) with one SkillVariant for
// 精确衔接. Auto-selection by placement timing relative to first cast (rossi_link):
//   • Placement ∈ [92f, 122f] after rossi_link → base (二次施放, duration 95f)
//   • Placement ∈ [123f, 167f] after rossi_link → 精确衔接 variant (duration 142f, +1 break)
//   • Placement < 92f or > 167f → invalid (rejected by requiresPreviousAction).
//
// Buff (暴击率/暴伤) applies at offset 0 (skill cast moment). Evidence:
// 极限施放时第一段 hit5 critted for 192 (= 96 × 2.0 with crit_dmg 100% from buff)
// confirming buff is active before hit5 fires.
//
// Hit structure (both base + variant):
//   hit1 @ 0f:        damage=null + buff_apply 暴击率/暴伤 (15s, valueRef from skills.json)
//   hit2a @ 32f/80f:  第二段倍率 ×1 base damage + 击飞 + 5失衡 + gauge_gain +10
//                     (精确衔接: + break_apply stacks=1)
//   hit2b @ 32f/80f:  消耗每层倍率 × stacks (scaleBy attachmentStacks) + consume_attachment
//                     deferTo afterSkillDamage
//
// Verified math (ATK 1114, M3, P1 link_dmg_bonus +15%, 1 attachment stack consumed):
//   hit2a: 1114 × 3.00 × 0.5 × 1.15 = 1921.65 → 1921
//   hit2b: 1114 × 1.80 × 1 × 0.5 × 1.15 = 1153.0 → 1153
//   total: 3074 ≈ 3076 (实测, 差 2 = floor 舍入)

function makeLink2ndBuffHit(): Hit {
  return {
    offset: 0, checkpointIndex: 0,
    damage: null,
    effects: [
      // 二段连携 同时提升暴击率 + 暴击伤害 — modeled as a SINGLE buff with two
      // modifiers, since in-game it's one named effect (not two separate buffs).
      {
        type: "buff_apply",
        params: {
          buffId: "rossi_link_crit_buff",
          target: "self",
          durationRef: "增益效果的持续时间（秒）",
          modifiers: [
            { stat: "crit_rate", zone: "crit", valueRef: "暴击率提升" },
            { stat: "crit_dmg",  zone: "crit", valueRef: "暴击伤害提升" },
          ],
        },
      },
    ],
    standardLogic: true,
  };
}

const link2nd: Skill = {
  id: "rossi_link_2nd", type: "link", name: "燎影时刻 (第二段)",
  element: "physical", duration: f(95), spCost: 0, cooldown: 15,
  // Placement constraint: must follow rossi_link within the standard 6s link
  // queue window. Sub-window [123f, 167f] auto-selects the 精确衔接 variant.
  requiresPreviousAction: {
    skillId: "rossi_link",
    withinFrames: { min: LINK_WINDOW_MIN_F, max: LINK_WINDOW_MAX_F },
  },
  // Shared CD bucket with 第一段 — Math.max-extend pushes the timer to whichever
  // is later (window-close from 第一段 or 第二段.end + 15s). Self CD check skipped
  // because requiresPreviousAction is set.
  cooldownGroup: "rossi_link_group",
  hits: [
    makeLink2ndBuffHit(),
    // hit2a @ 32f: base 第二段倍率 + 击飞 + 5失衡 + gauge +10
    {
      offset: f(32), checkpointIndex: 0,
      damage: { multiplierRef: { label: "第二段伤害倍率", share: 1 }, stagger: 5, element: "physical", canCrit: true, school: "physical", sourceType: "link" },
      effects: [
        { type: "physical_anomaly", params: { physicalType: "launch" } },
        { type: "gauge_gain", params: { amount: 10 } },
      ],
      standardLogic: true,
    },
    // hit2b @ 32f: per-stack damage + consume_attachment deferred
    {
      offset: f(32), checkpointIndex: 0,
      damage: { multiplierRef: { label: "消耗每层附着额外伤害倍率", share: 1, scaleBy: "attachmentStacks" }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "link" },
      effects: [
        { type: "consume_attachment", params: { deferTo: "afterSkillDamage" } },
      ],
      standardLogic: true,
    },
  ],
  checkpoints: [],
};

// 精确衔接 variant: when link2nd is placed within [123f, 167f] after rossi_link,
// auto-select this variant (longer animation + break_apply).
const link2ndPreciseVariant: SkillVariant = {
  id: "rossi_link_2nd_precise",
  priority: 10,
  conditions: [{
    type: "previousActionTiming",
    prevSkillId: "rossi_link",
    prevSinceFrames: { min: 123, max: 167 },
  }],
  overrides: {
    duration: f(142),
    hits: [
      makeLink2ndBuffHit(),
      // hit2a @ 80f: base + 击飞 + 5失衡 + gauge +10 + 1层破防 (精确衔接专属)
      {
        offset: f(80), checkpointIndex: 0,
        damage: { multiplierRef: { label: "第二段伤害倍率", share: 1 }, stagger: 5, element: "physical", canCrit: true, school: "physical", sourceType: "link" },
        effects: [
          { type: "physical_anomaly", params: { physicalType: "launch" } },
          { type: "gauge_gain", params: { amount: 10 } },
          { type: "break_apply", params: { stacks: 1 } },
        ],
        standardLogic: true,
      },
      // hit2b @ 80f: per-stack damage + consume_attachment deferred
      {
        offset: f(80), checkpointIndex: 0,
        damage: { multiplierRef: { label: "消耗每层附着额外伤害倍率", share: 1, scaleBy: "attachmentStacks" }, stagger: 0, element: "physical", canCrit: true, school: "physical", sourceType: "link" },
        effects: [
          { type: "consume_attachment", params: { deferTo: "afterSkillDamage" } },
        ],
        standardLogic: true,
      },
    ],
  },
};

// ═══════════════════════════════════════════════════════════════════
// Part 6: Skills — 终结技 ("利爪"奇袭)
// ═══════════════════════════════════════════════════════════════════
//
// Structure: 27 hits total
//   • hits 1-25: 戳击 (multi-stab, 共 25 段) — each at 戳击总倍率 × 0.04 (= 1/25)
//   • hit26: 第一段斩击 ×1
//   • hit27: 第二段斩击 ×1 + 25失衡 + 灼热附着 (magic_attachment blaze)
//
// All hits: blaze element, magic school, sourceType=ultimate, canCrit=true.
// Each stab is a separate hit so it independently rolls crit (matches game observation).
//
// Verified math (ATK 1114, M3, 满潜 → P5 ult_dmg_bonus +10%):
//   非暴击:
//     每段戳击: 1114 × 600% × 0.04 × 0.5 × 1.10 = 147.0 → 147 ✓
//     第一段斩击: 1114 × 250% × 0.5 × 1.10 = 1531.75 → 1531 (实测 1532) ✓
//     第二段斩击: 1114 × 750% × 0.5 × 1.10 = 4595.25 → 4595 (实测 4597) ✓
//   暴击 (crit_dmg = 50% base + 60% skill + 30% P5 = 140%, crit zone 2.40):
//     每段戳击: 147 × 2.4 = 352.8 → 353 (实测累加 +353 per stab crit) ✓
//
// Crit damage bonuses are inlined as `buff_apply { internal: true }` on hit1
// (first stab @ 128f), duration covering the full ult animation (5.5s). They
// modify the BuffManager for correct damage zone resolution but are hidden from
// the UI buff bar / hit-marker row because conceptually they're part of the ult
// itself, not externally-tracked buffs:
//   • skill 内置 +60% crit_dmg (uses skills.json valueRef "暴击伤害提升", M3 = 60)
//   • P5 +30% crit_dmg (hardcoded; 待 kernel 加 potential-conditional 后结构化)

const ULT_STAB_OFFSETS = [128, 132, 134, 140, 144, 150, 152, 156, 158, 162, 168, 170, 176, 178, 182, 185, 190, 194, 196, 200, 206, 208, 214, 218, 224] as const;

const ULT_DURATION_FRAMES = 330;

const ultStabHits = ULT_STAB_OFFSETS.map((frame, i) => ({
  offset: f(frame), checkpointIndex: 0,
  damage: { multiplierRef: { label: "戳击总伤害倍率", share: 0.04 }, stagger: 0, element: "blaze" as DamageElement, canCrit: true, school: "magic" as const, sourceType: "ultimate" as const },
  // hit1 carries the ult crit_dmg bonuses (skill 内置 +60% + P5 +30%) as a
  // single internal buff with two modifiers; merged into one buff_apply so
  // the BuffManager bookkeeping stays compact, and `internal: true` keeps
  // both effects out of the UI buff bar / hit-marker row.
  effects: i === 0 ? [
    {
      type: "buff_apply",
      params: {
        buffId: "rossi_ult_crit_dmg_internal",
        target: "self",
        duration: ULT_DURATION_FRAMES / 60,  // 5.5s
        internal: true,
        modifiers: [
          { stat: "crit_dmg", zone: "crit", valueRef: "暴击伤害提升" },  // skill M3 = 60
          { stat: "crit_dmg", zone: "crit", value: 30 },                  // P5 +30%
        ],
      },
    },
  ] : [],
  standardLogic: true as const,
}));

const ultimate: Skill = {
  id: "rossi_ultimate", type: "ultimate", name: "\"利爪\"奇袭",
  element: "blaze", duration: f(ULT_DURATION_FRAMES), spCost: 0, cooldown: 0,
  hits: [
    ...ultStabHits,
    // hit26 @ 245f: 第一段斩击
    {
      offset: f(245), checkpointIndex: 0,
      damage: { multiplierRef: { label: "第一段斩击伤害倍率", share: 1 }, stagger: 0, element: "blaze", canCrit: true, school: "magic", sourceType: "ultimate" },
      effects: [],
      standardLogic: true,
    },
    // hit27 @ 263f: 第二段斩击 + 25失衡 + 灼热附着
    {
      offset: f(263), checkpointIndex: 0,
      damage: { multiplierRef: { label: "第二段斩击伤害倍率", share: 1 }, stagger: 25, element: "blaze", canCrit: true, school: "magic", sourceType: "ultimate" },
      effects: [
        { type: "magic_attachment", params: { element: "blaze", stacks: 1 } },
      ],
      standardLogic: true,
    },
  ],
  checkpoints: [],
  gaugeCost: 110,
};

export const ultimateAnimation = f(116);

// ═══════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════

export const skills = {
  attack: [a1, a2, a3, a4, a5, execution, aerialAttack],
  skill,
  // skills.link[0] = 第一段 (default, primary link); [1] = 第二段 二次施放/精确衔接
  // (placeable second cast). 精确衔接 auto-selected via SkillVariant.
  link: [link, link2nd],
  ultimate,
};

// Variants:
//   - skill[6 entries]: enemy 破防 at cast → 强化战技 (basic 3-hit + 4 狼之珀
//     sub-hits, 192f). Picked from a 2D (talent_0 level × P1 potential) grid
//     via priority cascade; non-broken targets fall through to the basic skill.
//   - link[rossi_link_2nd_precise]: 第二段 placed in [123f, 167f] after 第一段
//     → adds +1 break stack, longer animation.
//   For link (第一段) the previousActionTiming condition won't match (no prior
//   rossi_link in that window — 第一段's own CD bucket prevents re-placement
//   within the link window anyway).
export const variants = {
  skill: [enh_p2_p1pot, enh_p2_nopot, enh_p1_p1pot, enh_p1_nopot, enh_notalent_p1pot, enh_notalent_nopot],
  link: [link2ndPreciseVariant],
};

// ═══════════════════════════════════════════════════════════════════
// Passive Triggers
// ═══════════════════════════════════════════════════════════════════
//
// Talent_1 沸血 (P2/P3 stage):
//   When ROSSI deals a crit on a target in 斫痕 state →
//     额外触发 N% ATK 灼热 damage, where N = talent_1 stage value + P3 potential bonus
//     P2 stage: 12, P3 stage: 24. P3 potential adds +8 → P3 stage with P5 potential = 32.
//     若目标 burning → ×1.5 (via "rossi_burning_mult" scaleBy)
//     The extra damage itself can crit (canCrit=true).
//     skipSourceTypeBonus=true so it doesn't pick up P1 (skill_dmg_bonus +15).
//     Element=blaze + school=magic so it picks up 灼热脆弱 from 斫痕 vuln.
//
// Mult resolution: `multiplierFromTalent: { label: "talent_1", scaleBy: "rossi_burning_mult" }`
//   - resolveTalentValues reads talent_1.stages by talent level → base 24 (P3 stage)
//   - P3 potential's talent_enhance valueBonus +8 added by resolveTalentValues
//   - Final base = 32
//   - Then × 1.5 if burning (scaleBy)
//
// Verified math (ATK=1114, full M, full potential):
//   200 (no burning, no crit on talent damage):
//     1114 × 0.32 × 0.5 × 1.12 (vuln) = 199.62 → 200 ✓
//   449 (burning + crit on talent damage):
//     1114 × 0.32 × 0.5 × 1.12 × 1.5 (crit) × 1.5 (burning) = 449.15 → 449 ✓

const fevorousBlood: PassiveTrigger = {
  id: "rossi_talent_1_fervorous_blood",
  source: "talent_沸血",
  listenTo: "hit_damage",
  deferred: false,
  sourceMustBeOwner: true,
  condition: {
    type: "compound_and",
    params: {
      conditions: [
        // Triggering hit must be a crit
        { type: "crit_hit", params: {} },
        // Target must be in 斫痕 state — single canonical buff id covers both
        // the 物理脆弱 + 灼热脆弱 components (compound buff).
        { type: "enemy_has_buff", params: { buffId: "rossi_zhuohen" } },
        // Per game description "施放技能" — only fire on 战技 / 连携 / 终结技
        // hits. Excludes 普攻 / 重击 / 下落 / 处决 (all sourceType="attack") and
        // any debuff-derived damage events.
        {
          type: "compound_or",
          params: {
            conditions: [
              { type: "source_action_type", params: { actionType: "skill" } },
              { type: "source_action_type", params: { actionType: "link" } },
              { type: "source_action_type", params: { actionType: "ultimate" } },
            ],
          },
        },
      ],
    },
  },
  actions: [
    {
      type: "delayed_damage",
      params: {
        delay: 0,
        // multiplier resolves dynamically from talent_1's stage value (+ talent_enhance bonus
        // from active potentials), then ×1.5 if target burning via scaleBy resolver.
        multiplierFromTalent: { label: "talent_1", scaleBy: "rossi_burning_mult" },
        element: "blaze",
        school: "magic",
        canCrit: true,
        skipSourceTypeBonus: true, // talent damage; doesn't pick up P1 skill_dmg_bonus
      },
    },
  ],
  sourceRef: { kind: "talent_1", actorId: "ROSSI" },
};

export const triggers: PassiveTrigger[] = [fevorousBlood];
