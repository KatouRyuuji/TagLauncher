"""E-CLI-11/12：tl tui 经 ConPTY（pywinpty 2.0.15）驱动。

键入走伪终端，不接管物理输入；无 pywinpty 则跳过。
读取必须可截止：pywinpty 2.0.15 的 PtyProcess.read() 会阻塞，直接调用会使
wait(timeout=10) 失效并把整个分片卡到步骤 45 分钟上限。等待失败要带上真实
TUI 输出并释放本次 pty/子进程，不得吞掉失败。
"""
from __future__ import annotations

import time

import pytest

from harness import db as dbh
from harness import files
from tests.cli.tui_io import read_until, reap_pty, wait_for_text

winpty = pytest.importorskip("winpty", reason="未安装 pywinpty（pip install pywinpty）")


class Tui:
    def __init__(self, tl, cols=100, rows=30):
        env = tl.sb.env(None)
        self.p = winpty.PtyProcess.spawn(
            [str(tl.exe), "tui"], cwd=str(tl.sb.bin), env=env, dimensions=(rows, cols)
        )
        self._buf = [""]

    @property
    def buf(self) -> str:
        return self._buf[0]

    def read(self, secs=0.8):
        try:
            chunk = read_until(self.p, secs)
        except EOFError:
            return self.buf
        if chunk:
            self._buf[0] += chunk
        return self.buf

    def wait(self, text, timeout=10):
        wait_for_text(self.p, self._buf, text, timeout=timeout)

    def send(self, s):
        self.p.write(s)

    def close(self):
        reap_pty(self.p)


@pytest.fixture
def tui(tl, sandbox):
    tl.ensure_db()
    bat = files.marker_exe(sandbox.files / "启动目标.exe")
    other = files.write(sandbox.files / "其他对象.txt", "x")
    tl.json("add", bat, other)
    t = Tui(tl)
    try:
        yield t, bat
    finally:
        t.close()


@pytest.mark.case("E-CLI-11")
def test_tui_interaction(tui, tl, sandbox):
    t, bat = tui
    t.wait("其他对象")
    t.send("启动")
    t.wait("启动目标")
    t.send("\x04")  # Ctrl+D 收藏
    time.sleep(0.8)
    fav = dbh.scalar(sandbox.db_path, "SELECT is_favorite FROM items WHERE name = '启动目标.exe'")
    assert fav in (1, True), fav
    t.send("\r")  # Enter 启动（marker bat，只写标记文件）
    files.wait_marker(bat)
    t.send("\x1b")  # Esc 退出
    end = time.monotonic() + 8
    while t.p is not None and getattr(t.p, "isalive", lambda: False)() and not getattr(t.p, "_tl_tui_eof", False) and time.monotonic() < end:
        t.read(0.2)
    assert not t.p.isalive(), "Esc 后 tui 未退出"
    assert "\x1b[?1049l" in t.buf or "\x1b[?25h" in t.buf, "退出时未恢复终端（备用屏/光标）"


@pytest.mark.case("E-CLI-12")
def test_tui_resize_wide_chars(tui):
    t, _ = tui
    t.wait("其他对象")
    for rows, cols in ((10, 40), (40, 160), (6, 20), (30, 100)):
        t.p.setwinsize(rows, cols)
        t.read(0.6)
        assert t.p.isalive(), f"缩放到 {cols}x{rows} 后崩溃"
    t.send("对象")
    t.wait("对象")
    assert t.p.isalive()
