"""环境与启动（E-ENV-01/04/09、E-ERR-01）。"""
from __future__ import annotations

import pytest

from harness import db as dbh


@pytest.mark.case("E-ENV-01", "E-ERR-01")
def test_first_launch_empty_library(sandbox, app_factory):
    app = app_factory(dismiss_welcome=False)
    page = app.page
    assert sandbox.db_path.exists(), "DB 应建在沙箱 Save/"
    assert dbh.meta(sandbox.db_path, "schema_version") == dbh.current_schema_version()
    # 首启欢迎（若有）可关闭
    app.close_welcome()
    empty = page.locator(".empty-state-panel[data-empty-variant=library]")
    empty.wait_for(timeout=8000)
    assert page.get_by_role("list", name="上手三步").is_visible()
    for label in ("导入文件夹…", "选择文件…"):
        assert empty.get_by_role("button", name=label).is_enabled()
    assert app.toasts() == [], f"首启不应有 toast：{app.toasts()}"
    # 空库引导按钮走 dialog.open（桩返回 null = 用户取消）
    empty.get_by_role("button", name="选择文件…").click()
    app.wait_ipc("plugin:dialog|open")
    assert app.items() == []


@pytest.mark.case("E-ENV-04")
def test_legacy_db_upgrade_dialog(sandbox, app_factory):
    items = [(f"旧项目{i}", f"D:\\e2e-legacy\\f{i}.txt", "exe") for i in range(5)]
    dbh.create_legacy_db(sandbox.db_path, "14", items, last_known_version="1.6.0-beta")
    app = app_factory(reload=False, dismiss_welcome=False)
    dlg = app.page.get_by_role("dialog").filter(has_text="软件已更新")
    dlg.wait_for(timeout=15000)
    assert "1.6.0-beta" in dlg.inner_text()
    dlg.get_by_role("button", name="我知道了").click()
    dlg.wait_for(state="detached", timeout=5000)
    assert dbh.meta(sandbox.db_path, "schema_version") == dbh.current_schema_version()
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM items") == 5


@pytest.mark.case("E-ENV-09")
def test_datapath_redirect(sandbox, app_factory):
    custom = sandbox.root / "自定义 数据"
    custom.mkdir()
    sandbox.redirect_data(custom)
    app = app_factory()
    assert (custom / "taglauncher.db").exists()
    assert not sandbox.default_save_dir.joinpath("taglauncher.db").exists()
    info = app.invoke("get_data_directory_info")
    assert info["isCustom"] is True
    assert info["saveDir"].rstrip("\\/").lower() == str(custom).lower()
