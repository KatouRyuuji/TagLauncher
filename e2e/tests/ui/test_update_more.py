"""在线更新 P2（E-UPD-03）：启动期静默检查 8s 延迟 + 24h 节流（update_check 已桩为无更新）。"""
from __future__ import annotations

import time

import pytest

from harness.app import wait_until


@pytest.mark.case("E-UPD-03")
def test_startup_check_throttled(app_factory):
    app = app_factory(throttle_update=False)
    t0 = time.monotonic()
    wait_until(lambda: app.calls("update_check"), 20, lambda: "启动期未检查更新")
    assert time.monotonic() - t0 >= 4, "应延迟约 8s 再检查，不阻塞启动"
    ts = app.page.evaluate("localStorage.getItem('taglauncher.update_last_check_ts')")
    assert ts and int(ts) > 0
    assert not [t for t in app.toasts() if "新版本" in t.get("message", "")]
    app.reload_page()  # 24h 内再次启动：不再检查
    time.sleep(12)
    assert app.calls("update_check") == [], app.calls("update_check")


@pytest.mark.case("E-UPD-03")
def test_startup_check_new_version_toast_once(app_factory):
    app = app_factory(throttle_update=False)
    app.stub("update_check", {"hasUpdate": True, "currentVersion": "0.0.1", "latestVersion": "9.9.9",
                              "releaseUrl": "", "releaseNotes": "", "installerUrl": "", "installerSize": 0})
    app.wait_toast("发现新版本 v9.9.9", timeout=20)
