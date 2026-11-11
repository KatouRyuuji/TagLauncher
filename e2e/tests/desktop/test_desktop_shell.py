"""desktop 层·右键菜单 / 发送到 / 前台（D-SHELL-*）。原 PR52 真机确认项，在临时 runner 上自动跑。

- 菜单：开启后经 Shell.Application（资源管理器同一套 IContextMenu 枚举，即 Win11「显示更多选项」
  里的经典菜单）列出文件 / 文件夹的动词，文字、图标可加载；
- 调用：由一个前台 Tk 替身进程 ShellExecute 注册表动词 / 「发送到」快捷方式，
  父子关系与资源管理器一致（前台进程启动第二实例 → 第二实例让出前台权 → 主实例弹快速窗）；
- 前台：快速窗是前台窗口、可见、置顶。
- Win11 一级菜单（D-SHELL-06）：未签名稀疏包注册 → 资源管理器新菜单第一层出现并可点 → 主实例收纳；
  启动按设置补注册；关闭后包 / PackagedCom 键 / 菜单项全无、DLL 不被占用。
"""
from __future__ import annotations

import json
import os
import subprocess
import time

import pytest

from harness import files
from harness.app import wait_until
from tests.desktop import oswin, win11menu
from tests.ui.test_collect import (CLASSES, COLLECT_LATENCY_MS, MENU_TEXT, VERB, by_name, collect_page,
                                   collect_perf, delete_tree, read_shortcut, read_verb, result, same_path,
                                   send_to_link, verb_exists, verb_path, wait_attr, wait_session_done)
from tests.ui.test_quick import quick_pages
from win import win32

pytestmark = [pytest.mark.physical_input, pytest.mark.real_registry, pytest.mark.visible_window]
QUICK_TITLE = "TagLauncher 快速搜索"


def shell_verbs(folder, name: str) -> list[str]:
    """资源管理器视角的经典右键菜单动词名（去掉 & 加速键）。"""
    script = ("[Console]::OutputEncoding = [Text.Encoding]::UTF8; "
              "$it = (New-Object -ComObject Shell.Application).Namespace($env:TL_DIR).ParseName($env:TL_NAME); "
              "ConvertTo-Json -Compress @($it.Verbs() | ForEach-Object { $_.Name })")
    r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True,
                       env={**os.environ, "TL_DIR": str(folder), "TL_NAME": name}, timeout=60)
    assert r.returncode == 0, r.stderr.decode("utf-8", "replace")
    return [v.replace("&", "") for v in json.loads(r.stdout.decode("utf-8", "replace") or "[]")]


def shortcut_icon(link) -> str:
    script = ("[Console]::OutputEncoding = [Text.Encoding]::UTF8; "
              "(New-Object -ComObject WScript.Shell).CreateShortcut($env:TL_LNK).IconLocation")
    import shutil
    probe = link.parent.parent / "tl-e2e-icon.lnk"
    shutil.copyfile(link, probe)
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], capture_output=True,
                           env={**os.environ, "TL_LNK": str(probe)}, timeout=30)
        return r.stdout.decode("utf-8", "replace").strip()
    finally:
        probe.unlink(missing_ok=True)


def quick_hwnd(pid: int, timeout: float = 15) -> int:
    return wait_until(lambda: oswin.window_by_title(pid, QUICK_TITLE), timeout, "快速窗未显示")


def foreground_report(app) -> dict:
    h = oswin.window_by_title(app.proc.pid, QUICK_TITLE)
    fg = oswin.foreground_info()
    return {"quick": h, "visible": bool(h) and win32.is_visible(h), "topmost": bool(h) and oswin.is_topmost(h),
            "foreground_is_quick": bool(h) and fg["hwnd"] == h, "fg": fg}


