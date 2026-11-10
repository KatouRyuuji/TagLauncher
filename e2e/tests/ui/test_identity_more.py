"""对象身份与失效 P1/P2（E-ID-05/06/09/10/11）。"""
from __future__ import annotations

import shutil

import pytest

from harness import db as dbh
from harness import files
from harness.app import wait_until

MISSING_BTN = "{n} 个失效项目，打开待处理"


def make_missing(app, sandbox, names):
    ps = [files.write(sandbox.files / "id" / n, f"content-{n}") for n in names]
    app.seed(ps)
    for p in ps:
        p.unlink()
    app.refresh_items()
    wait_until(lambda: all(app.item(n)["is_missing"] for n in names), 10)
    return ps


@pytest.mark.case("E-ID-05")
def test_review_remove_checked(app, sandbox):
    make_missing(app, sandbox, ["失效一.txt", "失效二.txt", "失效三.txt"])
    keep = files.write(sandbox.files / "id" / "正常.txt", "ok")
    app.seed([keep])
    btn = app.page.get_by_role("button", name=MISSING_BTN.format(n=3))
    btn.wait_for(timeout=8000)
    btn.click()
    dlg = app.dialog("失效项目")
    sel_all = dlg.get_by_role("button", name="全选")
    if sel_all.get_attribute("aria-pressed") != "true":
        sel_all.click()
    dlg.get_by_text("已选 3 / 3").wait_for(timeout=3000)
    # 取消一项 → 只移除 2 项
    dlg.get_by_role("list", name="失效项目列表").get_by_role("button").filter(has_text="失效三.txt").click()
    dlg.get_by_role("button", name="从库中移除已勾选").click()
    confirm = app.page.get_by_role("dialog").filter(has_text="从库中移除").last
    if confirm.get_by_role("button", name="从库中移除", exact=True).count():
        confirm.get_by_role("button", name="从库中移除", exact=True).click()
    wait_until(lambda: dbh.scalar(sandbox.db_path, "SELECT COUNT(*) FROM items") == 2, 10,
               lambda: dbh.query(sandbox.db_path, "SELECT name FROM items"))
    names = sorted(r[0] for r in dbh.query(sandbox.db_path, "SELECT name FROM items"))
    assert names == ["失效三.txt", "正常.txt"], names


@pytest.mark.case("E-ID-06")
def test_hide_missing_filter(app, sandbox):
    make_missing(app, sandbox, ["丢了.txt"])
    keep = files.write(sandbox.files / "id" / "在的.txt", "ok")
    app.seed([keep])
    wait_until(lambda: sorted(app.visible_names()) == ["丢了.txt", "在的.txt"], 8, lambda: app.visible_names())
    chip = app.page.get_by_role("button", name="隐藏失效")
    if not chip.is_visible():
        app.page.get_by_role("button", name="筛选类型与搜索范围").click()
    chip.click()
    assert chip.get_attribute("aria-pressed") == "true"
    app.wait_names(["在的.txt"])
    assert app.page.get_by_role("button", name=MISSING_BTN.format(n=1)).count() == 1, "失效计数入口不受影响"
    chip.click()
    wait_until(lambda: sorted(app.visible_names()) == ["丢了.txt", "在的.txt"], 8, lambda: app.visible_names())


@pytest.mark.case("E-ID-09")
def test_edit_then_move_still_found(app, sandbox):
    src = files.write(sandbox.files / "a" / "改后移动.txt", "v1")
    app.seed([src])
    iid = app.item("改后移动.txt")["id"]
    src.write_text("v2 内容已修改，大小也变了" * 10, encoding="utf-8")
    dst = sandbox.files / "b" / "改后移动.txt"
    dst.parent.mkdir(parents=True)
    shutil.move(src, dst)
    app.refresh_items()
    wait_until(lambda: next(i for i in app.items() if i["id"] == iid)["path"].lower() == str(dst).lower(), 10,
               lambda: app.items())
    assert not next(i for i in app.items() if i["id"] == iid)["is_missing"]


@pytest.mark.case("E-ID-10")
def test_ambiguous_candidates_not_written_back(app, sandbox):
    data = "ambiguous-same-content-" * 50
    a = files.write(sandbox.files / "orig" / "歧义.txt", data)
    app.seed([a])
    iid = app.item("歧义.txt")["id"]
    a.unlink()
    app.refresh_items()
    wait_until(lambda: app.item("歧义.txt")["is_missing"], 10)
    c1 = files.write(sandbox.files / "copy1" / "歧义.txt", data)
    c2 = files.write(sandbox.files / "copy2" / "歧义.txt", data)
    # 范围限定在沙箱（两份候选都在其中）：歧义判定与全盘相同，只是不扫整台 runner。
    # 全盘冷扫描在 GitHub runner 实测 2271 s（16cd1ce），超出分片时限；全盘路径改由 Rust 单测
    # full_scan_without_roots_covers_every_logical_drive（None → 全部盘符）与共享扫描核心的单测覆盖。
    n = app.invoke("relocate_missing", {"roots": [str(sandbox.files)]})
    it = next(i for i in app.items() if i["id"] == iid)
    assert it["is_missing"], f"两个同名同内容候选不应自动回写：relocated={n} path={it['path']}"
    assert it["path"].lower() == str(a).lower()
    assert c1.exists() and c2.exists()


@pytest.mark.case("E-ID-11")
def test_manual_relocate():
    pytest.skip("产品未提供“手动定位失效项”入口（仅有 relocate_missing 全量找回，已由 E-ID-04 覆盖）")
