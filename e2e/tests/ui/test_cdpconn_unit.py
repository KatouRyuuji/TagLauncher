"""CDP 登记 / 端口字段 / 目标监听元组筛查：不启动应用即可跑。

可独立：在 e2e 目录执行
  python -m pytest tests/ui/test_cdpconn_unit.py --noconftest -q
不依赖 exe，也不改变任何产品门槛。
"""
from __future__ import annotations

import socket

import pytest

from harness import cdpconn


def test_port_from_dword_uses_low_16_network_order():
    """MIB_TCPROW 端口在低 16 位网络序。右移 16 会把合法端口解成 0（假零）。"""
    for port in (1, 80, 443, 8080, 9222, 65535):
        packed = socket.htons(port)  # 低 16 位
        assert cdpconn.port_from_dword(packed) == port
        assert cdpconn.port_from_dword(packed | 0xABCD0000) == port  # 高 16 位应忽略
        # 回归：旧实现 ntohs((dword >> 16) & 0xFFFF) 对上述 packing 一律为 0
        assert socket.ntohs((packed >> 16) & 0xFFFF) == 0


def test_port_from_dword_high_shift_packing_is_not_the_port():
    """若错误地把端口放在高 16 位，正确解码不得把它当成端口号（常见值应解成 0）。"""
    wrong = socket.htons(9222) << 16
    assert cdpconn.port_from_dword(wrong) == 0
    assert socket.ntohs((wrong >> 16) & 0xFFFF) == 9222  # 旧错误解码才会得到 9222


def test_parse_endpoint_and_reject_incomplete():
    assert cdpconn.parse_endpoint("http://127.0.0.1:9222") == ("127.0.0.1", 9222)
    assert cdpconn.parse_endpoint("127.0.0.1:9222") == ("127.0.0.1", 9222)
    with pytest.raises(ValueError):
        cdpconn.parse_endpoint("http://127.0.0.1")  # 无端口


def test_survey_requires_listeners_and_port():
    with pytest.raises(ValueError, match="空"):
        cdpconn.survey_connections_to_listeners([])
    with pytest.raises(ValueError, match="None"):
        cdpconn.survey_connections_to_listeners([("127.0.0.1", None)])  # type: ignore[list-item]


def test_parse_netstat_filters_by_listener_tuple_not_any_same_port():
    listeners = set(cdpconn.listener_aliases("127.0.0.1", 9222))
    text = """
  TCP    127.0.0.1:9222        127.0.0.1:54321      ESTABLISHED     111
  TCP    10.0.0.5:9222         10.0.0.8:443         ESTABLISHED     222
  TCP    127.0.0.1:54321       127.0.0.1:9222       ESTABLISHED     333
  TCP    127.0.0.1:80          127.0.0.1:81         ESTABLISHED     444
  TCPv6  [::1]:9222            [::1]:60000          ESTABLISHED     555
"""
    rows = cdpconn.parse_netstat_lines(text, listeners, "netstat-tcp")
    pids = {r["pid"] for r in rows}
    assert pids == {111, 333, 555}
    assert 222 not in pids  # 同端口但不是目标监听地址
    assert 444 not in pids
    by_pid = {r["pid"]: r for r in rows}
    assert by_pid[111]["direction"] == "local-is-target-listener"
    assert by_pid[333]["direction"] == "remote-is-target-listener"
    assert by_pid[555]["direction"] == "local-is-target-listener"
    assert by_pid[111]["local_addr"] == "127.0.0.1"
    assert by_pid[111]["local_port"] == 9222
    assert by_pid[111]["kind"] == "connection_to_target_listener"


class _OkBrowser:
    def __init__(self):
        self.closed = False

    def is_connected(self):
        return not self.closed

    def close(self):
        self.closed = True


class _FailBrowser:
    def is_connected(self):
        return True

    def close(self):
        raise RuntimeError("close exploded")


def test_registry_records_endpoint_and_rejects_different_target():
    reg = cdpconn.CdpRegistry()
    reg.add(_OkBrowser(), "a", endpoint="http://127.0.0.1:9222")
    # 环回别名可接受
    reg.add(_OkBrowser(), "b", endpoint="http://localhost:9222")
    with pytest.raises(ValueError, match="不同 CDP endpoint"):
        reg.add(_OkBrowser(), "c", endpoint="http://127.0.0.1:9333")
    with pytest.raises(ValueError, match="不同 CDP endpoint"):
        reg.add(_OkBrowser(), "d", endpoint="http://10.0.0.5:9222")
    assert {cdpconn.parse_endpoint(e)[1] for e in reg.endpoints} == {9222}


def test_close_failure_keeps_lease_and_propagates():
    reg = cdpconn.CdpRegistry()
    bad = _FailBrowser()
    ok = _OkBrowser()
    reg.add(bad, "keep-me", endpoint="http://127.0.0.1:9222")
    reg.add(ok, "drop-me", endpoint="http://127.0.0.1:9222")
    errors = reg.disconnect_all("detach-all")
    assert errors, "关闭失败必须传播错误，不能把空登记表当成已断开"
    assert any("keep-me" in e for e in errors)
    reasons = {lease.reason for lease in reg.leases}
    assert "keep-me" in reasons
    assert "drop-me" not in reasons
    assert ok.closed is True
    snap = reg.snapshot()
    assert len(snap) == 1
    assert snap[0]["reason"] == "keep-me"
    assert snap[0]["close_error"]
    assert snap[0]["endpoint"] == "http://127.0.0.1:9222"


