"""前台替身进程：一个普通的 Tk 窗口，充当「资源管理器」这类持有前台权的程序。

用法：python fg_helper.py [--fullscreen]
启动后打印一行 JSON {"hwnd": ..., "pid": ...}，之后从 stdin 逐行读命令（JSON）：
- {"op": "startfile", "path": ..., "verb": "open"|<注册表动词>, "args": "..."}：ShellExecute，
  由本进程（前台）启动目标，和资源管理器调用右键动词 / 发送到时的父子关系一致；
- {"op": "quit"}。
每条命令回一行 JSON {"ok": true} 或 {"ok": false, "error": ...}。
"""
from __future__ import annotations

import json
import os
import sys
import threading
import tkinter as tk

root = tk.Tk()
root.title("TL-E2E-前台替身")
if "--fullscreen" in sys.argv:
    root.attributes("-fullscreen", True)
    root.attributes("-topmost", True)
else:
    root.geometry("360x200+40+40")
tk.Label(root, text="TagLauncher E2E foreground helper").pack(expand=True)
root.update()
hwnd = int(root.wm_frame(), 16)
print(json.dumps({"hwnd": hwnd, "pid": os.getpid()}), flush=True)


def handle(cmd: dict) -> dict:
    if cmd.get("op") == "startfile":
        if cmd.get("args"):
            os.startfile(cmd["path"], cmd.get("verb") or "open", cmd["args"])
        else:
            os.startfile(cmd["path"], cmd.get("verb") or "open")
        return {"ok": True}
    if cmd.get("op") == "quit":
        root.after(0, root.destroy)
        return {"ok": True}
    return {"ok": False, "error": f"unknown {cmd}"}


def reader():
    for line in sys.stdin:
        try:
            out = handle(json.loads(line))
        except Exception as e:  # noqa: BLE001
            out = {"ok": False, "error": repr(e)}
        print(json.dumps(out), flush=True)
    root.after(0, root.destroy)


threading.Thread(target=reader, daemon=True).start()
root.mainloop()
