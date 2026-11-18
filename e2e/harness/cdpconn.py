"""CDP 连接登记与调试端口 TCP 普查。

connect_over_cdp 得到的 Browser.close() 只断开本进程到 WebView2 的 websocket，
不会关真实浏览器（Playwright 官方契约）。所有连接必须登记，测量前全部断开，
并用目标端口 ESTABLISHED 表证明已无调试会话。关闭失败视为测量无效，不是产品 idle 失败。
"""
from __future__ import annotations

import ctypes
import subprocess
from ctypes import wintypes
from typing import Any

AF_INET, AF_INET6 = 2, 23
TCP_TABLE_OWNER_PID_ALL = 5
MIB_TCP_STATE_ESTAB = 5
ERROR_INSUFFICIENT_BUFFER = 122


class CdpLease:
    __slots__ = ("id", "reason", "browser", "close_error")

    def __init__(self, id: int, reason: str, browser: Any):
        self.id = id
        self.reason = reason
        self.browser = browser
        self.close_error: str | None = None


def _port_nbo(dword: int) -> int:
    # MSDN：端口在 DWORD 的高 16 位，网络字节序
    import socket
    return socket.ntohs((dword >> 16) & 0xFFFF)


def _tcp_rows_ipv4(port: int) -> list[dict]:
    class ROW(ctypes.Structure):
        _fields_ = [
            ("state", wintypes.DWORD),
            ("local_addr", wintypes.DWORD),
            ("local_port", wintypes.DWORD),
            ("remote_addr", wintypes.DWORD),
            ("remote_port", wintypes.DWORD),
            ("owning_pid", wintypes.DWORD),
        ]

    iphlpapi = ctypes.WinDLL("iphlpapi")
    size = wintypes.DWORD(0)
    iphlpapi.GetExtendedTcpTable(None, ctypes.byref(size), False, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0)
    buf = ctypes.create_string_buffer(size.value)

    class TABLE(ctypes.Structure):
        _fields_ = [("num", wintypes.DWORD), ("rows", ROW * 1)]

    if iphlpapi.GetExtendedTcpTable(buf, ctypes.byref(size), False, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0) != 0:
        raise OSError("GetExtendedTcpTable IPv4 失败")
    num = ctypes.cast(buf, ctypes.POINTER(wintypes.DWORD)).contents.value
    rows_t = ROW * max(num, 1)
    class TABLE_N(ctypes.Structure):
        _fields_ = [("num", wintypes.DWORD), ("rows", rows_t)]
    table = ctypes.cast(buf, ctypes.POINTER(TABLE_N)).contents
    out = []
    for i in range(table.num):
        r = table.rows[i]
        if r.state != MIB_TCP_STATE_ESTAB:
            continue
        lp, rp = _port_nbo(r.local_port), _port_nbo(r.remote_port)
        if lp == port or rp == port:
            out.append({"af": "ipv4", "local_port": lp, "remote_port": rp, "pid": int(r.owning_pid)})
    return out


def _tcp_rows_ipv6(port: int) -> list[dict]:
    class ROW(ctypes.Structure):
        _fields_ = [
            ("local_addr", ctypes.c_ubyte * 16),
            ("local_scope", wintypes.DWORD),
            ("local_port", wintypes.DWORD),
            ("remote_addr", ctypes.c_ubyte * 16),
            ("remote_scope", wintypes.DWORD),
            ("remote_port", wintypes.DWORD),
            ("state", wintypes.DWORD),
            ("owning_pid", wintypes.DWORD),
        ]

    iphlpapi = ctypes.WinDLL("iphlpapi")
    size = wintypes.DWORD(0)
    iphlpapi.GetExtendedTcpTable(None, ctypes.byref(size), False, AF_INET6, TCP_TABLE_OWNER_PID_ALL, 0)
    buf = ctypes.create_string_buffer(size.value)

    class TABLE_N_HDR(ctypes.Structure):
        _fields_ = [("num", wintypes.DWORD)]

    if iphlpapi.GetExtendedTcpTable(buf, ctypes.byref(size), False, AF_INET6, TCP_TABLE_OWNER_PID_ALL, 0) != 0:
        raise OSError("GetExtendedTcpTable IPv6 失败")
    num = ctypes.cast(buf, ctypes.POINTER(wintypes.DWORD)).contents.value
    rows_t = ROW * max(num, 1)
    class TABLE_N(ctypes.Structure):
        _fields_ = [("num", wintypes.DWORD), ("rows", rows_t)]
    table = ctypes.cast(buf, ctypes.POINTER(TABLE_N)).contents
    out = []
    for i in range(table.num):
        r = table.rows[i]
        if r.state != MIB_TCP_STATE_ESTAB:
            continue
        lp, rp = _port_nbo(r.local_port), _port_nbo(r.remote_port)
        if lp == port or rp == port:
            out.append({"af": "ipv6", "local_port": lp, "remote_port": rp, "pid": int(r.owning_pid)})
    return out


