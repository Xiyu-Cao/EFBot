"""
optimization — AI 最优输出轴寻优模块（预留接口）

未来接入方向：
  - 遗传算法 / 模拟退火寻找最优技能释放顺序
  - 强化学习 Agent（PPO / DQN）在模拟环境中自主寻优
  - 接入外部 LLM/ML 服务进行策略推荐
"""
from .optimizer import OptimizerBase, GreedyOptimizer

__all__ = ["OptimizerBase", "GreedyOptimizer"]
