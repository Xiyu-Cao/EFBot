"""
EFBot Python 计算内核 — FastAPI 入口
启动后在 http://0.0.0.0:8000 提供 REST API
"""
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router

app = FastAPI(
    title="EFBot 战斗模拟引擎",
    description="高精度战斗伤害模拟器 Python 计算内核",
    version="0.1.0",
)

# 允许 Tauri webview 和 Vite dev server 跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420", "http://localhost:5173", "tauri://localhost"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
