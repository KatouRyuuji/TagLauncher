"""每个用例一个沙箱：重定向 LOCALAPPDATA / APPDATA / ProgramFiles / TEMP / WebView2。

注意（spike 结论）：Tauri 的 app_data_dir / app_log_dir 走 SHGetKnownFolderPath，
不认环境变量；这部分（窗口状态 .window-state.json、日志）由 integrity.RealDirGuard
在会话前后快照并还原。
"""
from __future__ import annotations

import json
import os
import shutil
import socket
from dataclasses import dataclass, field
from pathlib import Path


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@dataclass
class Sandbox:
    root: Path
    exe_src: Path
    env_extra: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        for sub in ("LocalAppData", "AppData", "ProgramFiles", "ProgramFilesX86", "Temp", "WebView2", "bin", "Files", "artifacts"):
            (self.root / sub).mkdir(exist_ok=True)

    # ---- 目录 ----
    @property
    def bin(self) -> Path:
        return self.root / "bin"

    @property
    def exe(self) -> Path:
        return self.bin / "tag-launcher.exe"

    @property
    def files(self) -> Path:
        return self.root / "Files"

    @property
    def artifacts(self) -> Path:
        return self.root / "artifacts"

    @property
    def default_save_dir(self) -> Path:
        return self.root / "LocalAppData" / "TagLauncher" / "Save"

    @property
    def save_dir(self) -> Path:
        redirect = self.bin / "datapath.json"
        if redirect.exists():
            try:
                return Path(json.loads(redirect.read_text(encoding="utf-8"))["save_dir"])
            except Exception:
                pass
        return self.default_save_dir

    @property
    def db_path(self) -> Path:
        return self.save_dir / "taglauncher.db"

    @property
    def mods_dir(self) -> Path:
        return self.bin / "Plugins_Mods"

    @property
    def themes_dir(self) -> Path:
        return self.bin / "Plugins_Theme"

    def install_exe(self) -> Path:
        if not self.exe.exists():
            shutil.copy2(self.exe_src, self.exe)
        return self.exe

    def redirect_data(self, save_dir: Path) -> None:
        (self.bin / "datapath.json").write_text(json.dumps({"save_dir": str(save_dir)}), encoding="utf-8")

    def env(self, cdp_port: int | None) -> dict:
        env = dict(os.environ)

        def put(k: str, v: str) -> None:
            # Windows 环境变量大小写不敏感，os.environ 键已大写：先删同名异写键，避免环境块出现重复键
            for old in [x for x in env if x.upper() == k.upper()]:
                del env[old]
            env[k] = v
        put("LOCALAPPDATA", str(self.root / "LocalAppData"))
        put("APPDATA", str(self.root / "AppData"))
        put("ProgramFiles", str(self.root / "ProgramFiles"))
        # 64 位子进程启动时 Windows 会用 ProgramW6432 覆盖 ProgramFiles，必须一起重定向
        put("ProgramW6432", str(self.root / "ProgramFiles"))
        put("ProgramFiles(x86)", str(self.root / "ProgramFilesX86"))
        put("TEMP", str(self.root / "Temp"))
        put("TMP", str(self.root / "Temp"))
        put("WEBVIEW2_USER_DATA_FOLDER", str(self.root / "WebView2"))
        if cdp_port:
            put("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", f"--remote-debugging-port={cdp_port} "
                # 窗口在屏幕外（harness.stealth）：不要按“被遮挡/后台”降帧或停渲染
                "--disable-features=CalculateNativeWinOcclusion "
                "--disable-backgrounding-occluded-windows --disable-renderer-backgrounding "
                "--disable-background-timer-throttling")
        else:
            env.pop("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", None)
        # mock 服务都在回环地址上：绕开用户机器上可能存在的代理
        env["NO_PROXY"] = env["no_proxy"] = "127.0.0.1,localhost,::1"
        for k in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
            env.pop(k, None)
        for k, v in self.env_extra.items():
            put(k, v)
        return env