def assert_quick_in_front(app, label: str) -> dict:
    h = quick_hwnd(app.proc.pid)
    # 激活是异步的：给 2 秒到前台
    try:
        wait_until(lambda: win32.foreground() == h, 2)
    except AssertionError:
        pass
    rep = foreground_report(app)
    print(f"FOREGROUND {label} {json.dumps(rep, ensure_ascii=False)}")
    assert rep["visible"] and rep["topmost"], rep
    assert rep["foreground_is_quick"], f"{label}：快速窗应到前台：{rep}"
    return rep


@pytest.fixture
def shell_on(app_factory, sandbox):
    assert not any(verb_exists(c) for c in CLASSES), "runner 上不应预先存在 TagLauncher 右键菜单键"
    app = app_factory()
    st = app.invoke("set_shell_integration", {"enabled": True})
    assert st["enabled"] and st["sendTo"], st
    yield app
    app.invoke("set_shell_integration", {"enabled": False})
    for cls in CLASSES:
        delete_tree(verb_path(cls))
    assert not any(verb_exists(c) for c in CLASSES)
    assert not send_to_link(sandbox).exists()


@pytest.mark.case("D-SHELL-01")
def test_menu_visible_to_explorer_with_loadable_icon(shell_on, sandbox):
    """开启后：3 个经典动词的文字 / 命令 / 图标；Shell 枚举的文件、文件夹菜单里有该项；图标真能加载。"""
    app = shell_on
    exe = app.invoke("get_shell_integration")["currentExe"]
    for cls in CLASSES:
        v = read_verb(cls)
        assert v and v[""] == MENU_TEXT, v
        icon = oswin.icon_loadable(v["Icon"])
        print(f"ICON {cls} {icon}")
        assert icon["ok"] and icon["total"] >= 1 and same_path(icon["path"], exe), icon
    d = files.write(sandbox.files / "shellv" / "probe.txt", "x").parent
    (d / "sub").mkdir()
    file_verbs = shell_verbs(d, "probe.txt")
    dir_verbs = shell_verbs(d, "sub")
    print(f"VERBS file={file_verbs} dir={dir_verbs}")
    assert MENU_TEXT in file_verbs, file_verbs
    assert MENU_TEXT in dir_verbs, dir_verbs
    # 关闭后 Shell 立即不再列出
    app.invoke("set_shell_integration", {"enabled": False})
    assert MENU_TEXT not in shell_verbs(d, "probe.txt")
    app.invoke("set_shell_integration", {"enabled": True})


@pytest.mark.case("D-SHELL-02")
def test_invoke_verbs_from_foreground_process(shell_on, sandbox):
    """前台进程调用文件 / 文件夹动词 → 主实例收到 --collect、只弹一个快速窗、快速窗在前台；
    空白处动词（%V）按资源管理器的替换规则执行同样生效。"""
    app = shell_on
    f = files.write(sandbox.files / "verb" / "one.txt", "x")
    sub = sandbox.files / "verb" / "folder"
    files.write(sub / "inner.txt", "x")
    with oswin.FgHelper(env=sandbox.env(None)) as fg:
        fg.focus()
        fg.startfile(f, verb=VERB)
        qp = collect_page(app)
        wait_attr(qp.get_by_test_id("collect-summary"), "data-count", "1")
        s = app.invoke("collect_session")
        assert [os.path.basename(p) for p in s["paths"]] == ["one.txt"], s
        assert len(quick_pages(app)) == 1
        assert_quick_in_front(app, "file-verb")
        qp.get_by_test_id("collect-action-import").click()
        assert result(qp)["created"] == "1"
        wait_session_done(app)

        fg.focus()
        fg.startfile(sub, verb=VERB)
        qp = collect_page(app)
        wait_attr(qp.get_by_test_id("collect-summary"), "data-count", "1")
        s = app.invoke("collect_session")
        assert same_path(s["paths"][0], sub), s
        assert_quick_in_front(app, "folder-verb")
        qp.get_by_test_id("collect-action-import").click()
        result(qp)
        wait_session_done(app)

    # 空白处：资源管理器把 %V 替换成当前文件夹后执行同一命令行
    cmd = read_verb("Directory\\Background")["command"].replace("%V", str(sandbox.files / "verb"))
    subprocess.Popen(cmd, cwd=sandbox.bin, env=sandbox.env(None)).wait(timeout=60)
    qp = collect_page(app)
    wait_attr(qp.get_by_test_id("collect-summary"), "data-count", "1")
    assert same_path(app.invoke("collect_session")["paths"][0], sandbox.files / "verb")
    qp.get_by_test_id("collect-action-import").click()
    result(qp)
    wait_session_done(app)


