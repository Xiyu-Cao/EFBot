"""
data_engine — 静态数据加载层
负责从 JSON 数据库读取角色、装备数据，并提供类型化访问接口。
"""
from .loader import DataLoader

__all__ = ["DataLoader"]
