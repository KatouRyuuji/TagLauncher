"""主题（E-TH-*）。"""
from __future__ import annotations

import json
import time

import pytest

from harness.app import wait_until
from harness.paths import ROOT

FAMILIES = {
    "霜靛": ("7f47aab2-74bb-4c77-b99b-550f0acf3c9c", "8cebf811-9b9d-4c49-ac9f-1d1fa685ce93"),
    "藤色": ("668e5856-9d9f-481a-8f82-325372d2e256", "65596bf6-3aaf-4322-93f2-bbb60cb94b5d"),
    "樱花": ("70492696-751c-4a29-9ab4-09ad8ddff1a4", "ad9b379f-0f3d-45e3-8b55-bf077b4ab97a"),
    "素墨": ("f04d4499-8a9c-4c84-b7d1-73574fc98f9e", "2db7495f-a084-4f7d-ae6d-d06258dc0e3c"),
}


def scheme(app) -> str | None:
    return app.page.evaluate("() => document.documentElement.dataset.scheme")


def current_theme_id(app) -> str:
    t = app.invoke("get_current_theme")
    return t["id"] if isinstance(t, dict) else t


def open_switcher(app):
    s = app.page.locator('summary[aria-label="主题与外观"]')
    det = s.locator("xpath=..")
    if det.get_attribute("open") is None:
        s.click()
    return det


@pytest.mark.case("E-TH-01")
def test_light_dark_persist(app):
    det = open_switcher(app)
    mode = det.get_by_role("radiogroup", name="外观模式")
    mode.get_by_role("radio", name="暗色").click()
    wait_until(lambda: scheme(app) == "dark", 3, lambda: scheme(app))
    mode.get_by_role("radio", name="亮色").click()
    wait_until(lambda: scheme(app) == "light", 3, lambda: scheme(app))
    mode.get_by_role("radio", name="暗色").click()
    wait_until(lambda: scheme(app) == "dark", 3)
    app.restart()
    wait_until(lambda: scheme(app) == "dark", 10, lambda: scheme(app))


@pytest.mark.case("E-TH-02")
def test_family_gallery(app):
    dlg = app.open_settings("主题外观")
    gallery = dlg.get_by_role("radiogroup", name="官方配色")
    for name, ids in FAMILIES.items():
        t0 = time.monotonic()
        gallery.get_by_role("radio", name=name).click()
        wait_until(lambda: current_theme_id(app) in ids, 3, lambda: current_theme_id(app))
        assert time.monotonic() - t0 < 3
        # 600ms 预算：以 DOM 变量生效为准（IPC 往返另计）
    assert app.js_errors() == []


@pytest.mark.case("E-TH-03")
def test_install_custom_theme(app):
    src = ROOT / "ExampleTheme" / "SkyCloudTheme" / "theme.json"
    theme = json.loads(src.read_text(encoding="utf-8"))
    app.stub("plugin:dialog|open", str(src))
    dlg = app.open_settings("主题外观")
    dlg.get_by_role("button", name="导入", exact=True).click()
    app.wait_toast(theme["name"])
    wait_until(lambda: current_theme_id(app) == theme["id"], 5, lambda: current_theme_id(app))
    got = app.page.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--font-size-base').trim()")
    assert got == theme["variables"]["font-size-base"]
    assert any(t.get("id") == theme["id"] for t in app.invoke("get_custom_themes")["themes"])
