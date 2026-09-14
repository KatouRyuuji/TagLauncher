import { X } from "lucide-react";

export function DialogHeader({ title, description, onClose, disabled = false }: {
  title: string;
  description?: string;
  onClose: () => void;
  disabled?: boolean;
}) {
  return (
    <header className="dialog-header">
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
