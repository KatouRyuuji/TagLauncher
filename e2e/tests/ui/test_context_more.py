"""右键菜单 P1/P2（E-CTX-02/04/05/06/07）。全部 CDP 鼠标/键盘，不动系统光标。"""
from __future__ import annotations

import pytest

from harness import files
from harness.app import wait_until

from .test_context import menu_labels


def inside_viewport(app, loc) -> None:
    # 菜单入场动画 app-float-in 带 translateY(10px)，bounding_box 含 transform：等动画结束再量，
    # 否则底边会多算最多 10px（Windows 实跑 1.4px 越界即此原因，属测试侧时序）
    loc.evaluate("el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => null)))")
    box = loc.bounding_box()
    vp = app.page.evaluate("({w: innerWidth, h: innerHeight})")
    assert box and box["x"] >= 0 and box["y"] >= 0, box
    assert box["x"] + box["width"] <= vp["w"] + 0.5 and box["y"] + box["height"] <= vp["h"] + 0.5, (box, vp)


LOADING = "正在读取监视状态…"


def watch_labels_settled(menu, want: str, wrong: str) -> list[str]:
    """监视项读回前只允许显示读取中占位（禁用），任何一次轮询看到相反状态即失败。"""
    seen, bad = [], []

    def check():
        labels = menu_labels(menu)
        seen.append(labels)
        if any(l.startswith(wrong) for l in labels):
            bad.append(labels)            # wait_until 会吞异常，错误标签单独记下、等完再断言
        return labels if any(l.startswith(want) for l in labels) else None
    labels = wait_until(check, 5, lambda: seen[-3:])
    assert not bad, f"监视项出现过错误标签「{wrong}」：{bad[:2]}"
    return labels


@pytest.mark.case("E-CTX-02")
def test_folder_menu(app, sandbox):
    d = sandbox.files / "菜单夹"
    files.write(d / "a.txt", "a")
    app.seed([d])
    menu = app.context_menu("菜单夹")
    labels = watch_labels_settled(menu, "监视此文件夹", "停止监视此文件夹")
    assert "打开此文件夹" in labels and "打开上一级" in labels and LOADING not in labels, labels
    menu.get_by_role("menuitem", name="监视此文件夹").click()
    app.wait_toast("已打开监视")
    # 菜单每次打开才异步读监视状态：读回前显示禁用的占位项，绝不显示旧的「监视此文件夹」
    menu = app.context_menu("菜单夹")
    labels = watch_labels_settled(menu, "停止监视此文件夹", "监视此文件夹")
    assert LOADING not in labels, labels
    app.page.get_by_role("menuitem").filter(has_text="停止监视此文件夹").click()
    app.wait_toast("已停止监视")


@pytest.mark.case("E-CTX-04")
def test_linked_cabinet_folder_menu(app, sandbox):
    root = sandbox.files / "关联根"
    files.write(root / "柜内子夹" / "x.txt", "x")
    cab = app.invoke("add_cabinet", {"name": "关联菜单柜", "color": "#22c55e"})
    app.invoke("set_cabinet_folder", {"id": cab["id"], "folder": str(root)})
    app.reload_page()
    app.sidebar_tab("文件柜")
    app.page.locator(f'[data-drop-item-cabinet-id="{cab["id"]}"]').click()
    app.card("柜内子夹").wait_for(timeout=10_000)
    labels = menu_labels(app.context_menu("柜内子夹"))
    assert labels[0] == "进入此文件夹" and "在资源管理器中打开" in labels, labels
    app.stub("open_in_explorer", None)
    app.page.get_by_role("menuitem", name="在资源管理器中打开").click()
    wait_until(lambda: app.calls("open_in_explorer"), 3, "未调用 open_in_explorer")
    app.menu_click("柜内子夹", "进入此文件夹")
    app.wait_names(["x.txt"])


@pytest.mark.case("E-CTX-05")
def test_missing_item_menu(app, sandbox):
    p = files.write(sandbox.files / "cm" / "失效菜单.txt", "m")
    d = sandbox.files / "cm" / "失效夹"
    files.write(d / "k.txt", "k")
    app.seed([p, d])
    p.unlink()
    (d / "k.txt").unlink()
    d.rmdir()
    app.invoke("reconcile_items", {"force": True, "wait": True})
    app.reload_page()
    wait_until(lambda: app.item("失效菜单.txt")["is_missing"] and app.item("失效夹")["is_missing"], 10)
    labels = menu_labels(app.context_menu("失效菜单.txt"))
    assert "查看失效项目" in labels and "重命名…" not in labels, labels
    app.page.keyboard.press("Escape")
    labels = menu_labels(app.context_menu("失效夹"))
    assert "监视此文件夹" not in labels and "查看失效项目" in labels, labels
    app.page.get_by_role("menuitem", name="查看失效项目").click()
    app.page.get_by_role("dialog").filter(has_text="失效").first.wait_for(timeout=5000)


