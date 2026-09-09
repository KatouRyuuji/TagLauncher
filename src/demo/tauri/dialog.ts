// ============================================================================
// demo/tauri/dialog.ts — @tauri-apps/plugin-dialog 的 demo 替身
// ============================================================================
// 文件对话框在浏览器中不可用；统一返回「用户取消」（null/false），
// 宿主代码对该分支本就有优雅处理，演示流程不会触发真实文件选择。
// ============================================================================

export async function open(): Promise<null> {
  return null;
}

export async function save(): Promise<null> {
  return null;
}

export async function message(): Promise<void> {}

export async function ask(): Promise<boolean> {
  // 演示模式以走完流程为目标：确认类询问一律视为「确认」（如 AI 全量打标的数量确认）
  return true;
}

export async function confirm(): Promise<boolean> {
  return false;
}
