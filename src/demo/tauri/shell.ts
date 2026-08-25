// ============================================================================
// demo/tauri/shell.ts — @tauri-apps/plugin-shell 的 demo 替身
// ============================================================================
// 浏览器中无法调用系统 shell 打开路径/链接，退化为 no-op。
// ============================================================================

export async function open(_target: string): Promise<void> {}

export class Command {
  static create() {
    return { execute: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }) };
  }
}
