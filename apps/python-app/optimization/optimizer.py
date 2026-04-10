"""
optimizer.py — 寻优器抽象基类 + 贪心基准实现

结构设计原则：
  所有寻优器继承 OptimizerBase，实现 optimize() 方法。
  未来 AI 模型（RL Agent、遗传算法等）只需实现同一接口即可无缝替换。
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class OptimizationRequest:
    """传入寻优器的请求结构"""
    character: dict[str, Any]
    equipment: list[dict[str, Any]]
    duration_frames: int = 3600
    constraints: dict[str, Any] = field(default_factory=dict)


@dataclass
class OptimizationResult:
    """寻优器返回的结果结构"""
    skill_sequence: list[dict[str, Any]]   # 推荐的技能释放顺序（帧 + 技能 ID）
    estimated_dps: float
    estimated_total_damage: float
    optimizer_name: str
    notes: str = ""


class OptimizerBase(ABC):
    """
    所有寻优器的抽象基类。
    实现新的 AI/ML 寻优策略时继承此类，重写 optimize()。
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """寻优器名称，用于日志和 API 响应"""

    @abstractmethod
    def optimize(self, request: OptimizationRequest) -> OptimizationResult:
        """
        给定角色和装备，返回最优（或次优）技能释放序列。

        Parameters
        ----------
        request : OptimizationRequest

        Returns
        -------
        OptimizationResult
        """


class GreedyOptimizer(OptimizerBase):
    """
    贪心基准寻优器。
    策略：每帧优先释放冷却时间最短、伤害倍率最高的技能。
    作为未来 AI 寻优器的性能基准线。
    """

    @property
    def name(self) -> str:
        return "GreedyOptimizer-v1"

    def optimize(self, request: OptimizationRequest) -> OptimizationResult:
        char = request.character
        stats = char["base_stats"]
        skills = char["skills"]
        duration = request.duration_frames

        # 简单贪心：按冷却帧排序，循环填充时间轴
        cooldowns = {s["id"]: 0 for s in skills}
        sequence = []
        total_damage = 0.0

        for frame in range(duration):
            for skill in sorted(skills, key=lambda s: -s["damage_multiplier"]):
                if cooldowns[skill["id"]] <= frame:
                    dmg = (
                        stats["attack"]
                        * stats["skill_multiplier"]
                        * skill["damage_multiplier"]
                        * (1 + stats["crit_rate"] * (stats["crit_damage"] - 1))
                    )
                    total_damage += dmg
                    cooldowns[skill["id"]] = frame + skill["cooldown_frames"]
                    sequence.append({"frame": frame, "skill_id": skill["id"], "damage": dmg})
                    break  # 每帧只释放一个技能

        duration_seconds = duration / 60.0  # 假设 60 帧/秒
        dps = total_damage / duration_seconds if duration_seconds > 0 else 0

        return OptimizationResult(
            skill_sequence=sequence[:50],  # 只返回前 50 条避免响应过大
            estimated_dps=dps,
            estimated_total_damage=total_damage,
            optimizer_name=self.name,
            notes="贪心基准：每帧选取冷却就绪且倍率最高的技能",
        )
