"""右键菜单、快速预览、收藏（E-CTX-* / E-PRV-01 / E-FAV-01）。"""
from __future__ import annotations

import pytest

from harness import files
from harness.app import wait_until

FILE_MENU = {"快速预览", "复制路径", "加入收藏", "管理标签", "编辑备注…", "重命名…", "添加到文件柜",
             "从库中移除", "删除本地文件", "缩略图"}


def menu_labels(menu) -> list[str]:
    return [t.strip() for t in menu.get_by_role("menuitem").all_inner_texts()]


@pytest.mark.case("E-CTX-01")
def test_single_file_menu(app, sandbox):
    p = files.write(sandbox.files / "ctx" / "菜单.txt", "m")
    app.seed([p])
    app.invoke("add_cabinet", {"name": "菜单柜", "color": "#22c55e"})  # 无手动文件柜时不显示「添加到文件柜」
    app.reload_page()
    labels = menu_labels(app.context_menu("菜单.txt"))
    joined = "\n".join(labels)
    missing = [x for x in FILE_MENU if not any(x in l for l in labels)]
    assert not missing, f"缺少 {missing}；实际 {labels}"
    assert "在资源管理器中打开" in joined or "打开所在文件夹" in joined or "所在" in joined, labels
    (app.sb.artifacts / "ctx-01-menu.txt").write_text(joined, encoding="utf-8")


@pytest.mark.case("E-CTX-03")
def test_multi_select_menu(app, sandbox):
    ps = [files.write(sandbox.files / "ctx" / f"多{i}.txt", str(i)) for i in range(3)]
    app.seed(ps)
    app.card("多0.txt").click()
    app.card("多2.txt").click(modifiers=["Shift"])
    labels = menu_labels(app.context_menu("多1.txt"))
    for want in ("复制 3 条路径", "从库中移除 3 项", "删除 3 个本地文件"):
        assert any(want in l for l in labels), f"缺少 {want}；实际 {labels}"
    assert not any(l.startswith("重命名…") for l in labels)


@pytest.mark.case("E-PRV-01")
@pytest.mark.parametrize("name,data,size", [
    ("预览.png", files.png_bytes(40, 30), "40 × 30"),
    ("预览.jpg", files.jpg_bytes(8, 6), "8 × 6"),
])
def test_image_preview(app, sandbox, name, data, size):
    p = files.write(sandbox.files / "prv" / name, data)
    app.seed([p])
    app.card(name).click()
    app.page.keyboard.press(" ")
    pv = app.page.get_by_role("dialog", name="快速预览")
    pv.wait_for()
    pv.locator("img").first.wait_for()
    wait_until(lambda: size in pv.inner_text(), 8, lambda: pv.inner_text())
    app.page.keyboard.press("Escape")
    pv.wait_for(state="hidden")


@pytest.mark.case("E-FAV-01")
def test_favorite_toggle_and_pin(app, sandbox):
    ps = [files.write(sandbox.files / "fav" / f"{c}.txt", c) for c in ("甲", "乙", "丙")]
    app.seed(ps)
    last = app.visible_names()[-1]
    app.menu_click(last, "加入收藏")
    wait_until(lambda: app.item(last)["is_favorite"], 3)
    wait_until(lambda: app.visible_names()[0] == last, 5, lambda: app.visible_names())
    app.page.get_by_role("button", name="收藏夹").click()
    app.wait_names([last])
    app.card(last).click()
    app.page.keyboard.press("Control+d")
    wait_until(lambda: not app.item(last)["is_favorite"], 3)
    wait_until(lambda: app.visible_names() == [], 5, lambda: app.visible_names())
