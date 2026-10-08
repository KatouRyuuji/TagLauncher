import { StickyNote } from "lucide-react";

/** 名称旁的备注标记：有备注时显示，悬停查看全文。 */
export function ItemNoteIcon({ note }: { note?: string | null }) {
  if (!note) return null;
  return (
    <span role="img" aria-label="有备注" title={note} className="inline-flex shrink-0 text-[var(--text-faint)]">
      <StickyNote size={13} strokeWidth={1.8} aria-hidden="true" />
    </span>
  );
}
