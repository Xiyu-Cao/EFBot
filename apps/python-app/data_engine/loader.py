"""
DataLoader — 从 JSON 文件加载真实游戏数据
数据来源：apps/endaxis-web/public/gamedata.json（提取后存储）
"""
from __future__ import annotations

import sys
import json
from pathlib import Path
from typing import Any


def _resolve_data_dir() -> Path:
    """PyInstaller 打包后数据文件被解压到 sys._MEIPASS 临时目录。"""
    if getattr(sys, "_MEIPASS", None):
        return Path(sys._MEIPASS) / "data_engine"
    return Path(__file__).parent


_DATA_DIR = _resolve_data_dir()


class DataLoader:
    def __init__(self):
        self._characters: list[dict[str, Any]] = self._load("characters.json")

        equipment_data = self._load("equipment.json")
        self._weapons: list[dict[str, Any]] = equipment_data.get("weapons", [])
        self._equipment: list[dict[str, Any]] = equipment_data.get("equipment", [])

        defaults_data = self._load("character_defaults.json")
        self._character_defaults: dict[str, Any] = defaults_data.get("characters", {})

    def _load(self, filename: str) -> Any:
        with open(_DATA_DIR / filename, encoding="utf-8") as f:
            return json.load(f)

    # ── 角色 ────────────────────────────────────────────────────────────────
    def get_all_characters(self) -> list[dict[str, Any]]:
        return self._characters

    def get_character(self, character_id: str) -> dict[str, Any] | None:
        return next((c for c in self._characters if c["id"] == character_id), None)

    # ── 武器 ────────────────────────────────────────────────────────────────
    def get_all_weapons(self) -> list[dict[str, Any]]:
        return self._weapons

    def get_weapon(self, weapon_id: str) -> dict[str, Any] | None:
        return next((w for w in self._weapons if w["id"] == weapon_id), None)

    # ── 装备 ────────────────────────────────────────────────────────────────
    def get_all_equipment(self) -> list[dict[str, Any]]:
        return self._equipment

    def get_equipment(self, equipment_id: str) -> dict[str, Any] | None:
        return next((e for e in self._equipment if e["id"] == equipment_id), None)

    # ── 角色满配默认值 ───────────────────────────────────────────────────────
    def get_character_defaults(self, character_id: str) -> dict[str, Any] | None:
        return self._character_defaults.get(character_id)
