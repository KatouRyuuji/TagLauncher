"""E-ENV-14：真实用户目录零变化 + 拒绝在用户真实实例运行时开跑。

Tauri 的 app_data_dir / app_log_dir 走 SHGetKnownFolderPath（不认环境变量），
沙箱运行会在真实 %APPDATA%\\com.taglauncher.app（.window-state.json）与
%LOCALAPPDATA%\\com.taglauncher.app\\logs 写文件（spike 实测）。RealDirGuard 在会话
开始时整目录快照，结束时删除并按快照还原，然后逐文件比对哈希。
"""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
from pathlib import Path

from .paths import TMP


def real_dirs() -> list[Path]:
    appdata = Path(os.environ["APPDATA"])
    local = Path(os.environ["LOCALAPPDATA"])
    return [appdata / "com.taglauncher.app", local / "com.taglauncher.app", local / "TagLauncher"]


def tree_digest(root: Path) -> dict[str, str] | None:
    if not root.exists():
        return None
    out: dict[str, str] = {}
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root).as_posix()
        if p.is_dir():
            out[rel + "/"] = "dir"
        else:
            out[rel] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


def foreign_instances(allowed_pids: set[int] = frozenset()) -> list[str]:
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command",
         "Get-Process tag-launcher -ErrorAction SilentlyContinue | ForEach-Object { \"$($_.Id)|$($_.Path)\" }"],
        capture_output=True, text=True, encoding="utf-8").stdout
    return [line for line in out.splitlines() if line.strip() and int(line.split("|")[0]) not in allowed_pids]


class RealDirGuard:
    def __init__(self, stash: Path | None = None):
        self.stash = stash or (TMP / "real-dir-stash")
        self.before: dict[str, dict | None] = {}

    def snapshot(self) -> None:
        if self.stash.exists():
            shutil.rmtree(self.stash)
        self.stash.mkdir(parents=True)
        for i, d in enumerate(real_dirs()):
            self.before[str(d)] = tree_digest(d)
            if d.exists():
                shutil.copytree(d, self.stash / str(i))

    def reset_window_state(self) -> None:
        """窗口用例之间共享真实 .window-state.json：每个用例前清掉，避免互相影响。"""
        (real_dirs()[0] / ".window-state.json").unlink(missing_ok=True)

    def window_state_path(self) -> Path:
        return real_dirs()[0] / ".window-state.json"

    def restore(self) -> dict[str, str]:
        """还原并返回差异报告（空 = 零变化）。"""
        report: dict[str, str] = {}
        for i, d in enumerate(real_dirs()):
            if d.exists():
                shutil.rmtree(d, ignore_errors=True)
            if (self.stash / str(i)).exists():
                shutil.copytree(self.stash / str(i), d)
            after = tree_digest(d)
            if after != self.before.get(str(d)):
                report[str(d)] = f"before={self.before.get(str(d))} after={after}"
        return report
