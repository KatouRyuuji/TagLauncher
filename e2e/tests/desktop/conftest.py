"""desktop 层：把原先只能真机确认的项（右键菜单、发送到、前台、托盘、全局热键、安装卸载）
放到 GitHub Actions 的临时 Windows runner 上自动跑。

会写真实 HKCU、接管鼠标键盘、窗口必须真实可见并抢前台，所以只在 CI 的 desktop 作业里跑：
需同时设 TL_E2E_DESKTOP=1（以及 TL_E2E_ALLOW_PHYSICAL / TL_E2E_ALLOW_REGISTRY）。绝不在用户电脑上跑。
"""
from __future__ import annotations

import os

import pytest


@pytest.fixture(autouse=True)
def _desktop_gate():
    if os.environ.get("TL_E2E_DESKTOP") != "1":
        pytest.skip("desktop 层只在 CI 的 desktop 作业跑（TL_E2E_DESKTOP=1）：会写 HKCU、抢前台、接管输入")
    from harness import app as happ
    happ.STEALTH["on"] = False
    yield
    happ.STEALTH["on"] = True