@pytest.mark.case("D-SHELL-03")
def test_send_to_shortcut_launch(shell_on, sandbox):
    """「发送到」：快捷方式目标 / 参数 / 图标正确；前台进程带文件参数执行它 → 一个进程、一个会话、快速窗在前台。"""
    app = shell_on
    exe = app.invoke("get_shell_integration")["currentExe"]
    link = send_to_link(sandbox)
    sc = read_shortcut(link)
    icon = shortcut_icon(link)
    print(f"SENDTO {json.dumps(sc, ensure_ascii=False)} icon={icon!r}")
    assert same_path(sc["target"], exe) and sc["args"] == "--collect", sc
    assert icon and same_path(icon.rpartition(",")[0], exe), icon
    assert oswin.icon_loadable(icon)["ok"]
    a = files.write(sandbox.files / "sendto" / "a.txt", "x")
    b = files.write(sandbox.files / "sendto" / "b.txt", "x")
    with oswin.FgHelper(env=sandbox.env(None)) as fg:
        fg.focus()
        fg.startfile(link, "open", f'"{a}" "{b}"')
        qp = collect_page(app)
        summary = qp.get_by_test_id("collect-summary")
        wait_attr(summary, "data-count", "2")
        assert summary.get_attribute("data-invocations") == "1", "发送到应是一个进程带全部路径"
        assert len(quick_pages(app)) == 1
        assert_quick_in_front(app, "sendto")
        qp.get_by_test_id("collect-action-import").click()
        assert result(qp)["created"] == "2"
        assert {"a.txt", "b.txt"} <= set(by_name(app))
        wait_session_done(app)


SENDTO_ARGS_MIN = 30000  # 设计 §2.2：多选「发送到」一次启动，全部路径在命令行里，总长上限 32767 字符
SENDTO_ARGS_MAX = 32000  # 留出 exe 路径与 --collect 的余量


@pytest.mark.case("D-SHELL-05")
def test_send_to_near_command_line_limit(shell_on, sandbox):
    """「发送到」长路径（计划 §2.2 真机项）：多选总命令行接近 32767 字符时，仍是一次启动、全部路径进同一会话、无截断。"""
    app = shell_on
    link = send_to_link(sandbox)
    folder = sandbox.files / "sendto-long" / ("d" * 100)
    paths, args = [], ""
    i = 0
    while True:
        p = folder / f"f{i:03}-{'x' * 60}.txt"
        piece = f'"{p}" '
        if len(args) + len(piece) > SENDTO_ARGS_MAX:
            break
        files.write(p, "x")
        paths.append(p)
        args += piece
        i += 1
    args = args.rstrip()
    assert len(args) >= SENDTO_ARGS_MIN, len(args)
    print(f"SENDTO_LONG files={len(paths)} args_chars={len(args)} longest_path={max(len(str(p)) for p in paths)}")
    with oswin.FgHelper(env=sandbox.env(None)) as fg:
        fg.focus()
        t0 = time.time()
        fg.startfile(link, "open", args)
        qp = collect_page(app)
        summary = qp.get_by_test_id("collect-summary")
        wait_attr(summary, "data-count", str(len(paths)), timeout=30)
        print(f"SENDTO_LONG all_ms={round((time.time() - t0) * 1000)}")
        assert summary.get_attribute("data-invocations") == "1", "接近上限的「发送到」也应是一个进程带全部路径"
        got = app.invoke("collect_session")["paths"]
        assert len(got) == len(paths) and all(same_path(g, p) for g, p in zip(got, paths)), "路径不应被截断或重排"
        qp.get_by_test_id("collect-action-import").click()
        assert result(qp)["created"] == str(len(paths))
        wait_session_done(app)


