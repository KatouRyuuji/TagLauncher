"""视图/导航/收藏 P1/P2（E-VIEW-02/03/04/05/11/13/14、E-FAV-02/03）。全部 CDP，不接管系统鼠标键盘。"""
from __future__ import annotations

import functools
import os
import sqlite3
import time

import pytest

from harness import files
from harness.app import wait_until

SORTS = [
    ("smart", "智能（收藏·最近）"), ("name", "名称 A→Z"), ("name-desc", "名称 Z→A"), ("recent", "最近使用"),
    ("added", "添加时间（新→旧）"), ("added-desc", "添加时间（旧→新）"),
    ("fs-created", "创建时间（新→旧）"), ("fs-created-asc", "创建时间（旧→新）"),
    ("fs-modified", "修改时间（新→旧）"), ("fs-modified-asc", "修改时间（旧→新）"), ("type", "类型"),
]
TYPE_ORDER = {"folder": 0, "image": 1, "audio": 2, "video": 3, "text": 4, "exe": 5, "bat": 6, "ps1": 7}


def _cmp_ts(a, b):
    return (a > b) - (a < b)


def _cmp_fs(a, b, newest):
    if a is None or b is None:
        return 0 if a is None and b is None else (1 if a is None else -1)
    return (b - a) if newest else (a - b)


def expected_order(items, mode):
    """lib/itemQuery.ts compareItems 的 Python 镜像（名称均为小写 ASCII，Collator 与码点序一致）。"""
    def name(a, b):
        return _cmp_ts(a["name"], b["name"])

    def cmp(a, b):
        if mode == "name":
            return name(a, b)
        if mode == "name-desc":
            return name(b, a)
        if mode == "recent":
            return _cmp_ts(b["last_used_at"] or "", a["last_used_at"] or "") or name(a, b)
        if mode == "added":
            return _cmp_ts(b["created_at"], a["created_at"]) or name(a, b)
        if mode == "added-desc":
            return _cmp_ts(a["created_at"], b["created_at"]) or name(a, b)
        if mode.startswith("fs-created"):
            return _cmp_fs(a["fs_created_at"], b["fs_created_at"], mode == "fs-created") or name(a, b)
        if mode.startswith("fs-modified"):
            return _cmp_fs(a["fs_modified_at"], b["fs_modified_at"], mode == "fs-modified") or name(a, b)
        if mode == "type":
            return (TYPE_ORDER.get(a["type"], 9) - TYPE_ORDER.get(b["type"], 9)) or name(a, b)
        if a["is_favorite"] != b["is_favorite"]:
            return -1 if a["is_favorite"] else 1
        return _cmp_ts(b["last_used_at"] or "", a["last_used_at"] or "") or name(a, b)
    return [i["name"] for i in sorted(items, key=functools.cmp_to_key(cmp))]


def choose_sort(app, label):
    app.page.get_by_role("button", name="排序方式").click()
    app.page.get_by_role("listbox", name="排序方式").get_by_role("option", name=label, exact=True).click()


def nav(app, label):
    return app.page.locator('section[aria-labelledby="sidebar-navigation-label"] button[aria-pressed]').filter(has_text=label).first


def drag(app, src, dst):
    """CDP 合成指针拖拽（Input.dispatchMouseEvent，不移动系统光标）。"""
    a, b = src.bounding_box(), dst.bounding_box()
    m = app.page.mouse
    m.move(a["x"] + a["width"] / 2, a["y"] + a["height"] / 2)
    m.down()
    tx, ty = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
    for k in range(1, 13):
        m.move(a["x"] + a["width"] / 2 + (tx - a["x"] - a["width"] / 2) * k / 12,
               a["y"] + a["height"] / 2 + (ty - a["y"] - a["height"] / 2) * k / 12)
        time.sleep(0.02)
    m.up()


