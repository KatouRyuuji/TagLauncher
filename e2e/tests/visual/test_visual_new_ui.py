"""本轮新增 UI 的一致性截图（E-VIS-NEWUI-*）：浅/深色 × 标准/特大字号 × 125%/150% 设备像素比。

覆盖：柜层级侧栏与拖放指示、「含子柜/仅本柜」、编辑弹窗「上级文件柜」、F04c 子树搜索、设置 → 桌面驻留
（快速窗选项 / 右键菜单 / Win11 菜单 / 钉住视图）、toast；快速窗搜索、收纳页；钉住浮动窗与展开的抽屉。
DPI 用 CDP Emulation.setDeviceMetricsOverride（只改渲染倍率，检查模糊与溢出；原生把手的真实多显示器 DPI 只能真机）。
每张图同时记录文字溢出（scrollWidth > clientWidth 且不是有意的省略号截断），新组件上不得有。
"""
from __future__ import annotations

import json
import time

import pytest

from harness import files
from harness.app import wait_until
from tests.ui.test_cabinets_nested import cab_row
from tests.ui.test_collect import collect_page
from tests.ui.test_quick import enable_quick, summon

from .conftest import FREEZE_CSS, set_client_size
from .test_visual import FAMILIES, apply_theme

MODES = [("light", FAMILIES["霜靛"][0]), ("dark", FAMILIES["霜靛"][1])]
FONTS = [1, 1.25]
DPRS = [1.25, 1.5]

OVERFLOW_JS = """(sel) => {
  const roots = sel ? [...document.querySelectorAll(sel)] : [document.body];
  const out = [];
  for (const root of roots) for (const el of [root, ...root.querySelectorAll('*')]) {
    if (!el.childNodes.length || el.closest('[data-allow-overflow]')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const text = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!text) continue;
    const clipped = cs.textOverflow === 'ellipsis' || cs.overflowX === 'auto' || cs.overflowX === 'scroll';
    if (el.scrollWidth > el.clientWidth + 1 && !clipped && el.clientWidth > 0)
      out.push({tag: el.tagName, cls: String(el.className).slice(0, 80), text: el.textContent.trim().slice(0, 40),
                sw: el.scrollWidth, cw: el.clientWidth});
  }
  return out.slice(0, 20);
}"""


class Shots:
    def __init__(self, run_dir, request):
        self.dir = run_dir / "visual" / "newui"
        self.dir.mkdir(parents=True, exist_ok=True)
        self.report = []
        self.request = request

    def take(self, page, name: str, scope: str | None = None, locator=None, freeze: bool = True) -> None:
        if freeze:
            page.add_style_tag(content=FREEZE_CSS)
        page.evaluate("async () => { await document.fonts.ready;"
                      " await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }")
        page.wait_for_timeout(200)
        path = self.dir / f"{name}.png"
        (locator or page).screenshot(path=str(path), animations="disabled")
        overflow = page.evaluate(OVERFLOW_JS, scope)
        self.report.append({"name": name, "shot": str(path), "overflow": overflow})

    def save(self, tag: str) -> list[dict]:
        (self.dir / f"report-{tag}.json").write_text(json.dumps(self.report, ensure_ascii=False, indent=1), encoding="utf-8")
        self.request.node.user_properties.append(("visual", {"name": f"newui-{tag}", "count": len(self.report)}))
        return [r for r in self.report if r["overflow"]]


def set_font(app, scale: float) -> None:
    app.page.evaluate("""s => { const k = 'taglauncher.workspace_prefs';
      const p = JSON.parse(localStorage.getItem(k) || '{}'); p.uiFontScale = s; localStorage.setItem(k, JSON.stringify(p)); }""", scale)


def set_dpr(page, dpr: float) -> None:
    cdp = page.context.new_cdp_session(page)
    cdp.send("Emulation.setDeviceMetricsOverride", {"width": 0, "height": 0, "deviceScaleFactor": dpr, "mobile": False})


def combos():
    for mode, tid in MODES:
        for font in FONTS:
            yield mode, tid, font


def apply_combo(app, tid: str, mode: str, font: float) -> None:
    set_font(app, font)
    apply_theme(app, tid, mode)  # 内含 reload
    wait_until(lambda: app.page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--ui-font-scale').trim() || '1'")
               == ("1" if font == 1 else str(font)), 5)


