"""CDP 连接登记与「目标调试端口」上的 ESTABLISHED 普查。

connect_over_cdp 得到的 Browser.close() 只断开本进程到 WebView2 的 websocket
（transport.closeAndWait），不会关真实应用。不要改用 page/context.close 或
CDP 协议的 Browser.close。

TCP 结果是「连到目标监听元组的 ESTABLISHED」，不是「全部 CDP」。端口解码为
ntohs(dword & 0xFFFF)（低 16 位网络序）。登记表记录 endpoint；关闭失败的租约
不得从所有权中移除。任一地址族原生表失败则双栈完整 fallback，仍不完整则
fail-closed，不得把空列表当成已断开。
"""
from __future__ import annotations

import ctypes
import socket
import struct
import subprocess
from ctypes import wintypes
from typing import Any
from urllib.parse import urlparse

AF_INET, AF_INET6 = 2, 23
TCP_TABLE_OWNER_PID_ALL = 5
MIB_TCP_STATE_ESTAB = 5
ERROR_INSUFFICIENT_BUFFER = 122


def attached_pages_after_turn(browser: Any, main_page: Any) -> list[Any]:
    """Service pending target-created/closed events before reading sync API caches.

    Browser.contexts, context.pages and page.is_closed are local getters. A
    time.sleep polling loop never services their transport; an existing main
    page read does, without opening a connection or changing window state.
    """
    main_page.evaluate("() => null")
    return [page for context in browser.contexts for page in context.pages if not page.is_closed()]


class CdpLease:
    __slots__ = ("id", "reason", "browser", "endpoint", "close_error")

    def __init__(self, id: int, reason: str, browser: Any, endpoint: str):
        self.id = id
        self.reason = reason
        self.browser = browser
        self.endpoint = endpoint
        self.close_error: str | None = None


def port_from_dword(dword: int) -> int:
    """MIB_TCPROW 端口：低 16 位为网络字节序。不可右移 16 位（会把常见值解成 0）。"""
    return socket.ntohs(int(dword) & 0xFFFF)


def parse_endpoint(endpoint: str) -> tuple[str, int]:
    raw = endpoint.strip()
    if "://" not in raw:
        raw = "http://" + raw
    u = urlparse(raw)
    if not u.hostname or u.port is None:
        raise ValueError(f"无法解析 CDP endpoint（需含主机与端口）：{endpoint!r}")
    return u.hostname, int(u.port)


def listener_aliases(host: str, port: int) -> list[tuple[str, int]]:
    """同一环回监听在 IPv4/IPv6 上的别名，用来筛目标元组，不把别的地址上的同号端口算进来。"""
    h = host.lower()
    aliases = {(h, port)}
    if h in ("127.0.0.1", "localhost", "::1"):
        aliases.update({("127.0.0.1", port), ("::1", port), ("localhost", port)})
    return sorted(aliases)


def _ipv4_addr(dword: int) -> str:
    return socket.inet_ntoa(struct.pack("=I", int(dword) & 0xFFFFFFFF))


def _ipv6_addr(raw: bytes) -> str:
    return socket.inet_ntop(socket.AF_INET6, bytes(raw))


def _row(af: str, laddr: str, lp: int, raddr: str, rp: int, pid: int, listeners: set[tuple[str, int]]) -> dict | None:
    local, remote = (laddr, lp), (raddr, rp)
    if local in listeners:
        direction = "local-is-target-listener"
    elif remote in listeners:
        direction = "remote-is-target-listener"
    else:
        return None
    return {
        "af": af,
        "local_addr": laddr,
        "local_port": lp,
        "remote_addr": raddr,
        "remote_port": rp,
        "pid": pid,
        "direction": direction,
        "kind": "connection_to_target_listener",
    }


def _load_table(af: int, row_cls):
    iphlpapi = ctypes.WinDLL("iphlpapi")
    size = wintypes.DWORD(0)
    iphlpapi.GetExtendedTcpTable(None, ctypes.byref(size), False, af, TCP_TABLE_OWNER_PID_ALL, 0)
    if size.value == 0:
        raise OSError(f"GetExtendedTcpTable 未返回缓冲大小 af={af}")
    buf = ctypes.create_string_buffer(size.value)
    err = iphlpapi.GetExtendedTcpTable(buf, ctypes.byref(size), False, af, TCP_TABLE_OWNER_PID_ALL, 0)
    if err != 0:
        raise OSError(f"GetExtendedTcpTable 失败 af={af} err={err}")
    num = ctypes.cast(buf, ctypes.POINTER(wintypes.DWORD)).contents.value
    rows_t = row_cls * max(num, 1)

    class TABLE_N(ctypes.Structure):
        _fields_ = [("num", wintypes.DWORD), ("rows", rows_t)]

    return ctypes.cast(buf, ctypes.POINTER(TABLE_N)).contents


