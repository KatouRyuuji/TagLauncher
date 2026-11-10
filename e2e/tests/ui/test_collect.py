"""全局极速阶段③：资源管理器右键菜单 / 发送到收纳（E-COLLECT-*）。

- E-COLLECT-01 写真实 HKCU（real_registry）：只在 CI 的临时 runner 上跑（TL_E2E_ALLOW_REGISTRY=1），
  本机默认不跑，绝不碰用户电脑的注册表。「发送到」快捷方式落在沙箱重定向的 APPDATA 里。
- 其余用例不碰注册表：直接用第二实例 `tag-launcher.exe --collect <路径…>` 模拟资源管理器的调用
  （经典动词多选时每项一个进程，单实例插件把参数转给主实例合并成一个会话）。
- 快速窗用 TAGLAUNCHER_E2E_NO_ACTIVATE 显示但不抢前台（测试机守护不允许抢焦点）；
  真机上右键收纳会激活快速窗，需真机确认。
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

import pytest

from harness import files
from harness.app import wait_until
from tests.ui.test_quick import _cdp_targets, _quick_diag, quick_pages

MENU_TEXT = "用 TagLauncher 收纳…"
VERB = "TagLauncher.Collect"
CLASSES = {"*": "%1", "Directory": "%1", "Directory\\Background": "%V"}
SENDTO = "用 TagLauncher 收纳.lnk"


# ---------------------------------------------------------------- 注册表 / 快捷方式
def verb_path(cls: str) -> str:
    return rf"Software\Classes\{cls}\shell\{VERB}"


def read_verb(cls: str) -> dict | None:
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, verb_path(cls)) as k:
            out = {name: winreg.QueryValueEx(k, name)[0] for name in ("", "MultiSelectModel", "Icon")}
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, verb_path(cls) + r"\command") as k:
            out["command"] = winreg.QueryValueEx(k, "")[0]
        return out
    except FileNotFoundError:
        return None


def verb_exists(cls: str) -> bool:
    import winreg
    try:
        winreg.CloseKey(winreg.OpenKey(winreg.HKEY_CURRENT_USER, verb_path(cls)))
        return True
    except FileNotFoundError:
        return False


def delete_tree(path: str) -> None:
    import winreg
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path, 0, winreg.KEY_ALL_ACCESS) as k:
            while True:
                try:
                    sub = winreg.EnumKey(k, 0)
                except OSError:
                    break
                delete_tree(path + "\\" + sub)
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, path)
    except FileNotFoundError:
        pass


def write_command(cls: str, value: str) -> None:
    import winreg
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, verb_path(cls) + r"\command") as k:
        winreg.SetValueEx(k, "", 0, winreg.REG_SZ, value)


def read_shortcut(link: Path) -> dict:
    script = ("[Console]::OutputEncoding = [Text.Encoding]::UTF8; "
              "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:TL_LNK); "
              "@{ target = $s.TargetPath; args = $s.Arguments } | ConvertTo-Json -Compress")
    r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True,
                       env={**os.environ, "TL_LNK": str(link)}, timeout=30)
    assert r.returncode == 0, r.stderr.decode("utf-8", "replace")
    return json.loads(r.stdout.decode("utf-8", "replace"))


def same_path(a: str | Path, b: str | Path) -> bool:
    return os.path.normcase(os.path.abspath(str(a))) == os.path.normcase(os.path.abspath(str(b)))


def send_to_link(sandbox) -> Path:
    return sandbox.root / "AppData" / "Microsoft" / "Windows" / "SendTo" / SENDTO


# ---------------------------------------------------------------- 收纳调用 / 快速窗
def collect_app(app_factory, sandbox):
    sandbox.env_extra["TAGLAUNCHER_E2E_NO_ACTIVATE"] = "1"
    return app_factory()


def invoke_collect(sandbox, batches: list[list[Path | str]]) -> None:
    """每批一个第二实例进程（同时起，模拟资源管理器对多选的每项各起一个进程）。"""
    procs = [subprocess.Popen([str(sandbox.exe), "--collect", *[str(p) for p in batch]], cwd=sandbox.bin,
                              env=sandbox.env(None)) for batch in batches]
    for p in procs:
        p.wait(timeout=60)


def collect_page(app, timeout: float = 30):
    extra = []

    def find():
        pages = quick_pages(app)
        if not pages and any("quick.html" in (t.get("url") or "") for t in _cdp_targets(app)):
            if not extra:
                extra.append(app.pw.chromium.connect_over_cdp(f"http://127.0.0.1:{app.port}"))
            pages = [p for ctx in extra[0].contexts for p in ctx.pages if "quick.html" in (p.url or "") and not p.is_closed()]
        for p in pages:
            try:
                if p.evaluate("() => !!document.querySelector('[data-testid=quick-collect]')"):
                    return p
            except Exception:  # noqa: BLE001  页面在销毁中
                pass
        return None

    try:
        return wait_until(find, timeout, "收纳快速窗未出现")
    except AssertionError as e:
        raise AssertionError(f"{e}；{_quick_diag(app)}") from None


def wait_attr(locator, name: str, value: str, timeout: float = 10) -> None:
    wait_until(lambda: locator.get_attribute(name) == value, timeout,
               lambda: f"{name}={locator.get_attribute(name)!r}，期望 {value!r}")


def wait_session_done(app, timeout: float = 15) -> None:
    """处理完：会话清空；快速搜索没开时快速窗被销毁（不常驻）。"""
    wait_until(lambda: app.invoke("collect_session") is None, timeout, lambda: app.invoke("collect_session"))
    # 以 Tauri 的窗口表为准（CDP 页面列表只作诊断）
    wait_until(lambda: "quick" not in window_labels(app), timeout,
               lambda: f"快速搜索没开时，收纳完应销毁快速窗：{_quick_diag(app)}")


def window_labels(app) -> list[str]:
    return app.page.evaluate("() => window.__TAURI__.window.getAllWindows().then(ws => ws.map(w => w.label))")


def result(qp) -> dict:
    el = qp.get_by_test_id("collect-result")
    el.wait_for(timeout=15000)
    return {k: el.get_attribute(f"data-{k}") for k in ("created", "existing", "failed", "auto")} | {"text": el.inner_text()}


def by_name(app) -> dict[str, dict]:
    return {i["name"]: i for i in app.items()}


# ---------------------------------------------------------------- 用例
@pytest.mark.real_registry
@pytest.mark.case("E-COLLECT-01")
def test_shell_integration_toggle_registers_and_cleans(app, sandbox):
    """设置开关：开启写 3 个经典动词 + 发送到；部分缺失/程序挪位可修复；关闭与 CLI 都清理干净。"""
    assert not any(verb_exists(c) for c in CLASSES), "runner 上不应预先存在 TagLauncher 右键菜单键"
    link = send_to_link(sandbox)
    try:
        st = app.invoke("get_shell_integration")
        assert st["supported"] and not st["enabled"] and not st["partial"], st
        assert same_path(st["currentExe"], sandbox.exe), st

        dlg = app.open_settings("桌面驻留")
        switch = dlg.get_by_test_id("shell-integration").get_by_role("switch")
        wait_attr(switch, "aria-checked", "false")
        switch.click()
        wait_attr(switch, "aria-checked", "true")

        st = app.invoke("get_shell_integration")
        exe = st["currentExe"]
        assert st["enabled"] and st["sendTo"] and st["exeMatches"] and not st["partial"], st
        for cls, placeholder in CLASSES.items():
            v = read_verb(cls)
            assert v is not None, f"缺少 {verb_path(cls)}"
            assert v[""] == MENU_TEXT and v["MultiSelectModel"] == "Player", v
            assert v["command"] == f'"{exe}" --collect "{placeholder}"', v
            assert v["Icon"] == f'"{exe}",0', v
        assert link.exists(), f"「发送到」快捷方式应在沙箱 APPDATA：{link}"
        sc = read_shortcut(link)
        assert same_path(sc["target"], exe) and sc["args"] == "--collect", sc

        # 手动删掉一部分 → partial；开启即修复
        delete_tree(verb_path("Directory\\Background"))
        st = app.invoke("get_shell_integration")
        assert st["partial"] and not st["enabled"] and st["verbs"] == [True, True, False], st
        st = app.invoke("set_shell_integration", {"enabled": True})
        assert st["enabled"] and verb_exists("Directory\\Background"), st

        # 便携版挪了位置（命令指向别处）→ exeMatches=false；开启即改回当前位置
        write_command("*", '"D:\\Old\\tag-launcher.exe" --collect "%1"')
        st = app.invoke("get_shell_integration")
        assert st["enabled"] and not st["exeMatches"], st
        st = app.invoke("set_shell_integration", {"enabled": True})
        assert st["exeMatches"] and read_verb("*")["command"] == f'"{exe}" --collect "%1"', st

        # 关闭：完全清理
        switch.click()
        wait_attr(switch, "aria-checked", "false")
        assert not any(verb_exists(c) for c in CLASSES)
        assert not link.exists()
        st = app.invoke("get_shell_integration")
        assert not st["enabled"] and not st["partial"] and not st["sendTo"], st

        # 命令行清理（便携版删目录前 / 卸载脚本兜底）
        app.invoke("set_shell_integration", {"enabled": True})
        assert all(verb_exists(c) for c in CLASSES) and link.exists()
        r = subprocess.run([str(sandbox.exe), "--shell-integration", "remove"], cwd=sandbox.bin,
                           env=sandbox.env(None), capture_output=True, timeout=30)
        assert r.returncode == 0, r.stderr.decode("utf-8", "replace")
        assert not any(verb_exists(c) for c in CLASSES)
        assert not link.exists()
    finally:
        for cls in CLASSES:
            delete_tree(verb_path(cls))
        link.unlink(missing_ok=True)
    assert not any(verb_exists(c) for c in CLASSES)


@pytest.mark.case("E-COLLECT-02")
def test_multi_process_collect_merges_into_one_session(app_factory, sandbox):
    """6 个进程各带一个路径（另有一个无效路径）→ 主实例合并成一个会话、只有一个快速窗；仅导入写入并刷新主窗。"""
    app = collect_app(app_factory, sandbox)
    paths = [files.write(sandbox.files / "multi" / f"收纳{i}.txt", "x") for i in range(6)]
    invoke_collect(sandbox, [[p] for p in paths] + [[sandbox.files / "multi" / "不存在.txt"]])
    qp = collect_page(app)
    summary = qp.get_by_test_id("collect-summary")
    wait_attr(summary, "data-invocations", "7")
    assert summary.get_attribute("data-count") == "6"
    assert "1 个路径不存在或无效" in qp.get_by_test_id("collect-warning").inner_text()
    s = app.invoke("collect_session")
    assert s["invocations"] == 7 and s["invalid"] == 1, s
    assert sorted(Path(p).name for p in s["paths"]) == sorted(p.name for p in paths), s
    assert len(quick_pages(app)) == 1, "多选只应弹一个快速窗"
    assert app.page.get_by_test_id("quick-collect").count() == 0, "收纳界面只在快速窗里"

    qp.get_by_test_id("collect-action-import").click()
    r = result(qp)
    assert (r["created"], r["existing"], r["failed"], r["auto"]) == ("6", "0", "0", "false"), r
    items = by_name(app)
    for p in paths:
        assert p.name in items and not items[p.name]["hide_from_all"] and items[p.name]["tags"] == []
    # 主窗经 window-data-written 增量刷新，无需手动刷新
    app.card(paths[0].name).wait_for(timeout=10000)
    wait_session_done(app)


@pytest.mark.case("E-COLLECT-03")
def test_collect_tag_and_cabinet_actions(app_factory, sandbox):
    """打标签：新项与既有项都带上所选标签；放入文件柜：含文件夹时按所选方式导入，夹内内容不铺满总览。"""
    app = collect_app(app_factory, sandbox)
    existing = files.write(sandbox.files / "tag" / "已有.txt", "x")
    fresh = files.write(sandbox.files / "tag" / "新的.txt", "x")
    app.seed([existing])
    t1 = app.invoke("add_tag", {"name": "收纳甲", "color": "#5064d8"})
    t2 = app.invoke("add_tag", {"name": "收纳乙", "color": "#22c55e"})
    cab = app.invoke("add_cabinet", {"name": "收纳柜", "color": "#22c55e"})

    invoke_collect(sandbox, [[existing], [fresh]])
    qp = collect_page(app)
    wait_attr(qp.get_by_test_id("collect-summary"), "data-count", "2")
    assert qp.locator("[data-testid^=collect-folder-mode-]").count() == 0, "没有文件夹时不显示导入方式"
    qp.get_by_test_id("collect-action-tag").click()
    for t in (t1, t2):
        qp.locator(f'[data-testid=collect-tag-option][data-tag-id="{t["id"]}"]').click()
    qp.get_by_test_id("collect-confirm").click()
    r = result(qp)
    assert (r["created"], r["existing"], r["failed"]) == ("1", "1", "0"), r
    items = by_name(app)
    for name in (existing.name, fresh.name):
        assert sorted(t["id"] for t in items[name]["tags"]) == sorted([t1["id"], t2["id"]]), items[name]
    wait_session_done(app)
    assert app.invoke("get_collect_preference") is None, "没勾选记住时不应保存选择"

    root = sandbox.files / "柜" / "资料夹"
    inner = files.write(root / "子目录" / "夹内.txt", "x")
    loose = files.write(sandbox.files / "柜" / "散件.txt", "x")
    invoke_collect(sandbox, [[root, loose]])  # 「发送到」：一个进程带全部路径
    qp = collect_page(app)
    wait_attr(qp.get_by_test_id("collect-summary"), "data-count", "2")
    qp.get_by_test_id("collect-folder-mode-both").check()
    qp.get_by_test_id("collect-action-cabinet").click()
    qp.locator(f'[data-testid=collect-cabinet-option][data-cabinet-id="{cab["id"]}"]').click()
    r = result(qp)
    assert r["failed"] == "0" and int(r["created"]) == 4, r
    members = {i["name"] for i in app.invoke("get_cabinet_items", {"cabinetId": cab["id"], "includeVisuals": False})}
    assert {"资料夹", "子目录", inner.name, loose.name} <= members, members
    items = by_name(app)
    assert not items["资料夹"]["hide_from_all"] and not items[loose.name]["hide_from_all"]
    assert items["子目录"]["hide_from_all"] and items[inner.name]["hide_from_all"], "夹内内容默认不铺满总览"
    app.card(loose.name).wait_for(timeout=10000)
    assert app.page.locator(f'[data-selectable-item-id="{items[inner.name]["id"]}"]').count() == 0
    wait_session_done(app)


@pytest.mark.case("E-COLLECT-04")
def test_collect_remembers_choice(app_factory, sandbox):
    """勾选记住 → 下次直接按它执行；改回每次询问后又弹选择；Esc 取消不写入。"""
    app = collect_app(app_factory, sandbox)
    tag = app.invoke("add_tag", {"name": "记住的标签", "color": "#5064d8"})
    a, b, c = (files.write(sandbox.files / "remember" / n, "x") for n in ("甲.txt", "乙.txt", "丙.txt"))

    invoke_collect(sandbox, [[a]])
    qp = collect_page(app)
    qp.get_by_test_id("collect-remember").check()
    qp.get_by_test_id("collect-action-tag").click()
    qp.locator(f'[data-testid=collect-tag-option][data-tag-id="{tag["id"]}"]').click()
    qp.get_by_test_id("collect-confirm").click()
    assert result(qp)["auto"] == "false"
    wait_session_done(app)
    pref = app.invoke("get_collect_preference")
    assert pref == {"action": "tag", "tagIds": [tag["id"]], "cabinetId": None, "folderMode": None}, pref

    invoke_collect(sandbox, [[b]])
    qp = collect_page(app)
    r = result(qp)
    assert r["auto"] == "true" and r["created"] == "1", r
    assert "按记住的选择" in r["text"] and "记住的标签" in r["text"], r
    assert qp.get_by_test_id("collect-forget").count() == 1, "自动执行时应可改回每次询问"
    assert [t["id"] for t in by_name(app)[b.name]["tags"]] == [tag["id"]]
    wait_session_done(app)

    # 改回每次询问（设置里或结果条上的按钮都调同一命令）
    assert app.invoke("set_collect_preference", {"preference": None}) is None
    invoke_collect(sandbox, [[c]])
    qp = collect_page(app)
    qp.get_by_test_id("collect-action-import").wait_for(timeout=10000)
    time.sleep(0.5)
    assert qp.get_by_test_id("collect-result").count() == 0, "改回每次询问后不应自动执行"
    qp.get_by_test_id("collect-action-import").focus()
    qp.keyboard.press("Escape")
    wait_session_done(app)
    assert c.name not in by_name(app), "Esc 取消不应写入"
