"""可在 box 上跑的 TUI pty 截止读取单测：不依赖 Windows / pywinpty / 应用 exe。

用与 pywinpty 2.0.15 相同的 AF_INET SOCK_STREAM 对模拟 fileobj。
可独立：在 e2e 目录执行
  python -m pytest tests/cli/test_tui_io.py --noconftest -q
"""
from __future__ import annotations

import socket
import subprocess
import sys
import threading
import time

import pytest

from tests.cli.tui_io import read_until, reap_pty, wait_for_text


def _inet_pair() -> tuple[socket.socket, socket.socket, socket.socket]:
    """与 pywinpty 2.0.15 PtyProcess 相同：本机 TCP listen/accept 得到 fileobj。"""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    client.connect(server.getsockname())
    peer, _ = server.accept()
    return server, client, peer


class FakePty:
    """最小 PtyProcess 替身：fileobj + 与 2.0.15 同形的 read / close / isalive。"""

    def __init__(self, fileobj: socket.socket, child: subprocess.Popen | None = None):
        self.fileobj = fileobj
        self.closed = False
        self._child = child

    def read(self, size: int = 1024) -> str:
        data = self.fileobj.recv(size)
        if not data:
            raise EOFError("Pty is closed")
        if data == b"0011Ignore":
            return ""
        err = True
        while err and data:
            try:
                data.decode("utf-8")
                err = False
            except UnicodeDecodeError:
                data += self.fileobj.recv(1)
        return data.decode("utf-8")

    def isalive(self) -> bool:
        if self._child is not None:
            return self._child.poll() is None
        return not self.closed

    @property
    def exitstatus(self):
        if self._child is None:
            return None
        return self._child.poll()

    def terminate(self, force: bool = False) -> bool:
        if self._child is None or self._child.poll() is not None:
            return True
        self._child.terminate()
        try:
            self._child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            if force:
                self._child.kill()
                self._child.wait(timeout=2)
        return self._child.poll() is not None

    def close(self, force: bool = False) -> None:
        if self.closed:
            return
        try:
            self.fileobj.close()
        except OSError:
            pass
        self.terminate(force=force)
        self.closed = True


@pytest.fixture
def pty_pair():
    server, fileobj, peer = _inet_pair()
    proc = FakePty(fileobj)
    try:
        yield proc, peer
    finally:
        reap_pty(proc)
        for s in (peer, server):
            try:
                s.close()
            except OSError:
                pass
        # 泄漏检查：本夹具不得留下活线程（发送线程须已结束）
        live = [t for t in threading.enumerate() if t is not threading.main_thread() and t.is_alive() and t.name.startswith("tui-io-")]
        assert live == [], f"未结束的测试线程: {live}"


def test_read_until_deadline_when_peer_sends_nothing(pty_pair):
    proc, _peer = pty_pair
    t0 = time.monotonic()
    chunk = read_until(proc, 0.3)
    elapsed = time.monotonic() - t0
    assert chunk == ""
    assert 0.25 <= elapsed < 1.0, f"截止无效，耗时 {elapsed:.3f}s"


def test_wait_fails_with_real_output_and_reaps(pty_pair):
    proc, peer = pty_pair
    peer.sendall("已画出的列表\n".encode("utf-8"))
    # 让数据进入 fileobj 缓冲后再等一个不会出现的串
    buf = [""]
    t0 = time.monotonic()
    with pytest.raises(AssertionError) as ei:
        wait_for_text(proc, buf, "绝对不会出现的标记", timeout=0.4)
    elapsed = time.monotonic() - t0
    msg = str(ei.value)
    assert "绝对不会出现的标记" in msg
    assert "已画出的列表" in msg
    assert elapsed < 1.2, f"失败路径截止无效，耗时 {elapsed:.3f}s"
    assert proc.closed, "等待失败必须释放 pty"
    # 再 reap 必须可终结、不抛
    reap_pty(proc)
    assert proc.closed


def test_wait_succeeds_when_text_arrives_before_deadline(pty_pair):
    proc, peer = pty_pair

    def send():
        time.sleep(0.05)
        peer.sendall("其他对象.txt\n".encode("utf-8"))

    th = threading.Thread(target=send, name="tui-io-send", daemon=False)
    th.start()
    buf = [""]
    try:
        wait_for_text(proc, buf, "其他对象", timeout=1.0)
    finally:
        th.join(2)
    assert not th.is_alive(), "发送线程必须结束"
    assert "其他对象.txt" in buf[0]
    assert not proc.closed, "成功路径不得提前 reap"


def test_reap_terminates_isolated_child_process(pty_pair):
    proc, _peer = pty_pair
    child = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(60)"],
    )
    proc._child = child
    try:
        assert child.poll() is None
        reap_pty(proc)
        assert proc.closed
        assert child.poll() is not None, "reap 必须结束隔离子进程"
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=2)


def test_partial_utf8_eof_is_terminal_and_never_calls_unbounded_read(pty_pair):
    proc, peer = pty_pair
    proc.read = lambda *_: pytest.fail("must not delegate to pywinpty.read")
    peer.sendall(b"\xe4")
    assert read_until(proc, 0.2) == ""
    peer.close()
    with pytest.raises(EOFError, match="incomplete UTF-8"):
        read_until(proc, 0.2)
    with pytest.raises(EOFError):
        read_until(proc, 0.2)


def test_partial_utf8_survives_timeout_then_completes(pty_pair):
    proc, peer = pty_pair
    data = "对象".encode("utf-8")
    peer.sendall(data[:1])
    assert read_until(proc, 0.2) == ""
    assert read_until(proc, 0.01) == ""
    peer.sendall(data[1:])
    assert read_until(proc, 0.2) == "对象"


def test_multibyte_text_split_at_each_byte_is_lossless(pty_pair):
    proc, peer = pty_pair
    out = ""
    for byte in "启动目标.txt\n".encode("utf-8"):
        peer.sendall(bytes([byte]))
        out += read_until(proc, 0.2)
    assert out == "启动目标.txt\n"


def test_dead_child_closed_flag_does_not_skip_socket_cleanup(pty_pair):
    proc, peer = pty_pair
    proc.closed = True
    proc.isalive = lambda: False
    reap_pty(proc)
    assert proc.fileobj.fileno() == -1


def test_wait_partial_eof_keeps_received_failure_output_and_reaps(pty_pair):
    proc, peer = pty_pair
    peer.sendall(b"visible prefix \xe4")
    peer.close()
    buf = [""]
    with pytest.raises(AssertionError, match="incomplete UTF-8") as ei:
        wait_for_text(proc, buf, "not present", timeout=0.2)
    assert "visible prefix" in str(ei.value)
    assert proc.fileobj.fileno() == -1


def test_reap_reports_failed_termination_instead_of_swallowing_it(pty_pair):
    proc, _ = pty_pair
    proc.close = lambda **_: None
    proc.terminate = lambda **_: False
    try:
        with pytest.raises(RuntimeError, match="could not be terminated"):
            reap_pty(proc)
        assert proc.fileobj.fileno() == -1
    finally:
        proc.closed = True


def test_wait_accepts_already_received_text_without_reading_a_dead_peer(pty_pair):
    proc, peer = pty_pair
    peer.close()
    wait_for_text(proc, ["already received 对象"], "对象", timeout=0.2)
