"""扩展 Mods 补充（E-MOD-03/07..13、E-VIEW-12）。全部经 CDP/IPC，不接管物理输入。"""
from __future__ import annotations

import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from harness.app import wait_until

from .test_mods import mod_card, mods_state, write_mod
from .test_theme_more import SKY


def set_manifest(d, **kv):
    m = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
    m.update(kv)
    (d / "manifest.json").write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")


def enable_and_reload(app, *ids):
    for i in ids:
        app.invoke("enable_mod", {"modId": i})
    app.reload_page()
    app.close_welcome(3000)


def probe(app, mid, timeout=10):
    wait_until(lambda: app.page.evaluate("id => (window.__e2eMod||{})[id]?.done === true", mid), timeout,
               lambda: app.page.evaluate("id => (window.__e2eMod||{})[id]", mid))
    return app.page.evaluate("id => window.__e2eMod[id]", mid)


HEAD = """const r = (window.__e2eMod = window.__e2eMod || {})[__MOD_ID__] = {done: false};
const api = window.__tagLauncherModApi.createScope(__MOD_ID__);
const t = async (k, f) => { try { r[k] = {ok: true, v: await f()}; } catch (e) { r[k] = {ok: false, e: String(e && e.message || e)}; } };
"""


@pytest.mark.case("E-MOD-03")
def test_theme_mod_listed(app_factory, sandbox):
    d = write_mod(sandbox.mods_dir, "e2e-theme-mod", "theme", name="E2E 主题 Mod")
    theme = json.loads(SKY.read_text(encoding="utf-8"))
    theme["id"] = "e2e-mod-theme"
    theme["name"] = "E2E Mod 主题"
    (d / "theme.json").write_text(json.dumps(theme, ensure_ascii=False), encoding="utf-8")
    set_manifest(d, entrypoints={"theme": "theme.json"})
    app = app_factory(start=False).start()
    enable_and_reload(app, "e2e-theme-mod")
    dlg = app.open_settings("主题外观")
    dlg.get_by_role("button", name="当前主题").or_(dlg.get_by_label("当前主题")).first.click()
    opt = app.page.get_by_role("option", name="E2E Mod 主题")
    opt.wait_for(timeout=8000)
    assert app.page.get_by_text("Mod 主题", exact=True).count() >= 1
    opt.click()
    wait_until(lambda: app.invoke("get_setting", {"key": "theme"}) == "e2e-mod-theme", 8,
               lambda: app.invoke("get_setting", {"key": "theme"}))
    assert not app.js_errors()


@pytest.mark.case("E-MOD-07")
def test_import_export_mod(app_factory, sandbox):
    src = write_mod(sandbox.files / "modsrc", "e2e-import", "css", css=":root{--e2e-imp:1}", name="E2E 导入")
    app = app_factory(start=False).start()
    dlg = app.open_settings("扩展")
    app.stub("plugin:dialog|open", str(src))
    dlg.get_by_role("button", name="导入 Mod").first.click()
    app.wait_toast("Mod 导入成功")
    assert (sandbox.mods_dir / "e2e-import" / "manifest.json").exists()
    assert "e2e-import" in mods_state(app)
    out = sandbox.files / "modout"
    out.mkdir(parents=True, exist_ok=True)
    app.stub("plugin:dialog|open", str(out))
    mod_card(dlg, "E2E 导入").get_by_role("button", name="导出", exact=True).click()
    app.wait_toast("Mod 已导出到")
    wait_until(lambda: any(out.rglob("manifest.json")), 5, "导出目录无 manifest")
    # 重复导入同 id：应报错或覆盖确认，不能静默产生两份
    app.stub("plugin:dialog|open", str(src))
    before = len(app.toasts())
    dlg.get_by_role("button", name="导入 Mod").first.click()
    wait_until(lambda: app.toasts()[before:], 8)
    assert list(mods_state(app)).count("e2e-import") == 1
    # 非法目录（无 manifest）→ 错误 toast
    bad = sandbox.files / "notamod"
    bad.mkdir(parents=True, exist_ok=True)
    app.stub("plugin:dialog|open", str(bad))
    before = len(app.toasts())
    dlg.get_by_role("button", name="导入 Mod").first.click()
    wait_until(lambda: any(t.get("type") == "error" for t in app.toasts()[before:]), 8, lambda: app.toasts()[before:])
    assert not app.js_errors()


