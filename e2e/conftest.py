"""TagLauncher E2E：会话级守卫 + 每用例沙箱/应用夹具。"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
from pathlib import Path

import pytest

from harness.app import AppSession
from harness.integrity import RealDirGuard, foreign_instances
from harness.paths import ROOT, TMP, default_cli, default_exe
from harness.report import Reporter
from harness.sandbox import Sandbox

LAYER_ORDER = {"cli": 0, "ui": 1, "visual": 2, "window": 3}
_JS_ERRORS: list[tuple[str, list[str]]] = []


def _git_sha() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True,
                              text=True).stdout.strip() or "nogit"
    except OSError:
        return "nogit"


def pytest_addoption(parser):
    parser.addoption("--keep-sandboxes", action="store_true", help="通过的用例也保留沙箱目录")
    parser.addoption("--allow-visible-window", action="store_true", default=False,
                     help="允许跑 visible_window 用例（窗口必须在屏幕上，如最大化）；也可设 TL_E2E_ALLOW_VISIBLE=1")
    parser.addoption("--run-dir", default=os.environ.get("TL_E2E_RUN_DIR"))
    parser.addoption("--window-countdown", type=int, default=5)
    parser.addoption("--shard", default=None,
                     help="i/n：按文件分片只跑第 i 片（CI 并行用）；test_zz_err 会话收尾检查每片都跑")
    parser.addoption("--allow-registry", action="store_true",
                     help="允许跑 real_registry 用例（写当前用户 HKCU 的右键菜单键再清理）；CI 设 TL_E2E_ALLOW_REGISTRY=1")
    parser.addoption("--allow-physical-input", action="store_true",
                     help="允许跑 physical_input 用例（接管真实鼠标键盘）；也可设 TL_E2E_ALLOW_PHYSICAL=1")


def pytest_configure(config):
    config.addinivalue_line("markers", "case(*ids): 关联用例矩阵 ID")
    config.addinivalue_line("markers", "visible_window: 窗口必须出现在屏幕上（最大化等），默认跳过，需 --allow-visible-window")
    config.addinivalue_line("markers", "physical_input: 接管真实鼠标/键盘（SendInput），默认跳过，需显式 --allow-physical-input")
    config.addinivalue_line("markers", "real_registry: 写真实 HKCU（右键菜单注册/清理），只在 CI 跑；本机需显式 --allow-registry")
    run_dir = config.getoption("--run-dir")
    run_dir = Path(run_dir).resolve() if run_dir else TMP / f"run-{_git_sha()}-{time.strftime('%Y%m%d-%H%M%S')}"
    config._tl_run_dir = run_dir
    config._tl_reporter = Reporter(run_dir)
    config.pluginmanager.register(config._tl_reporter, "tl-reporter")


PHYSICAL_FIXTURES = {"real_input", "win"}


def physical_allowed(config) -> bool:
    return bool(config.getoption("--allow-physical-input") or os.environ.get("TL_E2E_ALLOW_PHYSICAL") == "1")


def pytest_collection_modifyitems(config, items):
    # 物理输入用例：window 层全部 + 任何用到 real_input/win 夹具的用例。默认跳过，避免干扰用户使用电脑。
    allow = physical_allowed(config)
    allow_vis = allow or config.getoption("--allow-visible-window") or os.environ.get("TL_E2E_ALLOW_VISIBLE") == "1"
    vis_gate = pytest.mark.skip(reason="visible_window：窗口须在屏幕上（会打扰用户），默认不跑，与物理输入用例一起集中跑")
    gate = pytest.mark.skip(reason="physical_input：会接管真实鼠标键盘，默认不跑（需用户同意后用 --allow-physical-input 集中跑）")
    allow_reg = config.getoption("--allow-registry") or os.environ.get("TL_E2E_ALLOW_REGISTRY") == "1"
    reg_gate = pytest.mark.skip(reason="real_registry：会写当前用户的 HKCU 右键菜单键，只在 CI（TL_E2E_ALLOW_REGISTRY=1）跑，绝不在用户电脑上跑")
    for item in items:
        parts = Path(str(item.fspath)).parts
        if "window" in parts or PHYSICAL_FIXTURES & set(getattr(item, "fixturenames", ())):
            item.add_marker(pytest.mark.physical_input)
        if item.get_closest_marker("physical_input") and not allow:
            item.add_marker(gate)
        elif item.get_closest_marker("visible_window") and not allow_vis:
            item.add_marker(vis_gate)
        if item.get_closest_marker("real_registry") and not allow_reg:
            item.add_marker(reg_gate)

    def key(item):
        parts = Path(str(item.fspath)).parts
        return min((LAYER_ORDER[p] for p in parts if p in LAYER_ORDER), default=9)
    items.sort(key=key)  # 稳定排序：CLI → UI → 视觉 → 窗口；层内保持文件顺序
    _apply_shard(config, items)


ALWAYS_IN_SHARD = "test_zz_err.py"


def shard_files(files: list[tuple[str, int]], index: int, total: int) -> set[str]:
    """按文件贪心分片：依次把文件分给当前用例数最少的片（确定性，同文件不拆）。"""
    loads = [0] * total
    owner: dict[str, int] = {}
    for f, n in sorted(files, key=lambda x: (-x[1], x[0])):
        k = min(range(total), key=lambda i: (loads[i], i))
        owner[f] = k
        loads[k] += n
    return {f for f, k in owner.items() if k == index - 1}


def _apply_shard(config, items):
    spec = config.getoption("--shard")
    if not spec:
        return
    index, total = (int(x) for x in spec.split("/"))
    if not 1 <= index <= total:
        raise pytest.UsageError(f"--shard {spec} 越界")
    counts: dict[str, int] = {}
    for item in items:
        f = str(item.fspath)
        if not f.endswith(ALWAYS_IN_SHARD):
            counts[f] = counts.get(f, 0) + 1
    mine = shard_files(list(counts.items()), index, total)
    keep = [i for i in items if str(i.fspath) in mine or str(i.fspath).endswith(ALWAYS_IN_SHARD)]
    drop = [i for i in items if i not in keep]
    if drop:
        config.hook.pytest_deselected(items=drop)
    items[:] = keep


# ---------------------------------------------------------------------- session
@pytest.fixture(scope="session")
def run_dir(pytestconfig) -> Path:
    d = pytestconfig._tl_run_dir
    d.mkdir(parents=True, exist_ok=True)
    return d


@pytest.fixture(scope="session", autouse=True)
def real_dir_guard(pytestconfig, run_dir):
    """E-ENV-14：开跑前拒绝真实实例；会话前后快照/还原真实目录并比对。"""
    foreign = foreign_instances()
    if foreign:
        pytest.exit(f"检测到正在运行的 TagLauncher（{foreign}）。请先退出再跑 E2E，避免单实例插件把命令转给真实实例。",
                    returncode=3)
    guard = RealDirGuard(run_dir / "real-dir-stash")
    guard.snapshot()
    yield guard
    diff = guard.restore()
    pytestconfig._tl_reporter.real_dir_diff = diff
    shutil.rmtree(guard.stash, ignore_errors=True)
    if diff:
        pytestconfig._tl_reporter.session_notes.append(f"真实目录有变化：{diff}")


@pytest.fixture(scope="session", autouse=True)
def webview2_policy_cleanup():
    """CI 提权时 harness 会写 HKLM WebView2 策略（见 harness.webview2_policy）；会话结束删掉。"""
    from harness import webview2_policy
    yield
    if webview2_policy.enabled():
        webview2_policy.clear()


@pytest.fixture(scope="session")
def pw():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        yield p


@pytest.fixture(scope="session")
def exe_path() -> Path:
    p = default_exe()
    if not p.exists():
        pytest.exit(f"找不到被测 exe：{p}（先 npx tauri build --debug --no-bundle）", returncode=4)
    return p


@pytest.fixture(scope="session")
def cli_path() -> Path:
    return default_cli()


# ---------------------------------------------------------------------- per test
def _safe(name: str) -> str:
    return re.sub(r"[^\w\-.]+", "_", name)[:80]


@pytest.fixture
def sandbox(request, run_dir, exe_path):
    root = run_dir / "sb" / _safe(request.node.name)
    if root.exists():
        shutil.rmtree(root, ignore_errors=True)
    sb = Sandbox(root, exe_path)
    yield sb
    # 产物保留到 run_dir/artifacts/<test>；通过的用例删除沙箱（WebView2 数据较大）
    art = run_dir / "artifacts" / _safe(request.node.name)
    if any(sb.artifacts.iterdir()):
        shutil.copytree(sb.artifacts, art, dirs_exist_ok=True)
        for f in art.iterdir():
            request.node.user_properties.append(("artifact", str(f)))
    rep = getattr(request.node, "_tl_call_rep", None)
    failed = rep is None or rep.failed
    if not failed and not request.config.getoption("--keep-sandboxes"):
        for _ in range(3):
            shutil.rmtree(root, ignore_errors=True)
            if not root.exists():
                break
            time.sleep(1)


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    if rep.when == "call":
        item._tl_call_rep = rep


class AppFactory:
    def __init__(self, pw, sandbox, request):
        self.pw, self.sb, self.request = pw, sandbox, request
        self.sessions: list[AppSession] = []

    def __call__(self, start: bool = True, **kw) -> AppSession:
        s = AppSession(self.pw, self.sb, **kw)
        self.sessions.append(s)
        return s.start() if start else s

    def teardown(self):
        failed = getattr(self.request.node, "_tl_call_rep", None)
        failed = failed is None or failed.failed
        errors: list[str] = []
        for s in self.sessions:
            if s.page is not None:
                try:
                    errors += s.js_errors()
                except Exception:
                    pass
                if failed:
                    try:
                        (self.sb.artifacts / "failure-aria.txt").write_text(
                            s.page.locator("body").aria_snapshot(), encoding="utf-8")
                        s.page.screenshot(path=str(self.sb.artifacts / "failure.png"))
                        (self.sb.artifacts / "failure-ipc.json").write_text(
                            json_dumps(s.page.evaluate("window.__e2e && {calls: window.__e2e.calls.filter(c => c.cmd !== 'get_items').slice(-80), toasts: window.__e2e.toasts}")),
                            encoding="utf-8")
                    except Exception:
                        pass
            try:
                s.stop()
            except Exception:
                s.kill()
        if errors:
            self.request.node.user_properties.append(("js_errors", errors))
        if errors and self.request.node.get_closest_marker("expected_js_errors") is None:
            _JS_ERRORS.append((self.request.node.nodeid, errors))
        bad = []
        for s in self.sessions:
            g = s.guard
            if g is None:
                continue
            g.stop()
            info = {"samples": g.samples, "on_screen": g.violations[:5], "on_screen_n": len(g.violations),
                    "fg_stolen": g.fg_stolen, "nudges": g.nudges}
            (self.sb.artifacts / "stealth.json").write_text(json_dumps(info), encoding="utf-8")
            if g.violations or g.fg_stolen:
                bad.append(info)
        if bad and not self.request.node.get_closest_marker("visible_window"):
            pytest.fail(f"应用窗口曾出现在屏幕上或抢到前台（应移到屏幕外）：{bad}", pytrace=False)


def json_dumps(v) -> str:
    import json
    return json.dumps(v, ensure_ascii=False, indent=1, default=str)


@pytest.fixture
def app_factory(pw, sandbox, request):
    f = AppFactory(pw, sandbox, request)
    yield f
    f.teardown()


@pytest.fixture
def app(app_factory) -> AppSession:
    return app_factory()


@pytest.fixture
def js_error_log():
    """E-ERR-04：整套 UI 用例期间收集到的未捕获错误。"""
    return _JS_ERRORS


@pytest.fixture
def ai_mock():
    from harness.mocks import AnthropicMock
    m = AnthropicMock(lambda name, body: ["测试标签", "示例"])
    yield m
    m.stop()


@pytest.fixture
def dav_mock():
    from harness.mocks import WebDavMock
    m = WebDavMock("e2e", "pass-e2e", prefix="/dav")
    yield m
    m.stop()
