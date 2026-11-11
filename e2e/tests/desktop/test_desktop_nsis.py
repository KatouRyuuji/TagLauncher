"""desktop 层·安装包（D-NSIS-01）：静默安装 → 命令行开启右键菜单与「发送到」→ 静默卸载 → 无残留。

安装包由 desktop 作业用 `tauri build --debug --bundles nsis` 构建，路径经 TL_E2E_NSIS 传入。
安装、卸载都写 runner 的真实 HKCU / %LOCALAPPDATA%，只在临时 runner 上跑。
"""
from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path

import pytest

from harness.app import wait_until
from tests.ui.test_collect import CLASSES, SENDTO, delete_tree, read_verb, same_path, verb_exists, verb_path

pytestmark = [pytest.mark.real_registry, pytest.mark.physical_input]
UNINSTALL_ROOT = r"Software\Microsoft\Windows\CurrentVersion\Uninstall"


def uninstall_entry() -> dict | None:
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, UNINSTALL_ROOT) as root:
            i = 0
            while True:
                try:
                    sub = winreg.EnumKey(root, i)
                except OSError:
                    return None
                i += 1
                with winreg.OpenKey(root, sub) as k:
                    try:
                        name = winreg.QueryValueEx(k, "DisplayName")[0]
                    except FileNotFoundError:
                        continue
                    if name == "TagLauncher":
                        vals = {}
                        for v in ("UninstallString", "InstallLocation", "DisplayVersion"):
                            try:
                                vals[v] = winreg.QueryValueEx(k, v)[0]
                            except FileNotFoundError:
                                vals[v] = None
                        return vals | {"key": sub}
    except FileNotFoundError:
        return None


def real_send_to() -> Path:
    return Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "SendTo" / SENDTO


def residue() -> dict:
    return {"verbs": [c for c in CLASSES if verb_exists(c)], "sendto": real_send_to().exists(),
            "uninstall_entry": uninstall_entry()}


@pytest.mark.case("D-NSIS-01")
def test_silent_install_enable_uninstall_leaves_nothing():
    installer = os.environ.get("TL_E2E_NSIS")
    assert installer and Path(installer).is_file(), f"desktop 作业应构建 NSIS 安装包并设 TL_E2E_NSIS：{installer!r}"
    assert residue() == {"verbs": [], "sendto": False, "uninstall_entry": None}, f"runner 不应预装：{residue()}"
    try:
        r = subprocess.run([installer, "/S"], capture_output=True, timeout=300)
        assert r.returncode == 0, r
        entry = wait_until(uninstall_entry, 30, "静默安装后没有卸载登记项")
        print(f"NSIS installed {entry}")
        loc = Path((entry["InstallLocation"] or "").strip('"') or Path(entry["UninstallString"].strip('"')).parent)
        exes = [p for p in loc.glob("*.exe") if p.name.lower() not in ("uninstall.exe", "tl.exe")]
        assert len(exes) == 1, f"安装目录应只有一个主程序：{list(loc.iterdir())}"
        exe = exes[0]

        r = subprocess.run([str(exe), "--shell-integration", "add"], capture_output=True, timeout=60)
        assert r.returncode == 0, r.stderr.decode("utf-8", "replace")
        for cls in CLASSES:
            v = read_verb(cls)
            assert v and same_path(v["Icon"].rpartition(",")[0].strip('"'), exe), v
        assert real_send_to().exists(), "安装版开启后应在真实 SendTo 放快捷方式"

        uninstaller = entry["UninstallString"].strip('"')
        r = subprocess.run([uninstaller, "/S"], capture_output=True, timeout=300)
        assert r.returncode == 0, r
        # NSIS 卸载程序会把自己复制到临时目录后立即返回：轮询到登记项消失
        wait_until(lambda: residue() == {"verbs": [], "sendto": False, "uninstall_entry": None}, 120,
                   lambda: f"静默卸载后仍有残留：{residue()}")
        wait_until(lambda: not exe.exists(), 60, f"卸载后主程序仍在：{exe}")
        print(f"NSIS uninstalled residue={residue()} dir_left={[p.name for p in loc.iterdir()] if loc.exists() else None}")
    finally:
        for cls in CLASSES:
            delete_tree(verb_path(cls))
        real_send_to().unlink(missing_ok=True)
