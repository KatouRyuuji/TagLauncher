"""对象管理 P1/P2（E-OBJ-03/04/09/12/13/14/17/19/21/22/23/24/25）。全部 CDP + IPC，不接管系统输入。"""
from __future__ import annotations

import os
import sqlite3
import struct
import time
from pathlib import Path

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until
from tests.ui.conftest import add_via_menu, folder_dialog_confirm


def ask_yes(app):
    # plugin-dialog 2.6 的 ask() 走 plugin:dialog|message（YesNo），桩返回 "Yes"；绝不能让原生对话框真弹出来
    app.stub("plugin:dialog|message", "Yes")


# ------------------------------------------------------------- 回收站（只碰本套件的条目）
def _recycle_entries(under: Path):
    """读 <drive>\\$Recycle.Bin\\<SID>\\$I* 元数据，返回 (原路径, $I, $R) —— 只返回原路径在 under 之下的条目。"""
    import subprocess
    sid = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"], capture_output=True, text=True).stdout.strip().split(",")[-1].strip('"')
    bin_dir = Path(f"{under.drive}\\$Recycle.Bin\\{sid}")
    out = []
    if not bin_dir.exists():
        return out
    prefix = str(under).lower()
    for i in bin_dir.glob("$I*"):
        try:
            raw = i.read_bytes()
        except OSError:
            continue
        ver = struct.unpack_from("<q", raw, 0)[0]
        if ver == 2:
            n = struct.unpack_from("<i", raw, 24)[0]
            orig = raw[28:28 + n * 2].decode("utf-16-le").rstrip("\x00")
        else:
            orig = raw[24:24 + 520].decode("utf-16-le").split("\x00")[0]
        if orig.lower().startswith(prefix):
            out.append((orig, i, bin_dir / ("$R" + i.name[2:])))
    return out


def _purge_recycle(under: Path):
    import shutil
    for _, i, r in _recycle_entries(under):
        if r.is_dir():
            shutil.rmtree(r, ignore_errors=True)
        elif r.exists():
            r.unlink()
        i.unlink(missing_ok=True)


@pytest.mark.case("E-OBJ-03")
def test_folder_import_remember(app, sandbox):
    a = sandbox.files / "记住A"
    b = sandbox.files / "记住B"
    files.write(a / "a1.txt", "1")
    files.write(b / "b1.txt", "1")
    add_via_menu(app, "添加文件夹…", [a])
    folder_dialog_confirm(app, "只加入里面的文件", remember=True)
    # PR46 规格：投放根作为浏览入口一并入库（可见），夹内文件 hide_from_all
    wait_until(lambda: {i["name"] for i in app.items()} == {"记住A", "a1.txt"}, 8,
               lambda: [i["name"] for i in app.items()])
    assert app.item("a1.txt")["hide_from_all"] and not app.item("记住A")["hide_from_all"]
    # 产品语义：“记住我的选择，下次添加文件夹时默认用它”= 对话框仍出现、预选上次方式（矩阵写的“不再弹出”与产品文案不符）
    add_via_menu(app, "添加文件夹…", [b])
    dlg = app.dialog("添加文件夹")
    assert dlg.get_by_role("radio", name="只加入里面的文件").get_attribute("aria-checked") == "true"
    dlg.get_by_role("button", name="添加", exact=True).click()
    wait_until(lambda: {i["name"] for i in app.items()} == {"记住A", "a1.txt", "记住B", "b1.txt"}, 8,
               lambda: [i["name"] for i in app.items()])
    # 重载后仍记住
    app.reload_page()
    c = sandbox.files / "记住C"
    files.write(c / "c1.txt", "1")
    add_via_menu(app, "添加文件夹…", [c])
    dlg = app.dialog("添加文件夹")
    assert dlg.get_by_role("radio", name="只加入里面的文件").get_attribute("aria-checked") == "true"


@pytest.mark.case("E-OBJ-04")
def test_folder_import_cap(app, sandbox):
    big = sandbox.files / "大文件夹"
    big.mkdir(parents=True)
    for i in range(2500):
        (big / f"f{i:04d}.txt").write_bytes(b"x")
    add_via_menu(app, "添加文件夹…", [big])
    folder_dialog_confirm(app, "只加入里面的文件")
    app.wait_toast("已先导入前 2000 个文件", timeout=60)
    # 上限只针对文件：2000 个文件 + 投放根（PR46 起作为浏览入口入库）
    files_only = lambda: [i for i in app.items() if i["type"] != "folder"]
    wait_until(lambda: len(files_only()) == 2000, 30, lambda: len(files_only()))
    assert [i["name"] for i in app.items() if i["type"] == "folder"] == ["大文件夹"]
    assert all(i["hide_from_all"] for i in files_only())


