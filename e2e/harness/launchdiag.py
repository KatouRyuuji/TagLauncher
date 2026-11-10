"""GUI 启动诊断与会话级启动熔断。

每次启动记录：可执行文件、参数、工作目录、CDP 端口、各阶段耗时、进程存活/退出码、
应用 stdout/stderr 尾部。失败时写入沙箱 artifacts（launch-N.json + process-N.log），
并把要点写进异常消息，pytest 报告里直接可读。

熔断：本会话一次 GUI 启动都没成功、且已连续失败 FUSE 次时，后续启动不再等满超时，
立即以 StartupError 失败（用例仍记为 error，不跳过），并引用首个失败的诊断。
任一次启动成功即复位。环境变量只记录被测相关的少数键，不落盘完整环境。
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

# 只记录这些键（沙箱重定向与 WebView2 参数），绝不整体打印环境，避免泄露令牌
SAFE_ENV_KEYS = ("LOCALAPPDATA", "APPDATA", "TEMP", "WEBVIEW2_USER_DATA_FOLDER", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS")
LOG_TAIL_LINES = 60
MESSAGE_TAIL_CHARS = 2500


class StartupError(RuntimeError):
    """GUI 启动失败（含熔断）。"""


def fuse_threshold() -> int:
    try:
        return max(1, int(os.environ.get("TL_E2E_STARTUP_FUSE", "3")))
    except ValueError:
        return 3


@dataclass
class LaunchHealth:
    ok: int = 0
    consecutive_fail: int = 0
    first_error: str | None = None
    first_error_file: str | None = None

    def tripped(self, threshold: int) -> bool:
        return self.ok == 0 and self.consecutive_fail >= threshold

    def record_ok(self) -> None:
        self.ok += 1
        self.consecutive_fail = 0

    def record_fail(self, summary: str, diag_file: str | None) -> None:
        self.consecutive_fail += 1
        if self.first_error is None:
            self.first_error, self.first_error_file = summary, diag_file

    def fuse_message(self) -> str:
        return (f"GUI 启动熔断：本会话 0 次成功、已连续 {self.consecutive_fail} 次启动失败，不再等待超时。"
                f"首个失败诊断：{self.first_error_file or '无'}\n{self.first_error or ''}")


HEALTH = LaunchHealth()


def tail_text(path: Path, lines: int = LOG_TAIL_LINES) -> str:
    try:
        data = path.read_bytes()
    except OSError as e:
        return f"<无法读取 {path.name}: {e}>"
    text = data.decode("utf-8", "replace")
    return "\n".join(text.splitlines()[-lines:])


@dataclass
class LaunchRecord:
    n: int
    exe: str
    args: list[str]
    cwd: str
    cdp_port: int | None
    env: dict[str, str]
    t0: float = field(default_factory=time.monotonic)
    phases: list[tuple[str, float]] = field(default_factory=list)
    pid: int | None = None
    error: str | None = None
    exit_code: int | None = None
    alive: bool | None = None
    log_tail: str = ""
    seen_urls: list[str] = field(default_factory=list)

    @staticmethod
    def safe_env(env: dict[str, str]) -> dict[str, str]:
        upper = {k.upper(): v for k, v in env.items()}
        return {k: upper[k.upper()] for k in SAFE_ENV_KEYS if k.upper() in upper}

    def mark(self, phase: str) -> None:
        self.phases.append((phase, round(time.monotonic() - self.t0, 2)))

    def last_phase(self) -> str:
        return self.phases[-1][0] if self.phases else "未开始"

    def to_dict(self) -> dict:
        return {
            "n": self.n, "exe": self.exe, "args": self.args, "cwd": self.cwd, "cdp_port": self.cdp_port,
            "env": self.env, "pid": self.pid, "phases": self.phases, "last_phase": self.last_phase(),
            "error": self.error, "alive": self.alive, "exit_code": self.exit_code,
            "seen_urls": self.seen_urls, "log_tail": self.log_tail,
        }

    def summary(self) -> str:
        head = (f"启动#{self.n} 失败于阶段「{self.last_phase()}」后 "
                f"({self.phases[-1][1] if self.phases else 0}s)；alive={self.alive} exit={self.exit_code} "
                f"pid={self.pid} port={self.cdp_port}\nexe={self.exe} args={self.args} cwd={self.cwd}\n"
                f"错误：{self.error}")
        if self.seen_urls:
            head += f"\nCDP 可见页面：{self.seen_urls}"
        tail = self.log_tail[-MESSAGE_TAIL_CHARS:] if self.log_tail else "<进程无输出>"
        return f"{head}\n--- 进程 stdout/stderr 尾部 ---\n{tail}"

    def write(self, artifacts: Path) -> Path:
        artifacts.mkdir(parents=True, exist_ok=True)
        out = artifacts / f"launch-{self.n}.json"
        out.write_text(json.dumps(self.to_dict(), ensure_ascii=False, indent=1), encoding="utf-8")
        return out


def windows_snapshot(sandbox_root: Path) -> dict:
    """启动失败时的 Windows 现场：沙箱相关进程（含 WebView2 子进程命令行）、其监听端口、
    应用顶层窗口（类名/标题/可见，可识别原生错误对话框 #32770）、WebView2 数据目录概况。
    只取与沙箱路径相关的进程，不读取环境块。非 Windows 返回空。"""
    if os.name != "nt":
        return {}
    import subprocess

    out: dict = {}
    root = str(sandbox_root)
    ps = (
        "$r = $env:TL_DIAG_ROOT; "
        "$p = @(Get-CimInstance Win32_Process | Where-Object { ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($r, 'OrdinalIgnoreCase')) -or ($_.CommandLine -and $_.CommandLine.IndexOf($r, [StringComparison]::OrdinalIgnoreCase) -ge 0) } "
        "| Select-Object ProcessId, ParentProcessId, Name, CommandLine); "
        "$ids = @($p | ForEach-Object { [int]$_.ProcessId }); "
        "$l = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ids -contains [int]$_.OwningProcess } "
        "| Select-Object LocalAddress, LocalPort, OwningProcess); "
        "@{ processes = $p; listening = $l } | ConvertTo-Json -Depth 4 -Compress"
    )
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=30,
                           env={**os.environ, "TL_DIAG_ROOT": root})
        out.update(json.loads(r.stdout) if r.stdout.strip() else {"ps_error": r.stderr[-1500:]})
    except Exception as e:  # 诊断本身失败不影响用例结论
        out["ps_error"] = f"{type(e).__name__}: {e}"
    try:
        out["windows"] = _app_windows(root)
    except Exception as e:
        out["windows_error"] = f"{type(e).__name__}: {e}"
    wv = sandbox_root / "WebView2"
    try:
        out["webview2_dir"] = sorted(p.name for p in wv.iterdir()) if wv.exists() else None
        ebw = wv / "EBWebView"
        out["ebwebview_dir"] = sorted(p.name for p in ebw.iterdir())[:40] if ebw.exists() else None
        port_file = ebw / "DevToolsActivePort"
        out["devtools_active_port"] = port_file.read_text(encoding="utf-8", errors="replace")[:200] if port_file.exists() else None
    except OSError as e:
        out["webview2_dir_error"] = str(e)
    return out


def _app_windows(root: str) -> list[dict]:
    import ctypes
    from ctypes import wintypes

    from . import stealth

    user32 = stealth.user32
    res = []
    for h in stealth._windows_under(root.lower().rstrip("\\") + "\\"):
        cls = ctypes.create_unicode_buffer(128)
        title = ctypes.create_unicode_buffer(512)
        user32.GetClassNameW(h, cls, 128)
        user32.GetWindowTextW(wintypes.HWND(h), title, 512)
        res.append({"class": cls.value, "title": title.value, "visible": bool(user32.IsWindowVisible(h)),
                    "rect": stealth._rect(h)})
    return res
