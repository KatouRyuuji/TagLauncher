import { describe, expect, it } from "vitest";
import { captureShortcut, formatShortcut } from "./desktopShortcut";

const key = (code: string, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {}, keyName = code) => ({
  key: keyName,
  code,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta,
});

describe("全局快捷键录制", () => {
  it("只按修饰键时继续等待，Esc 取消", () => {
    expect(captureShortcut(key("ControlLeft", { ctrl: true }, "Control"))).toEqual({ kind: "pending" });
    expect(captureShortcut(key("Escape", {}, "Escape"))).toEqual({ kind: "cancel" });
  });

  it("按物理键 code 生成加速键，修饰键顺序固定", () => {
    expect(captureShortcut(key("KeyK", { alt: true, ctrl: true, shift: true }, "K"))).toEqual({ kind: "ok", accelerator: "Ctrl+Alt+Shift+KeyK" });
    expect(captureShortcut(key("Space", { meta: true }, " "))).toEqual({ kind: "ok", accelerator: "Super+Space" });
  });

  it("单键与只加 Shift 不接受", () => {
    expect(captureShortcut(key("KeyK", {}, "k")).kind).toBe("invalid");
    expect(captureShortcut(key("KeyK", { shift: true }, "K")).kind).toBe("invalid");
  });

  it("友好显示", () => {
    expect(formatShortcut("Ctrl+Alt+KeyK")).toBe("Ctrl + Alt + K");
    expect(formatShortcut("Super+Space")).toBe("Win + 空格");
    expect(formatShortcut("Ctrl+Digit1")).toBe("Ctrl + 1");
  });
});
