"""启动对象补充（E-LCH-04/07）。真实打开外部窗口的 LCH-03/08 在 tests/window（physical_input）。"""
from __future__ import annotations

import time

import pytest

from harness import files
from harness.app import wait_until


@pytest.mark.case("E-LCH-04")
def test_double_click_folder_launches_by_id(app, sandbox):
    d = sandbox.files / "要打开的目录"
    d.mkdir()
    app.seed([d])
    app.stub("launch_item", None)  # 不真正拉起资源管理器
    iid = app.item("要打开的目录")["id"]
    app.card("要打开的目录").dblclick()
    calls = app.wait_ipc("launch_item")
    assert [c["args"].get("id") for c in calls] == [iid], calls
    assert app.page.get_by_role("dialog").count() == 0


@pytest.mark.case("E-LCH-07")
def test_multi_select_enter_launches_primary_only(app, sandbox):
    """产品设计：Enter/右键“打开”只启动主选中项（itemActionCopy.ts 明确不承诺批量启动）。"""
    ps = [files.marker_exe(sandbox.files / "batch" / f"批{i}.exe") for i in range(3)]
    app.seed(ps)
    app.card("批0.exe").click()
    app.card("批1.exe").click(modifiers=["Control"])
    app.card("批2.exe").click(modifiers=["Control"])
    assert len(app.selected_ids()) == 3
    app.page.keyboard.press("Enter")
    wait_until(lambda: sum(files.marker_of(p).exists() for p in ps) >= 1, 10)
    time.sleep(2)
    assert sum(files.marker_of(p).exists() for p in ps) == 1, "多选 Enter 只应启动一个"


@pytest.mark.case("E-LCH-07")
def test_one_failure_does_not_block_others(app, sandbox):
    ok1 = files.marker_exe(sandbox.files / "mix" / "好一.exe")
    bad = files.write(sandbox.files / "mix" / "坏.bat", "x")
    ok2 = files.marker_exe(sandbox.files / "mix" / "好二.exe")
    app.seed([ok1, bad, ok2])
    bad.unlink()
    errs = 0
    for p in (ok1, bad, ok2):
        if app.invoke_error("launch_item", {"id": app.item(p.name)["id"]}):
            errs += 1
    assert errs == 1
    files.wait_marker(ok1)
    files.wait_marker(ok2)
    assert app.proc.poll() is None
