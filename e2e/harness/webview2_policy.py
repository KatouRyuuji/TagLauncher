"""提权宿主下的 WebView2 调试端口通道（仅 CI 一次性 runner 启用）。

WebView2 Runtime 150 起，宿主进程以管理员（High Integrity）运行时会忽略全部
WEBVIEW2_* 环境变量与 HKCU 策略，只认 HKLM 策略与应用经 API 传入的参数
（MicrosoftEdge/WebView2Feedback#5640、#5645）。GitHub Actions Windows runner 恒为提权，
因此沙箱用的 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS（含 --remote-debugging-port）被丢弃：
CI 实测（Runtime 156、elevated=True）msedgewebview2 命令行只有 wry 经 API 传的
--disable-features=msWebOOUI,...，无调试端口；进程与窗口都在，但 CDP 端口永不监听。

启用条件：Windows + 当前进程已提权 + TL_E2E_WEBVIEW2_HKLM_POLICY=1（只在 workflow 里设）。
本机非提权运行仍走环境变量，绝不写用户机器的 HKLM。每次启动前把本次端口写入
HKLM\\Software\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments；
start() 等到 CDP 就绪才返回，下一次启动才会改写，顺序启动互不干扰。会话结束删除该值。
"""
from __future__ import annotations

import os

KEY = r"Software\Policies\Microsoft\Edge\WebView2"
VALUE = "AdditionalBrowserArguments"


def is_elevated() -> bool:
    if os.name != "nt":
        return False
    import ctypes
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except OSError:
        return False


def enabled() -> bool:
    return os.environ.get("TL_E2E_WEBVIEW2_HKLM_POLICY") == "1" and is_elevated()


def set_args(args: str) -> None:
    import winreg
    with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, KEY, 0, winreg.KEY_SET_VALUE | winreg.KEY_WOW64_64KEY) as k:
        winreg.SetValueEx(k, VALUE, 0, winreg.REG_SZ, args)


def clear() -> None:
    if os.name != "nt":
        return
    import winreg
    try:
        with winreg.OpenKeyEx(winreg.HKEY_LOCAL_MACHINE, KEY, 0, winreg.KEY_SET_VALUE | winreg.KEY_WOW64_64KEY) as k:
            winreg.DeleteValue(k, VALUE)
    except FileNotFoundError:
        pass
