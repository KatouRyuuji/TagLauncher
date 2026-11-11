// ============================================================================
// components/PinSettingsSection.tsx — 设置 → 桌面驻留 → 钉住视图（默认关闭）
// ============================================================================
// 来源：一个标签（含子标签）或一个文件柜（含子柜）；显示方式：浮动窗 / 边缘抽屉（自动隐藏）。
// 与快速搜索共用同一个窗口（同一个 WebView），开启不额外创建 WebView2。
// ============================================================================

import { useAppStore } from "../stores/appStore";
import * as db from "../lib/db";
import { cabinetPathLabel, flattenCabinetTree } from "../lib/cabinetTree";
import type { DesktopSettings, PinEdge, PinMode, PinSettings, PinSource } from "../lib/desktopShortcut";
import { showToast } from "../lib/toast";
import { SettingsToggle } from "./SettingsField";

const MODE_OPTIONS: Array<{ value: PinMode; label: string; hint: string }> = [
  { value: "float", label: "浮动窗", hint: "小面板常驻桌面，可拖动、可改大小，记住位置" },
  { value: "drawer", label: "边缘抽屉", hint: "平时只在屏幕边缘留一条细把手；鼠标碰边滑出，离开收回。前台全屏时不弹出" },
];

const EDGE_OPTIONS: Array<{ value: PinEdge; label: string }> = [
  { value: "left", label: "贴左边" },
  { value: "right", label: "贴右边" },
];

export function sourceValue(source: PinSource | null): string {
  return source ? `${source.kind}:${source.id}` : "";
}

export function parseSourceValue(value: string): PinSource | null {
  const [kind, raw] = value.split(":");
  const id = Number(raw);
  if (!Number.isInteger(id)) return null;
  if (kind === "tag" || kind === "cabinet") return { kind, id };
  return null;
}

function radioClass(active: boolean): string {
  return `rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors ${
    active ? "border-[var(--accent-primary)] bg-[var(--accent-primary-bg)]" : "border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
  }`;
}

export function PinSettingsSection({ settings, busy, setBusy, onChange }: {
  settings: DesktopSettings;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onChange: (next: DesktopSettings) => void;
}) {
  const tags = useAppStore((s) => s.tags);
  const cabinets = useAppStore((s) => s.cabinets);
  const pin = settings.pin;

  const apply = async (patch: Partial<PinSettings>) => {
    setBusy(true);
    try {
      const next = await db.setPinSettings({ ...pin, ...patch });
      onChange({ ...settings, pin: next });
    } catch (e) {
      showToast(`保存失败：${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const sourceMissing = pin.source !== null && (pin.source.kind === "tag"
    ? !tags.some((t) => t.id === pin.source!.id)
    : !cabinets.some((c) => c.id === pin.source!.id));

  return (
    <div data-testid="pin-options" className="mt-5 space-y-3">
      <span className="instrument-label block">钉住视图</span>
      <SettingsToggle
        checked={pin.enabled}
        disabled={busy || pin.source === null}
        onChange={(checked) => void apply({ enabled: checked })}
        title="钉住一个标签或文件柜"
        description={pin.source === null
          ? "先在下面选择要钉住的标签或文件柜。"
          : "在桌面上常驻一个小面板，双击即可打开文件；内容随库实时更新。与快速搜索共用一个窗口，不额外占用内存。"}
      />
      <label className="block">
        <span className="text-sm font-medium text-[var(--text-primary)]">内容来源</span>
        <select
          data-testid="pin-source-select"
          value={sourceValue(pin.source)}
          disabled={busy}
          onChange={(e) => {
            const source = parseSourceValue(e.target.value);
            void apply({ source, enabled: source ? pin.enabled : false });
          }}
          className="input-frame mt-2 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] focus:outline-none"
        >
          <option value="">（未选择）</option>
          {cabinets.length > 0 && (
            <optgroup label="文件柜（含子柜）">
              {flattenCabinetTree(cabinets).map(({ cabinet }) => (
                <option key={`c${cabinet.id}`} value={`cabinet:${cabinet.id}`}>{cabinetPathLabel(cabinets, cabinet.id)}</option>
              ))}
            </optgroup>
          )}
          {tags.length > 0 && (
            <optgroup label="标签（含子标签）">
              {tags.map((tag) => (
                <option key={`t${tag.id}`} value={`tag:${tag.id}`}>{tag.name}</option>
              ))}
            </optgroup>
          )}
        </select>
        {sourceMissing && (
          <span role="alert" data-testid="pin-source-missing" className="mt-1 block text-sm text-[var(--color-warning-ink)]">
            原来钉住的标签或文件柜已被删除，请重新选择。
          </span>
        )}
      </label>
      <div role="radiogroup" aria-label="钉住视图显示方式" className="grid gap-2 sm:grid-cols-2">
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            data-testid={`pin-mode-${option.value}`}
            aria-checked={pin.mode === option.value}
            disabled={busy}
            onClick={() => void apply({ mode: option.value })}
            className={radioClass(pin.mode === option.value)}
          >
            <span className="block text-sm font-medium text-[var(--text-primary)]">{option.label}</span>
            <span className="mt-0.5 block text-xs leading-5 text-[var(--text-secondary)]">{option.hint}</span>
          </button>
        ))}
      </div>
      {pin.mode === "drawer" ? (
        <div role="radiogroup" aria-label="抽屉贴边" className="flex gap-2">
          {EDGE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              data-testid={`pin-edge-${option.value}`}
              aria-checked={pin.edge === option.value}
              disabled={busy}
              onClick={() => void apply({ edge: option.value })}
              className={radioClass(pin.edge === option.value)}
            >
              <span className="text-sm text-[var(--text-primary)]">{option.label}</span>
            </button>
          ))}
          <span className="self-center text-xs text-[var(--text-faint)]">拖动展开的抽屉可换到另一块屏幕或另一侧</span>
        </div>
      ) : (
        <SettingsToggle
          checked={pin.topmost}
          disabled={busy}
          onChange={(checked) => void apply({ topmost: checked })}
          title="浮动窗置顶"
          description="始终显示在其他窗口之上。"
        />
      )}
    </div>
  );
}
