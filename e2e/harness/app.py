"""启动沙箱内的 tag-launcher.exe 并通过 CDP 接管 WebView2。"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import Browser, Page, Playwright

from . import launchdiag, stealth, webview2_policy
from .launchdiag import HEALTH, LaunchRecord, StartupError
from .integrity import real_dirs
from .sandbox import Sandbox, free_port, webview2_args

# tests/window（physical_input）需要真实可见窗口，在其 conftest 里关掉
STEALTH = {"on": True}

STUB_JS = (Path(__file__).parent / "ipc_stub.js").read_text(encoding="utf-8")

# 已知且无害的 console.error 白名单（E-ERR-04）
CONSOLE_ALLOW = (
    "Failed to load resource",  # 缺失缩略图等
)


class AppSession:
    """一个运行中的应用进程 + CDP 连接。"""

    def __init__(self, pw: Playwright, sandbox: Sandbox, *, cdp: bool = True, args: list[str] | None = None,
                 dismiss_welcome: bool = True, throttle_update: bool = True, reload: bool = True):
        self.pw = pw
        self.sb = sandbox
        self.cdp = cdp
        self.args = args or []
        self.dismiss_welcome = dismiss_welcome
        # reload=False：保留首帧（如启动期一次性的迁移弹窗）；桩在应用脚本之后注入
        self.reload = reload
        self.throttle_update = throttle_update
        self.proc: subprocess.Popen | None = None
        self.browser: Browser | None = None
        self.page: Page | None = None
        self.port: int | None = None
        self.page_errors: list[str] = []
        self.launch_count = 0
        self.guard: stealth.Guard | None = None

    # ------------------------------------------------------------------ 生命周期
    def start(self, timeout: float = 60) -> "AppSession":
        threshold = launchdiag.fuse_threshold()
        if self.cdp and HEALTH.tripped(threshold):
            raise StartupError(HEALTH.fuse_message())
        self.sb.install_exe()
        self.port = free_port() if self.cdp else None
        self.launch_count += 1
        log_path = self.sb.root / f"process-{self.launch_count}.log"
        log = log_path.open("w", encoding="utf-8")
        if stealth.ENABLED and STEALTH["on"] and self.guard is None:
            self.guard = stealth.Guard(self.sb.root)
        env = self.sb.env(self.port)
        policy = bool(self.cdp and webview2_policy.enabled())
        if policy:
            self._prepare_elevated_webview2()
        rec = LaunchRecord(n=self.launch_count, exe=str(self.sb.exe), args=list(self.args), cwd=str(self.sb.bin),
                           cdp_port=self.port, env=LaunchRecord.safe_env(env))
        rec.env["webview2_channel"] = "hklm-policy" if policy else "env"
        self._launch = rec
        try:
            self.proc = subprocess.Popen([str(self.sb.exe), *self.args], cwd=self.sb.bin,
                                         env=env, stdout=log, stderr=log)
            rec.pid = self.proc.pid
            rec.mark("进程已创建")
            if self.cdp:
                self._connect(timeout)
                rec.mark("页面就绪")
        except Exception as e:
            log.flush()
            rec.error = f"{type(e).__name__}: {e}"
            self._fail_launch(rec, log_path)
            raise StartupError(rec.summary()) from e
        finally:
            log.close()
        if self.cdp:
            HEALTH.record_ok()
            # 证据：WebView2 实际用的是哪个配置目录（沙箱变量被丢弃时只有真实目录出现）
            rec.env["profile_in_sandbox"] = str((self.sb.root / "WebView2" / "EBWebView").exists())
        rec.write(self.sb.artifacts)
        return self

    def _prepare_elevated_webview2(self) -> None:
        """CI 提权宿主：WebView2 丢弃 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS，CDP 端口改经 HKLM 策略下发。
        （CI 实测：用户数据目录仍落在沙箱 WebView2\\EBWebView，只有附加参数被丢。）"""
        webview2_policy.set_args(webview2_args(self.port))

    def _fail_launch(self, rec: LaunchRecord, log_path: Path) -> None:
        """记录退出码/存活、日志尾部；落盘 launch-N.json 与 process-N.log，更新熔断计数。"""
        if self.proc is not None:
            code = self.proc.poll()
            rec.alive, rec.exit_code = code is None, code
        rec.log_tail = launchdiag.tail_text(log_path)
        snap = launchdiag.windows_snapshot(self.sb.root)
        if snap:
            (self.sb.artifacts / f"launch-{rec.n}-system.json").write_text(
                json.dumps(snap, ensure_ascii=False, indent=1), encoding="utf-8")
        out = rec.write(self.sb.artifacts)
        try:
            (self.sb.artifacts / log_path.name).write_bytes(log_path.read_bytes())
        except OSError:
            pass
        if os.environ.get("CI"):
            # CI 一次性 runner：Tauri 日志走真实 %LOCALAPPDATA%\com.taglauncher.app\logs（不认沙箱变量），
            # 附上最新日志尾部；本机运行不读用户真实目录。
            try:
                logs = sorted((real_dirs()[1] / "logs").glob("*.log"), key=lambda f: f.stat().st_mtime)
                if logs:
                    (self.sb.artifacts / f"tauri-log-{rec.n}.txt").write_text(
                        launchdiag.tail_text(logs[-1], 200), encoding="utf-8")
            except OSError:
                pass
        if self.cdp:
            HEALTH.record_fail(rec.summary(), str(out))

    def _connect(self, timeout: float) -> None:
        endpoint = f"http://127.0.0.1:{self.port}"
        deadline = time.monotonic() + timeout
        rec = getattr(self, "_launch", None)
        mark = rec.mark if rec else (lambda _p: None)
        while True:
            if self.proc.poll() is not None:
                raise RuntimeError(f"应用进程提前退出 code={self.proc.returncode} sandbox={self.sb.root}")
            try:
                with urllib.request.urlopen(endpoint + "/json/version", timeout=1):
                    break
            except OSError:
                if time.monotonic() > deadline:
                    raise RuntimeError(f"WebView2 CDP 端口不可用: {self.sb.root}")
                time.sleep(0.2)
        mark("CDP 端口可用")
        # 偶发：首个 CDP 连接错过页面 target（一直看不到 tauri.localhost）。每 10s 无果就重连一次。
        page, seen = None, set()
        while page is None:
            self.browser = self.pw.chromium.connect_over_cdp(endpoint)
            mark("CDP 已连接")
            reconnect_at = time.monotonic() + 10
            while page is None and time.monotonic() < min(deadline, reconnect_at):
                for ctx in self.browser.contexts:
                    for cand in ctx.pages:
                        url = cand.url or ""
                        seen.add(url)
                        if url and url != "about:blank" and not url.startswith("chrome-error:"):
                            page = cand
                            break
                    if page:
                        break
                if page is None:
                    time.sleep(0.2)
            if rec:
                rec.seen_urls = sorted(seen)
            if page is None:
                # 不调用 browser.close()：CDP 连接上 close 可能连带关闭 WebView；旧连接随进程结束释放
                if time.monotonic() >= deadline or self.proc.poll() is not None:
                    raise RuntimeError(f"找不到应用页面 seen={sorted(seen)} alive={self.proc.poll() is None}")
        # 桩脚本需要在应用脚本之前生效：注册 init script 后立刻 reload。
        # 应用的启动期更新检查有 8s 延迟，reload 发生在其之前（spike 验证）。
        mark("找到应用页面")
        page.context.add_init_script(STUB_JS)
        page.evaluate(STUB_JS)
        if self.reload:
            page.reload(wait_until="domcontentloaded")
        self.page = page
        page.on("pageerror", lambda err: self.page_errors.append(str(err)))
        if self.reload:
            mark("reload 完成")
        page.locator('[data-region="root"]').wait_for(state="attached", timeout=60_000)
        mark("应用根节点就绪")
        if self.throttle_update:
            page.evaluate("localStorage.setItem('taglauncher.update_last_check_ts', String(Date.now()))")
        if self.dismiss_welcome:
            self.close_welcome()
        self.ensure_frames()

    _FRAME_JS = ("() => new Promise(r => { const t = setTimeout(() => r(false), 800);"
                 " requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); r(true); })); })")

    def ensure_frames(self, tries: int = 6) -> bool:
        """确认页面还在出帧；屏幕外停帧时让 stealth 抖一下窗口（只在守护开启时）。"""
        for _ in range(tries):
            if self.page.evaluate(self._FRAME_JS):
                return True
            if self.guard is None:
                return False
            self.guard.nudges += stealth.nudge_windows(self.guard.root)
        return False

    def close_welcome(self, timeout_ms: int = 4000) -> bool:
        btn = self.page.get_by_role("button", name="开始使用", exact=True)
        try:
            btn.wait_for(timeout=timeout_ms)
        except Exception:
            return False
        self.ensure_frames()
        try:
            btn.click(timeout=8000)
        except Exception:
            self.ensure_frames()
            btn.click()
        btn.wait_for(state="detached", timeout=5000)
        return True

    def stop(self, graceful: bool = True, timeout: float = 15) -> int | None:
        """关闭应用：先走窗口关闭（触发窗口状态保存），超时再按 PID 结束。"""
        code = None
        if self.proc and self.proc.poll() is None and graceful and self.page is not None:
            try:
                self.page.evaluate("window.__TAURI__.window.getCurrentWindow().close()")
            except Exception:
                pass
            try:
                code = self.proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                pass
        if self.proc and self.proc.poll() is None:
            self.kill()
        try:
            if self.browser:
                self.browser.close()
        except Exception:
            pass
        self.browser = None
        self.page = None
        return code if code is not None else (self.proc.returncode if self.proc else None)

    def kill(self) -> None:
        if self.proc and self.proc.poll() is None:
            subprocess.run(["taskkill", "/PID", str(self.proc.pid), "/T", "/F"], capture_output=True)
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass

    def restart(self, **kw) -> "AppSession":
        self.stop()
        return self.start(**kw)

    def reconnect_after_self_restart(self, timeout: float = 60) -> "AppSession":
        """应用自身调用 restart_app 后：旧进程退出、新进程由应用拉起（继承环境变量与 CDP 端口）。"""
        old = self.proc
        try:
            old.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            raise RuntimeError("应用未按预期自重启")
        try:
            if self.browser:
                self.browser.close()
        except Exception:
            pass
        self.proc = _AdoptedProcess.find(self.sb.exe, exclude=old.pid, timeout=timeout)
        self._connect(timeout)
        return self

    # ------------------------------------------------------------------ IPC 工具
    def invoke(self, cmd: str, args: dict | None = None):
        return self.page.evaluate("([c, a]) => window.__TAURI__.core.invoke(c, a)", [cmd, args or {}])

    def invoke_error(self, cmd: str, args: dict | None = None) -> str | None:
        return self.page.evaluate(
            "async ([c, a]) => { try { await window.__TAURI__.core.invoke(c, a); return null } catch (e) { return String(e && (e.message || e)) } }",
            [cmd, args or {}])

    def stub(self, cmd: str, value=None, *, error: str | None = None, queue: list | None = None) -> None:
        if queue is not None:
            spec = {"queue": [{"value": v} for v in queue]}
        elif error is not None:
            spec = {"error": error}
        else:
            spec = {"value": value}
        self.page.evaluate("([c, s]) => window.__e2e.stub(c, s)", [cmd, spec])

    def calls(self, cmd: str) -> list[dict]:
        return self.page.evaluate("c => window.__e2e.callsOf(c)", cmd)

    def wait_ipc(self, cmd: str, n: int = 1, timeout: float = 8) -> list[dict]:
        """等待某个 IPC 命令被前端调用至少 n 次，返回调用记录。"""
        return wait_until(lambda: (c := self.calls(cmd)) and len(c) >= n and c, timeout,
                          lambda: f"等待 IPC {cmd} ×{n}，实际 {len(self.calls(cmd))}")

    def toasts(self) -> list[dict]:
        return self.page.evaluate("window.__e2e.toasts")

    def wait_toast(self, text: str, timeout: float = 8) -> dict:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for t in self.toasts():
                if text in (t.get("message") or ""):
                    return t
            time.sleep(0.1)
        raise AssertionError(f"未出现 toast「{text}」；已有：{[t.get('message') for t in self.toasts()]}")

    def clear_toasts(self) -> None:
        self.page.evaluate("window.__e2e.toasts.length = 0")

    def js_errors(self) -> list[str]:
        try:
            data = self.page.evaluate("({e: window.__e2e.errors, c: window.__e2e.consoleErrors})")
        except Exception:
            return list(self.page_errors)
        errs = list(self.page_errors) + data["e"]
        errs += [c for c in data["c"] if not any(a in c for a in CONSOLE_ALLOW)]
        return errs

    def clipboard(self) -> list[str]:
        return self.page.evaluate("window.__e2e.clipboard")

    # ------------------------------------------------------------------ 数据
    def items(self) -> list[dict]:
        return self.invoke("get_items", {"includeVisuals": False})

    def item(self, name: str) -> dict:
        for it in self.items():
            if it["name"] == name:
                return it
        raise AssertionError(f"库中没有「{name}」：{[i['name'] for i in self.items()]}")

    def seed(self, paths, refresh: bool = True) -> list[dict]:
        """经真实 IPC 入库，再走 UI 刷新。"""
        res = self.invoke("add_items", {"paths": [str(p) for p in paths]})
        if refresh:
            self.refresh_items()
            self.wait_count(len(self.items()))
        return res

    def scope_count(self) -> int | None:
        txt = self.page.locator('[data-region="scope-header"]').inner_text()
        m = re.search(r"(\d+)\s*项", txt)
        return int(m.group(1)) if m else None

    def wait_count(self, n: int, timeout: float = 8) -> None:
        wait_until(lambda: self.scope_count() == n, timeout, lambda: f"期望 {n} 项，实际 {self.scope_count()}")

    def card(self, name: str):
        """卡片/行定位：以 item id 为准（data-selectable-item-id）。"""
        return self.page.locator(f'[data-selectable-item-id="{self.item(name)["id"]}"]')

    def card_by_id(self, item_id: int):
        return self.page.locator(f'[data-selectable-item-id="{item_id}"]')

    def visible_names(self) -> list[str]:
        return self.page.get_by_role("list", name="项目列表").get_by_role("heading", level=3).all_inner_texts()

    def selected_ids(self) -> list[int]:
        return [int(x) for x in self.page.eval_on_selector_all(
            "[data-selectable-item-id]",
            # 网格卡片有 data-selected；列表行（ItemRow）没有任何选中态属性，只能看选中样式类
            "els => els.filter(e => e.dataset.selected === 'true' || (e.dataset.selected === undefined"
            " && e.classList.contains('bg-[var(--accent-primary-bg)]'))).map(e => e.dataset.selectableItemId)")]

    def context_menu(self, name: str):
        self.card(name).click(button="right")
        menu = self.page.locator("[data-context-menu][role=menu]").first
        menu.wait_for(timeout=5000)
        return menu

    def menu_click(self, name: str, label: str) -> None:
        self.context_menu(name).get_by_role("menuitem", name=label, exact=True).click()

    def get_toolbar(self):
        return self.page.get_by_test_id("batch-toolbar")

    def dialog(self, name: str):
        d = self.page.get_by_role("dialog", name=name)
        d.wait_for(timeout=8000)
        return d

    def open_settings(self, section: str | None = None):
        self.page.get_by_role("button", name="设置", exact=True).click()
        dlg = self.dialog("设置工作台")
        if section:
            dlg.get_by_role("navigation", name="设置区块导航").get_by_role("button", name=section, exact=True).click()
        return dlg

    def reload_page(self) -> None:
        """整页重载（IPC 直接改数据后让前端全量重读）；桩随 init script 恢复默认。"""
        self.page.reload(wait_until="domcontentloaded")
        self.page.locator('[data-region="root"]').wait_for(state="attached", timeout=60_000)
        self.page.wait_for_function("() => window.__e2e && window.__e2e.calls.some((c) => c.cmd === 'get_tags')"
                                    " && window.__e2e.calls.some((c) => c.cmd === 'get_items')", timeout=30_000)
        self.page.wait_for_timeout(300)
        if self.dismiss_welcome:
            self.close_welcome(timeout_ms=2500)

    def add_tag(self, name: str, color: str = "#3b82f6") -> int:
        res = self.invoke("add_tag", {"name": name, "color": color})
        return res["id"] if isinstance(res, dict) else int(res)

    def tag_ids(self) -> dict[str, int]:
        return {t["name"]: t["id"] for t in self.invoke("get_tags")}

    def sidebar_tag(self, name: str):
        return self.page.locator("[data-tag-row-id]").filter(has=self.page.get_by_text(name, exact=True)).first

    def sidebar_tab(self, label: str) -> None:
        self.page.get_by_role("group", name="资源分类").get_by_role("button", name=label).click()

    def search(self, text: str) -> None:
        self.page.locator("#workspace-search").fill(text)

    def wait_names(self, expect, timeout: float = 8) -> None:
        want = sorted(expect)
        wait_until(lambda: sorted(self.visible_names()) == want, timeout, lambda: f"期望 {want}，实际 {sorted(self.visible_names())}")

    def refresh_items(self) -> None:
        """模拟用户刷新：派发 F5 之外的稳妥方式——通过命令面板“刷新”。"""
        self.run_command("刷新")

    def run_command(self, title: str) -> None:
        """命令面板执行一条命令（按标题精确匹配）。"""
        self.page.keyboard.press("Control+k")
        dlg = self.page.get_by_role("dialog", name="命令面板")
        dlg.wait_for(timeout=5000)
        dlg.get_by_label("搜索命令或项目").fill(title)
        row = dlg.locator("button").filter(has=self.page.get_by_text(title, exact=True)).first
        row.click(timeout=8000)
        dlg.wait_for(state="hidden", timeout=5000)

    def capture(self, name: str) -> Path:
        target = self.sb.artifacts / f"{name}.png"
        self.page.evaluate(
            "async () => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));"
            " await Promise.all(document.getAnimations().map(a => a.finished.catch(() => {}))); }")
        self.page.screenshot(path=str(target))
        return target

    def drop_paths(self, paths: list[str], via: str = "native") -> None:
        """外部拖拽导入。native=页面侧 emit tauri://drag-drop（spike 验证可达）；dom=合成 DataTransfer。"""
        if via == "native":
            self.page.evaluate(
                "async (p) => { const ev = window.__TAURI__.event;"
                " await ev.emit('tauri://drag-enter', {paths: p, position: {x: 400, y: 300}});"
                " await ev.emit('tauri://drag-drop', {paths: p, position: {x: 400, y: 300}}); }", paths)
        else:
            self.page.evaluate(_DOM_DROP_JS, paths)