def test_successful_close_removes_lease():
    reg = cdpconn.CdpRegistry()
    b = _OkBrowser()
    reg.add(b, "app-connect", endpoint="http://127.0.0.1:9222")
    errors = reg.disconnect(b, "done")
    assert errors == []
    assert reg.leases == []
    assert b.closed is True
    assert reg.endpoints == set()


def test_new_process_port_allowed_after_successful_disconnect():
    """重启用例会给新进程换端口；旧租约成功关闭后应允许登记新 endpoint。关闭失败则仍拒绝。"""
    reg = cdpconn.CdpRegistry()
    first = _OkBrowser()
    reg.add(first, "app-connect", endpoint="http://127.0.0.1:9222")
    assert reg.disconnect_all("app-stop") == []
    assert reg.leases == []
    assert reg.endpoints == set()
    second = _OkBrowser()
    lease = reg.add(second, "app-connect", endpoint="http://127.0.0.1:9333")
    assert lease.endpoint == "http://127.0.0.1:9333"
    assert {cdpconn.parse_endpoint(e)[1] for e in reg.endpoints} == {9333}
    # 仍有活租约时换端口必须拒绝
    with pytest.raises(ValueError, match="不同 CDP endpoint"):
        reg.add(_OkBrowser(), "extra", endpoint="http://127.0.0.1:9444")
    # 关闭失败：旧端口保留，不能登记新进程端口
    reg2 = cdpconn.CdpRegistry()
    reg2.add(_FailBrowser(), "stuck", endpoint="http://127.0.0.1:9222")
    errors = reg2.disconnect_all("app-stop")
    assert errors
    with pytest.raises(ValueError, match="不同 CDP endpoint"):
        reg2.add(_OkBrowser(), "app-connect", endpoint="http://127.0.0.1:9333")


def test_empty_registry_is_not_disconnect_evidence_without_survey():
    """登记表空只说明本进程已无租约，不能单独当作目标端口已无连接的证据。"""
    reg = cdpconn.CdpRegistry()
    assert reg.snapshot() == []
    assert reg.listeners() == []


def test_assess_snapshot_rejects_capture_failure_without_proof():
    from harness.idle_diag import assess_snapshot
    failed = assess_snapshot({"ok": False, "error": "native idle diag window not found (FindWindowExW HWND_MESSAGE)"})
    assert failed["capture_ok"] is False
    assert failed["identity"] == "failed"
    silent = assess_snapshot({"ok": False, "windows": [], "generation": 1})
    assert silent["capture_ok"] is False
    assert "explicit" in silent["reason"] or "without explicit" in silent["reason"]


def test_assess_snapshot_allows_explicit_unknown_and_known():
    from harness.idle_diag import assess_snapshot
    unknown = assess_snapshot({
        "ok": False,
        "generation": 2,
        "processes_status": "UNKNOWN",
        "processes_reason": "interface-missing ICoreWebView2Environment13",
        "windows": [{
            "label": "main",
            "frame_id_status": "UNKNOWN: interface-missing ICoreWebView2_20",
            "mapping": {"status": "UNKNOWN", "reason": "interface-missing ICoreWebView2_20"},
        }],
    })
    assert unknown["capture_ok"] is True
    assert unknown["identity"] == "UNKNOWN"
    assert "interface-missing" in unknown["reason"]
    known = assess_snapshot({
        "ok": True,
        "generation": 3,
        "processes_status": "ok",
        "windows": [{
            "label": "main",
            "frame_id_status": "ok",
            "mapping": {"status": "ok", "frame_id": 5, "process": {"pid": 1, "kind": "Renderer"}},
        }],
    })
    assert known["capture_ok"] is True
    assert known["identity"] == "known"


def test_snapshot_path_uses_explicit_dir_not_process_temp(tmp_path, monkeypatch):
    from harness.idle_diag import snapshot_path
    monkeypatch.setenv("TEMP", str(tmp_path / "pytest-temp"))
    dest = snapshot_path(tmp_path / "sandbox-Temp", 123, 4)
    assert dest == tmp_path / "sandbox-Temp" / "TagLauncher-idle-diag-123-4.json"
    assert "pytest-temp" not in str(dest)


@pytest.mark.parametrize("created", [False, True])
def test_attached_pages_services_pending_target_events_before_local_getters(created):
    from types import SimpleNamespace
    target = SimpleNamespace(is_closed=lambda: False)
    state = {"serviced": False}
    class Browser:
        @property
        def contexts(self):
            assert state["serviced"], "cached target list read before protocol turn"
            return [SimpleNamespace(pages=[target] if created else [])]
    class MainPage:
        def evaluate(self, expression):
            assert expression == "() => null"
            state["serviced"] = True
    assert cdpconn.attached_pages_after_turn(Browser(), MainPage()) == ([target] if created else [])


def test_attached_pages_protocol_error_is_not_false_empty_success():
    class MainPage:
        def evaluate(self, _expression):
            raise RuntimeError("transport gone")
    with pytest.raises(RuntimeError, match="transport gone"):
        cdpconn.attached_pages_after_turn(object(), MainPage())
