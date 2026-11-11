"""desktop 层·应用内「复制文件」/「打开方式…」（D-CLIP-*）。会改系统剪贴板、弹系统对话框，只在临时 runner 跑。"""
from __future__ import annotations

import os
import subprocess
import time

import pytest

from harness import files
from harness.app import wait_until
from tests.desktop import oswin
from tests.ui.test_collect import same_path
from win import win32

pytestmark = [pytest.mark.physical_input, pytest.mark.visible_window]


@pytest.mark.case("D-CLIP-01")
def test_copy_files_puts_cf_hdrop_on_clipboard(app, sandbox):
    """右键「复制文件」：剪贴板是 CF_HDROP（可直接粘贴到资源管理器）、效果为复制；多选复制整个选中集；丢失的跳过。"""
    a = files.write(sandbox.files / "clip" / "报告 一.txt", "a")
    b = files.write(sandbox.files / "clip" / "b.png", files.png_bytes(4, 4))
    gone = files.write(sandbox.files / "clip" / "将删除.txt", "g")
    app.seed([a, b, gone])
    oswin.clear_clipboard()
    app.menu_click(a.name, "复制文件")
    app.wait_toast("已复制文件")
    clip = oswin.clipboard_files()
    print(f"CLIP single {clip}")
    assert len(clip["files"]) == 1 and same_path(clip["files"][0], a), clip
    assert clip["drop_effect"] == 1, "Preferred DropEffect 应为 DROPEFFECT_COPY"

    gone.unlink()
    app.card(a.name).click()
    app.card(gone.name).click(modifiers=["Control"])
    app.card(b.name).click(modifiers=["Control"])
    app.menu_click(b.name, "复制 3 个文件")
    app.wait_toast("1 个已丢失")
    clip = oswin.clipboard_files()
    print(f"CLIP multi {clip}")
    assert sorted(os.path.basename(f) for f in clip["files"]) == sorted([a.name, b.name]), clip

    # 粘贴验证：资源管理器同款 —— 用 Shell 的 InvokeVerb("paste") 把剪贴板文件粘到另一个目录
    dest = sandbox.files / "pasted"
    dest.mkdir()
    script = ("$f = (New-Object -ComObject Shell.Application).Namespace($env:TL_DIR); "
              "$f.Self.InvokeVerb('paste'); Start-Sleep -Seconds 3")
    subprocess.run(["powershell", "-NoProfile", "-STA", "-Command", script], env={**os.environ, "TL_DIR": str(dest)},
                   capture_output=True, timeout=60)
    pasted = sorted(p.name for p in dest.iterdir())
    print(f"PASTED {pasted}")
    assert pasted == sorted([a.name, b.name]), pasted
    oswin.clear_clipboard()


def _open_with_windows(app) -> list[dict]:
    out = []
    for h in win32.windows_of_pid(app.proc.pid):
        t = win32.title(h)
        if win32.class_name(h) in ("#32770", "OpenWith", "Shell_Dialog") or "打开" in t or "open" in t.lower():
            if t != "TagLauncher":
                out.append({"hwnd": h, "title": t, "class": win32.class_name(h), "pid": app.proc.pid})
    r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq OpenWith.exe", "/FO", "CSV", "/NH"], capture_output=True,
                       text=True, errors="replace")
    for line in r.stdout.splitlines():
        if line.lower().startswith('"openwith.exe"'):
            out.append({"process": line})
    return out


@pytest.mark.case("D-CLIP-02")
def test_open_with_shows_system_dialog(app, sandbox):
    """右键「打开方式…」：弹出系统「打开方式」对话框（本进程对话框或 OpenWith.exe）；文件夹无此项。"""
    p = files.write(sandbox.files / "ow" / "说明.tlx", "x")  # 未关联扩展名：一定出选择界面
    app.seed([p])
    before = _open_with_windows(app)
    app.menu_click(p.name, "打开方式…")
    found = wait_until(lambda: [w for w in _open_with_windows(app) if w not in before], 15,
                       lambda: f"没有出现打开方式对话框：{_open_with_windows(app)}")
    print(f"OPEN_WITH {found}")
    for w in found:
        if "hwnd" in w:
            oswin.user32.PostMessageW(w["hwnd"], 0x10, 0, 0)
    subprocess.run(["taskkill", "/IM", "OpenWith.exe", "/F"], capture_output=True)
    time.sleep(1)
    assert app.proc.poll() is None