def seed(app, sandbox):
    names = ["设计稿-第三版-最终确认版本-非常长的文件名用来检查溢出.png", "季度报告.docx", "会议纪要.md", "预算表.xlsx"]
    paths = [files.write(sandbox.files / "newui" / n, files.png_bytes(16, 12) if n.endswith(".png") else n) for n in names]
    app.seed(paths)
    ids = {n: app.item(n)["id"] for n in names}
    work = app.add_tag("工作", "#3b82f6")
    report = app.add_tag("报告与总结（很长的标签名）", "#10b981")
    app.invoke("add_tag_relation", {"parentId": work, "childId": report})
    app.invoke("set_item_tags", {"itemId": ids[names[1]], "tagIds": [report]})
    app.invoke("set_item_tags", {"itemId": ids[names[0]], "tagIds": [work, report]})
    cabs = {}
    for n in ("资料", "项目 A（进行中）", "归档"):
        cabs[n] = app.invoke("add_cabinet", {"name": n, "color": "#22c55e"})["id"]
    app.invoke("set_cabinet_parent", {"id": cabs["项目 A（进行中）"], "parentId": cabs["资料"]})
    app.invoke("set_cabinet_parent", {"id": cabs["归档"], "parentId": cabs["项目 A（进行中）"]})
    app.invoke("add_items_to_cabinet", {"cabinetId": cabs["资料"], "itemIds": [ids[names[0]]]})
    app.invoke("add_items_to_cabinet", {"cabinetId": cabs["项目 A（进行中）"], "itemIds": [ids[names[1]], ids[names[2]]]})
    app.invoke("add_items_to_cabinet", {"cabinetId": cabs["归档"], "itemIds": [ids[names[3]]]})
    app.reload_page()
    return ids, cabs, work


@pytest.mark.case("E-VIS-NEWUI-01")
def test_main_window_new_ui(app, sandbox, run_dir, request):
    """主窗：柜层级侧栏（含拖放指示）、含子柜/仅本柜、上级文件柜下拉、子树搜索、桌面驻留设置、toast。"""
    app.close_welcome(3000)
    _, cabs, _ = seed(app, sandbox)
    set_client_size(app, 1100, 760)
    shots = Shots(run_dir, request)
    for mode, tid, font in combos():
        apply_combo(app, tid, mode, font)
        pg = app.page
        for dpr in DPRS:
            set_dpr(pg, dpr)
            tag = f"{mode}-f{font}-d{dpr}"
            app.sidebar_tab("文件柜")
            # 再点已选中的柜会取消选择（回到全部项目）：先回到全部项目，保证这次点击是「选中」
            pg.locator("aside").get_by_text("全部项目", exact=True).first.click()
            cab_row(app, "资料").click()
            pg.get_by_test_id("cabinet-only-self").wait_for(timeout=5000)
            shots.take(pg, f"main-cabinets-{tag}", "aside, [data-testid=cabinet-only-self]")
            # 拖放指示：拖着「归档」停在「资料」行中部（不松手）截图，再拖回原处取消
            src, dst = cab_row(app, "归档"), cab_row(app, "资料")
            s, d = src.bounding_box(), dst.bounding_box()
            m = pg.mouse
            m.move(s["x"] + s["width"] / 2, s["y"] + s["height"] / 2)
            m.down()
            m.move(s["x"] + s["width"] / 2 + 4, s["y"] + s["height"] / 2 + 8, steps=4)
            m.move(d["x"] + d["width"] / 2, d["y"] + d["height"] * 0.5, steps=12)
            pg.wait_for_timeout(150)
            shots.take(pg, f"main-cabinet-drag-into-{tag}", "aside", freeze=False)
            m.move(d["x"] + d["width"] / 2, d["y"] + d["height"] * 0.1, steps=4)
            pg.wait_for_timeout(150)
            shots.take(pg, f"main-cabinet-drag-before-{tag}", "aside", freeze=False)
            pg.keyboard.press("Escape")
            m.move(5, 5, steps=6)
            m.up()
            # 编辑弹窗：上级文件柜
            cab_row(app, "归档").click(button="right")
            dlg = pg.get_by_role("dialog", name="编辑文件柜")
            dlg.get_by_test_id("cabinet-parent-select").wait_for(timeout=5000)
            shots.take(pg, f"main-cabinet-editor-{tag}", "[role=dialog]", locator=dlg)
            pg.keyboard.press("Escape")
            dlg.wait_for(state="hidden")
            # 标签子树搜索（F04c）：标签页里按「工作」筛选
            app.sidebar_tab("标签")
            search = pg.get_by_role("searchbox", name="搜索项目")
            search.fill("#工作")
            pg.wait_for_timeout(400)
            shots.take(pg, f"main-tag-scope-search-{tag}", "aside, main")
            search.fill("")
            # 设置 → 桌面驻留（先选钉住来源，展开全部选项）
            dlg = app.open_settings("桌面驻留")
            dlg.get_by_test_id("pin-source-select").select_option(f"cabinet:{cabs['资料']}")
            pg.wait_for_timeout(300)
            shots.take(pg, f"settings-desktop-top-{tag}", "[role=dialog]", locator=dlg)
            dlg.get_by_test_id("pin-options").scroll_into_view_if_needed()
            shots.take(pg, f"settings-desktop-pin-{tag}", "[role=dialog]", locator=dlg)
            dlg.get_by_test_id("pin-mode-drawer").click()
            pg.wait_for_timeout(300)
            shots.take(pg, f"settings-desktop-pin-drawer-{tag}", "[role=dialog]", locator=dlg)
            dlg.get_by_test_id("pin-mode-float").click()
            for _ in range(3):
                pg.keyboard.press("Escape")
                pg.wait_for_timeout(100)
            # 诊断 toast（F19：Ctrl+Alt+Shift+L 复制列表诊断）
            app.sidebar_tab("标签")
            pg.locator('[data-region="root"]').click(position={"x": 600, "y": 400})
            pg.keyboard.press("Control+Alt+Shift+L")
            toast = pg.get_by_text("已复制列表诊断").first
            toast.wait_for(timeout=5000)
            shots.take(pg, f"main-diag-toast-{tag}", "[role=status], [data-toast]", freeze=False)
            pg.wait_for_timeout(200)
        set_dpr(pg, 1)
    bad = shots.save("main")
    print("NEWUI_MAIN_OVERFLOW", json.dumps(bad, ensure_ascii=False)[:4000])