def _mods(app):
    return {m["id"]: m for m in app.invoke("get_mods")}


@pytest.mark.case("E-MOD-08")
def test_dependencies(app_factory, sandbox):
    base = write_mod(sandbox.mods_dir, "e2e-base", "css", css=":root{--e2e-base:1}")
    set_manifest(base, version="1.2.0")
    need = write_mod(sandbox.mods_dir, "e2e-need", "css", css=":root{--e2e-need:1}")
    set_manifest(need, dependencies={"e2e-base": "^1.0.0"})
    ver = write_mod(sandbox.mods_dir, "e2e-needv2", "css", css="")
    set_manifest(ver, dependencies={"e2e-base": "^2.0.0"})
    miss = write_mod(sandbox.mods_dir, "e2e-missing", "css", css="")
    set_manifest(miss, dependencies={"e2e-nope": "*"}, load_after=["e2e-nope2"])
    old = write_mod(sandbox.mods_dir, "e2e-future", "css", css="")
    set_manifest(old, min_app_version="99.0.0")
    app = app_factory(start=False).start()
    m = _mods(app)
    assert m["e2e-need"]["is_compatible"] is False and "未启用" in (m["e2e-need"]["incompatible_reason"] or "")
    r = m["e2e-missing"]["incompatible_reason"] or ""
    assert "e2e-nope" in r and "e2e-nope2" in r, r
    assert m["e2e-future"]["is_compatible"] is False
    # 启用依赖后 dependents 即时恢复；版本不满足者仍不兼容
    app.invoke("enable_mod", {"modId": "e2e-base"})
    wait_until(lambda: _mods(app)["e2e-need"]["is_compatible"] is True, 5, lambda: _mods(app)["e2e-need"])
    m = _mods(app)
    assert m["e2e-needv2"]["is_compatible"] is False and "e2e-base" in m["e2e-needv2"]["incompatible_reason"]
    dlg = app.open_settings("扩展")
    mod_card(dlg, "e2e-future").wait_for()
    assert not app.js_errors()


@pytest.mark.case("E-MOD-08")
def test_dependency_cycle(app_factory, sandbox):
    a = write_mod(sandbox.mods_dir, "e2e-cyc-a", "css", css="")
    b = write_mod(sandbox.mods_dir, "e2e-cyc-b", "css", css="")
    set_manifest(a, dependencies={"e2e-cyc-b": "*"})
    set_manifest(b, dependencies={"e2e-cyc-a": "*"})
    app = app_factory(start=False).start()
    # 循环依赖：双方互为「未启用」前置，任何一方都不能被启用（无死循环/崩溃）
    for i in ("e2e-cyc-a", "e2e-cyc-b"):
        with pytest.raises(Exception):
            app.invoke("enable_mod", {"modId": i})
    m = _mods(app)
    assert not m["e2e-cyc-a"]["enabled"] and not m["e2e-cyc-b"]["enabled"], m
    assert not app.js_errors()


# 读写要等用例放行（__e2eGo）：harness 启动时会在注入桩后整页重载，重载前那一页也会执行 mod，
# 若它在 set 与 put 之间被重载打断，计数与记录数就对不上（CI 35079d5 实测 prev=2、prevRecs=1）。
DATA_JS = HEAD + """
(async () => {
  try {
  while (!window.__e2eGo) await new Promise((res) => setTimeout(res, 20));
  await t("get", () => api.data.get("counter"));
  await t("list", async () => (await api.data.list("notes")).length);
  r.prev = r.get.v; r.prevRecs = r.list.v;
  await t("set", () => api.data.set("counter", (r.prev || 0) + 1));
  await t("put", () => api.data.put("notes", "n" + Date.now(), {x: 1}));
  await t("fsw", () => api.fs.writeText("data/hello.txt", "hi"));
  await t("fsr", () => api.fs.readText("data/hello.txt"));
  await t("esc1", () => api.fs.readText("../../taglauncher.db"));
  await t("esc2", () => api.fs.writeText("../escape.txt", "x"));
  await t("esc3", () => api.fs.readText("C:/Windows/win.ini"));
  } catch (e) { r.fatal = String(e); }
  r.done = true;
})();
"""