def wait_until(pred, timeout: float = 8, msg=None, interval: float = 0.1):
    """轮询直到 pred() 为真；返回 pred 的值。"""
    deadline = time.monotonic() + timeout
    last_exc = None
    while time.monotonic() < deadline:
        try:
            v = pred()
            if v:
                return v
        except Exception as e:  # noqa: BLE001
            last_exc = e
        time.sleep(interval)
    detail = msg() if callable(msg) else (msg or "")
    raise AssertionError(f"等待超时：{detail} {last_exc or ''}")


_DOM_DROP_JS = """
(paths) => {
  const target = document.querySelector('[data-region="main"]') || document.body;
  const dt = new DataTransfer();
  dt.setData('text/uri-list', paths.map(p => 'file:///' + p.replace(/\\\\/g, '/')).join('\\r\\n'));
  dt.setData('text/plain', paths.join('\\n'));
  for (const type of ['dragenter', 'dragover', 'drop']) {
    target.dispatchEvent(new DragEvent(type, {bubbles: true, cancelable: true, dataTransfer: dt}));
  }
}
"""


class _AdoptedProcess:
    """包装非本进程 Popen 拉起的进程（应用自重启后的新 PID）。"""

    def __init__(self, pid: int):
        self.pid = pid
        self.returncode = None

    @staticmethod
    def find(exe: Path, exclude: int, timeout: float) -> "_AdoptedProcess":
        deadline = time.monotonic() + timeout
        target = str(exe).lower()
        while time.monotonic() < deadline:
            out = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 "Get-Process tag-launcher -ErrorAction SilentlyContinue | ForEach-Object { \"$($_.Id)|$($_.Path)\" }"],
                capture_output=True, text=True, encoding="utf-8").stdout
            for line in out.splitlines():
                pid, _, path = line.partition("|")
                if path.strip().lower() == target and int(pid) != exclude:
                    return _AdoptedProcess(int(pid))
            time.sleep(0.3)
        raise RuntimeError("找不到自重启后的新进程")

    def poll(self):
        out = subprocess.run(["tasklist", "/FI", f"PID eq {self.pid}", "/NH"], capture_output=True, text=True).stdout
        if str(self.pid) in out:
            return None
        self.returncode = 0
        return 0

    def wait(self, timeout: float | None = None):
        deadline = time.monotonic() + (timeout or 3600)
        while self.poll() is None:
            if time.monotonic() > deadline:
                raise subprocess.TimeoutExpired("tag-launcher", timeout)
            time.sleep(0.2)
        return 0
