import { cloneElement, isValidElement, useId, type ReactElement } from "react";

/**
 * 设置区共享的表单行容器与输入框样式（Ai/Sync 设置等共用，避免逐字重复维护）。
 */

/** 设置区文本输入框统一样式 */
export const inputClass =
  "input-frame min-h-10 min-w-0 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] focus:outline-none";

/** 表单标题关联唯一输入；复合控件通过 htmlFor 指定目标输入。 */
export function SettingsField({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  const generatedId = useId();
  const directControl = isValidElement<{ id?: string }>(children)
    && typeof children.type === "string" && ["input", "textarea", "select"].includes(children.type);
  const id = htmlFor ?? (directControl ? children.props.id : undefined) ?? generatedId;
  return (
    <div className="block min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-[var(--text-primary)]">{label}</label>
      {directControl ? cloneElement(children as ReactElement<{ id?: string }>, { id }) : children}
    </div>
  );
}

export function SettingsToggle({ checked, onChange, title, description, disabled = false }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <button type="button" role="switch" aria-checked={checked} aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`} disabled={disabled} onClick={() => onChange(!checked)}
      className="settings-toggle flex w-full items-center justify-between gap-4 rounded-[var(--radius-md)] border border-[var(--border-subtle)] px-3 py-3 text-left disabled:opacity-50">
      <span className="min-w-0">
        <span id={`${id}-title`} className="block text-sm font-medium text-[var(--text-primary)]">{title}</span>
        <span id={`${id}-description`} className="mt-1 block text-xs leading-5 text-[var(--text-secondary)]">{description}</span>
      </span>
      <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
    </button>
  );
}