@pytest.mark.case("E-MOD-09")
def test_data_persistence_and_fs_escape(app_factory, sandbox):
    write_mod(sandbox.mods_dir, "e2e-data", "css+js", js=DATA_JS, permissions=["data", "fs:read", "fs:write"])
    app = app_factory(start=False).start()
    enable_and_reload(app, "e2e-data")
    app.page.evaluate("window.__e2eGo = true")
    r = probe(app, "e2e-data")
    assert r["set"]["ok"] and r["put"]["ok"] and r["fsw"]["ok"], r
    assert r["fsr"] == {"ok": True, "v": "hi"}, r
    for k in ("esc1", "esc2", "esc3"):
        assert r[k]["ok"] is False, (k, r[k])
    assert not (sandbox.mods_dir / "escape.txt").exists()
    app.restart()
    app.close_welcome(3000)
    app.page.evaluate("window.__e2eGo = true")
    r2 = probe(app, "e2e-data")
    assert r2["prev"] >= 1 and r2["prevRecs"] == r2["prev"], r2


class _H(BaseHTTPRequestHandler):
    hits = 0

    def do_GET(self):
        type(self).hits += 1
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"secret")

    def log_message(self, *a):
        pass


NET_JS = HEAD + """
(async () => {
  for (const [k, u] of Object.entries(window.__e2eNetTargets || {})) await t(k, async () => (await api.net.fetch(u)).status);
  await t("file", async () => (await api.net.fetch("file:///C:/Windows/win.ini")).status);
  r.done = true;
})();
"""


@pytest.mark.case("E-MOD-10")
def test_net_fetch_ssrf(app_factory, sandbox):
    srv = HTTPServer(("127.0.0.1", 0), _H)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        targets = {"lo": f"http://127.0.0.1:{port}/", "lohost": f"http://localhost:{port}/",
                   "v6": f"http://[::1]:{port}/", "priv": "http://192.168.0.1:1/", "meta": "http://169.254.169.254/"}
        js = NET_JS.replace("window.__e2eNetTargets || {}", json.dumps(targets))
        write_mod(sandbox.mods_dir, "e2e-net", "css+js", js=js, permissions=["net"])
        app = app_factory(start=False).start()
        enable_and_reload(app, "e2e-net")
        r = probe(app, "e2e-net", 30)
        for k in list(targets) + ["file"]:
            assert r[k]["ok"] is False, (k, r[k])
        assert _H.hits == 0, "内网请求实际到达了本地服务"
    finally:
        srv.shutdown()


SPOOF_JS = """const r = (window.__e2eMod = window.__e2eMod || {})[__MOD_ID__] = {done: false};
try { window.__tagLauncherModApi.createScope("e2e-victim"); r.spoof = "allowed"; } catch (e) { r.spoof = String(e.message); }
try { window.__tagLauncherModApi.createScope("e2e-unregistered"); r.unreg = "allowed"; } catch (e) { r.unreg = String(e.message); }
r.globals = Object.keys(window.__tagLauncherModApi).sort();
r.done = true;
"""


@pytest.mark.case("E-MOD-11")
def test_create_scope_spoof(app_factory, sandbox):
    write_mod(sandbox.mods_dir, "e2e-victim", "css+js", js="", permissions=["items:write"])
    sp = write_mod(sandbox.mods_dir, "e2e-spoof", "css+js", js=SPOOF_JS, permissions=[])
    set_manifest(sp, load_after=["e2e-victim"])
    app = app_factory(start=False).start()
    enable_and_reload(app, "e2e-victim", "e2e-spoof")
    r = probe(app, "e2e-spoof")
    assert "他人身份" in r["spoof"], r
    assert "未注册" in r["unreg"], r
    assert r["globals"] == ["createScope", "version"], r
    # 页面上下文直接调用未注册 id 同样拒绝
    msg = app.page.evaluate("""() => { try { window.__tagLauncherModApi.createScope('nobody'); return 'allowed'; }
                               catch (e) { return e.message; } }""")
    assert "未注册" in msg


UI_JS = HEAD + """
(async () => {
  await t("float", async () => { const p = await api.createPanel("fp", {position: "floating", title: "E2E 浮动面板", width: 320, height: 220, x: 100, y: 100});
    p.container.innerHTML = '<div id="e2e-float-body">float</div>'; return p.id; });
  await t("side", async () => { const p = await api.createPanel("sp", {position: "sidebar", title: "E2E 侧栏面板"});
    p.container.innerHTML = '<div id="e2e-side-body">side</div>'; return p.id; });
  await t("tb", () => api.createToolbarButton("tb1", {text: "E2E 工具按钮", onClick: () => { r.clicked = (r.clicked||0) + 1; }}));
  await t("slot", () => api.registerItemSlot("s1", "footer", (item) => { const el = document.createElement("span"); el.className = "e2e-slot"; el.textContent = "slot:" + item.id; return el; }));
  r.done = true;
})();
"""