@pytest.mark.case("E-VIEW-02")
def test_eleven_sorts(app, sandbox):
    d = sandbox.files / "sorts"
    # 名称序、类型序、时间序故意互相错开
    specs = [("zulu", "folder"), ("mike.png", files.png_bytes()), ("alpha.mp3", files.mp3_bytes()),
             ("xray.mp4", files.mp4_bytes()), ("bravo.txt", "b"), ("kilo.exe", None), ("echo.bat", None)]
    paths = {}
    for n, data in specs:                     # 按此顺序创建（fs_created 递增）
        p = d / n
        if data == "folder":
            p.mkdir(parents=True)
        elif n.endswith(".exe"):
            files.marker_exe(p)
        elif n.endswith(".bat"):
            files.marker_bat(p)
        else:
            files.write(p, data)
        paths[n] = p
        time.sleep(0.05)
    base = time.time() - 10 * 86400
    for k, n in enumerate(["bravo.txt", "zulu", "echo.bat", "alpha.mp3", "kilo.exe", "mike.png", "xray.mp4"]):
        os.utime(paths[n], (base + k * 3600, base + k * 3600))
    for n in ["kilo.exe", "alpha.mp3", "zulu", "xray.mp4", "echo.bat", "mike.png", "bravo.txt"]:
        app.seed([paths[n]])                 # 逐个入库：created_at 随之递增（同秒按名称兜底，期望计算一致）
        time.sleep(1.05)
    # 最近使用：直接写 DB（不真实启动，避免外部进程）；收藏一项
    con = sqlite3.connect(sandbox.db_path, timeout=10)
    with con:
        for n, ts in (("mike.png", "2026-01-02 10:00:00"), ("kilo.exe", "2026-01-03 10:00:00"), ("zulu", "2026-01-01 10:00:00")):
            con.execute("UPDATE items SET last_used_at=? WHERE name=?", (ts, n))
    con.close()
    app.reload_page()
    app.menu_click("bravo.txt", "加入收藏")
    wait_until(lambda: app.item("bravo.txt")["is_favorite"], 5)
    items = app.items()
    assert all(i["fs_modified_at"] is not None for i in items)
    app.page.get_by_role("button", name="列表视图", exact=True).click()
    seen = {}
    for mode, label in SORTS:
        choose_sort(app, label)
        want = expected_order(items, mode)
        wait_until(lambda: app.visible_names() == want, 5, lambda: f"{mode}: 期望 {want} 实际 {app.visible_names()}")
        seen[mode] = tuple(want)
    assert len(set(seen.values())) >= 9, seen   # 用例数据足以区分绝大多数排序


@pytest.mark.case("E-VIEW-03")
def test_type_filters(app, zoo):
    app.seed(list(zoo.values()))
    items = app.items()
    labels = {"folder": "文件夹", "image": "图片", "audio": "音频", "video": "视频", "text": "文本", "exe": "程序", "script": "脚本"}
    btn = app.page.get_by_role("button", name="筛选类型与搜索范围")
    if btn.get_attribute("aria-pressed") != "true":
        btn.click()
    grp = app.page.get_by_role("group", name="文件类型筛选")
    for t, label in labels.items():
        grp.get_by_role("button", name=label, exact=True).click()
        want = [i["name"] for i in items if (i["type"] in ("bat", "ps1") if t == "script" else i["type"] == t)]
        assert want, t
        app.wait_names(want)
        grp.get_by_role("button", name=label, exact=True).click()   # 再点回到全部
        app.wait_names([i["name"] for i in items])
    grp.get_by_role("button", name="全部类型", exact=True).click()
    app.wait_names([i["name"] for i in items])


@pytest.mark.case("E-VIEW-04")
def test_row_density(app, sandbox):
    """实际行高以 ItemRow 常量为准：紧凑 56 / 舒适 64（BUG-11 已修复，提示文字与之一致）。"""
    app.seed([files.write(sandbox.files / "den" / f"行{i}.txt", "x") for i in range(3)])
    app.page.get_by_role("button", name="列表视图", exact=True).click()
    grp = app.page.get_by_role("group", name="行密度")
    row = lambda: app.card("行1.txt").bounding_box()["height"]
    for label, h in (("紧凑", 56), ("舒适", 64), ("紧凑", 56)):
        grp.get_by_role("button", name=label).click()
        wait_until(lambda: abs(row() - h) <= 1.5, 3, lambda: f"{label}: {row()}")
    app.reload_page()
    app.page.get_by_role("button", name="列表视图", exact=True).wait_for()
    wait_until(lambda: abs(row() - 56) <= 1.5, 5, lambda: f"重载后 {row()}")