def _tcp_rows_ipv4(listeners: set[tuple[str, int]]) -> list[dict]:
    class ROW(ctypes.Structure):
        _fields_ = [
            ("state", wintypes.DWORD),
            ("local_addr", wintypes.DWORD),
            ("local_port", wintypes.DWORD),
            ("remote_addr", wintypes.DWORD),
            ("remote_port", wintypes.DWORD),
            ("owning_pid", wintypes.DWORD),
        ]

    table = _load_table(AF_INET, ROW)
    out = []
    for i in range(table.num):
        r = table.rows[i]
        if r.state != MIB_TCP_STATE_ESTAB:
            continue
        row = _row(
            "ipv4",
            _ipv4_addr(r.local_addr), port_from_dword(r.local_port),
            _ipv4_addr(r.remote_addr), port_from_dword(r.remote_port),
            int(r.owning_pid), listeners,
        )
        if row:
            out.append(row)
    return out


def _tcp_rows_ipv6(listeners: set[tuple[str, int]]) -> list[dict]:
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

    table = _load_table(AF_INET6, ROW)
    out = []
    for i in range(table.num):
        r = table.rows[i]
        if r.state != MIB_TCP_STATE_ESTAB:
            continue
        row = _row(
            "ipv6",
            _ipv6_addr(bytes(r.local_addr)), port_from_dword(r.local_port),
            _ipv6_addr(bytes(r.remote_addr)), port_from_dword(r.remote_port),
            int(r.owning_pid), listeners,
        )
        if row:
            out.append(row)
    return out


def parse_netstat_lines(text: str, listeners: set[tuple[str, int]], af_label: str) -> list[dict]:
    out = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 5 or "ESTABLISHED" not in parts:
            continue
        try:
            i = parts.index("ESTABLISHED")
            local, remote, pid = parts[i - 2], parts[i - 1], int(parts[i + 1])
        except (ValueError, IndexError):
            continue
        def split_addr(addr: str) -> tuple[str, int] | None:
            if addr.count(":") < 1:
                return None
            host, _, port_s = addr.rpartition(":")
            if not port_s.isdigit():
                return None
            host = host.strip("[]")
            return host, int(port_s)
        l, r = split_addr(local), split_addr(remote)
        if not l or not r:
            continue
        row = _row(af_label, l[0], l[1], r[0], r[1], pid, listeners)
        if row:
            out.append(row)
    return out


def _netstat_dual(listeners: set[tuple[str, int]]) -> list[dict]:
    errors = []
    rows: list[dict] = []
    for proto, label in (("tcp", "netstat-tcp"), ("tcpv6", "netstat-tcpv6")):
        try:
            raw = subprocess.check_output(
                ["netstat", "-ano", "-p", proto], text=True, errors="replace",
            )
        except Exception as e:  # noqa: BLE001
            errors.append(f"{proto}: {e}")
            continue
        rows.extend(parse_netstat_lines(raw, listeners, label))
    if errors and (len(errors) == 2 or not rows and errors):
        # 两个协议都失败，或一个失败且无法认定已完整：由调用方 fail-closed
        raise OSError("netstat 双栈 fallback 不完整：" + "; ".join(errors))
    if errors:
        # 一栈成功、另一栈失败仍不完整
        raise OSError("netstat 双栈 fallback 不完整：" + "; ".join(errors))
    return rows


