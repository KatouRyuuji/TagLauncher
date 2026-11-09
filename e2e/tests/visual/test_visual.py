"""视觉层（E-VIS-01/02/08/10、E-TH-07）。"""
from __future__ import annotations

import threading
import time

import pytest

from harness.app import wait_until
from win import win32

from .conftest import THRESHOLD, seed_library, set_client_size

FAMILIES = {
    "霜靛": ("7f47aab2-74bb-4c77-b99b-550f0acf3c9c", "8cebf811-9b9d-4c49-ac9f-1d1fa685ce93"),
    "藤色": ("668e5856-9d9f-481a-8f82-325372d2e256", "65596bf6-3aaf-4322-93f2-bbb60cb94b5d"),
    "樱花": ("70492696-751c-4a29-9ab4-09ad8ddff1a4", "ad9b379f-0f3d-45e3-8b55-bf077b4ab97a"),
    "素墨": ("f04d4499-8a9c-4c84-b7d1-73574fc98f9e", "2db7495f-a084-4f7d-ae6d-d06258dc0e3c"),
}
VARIANTS = [(fam, mode, ids[i]) for fam, ids in FAMILIES.items() for i, mode in enumerate(("light", "dark"))]


def apply_theme(app, theme_id: str, mode: str) -> None:
    # 亮/暗是独立偏好（localStorage taglauncher.color-mode），启动时会把官方家族主题按它重解析
    app.invoke("set_current_theme", {"themeId": theme_id})
    app.page.evaluate("m => localStorage.setItem('taglauncher.color-mode', m)", mode)
    app.reload_page()
    wait_until(lambda: app.page.evaluate("document.documentElement.dataset.scheme") == mode, 8,
               lambda: app.page.evaluate("document.documentElement.dataset.scheme"))


def check(res):
    if res.get("mode") == "compared":
        assert res["ratio"] <= THRESHOLD, f"{res['name']} 与基线差异 {res['ratio']:.3%} > {THRESHOLD:.1%}（见 .diff.png）"


@pytest.mark.case("E-VIS-01", "E-VIS-02")
def test_main_views_all_themes(app, sandbox, snap):
    seed_library(app, sandbox)
    set_client_size(app, 1200, 800)
    results = []
    for fam, mode, tid in VARIANTS:
        apply_theme(app, tid, mode)
        for label, key in (("网格视图", "grid"), ("列表视图", "list")):
            app.page.get_by_role("button", name=label, exact=True).click()
            app.page.wait_for_timeout(300)
            results.append(snap(f"vis-{key}-{fam}-{mode}"))
    bad = [r for r in results if r.get("mode") == "compared" and r["ratio"] > THRESHOLD]
    assert not bad, bad


@pytest.mark.case("E-VIS-08", "E-WIN-19")
@pytest.mark.parametrize("size", [
    pytest.param((800, 600), id="800x600"),  # BUG-04 回归：最小窗口下搜索框仍可用
    pytest.param((1200, 800), id="1200x800"),
    pytest.param((1920, 1080), id="1920x1080"),
])
def test_window_sizes(app, sandbox, snap, size):
    w, h = size
    hwnd = win32.main_window(app.proc.pid)
    work = win32.monitor_info(hwnd)["work"]
    scale = win32.dpi_of(hwnd) / 96
    if (work[2] - work[0]) < w * scale or (work[3] - work[1]) < h * scale:
        pytest.skip(f"显示器工作区不足 {w}×{h} 逻辑像素（scale={scale}）")
    seed_library(app, sandbox)
    set_client_size(app, w, h)
    apply_theme(app, FAMILIES["霜靛"][0], "light")
    set_client_size(app, w, h)
    # E-WIN-19：主要区域互不重叠、关键按钮可见
    boxes = app.page.evaluate("""() => Object.fromEntries([...document.querySelectorAll('[data-region]')]
        .filter(e => ['titlebar','sidebar','statusbar'].includes(e.dataset.region))
        .map(e => { const r = e.getBoundingClientRect(); return [e.dataset.region, [r.left, r.top, r.right, r.bottom]]; }))""")
    tb, sb_ = boxes.get("titlebar"), boxes.get("statusbar")
    assert tb, boxes
    if sb_:
        assert tb[3] <= sb_[1] + 0.5, boxes
    if boxes.get("sidebar"):
        assert boxes["sidebar"][1] >= tb[3] - 0.5, boxes
    for name in ("设置", "添加文件或文件夹"):
        assert app.page.get_by_role("button", name=name, exact=True).is_visible(), name
    sbox = app.page.locator("#workspace-search").bounding_box()
    assert sbox and sbox["width"] >= 120, f"搜索框宽度不足：{sbox}"
    overflow = app.page.evaluate("document.documentElement.scrollWidth - innerWidth")
    assert overflow <= 0, f"横向溢出 {overflow}px"
    check(snap(f"vis-size-{w}x{h}"))


