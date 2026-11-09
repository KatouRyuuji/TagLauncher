"""更新（E-UPD-*）：只桩前端 update_check IPC，不访问 GitHub。"""
from __future__ import annotations

import pytest

from harness.app import wait_until

NEW = {"currentVersion": "0.0.1", "latestVersion": "99.1.0", "hasUpdate": True,
       "releaseUrl": "https://github.com/KatouRyuuji/TagLauncher/releases/tag/v99.1.0",
       "releaseNotes": "- e2e 新功能", "installerUrl": "https://example.invalid/TagLauncher_99.1.0_x64-setup.exe",
       "installerSize": 12_345_678}
RELEASES = "https://github.com/KatouRyuuji/TagLauncher/releases"


def shell_urls(app) -> list[str]:
    out = []
    for c in app.calls("plugin:shell|open"):
        a = c.get("args") or {}
        out.append(a.get("path") or a.get("url") or str(a))
    return out


@pytest.mark.case("E-UPD-01")
def test_update_available(app):
    app.stub("update_check", NEW)
    dlg = app.open_settings("更新")
    dlg.get_by_role("button", name="检查更新").click()
    dlg.get_by_text("发现新版本 v99.1.0").wait_for()
    dlg.get_by_role("button", name="下载更新").click()
    wait_until(lambda: NEW["installerUrl"] in shell_urls(app), 3, lambda: shell_urls(app))
    dlg.get_by_role("button", name="查看更新日志").click()
    wait_until(lambda: RELEASES in shell_urls(app), 3, lambda: shell_urls(app))
    assert all(c.get("stubbed") for c in app.calls("update_check"))


@pytest.mark.case("E-UPD-02")
def test_no_update(app):
    app.stub("update_check", {**NEW, "latestVersion": "0.0.1", "hasUpdate": False, "installerUrl": ""})
    dlg = app.open_settings("更新")
    dlg.get_by_role("button", name="检查更新").click()
    app.wait_toast("当前已是最新版本")


@pytest.mark.case("E-UPD-04")
def test_installer_flow_skipped():
    pytest.skip("用户决定：不加产品更新开关，仅拦截前端 IPC；安装包下载/运行链路不做 E2E")
