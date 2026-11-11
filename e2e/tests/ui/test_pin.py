"""钉住视图 / 边缘抽屉（E-PIN-*，E-PERF-PIN）：复用快速窗 WebView 的 pin 表面。

真实鼠标碰边、自动收回、前台全屏在 desktop 层（tests/desktop/test_desktop_pin.py）；这里在
ui 层（窗口被移到屏幕外）验证设置、内容口径、实时同步、打开、与快速搜索共用一个窗口、
抽屉展开/收起的尺寸，以及常驻内存增量与空闲 CPU（release 作业也跑）。
"""
from __future__ import annotations

import json
import statistics
import time

import pytest

from harness import files
from harness import procmem
from harness.app import wait_until
from tests.cli.conftest import Tl
from tests.ui.test_quick import (HIDDEN_MEM_MB, IDLE_CPU_PCT, build_library, enable_quick, is_visible,
                                 quick_page, quick_pages, summon)

# 钉住视图开启（浮动窗显示一个 300 项的柜）且快速搜索未开：常驻私有内存增量沿用快速窗隐藏常驻同档阈值
PIN_MEM_MB = {5000: HIDDEN_MEM_MB[5000]}
PIN_IDLE_WINDOW_S = 120
OFF = {"enabled": False, "source": None, "mode": "float", "edge": "right", "topmost": True}


def pin_settings(app, **patch) -> dict:
    cur = app.invoke("get_pin_settings")
    cur.update(patch)
    return app.invoke("set_pin_settings", {"settings": cur})


def surface(qp) -> str | None:
    return qp.evaluate("() => document.documentElement.dataset.surface ?? null")


def pin_ids(qp) -> list[int]:
    return [int(x) for x in qp.evaluate(
        "() => [...document.querySelectorAll('[data-testid=pin-item]')].map(e => e.dataset.itemId)")]


def diag(app) -> dict:
    return app.invoke("pin_diag")


def seed(app, sandbox):
    paths = [files.write(sandbox.files / "pin" / n, n) for n in ("报告.docx", "截图.png", "草稿.txt", "其他.txt")]
    app.seed(paths)
    item = {n: app.item(n)["id"] for n in ("报告.docx", "截图.png", "草稿.txt", "其他.txt")}
    parent = app.invoke("add_cabinet", {"name": "资料", "color": "#22c55e"})["id"]
    child = app.invoke("add_cabinet", {"name": "项目", "color": "#22c55e"})["id"]
    app.invoke("set_cabinet_parent", {"id": child, "parentId": parent})
    app.invoke("add_items_to_cabinet", {"cabinetId": parent, "itemIds": [item["报告.docx"]]})
    app.invoke("add_items_to_cabinet", {"cabinetId": child, "itemIds": [item["截图.png"]]})
    return item, parent, child


@pytest.mark.case("E-PIN-01")
def test_pin_off_by_default_then_float_shows_cabinet_with_children(app, sandbox):
    """默认关、不建窗；没选来源不能开；钉住父柜 = 本柜 ∪ 子柜；与主窗同口径排序；关闭即销毁窗口。"""
    item, parent, child = seed(app, sandbox)
    time.sleep(2.5)
    assert app.invoke("get_pin_settings") == OFF
    assert quick_pages(app) == [], "默认关闭：不应创建 quick 窗口"
    err = app.invoke_error("set_pin_settings", {"settings": {**OFF, "enabled": True}})
    assert err and "请先选择" in err, err
    err = app.invoke_error("set_pin_settings", {"settings": {**OFF, "enabled": True, "source": {"kind": "cabinet", "id": 9999}}})
    assert err and "不存在" in err, err

    s = pin_settings(app, enabled=True, source={"kind": "cabinet", "id": parent})
    assert s["enabled"] and s["source"] == {"kind": "cabinet", "id": parent}
    qp = quick_page(app, timeout=20)
    wait_until(lambda: surface(qp) == "pin", 5, lambda: surface(qp))
    assert is_visible(qp), "浮动窗应显示"
    qp.get_by_test_id("pin-title").filter(has_text="资料").wait_for(timeout=5000)
    wait_until(lambda: sorted(pin_ids(qp)) == sorted([item["报告.docx"], item["截图.png"]]), 5, lambda: pin_ids(qp))
    assert qp.get_by_test_id("pin-count").inner_text() == "2"
    assert not qp.get_by_test_id("quick-input").is_visible(), "钉住表面下搜索框隐藏"
    # 子柜单独钉住：标题是路径名
    pin_settings(app, source={"kind": "cabinet", "id": child})
    qp.get_by_test_id("pin-title").filter(has_text="资料 / 项目").wait_for(timeout=5000)
    wait_until(lambda: pin_ids(qp) == [item["截图.png"]], 5, lambda: pin_ids(qp))
    # 关闭：快速搜索没开 → 窗口销毁（不占资源）
    pin_settings(app, enabled=False)
    wait_until(lambda: quick_pages(app) == [], 10, "关闭钉住视图且快速搜索未开时应销毁 quick 窗口")


