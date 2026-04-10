"""
damage_calc.py — 技能单次伤害计算（11乘区公式）

公式：伤害 = 攻击力 × 技能倍率 × 增伤 × 防御 × 抗性 × 失衡 × 易伤 × 脆弱 × 增幅 × 特殊系数 × 暴击
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal

SkillType = Literal["attack", "skill", "link", "ultimate"]
ElementType = Literal["blaze", "emag", "cold", "nature", "physical"]

ARTS_ELEMENTS = {"blaze", "emag", "cold", "nature"}

ELEMENT_DMG_STAT = {
    "blaze":    "blaze_dmg",
    "emag":     "emag_dmg",
    "cold":     "cold_dmg",
    "nature":   "nature_dmg",
    "physical": "physical_dmg",
}

SKILL_TYPE_DMG_STAT = {
    "attack":   "attack_dmg_bonus",
    "skill":    "skill_dmg_bonus",
    "link":     "link_dmg_bonus",
    "ultimate": "ultimate_dmg_bonus",
}


@dataclass
class DamageBreakdown:
    attack: float
    multiplier: float
    damage_bonus: float          # 增伤系数（已含 1）
    defense_factor: float        # 防御系数
    resistance_factor: float     # 抗性系数
    stagger_factor: float        # 失衡系数
    vulnerability_factor: float  # 易伤系数
    fragile_factor: float        # 脆弱系数
    amplify_factor: float        # 增幅系数
    special_factor: float        # 特殊系数
    crit_factor: float           # 暴击系数
    final_damage: float

    def as_dict(self) -> dict:
        return {
            "attack": round(self.attack, 2),
            "multiplier": round(self.multiplier, 4),
            "damage_bonus": round(self.damage_bonus, 4),
            "defense_factor": round(self.defense_factor, 4),
            "resistance_factor": round(self.resistance_factor, 4),
            "stagger_factor": round(self.stagger_factor, 4),
            "vulnerability_factor": round(self.vulnerability_factor, 4),
            "fragile_factor": round(self.fragile_factor, 4),
            "amplify_factor": round(self.amplify_factor, 4),
            "special_factor": round(self.special_factor, 4),
            "crit_factor": round(self.crit_factor, 4),
            "final_damage": round(self.final_damage, 2),
        }


def calc_damage_bonus(
    stats: dict,
    element: ElementType,
    skill_type: SkillType,
    extra_dmg_bonus: float = 0.0,
) -> float:
    """
    增伤乘区：内部加算，最终得到 (1 + 总加成) 系数。
    包含：元素伤害加成、法术伤害加成（灼热/电磁/寒冷/自然均生效）、
         技能类型加成、所有技能伤害加成、额外传入加成。
    所有 stat 均以百分比点数存储（如 27.8 代表 +27.8%）。
    """
    total_pct = 0.0

    # 元素伤害加成
    elem_stat = ELEMENT_DMG_STAT.get(element, "physical_dmg")
    total_pct += stats.get(elem_stat, 0.0)

    # 法术伤害加成（对四种法术元素生效）
    if element in ARTS_ELEMENTS:
        total_pct += stats.get("arts_dmg", 0.0)

    # 技能类型加成
    type_stat = SKILL_TYPE_DMG_STAT.get(skill_type, "attack_dmg_bonus")
    total_pct += stats.get(type_stat, 0.0)

    # 所有技能伤害加成
    total_pct += stats.get("all_skill_dmg_bonus", 0.0)

    # 额外传入
    total_pct += extra_dmg_bonus

    return 1.0 + total_pct / 100.0


def calculate_hit(
    *,
    attack: float,
    multiplier: float,
    skill_type: SkillType,
    element: ElementType,
    stats: dict,
    # 敌人
    enemy_resistance: float = 0.0,
    enemy_is_broken: bool = False,
    # 可选乘区
    penetration: float = 0.0,       # 抗性穿透
    vulnerability: float = 0.0,     # 易伤加成（%点）
    fragile: float = 0.0,           # 脆弱加成（%点）
    amplify: float = 0.0,           # 增幅加成（%点）
    special_factor: float = 1.0,    # 特殊系数（内部相乘，这里传入已乘积值）
    crit_mode: Literal["none", "expected", "crit"] = "expected",
    extra_dmg_bonus: float = 0.0,
) -> DamageBreakdown:
    """
    计算单次技能命中伤害，返回各乘区详细拆解。
    """
    # 1. 攻击力（已由调用方计算好）

    # 2. 增伤
    dmg_bonus = calc_damage_bonus(stats, element, skill_type, extra_dmg_bonus)

    # 3. 防御（固定 0.5）
    defense_factor = 0.5

    # 4. 抗性
    resistance_factor = 1.0 + 0.01 * (penetration - enemy_resistance)

    # 5. 失衡
    stagger_factor = 1.3 if enemy_is_broken else 1.0

    # 6. 易伤
    vulnerability_factor = 1.0 + vulnerability / 100.0

    # 7. 脆弱
    fragile_factor = 1.0 + fragile / 100.0

    # 8. 增幅
    amplify_factor = 1.0 + amplify / 100.0

    # 9. 暴击
    crit_rate = min(stats.get("crit_rate", 0.0), 1.0)
    crit_dmg = stats.get("crit_dmg", 1.5)
    if crit_mode == "none":
        crit_factor = 1.0
    elif crit_mode == "crit":
        crit_factor = crit_dmg
    else:  # expected
        crit_factor = 1.0 + crit_rate * (crit_dmg - 1.0)

    final = (
        attack
        * multiplier
        * dmg_bonus
        * defense_factor
        * resistance_factor
        * stagger_factor
        * vulnerability_factor
        * fragile_factor
        * amplify_factor
        * special_factor
        * crit_factor
    )

    return DamageBreakdown(
        attack=attack,
        multiplier=multiplier,
        damage_bonus=dmg_bonus,
        defense_factor=defense_factor,
        resistance_factor=resistance_factor,
        stagger_factor=stagger_factor,
        vulnerability_factor=vulnerability_factor,
        fragile_factor=fragile_factor,
        amplify_factor=amplify_factor,
        special_factor=special_factor,
        crit_factor=crit_factor,
        final_damage=final,
    )
