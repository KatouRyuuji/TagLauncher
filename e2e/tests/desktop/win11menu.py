"""Win11 一级右键菜单（未签名稀疏包 TagLauncher.ShellMenu）的 E2E 辅助：查询/卸载包、PackagedCom 键、
资源管理器 UIA 右键探针（shell-ext/win11-menu/ui_probe.ps1）、让 dllhost 加载 DLL。只在临时 runner 上用。"""
from __future__ import annotations

import subprocess
from pathlib import Path

PACKAGE = "TagLauncher.ShellMenu"
CLSID = "6F3B7A51-2C1E-4E8B-9A57-3D8E1B4C9F21"
TITLE = "用 TagLauncher 收纳"
REPO = Path(__file__).resolve().parents[3]
UI_PROBE = REPO / "shell-ext" / "win11-menu" / "ui_probe.ps1"


def ps(script: str, timeout: float = 120) -> subprocess.CompletedProcess:
    full = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; " + script
    return subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", full],
                          capture_output=True, timeout=timeout)


def appx_version() -> str | None:
    r = ps(f"$p = Get-AppxPackage -Name {PACKAGE}; if ($p) {{ [string]$p.Version }}")
    v = r.stdout.decode("utf-8", "replace").strip()
    return v or None


def appx_remove() -> None:
    ps(f"Get-AppxPackage -Name {PACKAGE} | Remove-AppxPackage")


def packaged_com_registered() -> bool:
    import winreg
    try:
        winreg.CloseKey(winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, rf"PackagedCom\ClassIndex\{{{CLSID}}}"))
        return True
    except OSError:
        return False


def com_title() -> str:
    """普通进程激活进程外 COM 类（dllhost 加载 DLL）并取菜单文字；不调用 Invoke。"""
    script = (
        "Add-Type -TypeDefinition @'\n"
        "using System; using System.Runtime.InteropServices;\n"
        "[ComImport, Guid(\"a08ce4d0-fa25-44ab-b57c-c7b1c323e0b9\"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]\n"
        "public interface IExplorerCommandT { [PreserveSig] int GetTitle(IntPtr items, [MarshalAs(UnmanagedType.LPWStr)] out string name); }\n"
        "public static class TitleProbe { public static string Run(string clsid) {\n"
        "  var o = (IExplorerCommandT)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid(clsid), true));\n"
        "  string t; o.GetTitle(IntPtr.Zero, out t); return t; } }\n"
        "'@\n"
        f"[TitleProbe]::Run('{CLSID}')"
    )
    r = ps(script)
    assert r.returncode == 0, r.stderr.decode("utf-8", "replace")
    return r.stdout.decode("utf-8", "replace").strip()


def explorer_menu(folder: Path, name: str, shot: Path, tag: str, click: bool = False) -> dict:
    """资源管理器里右键 name，读 Win11 一级菜单（UIA）；click=True 时点我们的条目。返回 ui_probe 的 key→value。"""
    args = ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(UI_PROBE),
            "-Folder", str(folder), "-FileName", name, "-Title", TITLE, "-Shot", str(shot), "-Tag", tag]
    if click:
        args.append("-Click")
    r = subprocess.run(args, capture_output=True, timeout=180)
    out = r.stdout.decode("utf-8", "replace")
    prefix = f"W11MENU ui_{tag}_"
    res = {}
    for line in out.splitlines():
        if line.startswith(prefix):
            k, _, v = line[len(prefix):].partition("=")
            res[k] = v
    print(f"WIN11_MENU_UI {tag} " + " ".join(f"{k}={v[:300]}" for k, v in res.items()))
    return res


def file_unlocked(path: Path) -> bool:
    """能以独占方式改名（自己改回自己）= 没有进程占用该 DLL。"""
    tmp = path.with_suffix(path.suffix + ".probe")
    try:
        path.rename(tmp)
        tmp.rename(path)
        return True
    except OSError:
        return False
