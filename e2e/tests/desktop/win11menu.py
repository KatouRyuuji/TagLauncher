"""Win11 一级右键菜单（未签名稀疏包 TagLauncher.ShellMenu）的 E2E 辅助：查询/卸载包、PackagedCom 键、
资源管理器 UIA 右键探针（shell-ext/win11-menu/ui_probe.ps1）、让 dllhost 加载 DLL。只在临时 runner 上用。"""
from __future__ import annotations

import json
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
    err = r.stderr.decode("utf-8", "replace")
    prefix = f"W11MENU ui_{tag}_"
    res = {"returncode": str(r.returncode)}
    for line in out.splitlines():
        if line.startswith(prefix):
            k, _, v = line[len(prefix):].partition("=")
            res[k] = v
    if err.strip():
        res["stderr"] = err.strip().replace("\n", " ")[:500]
        print(f"WIN11_MENU_UI_STDERR {tag} rc={r.returncode} {res['stderr']}")
    print(f"WIN11_MENU_UI {tag} " + " ".join(f"{k}={v[:300]}" for k, v in res.items()))
    return res


def known_local_appdata() -> Path | None:
    """SHGetKnownFolderPath 的 LocalAppData，不用进程环境 LOCALAPPDATA（沙箱可能不同）。"""
    r = ps("[Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)")
    p = r.stdout.decode("utf-8", "replace").strip()
    return Path(p) if p else None


def _oserr_code(exc: OSError) -> str:
    code = getattr(exc, "winerror", None)
    if code is None:
        code = getattr(exc, "errno", None)
    return f"{type(exc).__name__}:{code if code is not None else 'unknown'}"


def _tail_lines(path: Path, limit: int, tail_bytes: int = 65536) -> tuple[str, list[str]]:
    """只读文件尾部有限字节，不先把全文件读进内存；错误只含类型/数值码，不含路径。"""
    try:
        size = path.stat().st_size
        with path.open("rb") as f:
            if size > tail_bytes:
                f.seek(size - tail_bytes)
            data = f.read()
        if size > tail_bytes:
            nl = data.find(b"\n")
            if nl >= 0:
                data = data[nl + 1:]
        lines = data.decode("utf-8", "replace").splitlines()
        return "ok", lines[-limit:]
    except OSError as e:
        return f"err:{_oserr_code(e)}", []


def delivery_log_text(limit: int = 40) -> str:
    """只读交付 jsonl / 状态行尾部（哈希与 PID，不含用户路径原文）。"""
    base = known_local_appdata()
    if not base:
        return "known_local_appdata=missing"
    chunks = []
    for name in ("win11-menu-delivery.jsonl", "win11-menu-status.txt"):
        path = base / "TagLauncher" / name
        try:
            exists = path.is_file()
        except OSError as e:
            chunks.append(f"{name}=err:{_oserr_code(e)}")
            continue
        if not exists:
            chunks.append(f"{name}=missing")
            continue
        status, lines = _tail_lines(path, limit)
        if status != "ok":
            chunks.append(f"{name}={status}")
        else:
            chunks.append(f"{name} tail_lines={len(lines)} tail=" + " | ".join(lines))
    return " ; ".join(chunks)



_SAFE_DELIVERY_KEYS = (
    "event",
    "req",
    "merge_committed",
    "pending",
    "path_count",
    "session_id",
    "invalid",
    "arrival",
    "receiver_pid",
    "error",
)


def delivery_jsonl_lines(limit: int = 80) -> list[str]:
    """读取交付 jsonl 尾部原始行，失败时返回空列表。"""
    base = known_local_appdata()
    if not base:
        return []
    path = base / "TagLauncher" / "win11-menu-delivery.jsonl"
    status, lines = _tail_lines(path, limit)
    return lines if status == "ok" else []


def sanitize_delivery_record(obj: dict) -> dict:
    """失败输出只用安全字段，不含路径原文或其他用户数据。"""
    return {key: obj.get(key) for key in _SAFE_DELIVERY_KEYS}


def new_delivery_records(before: list[str], after: list[str]) -> list[dict]:
    seen = set(before)
    records = []
    for line in after:
        if line in seen or not line.lstrip().startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            records.append(obj)
    return records


def format_delivery_failure(records: list[dict], limit: int = 12) -> str:
    shown = [sanitize_delivery_record(obj) for obj in records[-limit:]]
    return json.dumps(shown, ensure_ascii=False, separators=(",", ":"))


def assert_same_nonce_merge_committed(before: list[str], after: list[str]) -> dict:
    """断言本次点击新增记录里，同一 nonce 有 merge_committed=true，且未混入点击前的旧日志。"""
    new = new_delivery_records(before, after)
    launches = [obj for obj in new if obj.get("event") == "launch" and obj.get("req")]
    merges = [obj for obj in new if obj.get("event") == "merge_committed"]
    if not launches:
        raise AssertionError(
            f"本次点击的新增交付记录里没有 launch/req，不能绑定 nonce。new={format_delivery_failure(new)}"
        )
    req = str(launches[-1]["req"]).lower()
    matched = [
        obj
        for obj in merges
        if str(obj.get("req") or "").lower() == req and obj.get("merge_committed") is True
    ]
    if not matched:
        raise AssertionError(
            f"未找到 req={req} 的 merge_committed=true 回执。new={format_delivery_failure(new)}"
        )
    receipt = matched[-1]
    if receipt.get("path_count") != 1:
        raise AssertionError(
            f"req={req} 的 merge_committed path_count 应为 1，实际 {receipt.get('path_count')}。new={format_delivery_failure(new)}"
        )
    return receipt


def file_unlocked(path: Path) -> bool:
    """能以独占方式改名（自己改回自己）= 没有进程占用该 DLL。"""
    tmp = path.with_suffix(path.suffix + ".probe")
    try:
        path.rename(tmp)
        tmp.rename(path)
        return True
    except OSError:
        return False
