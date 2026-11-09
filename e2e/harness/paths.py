"""仓库与产物路径。"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
E2E = ROOT / "e2e"
TMP = ROOT / ".tmp-test" / "e2e"


def default_exe() -> Path:
    """被测 GUI 二进制：TL_E2E_EXE > release > debug（需为内嵌前端的构建）。"""
    env = os.environ.get("TL_E2E_EXE")
    if env:
        return Path(env)
    for profile in ("release", "debug"):
        p = ROOT / "src-tauri" / "target" / profile / "tag-launcher.exe"
        if p.exists():
            return p
    return ROOT / "src-tauri" / "target" / "debug" / "tag-launcher.exe"


def default_cli() -> Path:
    env = os.environ.get("TL_E2E_CLI")
    if env:
        return Path(env)
    for profile in ("release", "debug"):
        p = ROOT / "src-tauri" / "target" / profile / "tl.exe"
        if p.exists():
            return p
    return ROOT / "src-tauri" / "target" / "debug" / "tl.exe"
