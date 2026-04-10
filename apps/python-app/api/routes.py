"""
API 路由 — 连接 data_engine（真实角色/武器数据）与 engine.py（模拟引擎）
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from data_engine import DataLoader
from data_engine.damage_calc import calculate_hit, SkillType, ElementType
from engine import DamageSimulator, DEFAULT_SYSTEM_CONSTANTS
from optimization import GreedyOptimizer
from optimization.optimizer import OptimizationRequest

router = APIRouter()
loader = DataLoader()
_greedy = GreedyOptimizer()


# ── 兜底默认属性（角色无专属配置时使用）────────────────────────────────────
# 数据来源：Lv90基础攻击 × 1.44（武器large攻击槽潜能5 +25% + 装备约+15%）
# 暴击率：5%基础 + 武器12.5% + 护手精锻3 24.9% ≈ 42%
FALLBACK_ACTOR_STATS = {
    "attack": 450,
    "crit_rate": 0.42,
    "crit_dmg": 1.50,
    "physical_dmg": 0,
    "blaze_dmg": 0,
    "emag_dmg": 0,
    "cold_dmg": 0,
    "nature_dmg": 0,
    "attack_dmg_bonus": 0,
    "skill_dmg_bonus": 44.9,
    "link_dmg_bonus": 0,
    "ultimate_dmg_bonus": 0,
    "all_skill_dmg_bonus": 0,
    "broken_dmg_bonus": 0,
    "originium_arts_power": 0,
}


def get_default_stats(character_id: str) -> dict:
    """按角色 ID 返回满配默认属性，无专属数据时用 FALLBACK。"""
    defaults = loader.get_character_defaults(character_id)
    if not defaults:
        return FALLBACK_ACTOR_STATS.copy()
    base = FALLBACK_ACTOR_STATS.copy()
    # 覆盖角色专属字段
    for key in ("attack", "hp", "crit_rate", "crit_dmg",
                "physical_dmg", "blaze_dmg", "emag_dmg",
                "cold_dmg", "nature_dmg", "skill_dmg_bonus"):
        if key in defaults:
            base[key] = defaults[key]
    return base


# ── 健康检查 ─────────────────────────────────────────────────────────────────
@router.get("/health")
def health():
    return {
        "status": "ok",
        "service": "efbot-python-engine",
        "characters_loaded": len(loader.get_all_characters()),
        "weapons_loaded": len(loader.get_all_weapons()),
    }


# ── 角色查询 ─────────────────────────────────────────────────────────────────
@router.get("/characters")
def get_characters():
    """返回所有角色（含技能 timing、stagger、SP 数据）"""
    chars = loader.get_all_characters()
    # 返回面板所需的精简字段
    return [
        {
            "id": c["id"],
            "name": c["name"],
            "rarity": c.get("rarity"),
            "element": c.get("element"),
            "weapon": c.get("weapon"),
            "skill_duration": c.get("skill_duration"),
            "skill_spCost": c.get("skill_spCost"),
            "link_cooldown": c.get("link_cooldown"),
            "ultimate_gaugeMax": c.get("ultimate_gaugeMax"),
            "attack_segments": len(c.get("attack_segments", [])),
            "skill_ticks": len(c.get("skill_damage_ticks", [])),
            "link_ticks": len(c.get("link_damage_ticks", [])),
            "ultimate_ticks": len(c.get("ultimate_damage_ticks", [])),
        }
        for c in chars
    ]


@router.get("/characters/{character_id}")
def get_character(character_id: str):
    char = loader.get_character(character_id)
    if not char:
        raise HTTPException(status_code=404, detail=f"角色 '{character_id}' 不存在")
    return char


# ── 武器查询 ─────────────────────────────────────────────────────────────────
@router.get("/weapons")
def get_weapons():
    return loader.get_all_weapons()


@router.get("/equipment")
def get_equipment_list():
    return loader.get_all_equipment()


# ── DPS 模拟（engine.py 驱动）────────────────────────────────────────────────
def _merge_stats(character_id: str, override: "ActorStatsInput") -> dict:
    """将角色满配默认值与请求中显式传入的字段合并，None 字段不覆盖默认值。"""
    base = get_default_stats(character_id)
    for key, val in override.model_dump().items():
        if val is not None:
            base[key] = val
    return base


class ActorStatsInput(BaseModel):
    """所有字段均为可选，未传则从 character_defaults.json 取满配值。"""
    attack: float | None = Field(default=None, ge=0)
    crit_rate: float | None = Field(default=None, ge=0, le=1)
    crit_dmg: float | None = Field(default=None, ge=1)
    physical_dmg: float | None = None
    blaze_dmg: float | None = None
    emag_dmg: float | None = None
    cold_dmg: float | None = None
    nature_dmg: float | None = None
    attack_dmg_bonus: float | None = None
    skill_dmg_bonus: float | None = None
    link_dmg_bonus: float | None = None
    ultimate_dmg_bonus: float | None = None
    all_skill_dmg_bonus: float | None = None
    broken_dmg_bonus: float | None = None
    originium_arts_power: float | None = None


class SimulateRequest(BaseModel):
    character_id: str
    duration_seconds: float = Field(default=60.0, ge=5, le=600)
    actor_stats: ActorStatsInput = Field(default_factory=ActorStatsInput)
    system_constants: dict = Field(default_factory=dict)


@router.post("/simulate")
def simulate(req: SimulateRequest):
    char = loader.get_character(req.character_id)
    if not char:
        raise HTTPException(status_code=404, detail=f"角色 '{req.character_id}' 不存在")

    stats = _merge_stats(req.character_id, req.actor_stats)
    sys_const = {**DEFAULT_SYSTEM_CONSTANTS, **req.system_constants}

    sim = DamageSimulator(
        character=char,
        actor_stats=stats,
        system_constants=sys_const,
        simulation_duration=req.duration_seconds,
    )
    result = sim.run()

    result.pop("log", None)
    result["attack_used"] = stats["attack"]
    result["crit_rate_used"] = stats["crit_rate"]
    result["crit_dmg_used"] = stats["crit_dmg"]
    return result


@router.post("/simulate/detail")
def simulate_detail(req: SimulateRequest):
    """与 /simulate 相同，但附带完整 tick 日志（用于时间轴可视化）"""
    char = loader.get_character(req.character_id)
    if not char:
        raise HTTPException(status_code=404, detail=f"角色 '{req.character_id}' 不存在")

    stats = _merge_stats(req.character_id, req.actor_stats)
    sys_const = {**DEFAULT_SYSTEM_CONSTANTS, **req.system_constants}

    sim = DamageSimulator(
        character=char,
        actor_stats=stats,
        system_constants=sys_const,
        simulation_duration=req.duration_seconds,
    )
    return sim.run()


# ── 技能伤害计算 ─────────────────────────────────────────────────────────────
class SkillHitInput(BaseModel):
    label: str = ""
    multiplier: float = Field(ge=0)


class EnemyCondition(BaseModel):
    resistance: float = Field(default=0.0)
    is_broken: bool = False
    vulnerability: float = Field(default=0.0, description="易伤加成（%点）")
    fragile: float = Field(default=0.0, description="脆弱加成（%点）")
    amplify: float = Field(default=0.0, description="增幅加成（%点）")


class SkillDamageRequest(BaseModel):
    character_id: str
    skill_type: SkillType = "skill"
    element: ElementType | None = None          # None → 取角色默认属性
    hits: list[SkillHitInput]
    actor_stats: ActorStatsInput = Field(default_factory=ActorStatsInput)
    enemy: EnemyCondition = Field(default_factory=EnemyCondition)
    penetration: float = Field(default=0.0, description="抗性穿透值")
    special_factor: float = Field(default=1.0, description="特殊系数（已乘积）")
    crit_mode: str = Field(default="expected", description="none / expected / crit")
    extra_dmg_bonus: float = Field(default=0.0, description="额外增伤（%点）")


@router.post("/skill-damage")
def skill_damage(req: SkillDamageRequest):
    """
    计算技能每段命中伤害，返回各乘区拆解。
    """
    char = loader.get_character(req.character_id)
    if not char:
        raise HTTPException(status_code=404, detail=f"角色 '{req.character_id}' 不存在")

    stats = _merge_stats(req.character_id, req.actor_stats)
    element: ElementType = req.element or char.get("element", "physical")

    results = []
    total = 0.0
    for hit in req.hits:
        bd = calculate_hit(
            attack=stats["attack"],
            multiplier=hit.multiplier,
            skill_type=req.skill_type,
            element=element,
            stats=stats,
            enemy_resistance=req.enemy.resistance,
            enemy_is_broken=req.enemy.is_broken,
            penetration=req.penetration,
            vulnerability=req.enemy.vulnerability,
            fragile=req.enemy.fragile,
            amplify=req.enemy.amplify,
            special_factor=req.special_factor,
            crit_mode=req.crit_mode,
            extra_dmg_bonus=req.extra_dmg_bonus,
        )
        total += bd.final_damage
        results.append({"label": hit.label, **bd.as_dict()})

    return {
        "character": char["name"],
        "element": element,
        "skill_type": req.skill_type,
        "crit_mode": req.crit_mode,
        "hits": results,
        "total_damage": round(total, 2),
    }


# ── AI 寻优（optimization/ 预留接口）────────────────────────────────────────
class OptimizeRequest(BaseModel):
    character_id: str
    duration_seconds: float = Field(default=60.0, ge=5, le=600)
    actor_stats: ActorStatsInput = Field(default_factory=ActorStatsInput)


@router.post("/optimize")
def optimize_rotation(req: OptimizeRequest):
    """
    AI 最优输出轴寻优（预留接口）。
    当前：GreedyOptimizer 占位。
    未来：替换为 RL Agent / 遗传算法。
    """
    char = loader.get_character(req.character_id)
    if not char:
        raise HTTPException(status_code=404, detail=f"角色 '{req.character_id}' 不存在")

    stats = _merge_stats(req.character_id, req.actor_stats)
    opt_req = OptimizationRequest(
        character=char,
        equipment=[],
        duration_frames=int(req.duration_seconds * 60),
    )
    result = _greedy.optimize(opt_req)
    return {
        "character": char["name"],
        "optimizer": result.optimizer_name,
        "estimated_dps": result.estimated_dps,
        "notes": result.notes,
    }
