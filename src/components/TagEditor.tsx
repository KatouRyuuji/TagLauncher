import { useRef, useState, type CSSProperties } from "react";
import { Check, FolderSync } from "lucide-react";
import { createPortal } from "react-dom";
import { getThemeTagPresetColors, nameColorByHue } from "../lib/tagColors";
import { snapToPalette } from "../lib/tagColorSlots";
import type { Tag } from "../types";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { isImeKeyboardEvent } from "../lib/itemQuery";
import { showToast } from "../lib/toast";
import { pickFolderToLink } from "../lib/importDialogs";
import { DialogHeader } from "./DialogHeader";

interface TagEditorProps {
  tag: Tag | null;
  label?: string;
  /** 文件柜的关联文件夹（null 为未关联）；传入时显示「关联文件夹」字段 */
  folderPath?: string | null;
  onSave: (name: string, color: string, folderPath: string | null) => Promise<void>;
  onDelete?: () => void | Promise<void>;
  onClose: () => void;
}

function sameHex(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function TagEditor({ tag, label = "标签", folderPath, onSave, onDelete, onClose }: TagEditorProps) {
  const [presetColors] = useState(getThemeTagPresetColors);
  const [name, setName] = useState(tag?.name || "");
  const [color, setColor] = useState(() =>
    snapToPalette(tag?.color || presetColors[5] || presetColors[0], presetColors),
  );
  const [folder, setFolder] = useState<string | null>(folderPath ?? null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const title = tag ? `编辑${label}` : `新建${label}`;
  // 删除为不可撤销的级联操作（标签会从所有对象上移除）：两步内联确认，
  // 与 DataSettingsSection 的内联确认同模式，避免再叠一层模态焦点陷阱。
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const description = label === "文件柜"
    ? "文件柜是分组，一个对象可以进多个柜；也可以关联一个磁盘文件夹，柜内容随文件夹同步"
    : "名称与颜色用于识别分类。";

  useEscapeKey(onClose, !saving && !deleting);
  const contentRef = useFocusTrap<HTMLDivElement>({ active: true });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || saving || deleting) return;
    setSaving(true);
    try {
      await onSave(name.trim(), color, folder);
    } catch (err) {
      // 保存失败（如重名 UNIQUE 冲突）：明示原因、保留输入与弹窗，便于修正重试；
      // 同时吞掉 rejection，避免 form onSubmit 的 promise 成为未处理拒绝。
      showToast(`保存失败：${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete || deleting || saving) return;
    if (!confirmingDelete) { setConfirmingDelete(true); return; }
    setDeleting(true);
    try { await onDelete(); }
    catch (error) { showToast(`删除失败：${error instanceof Error ? error.message : String(error)}`, "error"); }
    finally { setDeleting(false); }
  };

  // 经 portal 挂到 body：本组件是 fixed 全屏弹层，若渲染在带 backdrop-filter/filter 的
  // 主题区域内（如 sky-cloud 的 sidebar），fixed 会被困在该区域内而非相对视口——
  // 与 ContextMenu 同款处理，免疫任何主题的区域滤镜。
  return createPortal(
    <div
      data-workspace-overlay=""
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-editor-panel)" }}
      onClick={() => { if (!saving && !deleting) onClose(); }}
    >
      <div
        ref={contentRef}
        className="modal-surface dialog-panel w-[440px] max-w-[calc(100vw-2rem)]"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <DialogHeader title={title} description={description} onClose={onClose} disabled={saving || deleting} />

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
          <fieldset className="dialog-body" disabled={saving || deleting}>
          <label className="block">
            <span className="text-[13px] font-medium text-[var(--text-primary)]">名称</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && isImeKeyboardEvent(event)) {
                  event.preventDefault();
                }
              }}
              placeholder={`${label}名称`}
              autoFocus
              className="input-frame mt-2 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-placeholder)] focus:outline-none"
            />
          </label>

          <TagColorField colors={presetColors} value={color} onChange={setColor} />
          {folderPath !== undefined && (
            <LinkedFolderField initial={folderPath} editing={tag !== null} value={folder} onChange={setFolder} />
          )}
          <div className="mt-4 flex items-center gap-3 text-[12px] text-[var(--text-muted)]">
            <span>标签预览</span>
            <span className="tag-pill px-2 py-1" style={{ "--tag-color": color } as CSSProperties}>{name.trim() || `${label}名称`}</span>
          </div>
          </fieldset>

          <div className="dialog-footer">
            {onDelete && confirmingDelete && <p className="w-full text-[13px] leading-5 text-[var(--color-danger-ink)]">
              {label === "文件柜" ? "删除文件柜后，柜内对象仍保留在库中。" : "删除后，此标签会从所有对象上移除。"}
            </p>}
            {onDelete && (
              <button
                ref={deleteRef}
                type="button"
                onClick={() => void handleDelete()}
                disabled={saving || deleting}
                className="action-button action-button-danger"
              >
                {deleting ? "删除中…" : confirmingDelete ? "确认删除" : "删除"}
              </button>
            )}
            {onDelete && confirmingDelete && (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => { deleteRef.current?.focus(); setConfirmingDelete(false); }}
                  className="action-button"
                >
                  返回编辑
                </button>
            )}

            <div className="flex-1" />

            <button type="button" disabled={saving || deleting} onClick={onClose} className="action-button" hidden={confirmingDelete}>
              取消
            </button>
            <button
              type="submit"
              disabled={!name.trim() || saving || deleting}
              hidden={confirmingDelete}
              className="action-button action-button-primary disabled:opacity-40"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

function LinkedFolderField({
  initial,
  editing,
  value,
  onChange,
}: {
  initial: string | null;
  editing: boolean;
  value: string | null;
  onChange: (folder: string | null) => void;
}) {
  const hint = value === null
    ? initial !== null
      ? "解除后，当前内容保留为普通文件柜。"
      : "关联后，柜内容由该文件夹决定，并随文件夹自动同步。"
    : editing && initial === null
      ? "关联后，原先手动加入的对象移出本柜（仍保留在库中）；磁盘文件不会被移动或删除。"
      : "柜内容随文件夹自动同步；磁盘文件不会被移动或删除。";

  return (
    <div className="mt-5">
      <div className="text-[13px] font-medium text-[var(--text-primary)]">关联文件夹（可选）</div>
      <div className="mt-2 flex items-center gap-2">
        <span
          title={value ?? undefined}
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 text-[13px] text-[var(--text-secondary)]"
        >
          {value !== null && <FolderSync aria-hidden="true" size={14} strokeWidth={1.8} className="shrink-0 text-[var(--text-faint)]" />}
          <span className="truncate">{value ?? "未关联"}</span>
        </span>
        <button
          type="button"
          className="action-button shrink-0"
          onClick={() => {
            void pickFolderToLink().then((picked) => { if (picked) onChange(picked); });
          }}
        >
          {value === null ? "选择文件夹…" : "更换…"}
        </button>
        {value !== null && (
          <button type="button" className="action-button shrink-0" onClick={() => onChange(null)}>
            解除关联
          </button>
        )}
      </div>
      <p className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">{hint}</p>
    </div>
  );
}

function TagColorField({
  colors,
  value,
  onChange,
}: {
  colors: string[];
  value: string;
  onChange: (color: string) => void;
}) {
  const options = colors;

  return (
    <div className="mt-5">
      <div className="text-[13px] font-medium text-[var(--text-primary)]">颜色</div>
      <div className="mt-2">
        <div role="radiogroup" aria-label="分类颜色" className="grid grid-cols-5 gap-2">
          {options.map((preset, index) => {
            const selected = sameHex(value, preset);
            const label = nameColorByHue(preset);
            return (
              <button
                key={preset}
                type="button"
                role="radio"
                aria-label={label}
                aria-checked={selected}
                title={label}
                tabIndex={selected ? 0 : -1}
                onClick={() => onChange(preset)}
                onKeyDown={(event) => {
                  const offset = ["ArrowRight", "ArrowDown"].includes(event.key)
                    ? 1
                    : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
                  if (!offset && event.key !== "Home" && event.key !== "End") return;
                  event.preventDefault();
                  const nextIndex = event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? options.length - 1
                      : (index + offset + options.length) % options.length;
                  const next = options[nextIndex];
                  if (next) onChange(next);
                  event.currentTarget.parentElement
                    ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[nextIndex]
                    ?.focus();
                }}
                className="tag-pill min-h-9 justify-between gap-1 px-2 text-[12px]"
                style={{ "--tag-color": preset, borderColor: selected ? "var(--tag-ink)" : "transparent" } as CSSProperties}
              >
                <span>{label}</span>
                <Check size={12} aria-hidden="true" className={selected ? "opacity-100" : "opacity-0"} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