@pytest.mark.case("E-VIS-NEWUI-02")
def test_quick_and_pin_windows_new_ui(app, sandbox, run_dir, request):
    """快速窗搜索、钉住浮动窗、展开的抽屉、收纳页：随主窗主题与字号（快照）一致。"""
    app.close_welcome(3000)
    _, cabs, _ = seed(app, sandbox)
    shots = Shots(run_dir, request)
    qp = enable_quick(app)
    for mode, tid, font in combos():
        apply_combo(app, tid, mode, font)
        wait_until(lambda: qp.evaluate("document.documentElement.dataset.scheme") == mode, 5,
                   lambda: qp.evaluate("document.documentElement.dataset.scheme"))
        for dpr in DPRS:
            set_dpr(qp, dpr)
            tag = f"{mode}-f{font}-d{dpr}"
            summon(app, qp)
            qp.get_by_test_id("quick-input").fill("报告")
            qp.wait_for_timeout(400)
            shots.take(qp, f"quick-search-{tag}", ".quick-shell")
            qp.get_by_test_id("quick-input").fill("zzz不存在")
            qp.wait_for_timeout(300)
            shots.take(qp, f"quick-search-empty-{tag}", ".quick-shell")
            qp.get_by_test_id("quick-input").fill("")
            app.invoke("quick_hide")
            # 钉住浮动窗
            app.invoke("set_pin_settings", {"settings": {"enabled": True, "source": {"kind": "cabinet", "id": cabs["资料"]},
                                                         "mode": "float", "edge": "right", "topmost": True}})
            qp.get_by_test_id("pin-items").wait_for(timeout=5000)
            wait_until(lambda: qp.evaluate("document.querySelectorAll('[data-testid=pin-item]').length") == 4, 5)
            shots.take(qp, f"pin-float-{tag}", ".pin-shell")
            # 抽屉展开
            app.invoke("set_pin_settings", {"settings": {"enabled": True, "source": {"kind": "tag", "id": app.invoke("get_tags")[0]["id"]},
                                                         "mode": "drawer", "edge": "right", "topmost": True}})
            wait_until(lambda: app.invoke("pin_diag")["handleVisible"], 5)
            assert app.invoke("pin_expand") is True
            qp.wait_for_function("() => innerWidth === 320", timeout=3000)
            shots.take(qp, f"pin-drawer-{tag}", ".pin-shell")
            app.invoke("set_pin_settings", {"settings": {"enabled": False, "source": None, "mode": "float",
                                                         "edge": "right", "topmost": True}})
            time.sleep(0.3)
        set_dpr(qp, 1)
    # 收纳页（浅色标准字号 + 深色特大字号各一张）
    for mode, tid, font in (("light", MODES[0][1], 1), ("dark", MODES[1][1], 1.25)):
        apply_combo(app, tid, mode, font)
        p = files.write(sandbox.files / "newui-collect" / f"收纳-{mode}.txt", "x")
        app.invoke("collect_submit", {"paths": [str(p)]})
        cq = collect_page(app)
        for dpr in DPRS:
            set_dpr(cq, dpr)
            shots.take(cq, f"collect-{mode}-f{font}-d{dpr}", ".quick-shell")
        set_dpr(cq, 1)
        cq.keyboard.press("Escape")
        wait_until(lambda: app.invoke("collect_session") is None, 10)
    bad = shots.save("quick")
    print("NEWUI_QUICK_OVERFLOW", json.dumps(bad, ensure_ascii=False)[:4000])
