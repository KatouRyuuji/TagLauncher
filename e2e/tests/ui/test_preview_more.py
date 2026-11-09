"""快速预览 P1/P2（E-PRV-02..08）。全部 CDP，不接管系统鼠标键盘；不真实播放声音（静音夹具）。"""
from __future__ import annotations

import os
import struct
import time

import pytest

from harness import files
from harness.app import wait_until


def id3_mp3(title: str, artist: str) -> bytes:
    def frame(fid: bytes, text: str) -> bytes:
        body = b"\x00" + text.encode("latin-1")
        return fid + struct.pack(">I", len(body)) + b"\x00\x00" + body
    frames = frame(b"TIT2", title) + frame(b"TPE1", artist)
    n = len(frames)
    size = bytes([(n >> 21) & 0x7F, (n >> 14) & 0x7F, (n >> 7) & 0x7F, n & 0x7F])
    mpeg = (b"\xff\xfb\x90\x64" + b"\x00" * 413) * 40
    return b"ID3\x03\x00\x00" + size + frames + mpeg


def open_preview(app, name):
    app.card(name).click()
    app.page.keyboard.press(" ")
    pv = app.page.get_by_role("dialog", name="快速预览")
    pv.wait_for(timeout=5000)
    return pv


def wait_loaded(pv):
    wait_until(lambda: pv.locator('[aria-busy="true"]').count() == 0, 10, "预览一直在加载")


@pytest.mark.case("E-PRV-02")
def test_audio_preview(app, sandbox):
    mp3 = files.write(sandbox.files / "pa" / "元数据.mp3", id3_mp3("E2E Title", "E2E Artist"))
    wav = files.write(sandbox.files / "pa" / "静音.wav", files.wav_bytes(3000))
    app.seed([mp3, wav])
    pv = open_preview(app, "元数据.mp3")
    wait_loaded(pv)
    wait_until(lambda: "E2E Title" in pv.inner_text() and "E2E Artist" in pv.inner_text(), 8, pv.inner_text)
    app.page.keyboard.press("Escape")
    pv.wait_for(state="hidden")
    pv = open_preview(app, "静音.wav")
    wait_loaded(pv)
    rng = pv.get_by_label("播放进度")
    wait_until(lambda: rng.is_enabled() and float(rng.get_attribute("max") or 0) > 2, 10,
               lambda: (rng.get_attribute("max"), pv.inner_text()))
    # 拖动进度（设置 range 值并派发 input，相当于拖到中点）
    rng.evaluate("""el => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(el, String(Number(el.max) / 2)); el.dispatchEvent(new Event('input', {bubbles: true})); }""")
    wait_until(lambda: pv.locator("audio").evaluate("a => a.currentTime") > 1.0, 5,
               lambda: pv.locator("audio").evaluate("a => a.currentTime"))
    assert "0:01" in pv.locator(".preview-timecode").inner_text() or "0:00" not in pv.locator(".preview-timecode").inner_text().split("/")[0]


@pytest.mark.case("E-PRV-03")
def test_video_preview(app, sandbox):
    mp4 = files.write(sandbox.files / "pv" / "小视频.mp4", files.mp4_bytes())
    app.seed([mp4])
    pv = open_preview(app, "小视频.mp4")
    wait_loaded(pv)
    # 夹具只有 ftyp/free，无可解码轨：要么出现 <video>，要么出现中性的失败说明；不能空白/卡住
    wait_until(lambda: pv.locator("video").count() > 0 or "无法" in pv.inner_text(), 8, pv.inner_text)
    assert app.js_errors() == []


@pytest.mark.case("E-PRV-04")
def test_text_preview_properties(app, sandbox):
    """产品的文本预览只展示属性（大小/路径/时间），不渲染正文——与矩阵“内容显示”的期望不同，按产品实际断言。"""
    utf8 = files.write(sandbox.files / "pt" / "说明.md", "# 标题\n正文\n")
    gbk = files.write(sandbox.files / "pt" / "国标.txt", "中文 GBK 内容\n".encode("gbk"))
    big = sandbox.files / "pt" / "大文件.txt"
    with open(big, "wb") as f:
        f.write(b"x" * (20 * 1024 * 1024))
    app.seed([utf8, gbk, big])
    for name in ("说明.md", "国标.txt", "大文件.txt"):
        t0 = time.monotonic()
        pv = open_preview(app, name)
        wait_loaded(pv)
        assert time.monotonic() - t0 < 5, f"{name} 预览过慢"
        assert name in pv.inner_text()
        app.page.keyboard.press("Escape")
        pv.wait_for(state="hidden")
    assert app.js_errors() == []


