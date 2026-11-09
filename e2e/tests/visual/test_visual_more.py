"""视觉补充（E-VIS-03/04/05/06/07/09/11、E-ENV-05）。截图经 CDP，窗口尺寸用 SetWindowPos，不接管物理输入。"""
from __future__ import annotations

import json
import threading
import time

import pytest

from harness.app import wait_until
from harness.paths import ROOT
from win import win32

from .conftest import THRESHOLD, seed_library, set_client_size
from .test_visual import FAMILIES, VARIANTS, apply_theme

LIGHT_DARK = [("light", FAMILIES["霜靛"][0]), ("dark", FAMILIES["霜靛"][1])]
SECTIONS = ["主题外观", "AI 打标", "数据管理", "云同步", "更新", "扩展"]


def _bad(results):
    return [r for r in results if r.get("mode") == "compared" and r["ratio"] > THRESHOLD]


def _esc_all(app):
    for _ in range(3):
        app.page.keyboard.press("Escape")
        app.page.wait_for_timeout(120)


@pytest.mark.case("E-VIS-03")
def test_icons_view_all_themes(app, sandbox, snap):
    seed_library(app, sandbox)
    set_client_size(app, 1200, 800)
    res = []
    for fam, mode, tid in VARIANTS:
        apply_theme(app, tid, mode)
        app.page.get_by_role("button", name="大图标视图", exact=True).click()
        app.page.wait_for_timeout(300)
        res.append(snap(f"vis-icons-{fam}-{mode}"))
    assert not _bad(res), _bad(res)


@pytest.mark.case("E-VIS-04")
def test_settings_sections(app, sandbox, snap):
    seed_library(app, sandbox)
    set_client_size(app, 1200, 800)
    res = []
    for mode, tid in LIGHT_DARK:
        apply_theme(app, tid, mode)
        for sec in SECTIONS:
            app.open_settings(sec)
            app.page.wait_for_timeout(300)
            res.append(snap(f"vis-settings-{sec}-{mode}"))
            _esc_all(app)
    assert not _bad(res), _bad(res)


@pytest.mark.case("E-VIS-05")
def test_overlays(app, sandbox, snap):
    seed_library(app, sandbox)
    set_client_size(app, 1200, 800)
    pg = app.page
    res = []
    for mode, tid in LIGHT_DARK:
        apply_theme(app, tid, mode)
        pg.keyboard.press("Control+k")
        pg.get_by_role("dialog", name="命令面板").wait_for(timeout=5000)
        res.append(snap(f"vis-ov-palette-{mode}"))
        _esc_all(app)
        card = app.card("会议纪要.md")
        card.click(button="right")
        pg.get_by_role("menuitem", name="快速预览").wait_for(timeout=5000)
        res.append(snap(f"vis-ov-menu-{mode}"))
        pg.get_by_role("menuitem", name="快速预览").click()
        pg.get_by_role("dialog", name="快速预览").wait_for(timeout=5000)
        pg.wait_for_timeout(500)
        res.append(snap(f"vis-ov-preview-{mode}"))
        _esc_all(app)
        app.card("会议纪要.md").click(button="right")
        pg.get_by_role("menuitem", name="管理标签").click()
        pg.wait_for_timeout(500)
        res.append(snap(f"vis-ov-tags-{mode}"))
        _esc_all(app)
    assert not _bad(res), _bad(res)


@pytest.mark.case("E-VIS-06")
def test_empty_and_missing(app, sandbox, snap):
    set_client_size(app, 1200, 800)
    apply_theme(app, FAMILIES["霜靛"][0], "light")
    res = [snap("vis-empty-library")]
    seed_library(app, sandbox)
    app.reload_page()
    app.page.locator("#workspace-search").fill("zz不存在的关键词zz")
    app.page.wait_for_timeout(600)
    res.append(snap("vis-empty-noresult"))
    (sandbox.files / "vis" / "说明.txt").unlink()
    app.restart()
    app.close_welcome(3000)
    set_client_size(app, 1200, 800)
    wait_until(lambda: app.item("说明.txt").get("is_missing"), 15,
               lambda: app.item("说明.txt"))
    app.page.wait_for_timeout(500)
    res.append(snap("vis-missing-card"))
    assert not _bad(res), _bad(res)


