"""Tests of the real read-only physical-input adapter; no desktop required."""
import ctypes
import importlib.util
from pathlib import Path

import pytest


class Call:
    def __init__(self, fn):
        self.fn = fn

    def __call__(self, *args):
        return self.fn(*args)


@pytest.fixture
def adapter(monkeypatch):
    class Native:
        point = (10, 20)
        left = False
        gui_ok = True

        def __init__(self):
            self.calls = []
            for name, fn in {
                "SetProcessDpiAwarenessContext": lambda *_: True,
                "WindowFromPoint": lambda _point: 101,
                "GetAncestor": lambda _hwnd, _kind: 100,
                "GetForegroundWindow": lambda: 44,
                "GetWindowThreadProcessId": self.identity,
                "GetClassNameW": self.class_name,
                "GetGUIThreadInfo": self.gui,
                "GetAsyncKeyState": lambda key: 0x8000 if key == 1 and self.left else 0,
                "GetCursorPos": self.cursor,
                "GetSystemMetrics": lambda key: {76: 0, 77: 0, 78: 1920, 79: 1080}[key],
            }.items():
                setattr(self, name, Call(fn))

        def identity(self, hwnd, pid):
            pid._obj.value = {101: 202, 100: 200, 44: 88}[hwnd]
            return {101: 303, 100: 300, 44: 99}[hwnd]

        def class_name(self, hwnd, buf, _size):
            buf.value = {101: "Chrome_WidgetWin_0", 100: "Tauri Window", 44: "Other"}[hwnd]
            return len(buf.value)

        def cursor(self, ptr):
            ptr._obj.x, ptr._obj.y = self.point
            return True

        def gui(self, tid, ptr):
            self.calls.append(("gui", tid))
            if self.gui_ok:
                ptr._obj.hwndCapture = 101
                ptr._obj.hwndMoveSize = 100
            return self.gui_ok

    native = Native()
    monkeypatch.setattr(ctypes, "WinDLL", lambda *_a, **_k: native, raising=False)
    monkeypatch.setattr(ctypes, "WINFUNCTYPE", ctypes.CFUNCTYPE, raising=False)
    path = Path(__file__).resolve().parents[2] / "win" / "win32.py"
    spec = importlib.util.spec_from_file_location("trace_adapter_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, native


def test_snapshot_preserves_distinct_leaf_root_foreground_and_capture(adapter):
    module, native = adapter
    value = module.input_snapshot(10, 20)
    assert value["leaf"] == {"hwnd": 101, "pid": 202, "tid": 303, "class": "Chrome_WidgetWin_0"}
    assert value["root"] == {"hwnd": 100, "pid": 200, "tid": 300, "class": "Tauri Window"}
    assert value["foreground"]["hwnd"] == 44
    assert value["gui"]["capture"] == 101
    assert value["gui"]["moveSize"] == 100
    assert native.calls == [("gui", 303), ("gui", 99)]
    assert value["foregroundGui"]["ok"] is True


def test_failed_gui_query_does_not_claim_no_capture(adapter):
    module, native = adapter
    native.gui_ok = False
    value = module.input_snapshot(10, 20)
    assert value["gui"]["ok"] is False
    assert value["leaf"]["hwnd"] == 101


def prepare_drag(module, native, monkeypatch):
    def move(x, y):
        native.point = (x, y)
    monkeypatch.setattr(module, "mouse_move", move)
    monkeypatch.setattr(module, "mouse_down", lambda: setattr(native, "left", True))
    monkeypatch.setattr(module, "mouse_up", lambda: setattr(native, "left", False))
    pauses = []
    monkeypatch.setattr(module.time, "sleep", pauses.append)
    return pauses


def test_actual_drag_records_pressed_state_without_activation_or_extra_wait(adapter, monkeypatch):
    module, native = adapter
    pauses = prepare_drag(module, native, monkeypatch)
    trace = []
    module.drag(10, 20, 30, 40, steps=2, input_trace=trace)
    assert [x["phase"] for x in trace] == ["positioned", "pressed", "released"]
    assert [x["keysDown"]["left"] for x in trace] == [False, True, False]
    assert [x["cursor"] for x in trace] == [(10, 20), (10, 20), (30, 40)]
    assert pauses == [0.12, 0.15, 0.015, 0.015, 0.15, 0.3]
    assert native.point == (30, 40) and not native.left


def test_other_drag_callers_do_not_gain_observers(adapter, monkeypatch):
    module, native = adapter
    prepare_drag(module, native, monkeypatch)
    def forbidden(*_args):
        raise AssertionError("trace must be opt-in")
    monkeypatch.setattr(module, "input_snapshot", forbidden)
    module.drag(10, 20, 30, 40, steps=1)
    assert not native.left


def test_observer_failure_after_press_still_releases_button(adapter, monkeypatch):
    module, native = adapter
    prepare_drag(module, native, monkeypatch)
    real_snapshot = module.input_snapshot
    def fail_pressed(*args):
        if native.left:
            raise RuntimeError("native query failed")
        return real_snapshot(*args)
    monkeypatch.setattr(module, "input_snapshot", fail_pressed)
    with pytest.raises(RuntimeError, match="native query failed"):
        module.drag(10, 20, 30, 40, steps=1, input_trace=[])
    assert not native.left


@pytest.mark.parametrize("attempted", [False, True])
def test_stealth_evidence_does_not_hide_any_existing_violation(monkeypatch, attempted):
    from types import SimpleNamespace
    from harness import stealth
    probe = iter([attempted, True])
    stops = iter([False, True])
    calls = []
    native = SimpleNamespace(
        GetWindowLongPtrW=lambda *_: stealth.WS_EX_TOOLWINDOW | stealth.WS_EX_NOACTIVATE,
        IsZoomed=lambda *_: False,
        SetWindowPos=lambda *args: calls.append(args) or True,
        GetForegroundWindow=lambda: 99,
        IsWindowVisible=lambda *_: True,
    )
    monkeypatch.setattr(stealth, "user32", native, raising=False)
    monkeypatch.setattr(stealth, "_windows_under", lambda _root: [1])
    monkeypatch.setattr(stealth, "on_screen", lambda _hwnd: next(probe))
    monkeypatch.setattr(stealth, "_rect", lambda _hwnd: (660, 120, 1000, 600))
    monkeypatch.setattr(stealth.time, "sleep", lambda _delay: None)
    guard = object.__new__(stealth.Guard)
    guard.root = "sandbox"
    guard.stop_evt = SimpleNamespace(is_set=lambda: next(stops))
    guard.violations = []
    guard.fg_stolen = guard.samples = 0
    guard.interval = 0.01
    guard._run()
    assert len(guard.violations) == 1
    assert f"'moveAttempted': {attempted}" in guard.violations[0]
    assert bool(calls) == attempted
