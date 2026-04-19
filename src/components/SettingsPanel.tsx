import { useState } from "react";
import { open as dialogOpen, save } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { ModManagerPanel } from "./ModManagerPanel";
import { useThemeContext } from "./ThemeProvider";
import type { ThemeDefinition, ThemeSource } from "../types/theme";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

function showToast(message: string, type: "info" | "success" | "error" | "warning" = "info") {
  window.dispatchEvent(
    new CustomEvent("taglauncher-toast", {
      detail: { message, type },
    }),
  );
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const {
    currentTheme,
    availableThemes,
    setTheme,
    refreshCustomThemes,
    importTheme,
    exportTheme,
    themeDirectoryInfo,
  } = useThemeContext();
  const [busy, setBusy] = useState<"import" | "export" | "refresh" | "folder" | null>(null);

  if (!open) return null;

  const handleRefresh = async () => {
    setBusy("refresh");
    try {
      await refreshCustomThemes();
      showToast("主题目录已刷新", "success");
    } finally {
      setBusy(null);
    }
  };

  const handleImportTheme = async () => {
    const selected = await dialogOpen({
      title: "导入主题",
      multiple: false,
      filters: [{ name: "Theme JSON", extensions: ["json"] }],
    });
    if (!selected || Array.isArray(selected)) return;

    setBusy("import");
    try {
      const result = await importTheme(selected);
      await setTheme(result.theme.id);
      showToast(result.replaced ? `主题 "${result.theme.name}" 已更新并应用` : `主题 "${result.theme.name}" 已导入并应用`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const handleExportThemeToFile = async () => {
    const path = await save({
      title: "导出主题为文件",
      defaultPath: `${currentTheme.id}.json`,
      filters: [{ name: "Theme JSON", extensions: ["json"] }],
    });
    if (!path) return;

    setBusy("export");
    try {
      await exportTheme(currentTheme, path);
      showToast(`主题 "${currentTheme.name}" 已导出为文件`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const handleOpenThemeFolder = async () => {
    if (!themeDirectoryInfo?.themes_dir) {
      showToast("主题目录不可用", "error");
      return;
    }

    setBusy("folder");
    try {
      await shellOpen(themeDirectoryInfo.themes_dir);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0"
        style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-settings-overlay)" as unknown as number }}
        onClick={onClose}
      />
      <div
        className="fixed inset-0 flex items-center justify-center p-5 pointer-events-none"
        style={{ zIndex: "var(--z-settings-panel)" as unknown as number }}
      >
        <div className="modal-surface pointer-events-auto flex max-h-[86vh] w-[760px] max-w-[94vw] flex-col overflow-hidden border-[color-mix(in_srgb,var(--border-default)_72%,transparent)]">
          <div className="border-b border-[var(--border-subtle)] px-6 py-5">
            <div className="flex items-start justify-between gap-5">
              <div>
                <div className="text-label">Preferences</div>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">设置</h2>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  管理主题、导入导出与扩展能力
                </p>
              </div>
              <button type="button" onClick={onClose} className="icon-button">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            <section className="surface-card-soft p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-label">Theme</div>
                  <h3 className="mt-2 text-lg font-semibold text-[var(--text-primary)]">主题外观</h3>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    当前主题：
                    <span className="font-medium text-[var(--accent-primary)]">{currentTheme.name}</span>
                  </p>
                  {themeDirectoryInfo?.themes_dir && (
                    <p className="mt-1 truncate text-xs text-[var(--text-faint)]" title={themeDirectoryInfo.themes_dir}>
                      目录：{themeDirectoryInfo.themes_dir}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <ActionButton label={busy === "import" ? "导入中..." : "导入主题"} onClick={() => void handleImportTheme()} disabled={busy !== null} />
                  <ActionButton label={busy === "export" ? "导出中..." : "导出当前"} onClick={() => void handleExportThemeToFile()} disabled={busy !== null} />
                  <ActionButton label={busy === "refresh" ? "刷新中..." : "刷新目录"} onClick={() => void handleRefresh()} disabled={busy !== null} />
                  <ActionButton label={busy === "folder" ? "打开中..." : "打开目录"} onClick={() => void handleOpenThemeFolder()} disabled={busy !== null || !themeDirectoryInfo?.themes_dir} />
                </div>
              </div>

              <ThemeSelect themes={availableThemes} currentThemeId={currentTheme.id} onSelect={setTheme} />
            </section>

            <section className="mt-6">
              <div className="mb-3">
                <div className="text-label">Extensions</div>
                <h3 className="mt-2 text-lg font-semibold text-[var(--text-primary)]">扩展</h3>
              </div>
              <ModManagerPanel />
            </section>
          </div>
        </div>
      </div>
    </>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="action-button min-h-[36px] px-3 text-xs disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function ThemeSelect({
  themes,
  currentThemeId,
  onSelect,
}: {
  themes: ThemeDefinition[];
  currentThemeId: string;
  onSelect: (id: string) => Promise<void>;
}) {
  const groups: Array<{ source: ThemeSource; label: string; themes: ThemeDefinition[] }> = [
    { source: "preset", label: "内置主题", themes: themes.filter((theme) => theme.source === "preset") },
    { source: "custom", label: "自定义主题", themes: themes.filter((theme) => theme.source === "custom") },
    { source: "mod", label: "Mod 主题", themes: themes.filter((theme) => theme.source === "mod") },
  ];

  return (
    <label className="mt-5 block">
      <span className="mb-2 block text-xs font-semibold text-[var(--text-muted)]">当前主题</span>
      <select
        value={currentThemeId}
        onChange={(event) => void onSelect(event.target.value)}
        className="w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
      >
        {groups.map((group) => (
          group.themes.length > 0 && (
            <optgroup key={group.source} label={group.label}>
              {group.themes.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}{theme.version ? ` · v${theme.version}` : ""}{theme.author ? ` · ${theme.author}` : ""}
                </option>
              ))}
            </optgroup>
          )
        ))}
      </select>
    </label>
  );
}