@pytest.mark.case("E-VIEW-04")
# BUG-11 已修复：原 xfail 改为直接断言（待 Windows 实跑验证）
def test_row_density_tooltip_matches(app, sandbox):
    app.seed([files.write(sandbox.files / "den2" / f"行{i}.txt", "x") for i in range(2)])
    app.page.get_by_role("button", name="列表视图", exact=True).click()
    btn = app.page.get_by_role("group", name="行密度").get_by_role("button", name="舒适")
    btn.click()
    import re
    px = int(re.search(r"(\d+)px", btn.get_attribute("title")).group(1))
    h = app.card("行1.txt").bounding_box()["height"]
    assert abs(h - px) <= 1.5, (px, h)


def _zoom_case(app, sandbox, view, label, n):
    app.seed([files.write(sandbox.files / "zm" / f"缩放{i}.txt", "x") for i in range(n)])
    app.page.get_by_role("button", name=view, exact=True).click()
    w = lambda: app.card("缩放1.txt").bounding_box()["width"]
    reset = app.page.get_by_role("button", name=f"重置{label}为 100%")
    reset.click()
    wait_until(lambda: reset.inner_text().strip() == "100%", 3)
    time.sleep(0.3)
    w0 = w()
    # 网格是自适应列宽：放大改变 --grid-col-min，跨过阈值才减少列数、卡片变宽；点到变宽为止（最多 10 次）
    for _ in range(10):
        app.page.get_by_role("button", name=f"放大{label}").click()
        time.sleep(0.25)
        if w() > w0 + 2:
            break
    wait_until(lambda: w() > w0 + 2, 3, lambda: (w0, w(), reset.inner_text()))
    pct = reset.inner_text().strip()
    assert pct != "100%"
    return w, w0, reset, pct


@pytest.mark.case("E-VIEW-05")
@pytest.mark.parametrize("view,label", [("网格视图", "卡片尺寸"), ("大图标视图", "大图标尺寸")])
def test_zoom_persist(app, sandbox, view, label):
    w, w0, reset, pct = _zoom_case(app, sandbox, view, label, 8)
    app.reload_page()
    app.page.get_by_role("button", name=view, exact=True).wait_for()
    wait_until(lambda: reset.inner_text().strip() == pct and w() > w0 + 2, 5, lambda: (reset.inner_text(), w()))
    reset.click()
    wait_until(lambda: reset.inner_text().strip() == "100%" and abs(w() - w0) <= 1, 3, lambda: (reset.inner_text(), w()))


@pytest.mark.case("E-VIEW-05")
# BUG-12 已修复：原 xfail 改为直接断言（待 Windows 实跑验证）
def test_zoom_few_results(app, sandbox):
    _zoom_case(app, sandbox, "网格视图", "卡片尺寸", 3)


@pytest.mark.case("E-VIEW-11")
def test_nav_exclusive(app, sandbox):
    paths = [files.write(sandbox.files / "nav" / f"{n}.txt", n) for n in ("甲", "乙", "丙")]
    app.seed(paths)
    app.menu_click("甲.txt", "加入收藏")
    wait_until(lambda: app.item("甲.txt")["is_favorite"], 5, "右键加入收藏未写库")
    con = sqlite3.connect(sandbox.db_path, timeout=10)
    with con:
        con.execute("UPDATE items SET last_used_at='2026-01-01 00:00:00' WHERE name='乙.txt'")
    con.close()
    app.reload_page()
    pressed = lambda: [n for n in ("全部项目", "收藏夹", "最近使用") if nav(app, n).get_attribute("aria-pressed") == "true"]
    for label, n in (("全部项目", 3), ("收藏夹", 1), ("最近使用", 1)):
        wait_until(lambda: str(n) in nav(app, label).inner_text(), 3, lambda: nav(app, label).inner_text())
    nav(app, "收藏夹").click()
    wait_until(lambda: pressed() == ["收藏夹"], 3, pressed)
    app.wait_names(["甲.txt"])
    nav(app, "最近使用").click()
    wait_until(lambda: pressed() == ["最近使用"], 3, pressed)
    app.wait_names(["乙.txt"])
    nav(app, "全部项目").click()
    wait_until(lambda: pressed() == ["全部项目"], 3, pressed)
    app.wait_names(["甲.txt", "乙.txt", "丙.txt"])
    app.wait_count(3)


