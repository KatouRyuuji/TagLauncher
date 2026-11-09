"""文件夹监视（E-WAT-*）。"""
from __future__ import annotations

import time

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until


@pytest.mark.case("E-WAT-01", "E-WAT-02")
def test_watch_and_unwatch(app, sandbox):
    root = sandbox.files / "监视目录"
    root.mkdir()
    app.seed([root])
    app.menu_click("监视目录", "监视此文件夹")
    app.page.get_by_text("正在监视 1 个文件夹").wait_for(timeout=8000)
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM watch_roots WHERE enabled=1") == 1
    time.sleep(0.5)
    files.write(root / "新来的.txt", "hi")
    wait_until(lambda: any(i["name"] == "新来的.txt" for i in app.items()), 10, lambda: [i["name"] for i in app.items()])
    app.wait_count(2)

    app.menu_click("监视目录", "停止监视此文件夹")
    wait_until(lambda: dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM watch_roots WHERE enabled=1") == 0, 5)
    files.write(root / "不该入库.txt", "no")
    time.sleep(4)
    assert not any(i["name"] == "不该入库.txt" for i in app.items())