@pytest.mark.case("E-PIN-02")
def test_pin_live_sync_open_and_missing_source(app, sandbox, cli_path):
    """标签来源含子标签；tl CLI（外部进程）与主窗（本应用）写入都实时反映；双击打开；来源删除后提示。"""
    tl = Tl(sandbox, cli_path)
    item, _, _ = seed(app, sandbox)
    work = app.add_tag("工作")
    report = app.add_tag("报告")
    app.invoke("add_tag_relation", {"parentId": work, "childId": report})
    app.invoke("set_item_tags", {"itemId": item["草稿.txt"], "tagIds": [report]})
    pin_settings(app, enabled=True, source={"kind": "tag", "id": work})
    qp = quick_page(app, timeout=20)
    wait_until(lambda: pin_ids(qp) == [item["草稿.txt"]], 5, lambda: pin_ids(qp))

    t0 = time.time()
    tl.run("tag", "set", str(item["其他.txt"]), "报告")
    wait_until(lambda: item["其他.txt"] in pin_ids(qp), 5, lambda: pin_ids(qp))
    external_ms = round((time.time() - t0) * 1000)
    t0 = time.time()
    app.invoke("set_item_tags", {"itemId": item["截图.png"], "tagIds": [work]})
    wait_until(lambda: item["截图.png"] in pin_ids(qp), 5, lambda: pin_ids(qp))
    app_ms = round((time.time() - t0) * 1000)
    print(f"PIN_SYNC external_ms={external_ms} app_ms={app_ms}")

    qp.evaluate("() => window.__e2e.stub('launch_item', { value: null })")
    qp.locator(f"[data-testid=pin-item][data-item-id='{item['截图.png']}']").dblclick()
    wait_until(lambda: [c["args"].get("id") for c in qp.evaluate("() => window.__e2e.callsOf('launch_item')")] == [item["截图.png"]], 3)
    assert is_visible(qp), "浮动窗打开对象后保持显示"

    qp.get_by_test_id("pin-filter").fill("其他")
    wait_until(lambda: pin_ids(qp) == [item["其他.txt"]], 3, lambda: pin_ids(qp))
    qp.get_by_test_id("pin-filter").fill("")

    app.invoke("remove_tag", {"id": work})
    qp.get_by_test_id("pin-missing").wait_for(timeout=5000)


@pytest.mark.case("E-PIN-03")
def test_pin_shares_window_with_quick_search(app, sandbox):
    """快速搜索与钉住视图共用一个 WebView：唤出 = 切到搜索表面并聚焦；收起 = 还原钉住视图（窗口不隐藏）。"""
    _, parent, _ = seed(app, sandbox)
    qp = enable_quick(app)
    pin_settings(app, enabled=True, source={"kind": "cabinet", "id": parent})
    wait_until(lambda: surface(qp) == "pin", 5, lambda: surface(qp))
    assert len(quick_pages(app)) == 1, "只有一个 quick 窗口（同一个 WebView）"
    pin_size = qp.evaluate("() => [innerWidth, innerHeight]")
    summon(app, qp)
    assert surface(qp) == "search"
    assert qp.evaluate("() => document.activeElement?.dataset?.testid") == "quick-input"
    assert qp.evaluate("() => innerWidth") == 680, "搜索表面用快速窗尺寸"
    app.invoke("quick_hide")
    wait_until(lambda: surface(qp) == "pin", 5, lambda: surface(qp))
    assert is_visible(qp), "搜索收起后还原钉住视图，不隐藏"
    wait_until(lambda: qp.evaluate("() => [innerWidth, innerHeight]") == pin_size, 3,
               lambda: (qp.evaluate("() => [innerWidth, innerHeight]"), pin_size))
    # 关闭钉住视图：快速搜索仍开 → 窗口保留（隐藏），可继续唤出
    pin_settings(app, enabled=False)
    wait_until(lambda: not is_visible(qp), 5, "关闭钉住视图后窗口应隐藏")
    assert len(quick_pages(app)) == 1
    summon(app, qp)
    assert surface(qp) == "search"
    app.invoke("quick_hide")
    wait_until(lambda: not is_visible(qp), 3)


