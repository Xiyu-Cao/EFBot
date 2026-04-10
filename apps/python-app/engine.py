"""
engine.py — EFBot 核心模拟引擎（Python 重写）

完整移植自 apps/endaxis-web/src/simulation/ 的以下模块：
  - TeamState.ts       → TeamState
  - EnemyState.ts      → EnemyState
  - CalculationPipeline.ts + OriginiumArtsModifier → CalculationPipeline
  - DamageHandler.ts   → _process_damage_tick
  - StaggerChangeHandler.ts → _process_stagger_change
  - compileScenario.ts → DEFAULT_SYSTEM_CONSTANTS

原 TS 代码中 DamageHandler 的伤害计算为 TODO，此处根据游戏公式完整实现：
  base_damage = attack × (stagger_weight / normalizer)
              × skill_type_multiplier
              × expected_crit          # 1 + crit_rate × (crit_dmg - 1)
              × element_bonus          # 1 + element_dmg%
              × broken_bonus           # 1 + broken_dmg_bonus (敌人失衡时)
              × originium_arts_bonus   # 1 + arts_power × 0.005 (击飞/倒地时)
"""
from __future__ import annotations

import heapq
from dataclasses import dataclass, field
from typing import Any


# ── 系统默认常量（来自 compileScenario.ts DEFAULT_SYSTEM_CONSTANTS）──────────
DEFAULT_SYSTEM_CONSTANTS = {
    "maxSp": 300,
    "initialSp": 200,
    "spRegenRate": 8,           # SP/秒
    "skillSpCostDefault": 100,
    "linkCdReduction": 0,
    "maxStagger": 100,
    "staggerNodeCount": 0,
    "staggerNodeDuration": 2,   # 秒
    "staggerBreakDuration": 10, # 秒
    "executionRecovery": 25,    # 处决后SP回复
}

# SP 冻结时长（来自 ActionStartHandler.ts）
SP_FREEZE = {"skill": 0.5, "link": 1.5, "ultimate": 1.5}

# 伤害 Stagger 归一化系数（用于将 stagger 值转换为相对伤害权重）
STAGGER_NORMALIZER = 10.0


# ═══════════════════════════════════════════════════════════════════════════
# 1. 计算流水线（CalculationPipeline.ts）
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class BreakdownEntry:
    source: str
    type: str        # "BASE" | "MULTIPLIER" | "FLAT"
    value: float
    contribution: float


@dataclass
class CalculationResult:
    base_value: float
    final_value: float
    breakdown: list[BreakdownEntry] = field(default_factory=list)


class CalculationPipeline:
    """
    移植自 CalculationPipeline.ts
    链式调用 modifier 函数，每个 modifier 就地修改 CalculationResult。
    """

    def __init__(self):
        self._modifiers: list = []

    def add(self, modifier) -> "CalculationPipeline":
        self._modifiers.append(modifier)
        return self

    def execute(self, ctx: dict, initial_base: float) -> CalculationResult:
        result = CalculationResult(
            base_value=initial_base,
            final_value=initial_base,
            breakdown=[BreakdownEntry("Base Value", "BASE", initial_base, initial_base)],
        )
        for mod in self._modifiers:
            mod(ctx, result)
        result.final_value = round(result.final_value * 1000) / 1000
        return result


def originium_arts_modifier(ctx: dict, result: CalculationResult):
    """
    移植自 OriginiumArtsModifier（CalculationPipeline.ts）
    当敌人处于 PHYSICAL_LIFT 或 PHYSICAL_KNOCK_DOWN 状态时，
    源石技艺强度提供额外失衡增益。
    公式: multiplier = 1 + arts_power × 0.005
    """
    enemy_effects = ctx.get("enemy_effects", set())
    if "PHYSICAL_LIFT" not in enemy_effects and "PHYSICAL_KNOCK_DOWN" not in enemy_effects:
        return
    arts_power = ctx.get("source_stats", {}).get("originium_arts_power", 0)
    if arts_power <= 0:
        return

    multiplier = 1 + arts_power * 0.005
    prev = result.final_value
    result.final_value = prev * multiplier
    result.breakdown.append(BreakdownEntry(
        "Knock Bonus", "MULTIPLIER", multiplier, result.final_value - prev
    ))


