"""主题补充（E-TH-04/05/06）。"""
from __future__ import annotations

import json

import pytest

from harness import files
from harness.app import wait_until
from harness.paths import ROOT

from .test_theme import current_theme_id, open_switcher

SKY = ROOT / "ExampleTheme" / "SkyCloudTheme" / "theme.json"


def import_theme(app, path):
    app.stub("plugin:dialog|open", str(path))
    dlg = app.open_settings("主题外观")
    dlg.get_by_role("button", name="导入", exact=True).click()
    return dlg


@pytest.mark.case("E-TH-04")
def test_export_theme(app, sandbox):
    theme = json.loads(SKY.read_text(encoding="utf-8"))
    dlg = import_theme(app, SKY)
    app.wait_toast(theme["name"])
    out = sandbox.files / "导出" / "sky.json"
    out.parent.mkdir(parents=True)
    app.stub("plugin:dialog|save", str(out))
    dlg.get_by_role("button", name="导出", exact=True).click()
    app.wait_toast("已导出为文件")
    data = json.loads(out.read_text(encoding="utf-8"))
    assert data["id"] == theme["id"] and data["variables"] == theme["variables"]


@pytest.mark.case("E-TH-05")
def test_import_invalid_json(app, sandbox):
    bad = files.write(sandbox.files / "坏主题.json", "{ not json")
    before = len(app.toasts())
    tid = current_theme_id(app)
    import_theme(app, bad)
    wait_until(lambda: any(t.get("type") == "error" for t in app.toasts()[before:]), 8, lambda: app.toasts()[before:])
    assert current_theme_id(app) == tid
    assert app.js_errors() == []


@pytest.mark.case("E-TH-05")
def test_import_theme_with_external_url_sanitized(app, sandbox):
    theme = json.loads(SKY.read_text(encoding="utf-8"))
    theme["id"] = "e2e-external-url-theme"
    theme["name"] = "外链主题"
    key = next(iter(theme["variables"]))
    theme["variables"]["bg-image"] = "url(https://example.com/track.png)"
    theme["variables"][key] = theme["variables"][key]
    p = files.write(sandbox.files / "外链主题.json", json.dumps(theme, ensure_ascii=False))
    before = len(app.toasts())
    import_theme(app, p)
    wait_until(lambda: app.toasts()[before:], 8)
    css = app.page.evaluate("""() => { const s = getComputedStyle(document.documentElement);
        const out = []; for (const n of s) { if (n.startsWith('--')) { const v = s.getPropertyValue(n);
        if (/https?:/.test(v)) out.push(n); } } return out; }""")
    assert css == [], f"外部 URL 资源不应进入生效 CSS 变量：{css}"


@pytest.mark.case("E-TH-06")
def test_custom_theme_disables_mode_toggle(app):
    theme = json.loads(SKY.read_text(encoding="utf-8"))
    import_theme(app, SKY)
    app.wait_toast(theme["name"])
    app.page.keyboard.press("Escape")
    det = open_switcher(app)
    mode = det.get_by_role("radiogroup", name="外观模式")
    assert mode.get_attribute("aria-disabled") == "true"
    assert "仅对内置主题生效" in (mode.get_attribute("title") or "")
    assert mode.get_by_role("radio", name="暗色").is_disabled()
