"""文件夹监视 P1/P2（E-WAT-03..07）。"""
from __future__ import annotations

import time

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until


def watch(app, sandbox, name="监视目录"):
    root = sandbox.files / name
    root.mkdir(parents=True, exist_ok=True)
    app.seed([root])
    app.menu_click(name, "监视此文件夹")
    app.page.get_by_text("正在监视 1 个文件夹").wait_for(timeout=8000)
    time.sleep(0.5)
    return root


def names(app):
    return sorted(i["name"] for i in app.items())


def has(app, n):
    return any(i["name"] == n for i in app.items())


@pytest.mark.case("E-WAT-03")
def test_delete_and_rename_inside_watched(app, sandbox):
    root = watch(app, sandbox)
    a = files.write(root / "待删.txt", "a")
    b = files.write(root / "待改名.txt", "b")
    wait_until(lambda: has(app, "待删.txt") and has(app, "待改名.txt"), 10, lambda: names(app))
    bid = app.item("待改名.txt")["id"]
    a.unlink()
    b.rename(root / "改名后.txt")
    def settled():
        app.refresh_items()
        gone = (not has(app, "待删.txt")) or app.item("待删.txt")["is_missing"]
        renamed = any(i["id"] == bid and i["path"].lower().endswith("改名后.txt") for i in app.items())
        return gone and renamed
    wait_until(settled, 15, lambda: [(i["name"], i["path"], i["is_missing"]) for i in app.items()])
    assert sum(1 for i in app.items() if i["path"].lower().endswith("改名后.txt")) == 1, "改名不应产生重复对象"


@pytest.mark.case("E-WAT-04")
def test_master_switch(app, sandbox):
    root = watch(app, sandbox)
    dlg = app.open_settings("数据管理")
    sw = dlg.get_by_role("switch", name="允许文件夹监视")
    assert sw.get_attribute("aria-checked") == "true"
    sw.click()
    app.wait_toast("已暂停全部文件夹监视")
    assert sw.get_attribute("aria-checked") == "false"
    files.write(root / "暂停期间.txt", "x")
    time.sleep(4)
    assert not has(app, "暂停期间.txt"), "总开关关闭后不应入库"
    sw.click()
    app.wait_toast("已允许文件夹监视")
    files.write(root / "恢复之后.txt", "y")
    wait_until(lambda: has(app, "恢复之后.txt"), 15, lambda: names(app))


@pytest.mark.case("E-WAT-05")
def test_ignore_list_and_restore(app, sandbox):
    root = watch(app, sandbox)
    f = files.write(root / "要忽略.txt", "z")
    wait_until(lambda: has(app, "要忽略.txt"), 10, lambda: names(app))
    app.invoke("remove_items", {"ids": [app.item("要忽略.txt")["id"]]})
    ignored = app.invoke("list_ignored_paths", {"under": None})
    assert any("要忽略.txt" in str(p) for p in ignored), ignored
    f.write_text("touched", encoding="utf-8")
    time.sleep(4)
    assert not has(app, "要忽略.txt"), "已忽略的对象不应被重新导入"
    dlg = app.open_settings("数据管理")
    dlg.get_by_role("button", name="已忽略 1 项").click()
    ig = app.dialog("已忽略的对象")
    cb = ig.get_by_role("checkbox").first
    if cb.get_attribute("aria-checked") != "true":
        cb.click()
    ig.get_by_role("button", name="恢复追踪（1）").click()
    app.wait_toast("已恢复追踪 1 项")
    wait_until(lambda: has(app, "要忽略.txt"), 20, lambda: names(app))


@pytest.mark.case("E-WAT-06")
def test_watch_survives_restart(app, sandbox):
    root = watch(app, sandbox)
    app.restart()
    app.page.get_by_text("正在监视 1 个文件夹").wait_for(timeout=10_000)
    time.sleep(1)
    files.write(root / "重启后新建.txt", "r")
    wait_until(lambda: has(app, "重启后新建.txt"), 15, lambda: names(app))


@pytest.mark.case("E-WAT-07")
def test_burst_500_files(app, sandbox):
    root = watch(app, sandbox)
    t0 = time.perf_counter()
    for i in range(500):
        (root / f"burst_{i:03d}.txt").write_text(str(i), encoding="utf-8")
    burst = time.perf_counter() - t0
    def done():
        return sum(1 for i in app.items() if i["name"].startswith("burst_")) >= 500
    wait_until(done, 90, lambda: sum(1 for i in app.items() if i["name"].startswith("burst_")))
    paths = [i["path"].lower() for i in app.items() if i["name"].startswith("burst_")]
    assert len(paths) == len(set(paths)) == 500, f"重复/缺失：{len(paths)} / {len(set(paths))}"
    # UI 不卡死：主线程可在 1s 内响应
    t1 = time.perf_counter()
    app.page.evaluate("() => new Promise(r => requestAnimationFrame(() => r(1)))")
    assert time.perf_counter() - t1 < 1.0
    print(f"burst write {burst:.2f}s")