@pytest.mark.case("E-VIEW-13")
def test_sidebar_drawer(app, sandbox):
    """侧栏只在 <720px 布局可折叠（抽屉）；产品没有持久化折叠状态，重载后恢复默认收起（设计如此）。
    最小窗口 786px（BUG-08）到不了该宽度，用 CDP 视口模拟。"""
    app.seed([files.write(sandbox.files / "sb" / "侧栏.txt", "x")])
    side = app.page.locator("#workspace-sidebar")
    try:
        app.page.set_viewport_size({"width": 700, "height": 560})
        toggle = app.page.get_by_role("button", name="打开资源导航")
        toggle.wait_for(timeout=3000)
        in_view = lambda: (lambda b: b is not None and b["x"] + b["width"] > 1)(side.bounding_box())
        wait_until(lambda: not in_view(), 3, side.bounding_box)
        toggle.click()
        wait_until(lambda: "is-mobile-open" in (side.get_attribute("class") or "") and in_view(), 3)
        app.page.locator(".mobile-sidebar-overlay").click(position={"x": 690, "y": 300})
        wait_until(lambda: "is-mobile-open" not in (side.get_attribute("class") or ""), 3)
        app.page.get_by_role("button", name="打开资源导航").click()
        app.reload_page()
        app.page.set_viewport_size({"width": 700, "height": 560})
        app.page.get_by_role("button", name="打开资源导航").wait_for(timeout=3000)
        assert "is-mobile-open" not in (side.get_attribute("class") or "")
        app.page.set_viewport_size({"width": 1200, "height": 760})
        wait_until(in_view, 3)
        app.page.get_by_role("button", name="打开资源导航").wait_for(state="hidden", timeout=3000)
        assert app.js_errors() == []
    finally:
        try:
            app.page.set_viewport_size({"width": 1200, "height": 760})
        except Exception:
            pass


@pytest.mark.case("E-VIEW-14", "E-FAV-02")
def test_drag_to_favorites_and_toasts(app, sandbox):
    app.seed([files.write(sandbox.files / "fv" / n, n) for n in ("拖我.txt", "别动.txt")])
    app.page.get_by_role("button", name="列表视图", exact=True).click()
    fav = app.page.locator("[data-drop-item-favorite]").first
    drag(app, app.card("拖我.txt").get_by_role("heading", level=3), fav)
    wait_until(lambda: app.item("拖我.txt")["is_favorite"], 5)
    assert not app.item("别动.txt")["is_favorite"]
    toast = app.page.get_by_role("status").filter(has_text="已收藏「拖我.txt」")
    toast.wait_for(timeout=3000)
    t0 = time.monotonic()
    toast.wait_for(state="detached", timeout=8000)        # success 3.5s 自动消失
    assert 2.5 < time.monotonic() - t0 < 6.5
    # 再拖一次 → info「已在收藏中」，点关闭立即消失
    drag(app, app.card("拖我.txt").get_by_role("heading", level=3), fav)
    info = app.page.get_by_role("status").filter(has_text="已在收藏中")
    info.wait_for(timeout=3000)
    info.get_by_role("button", name="关闭通知").click()
    info.wait_for(state="detached", timeout=1500)
    # error toast：用 IPC 桩让收藏失败
    app.stub("toggle_favorite", error="e2e 注入失败")
    app.menu_click("别动.txt", "加入收藏")
    err = app.page.get_by_role("alert").first
    err.wait_for(timeout=3000)
    err.get_by_role("button", name="关闭通知").click()
    err.wait_for(state="detached", timeout=1500)
    nav(app, "收藏夹").click()
    app.wait_names(["拖我.txt"])


@pytest.mark.case("E-FAV-03")
def test_recent_order(app, sandbox):
    exes = [files.marker_exe(sandbox.files / "rc" / f"{n}.exe") for n in ("A启动", "B启动", "C启动")]
    app.seed(exes)
    app.page.get_by_role("button", name="列表视图", exact=True).click()
    for p in exes:
        app.select_card(p.name)
        app.page.keyboard.press("Enter")
        files.wait_marker(p)
        time.sleep(1.1)                      # last_used_at 为秒级
    nav(app, "最近使用").click()
    wait_until(lambda: app.visible_names() == ["C启动.exe", "B启动.exe", "A启动.exe"], 5, app.visible_names)