@pytest.mark.case("E-MOD-12")
@pytest.mark.case("E-VIEW-12")
def test_ui_contributions(app_factory, sandbox):
    from harness import files
    p = files.write(sandbox.files / "slot" / "槽位对象.txt", "x")
    write_mod(sandbox.mods_dir, "e2e-ui", "css+js", js=UI_JS, permissions=["dom", "items:read"])
    app = app_factory(start=False).start()
    app.seed([p])
    enable_and_reload(app, "e2e-ui")
    r = probe(app, "e2e-ui")
    assert all(r[k]["ok"] for k in ("float", "side", "tb", "slot")), r
    pg = app.page
    pg.locator("#e2e-float-body").wait_for(timeout=8000)
    pg.locator("#e2e-side-body").wait_for(timeout=8000)
    btn = pg.locator('[data-mod-toolbar="e2e-ui"]').first
    btn.wait_for()
    btn.click()
    wait_until(lambda: pg.evaluate("window.__e2eMod['e2e-ui'].clicked") == 1, 5)
    wait_until(lambda: pg.locator('.e2e-slot[data-mod-slot="e2e-ui"]').count() >= 1, 8, "行槽位未渲染")
    # E-VIEW-12：浮动面板键盘移动/缩放（CDP 键盘事件，不接管物理输入）
    handle = pg.get_by_role("button", name="移动面板（方向键移动，Shift 大步进，Enter 或 Esc 结束）").first
    wrap = handle.locator("xpath=..")
    box0 = wrap.bounding_box()
    handle.focus()
    pg.keyboard.press("Shift+ArrowRight")
    pg.keyboard.press("ArrowDown")
    box1 = wrap.bounding_box()
    assert round(box1["x"] - box0["x"]) == 32 and round(box1["y"] - box0["y"]) == 8, (box0, box1)
    sep = pg.get_by_role("separator", name="调整面板大小（方向键调整，Shift 大步进，Enter 或 Esc 结束）").first
    sep.focus()
    pg.keyboard.press("Shift+ArrowRight")
    box2 = wrap.bounding_box()
    assert round(box2["width"] - box1["width"]) == 32, (box1, box2)
    for _ in range(80):
        pg.keyboard.press("Shift+ArrowLeft")
    assert wrap.bounding_box()["width"] >= 199, "缩放突破最小宽度"
    # 禁用后贡献点全部回收
    app.invoke("disable_mod", {"modId": "e2e-ui"})
    app.reload_page()
    app.close_welcome(3000)
    pg.wait_for_timeout(1500)
    assert pg.locator('[data-mod-toolbar="e2e-ui"], [data-mod-slot="e2e-ui"], #e2e-float-body, #e2e-side-body').count() == 0
    assert not app.js_errors()


BOOM_JS = """window.__e2eBoomRan = true; setTimeout(() => { throw new Error("e2e async boom"); }, 10);
Promise.reject(new Error("e2e rejection")); throw new Error("e2e sync boom");"""
OK_JS = HEAD + "r.done = true;"


@pytest.mark.expected_js_errors
@pytest.mark.case("E-MOD-13")
def test_exception_isolation(app_factory, sandbox):
    write_mod(sandbox.mods_dir, "e2e-boom", "css+js", js=BOOM_JS, permissions=[])
    write_mod(sandbox.mods_dir, "e2e-fine", "css+js", js=OK_JS, permissions=[])
    app = app_factory(start=False).start()
    enable_and_reload(app, "e2e-boom", "e2e-fine")
    probe(app, "e2e-fine")
    assert app.page.evaluate("window.__e2eBoomRan === true")
    # 主界面仍可用
    app.page.get_by_role("button", name="设置", exact=True).wait_for(timeout=5000)
    dlg = app.open_settings("扩展")
    mod_card(dlg, "e2e-fine").get_by_text("已启用", exact=True).wait_for()
    app.page.keyboard.press("Escape")
