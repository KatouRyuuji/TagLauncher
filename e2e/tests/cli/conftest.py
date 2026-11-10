from __future__ import annotations

import json
import shutil
import subprocess

import pytest


class Tl:
    """沙箱内的 tl.exe：与 GUI 同目录，按 exe 旁 datapath.json / 沙箱 LOCALAPPDATA 定位库。"""

    def __init__(self, sandbox, cli_src):
        self.sb = sandbox
        self.exe = sandbox.bin / "tl.exe"
        if not self.exe.exists():
            shutil.copy2(cli_src, self.exe)

    def ensure_db(self) -> None:
        """空文件即可：Database::new 会建表并跑完迁移。"""
        self.sb.db_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.sb.db_path.exists():
            self.sb.db_path.touch()

    def run(self, *args, check: bool = True, input: str | None = None, timeout: float = 60):
        proc = subprocess.run([str(self.exe), *map(str, args)], cwd=self.sb.bin, env=self.sb.env(None),
                              capture_output=True, input=input.encode("utf-8") if input is not None else None,
                              timeout=timeout)
        proc.out = proc.stdout.decode("utf-8", "replace")
        proc.err = proc.stderr.decode("utf-8", "replace")
        if check and proc.returncode != 0:
            raise AssertionError(f"tl {args} 退出码 {proc.returncode}: {proc.err}")
        return proc

    def json(self, *args):
        return json.loads(self.run("--json", *args).out)


@pytest.fixture
def tl(sandbox, cli_path):
    if not cli_path.exists():
        pytest.fail(f"找不到 tl.exe：{cli_path}（cargo build --bin tl 或 tauri build 产物）")
    return Tl(sandbox, cli_path)
