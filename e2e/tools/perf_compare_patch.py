#!/usr/bin/env python3
"""Working-tree patches used only by the perf-compare workflow.

Not product code. Applied after checking out a SHA, then rebuilt.
"""
from __future__ import annotations

import argparse
from pathlib import Path

IDLE_NEEDLE = "PIN_IDLE_WINDOW_S = 120"
GLASS_NEEDLE = "pub(crate) fn apply_glass_effect(window: &WebviewWindow) {\n"
GLASS_INSERT = (
    GLASS_NEEDLE
    + "    // PERF-COMPARE only: skip Acrylic and leave data-quick-hidden so the CSS\n"
    + "    // backdrop-filter fallback also stays off. Controller is still shown.\n"
    + "    // Window transparency (ensure_window) is left unchanged so this run isolates\n"
    + "    // 毛玻璃, not the transparent HWND itself.\n"
    + "    #[cfg(windows)]\n"
    + "    set_controller_visible(window, true);\n"
    + "    return;\n"
)


def shorten_idle() -> None:
    path = Path("e2e/tests/ui/test_pin.py")
    text = path.read_text(encoding="utf-8")
    if IDLE_NEEDLE not in text:
        raise SystemExit(f"{IDLE_NEEDLE!r} not found in {path}")
    path.write_text(text.replace(IDLE_NEEDLE, "PIN_IDLE_WINDOW_S = 1"), encoding="utf-8")
    print("patched PIN_IDLE_WINDOW_S 120 -> 1 (memory is recorded before idle)")


def disable_glass() -> None:
    path = Path("src-tauri/src/quick.rs")
    text = path.read_text(encoding="utf-8")
    if "PERF-COMPARE only" in text:
        print("apply_glass_effect already patched")
        return
    if GLASS_NEEDLE not in text:
        raise SystemExit(f"apply_glass_effect signature not found in {path}")
    path.write_text(text.replace(GLASS_NEEDLE, GLASS_INSERT, 1), encoding="utf-8")
    print("patched apply_glass_effect to no-op (SetIsVisible(true), no acrylic, hidden attr kept)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--idle", action="store_true", help="shorten pin idle window")
    parser.add_argument("--glass-off", action="store_true", help="disable acrylic + CSS blur")
    args = parser.parse_args()
    if not args.idle and not args.glass_off:
        raise SystemExit("pass --idle and/or --glass-off")
    if args.idle:
        shorten_idle()
    if args.glass_off:
        disable_glass()


if __name__ == "__main__":
    main()
