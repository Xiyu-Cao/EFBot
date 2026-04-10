/**
 * TEMP DEBUG TOOL — NOT IN PRODUCTION FLOW — SAFE TO DELETE AFTER DAMAGE VALIDATION
 *
 * Pure damage calculation for the debug calculator.
 * Every step is recorded in the breakdown for transparency.
 *
 * Formula chain:
 *   baseDamage = usedATK × skillMultiplier × defenseZone
 *               × damageBonusZone × vulnerabilityZone × amplificationZone
 *               × resistanceZone × breakZone × otherZone
 *   nonCrit = floor(baseDamage)
 *   critMult = 1 + critDmg/100
 *   critDmg  = floor(baseDamage × critMult)
 *   expected = nonCrit × (1 - critRate/100) + critDmg × (critRate/100)
 */

import { computeEffectiveAttack } from "@/simulation/calculation/attackFormula";
import type {
  DamageCalcInput,
  DamageCalcResult,
  DamageCalcBreakdownStep,
} from "./types";

export function calculateDamage(input: DamageCalcInput): DamageCalcResult {
  const steps: DamageCalcBreakdownStep[] = [];

  // --- Step 1: Resolve ATK ---
  let usedAttack: number;
  if (input.attackOverride !== null && input.attackOverride > 0) {
    usedAttack = input.attackOverride;
    steps.push({
      label: "ATK (override)",
      value: usedAttack,
      formula: `manual override`,
    });
  } else {
    usedAttack = computeEffectiveAttack({
      baseAttack: input.baseAttack,
      percentBonus: input.percentAttackBonus,
      flatBonus: input.flatAttackBonus,
      primaryAbility: input.primaryAbility,
      secondaryAbility: input.secondaryAbility,
    });
    steps.push({
      label: "Base ATK",
      value: input.baseAttack,
    });
    if (input.percentAttackBonus !== 0 || input.flatAttackBonus !== 0) {
      steps.push({
        label: "ATK after % & flat",
        value: Math.round(
          input.baseAttack * (1 + input.percentAttackBonus) +
            input.flatAttackBonus,
        ),
        formula: `${input.baseAttack} × (1 + ${input.percentAttackBonus}) + ${input.flatAttackBonus}`,
      });
    }
    if (input.primaryAbility > 0 || input.secondaryAbility > 0) {
      steps.push({
        label: "Ability scaling",
        value: `pri=${input.primaryAbility} sub=${input.secondaryAbility}`,
      });
    }
    steps.push({
      label: "Used ATK (after formula)",
      value: usedAttack,
      formula: `computeEffectiveAttack(...)`,
    });
  }

  // --- Step 2: Skill multiplier ---
  const afterSkill = usedAttack * input.skillMultiplier;
  steps.push({
    label: "× Skill Multiplier",
    value: input.skillMultiplier,
    formula: `${usedAttack} × ${input.skillMultiplier} = ${afterSkill.toFixed(2)}`,
  });

  // --- Step 3: Defense zone ---
  const afterDef = afterSkill * input.defenseZone;
  steps.push({
    label: "× Defense Zone",
    value: input.defenseZone,
    formula: `× ${input.defenseZone} = ${afterDef.toFixed(2)}`,
  });

  // --- Step 4: Damage bonus zone ---
  const afterBonus = afterDef * input.damageBonusZone;
  steps.push({
    label: "× Damage Bonus Zone",
    value: input.damageBonusZone,
    formula: `× ${input.damageBonusZone} = ${afterBonus.toFixed(2)}`,
  });

  // --- Step 5: Amplification ---
  const afterAmp = afterBonus * input.amplificationZone;
  steps.push({
    label: "× Amplification Zone",
    value: input.amplificationZone,
    formula: `× ${input.amplificationZone} = ${afterAmp.toFixed(2)}`,
  });

  // --- Step 6: Vulnerability ---
  const afterVuln = afterAmp * input.vulnerabilityZone;
  steps.push({
    label: "× Vulnerability Zone",
    value: input.vulnerabilityZone,
    formula: `× ${input.vulnerabilityZone} = ${afterVuln.toFixed(2)}`,
  });

  // --- Step 7: Resistance ---
  const afterRes = afterVuln * input.resistanceZone;
  steps.push({
    label: "× Resistance Zone",
    value: input.resistanceZone,
    formula: `× ${input.resistanceZone} = ${afterRes.toFixed(2)}`,
  });

  // --- Step 8: Break zone ---
  const afterBreak = afterRes * input.breakZone;
  steps.push({
    label: "× Break Zone",
    value: input.breakZone,
    formula: `× ${input.breakZone} = ${afterBreak.toFixed(2)}`,
  });

  // --- Step 9: Other ---
  const afterOther = afterBreak * input.otherZone;
  steps.push({
    label: "× Other Zone",
    value: input.otherZone,
    formula: `× ${input.otherZone} = ${afterOther.toFixed(2)}`,
  });

  // --- Results ---
  const baseDamage = afterOther;
  const nonCritDamage = Math.floor(baseDamage);
  const critMultiplier = 1 + input.critDmg / 100;
  const critDamage = Math.floor(baseDamage * critMultiplier);
  const critRateClamped = Math.max(0, Math.min(100, input.critRate)) / 100;
  const expectedDamage =
    nonCritDamage * (1 - critRateClamped) + critDamage * critRateClamped;
  const totalDamage = expectedDamage * input.hitCount;

  steps.push({ label: "───────────", value: "" });
  steps.push({ label: "Non-Crit Damage", value: nonCritDamage });
  steps.push({
    label: "Crit Multiplier",
    value: critMultiplier,
    formula: `1 + ${input.critDmg}/100`,
  });
  steps.push({ label: "Crit Damage", value: critDamage });
  steps.push({
    label: "Expected Damage",
    value: Math.round(expectedDamage),
    formula: `${nonCritDamage} × ${(1 - critRateClamped).toFixed(2)} + ${critDamage} × ${critRateClamped.toFixed(2)}`,
  });
  if (input.hitCount > 1) {
    steps.push({
      label: `Total (${input.hitCount} hits)`,
      value: Math.round(totalDamage),
    });
  }

  return {
    usedAttack,
    baseDamage,
    nonCritDamage,
    critDamage,
    critMultiplier,
    expectedDamage,
    totalDamage,
    breakdown: steps,
  };
}
