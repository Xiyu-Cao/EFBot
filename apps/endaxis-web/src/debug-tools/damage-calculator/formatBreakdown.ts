/**
 * TEMP DEBUG TOOL — NOT IN PRODUCTION FLOW — SAFE TO DELETE AFTER DAMAGE VALIDATION
 */

import type { DamageCalcInput, DamageCalcResult } from "./types";

export function formatBreakdownText(
  input: DamageCalcInput,
  result: DamageCalcResult,
): string {
  const lines: string[] = [];
  lines.push("=== Damage Debug Calculator — Breakdown ===");
  lines.push(`Date: ${new Date().toISOString()}`);
  if (input.hitNote) lines.push(`Note: ${input.hitNote}`);
  lines.push("");

  lines.push("--- Input ---");
  lines.push(`Base ATK: ${input.baseAttack}`);
  if (input.percentAttackBonus)
    lines.push(`ATK% Bonus: ${(input.percentAttackBonus * 100).toFixed(1)}%`);
  if (input.flatAttackBonus)
    lines.push(`ATK Flat Bonus: ${input.flatAttackBonus}`);
  if (input.primaryAbility || input.secondaryAbility)
    lines.push(
      `Abilities: pri=${input.primaryAbility} sub=${input.secondaryAbility}`,
    );
  if (input.attackOverride)
    lines.push(`ATK Override: ${input.attackOverride}`);
  lines.push(`Skill Multiplier: ${input.skillMultiplier} (${(input.skillMultiplier * 100).toFixed(0)}%)`);
  lines.push(`Crit Rate: ${input.critRate}%`);
  lines.push(`Crit DMG: +${input.critDmg}% (${(1 + input.critDmg / 100).toFixed(2)}x)`);
  lines.push(`Hit Count: ${input.hitCount}`);
  lines.push("");

  lines.push("--- Zones ---");
  lines.push(`Defense Zone: ${input.defenseZone}`);
  lines.push(`Damage Bonus Zone: ${input.damageBonusZone}`);
  lines.push(`Amplification Zone: ${input.amplificationZone}`);
  lines.push(`Vulnerability Zone: ${input.vulnerabilityZone}`);
  lines.push(`Resistance Zone: ${input.resistanceZone}`);
  lines.push(`Break Zone: ${input.breakZone}`);
  lines.push(`Other Zone: ${input.otherZone}`);
  lines.push("");

  lines.push("--- Calculation ---");
  for (const step of result.breakdown) {
    const val =
      typeof step.value === "number" ? step.value.toString() : step.value;
    const formula = step.formula ? `  (${step.formula})` : "";
    lines.push(`${step.label}: ${val}${formula}`);
  }

  return lines.join("\n");
}