CONTRAST_JS = """() => {
  const cs = getComputedStyle(document.documentElement);
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const g = cv.getContext('2d', {willReadFrequently: true});
  const px = (layers) => { g.clearRect(0,0,1,1); for (const c of layers) { g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0,0,1,1); }
    const d = g.getImageData(0,0,1,1).data; return [d[0], d[1], d[2]]; };
  const v = (n) => cs.getPropertyValue(n).trim();
  const lum = ([r,g2,b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055) ** 2.4; };
    return 0.2126*f(r) + 0.7152*f(g2) + 0.0722*f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const base = v('--bg-base');
  const out = {};
  for (const bg of ['--bg-base', '--bg-surface', '--bg-card', '--bg-elevated']) {
    if (!v(bg)) continue;
    const bgc = px([base, v(bg)]);
    for (const fg of ['--text-primary', '--text-secondary', '--text-muted', '--text-faint']) {
      if (!v(fg)) continue;
      out[fg + ' on ' + bg] = Math.round(ratio(px([base, v(bg), v(fg)]), bgc) * 100) / 100;
    }
  }
  return out;
}"""


@pytest.mark.case("E-VIS-10")
def test_contrast_tokens(app, run_dir):
    """正文 primary/secondary 在各背景上 ≥ 4.5:1；muted 记录并按 4.5 断言；faint 属装饰性只记录。"""
    report, bad = {}, []
    for fam, mode, tid in VARIANTS:
        apply_theme(app, tid, mode)
        vals = app.page.evaluate(CONTRAST_JS)
        report[f"{fam}-{mode}"] = vals
        for k, ratio in vals.items():
            if k.startswith("--text-faint"):
                continue
            if ratio < 4.5:
                bad.append((f"{fam}-{mode}", k, ratio))
    import json
    (run_dir / "visual").mkdir(parents=True, exist_ok=True)
    (run_dir / "visual" / "contrast.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    assert not bad, f"对比度不足 4.5:1：{bad}"


@pytest.mark.case("E-TH-07")
def test_theme_first_frame_no_flash(app_factory, sandbox, run_dir):
    """设暗色樱花后重启：窗口首次可见（且 DWM 已合成）的若干帧即为暗色。

    用 PrintWindow 抓窗口自身内容：阶段一用屏幕抓取，窗口刚 show 尚未合成时会截到后面别的窗口
    （亮色桌面/其他程序），造成「首帧白闪」误报（候选 BUG-07 → 测试侧问题），且会截到用户其他窗口内容。
    """
    from PIL import ImageStat
    (run_dir / "visual").mkdir(parents=True, exist_ok=True)
    app = app_factory()
    seed_library(app, sandbox)
    apply_theme(app, FAMILIES["樱花"][1], "dark")
    app.stop()

    s = app_factory(start=False, reload=False)
    frames: list[tuple[float, float]] = []

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
        while time.monotonic() - t1 < 0.6:
            img = win32.capture_window(hwnd)
            if img is None:
                continue
            frames.append((round(time.monotonic() - t1, 3), ImageStat.Stat(img.convert("L")).mean[0]))
            if len(frames) == 1:
                img.save(run_dir / "visual" / "th-07-first-frame.png")
    th = threading.Thread(target=watch, daemon=True)
    th.start()
    s.start()
    th.join(45)
    assert frames, "未捕获到首帧"
    assert app.page is None
    assert s.page.evaluate("document.documentElement.dataset.scheme") == "dark"
    bright = [f for f in frames if f[1] > 110]
    assert not bright, f"首次显示的帧出现亮色（平均亮度>110）：{frames}"
