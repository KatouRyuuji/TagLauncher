"""主题补充（E-TH-04/05/06/08）。"""
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


def _row_boxes(app):
    return app.page.evaluate("""() => [...document.querySelectorAll('[data-selectable-item-id]')]
        .map((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; })
        .sort((a, b) => a.top - b.top)""")


@pytest.mark.case("E-TH-08")
def test_ui_font_scale_persists_and_rows_remeasure(app, sandbox):
    """F03：界面字号只放大文字、重启后保留；虚拟列表行随字号重测，行间不重叠。"""
    paths = [files.write(sandbox.files / "字号" / f"字号对象{i:02d}.txt", str(i)) for i in range(4)]
    app.seed(paths)
    app.page.get_by_role("button", name="列表视图", exact=True).click()
    app.wait_count(4)
    name_el = app.page.get_by_text("字号对象00.txt", exact=True).first
    base_px = float(name_el.evaluate("(el) => parseFloat(getComputedStyle(el).fontSize)"))
    base_rows = _row_boxes(app)
    try:
        dlg = app.open_settings("主题外观")
        group = dlg.get_by_role("radiogroup", name="界面字号")
        group.get_by_role("radio", name="特大", exact=True).click()
        wait_until(lambda: app.page.evaluate("() => document.documentElement.style.getPropertyValue('--ui-font-scale')") == "1.25", 5)
        app.page.keyboard.press("Escape")
        wait_until(lambda: float(name_el.evaluate("(el) => parseFloat(getComputedStyle(el).fontSize)")) > base_px * 1.2, 5,
                   lambda: (base_px, name_el.evaluate("(el) => getComputedStyle(el).fontSize")))
        # 行高随字号重测（ResizeObserver）：不重叠，且行不比原来矮
        wait_until(lambda: len(_row_boxes(app)) == 4, 5)
        rows = _row_boxes(app)
        overlaps = [(a, b) for a, b in zip(rows, rows[1:]) if b["top"] < a["bottom"] - 0.5]
        assert overlaps == [], overlaps
        assert rows[0]["bottom"] - rows[0]["top"] >= base_rows[0]["bottom"] - base_rows[0]["top"] - 0.5, (rows, base_rows)
        app.restart()
        wait_until(lambda: app.page.evaluate("() => document.documentElement.style.getPropertyValue('--ui-font-scale')") == "1.25", 10)
        assert app.js_errors() == []
    finally:
        app.page.evaluate("""() => { const k = 'taglauncher.workspace_prefs';
            const p = JSON.parse(localStorage.getItem(k) || '{}'); delete p.uiFontScale; localStorage.setItem(k, JSON.stringify(p));
            document.documentElement.style.removeProperty('--ui-font-scale'); }""")