@pytest.mark.case("D-SHELL-04")
def test_fifty_items_via_shell_verb_latency(shell_on, sandbox):
    """资源管理器多选 50 项（Player 模型 = 每项一个进程）：前台进程逐个调用动词，
    首个调用 → 快速窗显示全部 50 项的延迟 ≤ COLLECT_LATENCY_MS，只有一个会话，快速窗在前台。"""
    app = shell_on
    paths = [files.write(sandbox.files / "fifty" / f"f{i:02}.txt", "x") for i in range(50)]
    # 拆解延迟：单个转发进程从启动到退出的耗时（主实例已在运行，无并发）
    probe = files.write(sandbox.files / "fifty-probe" / "probe.txt", "x")
    single = []
    for _ in range(5):
        t = time.time()
        subprocess.run([str(sandbox.exe), "--collect", str(probe)], env=sandbox.env(None), timeout=60)
        single.append(round((time.time() - t) * 1000))
    wait_until(lambda: app.invoke("collect_session") is not None, 10)
    qp0 = collect_page(app)
    qp0.get_by_test_id("collect-action-import").click()
    wait_session_done(app, timeout=30)
    with oswin.FgHelper(env=sandbox.env(None)) as fg:
        # 同一个转发经前台进程 ShellExecute 动词启动（与资源管理器同路径），逐个串行
        verb_single = []
        for i in range(3):
            q = files.write(sandbox.files / "fifty-probe" / f"verb{i}.txt", "x")
            t = time.time()
            fg.startfile(q, verb=VERB)
            wait_until(lambda: (app.invoke("collect_session") or {}).get("invocations", 0) >= 1, 15)
            verb_single.append(round((time.time() - t) * 1000))
            time.sleep(0.6)  # 过静默窗口，快速窗弹出
            cp = collect_page(app)
            cp.get_by_test_id("collect-action-import").click()
            wait_session_done(app, timeout=30)
        fg.focus()
        t0 = time.time()
        arrivals = []
        for p in paths:
            fg.startfile(p, verb=VERB)
            s0 = app.invoke("collect_session")
            arrivals.append((round((time.time() - t0) * 1000), (s0 or {}).get("invocations", 0)))
        t_spawned = time.time()
        h = quick_hwnd(app.proc.pid, timeout=30)
        t_window = time.time()
        qp = collect_page(app)
        summary = qp.get_by_test_id("collect-summary")
        wait_attr(summary, "data-count", "50", timeout=30)
        wait_attr(summary, "data-invocations", "50", timeout=30)
        perf = collect_perf(qp)
        m = {"spawn_all_ms": round((t_spawned - t0) * 1000), "window_ms": round((t_window - t0) * 1000),
             "full_render_ms": round(perf[-1]["renderedMs"] - t0 * 1000), "renders": len(perf),
             "sessions": sorted({p["id"] for p in perf}), "foreground": foreground_report(app),
             "build": os.environ.get("TL_E2E_BUILD", "debug+gui-subsystem"), "single_forward_ms": single, "single_verb_ms": verb_single, "arrivals_during_spawn": arrivals[::5]}
        print(f"COLLECT_SHELL_PERF {json.dumps(m, ensure_ascii=False)}")
        assert len(m["sessions"]) == 1 and len(quick_pages(app)) == 1, m
        assert m["full_render_ms"] <= COLLECT_LATENCY_MS, m
        assert m["foreground"]["foreground_is_quick"] and m["foreground"]["topmost"], m
        assert h == m["foreground"]["quick"]
        qp.get_by_test_id("collect-action-import").click()
        assert result(qp)["created"] == "50"
        wait_session_done(app, timeout=30)


