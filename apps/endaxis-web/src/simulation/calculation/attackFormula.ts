/**
 * Attack power formula — 攻击力公式.
 *
 * Step 1: 基础攻击力 = 干员攻击力 + 武器攻击力             (baseAttack)
 * Step 2: 基础总值   = 基础攻击力 × (1 + 攻击力%) + 固定值  (attackAfterBonuses)
 * Step 3: 能力值加成 = trunc1(主能力 × 0.5) + trunc1(副能力 × 0.2)
 * Step 4: 能力值倍率 = 1 + 能力值加成 / 100                (abilityMultiplier)
 * Step 5: 面板攻击力 = floor(基础总值 × 能力值倍率)
 *
 * ATK = floor(
 *   ((baseAttack * (1 + percentBonus) + flatBonus)
 *    * (1 + truncate1(primaryAbility * 0.5) / 100
 *         + truncate1(secondaryAbility * 0.2) / 100))
 * )
 *
 * Rules:
 * 1. primaryAbility * 0.5 is truncated to 1 decimal place (floor, not round)
 * 2. secondaryAbility * 0.2 is truncated to 1 decimal place (floor, not round)
 * 3. Final ATK is floored (not rounded)
 * 4. All subsequent damage is based on this floored ATK
 *
 * Status: working verified — validated with 伊冯+艺术暴君 and 莱万汀+熔铸火焰.
 * Note: 管理员实测(2026-04-13)显示战斗内大概率使用浮点ATK而非floor后整数：
 *       武器ATK为浮点(武器页面四舍五入, 角色面板取整), 战斗伤害与浮点ATK吻合。
 *       当前仍按 floor 实现, 待更多干员数据确认后决定是否改为浮点。
 */

import type { ActorStats } from "../compiler/types";

/**
 * Truncate to 1 decimal place (deterministic floor, not round).
 *
 * Example: 28.65 → 28.6, 10.29 → 10.2, 30.0 → 30.0
 */
export function truncateToOneDecimal(n: number): number {
  return Math.floor(n * 10) / 10;
}

export interface AttackFormulaInput {
  /** Base attack (character + weapon). Typically stats.attack. */
  baseAttack: number;
  /** Percentage bonus from buffs (decimal, e.g. 0.15 = 15%). Default 0. */
  percentBonus?: number;
  /** Flat attack bonus from buffs. Default 0. */
  flatBonus?: number;
  /** Primary ability stat value. */
  primaryAbility: number;
  /** Secondary ability stat value. */
  secondaryAbility: number;
}

/**
 * Compute effective attack power using the verified formula.
 *
 * The primary/secondary ability contributions are each truncated
 * to 1 decimal place before conversion to a multiplier.
 * The final result is floored (not rounded).
 */
export function computeEffectiveAttack(input: AttackFormulaInput): number {
  const {
    baseAttack,
    percentBonus = 0,
    flatBonus = 0,
    primaryAbility,
    secondaryAbility,
  } = input;

  const attackAfterBonuses = baseAttack * (1 + percentBonus) + flatBonus;

  // Each ability contribution is truncated to 1 decimal (as a percentage value)
  const primaryContribPercent = truncateToOneDecimal(primaryAbility * 0.5);
  const secondaryContribPercent = truncateToOneDecimal(secondaryAbility * 0.2);

  const abilityMultiplier =
    1 + primaryContribPercent / 100 + secondaryContribPercent / 100;

  return Math.floor(attackAfterBonuses * abilityMultiplier);
}

/**
 * Convenience: compute effective attack from ActorStats.
 *
 * Uses stats.attack as base, stats.primary_ability, stats.secondary_ability.
 * percentBonus and flatBonus default to 0 (buff aggregation not yet implemented).
 */
export function computeAttackFromStats(stats: ActorStats): number {
  return computeEffectiveAttack({
    baseAttack: stats.attack,
    primaryAbility: stats.primary_ability,
    secondaryAbility: stats.secondary_ability,
    // TODO: aggregate percentBonus and flatBonus from active buffs
  });
}