def _netstat_fallback(port: int) -> list[dict]:
    # 仅当 API 失败时使用；仍只计 ESTABLISHED
    try:
        raw = subprocess.check_output(["netstat", "-ano", "-p", "tcp"], text=True, errors="replace")
    except Exception as e:  # noqa: BLE001
        raise OSError(f"TCP 普查失败：{e}") from e
    out = []
    for line in raw.splitlines():
        parts = line.split()
        if len(parts) < 5 or "ESTABLISHED" not in parts:
            continue
        # Proto Local Address Foreign Address State PID
        try:
            i = parts.index("ESTABLISHED")
            local, remote, pid = parts[i - 2], parts[i - 1], int(parts[i + 1])
        except (ValueError, IndexError):
            continue
        def p(addr: str) -> int | None:
            if addr.rsplit(":", 1)[-1].isdigit():
                return int(addr.rsplit(":", 1)[-1])
            return None
        lp, rp = p(local), p(remote)
        if lp == port or rp == port:
            out.append({"af": "netstat", "local_port": lp, "remote_port": rp, "pid": pid})
    return out


def established_on_port(port: int) -> list[dict]:
    """本机目标调试端口上的 ESTABLISHED 连接（含 pytest 驱动端）。"""
    if port is None:
        return []
    try:
        return _tcp_rows_ipv4(port) + _tcp_rows_ipv6(port)
    except OSError:
        return _netstat_fallback(port)


class CdpRegistry:
    def __init__(self) -> None:
        self._n = 0
        self.leases: list[CdpLease] = []
        self.log: list[dict] = []

    def add(self, browser: Any, reason: str) -> CdpLease:
        self._n += 1
        lease = CdpLease(self._n, reason, browser)
        self.leases.append(lease)
        self.log.append({"op": "open", "id": lease.id, "reason": reason})
        return lease

    def _drop(self, lease: CdpLease, reason: str) -> None:
        err = None
        try:
            if lease.browser is not None:
                try:
                    connected = bool(lease.browser.is_connected())
                except Exception:  # noqa: BLE001
                    connected = True
                if connected:
                    lease.browser.close()
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {e}"
            lease.close_error = err
        self.log.append({"op": "close", "id": lease.id, "reason": reason, "error": err})
        self.leases = [x for x in self.leases if x is not lease]

    def disconnect(self, browser: Any, reason: str) -> None:
        for lease in list(self.leases):
            if lease.browser is browser:
                self._drop(lease, reason)

    def disconnect_all(self, reason: str) -> list[str]:
        errors = []
        for lease in list(self.leases):
            self._drop(lease, reason)
            if lease.close_error:
                errors.append(f"id={lease.id} {lease.reason}: {lease.close_error}")
        return errors

    def snapshot(self) -> list[dict]:
        out = []
        for lease in self.leases:
            try:
                connected = bool(lease.browser.is_connected())
            except Exception as e:  # noqa: BLE001
                connected = f"err:{type(e).__name__}"
            out.append({"id": lease.id, "reason": lease.reason, "connected": connected})
        return out
