"""测试夹具文件：合法的最小样本 + 安全启动目标（只写 marker，不做别的）。"""
from __future__ import annotations

import base64
import io
import shutil
import struct
import subprocess
import wave
import zlib
from pathlib import Path

from .paths import E2E, TMP

MARKER_RS = E2E / "fixtures" / "targets" / "marker.rs"


def png_bytes(w: int = 4, h: int = 3, rgb=(200, 60, 60)) -> bytes:
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def jpg_bytes(w: int = 8, h: int = 6) -> bytes:
    try:
        from PIL import Image
        buf = io.BytesIO()
        Image.new("RGB", (w, h), (40, 120, 200)).save(buf, "JPEG")
        return buf.getvalue()
    except Exception:  # 1×1 基线 JPEG
        return base64.b64decode(
            "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==")


def wav_bytes(ms: int = 200) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"\x00\x00" * (8 * ms))
    return buf.getvalue()


def mp3_bytes() -> bytes:
    # ID3v2 头 + 若干 MPEG1 Layer3 静音帧（足以被识别为 mp3；只用于类型识别）
    frame = b"\xff\xfb\x90\x64" + b"\x00" * 413
    return b"ID3\x03\x00\x00\x00\x00\x00\x00" + frame * 4


def mp4_bytes() -> bytes:
    ftyp = struct.pack(">I", 24) + b"ftypisom" + struct.pack(">I", 0x200) + b"isomiso2"
    return ftyp + struct.pack(">I", 8) + b"free"


def write(path: Path, data: bytes | str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(data, str):
        path.write_text(data, encoding="utf-8")
    else:
        path.write_bytes(data)
    return path


def marker_bat(path: Path) -> Path:
    """.bat：把自身名字写进同目录 <stem>.marker，然后退出。"""
    # 名字/路径整体加引号写出（文件名可能含 & 等元字符；本体只写 ASCII，非 ASCII 名会按 ANSI 代码页落盘）
    body = "@echo off\r\n>\"%~dpn0.marker\" echo ran \"%~nx0\" cwd=\"%CD%\"\r\nexit /b 0\r\n"
    return write(path, body.encode("ascii", "replace"))


_marker_exe_cache: Path | None = None


def build_marker_exe() -> Path:
    """rustc 编译一个 windows 子系统的小程序：在自身旁写 <stem>.marker（含 cwd 与参数）。"""
    global _marker_exe_cache
    if _marker_exe_cache and _marker_exe_cache.exists():
        return _marker_exe_cache
    out = TMP / "build" / "marker.exe"
    if not out.exists() or out.stat().st_mtime < MARKER_RS.stat().st_mtime:
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["rustc", "-O", "-C", "debuginfo=0", str(MARKER_RS), "-o", str(out)],
                       check=True, capture_output=True, cwd=out.parent)
    _marker_exe_cache = out
    return out


def marker_exe(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(build_marker_exe(), path)
    return path


def marker_of(target: Path) -> Path:
    return target.with_suffix(".marker")


def type_zoo(root: Path) -> dict[str, Path]:
    """E-OBJ-10：每种类型一个合法最小样本。"""
    root.mkdir(parents=True, exist_ok=True)
    folder = root / "示例文件夹"
    folder.mkdir(exist_ok=True)
    return {
        "folder": folder,
        "png": write(root / "图片.png", png_bytes()),
        "jpg": write(root / "照片.jpg", jpg_bytes()),
        "mp3": write(root / "音乐.mp3", mp3_bytes()),
        "wav": write(root / "声音.wav", wav_bytes()),
        "mp4": write(root / "视频.mp4", mp4_bytes()),
        "exe": marker_exe(root / "工具.exe"),
        "bat": marker_bat(root / "脚本.bat"),
        "ps1": write(root / "脚本.ps1", "Write-Output 'noop'\n"),
        "txt": write(root / "笔记.txt", "hello\n"),
        "md": write(root / "说明.md", "# title\n"),
        "noext": write(root / "LICENSE", "MIT\n"),
    }


def wait_marker(target: Path, timeout: float = 15) -> str:
    """等待 marker 程序/脚本写出 <stem>.marker，返回内容。"""
    import time
    m = marker_of(target)
    deadline = time.time() + timeout
    while time.time() < deadline:
        if m.exists():
            try:
                text = m.read_text(encoding="utf-8", errors="replace").strip()
                if text:
                    return text
            except OSError:
                pass
        time.sleep(0.2)
    raise AssertionError(f"marker 未出现：{m}")
