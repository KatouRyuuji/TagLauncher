"""视觉层：截图 + 本地基线对比（Pillow）。

- 基线只在本机：e2e/visual/baselines/<name>.png（不入库，见 .gitignore 说明）。
- 无基线时首次运行写入基线并通过（报告里记为 baseline-created）。
- 设了 CI 环境变量：只截图存入 run_dir/visual，不对比。
- 不接管鼠标键盘：窗口尺寸用 SetWindowPos 设定。
"""
from __future__ import annotations

import os
import shutil
from pathlib import Path

import pytest

from harness import files
from harness.paths import E2E
from harness.stealth import OFFSCREEN
from win import win32

BASELINES = Path(os.environ.get("TL_E2E_BASELINES", E2E / "visual" / "baselines"))
THRESHOLD = float(os.environ.get("TL_E2E_VIS_THRESHOLD", "0.005"))  # 差异像素占比
PIXEL_TOL = 24  # 单通道差 ≤ 24 视为相同（抗锯齿/字体微差）

FREEZE_CSS = ("*,*::before,*::after{animation:none!important;transition:none!important;"
              "caret-color:transparent!important;scroll-behavior:auto!important}")

SEED = ["设计稿.png", "季度报告.docx", "会议纪要.md", "预算表.xlsx", "演示视频.mp4", "源码.zip", "说明.txt", "脚本.ps1"]


def set_client_size(app, w: int, h: int) -> None:
    hwnd = win32.main_window(app.proc.pid)
    if win32.is_zoomed(hwnd) or win32.is_iconic(hwnd):
        win32.show(hwnd, 4)  # SW_SHOWNOACTIVATE：还原但不激活
    scale = win32.dpi_of(hwnd) / 96
    pw, ph = round(w * scale), round(h * scale)
    # 留在屏幕外（harness.stealth），只改尺寸
    win32.move_window(hwnd, *OFFSCREEN, pw, ph)
    for _ in range(3):  # 外框与客户区可能有差值：按客户区校正
        app.page.wait_for_timeout(250)
        cw, ch = win32.client_size(hwnd)
        if (cw, ch) == (pw, ph):
            break
        l, t, r, b = win32.rect(hwnd)
        win32.move_window(hwnd, l, t, (r - l) + pw - cw, (b - t) + ph - ch)
    app.page.wait_for_function(f"() => Math.abs(innerWidth - {w}) <= 1 && Math.abs(innerHeight - {h}) <= 1",
                               timeout=5000)


def seed_library(app, sandbox) -> None:
    root = sandbox.files / "vis"
    paths = []
    for n in SEED:
        data = files.png_bytes(16, 12) if n.endswith(".png") else f"{n}\n"
        paths.append(files.write(root / n, data))
    app.seed(paths)
    a = app.add_tag("设计", "#3b82f6")
    b = app.add_tag("财务", "#10b981")
    app.invoke("set_item_tags", {"itemId": app.item("设计稿.png")["id"], "tagIds": [a]})
    app.invoke("set_item_tags", {"itemId": app.item("预算表.xlsx")["id"], "tagIds": [b, a]})


def settle(app) -> None:
    app.page.add_style_tag(content=FREEZE_CSS)
    app.page.mouse.move(1, 1)
    app.page.evaluate("async () => { document.activeElement && document.activeElement.blur && document.activeElement.blur();"
                      " await document.fonts.ready;"
                      " await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }")
    app.page.wait_for_timeout(300)


def diff_ratio(a: Path, b: Path) -> float:
    from PIL import Image, ImageChops
    ia, ib = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    if ia.size != ib.size:
        return 1.0
    d = ImageChops.difference(ia, ib).convert("L").point(lambda v: 255 if v > PIXEL_TOL else 0)
    return sum(d.histogram()[255:]) / (ia.size[0] * ia.size[1])


@pytest.fixture
def snap(app, run_dir, request):
    out = run_dir / "visual"
    out.mkdir(parents=True, exist_ok=True)

    def take(name: str, mask=None) -> dict:
        settle(app)
        shot = out / f"{name}.png"
        app.page.screenshot(path=str(shot), animations="disabled", mask=mask or [])
        res = {"name": name, "shot": str(shot)}
        if os.environ.get("CI"):
            res["mode"] = "ci-upload-only"
        else:
            base = BASELINES / f"{name}.png"
            if not base.exists():
                base.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(shot, base)
                res["mode"] = "baseline-created"
            else:
                ratio = diff_ratio(shot, base)
                res.update(mode="compared", ratio=round(ratio, 5))
                if ratio > THRESHOLD:
                    from PIL import Image, ImageChops
                    ImageChops.difference(Image.open(shot).convert("RGB"), Image.open(base).convert("RGB")).save(
                        out / f"{name}.diff.png")
        request.node.user_properties.append(("visual", res))
        return res

    return take
