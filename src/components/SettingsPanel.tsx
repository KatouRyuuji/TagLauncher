import { useState } from "react";
import { open as dialogOpen, save } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import type { ThemeDefinition, ThemeSource } from "../types/theme";
import { useThemeContext } from "./ThemeProvider";
import { ModManagerPanel } from "./ModManagerPanel";

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
      <div className="fixed inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: "var(--z-settings-panel)" as unknown as number }}>
        <div
          className="pointer-events-auto w-[620px] max-w-[94vw] max-h-[84vh] rounded-[var(--radius-xl)] border overflow-y-auto"
          style={{
            backgroundColor: "var(--bg-overlay)",
            borderColor: "var(--border-default)",
            boxShadow: "var(--shadow-overlay)",
          }}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border-subtle)" }}>
            <div>
              <h2 className="text-lg font-medium" style={{ color: "var(--text-primary)" }}>设置</h2>
              <p className="mt-1 text-xs" style={{ color: "var(--text-faint)" }}>
                主题支持导入、导出为文件、手动刷新与全局覆盖
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-md)] transition-colors"
              style={{ color: "var(--text-muted)" }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ""; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              ✕
            </button>
          </div>

          <div className="p-5 space-y-6">
            <section className="rounded-[var(--radius-lg)] border p-4" style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-card)" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>主题</h3>
                  <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    当前主题：<span style={{ color: "var(--accent-primary)" }}>{currentTheme.name}</span>
                    {themeDirectoryInfo?.themes_dir ? ` · 目录：${themeDirectoryInfo.themes_dir}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 justify-end">
                  <ActionButton label={busy === "import" ? "导入中..." : "导入主题"} onClick={() => void handleImportTheme()} disabled={busy !== null} />
                  <ActionButton label={busy === "export" ? "导出中..." : "导出为文件"} onClick={() => void handleExportThemeToFile()} disabled={busy !== null} />
                  <ActionButton label={busy === "refresh" ? "刷新中..." : "刷新目录"} onClick={() => void handleRefresh()} disabled={busy !== null} />
                  <ActionButton label={busy === "folder" ? "打开中..." : "打开目录"} onClick={() => void handleOpenThemeFolder()} disabled={busy !== null || !themeDirectoryInfo?.themes_dir} />
                </div>
              </div>

              <ThemeSelect
                themes={availableThemes}
                currentThemeId={currentTheme.id}
                onSelect={setTheme}
              />

              <p className="mt-3 text-xs" style={{ color: "var(--text-faint)" }}>
                自定义主题来自 AppData/themes；导入后立即可用，目录外部变更请手动刷新。
              </p>
            </section>

            <section>
              <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-secondary)" }}>扩展</h3>
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
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 rounded-[var(--radius-md)] text-xs border transition-colors disabled:opacity-50"
      style={{
        backgroundColor: "var(--bg-hover)",
        borderColor: "var(--border-subtle)",
        color: "var(--text-secondary)",
      }}
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
    <label className="mt-4 block">
      <span className="mb-2 block text-xs font-medium" style={{ color: "var(--text-secondary)" }}>
        选择主题
      </span>
      <select
        value={currentThemeId}
        onChange={(event) => void onSelect(event.target.value)}
        className="w-full rounded-[var(--radius-md)] border px-3 py-2 text-sm outline-none transition-colors"
        style={{
          backgroundColor: "var(--bg-input)",
          borderColor: "var(--border-subtle)",
          color: "var(--text-primary)",
        }}
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
