import { useEffect, useState } from "react";
import { Files, Folder, Library } from "lucide-react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { FolderImportMode } from "../hooks/useFolderImport";
import { pathBasename } from "../lib/itemActionCopy";

const MODE_OPTIONS: {
  value: FolderImportMode;
  icon: typeof Folder;
  title: string;
  description: string;
}[] = [
  {
    value: "folder",
    icon: Folder,
    title: "只加入文件夹",
    description: "库里多这几条目录，双击打开文件夹本身，不扫里面的文件。",
  },
  {
    value: "contents",
    icon: Files,
    title: "只加入里面的文件",
    description: "递归收入夹内文件（跳过隐藏/系统项，最多先导入 2000 个），不把文件夹本身加入库。",
  },
  {
    value: "both",
    icon: Library,
    title: "两者都加入",
    description: "文件夹作为入口，里面的文件也能被标签检索。文件同样最多先导入 2000 个。",
  },
];

export function AddFolderImportDialog({
  open,
  folderNames,
  fileCount,
  defaultMode,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  folderNames: string[];
  fileCount: number;
  defaultMode: FolderImportMode;
  onConfirm: (mode: FolderImportMode, remember: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>({ active: open });
  useEscapeKey(onCancel, open);
  const [mode, setMode] = useState<FolderImportMode>(defaultMode);
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (open) {
      setMode(defaultMode);
      setRemember(true);
    }
  }, [open, defaultMode]);

  if (!open) return null;

  const previewNames = folderNames.map(pathBasename).filter((name) => name.length > 0);
  // 纵向列表最多 3 行：顿号单行连排在多选时必然溢出或截断
  const shownNames = previewNames.slice(0, 3);

  return (
    <>
      <div
        data-workspace-overlay=""
        className="fixed inset-0"
        style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-editor-overlay)" }}
        onClick={onCancel}
      />
      <div
        className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none"
        style={{ zIndex: "var(--z-editor-panel)" }}
      >
        <div
          ref={trapRef}
          className="modal-surface pointer-events-auto w-[520px] max-w-[92vw] p-6"
          role="dialog"
          aria-modal="true"
          aria-label="添加文件夹"
        >
          <h2 className="text-base font-semibold text-[var(--text-primary)]">添加文件夹</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
            选中了 {folderNames.length} 个文件夹
            {fileCount > 0 ? `，另外还有 ${fileCount} 个文件` : ""}。
          </p>
          {fileCount > 0 && (
            <p className="mt-1 text-[13px] leading-5 text-[var(--text-muted)]">
              附带的 {fileCount} 个文件不受添加方式影响，将直接入库。
            </p>
          )}
          {shownNames.length > 0 && (
            <ul className="mt-2 space-y-1">
              {shownNames.map((name, index) => (
                <li
                  key={`${index}:${name}`}
                  className="flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--surface-recessed)] px-2 py-1 text-[13px] leading-5 text-[var(--text-secondary)]"
                  title={name}
                >
                  <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--text-faint)]" aria-hidden="true" />
                  <span className="truncate">{name}</span>
                </li>
              ))}
              {previewNames.length > shownNames.length && (
                <li className="px-2 text-[12px] leading-5 text-[var(--text-faint)]">等 {previewNames.length} 个</li>
              )}
            </ul>
          )}

          <div className="mt-4 flex flex-col gap-2" role="radiogroup" aria-label="添加方式">
            {/* 三个互斥项同构同规格：默认项仅体现在选中态，不做视觉特权 */}
            {MODE_OPTIONS.map((option) => (
              <ModeCard
                key={option.value}
                active={mode === option.value}
                icon={option.icon}
                title={option.title}
                description={option.description}
                onSelect={() => setMode(option.value)}
              />
            ))}
          </div>
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12px] leading-5 text-[var(--text-faint)]">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent-primary)]"
            />
            记住我的选择，下次添加文件夹时默认用它
          </label>

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" autoFocus onClick={onCancel} className="action-button">
              取消
            </button>
            <button
              type="button"
              onClick={() => void onConfirm(mode, remember)}
              className="action-button action-button-primary"
            >
              添加
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function ModeCard({
  active,
  icon: Icon,
  title,
  description,
  onSelect,
}: {
  active: boolean;
  icon: typeof Folder;
  title: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-label={title}
      aria-checked={active}
      onClick={onSelect}
      className={`flex w-full items-start gap-3 rounded-[var(--radius-lg)] border px-3 py-3 text-left ${
        active
          ? "border-[var(--accent-primary)] bg-[var(--accent-primary-bg-light)]"
          : "border-[var(--border-subtle)] bg-[var(--bg-input)] hover:border-[var(--border-default)]"
      }`}
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
        <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--text-primary)]">{title}</span>
        <span className="mt-1 block text-[13px] leading-5 text-[var(--text-muted)]">{description}</span>
      </span>
    </button>
  );
}
