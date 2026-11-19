"""Bounded socket reads for pywinpty 2.0.15 with persistent UTF-8 decoding.

PtyProcess.read() can spin on partial UTF-8 followed by EOF. Socket timeouts
cannot interrupt that Python loop; read the public fileobj directly instead.
"""
from __future__ import annotations
import codecs
import select
import socket
import time
from typing import Any

_RECV_TIMEOUT = (TimeoutError, socket.timeout)


def read_until(proc: Any, budget_s: float, size: int = 4096) -> str:
    """Read at most once before the deadline; retain partial UTF-8 across calls."""
    if budget_s <= 0:
        return ""
    if getattr(proc, "_tl_tui_eof", False):
        raise EOFError("Pty is closed")
    fo = getattr(proc, "fileobj", None)
    if fo is None:
        raise EOFError("Pty has no fileobj")
    decoder = getattr(proc, "_tl_tui_decoder", None)
    if decoder is None:
        decoder = codecs.getincrementaldecoder("utf-8")()
        proc._tl_tui_decoder = decoder
    end = time.monotonic() + budget_s
    try:
        if fo.fileno() < 0:
            raise EOFError("Pty is closed")
        ready, _, _ = select.select([fo], [], [], max(0.0, end - time.monotonic()))
        if not ready:
            return ""
        remaining = end - time.monotonic()
        if remaining <= 0:
            return ""
        old = fo.gettimeout()
        try:
            fo.settimeout(remaining)
            data = fo.recv(size)
        finally:
            try:
                fo.settimeout(old)
            except OSError:
                pass
    except _RECV_TIMEOUT:
        return ""
    except (OSError, ValueError, EOFError) as e:
        proc._tl_tui_eof = True
        raise EOFError("Pty is closed") from e
    if not data:
        proc._tl_tui_eof = True
        try:
            decoder.decode(b"", final=True)
        except UnicodeDecodeError as e:
            raise EOFError("Pty ended with incomplete UTF-8") from e
        raise EOFError("Pty is closed")
    if data == b"0011Ignore":
        return ""
    try:
        return decoder.decode(data, final=False)
    except UnicodeDecodeError as e:
        proc._tl_tui_eof = True
        raise EOFError("Pty produced invalid UTF-8") from e


def describe_pty(proc: Any, buf: str) -> str:
    """等待失败时收集的诊断：存活状态与已收到输出。不调用已知会卡死的 iseof()。"""
    parts: list[str] = []
    try:
        parts.append(f"alive={proc.isalive()!r}")
    except Exception as e:  # noqa: BLE001 — 诊断本身不得再把失败吞掉或卡住
        parts.append(f"isalive_error={type(e).__name__}:{e}")
    try:
        status = getattr(proc, "exitstatus", None)
        if status is not None:
            parts.append(f"exitstatus={status!r}")
    except Exception as e:  # noqa: BLE001
        parts.append(f"exitstatus_error={type(e).__name__}:{e}")
    if buf:
        parts.append(f"收到 {len(buf)} 字")
    else:
        parts.append("无输出")
    parts.append(f"尾部：{buf[-400:]!r}")
    return "，".join(parts)


def reap_pty(proc: Any) -> None:
    """Close sockets even when pywinpty.isalive() already set closed=True."""
    if proc is None:
        return
    close_error = None
    try:
        proc.close(force=True)
    except Exception as e:
        close_error = e
    finally:
        for name in ("fileobj", "_server"):
            fo = getattr(proc, name, None)
            if fo is not None:
                fo.close()
    if proc.isalive():
        if proc.terminate(force=True) is False or proc.isalive():
            raise RuntimeError("TUI child could not be terminated") from close_error


def wait_for_text(proc: Any, buf: list[str], text: str, timeout: float = 10) -> None:
    """直到 buf 拼接结果出现 text，或在 timeout 内失败。

    失败时：把已收到的真实输出写入 AssertionError，并 reap 本次 pty。
    不把等待失败吞掉。buf 是单元素列表，存放累计输出（就地更新）。
    """
    if len(buf) != 1:
        raise ValueError("buf must be a single-element list of accumulated output")
    if text in buf[0]:
        return
    end = time.monotonic() + timeout
    eof = None
    while time.monotonic() < end:
        try:
            chunk = read_until(proc, min(0.3, end - time.monotonic()))
        except EOFError as e:
            eof = str(e)
            break
        if chunk:
            buf[0] += chunk
        if text in buf[0]:
            return
    detail = describe_pty(proc, buf[0])
    if eof is not None:
        detail += f"，EOF={eof}"
    try:
        reap_pty(proc)
    except Exception as e:
        detail += f"，cleanup_error={type(e).__name__}:{e}"
    raise AssertionError(f"TUI 输出未出现「{text}」，{detail}")