@pytest.mark.case("E-OBJ-09")
# BUG-14 已修复：原 xfail 改为直接断言（待 Windows 实跑验证）
def test_partial_import_failure(app, sandbox, zoo):
    ghost = sandbox.files / "不存在的.txt"
    app.drop_paths([str(zoo["txt"]), str(ghost), str(zoo["png"])])
    wait_until(lambda: {i["name"] for i in app.items()} == {"笔记.txt", "图片.png"}, 8,
               lambda: [i["name"] for i in app.items()])
    t = app.wait_toast("导入失败 1 项")
    assert "不存在的.txt" in t["message"]


@pytest.mark.case("E-OBJ-12")
def test_delete_local_to_recycle_bin(app, sandbox):
    p = files.write(sandbox.files / "回收" / "进回收站.txt", "bye")
    keep = files.write(sandbox.files / "回收" / "保留.txt", "keep")
    app.seed([p, keep])
    _purge_recycle(sandbox.files)
    try:
        app.menu_click("进回收站.txt", "删除本地文件")
        dlg = app.page.get_by_role("dialog").filter(has_text="回收站").first
        dlg.wait_for(timeout=5000)
        dlg.get_by_role("button", name="删除本地文件（进回收站）").click()
        wait_until(lambda: not p.exists(), 8, "文件仍在磁盘")
        wait_until(lambda: [i["name"] for i in app.items()] == ["保留.txt"], 8)
        assert keep.exists()
        assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM items WHERE name=?", ("进回收站.txt",)) == 0
        wait_until(lambda: any(o.lower() == str(p).lower() for o, _, _ in _recycle_entries(sandbox.files)), 8,
                   "回收站里找不到按原路径匹配的条目")
    finally:
        _purge_recycle(sandbox.files)