def damage_modifier(ctx: dict, result: CalculationResult):
    """
    原 DamageHandler.ts 中的 TODO：伤害计算
    完整实现公式：
      base = attack × stagger_weight / STAGGER_NORMALIZER
      × expected_crit × element_bonus × type_bonus × broken_bonus
    """
    stats = ctx.get("source_stats", {})
    enemy = ctx.get("enemy_snap", {})
    action_type = ctx.get("action_type", "attack")

    attack = stats.get("attack", 1000)
    crit_rate = min(stats.get("crit_rate", 0), 1.0)
    crit_dmg = stats.get("crit_dmg", 1.5)

    # 期望暴击系数
    expected_crit = 1 + crit_rate * (crit_dmg - 1)

    # 元素伤害加成
    element = ctx.get("element", "physical")
    element_stat_map = {
        "blaze":    "blaze_dmg",
        "emag":     "emag_dmg",
        "cold":     "cold_dmg",
        "nature":   "nature_dmg",
        "physical": "physical_dmg",
    }
    element_bonus = 1 + stats.get(element_stat_map.get(element, "physical_dmg"), 0) / 100

    # 技能类型加成
    type_bonus_map = {
        "attack":   "attack_dmg_bonus",
        "skill":    "skill_dmg_bonus",
        "link":     "link_dmg_bonus",
        "ultimate": "ultimate_dmg_bonus",
    }
    type_bonus = 1 + stats.get(type_bonus_map.get(action_type, "attack_dmg_bonus"), 0) / 100
    all_skill_bonus = 1 + stats.get("all_skill_dmg_bonus", 0) / 100

    # 失衡目标加成
    broken_bonus = 1.0
    if enemy.get("is_broken") and action_type != "attack":
        broken_bonus = 1 + stats.get("broken_dmg_bonus", 0) / 100

    # 伤害权重（用 stagger 值作为相对权重）
    stagger_weight = ctx.get("stagger", STAGGER_NORMALIZER)
    weight_ratio = stagger_weight / STAGGER_NORMALIZER

    base = attack * weight_ratio
    final = base * expected_crit * element_bonus * type_bonus * all_skill_bonus * broken_bonus

    prev = result.final_value
    result.final_value = final
    result.breakdown = [
        BreakdownEntry("Attack × Weight", "BASE", base, base),
        BreakdownEntry("Expected Crit", "MULTIPLIER", expected_crit, base * (expected_crit - 1)),
        BreakdownEntry(f"{element} Bonus", "MULTIPLIER", element_bonus, 0),
        BreakdownEntry(f"{action_type} Type Bonus", "MULTIPLIER", type_bonus, 0),
        BreakdownEntry("All Skill Bonus", "MULTIPLIER", all_skill_bonus, 0),
        BreakdownEntry("Broken Bonus", "MULTIPLIER", broken_bonus, final - prev),
    ]


# ═══════════════════════════════════════════════════════════════════════════
# 2. 队伍 SP 状态（TeamState.ts）
# ═══════════════════════════════════════════════════════════════════════════

class TeamState:
    """移植自 TeamState.ts"""

    def __init__(self, config: dict):
        self.max_sp: float = config["maxSp"]
        self.sp: float = config["initialSp"]
        self.regen_rate: float = config["spRegenRate"]
        self.skill_cost: float = config["skillSpCostDefault"]
        self._pause_remaining: float = 0.0

    def advance_time(self, dt: float):
        if self.sp >= self.max_sp:
            return
        if self._pause_remaining > 0:
            if dt <= self._pause_remaining:
                self._pause_remaining -= dt
                return
            dt -= self._pause_remaining
            self._pause_remaining = 0.0
        self.sp = min(self.sp + dt * self.regen_rate, self.max_sp)

    def modify_sp(self, amount: float) -> float:
        if amount == 0:
            return self.sp
        self.sp = min(self.sp + amount, self.max_sp)
        return self.sp

    def pause_regen(self, duration: float):
        self._pause_remaining += duration

    def can_use_skill(self) -> bool:
        return self.sp >= self.skill_cost

    def snapshot(self) -> dict:
        return {
            "sp": round(self.sp, 3),
            "max_sp": self.max_sp,
            "regen_rate": self.regen_rate,
            "pause_remaining": round(self._pause_remaining, 3),
        }


