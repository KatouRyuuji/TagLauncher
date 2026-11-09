from __future__ import annotations

import pytest

from harness import files


@pytest.fixture
def zoo(sandbox):
    return files.type_zoo(sandbox.files / "zoo")


def add_via_menu(app, kind: str, paths):
    """顶栏“添加文件或文件夹”→ 菜单项；系统对话框由桩返回 paths。"""
    app.stub("plugin:dialog|open", [str(p) for p in paths])
    app.page.get_by_role("button", name="添加文件或文件夹").click()
    app.page.get_by_role("menu", name="添加").get_by_role("menuitem", name=kind).click()


def folder_dialog_confirm(app, mode_title: str, remember: bool = False):
    dlg = app.dialog("添加文件夹")
    dlg.get_by_role("radio", name=mode_title).click()
    box = dlg.get_by_role("checkbox")
    if box.is_checked() != remember:
        box.click()
    dlg.get_by_role("button", name="添加", exact=True).click()
    dlg.wait_for(state="detached", timeout=5000)
