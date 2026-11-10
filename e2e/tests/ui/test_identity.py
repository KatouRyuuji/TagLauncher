"""对象身份与失效（E-ID-*）。系统级（VHD/跨卷）用例按用户决定跳过。"""
from __future__ import annotations

import shutil

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until

SYS_SKIP = "用户决定不做系统级改动"


# BUG-01（刷新后 UI 不反映 reconcile 结果）、BUG-05（全盘找回因受限目录整体失败）已修复：
# 以下用例改为直接断言。

def _reconcile(app):
    app.refresh_items()


def ui_shows(app, check, what):
    """UI 应在刷新后自动反映，无需重载页面（BUG-01 回归）。"""
    wait_until(check, 8, f"刷新后 UI 未自动显示：{what}")


@pytest.mark.case("E-ID-01")
def test_same_volume_move(app, sandbox):
    src = files.write(sandbox.files / "a" / "移动我.txt", "move-me")
    app.seed([src])
    tid = app.add_tag("身份标签")
    app.invoke("set_item_tags", {"itemId": app.item("移动我.txt")["id"], "tagIds": [tid]})
    dst = sandbox.files / "b" / "移动我.txt"
    dst.parent.mkdir(parents=True)
    shutil.move(src, dst)
    _reconcile(app)
    wait_until(lambda: app.item("移动我.txt")["path"].lower() == str(dst).lower(), 10,
               lambda: app.item("移动我.txt")["path"])
    it = app.item("移动我.txt")
    assert not it["is_missing"]
    names = [r[0] for r in dbh.query(sandbox.db_path,
             "SELECT t.name FROM item_tags it JOIN tags t ON t.id=it.tag_id WHERE it.item_id=?", (it["id"],))]
    assert names == ["身份标签"]


@pytest.mark.case("E-ID-02")
def test_same_volume_rename(app, sandbox):
    src = files.write(sandbox.files / "改名前.txt", "rename-me")
    app.seed([src])
    old_id = app.item("改名前.txt")["id"]
    src.rename(src.with_name("改名后.txt"))
    _reconcile(app)
    wait_until(lambda: any(i["name"] == "改名后.txt" for i in app.items()), 10, lambda: [i["name"] for i in app.items()])
    it = app.item("改名后.txt")
    assert it["id"] == old_id and not it["is_missing"]
    ui_shows(app, lambda: app.visible_names() == ["改名后.txt"], "改名后的名称")


@pytest.mark.case("E-ID-03")
def test_delete_marks_missing(app, sandbox):
    a = files.write(sandbox.files / "会丢.txt", "gone")
    b = files.write(sandbox.files / "还在.txt", "stay")
    app.seed([a, b])
    a.unlink()
    _reconcile(app)
    wait_until(lambda: app.item("会丢.txt")["is_missing"], 10)
    assert not app.item("还在.txt")["is_missing"]
    ui_shows(app, lambda: app.card("会丢.txt").get_by_text("失效", exact=True).count() > 0
                and app.page.get_by_role("button", name="1 个失效项目，打开待处理").count() == 1, "失效徽标/状态栏")


@pytest.mark.case("E-ID-04")
def test_relocate_all_missing(app, sandbox):
    a = files.write(sandbox.files / "原处" / "找回我.txt", "unique-content-for-relocate-" * 40)
    app.seed([a])
    old_id = app.item("找回我.txt")["id"]
    data = a.read_bytes()
    a.unlink()
    _reconcile(app)
    wait_until(lambda: app.item("找回我.txt")["is_missing"], 10)
    # 内容相同的新文件（新文件 ID）出现在同目录另一个名字下
    b = files.write(sandbox.files / "原处" / "找回我-副本.txt", data)
    # BUG-01 回归：状态栏失效入口应随 reconcile 自动出现
    app.page.get_by_role("button", name="1 个失效项目，打开待处理").wait_for(timeout=8000)
    app.page.get_by_role("button", name="1 个失效项目，打开待处理").click()
    dlg = app.dialog("失效项目")
    # 限定在沙箱内找回（「在选定文件夹中找回…」，原生文件夹对话框以 IPC 桩返回沙箱根）。
    # 全盘路径（不传范围）由 Rust 单测 full_scan_without_roots_covers_every_logical_drive 覆盖（runner 全盘冷扫描实测 2271 s）。
    app.stub("plugin:dialog|open", [str(sandbox.files)])
    dlg.get_by_role("button", name="在选定文件夹中找回…").click()
    # 失效出现后应用会自动发起一次全盘找回（args 无 roots，可能仍在扫描）；这里只看带范围的那次调用
    scoped = lambda: [c for c in app.calls("relocate_missing") if (c.get("args") or {}).get("roots")]
    wait_until(lambda: scoped(), 10, lambda: app.calls("relocate_missing"))
    wait_until(lambda: scoped()[-1].get("done"), 60, lambda: app.calls("relocate_missing"))
    call = scoped()[-1]
    assert [r.lower() for r in call["args"]["roots"]] == [str(sandbox.files).lower()], call
    (sandbox.artifacts / "relocate-call.json").parent.mkdir(parents=True, exist_ok=True)
    (sandbox.artifacts / "relocate-call.json").write_text(repr(call), encoding="utf-8")
    err = str(call.get("error") or "")
    assert not err, f"relocate_missing 报错：{err}；对话框：{dlg.inner_text()}"
    wait_until(lambda: not any(i["is_missing"] for i in app.items()), 15,
               lambda: (call, dlg.inner_text(), [(i["name"], i["path"], i["is_missing"]) for i in app.items()]))
    it = next(i for i in app.items() if i["id"] == old_id)
    assert it["path"].lower() == str(b).lower()


@pytest.mark.case("E-ID-07")
def test_cross_volume_vhd():
    pytest.skip(SYS_SKIP)


@pytest.mark.case("E-ID-08")
def test_removable_volume_vhd():
    pytest.skip(SYS_SKIP)