@pytest.mark.case("E-CTX-06")
def test_menu_keyboard_and_edges(app, sandbox):
    ps = [files.write(sandbox.files / "ce" / f"边缘{i:02d}.txt", str(i)) for i in range(12)]
    app.seed(ps)
    app.page.get_by_role("button", name="列表视图", exact=True).click()
    menu = app.context_menu("边缘00.txt")
    items = menu.get_by_role("menuitem")
    focused = lambda: app.page.evaluate("document.activeElement?.textContent?.trim() || ''")
    app.page.keyboard.press("ArrowDown")
    first = focused()
    app.page.keyboard.press("ArrowDown")
    assert focused() != first
    app.page.keyboard.press("ArrowUp")
    assert focused() == first
    # 移到缩略图父项，→ 打开子菜单
    trig = menu.locator('button[aria-haspopup="menu"]').filter(has_text="缩略图").first
    trig.focus()
    app.page.keyboard.press("ArrowRight")
    wait_until(lambda: trig.get_attribute("aria-expanded") == "true", 3, "子菜单未展开")
    wait_until(lambda: "设置缩略图" in focused(), 3, focused)
    app.page.keyboard.press("Escape")
    app.page.keyboard.press("Escape")
    wait_until(lambda: app.page.locator("[data-context-menu][role=menu]").count() == 0, 3, "Esc 未关闭菜单")


@pytest.mark.case("E-CTX-06")
# BUG-13 已修复：原 xfail 改为直接断言（待 Windows 实跑验证）
def test_menu_edges_within_viewport(app, sandbox):
    ps = [files.write(sandbox.files / "ce" / f"边缘{i:02d}.txt", str(i)) for i in range(12)]
    app.seed(ps)
    app.page.get_by_role("button", name="列表视图", exact=True).click()
    # 窗口右下角右键：项目菜单与子菜单都不越界
    last = app.card("边缘11.txt")
    last.scroll_into_view_if_needed()
    b = last.bounding_box()
    vp = app.page.evaluate("({w: innerWidth, h: innerHeight})")
    x = min(b["x"] + b["width"] - 4, vp["w"] - 4)
    y = min(b["y"] + b["height"] / 2, vp["h"] - 4)
    app.page.mouse.click(x, y, button="right")
    menu = app.page.locator("[data-context-menu][role=menu]").first
    menu.wait_for()
    inside_viewport(app, menu)
    trig = menu.locator('button[aria-haspopup="menu"]').filter(has_text="缩略图").first
    trig.hover()
    sub = app.page.locator("[role=menu]").filter(has_text="设置缩略图").last
    sub.wait_for()
    inside_viewport(app, sub)
    app.page.keyboard.press("Escape")
    # 空白处最右下角
    app.page.keyboard.press("Escape")
    canvas = app.page.locator("[data-region=item-list], [data-region=item-grid]").first
    cb = canvas.bounding_box()
    app.page.mouse.click(min(cb["x"] + cb["width"], vp["w"]) - 3, min(cb["y"] + cb["height"], vp["h"]) - 3, button="right")
    bg = app.page.locator("[role=menu]").filter(has_text="添加文件").first
    bg.wait_for(timeout=3000)
    inside_viewport(app, bg)


@pytest.mark.case("E-CTX-07")
def test_blank_area_menu(app, sandbox):
    p = files.write(sandbox.files / "cb" / "唯一.txt", "u")
    app.seed([p])
    app.page.get_by_role("button", name="列表视图", exact=True).click()
    card = app.card("唯一.txt").bounding_box()
    app.page.mouse.click(card["x"] + 40, card["y"] + card["height"] + 120, button="right")
    menu = app.page.locator("[role=menu]").first
    menu.wait_for(timeout=3000)
    labels = menu_labels(menu)
    assert "添加文件" in labels and "添加文件夹" in labels, labels
    assert not any(l.startswith("复制路径") or l.startswith("重命名") for l in labels), labels
    app.stub("plugin:dialog|open", None)
    menu.get_by_role("menuitem", name="添加文件", exact=True).click()
    wait_until(lambda: app.calls("plugin:dialog|open"), 3, "未弹出文件选择")
    assert len(app.items()) == 1
