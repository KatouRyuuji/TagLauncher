"""扩展 Mods（E-MOD-*）：夹具 mod 在启动前放进沙箱 bin/Plugins_Mods。"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path

import pytest

from harness import files
from harness.app import wait_until
from harness.paths import ROOT

CSS_ID = "e2e-css-marker"


def write_mod(mods_dir: Path, mod_id: str, mtype: str, *, css: str | None = None, js: str | None = None,
              permissions=..., name: str | None = None) -> Path:
    d = mods_dir / mod_id
    d.mkdir(parents=True, exist_ok=True)
    manifest = {"id": mod_id, "name": name or mod_id, "version": "1.0.0", "author": "e2e",
                "description": f"{mod_id} 夹具", "type": mtype, "api_version": "3.2.0", "entrypoints": {}}
    if permissions is not ...:
        manifest["permissions"] = permissions
    if css is not None:
        (d / "main.css").write_text(css, encoding="utf-8")
        manifest["entrypoints"]["css"] = "main.css"
    if js is not None:
        (d / "main.js").write_text(js, encoding="utf-8")
        manifest["entrypoints"]["js"] = "main.js"
    (d / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    return d


def mod_card(dlg, name: str):
    return dlg.locator("div.surface-card-soft").filter(has=dlg.page.get_by_text(name, exact=True)).first


def css_var(app, var: str) -> str:
    return app.page.evaluate("v => getComputedStyle(document.documentElement).getPropertyValue(v).trim()", var)


def mods_state(app) -> dict:
    return {m["id"]: m["enabled"] for m in app.invoke("get_mods")}


@pytest.fixture
def css_app(app_factory, sandbox):
    write_mod(sandbox.mods_dir, CSS_ID, "css", css=":root{--e2e-mod-marker:on}", name="E2E 样式标记")
    a = app_factory(start=False)
    return a.start()


@pytest.mark.case("E-MOD-01")
def test_css_mod_enable(css_app):
    app = css_app
    assert mods_state(app) == {CSS_ID: False}
    dlg = app.open_settings("扩展")
    card = mod_card(dlg, "E2E 样式标记")
    card.get_by_text("已禁用", exact=True).wait_for()
    card.get_by_role("button", name="启用", exact=True).click()
    card.get_by_text("已启用", exact=True).wait_for()
    wait_until(lambda: css_var(app, "--e2e-mod-marker") == "on", 5, lambda: css_var(app, "--e2e-mod-marker"))
    css = app.page.evaluate(f"document.querySelector('style[data-mod-css=\"{CSS_ID}\"]')?.textContent || ''")
    assert "@layer mod-" in css and "--e2e-mod-marker" in css, css
    assert mods_state(app) == {CSS_ID: True}
    # 重启后保持启用并重新注入
    app.restart()
    app.close_welcome(3000)
    wait_until(lambda: css_var(app, "--e2e-mod-marker") == "on", 10, lambda: css_var(app, "--e2e-mod-marker"))


@pytest.mark.case("E-MOD-06")
def test_disable_reload_uninstall(css_app, sandbox):
    app = css_app
    app.invoke("enable_mod", {"modId": CSS_ID})
    app.reload_page()
    app.close_welcome(3000)
    wait_until(lambda: css_var(app, "--e2e-mod-marker") == "on", 10, lambda: css_var(app, "--e2e-mod-marker"))
    (sandbox.mods_dir / CSS_ID / "main.css").write_text(":root{--e2e-mod-marker:reloaded}", encoding="utf-8")
    dlg = app.open_settings("扩展")
    card = mod_card(dlg, "E2E 样式标记")
    card.get_by_role("button", name="热重载").click()
    wait_until(lambda: css_var(app, "--e2e-mod-marker") == "reloaded", 5, lambda: css_var(app, "--e2e-mod-marker"))
    assert app.page.locator(f'style[data-mod-css="{CSS_ID}"]').count() == 1, "热重载后样式重复注入"
    card.get_by_role("button", name="禁用", exact=True).click()
    card.get_by_text("已禁用", exact=True).wait_for()
    wait_until(lambda: css_var(app, "--e2e-mod-marker") == "", 5, lambda: css_var(app, "--e2e-mod-marker"))
    assert app.page.locator(f'style[data-mod-css="{CSS_ID}"]').count() == 0
    card.get_by_role("button", name="卸载").click()
    app.page.get_by_role("dialog", name="卸载扩展").get_by_role("button", name="确认卸载").click()
    wait_until(lambda: not (sandbox.mods_dir / CSS_ID).exists(), 5, "卸载后目录仍在")
    wait_until(lambda: mods_state(app) == {}, 5, lambda: mods_state(app))


@pytest.mark.case("E-MOD-02")
@pytest.mark.case("E-MOD-04")
def test_example_preview_mod(app_factory, sandbox):
    shutil.copytree(ROOT / "ExampleMod" / "preview", sandbox.mods_dir / "preview")
    p = files.write(sandbox.files / "mod" / "预览对象.txt", "hello preview")
    app = app_factory(start=False).start()
    app.seed([p])
    dlg = app.open_settings("扩展")
    card = mod_card(dlg, "对象预览示例")
    for label in ("读取项目", "DOM 访问", "对象预览"):  # E-MOD-04 权限徽章
        card.get_by_text(label, exact=True).wait_for()
    card.get_by_role("button", name="启用", exact=True).click()
    trust = app.page.get_by_role("dialog", name="启用脚本扩展")
    for label in ("读取项目", "DOM 访问", "对象预览"):
        trust.get_by_text(label, exact=True).first.wait_for()
    assert mods_state(app)["example-object-preview"] is False, "确认前不应启用"
    trust.get_by_role("button", name="我信任此扩展").click()
    trust.wait_for(state="detached")
    card.get_by_text("已启用", exact=True).wait_for()
    app.page.keyboard.press("Escape")
    app.page.get_by_role("dialog", name="设置工作台").wait_for(state="detached", timeout=8000)
    target = app.card("预览对象.txt")
    target.hover()
    app.page.mouse.move(*_center(target), steps=3)
    app.page.keyboard.press("p")
    # 模态先以“对象预览”为标题打开，随后 setTitle 成“预览 · <名称>”：只认模态本身和其中的名称，别和标题竞速
    modal = app.page.locator("[data-mod-modal]").first
    modal.wait_for(state="attached", timeout=5000)
    app.page.get_by_text(re.compile(r"^(对象预览|预览 · 预览对象\.txt)$")).first.wait_for(timeout=5000)
    app.page.get_by_text("预览对象.txt").nth(1).wait_for(timeout=5000)


def _center(loc):
    b = loc.bounding_box()
    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2


PROBE_JS = """
const api = window.__tagLauncherModApi.createScope(__MOD_ID__);
const r = (window.__e2eMod = window.__e2eMod || {})[__MOD_ID__] = {done: false};
try {
  api.getItems().then((x) => { r.result = "ok"; r.count = x.length; r.done = true; },
                      (e) => { r.result = "rejected"; r.err = String(e && e.message || e); r.done = true; });
} catch (e) { r.result = "denied"; r.err = String(e && e.message || e); r.done = true; }
"""


@pytest.mark.case("E-MOD-05")
def test_permission_tristate(app_factory, sandbox):
    write_mod(sandbox.mods_dir, "e2e-perm-undeclared", "css+js", js=PROBE_JS)
    write_mod(sandbox.mods_dir, "e2e-perm-empty", "css+js", js=PROBE_JS, permissions=[])
    write_mod(sandbox.mods_dir, "e2e-perm-items", "css+js", js=PROBE_JS, permissions=["items:read"])
    write_mod(sandbox.mods_dir, "e2e-perm-tags", "css+js", js=PROBE_JS, permissions=["tags:read"])
    app = app_factory(start=False).start()
    ids = ["e2e-perm-undeclared", "e2e-perm-empty", "e2e-perm-items", "e2e-perm-tags"]
    for i in ids:
        app.invoke("enable_mod", {"modId": i})
    app.reload_page()
    app.close_welcome(3000)

    def res():
        return app.page.evaluate("window.__e2eMod || {}")
    wait_until(lambda: all(res().get(i, {}).get("done") for i in ids), 10, res)
    r = res()
    assert r["e2e-perm-undeclared"]["result"] == "ok", r
    assert r["e2e-perm-items"]["result"] == "ok", r
    for i in ("e2e-perm-empty", "e2e-perm-tags"):
        assert r[i]["result"] == "denied" and "items:read" in r[i]["err"], r
    # 无权限 mod 的卡片显示“无特殊权限”
    dlg = app.open_settings("扩展")
    mod_card(dlg, "e2e-perm-empty").get_by_text("无特殊权限").wait_for()
