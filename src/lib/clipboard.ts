import { showToast } from "./toast";

/** 复制文本到系统剪贴板；成功/失败均以 toast 反馈。 */
export async function copyText(text: string, successMessage = "已复制"): Promise<boolean> {
  const value = text.trim();
  if (!value) {
    showToast("没有可复制的内容", "warning");
    return false;
  }
  try {
    await navigator.clipboard.writeText(value);
    showToast(successMessage, "success");
    return true;
  } catch {
    showToast("复制失败", "error");
    return false;
  }
}
