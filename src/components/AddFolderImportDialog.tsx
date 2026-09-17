import { useEffect, useState } from "react";
import { Files, Folder, Library } from "lucide-react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { FolderImportMode } from "../hooks/useFolderImport";
import { pathBasename } from "../lib/itemActionCopy";

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
  onConfirm: (mode: FolderImportMode) => Promise<void>;
  onCancel: () => void;
}) {
  const trapRef = useFocusTrap<HTMLDivElement>({ active: open });
  useEscapeKey(onCancel, open);
  const [mode, setMode] = useState<FolderImportMode>(defaultMode);

  useEffect(() => {
    if (open) setMode(defaultMode);
  }, [open, defaultMode]);

  if (!open) return null;

  const previewNames = folderNames.map(pathBasename).filter((name) => name.length > 0);
  const shownNames = previewNames.slice(0, 4);

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
            文件柜是分组，不会替代这里的选择。
          </p>
          {shownNames.length > 0 && (
            <p className="mt-2 text-[13px] leading-5 text-[var(--text-muted)]">
              {shownNames.join("、")}
              {previewNames.length > shownNames.length ? ` 等 ${previewNames.length} 个` : ""}
            </p>
          )}

          <div className="mt-4 grid gap-2" role="radiogroup" aria-label="添加方式">
            <ModeCard
              active={mode === "folder"}
              icon={Folder}
              title="只加入文件夹"
              description="库里多这几条目录，双击打开文件夹本身，不扫里面的文件。"
              onSelect={() => setMode("folder")}
            />
            <ModeCard
              active={mode === "contents"}
              icon={Files}
              title="只加入里面的文件"
              description="递归收入夹内文件（跳过隐藏/系统项，最多先导入 2000 个），不把文件夹本身加入库。"
              onSelect={() => setMode("contents")}
            />
            <ModeCard
              active={mode === "both"}
              icon={Library}
              title="两者都加入"
              description="文件夹作为入口，里面的文件也能被标签检索。文件同样最多先导入 2000 个。"
              onSelect={() => setMode("both")}
            />
          </div>
          <p className="mt-3 text-[12px] leading-5 text-[var(--text-faint)]">
            下次添加文件夹时默认选中此项。
          </p>

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" autoFocus onClick={onCancel} className="action-button">
              取消
            </button>
            <button
              type="button"
              onClick={() => void onConfirm(mode)}
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