def survey_connections_to_listeners(listeners: list[tuple[str, int]]) -> dict:
    """普查连到目标监听元组的 ESTABLISHED。ok=False 表示不能据此声称已断开。"""
    if not listeners:
        raise ValueError("目标监听元组为空，不能声称已断开")
    wanted = set()
    for host, port in listeners:
        if port is None:
            raise ValueError("目标端口为 None，不能普查")
        wanted.update(listener_aliases(host, int(port)))
    native_err: list[str] = []
    rows: list[dict] = []
    for name, fn in (("ipv4", _tcp_rows_ipv4), ("ipv6", _tcp_rows_ipv6)):
        try:
            rows.extend(fn(wanted))
        except OSError as e:
            native_err.append(f"{name}: {e}")
    if not native_err:
        return {
            "ok": True,
            "source": "GetExtendedTcpTable",
            "listeners": sorted(wanted),
            "connections_to_target_listeners": rows,
            "n": len(rows),
            "error": None,
        }
    # 任一家族失败：不用另一家族的部分结果冒充完整零
    try:
        fb = _netstat_dual(wanted)
    except OSError as e:
        return {
            "ok": False,
            "source": "incomplete",
            "listeners": sorted(wanted),
            "connections_to_target_listeners": [],
            "n": None,
            "error": f"原生表不完整（{'; '.join(native_err)}）；fallback 亦失败：{e}",
        }
    return {
        "ok": True,
        "source": "netstat-dual-fallback",
        "listeners": sorted(wanted),
        "connections_to_target_listeners": fb,
        "n": len(fb),
        "error": None,
        "native_error": native_err,
    }


class CdpRegistry:
    def __init__(self) -> None:
        self._n = 0
        self.leases: list[CdpLease] = []
        self.log: list[dict] = []
        self.endpoints: set[str] = set()

    def add(self, browser: Any, reason: str, *, endpoint: str) -> CdpLease:
        host, port = parse_endpoint(endpoint)
        ep = f"http://{host}:{port}"
        def _compatible(known: str) -> bool:
            kh, kp = parse_endpoint(known)
            if kp != port:
                return False
            return bool(set(listener_aliases(host, port)) & set(listener_aliases(kh, kp)))
        if self.endpoints and not all(_compatible(x) for x in self.endpoints):
            known = sorted(self.endpoints)
            raise ValueError(f"拒绝登记不同 CDP endpoint：{ep} 不在已登记目标 {known} 中")
        self._n += 1
        lease = CdpLease(self._n, reason, browser, ep)
        self.leases.append(lease)
        self.endpoints.add(ep)
        self.log.append({"op": "open", "id": lease.id, "reason": reason, "endpoint": ep})
        return lease

    def listeners(self) -> list[tuple[str, int]]:
        out = []
        for ep in self.endpoints:
            out.append(parse_endpoint(ep))
        return out

    def _close_lease(self, lease: CdpLease, reason: str) -> str | None:
        """成功才从所有权移除。失败保留租约并返回错误。"""
        err = None
        try:
            if lease.browser is not None:
                try:
                    connected = bool(lease.browser.is_connected())
                except Exception:  # noqa: BLE001
                    connected = True
                if connected:
                    lease.browser.close()  # transport.closeAndWait，不杀应用
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {e}"
            lease.close_error = err
        self.log.append({"op": "close", "id": lease.id, "reason": reason, "endpoint": lease.endpoint, "error": err})
        if err is None:
            self.leases = [x for x in self.leases if x is not lease]
            self._prune_endpoints()
        return err

    def _prune_endpoints(self) -> None:
        """endpoints 只反映仍持有的租约。成功关闭后必须丢掉旧端口，否则 AppSession.start()
        给新进程分配新端口时会被「拒绝登记不同 CDP endpoint」误杀（关闭失败则租约仍在，端口保留）。"""
        live = {parse_endpoint(lease.endpoint)[1] for lease in self.leases}
        self.endpoints = {ep for ep in self.endpoints if parse_endpoint(ep)[1] in live}

    def disconnect(self, browser: Any, reason: str) -> list[str]:
        errors = []
        for lease in list(self.leases):
            if lease.browser is browser:
                err = self._close_lease(lease, reason)
                if err:
                    errors.append(f"id={lease.id} {lease.reason}: {err}")
        return errors

    def disconnect_all(self, reason: str) -> list[str]:
        errors = []
        for lease in list(self.leases):
            err = self._close_lease(lease, reason)
            if err:
                errors.append(f"id={lease.id} {lease.reason}: {err}")
        return errors

    def snapshot(self) -> list[dict]:
        out = []
        for lease in self.leases:
            try:
                connected = bool(lease.browser.is_connected())
            except Exception as e:  # noqa: BLE001
                connected = f"err:{type(e).__name__}"
            out.append({
                "id": lease.id,
                "reason": lease.reason,
                "endpoint": lease.endpoint,
                "connected": connected,
                "close_error": lease.close_error,
            })
        return out