@pytest.mark.case("E-OBJ-13")
def test_bulk_remove_3000(sandbox, app_factory):
    dbh.bulk_items(sandbox.db_path, 3000, root=str(sandbox.files / "不存在"))
    app = app_factory()
    app.wait_count(3000, timeout=60)
    app.page.evaluate("""() => { window.__lt = []; new PerformanceObserver(l => l.getEntries().forEach(e => window.__lt.push(e.duration)))
        .observe({type: 'longtask', buffered: false}); }""")
    app.page.locator("[data-selectable-item-id]").first.click()
    app.page.keyboard.press("Control+a")
    app.page.keyboard.press("Delete")
    dlg = app.page.get_by_role("dialog").filter(has_text="移出库").first
    dlg.wait_for(timeout=5000)
    t0 = time.monotonic()
    dlg.get_by_role("button", name="从库中移除", exact=True).click()
    wait_until(lambda: dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM items") == 0, 60)
    wait_until(lambda: app.page.locator("[data-selectable-item-id]").count() == 0, 30)
    elapsed = time.monotonic() - t0
    longest = max(app.page.evaluate("window.__lt") or [0])
    (sandbox.artifacts / "obj-13.txt").write_text(f"elapsed={elapsed:.1f}s longest_task={longest:.0f}ms", encoding="utf-8")
    assert longest < 2000, f"主线程最长任务 {longest:.0f}ms"


@pytest.mark.case("E-OBJ-14")
def test_thumbnail_set_change_clear(app, sandbox):
    target = files.write(sandbox.files / "缩略" / "有图标.txt", "t")
    red = files.write(sandbox.files / "图源" / "红.png", files.png_bytes(16, 16, (220, 30, 30)))
    blue = files.write(sandbox.files / "图源" / "蓝.png", files.png_bytes(16, 16, (30, 30, 220)))
    app.seed([target])
    card_img = lambda: app.card("有图标.txt").locator("img").first.get_attribute("src") if app.card("有图标.txt").locator("img").count() else None
    before = card_img()
    app.stub("plugin:dialog|open", str(red))
    app.context_menu("有图标.txt").locator('button[aria-haspopup="menu"]').filter(has_text="缩略图").first.hover()
    app.page.get_by_role("menuitem", name="设置缩略图").click()
    wait_until(lambda: app.item("有图标.txt")["icon_path"], 8, "icon_path 未写入")
    first = app.item("有图标.txt")["icon_path"]
    assert Path(first).resolve().is_relative_to(sandbox.root.resolve()), first
    assert Path(first).exists()
    wait_until(lambda: card_img() and card_img() != before, 5, card_img)
    src1 = card_img()
    app.stub("plugin:dialog|open", str(blue))
    app.context_menu("有图标.txt").locator('button[aria-haspopup="menu"]').filter(has_text="缩略图").first.hover()
    app.page.get_by_role("menuitem", name="更换缩略图").click()
    wait_until(lambda: app.item("有图标.txt")["icon_path"] != first, 8)
    wait_until(lambda: card_img() != src1, 5)
    app.context_menu("有图标.txt").locator('button[aria-haspopup="menu"]').filter(has_text="缩略图").first.hover()
    app.page.get_by_role("menuitem", name="清除缩略图").click()
    wait_until(lambda: not app.item("有图标.txt")["icon_path"], 8)


@pytest.mark.case("E-OBJ-17")
@pytest.mark.parametrize("new_name,hint", [("已存在.txt", "已存在"), ("坏<名>.txt", None), ('a|b?.txt', None), ("CON.txt", None)])
def test_rename_rejected(app, sandbox, new_name, hint):
    src = files.write(sandbox.files / "rn" / "原名.txt", "o")
    files.write(sandbox.files / "rn" / "已存在.txt", "e")
    app.seed([src])
    app.card("原名.txt").click()
    app.page.keyboard.press("F2")
    dlg = app.dialog("重命名")
    box = dlg.get_by_label("新名称")
    box.fill(new_name)
    box.press("Enter")
    wait_until(lambda: box.get_attribute("aria-invalid") == "true" or dlg.get_by_role("alert").count() > 0, 5,
               "非法名没有提示")
    if hint:
        assert hint in dlg.inner_text()
    time.sleep(0.5)
    assert src.exists() and src.read_text() == "o"
    assert app.item("原名.txt")["path"].lower() == str(src).lower()
    app.page.keyboard.press("Escape")


@pytest.mark.case("E-OBJ-19")
def test_undo_batch_rename(app, sandbox):
    paths = [files.write(sandbox.files / "撤销" / f"旧{i}.txt", str(i)) for i in range(3)]
    app.seed(paths)
    app.card("旧0.txt").click()
    app.page.keyboard.press("Control+a")
    app.page.get_by_test_id("batch-toolbar").get_by_role("button", name="重命名").click()
    dlg = app.dialog("批量重命名")
    dlg.get_by_role("button", name="规则类型").click()
    app.page.get_by_role("option", name="模板").click()
    dlg.get_by_label("模板").fill("新-{n}")
    dlg.get_by_role("button", name="执行（3）").click()
    dlg.get_by_role("button", name="完成").click(timeout=8000)
    wait_until(lambda: not any(p.exists() for p in paths), 5)
    app.run_command("撤销上次批量重命名")
    app.wait_toast("已撤销批量重命名（3 项）")
    assert all(p.exists() for p in paths)
    assert sorted(i["name"] for i in app.items()) == ["旧0.txt", "旧1.txt", "旧2.txt"]


@pytest.mark.case("E-OBJ-21")
def test_reveal_in_explorer_ipc(app, sandbox):
    """UI 层只断言 IPC（矩阵：CI 用 IPC 记录）；真实 explorer 窗口属于窗口层，不在开发阶段跑。"""
    p = files.write(sandbox.files / "揭示" / "定位我.txt", "r")
    d = sandbox.files / "揭示" / "子夹"
    d.mkdir()
    app.seed([p, d])
    app.stub("open_in_explorer_by_id", None)
    app.stub("open_in_explorer", None)
    app.menu_click("定位我.txt", "打开所在文件夹")
    wait_until(lambda: app.calls("open_in_explorer_by_id"), 3)
    assert app.calls("open_in_explorer_by_id")[-1]["args"]["id"] == app.item("定位我.txt")["id"]
    app.menu_click("子夹", "打开上一级")
    wait_until(lambda: app.calls("open_in_explorer"), 3)
    assert app.calls("open_in_explorer")[-1]["args"]["path"].rstrip("\\").lower() == str(d.parent).lower()


@pytest.mark.case("E-OBJ-22")
def test_external_rename_refresh(app, sandbox):
    p = files.write(sandbox.files / "外改" / "外部前.txt", "same-content-xyz")
    app.seed([p])
    old_id = app.item("外部前.txt")["id"]
    new = p.with_name("外部后.txt")
    os.rename(p, new)
    app.run_command("刷新")
    wait_until(lambda: "外部后.txt" in app.visible_names(), 15, app.visible_names)
    it = app.item("外部后.txt")
    assert it["id"] == old_id and it["path"].lower() == str(new).lower() and not it["is_missing"]


@pytest.mark.case("E-OBJ-23")
def test_clear_recent(app, sandbox):
    ps = [files.write(sandbox.files / "近" / f"近{i}.txt", str(i)) for i in range(3)]
    app.seed(ps)
    con = sqlite3.connect(sandbox.db_path)
    con.execute("UPDATE items SET last_used_at = datetime('now')")
    con.commit()
    con.close()
    app.reload_page()
    app.page.locator('section[aria-labelledby="sidebar-navigation-label"] button[aria-pressed]').filter(has_text="最近").first.click()
    app.wait_count(3)
    ask_yes(app)
    app.page.get_by_role("button", name="清除记录").click()
    assert "清除全部对象的最近使用记录" in str(app.wait_ipc("plugin:dialog|message")[-1])
    app.wait_toast("已清除 3 项最近使用记录")
    assert dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM items WHERE last_used_at IS NOT NULL") == 0
    wait_until(lambda: app.visible_names() == [], 5, app.visible_names)


@pytest.mark.case("E-OBJ-24")
def test_unicode_and_long_names(app, sandbox):
    base = sandbox.files / "名字 测试"
    names = ["带 空格 的文件.txt", "表情😀🎉.txt", "日本語ファイル.txt", ("长" * 120) + ".txt"]
    ps = [files.write(base / n, n) for n in names]
    deep = base
    while len(str(deep)) < 262:
        deep = deep / "很深的目录层级"
    long_p = Path("\\\\?\\" + str(deep / "超长路径.txt"))
    long_p.parent.mkdir(parents=True, exist_ok=True)
    long_p.write_text("l", encoding="utf-8")
    real_long = str(deep / "超长路径.txt")
    assert len(real_long) > 260
    app.seed(ps)
    app.drop_paths([real_long])
    wait_until(lambda: len(app.items()) == 5, 10, lambda: [i["name"] for i in app.items()])
    for n in names + ["超长路径.txt"]:
        app.card(n).wait_for(timeout=5000)
    # 预览 + 重命名 emoji 名
    app.card("表情😀🎉.txt").click()
    app.page.keyboard.press(" ")
    pv = app.page.get_by_role("dialog", name="快速预览")
    wait_until(lambda: "表情😀🎉.txt" in pv.inner_text(), 5)
    app.page.keyboard.press("Escape")
    app.page.keyboard.press("F2")
    dlg = app.dialog("重命名")
    dlg.get_by_label("新名称").fill("新😀 名.txt")
    dlg.get_by_label("新名称").press("Enter")
    dlg.wait_for(state="detached", timeout=5000)
    wait_until(lambda: (base / "新😀 名.txt").exists(), 5)
    # 超长路径预览不报错
    app.card("超长路径.txt").click()
    app.page.keyboard.press(" ")
    pv.wait_for()
    wait_until(lambda: pv.locator('[aria-busy="true"]').count() == 0, 8)
    assert "超长路径.txt" in pv.inner_text()
    app.page.keyboard.press("Escape")
    assert app.js_errors() == []


@pytest.mark.case("E-OBJ-25")
def test_display_alias_is_display_only(app, sandbox):
    """F07：别名只改界面显示与搜索；磁盘文件、库内 name/path 不变；清空恢复磁盘名。"""
    f = files.write(sandbox.files / "别名" / "setup_x64.exe.txt", "x")
    app.seed([f])
    app.wait_names(["setup_x64.exe.txt"])
    app.menu_click("setup_x64.exe.txt", "设置显示别名…")
    dlg = app.dialog("设置显示别名")
    assert "setup_x64.exe.txt" in dlg.inner_text()
    dlg.get_by_role("textbox", name="显示别名").fill("  安装器  ")
    dlg.get_by_role("textbox", name="显示别名").press("Enter")
    dlg.wait_for(state="detached", timeout=5000)
    app.wait_names(["安装器"])
    it = app.item("setup_x64.exe.txt")
    assert it["alias"] == "安装器" and it["name"] == "setup_x64.exe.txt", it
    assert Path(it["path"]).name == "setup_x64.exe.txt" and f.exists(), "磁盘文件不改名"
    heading = app.card("setup_x64.exe.txt").get_by_role("heading", level=3)
    assert "磁盘名：setup_x64.exe.txt" in (heading.get_attribute("title") or "")
    # 搜索：别名（中文与拼音首字母）与磁盘名都能命中
    for q in ("安装", "azq", "setup"):
        app.search(q)
        app.wait_names(["安装器"])
    app.search("")
    app.restart()
    app.wait_names(["安装器"])
    # 清空即恢复显示磁盘名
    app.menu_click("setup_x64.exe.txt", "设置显示别名…")
    dlg = app.dialog("设置显示别名")
    dlg.get_by_role("textbox", name="显示别名").fill("")
    dlg.get_by_role("button", name="保存", exact=True).click()
    dlg.wait_for(state="detached", timeout=5000)
    app.wait_names(["setup_x64.exe.txt"])
    assert app.item("setup_x64.exe.txt")["alias"] is None
    assert app.js_errors() == []