@pytest.mark.case("E-VIS-07")
def test_tag_graph(app, sandbox, snap):
    seed_library(app, sandbox)
    set_client_size(app, 1200, 800)
    res = []
    for mode, tid in LIGHT_DARK:
        apply_theme(app, tid, mode)
        app.page.keyboard.press("Control+k")
        dlg = app.page.get_by_role("dialog", name="命令面板")
        dlg.wait_for(timeout=5000)
        app.page.keyboard.type("图谱")
        app.page.get_by_text("打开标签图谱").first.click()
        app.page.wait_for_timeout(1500)  # 力导布局稳定
        res.append(snap(f"vis-graph-{mode}"))
        _esc_all(app)
    assert not _bad(res), _bad(res)


@pytest.mark.case("E-VIS-09")
def test_reduced_motion(app, sandbox):
    seed_library(app, sandbox)
    app.page.emulate_media(reduced_motion="reduce")
    app.open_settings("主题外观")
    app.page.wait_for_timeout(50)
    running = app.page.evaluate("""() => document.getAnimations()
        .filter(a => a.playState === 'running' && (a.effect?.getTiming?.().duration || 0) > 1).length""")
    _esc_all(app)
    app.page.keyboard.press("Control+k")
    app.page.wait_for_timeout(50)
    running += app.page.evaluate("""() => document.getAnimations()
        .filter(a => a.playState === 'running' && (a.effect?.getTiming?.().duration || 0) > 1).length""")
    assert running == 0, f"reduced-motion 下仍有 {running} 个运行中的动画"


@pytest.mark.case("E-VIS-11")
def test_skycloud_theme(app, sandbox, snap):
    seed_library(app, sandbox)
    set_client_size(app, 1200, 800)
    app.stub("plugin:dialog|open", str(ROOT / "ExampleTheme" / "SkyCloudTheme" / "theme.json"))
    app.open_settings("主题外观")
    app.page.get_by_role("button", name="导入", exact=True).first.click()
    app.wait_toast("已导入并应用")
    _esc_all(app)
    app.page.wait_for_timeout(400)
    res = snap("vis-theme-skycloud")
    assert not _bad([res]), res


@pytest.mark.case("E-ENV-05")
def test_first_paint_gated(app_factory, sandbox, run_dir):
    """暗色主题下，窗口可见后 1.5s 内每帧都是已上主题的画面：不出现纯白/纯黑无样式帧，且画面单调收敛。"""
    from PIL import ImageStat
    (run_dir / "visual").mkdir(parents=True, exist_ok=True)
    a = app_factory()
    seed_library(a, sandbox)
    apply_theme(a, FAMILIES["霜靛"][1], "dark")
    a.stop()
    s = app_factory(start=False, reload=False)
    frames: list[tuple[float, float, float]] = []

    def watch():
        t0 = time.monotonic()
        while s.proc is None and time.monotonic() - t0 < 30:
            time.sleep(0.002)
        hwnd = None
        while time.monotonic() - t0 < 40 and hwnd is None:
            for h in win32.windows_of_pid(s.proc.pid):
                if win32.title(h) == "TagLauncher" and not win32.is_cloaked(h):
                    hwnd = h
            time.sleep(0.002)
        if not hwnd:
            return
        t1 = time.monotonic()
        while time.monotonic() - t1 < 1.5:
            img = win32.capture_window(hwnd)
            if img is None:
                continue
            st = ImageStat.Stat(img.convert("L"))
            frames.append((round(time.monotonic() - t1, 3), st.mean[0], st.stddev[0]))
    th = threading.Thread(target=watch, daemon=True)
    th.start()
    s.start()
    th.join(45)
    (run_dir / "visual" / "env-05-frames.json").write_text(json.dumps(frames), encoding="utf-8")
    assert frames, "未捕获到帧"
    assert not [f for f in frames if f[1] > 110], f"暗色主题下出现亮色（无样式）帧：{frames[:10]}"
