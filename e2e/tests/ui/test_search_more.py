"""搜索 P1/P2（E-SR-04..12）。期望集合由 Python 侧独立给出。"""
from __future__ import annotations

import json
import time

import pytest

from harness import files
from harness.app import wait_until


def open_filters(app):
    btn = app.page.get_by_role("button", name="筛选类型与搜索范围")
    if btn.get_attribute("aria-pressed") != "true":
        btn.click()
    app.page.locator('[data-region="filterbar"]').wait_for(timeout=5000)


def scope_btn(app, label):
    return app.page.get_by_role("group", name="搜索范围").get_by_role("button", name=label, exact=True)


@pytest.mark.case("E-SR-04")
def test_search_scope_modes(app, sandbox):
    a = files.write(sandbox.files / "sr4" / "红色报告.txt", "a")
    b = files.write(sandbox.files / "sr4" / "普通文件.txt", "b")
    app.seed([a, b])
    tid = app.add_tag("红色")
    app.invoke("set_item_tags", {"itemId": app.item("普通文件.txt")["id"], "tagIds": [tid]})
    app.reload_page()
    app.search("红色")
    app.wait_names(["红色报告.txt", "普通文件.txt"])          # 全部：名称 + 标签
    open_filters(app)
    scope_btn(app, "名称").click()
    app.wait_names(["红色报告.txt"])
    assert app.page.get_by_label("1 个筛选激活").count() == 1
    scope_btn(app, "标签").click()
    app.wait_names(["普通文件.txt"])
    scope_btn(app, "全部").click()                           # 退出搜索模式：恢复全部范围，关键词保留
    app.wait_names(["红色报告.txt", "普通文件.txt"])
    assert app.page.locator("#workspace-search").input_value() == "红色"
    assert app.page.get_by_label("1 个筛选激活").count() == 0


@pytest.mark.case("E-SR-05")
def test_synonyms_from_exe_dir(app_factory, sandbox):
    sandbox.install_exe()
    (sandbox.bin / "synonyms.json").write_text(json.dumps([["猫咪档案", "zqxcat"]], ensure_ascii=False), encoding="utf-8")
    app = app_factory()
    p = files.write(sandbox.files / "sr5" / "zqxcat-notes.txt", "x")
    q = files.write(sandbox.files / "sr5" / "其它.txt", "y")
    app.seed([p, q])
    app.search("猫咪档案")
    app.wait_names(["zqxcat-notes.txt"])


@pytest.mark.case("E-SR-06")
def test_typo_tolerance(app, sandbox):
    app.seed([files.write(sandbox.files / "sr6" / n, n) for n in ("photoshop.exe.txt", "notepad.txt", "blender.txt")])
    app.search("photoshpp")        # 1 处替换
    app.wait_names(["photoshop.exe.txt"])
    app.search("blendr")           # 替换 1 个字母（切片窗口等长时只认替换）
    app.wait_names(["blender.txt"])
    app.search("zzzzzz")
    time.sleep(0.8)
    assert app.visible_names() == []


@pytest.mark.case("E-SR-07")
def test_note_search(app, sandbox):
    a = files.write(sandbox.files / "sr7" / "甲.txt", "a")
    b = files.write(sandbox.files / "sr7" / "乙.txt", "b")
    app.seed([a, b])
    app.menu_click("乙.txt", "编辑备注…")
    dlg = app.dialog("编辑备注")
    dlg.get_by_label("备注内容").fill("钥匙在抽屉里")
    dlg.get_by_label("备注内容").press("Control+Enter")
    dlg.wait_for(state="detached", timeout=5000)
    app.search("抽屉")
    app.wait_names(["乙.txt"])


@pytest.mark.case("E-SR-08")
@pytest.mark.parametrize("q,expect", [
    ("100%", ["100%完成.txt"]),
    ("a_b", ["a_b.txt"]),          # _ 不是通配符：aXXb 不命中
    ("引号'", ["引号'单.txt"]),
    ('"普通"', []),                # Windows 文件名不能含 "：按字面即无命中、且不报错
    ("%", ["%前缀.txt"]),          # % 不是通配符：只按字面前缀
])
def test_special_chars_literal(app, sandbox, q, expect):
    names = ["100%完成.txt", "%前缀.txt", "a_b.txt", "aXXb.txt", "引号'单.txt", "普通.txt"]
    app.seed([files.write(sandbox.files / "sr8" / n, n) for n in names])
    app.search(q)
    if expect:
        app.wait_names(expect)
    else:
        app.page.locator("#workspace-empty-title").wait_for(timeout=5000)
        assert app.visible_names() == []
    assert app.js_errors() == []


