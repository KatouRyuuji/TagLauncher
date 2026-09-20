import { X } from "lucide-react";
import type { ReactNode } from "react";

export function DialogHeader({ title, description, onClose, disabled = false, icon }: {
  title: string;
  description?: string;
  onClose: () => void;
  disabled?: boolean;
  /** 标题左侧的语义徽章（如琥珀警告），让状态入口 → 对话框有颜色线索可循 */
  icon?: ReactNode;
}) {
  return (
    <header className="dialog-header">
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">
        <h2 className="text-lg font-semibold leading-snug text-[var(--text-primary)]">{title}</h2>
        {description && <p className="mt-1 break-words text-[13px] leading-5 text-[var(--text-secondary)]">{description}</p>}
      </div>
      <button type="button" onClick={onClose} disabled={disabled} aria-label={`关闭${title}`} title="关闭（Esc）"
        className="icon-button shrink-0 disabled:opacity-50">
        <X size={17} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </header>
  );
}