@pytest.mark.case("D-SHELL-06")
def test_win11_top_level_menu_register_invoke_cleanup(app_factory, sandbox):
    """Win11 一级右键菜单（设置默认关）：开启 → 包已注册、explorer 新菜单第一层有该项、点击后主实例收到收纳；
    外部卸包后重启按设置自动补注册；关闭后包 / PackagedCom 键 / 菜单项消失，DLL 不再被占用；
    `--shell-integration remove` 也会清掉它。"""
    import shutil
    assert win11menu.appx_version() is None, "runner 上不应预先注册 TagLauncher.ShellMenu"
    # 沙箱只复制了 exe：菜单组件按安装布局放到 <程序目录>\win11-menu\
    shutil.copytree(sandbox.exe_src.parent / "win11-menu", sandbox.bin / "win11-menu", dirs_exist_ok=True)
    app = app_factory()
    try:
        st = app.invoke("get_win11_menu")
        print(f"WIN11_MENU status {json.dumps(st, ensure_ascii=False)}")
        assert st["supported"], f"desktop 作业构建了真实组件、runner 为 Win11 内核，应可用：{st}"
        assert not st["enabled"] and not st["registered"], st
        t0 = time.perf_counter()
        st = app.invoke("set_win11_menu", {"enabled": True})
        reg_ms = round((time.perf_counter() - t0) * 1000)
        assert st["enabled"] and st["registered"] and st["registeredVersion"] == st["bundledVersion"], st
        assert win11menu.packaged_com_registered()

        d = files.write(sandbox.files / "w11" / "probe.txt", "x").parent
        ui = win11menu.explorer_menu(d, "probe.txt", sandbox.artifacts / "win11-menu-on.png", "on", click=True)
        assert ui.get("menu_modern") == "True", f"应是 Win11 新菜单（含「显示更多选项」）：{ui}"
        assert ui.get("our_item_visible") == "True", f"一级菜单里应有「{win11menu.TITLE}」：{ui}"
        t1 = time.perf_counter()
        qp = collect_page(app)
        wait_attr(qp.get_by_test_id("collect-summary"), "data-count", "1")
        collect_ms = round((time.perf_counter() - t1) * 1000)
        s = app.invoke("collect_session")
        assert [os.path.basename(p) for p in s["paths"]] == ["probe.txt"], s
        qp.get_by_test_id("collect-action-import").click()
        assert result(qp)["created"] == "1"
        wait_session_done(app)

        # 意图保持开：外部把包卸掉（等同升级安装前钩子），重启后后台按设置补注册
        win11menu.appx_remove()
        assert win11menu.appx_version() is None
        app = app.restart()
        t2 = time.perf_counter()
        wait_until(lambda: win11menu.appx_version() == st["bundledVersion"], 60, "重启后没有按设置重新注册")
        reconcile_ms = round((time.perf_counter() - t2) * 1000)

        st = app.invoke("set_win11_menu", {"enabled": False})
        assert not st["enabled"] and not st["registered"], st
        assert win11menu.appx_version() is None and not win11menu.packaged_com_registered()
        ui = win11menu.explorer_menu(d, "probe.txt", sandbox.artifacts / "win11-menu-off.png", "off")
        assert ui.get("menu_modern") == "True" and ui.get("our_item_visible") == "False", ui
        dll = sandbox.bin / "win11-menu" / "tl_menu.dll"
        wait_until(lambda: win11menu.file_unlocked(dll), 15, "关闭后 tl_menu.dll 仍被占用")

        # 便携版清理入口同样移除一级菜单
        st = app.invoke("set_win11_menu", {"enabled": True})
        assert st["registered"], st
        r = subprocess.run([str(sandbox.exe), "--shell-integration", "remove"], capture_output=True, timeout=120,
                           env=sandbox.env(None))
        assert r.returncode == 0, r.stderr.decode("utf-8", "replace")
        assert win11menu.appx_version() is None
        print(f"WIN11_MENU register_ms={reg_ms} click_to_collect_ms={collect_ms} reconcile_ms={reconcile_ms}")
    finally:
        win11menu.appx_remove()
