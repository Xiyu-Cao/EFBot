"""
Build script to package the FastAPI backend as a standalone executable
using PyInstaller, for use as a Tauri sidecar.

Usage:
    py -3.12 build_sidecar.py
"""
import subprocess
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).parent
DIST_NAME = "efbot-api"
TARGET_TRIPLE = "x86_64-pc-windows-msvc"
OUTPUT_DIR = ROOT.parent / "endaxis-web" / "src-tauri" / "binaries"

def main():
    pyinstaller = [sys.executable, "-m", "PyInstaller"]

    cmd = [
        *pyinstaller,
        "--onefile",
        "--name", DIST_NAME,
        "--add-data", f"data_engine/characters.json;data_engine",
        "--add-data", f"data_engine/equipment.json;data_engine",
        "--add-data", f"data_engine/character_defaults.json;data_engine",
        "--hidden-import", "uvicorn.logging",
        "--hidden-import", "uvicorn.loops",
        "--hidden-import", "uvicorn.loops.auto",
        "--hidden-import", "uvicorn.protocols",
        "--hidden-import", "uvicorn.protocols.http",
        "--hidden-import", "uvicorn.protocols.http.auto",
        "--hidden-import", "uvicorn.protocols.websockets",
        "--hidden-import", "uvicorn.protocols.websockets.auto",
        "--hidden-import", "uvicorn.lifespan",
        "--hidden-import", "uvicorn.lifespan.on",
        "--hidden-import", "uvicorn.lifespan.off",
        "--clean",
        "--noconfirm",
        "main.py",
    ]

    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(ROOT))
    if result.returncode != 0:
        print("PyInstaller build failed!")
        sys.exit(1)

    src = ROOT / "dist" / f"{DIST_NAME}.exe"
    dst = OUTPUT_DIR / f"{DIST_NAME}-{TARGET_TRIPLE}.exe"

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(str(src), str(dst))
    print(f"\nSidecar copied to: {dst}")
    print(f"Size: {dst.stat().st_size / 1024 / 1024:.1f} MB")

if __name__ == "__main__":
    main()
