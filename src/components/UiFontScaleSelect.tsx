import { useAppStore } from "../stores/appStore";
import { UI_FONT_SCALES } from "../lib/uiFontScale";

/** 设置 → 主题外观：界面字号（F03）。只改文字大小，卡片尺寸与列表密度另调。 */
export function UiFontScaleSelect() {
  const scale = useAppStore((state) => state.uiFontScale);
  const setScale = useAppStore((state) => state.setUiFontScale);
  return (
    <div className="block min-w-0">
      <span className="instrument-label mb-2 block">界面字号</span>
      <div
        role="radiogroup"
        aria-label="界面字号"
        className="inline-flex h-10 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-1"
      >
        {UI_FONT_SCALES.map((option, index) => {
          const active = scale === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setScale(option.value)}
              onKeyDown={(event) => {
                const offset = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
                if (!offset) return;
                event.preventDefault();
                const next = (index + offset + UI_FONT_SCALES.length) % UI_FONT_SCALES.length;
                setScale(UI_FONT_SCALES[next].value);
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
              }}
              className={`h-full rounded-[calc(var(--radius-md)-2px)] px-4 text-sm transition-colors ${
                active
                  ? "bg-[var(--accent-primary)] font-medium text-[var(--text-invert)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <span className="mt-1.5 block text-[length:calc(13px*var(--ui-font-scale,1))] text-[var(--text-faint)]">
        只调文字大小；卡片尺寸在状态栏缩放，列表行高用舒适/紧凑
      </span>
    </div>
  );
}
