"""启动（E-LCH-*）。真实启动只针对 marker 目标（写旁路文件后立刻退出）。"""
from __future__ import annotations

import time

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until



def last_used(sandbox, item_id):
    return dbh.scalar(sandbox.db_path, "SELECT last_used_at FROM items WHERE id=?", (item_id,))


@pytest.mark.visible_window  # .bat 经 cmd 启动，会弹出控制台窗口
@pytest.mark.case("E-LCH-01")
def test_double_click_bat(app, sandbox):
    bat = files.marker_bat(sandbox.files / "启动 测试" / "双击.bat")
    app.seed([bat])
    item = app.item("双击.bat")
    assert last_used(sandbox, item["id"]) is None
    app.card("双击.bat").dblclick()
    text = files.wait_marker(bat)
    assert text.startswith("ran ") and ".bat" in text
    wait_until(lambda: last_used(sandbox, item["id"]) is not None, 5)
    app.page.get_by_role("button", name="最近使用").click()
    app.wait_names(["双击.bat"])


@pytest.mark.case("E-LCH-02")
def test_enter_launch_exe_cwd(app, sandbox):
    exe = files.marker_exe(sandbox.files / "程序目录" / "回车.exe")
    app.seed([exe])
    app.card("回车.exe").click()
    app.page.keyboard.press("Enter")
    text = files.wait_marker(exe)
    assert f"ran {exe}".lower() in text.lower()
    cwd = next(line[4:] for line in text.splitlines() if line.startswith("cwd="))
    # BUG-02 回归：工作目录应为程序所在目录
    assert cwd.rstrip("\\").lower() == str(exe.parent).lower(), f"实际 cwd={cwd}"


@pytest.mark.case("E-LCH-05")
def test_launch_missing_item(app, sandbox):
    bat = files.marker_exe(sandbox.files / "将删除.exe")
    app.seed([bat])
    item = app.item("将删除.exe")
    bat.unlink()
    app.card("将删除.exe").dblclick()
    t = app.wait_toast("启动项目失败")
    assert t.get("type") == "error"
    time.sleep(0.5)
    assert last_used(sandbox, item["id"]) is None
    assert not files.marker_of(bat).exists()
    wait_until(lambda: app.item("将删除.exe")["is_missing"], 5)


@pytest.mark.visible_window  # .bat 经 cmd 启动，会弹出控制台窗口
@pytest.mark.case("E-LCH-06")
def test_command_injection_name(app, sandbox):
    bat = files.marker_bat(sandbox.files / "注入" / "x&calc.bat")
    app.seed([bat])
    before = _calc_pids()
    app.card("x&calc.bat").dblclick()
    text = files.wait_marker(bat)
    assert 'ran "x&calc.bat"' in text
    time.sleep(1.5)
    assert _calc_pids() - before == set(), "出现了新的计算器进程"


def _calc_pids() -> set[int]:
    import subprocess
    out = subprocess.run(["tasklist", "/FO", "CSV", "/NH"], capture_output=True, text=True, errors="replace").stdout
    pids = set()
    for line in out.splitlines():
        parts = [p.strip('"') for p in line.split('","')]
        if parts and parts[0].lower() in ("calc.exe", "calculatorapp.exe", "win32calc.exe"):
            pids.add(int(parts[1].strip('"')))
    return pids
