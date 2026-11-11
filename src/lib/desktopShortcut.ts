// ============================================================================
// lib/desktopShortcut.ts — 全局快捷键录制与显示（F18，纯逻辑）
// ============================================================================
// 录制结果写成后端可解析的加速键串（修饰键 + KeyboardEvent.code，如 "Ctrl+Alt+KeyK"）：
// code 与键盘布局无关，和 Windows 注册热键的物理键一致。规则与后端 parse_user_shortcut
// 相同：必须含 Ctrl / Alt / Win 之一，单键或只加 Shift 会拦截日常输入。
// ============================================================================

export type CloseAction = "exit" | "tray";
/** 可绑定全局快捷键的动作；与后端 HotkeyAction 一致。open_quick 绑定即开启快速搜索窗；
 *  collect_selection 收纳前台资源管理器的选中项（没有选中项时收纳剪贴板里的文件） */
export type HotkeyAction = "toggle_main" | "open_quick" | "collect_selection";
export type LaunchMode = "show" | "background";

export interface HotkeyInfo {
  action: HotkeyAction;
  label: string;
  accelerator: string | null;
  /** 设置里保存、但本次启动注册失败的原因（例如被其他程序占用） */
  error: string | null;
}

export interface DesktopSettings {
  hotkeys: HotkeyInfo[];
  closeAction: CloseAction;
  /** 前台全屏时忽略全局快捷键（默认开，2 秒内连按 3 次强制） */
  ignoreFullscreen: boolean;
  launchMode: LaunchMode;
  trayActive: boolean;
}

/** 后端设置变化广播的事件名（托盘菜单与设置页同步） */
export const DESKTOP_SETTINGS_CHANGED_EVENT = "desktop-settings-changed";

export type ShortcutCapture =
  | { kind: "pending" }
  | { kind: "cancel" }
  | { kind: "invalid"; message: string }
  | { kind: "ok"; accelerator: string };

interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "OS", "AltGraph"]);

export function captureShortcut(event: KeyLike): ShortcutCapture {
  if (MODIFIER_KEYS.has(event.key)) return { kind: "pending" };
  const anyModifier = event.ctrlKey || event.altKey || event.shiftKey || event.metaKey;
  if (event.key === "Escape" && !anyModifier) return { kind: "cancel" };
  if (!event.code || event.code === "Unidentified") return { kind: "invalid", message: "无法识别这个按键，请换一个" };
  if (!(event.ctrlKey || event.altKey || event.metaKey)) {
    return { kind: "invalid", message: "全局快捷键至少要包含 Ctrl、Alt 或 Win 之一，避免拦截日常输入" };
  }
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  parts.push(event.code);
  return { kind: "ok", accelerator: parts.join("+") };
}

const KEY_LABELS: Record<string, string> = {
  Super: "Win",
  Space: "空格",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/** "Ctrl+Alt+KeyK" → "Ctrl + Alt + K" */
export function formatShortcut(accelerator: string): string {
  return accelerator
    .split("+")
    .map((part) => {
      if (KEY_LABELS[part]) return KEY_LABELS[part];
      const key = /^Key([A-Z])$/.exec(part);
      if (key) return key[1];
      const digit = /^(?:Digit|Numpad)(\d)$/.exec(part);
      if (digit) return part.startsWith("Numpad") ? `小键盘 ${digit[1]}` : digit[1];
      return part;
    })
    .join(" + ");
}
