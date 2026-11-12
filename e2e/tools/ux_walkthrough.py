#!/usr/bin/env python3
"""1.10.0-beta UX 走查：在 Windows 交互桌面驱动官方 release 便携版并 gdigrab 录屏。

仅用于临时分支 cursor/ux-walkthrough-8f3b，不合入 main。
"""
from __future__ import annotations

import ctypes
import json
import os
import shutil
import subprocess
import sys
import time
import threading
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harness import files
from harness.app import AppSession, wait_until
from harness.integrity import RealDirGuard
from harness.paths import TMP, default_exe
from harness.sandbox import Sandbox
from playwright.sync_api import sync_playwright
from win import win32

# --------------------------------------------------------------------------- 常量
OUT = Path(os.environ.get("UX_OUT", Path("/workspace/ux-review-1.10.0") if os.name != "nt" else "ux-review-1.10.0"))
HOTKEY_QUICK = "Ctrl+Alt+Shift+Q"
THEME_LIGHT = "7f47aab2-74bb-4c77-b99b-550f0acf3c9c"
THEME_DARK = "8cebf811-9b9d-4c49-ac9f-1d1fa685ce93"
WIN = 1600, 960
WIN_POS = 160, 50

CHAPTERS_META = [
    (1, "主窗总览", "视图切换、排序与筛选"),
    (2, "标签", "子标签、Ctrl+T 打标、拖动改层级、当前层搜索"),
    (3, "文件柜", "嵌套、拖入子柜、含子柜与仅本柜"),
    (4, "导入文件夹", "添加文件夹与导入方式"),
    (5, "快速搜索窗", "全局热键唤出与搜索"),
    (6, "收纳", "资源管理器右键与收纳页"),
    (7, "钉住视图", "浮动窗与边缘抽屉"),
    (8, "设置", "桌面驻留、主题与其它区块"),
    (9, "主题、字号与 DPI", "浅色与深色、特大字号、150% 缩放"),
]

VK_CONTROL, VK_MENU, VK_SHIFT, VK_ESCAPE = 0x11, 0x12, 0x10, 0x1B
VK_RETURN, VK_TAB, VK_F = 0x0D, 0x09, 0x46

# --------------------------------------------------------------------------- 工具
log_fp = None


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    if log_fp:
        log_fp.write(line + "\n")
        log_fp.flush()


def pause(s: float = 1.2) -> None:
    time.sleep(s)