# ═══════════════════════════════════════════════════════════════════════════
# 3. 敌人失衡状态（EnemyState.ts）
# ═══════════════════════════════════════════════════════════════════════════

class EnemyState:
    """移植自 EnemyState.ts"""

    def __init__(self, config: dict):
        self.max_stagger: float = config["maxStagger"]
        self.node_count: int = config["staggerNodeCount"]
        self.node_duration: float = config["staggerNodeDuration"]
        self.break_duration: float = config["staggerBreakDuration"]
        self.execution_recovery: float = config["executionRecovery"]

        self._stagger: float = 0.0
        self._break_end: float = 0.0
        self._lock_end: float = -1.0
        self._node_step: float = self.max_stagger / (self.node_count + 1)
        self.effects: set[str] = set()

    def is_broken(self, t: float) -> bool:
        return t < self._break_end - 1e-4

    def is_locked(self, t: float) -> bool:
        return t < self._lock_end - 1e-4

    def add_stagger(self, amount: float, t: float) -> dict:
        if self.is_broken(t):
            return {"broken": True}

        old = self._stagger
        self._stagger = max(0, self._stagger + amount)

        if self.is_locked(t):
            return {"broken": False}

        if self._stagger >= self.max_stagger - 1e-4:
            self._stagger = 0.0
            break_end = t + self.break_duration
            self._break_end = break_end
            self._lock_end = break_end
            return {"broken": True, "break_end": break_end}

        if self.node_count > 0:
            prev_node = int(old / self._node_step + 1e-4)
            curr_node = int(self._stagger / self._node_step + 1e-4)
            if curr_node > prev_node:
                node_end = t + self.node_duration
                self._lock_end = node_end
                return {"broken": False, "node_index": curr_node, "node_end": node_end}

        return {"broken": False}

    def get_stagger(self) -> float:
        return self._stagger

    def snapshot(self, t: float) -> dict:
        return {
            "stagger": round(self._stagger, 3),
            "max_stagger": self.max_stagger,
            "is_broken": self.is_broken(t),
            "is_locked": self.is_locked(t),
            "break_end": round(self._break_end, 3),
            "lock_end": round(self._lock_end, 3),
        }


# ═══════════════════════════════════════════════════════════════════════════
# 4. 主模拟器（simulator.ts）
# ═══════════════════════════════════════════════════════════════════════════

@dataclass(order=True)
class SimEvent:
    time: float
    seq: int
    type: str = field(compare=False)
    payload: dict = field(default_factory=dict, compare=False)