@pytest.mark.case("E-PIN-04")
def test_drawer_handle_expand_collapse_sizes(app, sandbox):
    """边缘抽屉：收起时 quick 窗口隐藏、只留原生把手（4 逻辑像素宽，贴工作区边）；展开到面板宽 320；
    收起后不计为可见（不提高检测频率）。"""
    _, parent, _ = seed(app, sandbox)
    pin_settings(app, enabled=True, source={"kind": "cabinet", "id": parent}, mode="drawer", edge="right")
    qp = quick_page(app, timeout=20)
    wait_until(lambda: diag(app)["handleVisible"], 5, lambda: diag(app))
    d = diag(app)
    assert not is_visible(qp), "收起时 quick 窗口（WebView）应隐藏"
    assert d["view"]["drawer"] == "collapsed" and d["countsAsVisible"] is False, d
    assert d["hookInstalled"] is True, "抽屉模式应装前台切换事件钩子"
    scale = qp.evaluate("() => devicePixelRatio")
    assert 3 <= d["handleRect"][2] <= round(4 * scale) + 1, d
    qp.get_by_test_id("pin-panel").wait_for(state="attached", timeout=3000)
    assert app.invoke("pin_expand") is True
    wait_until(lambda: is_visible(qp) and qp.evaluate("() => innerWidth") == 320, 3,
               lambda: (is_visible(qp), qp.evaluate("() => innerWidth")))
    d = diag(app)
    assert d["countsAsVisible"] is True and d["handleVisible"] is False, d
    assert app.invoke("pin_expand") is False, "已展开时不重复展开"
    assert app.invoke("pin_collapse") is True
    wait_until(lambda: not is_visible(qp) and diag(app)["handleVisible"], 3, lambda: diag(app))
    pin_settings(app, mode="float")
    wait_until(lambda: is_visible(qp), 3)
    d = diag(app)
    assert d["hookInstalled"] is False and d["handleVisible"] is False, "离开抽屉模式应卸载钩子、收起把手"


@pytest.mark.case("E-PERF-PIN")
def test_pin_resident_memory_and_idle_cpu(sandbox, app_factory):
    """5k 库：只开钉住视图（快速搜索未开）显示 300 项柜，进程树私有内存增量 ≤ 60 MB；
    主窗关到托盘后，抽屉收起 / 浮动窗显示两种状态各 120 s 平均 CPU ≤ 单核 1%。"""
    from win import win32
    build_library(sandbox, 5000)
    app = app_factory()
    app.wait_count(5000, timeout=120)
    app.close_welcome(3000)
    time.sleep(5)
    pid = app.proc.pid

    def mem():
        samples = []
        for _ in range(3):
            samples.append(procmem.tree_memory(pid))
            time.sleep(1)
        return {"private_mb": statistics.median(s["private_mb"] for s in samples),
                "working_set_mb": statistics.median(s["working_set_mb"] for s in samples)}

    cab = app.invoke("add_cabinet", {"name": "常用", "color": "#22c55e"})["id"]
    app.invoke("add_items_to_cabinet", {"cabinetId": cab, "itemIds": list(range(1, 301))})
    before = mem()
    pin_settings(app, enabled=True, source={"kind": "cabinet", "id": cab})
    qp = quick_page(app, timeout=30)
    wait_until(lambda: len(pin_ids(qp)) == 300, 15, lambda: len(pin_ids(qp)))
    time.sleep(8)
    after = mem()
    delta = round(after["private_mb"] - before["private_mb"], 1)

    assert app.invoke("set_close_action", {"action": "tray"})["trayActive"]
    h = win32.main_window(pid, timeout=20, visible=False)
    win32.user32.PostMessageW(h, 0x0010, 0, 0)
    wait_until(lambda: not win32.is_visible(h), 8, "关闭到托盘应隐藏主窗")

    def idle(label: str) -> dict:
        time.sleep(10)
        t0, c0 = time.time(), procmem.tree_cpu(pid)
        time.sleep(PIN_IDLE_WINDOW_S)
        t1, c1 = time.time(), procmem.tree_cpu(pid)
        rows = [{"pid": p, "exe": exe, "cpu_s": round(s - c0[p][1], 3)} for p, (exe, s) in c1.items() if p in c0]
        total = sum(r["cpu_s"] for r in rows)
        return {"state": label, "window_s": round(t1 - t0, 1), "cpu_s": round(total, 3),
                "avg_pct_one_core": round(total / (t1 - t0) * 100, 3),
                "processes": sorted(rows, key=lambda r: -r["cpu_s"])[:6]}

    idle_float = idle("float-visible")
    pin_settings(app, mode="drawer")
    wait_until(lambda: diag(app)["handleVisible"], 5, lambda: diag(app))
    idle_drawer = idle("drawer-collapsed")
    out = {"items": 5000, "pin_items": 300, "resident_private_mb_delta": delta,
           "resident_working_set_mb_delta": round(after["working_set_mb"] - before["working_set_mb"], 1),
           "mem_before": before, "mem_after": after, "idle": [idle_float, idle_drawer],
           "targets": {"resident_mb": PIN_MEM_MB[5000], "idle_pct": IDLE_CPU_PCT}}
    (sandbox.artifacts / "pin-perf.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("PIN_PERF", json.dumps(out, ensure_ascii=False))
    problems = []
    if delta > PIN_MEM_MB[5000]:
        problems.append(f"钉住视图常驻私有内存增量 {delta}MB > {PIN_MEM_MB[5000]}MB")
    for r in (idle_float, idle_drawer):
        if r["avg_pct_one_core"] > IDLE_CPU_PCT:
            problems.append(f"{r['state']} 空闲 CPU {r['avg_pct_one_core']}% > {IDLE_CPU_PCT}%")
    assert not problems, "；".join(problems) + "（详见 pin-perf.json）"