def find_font() -> str | None:
    candidates = [
        Path("tools/fonts/NotoSansSC-VF.ttf"),
        Path(r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\msyhbd.ttc"),
        Path(r"C:\Windows\Fonts\simhei.ttf"),
        Path(r"C:\Windows\Fonts\simsun.ttc"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
    ]
    for p in candidates:
        if p.exists() and p.stat().st_size > 1000:
            return str(p.resolve())
    return None


def ff_font(path: str) -> str:
    # ffmpeg filter 里冒号是分隔符，Windows 盘符要转义
    return path.replace("\\", "/").replace(":", "\\:")


class Recorder:
    def __init__(self, raw: Path):
        self.raw = raw
        self.proc: subprocess.Popen | None = None
        self.t0: float | None = None
        self.backend = "gdigrab"
        self.marks: list[tuple[float, int, str, str]] = []

    def start(self) -> None:
        self.raw.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            "ffmpeg", "-y", "-f", "gdigrab", "-framerate", "30",
            "-draw_mouse", "1", "-i", "desktop",
            "-thread_queue_size", "4096",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
            "-pix_fmt", "yuv420p", "-an", str(self.raw),
        ]
        log("ffmpeg " + " ".join(cmd))
        self.proc = subprocess.Popen(
            cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        time.sleep(1.5)
        if self.proc.poll() is not None:
            err = (self.proc.stderr.read() if self.proc.stderr else b"").decode("utf-8", "replace")
            log(f"gdigrab 启动失败，改用逐帧桌面截图合成：{err[-2000:]}")
            self.proc = None
            self.start_fallback()
            return
        self.t0 = time.monotonic()
        log("recording started (gdigrab)")

    def elapsed(self) -> float:
        return 0 if self.t0 is None else time.monotonic() - self.t0

    def mark(self, n: int, title: str, subtitle: str) -> None:
        t = self.elapsed()
        self.marks.append((t, n, title, subtitle))
        log(f"CHAPTER {n} t={t:.1f}s {title}")

    def _frame_loop(self) -> None:
        i = 0
        self.frames_dir.mkdir(parents=True, exist_ok=True)
        while not self._stop_frames.is_set():
            dest = self.frames_dir / f"f{i:05d}.jpg"
            try:
                from PIL import ImageGrab
                ImageGrab.grab().convert("RGB").save(dest, "JPEG", quality=85)
            except Exception as e:
                log(f"fallback frame {i}: {e}")
            i += 1
            self._stop_frames.wait(0.2)  # 5 fps

    def start_fallback(self) -> None:
        self.backend = "screenshot-fallback"
        self.frames_dir = self.raw.parent / "frames"
        self._stop_frames = threading.Event()
        self._thread = threading.Thread(target=self._frame_loop, daemon=True)
        self._thread.start()
        self.t0 = time.monotonic()
        log("recording started (screenshot fallback 5fps)")

    def encode_fallback(self) -> None:
        frames = sorted(self.frames_dir.glob("f*.jpg")) if hasattr(self, "frames_dir") else []
        if not frames:
            log("fallback: no frames")
            return
        lst = self.frames_dir / "list.txt"
        # 每张 0.2s
        lines = []
        for f in frames:
            lines.append(f"file '{f.resolve().as_posix()}'")
            lines.append("duration 0.2")
        lines.append(f"file '{frames[-1].resolve().as_posix()}'")
        lst.write_text(chr(10).join(lines) + chr(10), encoding="utf-8")
        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
             "-pix_fmt", "yuv420p", "-r", "30", "-an", str(self.raw)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        log(f"fallback encoded {len(frames)} frames -> {self.raw} {self.raw.stat().st_size}")

    def stop(self) -> None:
        if getattr(self, "_thread", None):
            self._stop_frames.set()
            self._thread.join(timeout=15)
            try:
                self.encode_fallback()
            except Exception:
                log("fallback encode failed\n" + traceback.format_exc())
        if not self.proc or self.proc.poll() is not None:
            if self.proc:
                log(f"recording already ended rc={self.proc.returncode}")
            return
        try:
            self.proc.stdin.write(b"q")
            self.proc.stdin.flush()
            self.proc.wait(timeout=40)
        except Exception:
            self.proc.kill()
        log(f"recording stopped rc={self.proc.returncode} size={self.raw.stat().st_size if self.raw.exists() else 0}")


# --------------------------------------------------------------------------- 鼠标（系统级，录屏可见）
def move_slow(x: int, y: int, sec: float = 0.55) -> None:
    x0, y0 = win32.cursor_pos()
    steps = max(10, int(sec * 36))
    for i in range(1, steps + 1):
        win32.mouse_move(round(x0 + (x - x0) * i / steps), round(y0 + (y - y0) * i / steps))
        time.sleep(sec / steps)


def client_xy(hwnd: int, locator, frac=(0.5, 0.5)) -> tuple[int, int]:
    bb = locator.bounding_box()
    if not bb:
        raise RuntimeError("元素没有 bounding_box")
    ox, oy = win32.client_origin(hwnd)
    return int(ox + bb["x"] + bb["width"] * frac[0]), int(oy + bb["y"] + bb["height"] * frac[1])


def click_el(hwnd: int, locator, hold: float = 1.15, frac=(0.5, 0.5), right: bool = False) -> None:
    x, y = client_xy(hwnd, locator, frac)
    move_slow(x, y)
    pause(0.15)
    if right:
        # 与 oswin.right_click 相同
        from ctypes import wintypes
        class MOUSEINPUT(ctypes.Structure):
            _fields_ = [("dx", ctypes.c_long), ("dy", ctypes.c_long), ("mouseData", wintypes.DWORD),
                        ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]
        # 用已有 win32
        win32.mouse_move(x, y)
        # right down/up via win32 — 没有现成 right_click，用 SendInput 封装在 oswin
        try:
            from tests.desktop import oswin
            oswin.right_click(x, y)
        except Exception:
            win32.click(x, y)
    else:
        win32.click(x, y)
    pause(hold)


def drag_el(hwnd: int, src, dst, src_frac=(0.5, 0.5), dst_frac=(0.5, 0.5), sec: float = 1.1) -> None:
    x0, y0 = client_xy(hwnd, src, src_frac)
    x1, y1 = client_xy(hwnd, dst, dst_frac)
    move_slow(x0, y0, 0.45)
    pause(0.18)
    win32.mouse_down()
    pause(0.15)
    move_slow(x1, y1, sec)
    pause(0.2)
    win32.mouse_up()
    pause(0.6)


def send_keys(*vks: int) -> None:
    for v in vks:
        win32.key(v, up=False)
    time.sleep(0.06)
    for v in reversed(vks):
        win32.key(v, up=True)


def type_text(s: str) -> None:
    # 经剪贴板粘贴，避免 IME 问题（中文）
    try:
        import ctypes.wintypes
        from ctypes import wintypes
        CF_UNICODETEXT = 13
        user32 = ctypes.WinDLL("user32")
        kernel32 = ctypes.WinDLL("kernel32")
        user32.OpenClipboard(None)
        user32.EmptyClipboard()
        data = s.encode("utf-16-le") + b"\x00\x00"
        h = kernel32.GlobalAlloc(0x0002, len(data))
        p = kernel32.GlobalLock(h)
        ctypes.memmove(p, data, len(data))
        kernel32.GlobalUnlock(h)
        user32.SetClipboardData(CF_UNICODETEXT, h)
        user32.CloseClipboard()
        send_keys(VK_CONTROL, 0x56)  # Ctrl+V
        pause(0.3)
    except Exception as e:
        log(f"paste failed: {e}")


# --------------------------------------------------------------------------- 截图 / 后期
def grab_desktop(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # 优先 PIL（Windows 下含光标需另行处理，画面本身完整）
    try:
        from PIL import ImageGrab
        im = ImageGrab.grab()
        im.save(path)
        return
    except Exception as e:
        log(f"ImageGrab: {e}")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "gdigrab", "-draw_mouse", "1", "-i", "desktop", "-frames:v", "1", str(path)],
        check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def page_shot(page, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        page.screenshot(path=str(path), animations="disabled")
    except Exception as e:
        log(f"page screenshot {path.name}: {e}")


def write_chapters_txt(marks: list, duration: float, path: Path) -> None:
    lines = []
    for i, (t, n, title, sub) in enumerate(marks):
        # 每章前面会插入 2s 标题卡，最终时间轴 = 原时间 + 2*(本章及之前章数)
        final = t + 2.0 * (i + 1)
        hh = int(final // 3600)
        mm = int((final % 3600) // 60)
        ss = final % 60
        lines.append(f"{hh:02d}:{mm:02d}:{ss:05.2f}  {n}　{title}  —  {sub}")
    total = duration + 2.0 * len(marks)
    lines.append(f"总时长（含标题卡）约 {total:.1f}s")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def make_title_card(font: str, n: int, title: str, subtitle: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    txt = dest.with_suffix(".txt")
    txt.write_text(f"{n}  {title}\n{subtitle}", encoding="utf-8")
    # textfile 两行不好分别设字号，用一张 Python 图更稳
    from PIL import Image, ImageDraw, ImageFont
    im = Image.new("RGB", (1920, 1080), (22, 25, 35))
    draw = ImageDraw.Draw(im)
    try:
        f1 = ImageFont.truetype(font, 72)
        f2 = ImageFont.truetype(font, 36)
    except Exception:
        f1 = f2 = ImageFont.load_default()
    t1 = f"{n}　　{title}"
    b1 = draw.textbbox((0, 0), t1, font=f1)
    b2 = draw.textbbox((0, 0), subtitle, font=f2)
    draw.text(((1920 - (b1[2] - b1[0])) / 2, 420), t1, font=f1, fill=(245, 247, 250))
    draw.text(((1920 - (b2[2] - b2[0])) / 2, 530), subtitle, font=f2, fill=(160, 170, 185))
    png = dest.with_suffix(".png")
    im.save(png)
    subprocess.run(
        ["ffmpeg", "-y", "-loop", "1", "-i", str(png), "-t", "2", "-r", "30",
         "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-an", str(dest)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def stitch(raw: Path, marks: list, font: str, dest: Path, tmp: Path) -> None:
    if not raw.exists() or raw.stat().st_size < 1000:
        raise RuntimeError("没有可用的原始录像")
    # 探测时长
    probe = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(raw)],
        text=True).strip()
    duration = float(probe or 0)
    log(f"raw duration={duration:.2f}s")
    tmp.mkdir(parents=True, exist_ok=True)
    parts = []
    ends = [marks[i + 1][0] if i + 1 < len(marks) else duration for i in range(len(marks))]
    for i, ((t0, n, title, sub), t1) in enumerate(zip(marks, ends)):
        card = tmp / f"title{n:02d}.mp4"
        seg = tmp / f"ch{n:02d}.mp4"
        make_title_card(font, n, title, sub, card)
        # 切段；最后一章到片尾，各章保留 0.1s 重叠以免丢帧
        a, b = max(0, t0), max(t0 + 0.4, t1)
        subprocess.run(
            ["ffmpeg", "-y", "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-i", str(raw),
             "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p",
             "-r", "30", "-an", str(seg)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        parts += [card, seg]
    lst = tmp / "concat.txt"
    lst.write_text("".join(f"file '{p.resolve().as_posix()}'\n" for p in parts), encoding="utf-8")
    subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst),
         "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart", "-an", str(dest)],
        check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    size = dest.stat().st_size
    log(f"stitched {dest} {size/1e6:.1f}MB")
    if size > 100 * 1024 * 1024:
        slim = dest.with_name(dest.stem + "-slim.mp4")
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(dest), "-c:v", "libx264", "-preset", "medium",
             "-crf", "26", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(slim)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if slim.stat().st_size < size:
            slim.replace(dest)
            log(f"re-encoded to {dest.stat().st_size/1e6:.1f}MB")
    write_chapters_txt(marks, duration, dest.parent / "chapters.txt")


def contact_sheet(shots: Path, dest: Path, font: str | None) -> None:
    from PIL import Image, ImageDraw, ImageFont
    files_ = sorted(p for p in shots.glob("*.png") if p.is_file())
    if not files_:
        return
    # 挑有代表性的，最多 16 张
    prefer = [
        "01-main-overview", "01-main-grid", "01-main-list",
        "02-tags", "03-cabinets", "03-cabinet-nest",
        "04-import", "05-quick", "06-collect",
        "07-pin-float", "07-pin-drawer", "08-settings",
        "09-main-dark", "09-main-xlarge", "09-quick-dark", "09-pin-dark",
    ]
    chosen = []
    for key in prefer:
        for p in files_:
            if key in p.stem and p not in chosen:
                chosen.append(p)
                break
    for p in files_:
        if len(chosen) >= 16:
            break
        if p not in chosen:
            chosen.append(p)
    cols, thumb_w, thumb_h, pad, cap = 4, 460, 280, 16, 36
    rows = (len(chosen) + cols - 1) // cols
    w = cols * thumb_w + (cols + 1) * pad
    h = 80 + rows * (thumb_h + cap + pad) + pad
    im = Image.new("RGB", (w, h), (28, 31, 40))
    draw = ImageDraw.Draw(im)
    try:
        ft = ImageFont.truetype(font, 18) if font else ImageFont.load_default()
        fh = ImageFont.truetype(font, 28) if font else ImageFont.load_default()
    except Exception:
        ft = fh = ImageFont.load_default()
    draw.text((pad, 22), "TagLauncher 1.10.0-beta  ·  UX 走查截图总览", font=fh, fill=(245, 247, 250))
    for i, p in enumerate(chosen):
        r, c = divmod(i, cols)
        x = pad + c * (thumb_w + pad)
        y = 80 + r * (thumb_h + cap + pad)
        try:
            src = Image.open(p).convert("RGB")
            src.thumbnail((thumb_w, thumb_h))
            bg = Image.new("RGB", (thumb_w, thumb_h), (18, 20, 26))
            bg.paste(src, ((thumb_w - src.width) // 2, (thumb_h - src.height) // 2))
            im.paste(bg, (x, y))
        except Exception as e:
            log(f"sheet {p.name}: {e}")
        draw.text((x, y + thumb_h + 6), p.stem[:48], font=ft, fill=(180, 188, 200))
    im.save(dest, quality=95)
    log(f"contact sheet {dest} {dest.stat().st_size}")


# --------------------------------------------------------------------------- 演示数据
def seed_library(app: AppSession, sb: Sandbox) -> dict:
    root = sb.files / "工作室"
    items = {
        "设计/海报-春季活动-最终确认-请勿再改.png": files.png_bytes(48, 36, (200, 70, 80)),
        "设计/品牌VI手册-第三版.pdf": b"%PDF-1.4 demo",
        "设计/图标-应用启动器-1024.png": files.png_bytes(32, 32, (70, 120, 200)),
        "设计/插画-封面候选-A.png": files.png_bytes(40, 50, (90, 160, 130)),
        "文档/会议纪要-2026年11月产品评审.md": "# 会议纪要\n春季活动进度。",
        "文档/需求说明-钉住视图.md": "# 钉住视图需求",
        "文档/季度报告-Q3-市场与产品.docx": "docx-placeholder",
        "文档/README-给客户看的说明.txt": "这是一份说明。",
        "财务/预算表-2026年度.xlsx": "xlsx",
        "财务/发票-某某科技-已付款.pdf": b"%PDF-1.4 inv",
        "合同/服务合同-某某科技有限公司-已盖章.pdf": b"%PDF-1.4 c",
        "脚本/备份数据库.bat": "@echo off\necho backup\n",
        "脚本/部署到测试环境.bat": "@echo off\necho deploy\n",
        "网址/公司官网.url": "[InternetShortcut]\nURL=https://example.com\n",
        "网址/设计灵感.url": "[InternetShortcut]\nURL=https://dribbble.com\n",
        "音频/演示配音-初稿.wav": files.wav_bytes(400),
        "笔记/灵感碎片-2026-11.txt": "把抽屉把手做成原生窗口。",
        "笔记/待办-下周发布.md": "- 发 beta\n- 走查 UI",
    }
    # 再补一批短名，让库看起来更满
    extras = [f"素材/参考图-{i:02d}.png" for i in range(1, 13)] + [
        f"文档/周报-第{i}周.md" for i in range(1, 7)
    ]
    paths = []
    for rel, content in items.items():
        paths.append(files.write(root / rel, content))
    for rel in extras:
        paths.append(files.write(root / rel, files.png_bytes(16, 12) if rel.endswith(".png") else rel))
    app.seed(paths)
    # 标签树
    work = app.add_tag("工作", "#3b82f6")
    doing = app.add_tag("进行中", "#22c55e")
    done = app.add_tag("已归档", "#64748b")
    wait = app.add_tag("待客户确认", "#f59e0b")
    design = app.add_tag("设计", "#a855f7")
    finance = app.add_tag("财务", "#14b8a6")
    personal = app.add_tag("个人", "#fb7185")
    long_tag = app.add_tag("报告与总结（很长的标签名用来检查截断）", "#10b981")
    for child in (doing, done, wait, design):
        app.invoke("add_tag_relation", {"parentId": work, "childId": child})
    app.invoke("add_tag_relation", {"parentId": work, "childId": long_tag})
    # 文件柜嵌套（预置一棵树，走查时再现场拖一次）
    c_work = app.invoke("add_cabinet", {"name": "工作台", "color": "#3b82f6"})["id"]
    c_2026 = app.invoke("add_cabinet", {"name": "2026 项目", "color": "#22c55e"})["id"]
    c_spring = app.invoke("add_cabinet", {"name": "春季活动", "color": "#f59e0b"})["id"]
    c_archive = app.invoke("add_cabinet", {"name": "归档", "color": "#64748b"})["id"]
    c_assets = app.invoke("add_cabinet", {"name": "素材库", "color": "#a855f7"})["id"]
    app.invoke("set_cabinet_parent", {"id": c_2026, "parentId": c_work})
    app.invoke("set_cabinet_parent", {"id": c_spring, "parentId": c_2026})
    app.invoke("set_cabinet_parent", {"id": c_archive, "parentId": c_work})

    def iid(name):
        return app.item(name)["id"]

    def tag(*names, tags):
        for n in names:
            try:
                app.invoke("set_item_tags", {"itemId": iid(n), "tagIds": list(tags)})
            except Exception as e:
                log(f"tag {n}: {e}")

    tag("海报-春季活动-最终确认-请勿再改.png", "品牌VI手册-第三版.pdf", "图标-应用启动器-1024.png",
        tags=[work, design, doing])
    tag("会议纪要-2026年11月产品评审.md", "季度报告-Q3-市场与产品.docx",
        tags=[work, long_tag])
    tag("预算表-2026年度.xlsx", "发票-某某科技-已付款.pdf", tags=[finance, work])
    tag("灵感碎片-2026-11.txt", tags=[personal])
    try:
        app.invoke("add_items_to_cabinet", {
            "cabinetId": c_spring,
            "itemIds": [iid("海报-春季活动-最终确认-请勿再改.png"), iid("会议纪要-2026年11月产品评审.md")],
        })
        app.invoke("add_items_to_cabinet", {
            "cabinetId": c_assets,
            "itemIds": [iid(f"参考图-{i:02d}.png") for i in range(1, 9)],
        })
        app.invoke("add_items_to_cabinet", {
            "cabinetId": c_archive,
            "itemIds": [iid("季度报告-Q3-市场与产品.docx")],
        })
    except Exception as e:
        log(f"cabinet seed: {e}")
    # 显示别名
    try:
        app.invoke("set_item_alias", {"id": iid("备份数据库.bat"), "alias": "一键备份"})
    except Exception as e:
        log(f"alias: {e}")
    app.reload_page()
    return {"work": work, "doing": doing, "c_work": c_work, "c_assets": c_assets, "c_spring": c_spring}


# --------------------------------------------------------------------------- 走查
class Walk:
    def __init__(self, app: AppSession, sb: Sandbox, rec: Recorder, shots: Path):
        self.app = app
        self.sb = sb
        self.rec = rec
        self.shots = shots
        self.shots.mkdir(parents=True, exist_ok=True)
        self.hwnd = 0
        self.done: list[str] = []
        self.failed: list[str] = []
        self.shown: list[str] = []

    def refresh_hwnd(self) -> int:
        self.hwnd = win32.main_window(self.app.proc.pid, timeout=15, visible=True)
        return self.hwnd

    def place(self) -> None:
        h = self.refresh_hwnd()
        win32.set_foreground(h)
        win32.move_window(h, WIN_POS[0], WIN_POS[1], WIN[0], WIN[1])
        pause(0.6)
        self.refresh_hwnd()

    def shot(self, name: str, page=None) -> Path:
        p = self.shots / f"{name}.png"
        grab_desktop(p)
        if page is not None:
            page_shot(page, self.shots / f"{name}-page.png")
        elif self.app.page:
            page_shot(self.app.page, self.shots / f"{name}-page.png")
        log(f"shot {p.name}")
        return p

    def chapter(self, n: int) -> None:
        meta = CHAPTERS_META[n - 1]
        self.rec.mark(n, meta[1], meta[2])
        pause(0.6)

    def click(self, loc, hold=1.2, **kw):
        self.refresh_hwnd()
        click_el(self.hwnd, loc, hold=hold, **kw)

    def step(self, name, fn):
        try:
            fn()
            self.done.append(name)
            self.shown.append(name)
            log(f"OK {name}")
        except Exception as e:
            self.failed.append(f"{name}: {e}")
            log(f"FAIL {name}: {e}\n{traceback.format_exc()}")
            try:
                self.shot(f"fail-{name}")
            except Exception:
                pass

    # ----- chapters -----
    def ch1(self):
        self.chapter(1)
        pg = self.app.page
        self.place()
        pause(1.6)
        self.shot("01-main-overview-light-f1")
        for label, name in (
            ("网格视图", "01-main-grid-light-f1"),
            ("大图标视图", "01-main-large-light-f1"),
            ("列表视图", "01-main-list-light-f1"),
        ):
            btn = pg.get_by_role("button", name=label, exact=True)
            if btn.count():
                self.click(btn.first)
                pause(1.4)
                self.shot(name)
        try:
            sort_btn = pg.get_by_role("button", name="排序方式")
            if sort_btn.count():
                self.click(sort_btn.first)
                pause(1.2)
                self.shot("01-main-sort-menu-light-f1")
                opt = pg.get_by_role("listbox", name="排序方式").get_by_role("option", name="名称", exact=False)
                if opt.count():
                    self.click(opt.first)
                    pause(1.2)
                    self.shot("01-main-sorted-name-light-f1")
        except Exception as e:
            log(f"sort: {e}")
        try:
            filt = pg.get_by_role("button", name="筛选类型与搜索范围")
            if filt.count():
                self.click(filt.first)
                pause(1.5)
                self.shot("01-main-filter-open-light-f1")
                send_keys(VK_ESCAPE)
                pause(0.6)
        except Exception as e:
            log(f"filter: {e}")
        box = pg.locator("#workspace-search")
        self.click(box, hold=0.5)
        type_text("报告")
        pause(1.6)
        self.shot("01-main-search-light-f1")
        box.fill("")
        pause(1.0)
        # 回到网格，后面章节更像日常用法
        grid = pg.get_by_role("button", name="网格视图", exact=True)
        if grid.count():
            self.click(grid.first, hold=0.8)

    def ch2(self):
        self.chapter(2)
        pg = self.app.page
        self.app.sidebar_tab("标签")
        pause(1.2)
        self.shot("02-tags-sidebar-light-f1")
        # 新建子标签（UI）
        btn = pg.get_by_role("button", name="新建标签")
        if btn.count():
            self.click(btn.first)
            dlg = self.app.dialog("新建标签")
            pause(0.8)
            dlg.get_by_placeholder("标签名称").fill("紧急")
            pause(0.8)
            radios = dlg.get_by_role("radiogroup", name="分类颜色").get_by_role("radio")
            if radios.count() > 3:
                self.click(radios.nth(3), hold=0.6)
            self.shot("02-tags-create-dialog-light-f1")
            self.click(dlg.get_by_role("button", name="保存"))
            pause(1.2)
        # Ctrl+T 打标
        try:
            self.app.sidebar_tab("标签")
            pg.locator("aside").get_by_text("全部项目", exact=True).first.click()
            pause(0.6)
            self.app.select_card("会议纪要-2026年11月产品评审.md")
            pause(0.5)
            self.refresh_hwnd()
            win32.set_foreground(self.hwnd)
            send_keys(VK_CONTROL, 0x54)  # Ctrl+T
            pause(1.2)
            self.shot("02-tags-ctrl-t-light-f1")
            send_keys(VK_ESCAPE)
            pause(0.5)
        except Exception as e:
            log(f"ctrl+t: {e}")
        # 编辑层级拖动
        toggle = pg.get_by_test_id("tag-hierarchy-edit")
        if toggle.count():
            self.click(toggle)
            pause(1.0)
            self.shot("02-tags-hierarchy-edit-light-f1")
            ids = self.app.tag_ids()
            if "紧急" in ids and "工作" in ids:
                src = pg.locator(f'[data-tag-row-id="{ids["紧急"]}"][data-tag-parent-id=""]').first
                dst = pg.locator(f'[data-tag-row-id="{ids["工作"]}"]').first
                if src.count() and dst.count():
                    self.refresh_hwnd()
                    drag_el(self.hwnd, src, dst, sec=1.3)
                    pause(1.4)
                    self.shot("02-tags-drag-hierarchy-light-f1")
            self.click(toggle, hold=0.8)
        # 当前层搜索
        try:
            self.app.sidebar_tag("工作").click()
            pause(1.0)
            search = pg.get_by_role("searchbox", name="搜索项目")
            if search.count():
                self.click(search)
                type_text("报告")
                pause(1.5)
                self.shot("02-tags-scope-search-light-f1")
                search.fill("")
        except Exception as e:
            log(f"scope search: {e}")

    def ch3(self):
        self.chapter(3)
        pg = self.app.page
        self.app.sidebar_tab("文件柜")
        pause(1.2)
        self.shot("03-cabinets-tree-light-f1")
        # 点「工作台」看含子柜
        row = pg.locator("[data-drop-item-cabinet-id]").filter(has=pg.get_by_text("工作台", exact=True)).first
        if row.count():
            self.click(row)
            pause(1.5)
            self.shot("03-cabinets-parent-view-light-f1")
            tog = pg.get_by_test_id("cabinet-only-self")
            if tog.count():
                self.click(tog)
                pause(1.5)
                self.shot("03-cabinets-only-self-light-f1")
                self.click(tog)
                pause(1.0)
        # 现场拖「素材库」进「工作台」
        src = pg.locator("[data-drop-item-cabinet-id]").filter(has=pg.get_by_text("素材库", exact=True)).first
        dst = pg.locator("[data-drop-item-cabinet-id]").filter(has=pg.get_by_text("工作台", exact=True)).first
        if src.count() and dst.count():
            self.refresh_hwnd()
            drag_el(self.hwnd, src, dst, dst_frac=(0.5, 0.5), sec=1.4)
            pause(1.5)
            self.shot("03-cabinets-drag-into-light-f1")

    def ch4(self):
        self.chapter(4)
        pg = self.app.page
        folder = self.sb.files / "导入示例" / "客户资料"
        files.write(folder / "报价单-2026.xlsx", "x")
        files.write(folder / "设计需求.docx", "x")
        files.write(folder / "子目录" / "附件说明.txt", "x")
        # 桩掉系统文件选择框（原生 picker 无法在 runner 上稳定演示），
        # 应用内「添加文件夹」导入方式对话框才是产品 UX。
        self.app.stub("plugin:dialog|open", [str(folder)])
        add = pg.get_by_role("button", name="添加文件或文件夹")
        if add.count():
            self.click(add.first)
            pause(0.7)
            item = pg.get_by_role("menu", name="添加").get_by_role("menuitem", name="添加文件夹…")
            if item.count():
                self.click(item)
            pause(1.2)
            dlg = self.app.dialog("添加文件夹")
            self.shot("04-import-dialog-light-f1")
            radio = dlg.get_by_role("radio", name="两者都加入")
            if radio.count():
                self.click(radio)
                pause(0.8)
            self.shot("04-import-mode-both-light-f1")
            self.click(dlg.get_by_role("button", name="添加", exact=True))
            pause(1.6)
            self.shot("04-import-done-light-f1")
        # 上下文导入：先进入「春季活动」柜，再添加文件夹，对话框应带上当前柜上下文
        ctx_folder = self.sb.files / "导入示例" / "春季活动补充"
        files.write(ctx_folder / "场地平面图.png", files.png_bytes(20, 16, (80, 90, 160)))
        files.write(ctx_folder / "嘉宾名单.xlsx", "x")
        try:
            self.app.sidebar_tab("文件柜")
            pause(0.6)
            row = pg.locator("[data-drop-item-cabinet-id]").filter(has=pg.get_by_text("春季活动", exact=True)).first
            if row.count():
                self.click(row)
                pause(1.0)
            self.app.stub("plugin:dialog|open", [str(ctx_folder)])
            add = pg.get_by_role("button", name="添加文件或文件夹")
            if add.count():
                self.click(add.first)
                pause(0.6)
                item = pg.get_by_role("menu", name="添加").get_by_role("menuitem", name="添加文件夹…")
                if item.count():
                    self.click(item)
                pause(1.2)
                dlg = self.app.dialog("添加文件夹")
                self.shot("04-import-contextual-dialog-light-f1")
                radio = dlg.get_by_role("radio", name="只加入里面的文件")
                if radio.count():
                    self.click(radio)
                    pause(0.8)
                self.shot("04-import-contextual-mode-light-f1")
                self.click(dlg.get_by_role("button", name="添加", exact=True))
                pause(1.6)
                self.shot("04-import-contextual-done-light-f1")
        except Exception as e:
            log(f"contextual import: {e}")

    def ch5(self):
        self.chapter(5)
        s = self.app.invoke("set_hotkey", {"action": "open_quick", "shortcut": HOTKEY_QUICK})
        log(f"hotkey {s}")
        pause(0.6)
        self.refresh_hwnd()
        win32.set_foreground(self.hwnd)
        pause(0.4)
        send_keys(VK_CONTROL, VK_MENU, VK_SHIFT, 0x51)  # Q
        pause(1.8)
        self.shot("05-quick-empty-light-f1")
        # 在快速窗输入
        try:
            from tests.ui.test_quick import quick_page
            qp = quick_page(self.app, timeout=12)
            inp = qp.get_by_test_id("quick-input")
            inp.click()
            inp.fill("报告")
            pause(1.5)
            self.shot("05-quick-search-light-f1")
            # 也用 page 截图（更高清）
            page_shot(qp, self.shots / "05-quick-search-light-f1-page.png")
            inp.fill("")
            pause(0.4)
            send_keys(VK_ESCAPE)
            pause(0.5)
            send_keys(VK_ESCAPE)
            pause(0.8)
        except Exception as e:
            log(f"quick page: {e}")
            send_keys(VK_ESCAPE)

    def ch6(self):
        self.chapter(6)
        pg = self.app.page
        # 设置里打开资源管理器收纳
        try:
            dlg = self.app.open_settings("桌面驻留")
            pause(1.2)
            self.shot("06-settings-shell-light-f1")
            # 寻找「资源管理器」开关
            sw = dlg.get_by_text("资源管理器", exact=False).first
            if sw.count():
                # 用 IPC 打开，保证状态正确，同时让用户看到这一页
                self.app.invoke("set_shell_integration", {"enabled": True})
                pause(1.0)
                self.shot("06-settings-shell-on-light-f1")
            send_keys(VK_ESCAPE)
            pause(0.6)
        except Exception as e:
            log(f"settings shell: {e}")
            try:
                self.app.invoke("set_shell_integration", {"enabled": True})
            except Exception:
                pass
        # 用 --collect 动词等价调用，再尽量打开资源管理器给一眼
        sample = files.write(self.sb.files / "待收纳" / "合同扫描件-客户确认版.pdf", b"%PDF-1.4")
        files.write(self.sb.files / "待收纳" / "封面设计-终稿.png", files.png_bytes(24, 24))
        try:
            subprocess.Popen(["explorer.exe", str(sample.parent)])
            pause(1.8)
            self.shot("06-explorer-folder-light-f1")
        except Exception as e:
            log(f"explorer: {e}")
        # 启动收纳会话（与右键动词同一条路径）
        try:
            self.app.invoke("collect_submit", {"paths": [str(sample), str(sample.parent / "封面设计-终稿.png")]})
            pause(1.8)
            from tests.ui.test_collect import collect_page
            cq = collect_page(self.app)
            pause(1.0)
            self.shot("06-collect-page-light-f1")
            page_shot(cq, self.shots / "06-collect-page-light-f1-page.png")
            # 看一眼动作按钮，不真正导入以免打乱库（点 Esc）
            pause(1.5)
            send_keys(VK_ESCAPE)
            pause(0.8)
        except Exception as e:
            log(f"collect: {e}")
        # 只关打开的文件夹窗口，绝不杀掉 explorer.exe（会拆掉桌面，gdigrab 也会跟着坏）
        try:
            import ctypes
            from ctypes import wintypes
            user32 = ctypes.WinDLL("user32")
            EnumWindows = user32.EnumWindows
            EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
            GetClass = user32.GetClassNameW
            GetTitle = user32.GetWindowTextW
            IsWindowVisible = user32.IsWindowVisible
            PostMessage = user32.PostMessageW
            WM_CLOSE = 0x0010
            found = []

            def cb(hwnd, _lp):
                if not IsWindowVisible(hwnd):
                    return True
                buf = ctypes.create_unicode_buffer(256)
                GetClass(hwnd, buf, 256)
                if buf.value in ("CabinetWClass", "ExploreWClass"):
                    title = ctypes.create_unicode_buffer(512)
                    GetTitle(hwnd, title, 512)
                    if "待收纳" in title.value or "explorer" in title.value.lower():
                        found.append(hwnd)
                        PostMessage(hwnd, WM_CLOSE, 0, 0)
                return True
            EnumWindows(EnumWindowsProc(cb), 0)
            log(f"closed explorer folder windows: {len(found)}")
            pause(0.8)
        except Exception as e:
            log(f"close explorer window: {e}")

    def ch7(self):
        self.chapter(7)
        ids = self.app.tag_ids()
        src = {"kind": "tag", "id": ids.get("工作") or list(ids.values())[0]}
        self.app.invoke("set_pin_settings", {"settings": {
            "enabled": True, "source": src, "mode": "float", "edge": "right", "topmost": True,
        }})
        pause(2.0)
        self.shot("07-pin-float-light-f1")
        # 抽屉
        self.app.invoke("set_pin_settings", {"settings": {
            "enabled": True, "source": src, "mode": "drawer", "edge": "right", "topmost": True,
        }})
        pause(1.5)
        self.shot("07-pin-handle-light-f1")
        # 碰边滑出：与 desktop pin 测试同一套命中（把手只有 3–4px 宽）
        try:
            wait_until(lambda: self.app.invoke("pin_diag")["handleVisible"], 8)
            # 找把手原生窗口
            handle = None
            try:
                from tests.desktop import oswin
                # 标题「TagLauncher 钉住把手」
                for _ in range(20):
                    try:
                        handle = oswin.window_by_title(self.app.proc.pid, "TagLauncher 钉住把手", visible_only=False)
                        if handle:
                            break
                    except Exception:
                        handle = None
                    time.sleep(0.2)
            except Exception as e:
                log(f"handle hwnd: {e}")
            if handle:
                l, top, r, b = win32.rect(handle)
                # 与 test_desktop_pin.hit_edge 相同：贴工作区右边时点右缘内侧
                work = win32.monitor_info(handle)["work"]
                hx = (r - 1) if r > work[2] - 10 else l
                hy = (top + b) // 2
                move_slow(hx, hy, 0.9)
            else:
                diag = self.app.invoke("pin_diag")
                hr = diag["handleRect"]
                move_slow(int(hr[0] + hr[2] / 2), int(hr[1] + hr[3] / 2), 0.9)
            pause(0.4)
            wait_until(lambda: self.app.invoke("pin_diag")["view"]["drawer"] == "expanded", 5)
            pause(1.5)
            self.shot("07-pin-drawer-expanded-light-f1")
            # 离开收回：鼠标移到工作区中央
            work = win32.monitor_info(self.refresh_hwnd())["work"]
            move_slow((work[0] + work[2]) // 2, (work[1] + work[3]) // 2, 0.9)
            pause(0.3)
            wait_until(lambda: self.app.invoke("pin_diag")["view"]["drawer"] == "collapsed", 5)
            pause(1.0)
            self.shot("07-pin-drawer-collapsed-light-f1")
        except Exception as e:
            log(f"drawer hover: {e}")
            try:
                self.app.invoke("pin_expand")
                pause(1.5)
                self.shot("07-pin-drawer-expanded-light-f1")
                self.app.invoke("pin_collapse")
                pause(1.0)
                self.shot("07-pin-drawer-collapsed-light-f1")
            except Exception as e2:
                log(f"pin_expand: {e2}")
        # 关掉钉住，避免挡住后面
        self.app.invoke("set_pin_settings", {"settings": {
            "enabled": False, "source": None, "mode": "float", "edge": "right", "topmost": True,
        }})
        pause(0.8)

    def ch8(self):
        self.chapter(8)
        pg = self.app.page
        self.place()
        for section in ("主题外观", "桌面驻留", "数据管理", "云同步", "更新"):
            try:
                dlg = self.app.open_settings(section)
                pause(1.4)
                key = {"主题外观": "theme", "桌面驻留": "desktop", "数据管理": "data",
                       "云同步": "sync", "更新": "update"}[section]
                self.shot(f"08-settings-{key}-light-f1")
                # 桌面驻留多滚一点看钉住选项
                if section == "桌面驻留":
                    try:
                        dlg.get_by_test_id("pin-options").scroll_into_view_if_needed()
                        pause(0.8)
                        self.shot("08-settings-pin-options-light-f1")
                    except Exception:
                        pass
                send_keys(VK_ESCAPE)
                pause(0.5)
            except Exception as e:
                log(f"settings {section}: {e}")
                send_keys(VK_ESCAPE)

    def ch9(self):
        self.chapter(9)
        pg = self.app.page
        self.place()

        def apply(tid, mode, font):
            pg.evaluate("""s => { const k = 'taglauncher.workspace_prefs';
              const p = JSON.parse(localStorage.getItem(k) || '{}'); p.uiFontScale = s;
              localStorage.setItem(k, JSON.stringify(p)); }""", font)
            self.app.invoke("set_current_theme", {"themeId": tid})
            pg.evaluate("m => localStorage.setItem('taglauncher.color-mode', m)", mode)
            self.app.reload_page()
            self.place()
            pause(1.0)

        def set_dpr(page, dpr):
            # 必须把 session 挂在 self 上，避免被 GC 后 DPR 回落（视觉测试已踩过）
            vp = page.viewport_size or {"width": 1600, "height": 900}
            # 用页面实际尺寸；0x0 在部分 WebView2 上会被忽略
            try:
                size = page.evaluate("() => ({w: window.innerWidth, h: window.innerHeight})")
                vp = {"width": int(size["w"]), "height": int(size["h"])}
            except Exception:
                pass
            self._cdp = page.context.new_cdp_session(page)
            self._cdp.send("Emulation.setDeviceMetricsOverride", {
                "width": vp["width"], "height": vp["height"],
                "deviceScaleFactor": dpr, "mobile": False,
            })
            return self._cdp

        def clear_dpr():
            try:
                if getattr(self, "_cdp", None):
                    self._cdp.send("Emulation.clearDeviceMetricsOverride")
            except Exception:
                pass

        # 深色 + 标准字号
        apply(THEME_DARK, "dark", 1)
        try:
            self.app.sidebar_tab("文件柜")
        except Exception:
            pass
        pause(1.0)
        self.shot("09-main-dark-f1-d1")
        # 特大字号
        apply(THEME_DARK, "dark", 1.25)
        pause(1.0)
        self.shot("09-main-dark-f1.25-d1")
        self.shot("09-main-xlarge-toolbar")  # 观察工具栏搜索框是否被挤窄
        # 125% / 150% DPR（CDP，仅 WebView 内容；系统 DPI 在 GHA runner 上改不了）
        for dpr, tag in ((1.25, "d1.25"), (1.5, "d1.5")):
            try:
                set_dpr(pg, dpr)
                pause(0.9)
                self.shot(f"09-main-dark-f1.25-{tag}")
                page_shot(pg, self.shots / f"09-main-dark-f1.25-{tag}-page.png")
            except Exception as e:
                log(f"dpr {dpr}: {e}")
        # 浅色 + 特大 + 150%
        try:
            clear_dpr()
            apply(THEME_LIGHT, "light", 1.25)
            pause(0.8)
            self.shot("09-main-light-f1.25-d1")
            set_dpr(pg, 1.5)
            pause(0.8)
            self.shot("09-main-light-f1.25-d1.5")
            page_shot(pg, self.shots / "09-main-light-f1.25-d1.5-page.png")
        except Exception as e:
            log(f"light xlarge dpr: {e}")
        clear_dpr()
        # 再切回深色特大，拍快速窗和钉住（文件名与实际主题一致）
        apply(THEME_DARK, "dark", 1.25)
        try:
            self.app.invoke("set_hotkey", {"action": "open_quick", "shortcut": HOTKEY_QUICK})
            send_keys(VK_CONTROL, VK_MENU, VK_SHIFT, 0x51)
            pause(1.5)
            from tests.ui.test_quick import quick_page
            qp = quick_page(self.app, timeout=10)
            qp.get_by_test_id("quick-input").fill("设计")
            pause(1.2)
            self.shot("09-quick-dark-f1.25")
            page_shot(qp, self.shots / "09-quick-dark-f1.25-page.png")
            send_keys(VK_ESCAPE)
            pause(0.4)
            send_keys(VK_ESCAPE)
            pause(0.6)
        except Exception as e:
            log(f"ch9 quick: {e}")
        try:
            ids = self.app.tag_ids()
            src = {"kind": "tag", "id": ids.get("工作") or list(ids.values())[0]}
            self.app.invoke("set_pin_settings", {"settings": {
                "enabled": True, "source": src, "mode": "float", "edge": "right", "topmost": True,
            }})
            pause(1.6)
            self.shot("09-pin-dark-f1.25")
            self.app.invoke("set_pin_settings", {"settings": {
                "enabled": False, "source": None, "mode": "float", "edge": "right", "topmost": True,
            }})
            pause(0.6)
        except Exception as e:
            log(f"ch9 pin: {e}")
        # 回到浅色标准，再截一张对照
        apply(THEME_LIGHT, "light", 1)
        pause(1.0)
        self.shot("09-main-light-f1-end")


def main() -> int:
    global log_fp
    OUT.mkdir(parents=True, exist_ok=True)
    shots = OUT / "screenshots"
    shots.mkdir(exist_ok=True)
    log_fp = open(OUT / "walkthrough.log", "w", encoding="utf-8")
    log(f"out={OUT} exe={default_exe()}")
    font = find_font()
    log(f"font={font}")
    (OUT / "meta.json").write_text(json.dumps({
        "version": "1.10.0-beta", "exe": str(default_exe()), "font": font,
        "visible": os.environ.get("TL_E2E_VISIBLE"),
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    if not default_exe().exists():
        log("找不到 exe")
        return 2

    guard = RealDirGuard(TMP / "ux-real-dir")
    try:
        guard.snapshot()
        guard.reset_window_state()
    except Exception as e:
        log(f"RealDirGuard: {e}")

    run = TMP / "ux-walkthrough"
    if run.exists():
        shutil.rmtree(run, ignore_errors=True)
    sb = Sandbox(run / "sb", default_exe())
    # 便携版旁边的 tl.exe / dll / 资源一并拷到沙箱，避免只复制 exe 缺依赖
    try:
        sb.install_exe()
        src_dir = default_exe().parent
        for f in src_dir.iterdir():
            dest = sb.bin / f.name
            if f.is_file() and not dest.exists():
                shutil.copy2(f, dest)
            elif f.is_dir() and f.name.lower() not in {"webview2", "logs"}:
                if not dest.exists():
                    shutil.copytree(f, dest, dirs_exist_ok=True)
        log(f"sandbox bin: {list(sb.bin.iterdir())}")
    except Exception as e:
        log(f"copy siblings: {e}")
    rec = Recorder(OUT / "raw.mp4")
    walked = None
    rc = 0
    with sync_playwright() as pw:
        app = AppSession(pw, sb, dismiss_welcome=True)
        try:
            app.start(timeout=90)
            app.close_welcome(4000)
            pause(1.0)
            log("seeding")
            try:
                seed_library(app, sb)
            except Exception:
                log("seed_library failed, 继续用已入库的部分\n" + traceback.format_exc())
                try:
                    app.reload_page()
                except Exception:
                    pass
            pause(1.0)
            walked = Walk(app, sb, rec, shots)
            walked.place()
            rec.start()
            pause(0.8)
            for fn, name in (
                (walked.ch1, "ch1"), (walked.ch2, "ch2"), (walked.ch3, "ch3"),
                (walked.ch4, "ch4"), (walked.ch5, "ch5"), (walked.ch6, "ch6"),
                (walked.ch7, "ch7"), (walked.ch8, "ch8"), (walked.ch9, "ch9"),
            ):
                walked.step(name, fn)
            pause(1.5)
        except Exception:
            log("FATAL\n" + traceback.format_exc())
            rc = 1
            try:
                grab_desktop(shots / "fatal.png")
            except Exception:
                pass
        finally:
            try:
                rec.stop()
            except Exception as e:
                log(f"stop rec: {e}")
            try:
                app.stop()
            except Exception:
                try:
                    app.kill()
                except Exception:
                    pass

    # 后期
    try:
        if rec.marks and rec.raw.exists():
            stitch(rec.raw, rec.marks, font or "", OUT / "walkthrough.mp4", OUT / "tmp-edit")
        elif rec.raw.exists():
            shutil.copy(rec.raw, OUT / "walkthrough.mp4")
            log("copied raw (no chapter marks)")
    except Exception:
        log("stitch failed\n" + traceback.format_exc())
        if rec.raw.exists():
            shutil.copy(rec.raw, OUT / "walkthrough.mp4")
            rc = rc or 1
    try:
        contact_sheet(shots, OUT / "contact-sheet.png", font)
    except Exception:
        log("sheet failed\n" + traceback.format_exc())

    summary = {
        "done": walked.done if walked else [],
        "failed": walked.failed if walked else [],
        "shown": walked.shown if walked else [],
        "marks": [
            {"t": t, "n": n, "title": title, "sub": sub} for t, n, title, sub in rec.marks
        ],
        "backend": rec.backend,
        "raw_exists": rec.raw.exists(),
        "mp4_exists": (OUT / "walkthrough.mp4").exists(),
        "mp4_bytes": (OUT / "walkthrough.mp4").stat().st_size if (OUT / "walkthrough.mp4").exists() else 0,
    }
    summary["disclosures"] = [
        "系统文件选择框由 e2e stub（plugin:dialog|open）跳过，第 4 章展示的是应用内「添加文件夹」导入方式对话框。",
        "第 6 章若资源管理器右键菜单不稳定，则打开文件夹窗口后经 collect_submit 唤出收纳页（与右键动词同一条 IPC）。",
        "第 9 章 125%/150% DPI 通过 CDP Emulation.setDeviceMetricsOverride，只影响 WebView 内容，原生窗口边框与系统光标仍是 runner 的 100% DPI。",
        "录屏后端：" + rec.backend + ("。截图合成时没有系统光标动画。" if rec.backend != "gdigrab" else "（ffmpeg gdigrab，含系统光标）。"),
    ]
    (OUT / "DISCLOSURES.md").write_text("\n".join("- " + d for d in summary["disclosures"]) + "\n", encoding="utf-8")
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    log(json.dumps(summary, ensure_ascii=False, indent=2))
    log_fp.close()
    # 有视频就算可交付；章节失败记入 summary 不阻断上传
    return 0 if (OUT / "walkthrough.mp4").exists() or rec.raw.exists() else (rc or 1)


if __name__ == "__main__":
    sys.exit(main())