@pytest.mark.case("E-SR-09")
def test_ime_composition_does_not_search(app, sandbox):
    app.seed([files.write(sandbox.files / "sr9" / n, n) for n in ("中文名.txt", "other.txt")])
    box = app.page.locator("#workspace-search")
    box.click()
    calls0 = len(app.calls("view_query"))
    app.page.evaluate("""() => {
      const el = document.getElementById('workspace-search');
      el.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true, data: ''}));
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, 'zhong');
      el.dispatchEvent(new InputEvent('input', {bubbles: true, isComposing: true, data: 'zhong', inputType: 'insertCompositionText'}));
      // 组合中按 Process 键不得触发工作台快捷键（例如 ? 打开快捷键帮助）
      el.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key: 'Process', isComposing: true}));
      el.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key: '?', isComposing: true}));
    }""")
    time.sleep(0.8)
    assert sorted(app.visible_names()) == ["other.txt", "中文名.txt"], "组合输入期间提前搜索了"
    assert len(app.calls("view_query")) == calls0, "组合输入期间调用了后端搜索"
    assert app.page.get_by_role("dialog", name="快捷键").count() == 0
    assert app.page.locator('[aria-labelledby="shortcuts-help-title"]').count() == 0
    app.page.evaluate("""() => {
      const el = document.getElementById('workspace-search');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(el, '中文');
      el.dispatchEvent(new CompositionEvent('compositionend', {bubbles: true, data: '中文'}));
      el.dispatchEvent(new InputEvent('input', {bubbles: true, data: '中文', inputType: 'insertText'}));
    }""")
    app.wait_names(["中文名.txt"])
    assert len(app.calls("view_query")) > calls0, "组合结束后应走后端搜索"


@pytest.mark.case("E-SR-10")
def test_clear_button_and_esc(app, sandbox):
    app.seed([files.write(sandbox.files / "sr10" / n, n) for n in ("一.txt", "二.txt")])
    app.search("一")
    app.wait_names(["一.txt"])
    app.page.get_by_role("button", name="清空搜索").first.click()
    app.wait_names(["一.txt", "二.txt"])
    assert app.page.locator("#workspace-search").input_value() == ""
    box = app.page.locator("#workspace-search")
    box.click()
    box.press_sequentially("二", delay=30)
    app.wait_names(["二.txt"])
    box.press("Escape")
    app.wait_names(["一.txt", "二.txt"])
    assert box.input_value() == ""
    assert not app.page.evaluate("() => document.activeElement && document.activeElement.id === 'workspace-search'")


@pytest.mark.case("E-SR-11")
def test_no_result_empty_state(app, sandbox):
    app.seed([files.write(sandbox.files / "sr11" / "存在.txt", "x")])
    app.search("完全不存在的词")
    empty = app.page.locator("#workspace-empty-title")
    empty.wait_for(timeout=5000)
    assert "没有找到" in empty.inner_text() and "完全不存在的词" in empty.inner_text()
    app.page.locator("section.empty-state-panel").get_by_role("button", name="清空搜索").click()
    app.wait_names(["存在.txt"])
    assert app.page.locator("#workspace-search").input_value() == ""


@pytest.mark.case("E-SR-12")
def test_search_tag_type_cabinet_combo(app, sandbox):
    root = sandbox.files / "sr12"
    names = ["组合A.txt", "组合B.txt", "组合C.png", "组合D.txt", "其它E.txt"]
    paths = [files.write(root / n, files.png_bytes() if n.endswith(".png") else n) for n in names]
    app.seed(paths)
    ids = {i["name"]: i["id"] for i in app.items()}
    tid = app.add_tag("甲乙标签")
    for n in ("组合A.txt", "组合C.png", "组合D.txt", "其它E.txt"):
        app.invoke("set_item_tags", {"itemId": ids[n], "tagIds": [tid]})
    cab = app.invoke("add_cabinet", {"name": "组合柜", "color": "#22c55e"})
    app.invoke("add_items_to_cabinet", {"cabinetId": cab["id"], "itemIds": [ids[n] for n in ("组合A.txt", "组合B.txt", "组合C.png", "其它E.txt")]})
    app.reload_page()
    app.sidebar_tab("文件柜")
    app.page.locator(f'[data-drop-item-cabinet-id="{cab["id"]}"]').click()
    app.wait_names(["组合A.txt", "组合B.txt", "组合C.png", "其它E.txt"])
    app.sidebar_tab("标签")
    app.sidebar_tag("甲乙标签").click()
    app.wait_names(["组合A.txt", "组合C.png", "其它E.txt"])
    open_filters(app)
    app.page.get_by_role("group", name="文件类型筛选").get_by_role("button", name="文本", exact=True).click()
    app.wait_names(["组合A.txt", "其它E.txt"])
    app.search("组合")
    app.wait_names(["组合A.txt"])
    app.page.get_by_label("1 个筛选激活").wait_for(timeout=3000)


@pytest.mark.case("E-SR-06")
# BUG-09 已修复：原 xfail 改为直接断言（待 Windows 实跑验证）
@pytest.mark.parametrize("q", ["blennder", "blnder"])
def test_typo_insert_delete_with_extension(app, sandbox, q):
    app.seed([files.write(sandbox.files / "typo2" / n, n) for n in ("blender.txt", "zzz.txt")])
    app.search(q)
    app.wait_names(["blender.txt"], timeout=3)