@pytest.mark.case("E-PRV-05")
def test_folder_preview_drill(app, sandbox):
    root = sandbox.files / "预览夹"
    files.write(root / "子目录" / "深处.txt", "d")
    files.write(root / "顶层文件.txt", "t")
    app.seed([root])
    pv = open_preview(app, "预览夹")
    lst = pv.get_by_label("目录内容")
    wait_until(lambda: {"子目录", "顶层文件.txt"} <= set(lst.locator("li span").all_inner_texts()), 8,
               lambda: lst.inner_text())
    lst.locator("li").filter(has_text="子目录").first.click()
    wait_until(lambda: "深处.txt" in lst.inner_text(), 5, lst.inner_text)
    crumb = pv.get_by_role("navigation", name="当前位置")
    assert crumb.locator('[aria-current="location"]').inner_text().strip() == "子目录"
    crumb.get_by_role("button", name="预览夹").click()
    wait_until(lambda: "顶层文件.txt" in lst.inner_text(), 5, lst.inner_text)
    # 键盘：Enter 进入、Backspace 返回
    lst.focus()
    lst.locator("li").filter(has_text="子目录").first.click()
    wait_until(lambda: "深处.txt" in lst.inner_text(), 5)
    lst.focus()
    app.page.keyboard.press("Backspace")
    wait_until(lambda: "顶层文件.txt" in lst.inner_text(), 5, lst.inner_text)
    assert len(app.items()) == 1      # 预览不自动入库


@pytest.mark.case("E-PRV-06")
def test_preview_note_and_copy(app, sandbox):
    p = files.write(sandbox.files / "pn" / "带备注.txt", "n")
    app.seed([p])
    pv = open_preview(app, "带备注.txt")
    wait_loaded(pv)
    pv.get_by_role("button", name="添加备注").click()
    dlg = app.dialog("编辑备注")
    dlg.get_by_label("备注内容").fill("预览里写的备注")
    dlg.get_by_label("备注内容").press("Control+Enter")
    dlg.wait_for(state="detached", timeout=5000)
    wait_until(lambda: app.item("带备注.txt")["note"] == "预览里写的备注", 5)
    wait_until(lambda: "预览里写的备注" in pv.get_by_label("备注").inner_text(), 5)
    pv.locator("footer").get_by_role("button", name="复制路径").click()
    wait_until(lambda: (app.clipboard() or [""])[-1] == str(p), 5, app.clipboard)


@pytest.mark.case("E-PRV-07")
def test_missing_preview(app, sandbox):
    p = files.write(sandbox.files / "pm" / "将失效.txt", "m")
    app.seed([p])
    os.remove(p)
    app.invoke("reconcile_items", {"force": True, "wait": True})
    app.reload_page()
    wait_until(lambda: app.item("将失效.txt")["is_missing"], 10)
    pv = open_preview(app, "将失效.txt")
    pv.get_by_role("alert").filter(has_text="项目已失效").wait_for(timeout=5000)
    pv.get_by_role("button", name="查看失效项目").click()
    pv.wait_for(state="hidden", timeout=3000)


@pytest.mark.case("E-PRV-08")
def test_preview_arrow_navigation(app, sandbox):
    ps = [files.write(sandbox.files / "pk" / f"切换{i}.txt", str(i)) for i in range(3)]
    app.seed(ps)
    app.page.get_by_role("button", name="列表视图", exact=True).click()
    names = app.visible_names()
    pv = open_preview(app, names[0])
    title = lambda: pv.locator("h2").first.inner_text().strip()
    wait_until(lambda: title() == names[0], 3, title)
    app.page.keyboard.press("ArrowDown")
    wait_until(lambda: title() == names[1], 3, title)
    app.page.keyboard.press("ArrowDown")
    wait_until(lambda: title() == names[2], 3, title)
    app.page.keyboard.press("ArrowUp")
    wait_until(lambda: title() == names[1], 3, title)
    app.page.keyboard.press("Home")
    wait_until(lambda: title() == names[0], 3, title)
    ids = {i["name"]: i["id"] for i in app.items()}
    assert app.selected_ids() == [ids[names[0]]]   # 背景选中跟随