class DamageSimulator:
    """
    基于原 Endaxis 机制的单角色/单队伍 DPS 模拟器。
    输入：角色技能数据 + 用户配置的属性
    输出：SP曲线、失衡事件、每 tick 伤害、DPS 统计
    """

    def __init__(
        self,
        character: dict,
        actor_stats: dict,
        system_constants: dict | None = None,
        simulation_duration: float = 60.0,
    ):
        self.char = character
        self.stats = actor_stats
        self.duration = simulation_duration

        sys = {**DEFAULT_SYSTEM_CONSTANTS, **(system_constants or {})}
        self.team = TeamState(sys)
        self.enemy = EnemyState(sys)

        # 伤害计算流水线
        self._dmg_pipeline = CalculationPipeline()
        self._dmg_pipeline.add(damage_modifier)

        self._stagger_pipeline = CalculationPipeline()
        self._stagger_pipeline.add(originium_arts_modifier)

        self._log: list[dict] = []
        self._total_damage: float = 0.0
        self._seq: int = 0

    # ── 内部事件队列 ──────────────────────────────────────────────────────
    def _push(self, t: float, etype: str, payload: dict):
        self._seq += 1
        heapq.heappush(self._queue, SimEvent(t, self._seq, etype, payload))

    # ── 技能事件调度 ──────────────────────────────────────────────────────
    def _schedule_skill(self, t: float):
        skill = {
            "type": "skill",
            "duration": self.char.get("skill_duration", 0.8),
            "sp_cost": self.char.get("skill_spCost", DEFAULT_SYSTEM_CONSTANTS["skillSpCostDefault"]),
            "gauge_gain": self.char.get("skill_gaugeGain", 0),
            "damage_ticks": self.char.get("skill_damage_ticks", []),
        }
        self._push(t, "ACTION_START", {"action": skill})

    def _schedule_link(self, t: float):
        link = {
            "type": "link",
            "duration": self.char.get("link_duration", 0.8),
            "sp_cost": 0,
            "gauge_gain": self.char.get("link_gaugeGain", 0),
            "damage_ticks": self.char.get("link_damage_ticks", []),
            "cooldown": self.char.get("link_cooldown", 16),
        }
        self._push(t, "ACTION_START", {"action": link})

    def _schedule_ultimate(self, t: float):
        ult = {
            "type": "ultimate",
            "duration": self.char.get("ultimate_duration", 1.5),
            "sp_cost": self.char.get("ultimate_gaugeMax", 80),
            "gauge_gain": 0,
            "damage_ticks": self.char.get("ultimate_damage_ticks", []),
        }
        self._push(t, "ACTION_START", {"action": ult})

    # ── 事件处理器 ────────────────────────────────────────────────────────
    def _handle_action_start(self, t: float, payload: dict):
        action = payload["action"]
        atype = action["type"]

        # SP 扣减
        if atype == "skill":
            self.team.modify_sp(-action["sp_cost"])
        # SP 冻结（ActionStartHandler.ts）
        self.team.pause_regen(SP_FREEZE.get(atype, 0.5))

        # 调度伤害 tick
        for tick in action["damage_ticks"]:
            tick_t = round(t + (tick.get("offset", 0)) * 1000) / 1000
            self._push(tick_t, "DAMAGE_TICK", {
                "action_type": atype,
                "stagger": tick.get("stagger", 0),
                "sp_gain": tick.get("sp", 0),
                "element": self.char.get("element", "physical"),
            })

        # 调度 ACTION_END
        end_t = round((t + action["duration"]) * 1000) / 1000
        self._push(end_t, "ACTION_END", {"action": action})

    def _handle_action_end(self, t: float, payload: dict):
        action = payload["action"]
        atype = action["type"]

        # 处决后 SP 回复（ActionEndHandler.ts）
        if atype == "execution":
            self.team.modify_sp(self.enemy.execution_recovery)

        # 调度下一次技能
        if atype == "skill" and self.team.can_use_skill():
            next_skill_t = round((t + 0.1) * 1000) / 1000
            if next_skill_t < self.duration:
                self._push(next_skill_t, "SKILL_READY", {})
        elif atype == "skill":
            # 等待 SP 足够
            sp_needed = DEFAULT_SYSTEM_CONSTANTS["skillSpCostDefault"] - self.team.sp
            wait = max(0.1, sp_needed / self.team.regen_rate)
            next_t = round((t + wait) * 1000) / 1000
            if next_t < self.duration:
                self._push(next_t, "SKILL_READY", {})

    def _handle_damage_tick(self, t: float, payload: dict):
        stagger_val = payload["stagger"]
        action_type = payload["action_type"]
        element = payload["element"]

        enemy_snap = self.enemy.snapshot(t)

        # 伤害计算
        dmg_ctx = {
            "source_stats": self.stats,
            "enemy_snap": enemy_snap,
            "action_type": action_type,
            "element": element,
            "stagger": stagger_val,
            "enemy_effects": self.enemy.effects,
        }
        dmg_result = self._dmg_pipeline.execute(dmg_ctx, stagger_val)
        damage = dmg_result.final_value
        self._total_damage += damage

        # SP 回复（击中）
        if payload.get("sp_gain", 0) > 0:
            self.team.modify_sp(payload["sp_gain"])

        # 失衡处理（StaggerChangeHandler.ts）
        if stagger_val > 0:
            stagger_ctx = {
                "source_stats": self.stats,
                "enemy_effects": self.enemy.effects,
            }
            stagger_result = self._stagger_pipeline.execute(stagger_ctx, stagger_val)
            stagger_event = self.enemy.add_stagger(stagger_result.final_value, t)

            if stagger_event.get("broken"):
                self._log.append({
                    "type": "STAGGER_BREAK",
                    "time": t,
                    "break_end": stagger_event.get("break_end", t + 10),
                })

        self._log.append({
            "type": "DAMAGE_TICK",
            "time": t,
            "action_type": action_type,
            "damage": round(damage, 2),
            "stagger": round(stagger_result.final_value if stagger_val > 0 else 0, 3),
            "sp": round(self.team.sp, 1),
            "enemy_stagger": round(self.enemy.get_stagger(), 1),
        })

    def _handle_skill_ready(self, t: float):
        if t >= self.duration:
            return
        if self.team.can_use_skill():
            self._schedule_skill(t)
        else:
            sp_needed = DEFAULT_SYSTEM_CONSTANTS["skillSpCostDefault"] - self.team.sp
            wait = max(0.1, sp_needed / self.team.regen_rate)
            next_t = round((t + wait) * 1000) / 1000
            if next_t < self.duration:
                self._push(next_t, "SKILL_READY", {})

    # ── 主模拟循环 ────────────────────────────────────────────────────────
    def run(self) -> dict:
        self._queue: list[SimEvent] = []
        self._log = []
        self._total_damage = 0.0

        # 初始事件：t=0 使用技能
        self._schedule_skill(0.0)

        # 连携技首次调度（如有）
        link_cd = self.char.get("link_cooldown", 16)
        if self.char.get("link_damage_ticks"):
            self._push(link_cd, "LINK_READY", {"cooldown": link_cd})

        # 终结技调度（如有 gauge）
        if self.char.get("ultimate_damage_ticks"):
            ult_gauge_max = self.char.get("ultimate_gaugeMax", 80)
            ult_ready_t = ult_gauge_max / DEFAULT_SYSTEM_CONSTANTS["spRegenRate"]
            self._push(ult_ready_t, "ULTIMATE_READY", {})

        last_t = 0.0
        while self._queue:
            event = heapq.heappop(self._queue)
            t = event.time

            if t > self.duration:
                break

            # 推进 SP 时间
            dt = t - last_t
            if dt > 0:
                self.team.advance_time(dt)
            last_t = t

            etype = event.type
            payload = event.payload

            if etype == "ACTION_START":
                self._handle_action_start(t, payload)
            elif etype == "ACTION_END":
                self._handle_action_end(t, payload)
            elif etype == "DAMAGE_TICK":
                self._handle_damage_tick(t, payload)
            elif etype == "SKILL_READY":
                self._handle_skill_ready(t)
            elif etype == "LINK_READY":
                if t < self.duration:
                    self._schedule_link(t)
                    next_link = round((t + payload["cooldown"]) * 1000) / 1000
                    self._push(next_link, "LINK_READY", payload)
            elif etype == "ULTIMATE_READY":
                if t < self.duration:
                    self._schedule_ultimate(t)
                    ult_gauge_max = self.char.get("ultimate_gaugeMax", 80)
                    next_ult = round((t + ult_gauge_max / DEFAULT_SYSTEM_CONSTANTS["spRegenRate"]) * 1000) / 1000
                    self._push(next_ult, "ULTIMATE_READY", {})

        damage_events = [e for e in self._log if e["type"] == "DAMAGE_TICK"]
        stagger_breaks = [e for e in self._log if e["type"] == "STAGGER_BREAK"]

        return {
            "character_id": self.char.get("id"),
            "character_name": self.char.get("name"),
            "duration_seconds": self.duration,
            "total_damage": round(self._total_damage, 2),
            "average_dps": round(self._total_damage / self.duration, 2),
            "damage_ticks": len(damage_events),
            "stagger_breaks": len(stagger_breaks),
            "sp_final": round(self.team.sp, 1),
            "log": self._log,
        }
