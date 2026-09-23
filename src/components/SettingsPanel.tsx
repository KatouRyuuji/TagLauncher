import { useLayoutEffect, useRef, useState } from "react";
import { open as dialogOpen, save } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  Cloud,
  Database,
  Download,
  FolderOpen,
  Palette,
  PanelRight,
  Puzzle,
  RefreshCw,
  Settings2,
  Sparkles,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { showToast } from "../lib/toast";
import { SETTINGS_SECTIONS, settingsSectionDomId } from "../lib/settingsSections";
import { DEFAULT_FAMILY, findFamilyByThemeId, resolveFamilyThemeId } from "../themes";
import type { ColorMode } from "../lib/colorMode";
import type { ThemeDefinition, ThemeVariant } from "../types/theme";
import { AiSettingsSection } from "./AiSettingsSection";
import { DataSettingsSection } from "./DataSettingsSection";
import { ModManagerPanel } from "./ModManagerPanel";
import { SelectMenu } from "./SelectMenu";
import { SyncSettingsSection } from "./SyncSettingsSection";
import { ThemeFamilyGallery } from "./ThemeFamilyGallery";
import { useThemeContext } from "./ThemeProvider";
import { UpdateSettingsSection } from "./UpdateSettingsSection";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const SETTINGS_SECTION_KEY = "taglauncher.settings_section";

function loadSettingsSection(): string {
  try {
    const raw = localStorage.getItem(SETTINGS_SECTION_KEY);
    if (raw && SETTINGS_SECTIONS.some((section) => section.id === raw)) return raw;
  } catch {
    // 隐私模式或配额不足时忽略
  }
  return SETTINGS_SECTIONS[0]?.id ?? "theme";
}

function persistSettingsSection(id: string): void {
  try {
    localStorage.setItem(SETTINGS_SECTION_KEY, id);
  } catch {
    // ignore
  }
}

const SECTION_ICONS: Record<string, LucideIcon> = {
  theme: Palette,
  ai: Sparkles,
  data: Database,
  sync: Cloud,
  update: RefreshCw,
  mods: Puzzle,
};

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const {
    currentTheme,
    availableThemes,
    setTheme,
    refreshCustomThemes,
    importTheme,
    exportTheme,
    themeDirectoryInfo,
    activeVariant,
    setActiveVariant,
    colorMode,
    effectiveMode,
    changeColorMode,
  } = useThemeContext();
  const [busy, setBusy] = useState<"import" | "export" | "refresh" | "folder" | null>(null);
  const [activeSection, setActiveSection] = useState(loadSettingsSection);
  const [visitedSections, setVisitedSections] = useState(() => new Set([activeSection]));
  const contentRef = useRef<HTMLDivElement>(null);
  const trapRef = useFocusTrap<HTMLElement>({ active: open });

  useEscapeKey(onClose, open);

  useLayoutEffect(() => {
    if (!open) return;
    const section = loadSettingsSection();
    setActiveSection(section);
    setVisitedSections((current) => current.has(section) ? current : new Set([...current, section]));
  }, [open]);

  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [activeSection]);

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

  const navigateToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    setVisitedSections((current) => current.has(sectionId) ? current : new Set([...current, sectionId]));
    persistSettingsSection(sectionId);
  };

  return (
    <>
      <div
        data-settings-overlay=""
        data-workspace-overlay=""
        data-settings-stage={activeSection === "theme" ? "preview" : "dim"}
        className="fixed inset-0"
        style={
          activeSection === "theme"
            ? { backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-settings-overlay)" }
            : {
                backgroundColor: "var(--overlay-bg)",
                zIndex: "var(--z-settings-overlay)",
              }
        }
        onClick={onClose}
      />
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 top-[var(--titlebar-height)] flex"
        style={{ zIndex: "var(--z-settings-panel)" }}
      >
        <aside
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-panel-title"
          className="drawer-enter pointer-events-auto flex h-full w-full flex-col overflow-hidden bg-[var(--surface-raised)]"
        >
          <header className="flex h-[68px] shrink-0 items-center justify-between gap-4 border-b border-[var(--line-hairline)] px-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
                <Settings2 aria-hidden="true" size={19} strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <h2 id="settings-panel-title" className="truncate text-lg font-semibold text-[var(--text-primary)]">
                  设置工作台
                </h2>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs text-[var(--text-faint)]">Esc 返回</span>
              <button type="button" onClick={onClose} className="icon-button shrink-0" title="关闭设置" aria-label="关闭设置">
                <X aria-hidden="true" size={17} strokeWidth={1.8} />
              </button>
            </div>
          </header>

          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[184px_minmax(0,1fr)] sm:grid-rows-1">
            <nav
              aria-label="设置区块导航"
              className="flex min-w-0 gap-1 overflow-x-auto border-b border-[var(--line-hairline)] bg-[var(--surface-recessed)] p-2 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-3"
            >
              {SETTINGS_SECTIONS.map((section) => {
                const Icon = SECTION_ICONS[section.id] ?? PanelRight;
                const selected = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    id={`settings-nav-${section.id}`}
                    type="button"
                    onClick={() => navigateToSection(section.id)}
                    aria-controls={settingsSectionDomId(section.id)}
                    aria-current={selected ? "page" : undefined}
                    className={`flex min-h-9 shrink-0 items-center gap-2.5 rounded-[var(--radius-md)] px-3 text-left text-sm transition-colors sm:w-full ${
                      selected
                        ? "bg-[var(--accent-primary-bg)] font-semibold text-[var(--accent-primary-ink)] shadow-[inset_2px_0_0_var(--accent-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
                    <span>{section.label}</span>
                  </button>
                );
              })}
              <div className="mt-auto hidden border-t border-[var(--line-hairline)] px-2 pt-3 text-xs leading-5 text-[var(--text-faint)] sm:block">
                {activeSection === "theme"
                  ? "主题即时生效。"
                  : activeSection === "ai"
                    ? "改后点「保存配置」。"
                    : activeSection === "data"
                      ? "备份与导出立即生效；切换目录与导入需重启。"
                      : activeSection === "sync"
                        ? "连接配置请在本区块保存。"
                        : activeSection === "update"
                          ? "下载后手动安装，数据不受影响。"
                          : activeSection === "mods"
                            ? "扩展启用后即时加载。"
                            : "本页操作立即生效。"}
              </div>
            </nav>

            <div
              ref={contentRef}
              className="settings-content min-h-0 min-w-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6"
            >
              <section id={settingsSectionDomId("theme")} hidden={activeSection !== "theme"} aria-labelledby="settings-nav-theme">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 basis-[220px]">
                    <h3 className="text-lg font-semibold text-[var(--text-primary)]">主题外观</h3>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      当前使用 <span className="font-semibold text-[var(--text-primary)]">{currentTheme.name}</span>
                    </p>
                    {themeDirectoryInfo?.themes_dir && (
                      <p className="data-readout mt-1 truncate text-[13px] text-[var(--text-faint)]" title={`自定义主题目录：${themeDirectoryInfo.themes_dir}`}>
                        主题目录 {themeDirectoryInfo.themes_dir}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    <ActionButton
                      icon={Upload}
                      label={busy === "import" ? "导入中..." : "导入"}
                      onClick={() => void handleImportTheme()}
                      disabled={busy !== null}
                    />
                    <ActionButton
                      icon={Download}
                      label={busy === "export" ? "导出中..." : "导出"}
                      onClick={() => void handleExportThemeToFile()}
                      disabled={busy !== null}
                    />
                    <ActionButton
                      icon={RefreshCw}
                      label={busy === "refresh" ? "刷新中..." : "刷新"}
                      onClick={() => void handleRefresh()}
                      disabled={busy !== null}
                      spinning={busy === "refresh"}
                    />
                    <ActionButton
                      icon={FolderOpen}
                      label={busy === "folder" ? "打开中..." : "目录"}
                      onClick={() => void handleOpenThemeFolder()}
                      disabled={busy !== null || !themeDirectoryInfo?.themes_dir}
                    />
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-start gap-4">
                  <ThemeFamilyGallery
                    themes={availableThemes}
                    currentThemeId={currentTheme.id}
                    effectiveMode={effectiveMode}
                    onSelect={setTheme}
                  />
                  <ColorModeSelect colorMode={colorMode} onSelect={changeColorMode} disabled={!findFamilyByThemeId(currentTheme.id)} />
                </div>

                {currentTheme.variants && Object.keys(currentTheme.variants).length > 0 && (
                  <div className="mt-4 max-w-sm">
                    <VariantSelect
                      variants={currentTheme.variants}
                      activeVariant={activeVariant}
                      onSelect={setActiveVariant}
                    />
                  </div>
                )}

                <ExtensionThemeSelect
                  themes={availableThemes}
                  currentThemeId={currentTheme.id}
                  effectiveMode={effectiveMode}
                  onSelect={setTheme}
                />
              </section>

              <div id={settingsSectionDomId("ai")} hidden={activeSection !== "ai"} aria-labelledby="settings-nav-ai">
                {visitedSections.has("ai") && <AiSettingsSection />}
              </div>

              <div id={settingsSectionDomId("data")} hidden={activeSection !== "data"} aria-labelledby="settings-nav-data">
                {visitedSections.has("data") && <DataSettingsSection />}
              </div>

              <div id={settingsSectionDomId("sync")} hidden={activeSection !== "sync"} aria-labelledby="settings-nav-sync">
                {visitedSections.has("sync") && <SyncSettingsSection />}
              </div>

              <div id={settingsSectionDomId("update")} hidden={activeSection !== "update"} aria-labelledby="settings-nav-update">
                {visitedSections.has("update") && <UpdateSettingsSection />}
              </div>

              <section id={settingsSectionDomId("mods")} hidden={activeSection !== "mods"} aria-labelledby="settings-nav-mods">
                <div className="mb-4 flex items-center gap-3 border-b border-[var(--line-hairline)] pb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
                    <Puzzle aria-hidden="true" size={17} strokeWidth={1.8} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--text-primary)]">扩展</h3>
                  </div>
                </div>
                {visitedSections.has("mods") && <ModManagerPanel />}
              </section>
            </div>
          </div>


        </aside>
      </div>
    </>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  spinning = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  spinning?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="action-button min-h-[34px] px-3 text-xs disabled:opacity-50"
    >
      <Icon aria-hidden="true" size={15} strokeWidth={1.8} className={spinning ? "animate-spin" : undefined} />
      {label}
    </button>
  );
}

function extensionThemeLabel(theme: ThemeDefinition): string {
  return `${theme.name}${theme.version ? ` · v${theme.version}` : ""}${theme.author ? ` · ${theme.author}` : ""}`;
}

/** 与 useTheme 的 last-preset 缓存同键；读不到或不是官方家族则回默认族。 */
const LAST_PRESET_THEME_KEY = "taglauncher.last-preset-theme-id";

function lastOfficialFamily() {
  try {
    const id = localStorage.getItem(LAST_PRESET_THEME_KEY);
    return (id ? findFamilyByThemeId(id) : undefined) ?? DEFAULT_FAMILY;
  } catch {
    return DEFAULT_FAMILY;
  }
}

/** 下拉只列自定义 / Mod；没有扩展主题时隐藏触发按钮，只留空态句。 */
function ExtensionThemeSelect({
  themes,
  currentThemeId,
  effectiveMode,
  onSelect,
}: {
  themes: ThemeDefinition[];
  currentThemeId: string;
  effectiveMode: "light" | "dark";
  onSelect: (id: string) => Promise<void>;
}) {
  const customThemes = themes.filter((theme) => theme.source === "custom");
  const modThemes = themes.filter((theme) => theme.source === "mod");
  const hasExtensions = customThemes.length > 0 || modThemes.length > 0;
  const usingExtension = customThemes.some((theme) => theme.id === currentThemeId)
    || modThemes.some((theme) => theme.id === currentThemeId);

  return (
    <div className="mt-6 border-t border-[var(--line-hairline)] pt-5">
      <span className="instrument-label mb-2 block">自定义与扩展主题</span>
      {!hasExtensions ? (
        <div role="status" className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
            <Palette aria-hidden="true" size={18} strokeWidth={1.8} />
          </span>
          <span className="min-w-0 text-sm leading-5 text-[var(--text-muted)]">
            <span className="block font-medium text-[var(--text-primary)]">目前没有扩展主题</span>
            从右上角「导入」载入 JSON，或安装主题 Mod。
          </span>
        </div>
      ) : (
        <SelectMenu
          value={usingExtension ? currentThemeId : ""}
          onChange={(raw) => {
            if (raw) {
              void onSelect(raw);
              return;
            }
            void onSelect(resolveFamilyThemeId(lastOfficialFamily(), effectiveMode));
          }}
          ariaLabel="当前主题"
          groups={[
            {
              label: "",
              options: [{ value: "", label: "使用上方官方配色" }],
            },
            ...(customThemes.length > 0
              ? [{
                  label: "自定义主题",
                  options: customThemes.map((theme) => ({
                    value: theme.id,
                    label: extensionThemeLabel(theme),
                    swatch: theme.variables["accent-primary"],
                  })),
                }]
              : []),
            ...(modThemes.length > 0
              ? [{
                  label: "Mod 主题",
                  options: modThemes.map((theme) => ({
                    value: theme.id,
                    label: extensionThemeLabel(theme),
                    swatch: theme.variables["accent-primary"],
                  })),
                }]
              : []),
          ]}
          className="input-frame flex h-10 w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] focus:outline-none"
        />
      )}
    </div>
  );
}

function VariantSelect({
  variants,
  activeVariant,
  onSelect,
}: {
  variants: Record<string, ThemeVariant>;
  activeVariant: string | undefined;
  onSelect: (variant: string | undefined) => void;
}) {
  return (
    <div className="block min-w-0">
      <span className="instrument-label mb-2 block">主题变体</span>
      <SelectMenu
        value={activeVariant ?? ""}
        onChange={(next) => onSelect(next || undefined)}
        ariaLabel="主题变体"
        options={[
          { value: "", label: "默认（无变体）" },
          ...Object.entries(variants).map(([key, variant]) => ({
            value: key,
            label: variant.name ?? key,
          })),
        ]}
        className="input-frame flex h-10 w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] focus:outline-none"
      />
    </div>
  );
}

/** 亮色/暗色模式（独立于主题的开关）：跟随系统 / 亮色 / 暗色 三段切换。
 *  仅内置配色家族随模式换肤；自定义/Mod 主题自带配色方案，不受模式影响。 */
function ColorModeSelect({
  colorMode,
  onSelect,
  disabled,
}: {
  colorMode: ColorMode;
  onSelect: (mode: ColorMode) => void;
  disabled: boolean;
}) {
  const OPTIONS: Array<{ value: ColorMode; label: string }> = [
    { value: "system", label: "跟随系统" },
    { value: "light", label: "亮色" },
    { value: "dark", label: "暗色" },
  ];
  return (
    <div className="block min-w-0">
      <span className="instrument-label mb-2 block">外观模式</span>
      <div
        role="radiogroup"
        aria-label="外观模式"
        className="inline-flex h-10 items-center gap-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] p-1"
      >
        {OPTIONS.map((option) => {
          const active = colorMode === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(option.value)}
              onKeyDown={(event) => {
                const offset = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
                if (!offset && event.key !== "Home" && event.key !== "End") return;
                event.preventDefault();
                const index = OPTIONS.findIndex((entry) => entry.value === option.value);
                const next = event.key === "Home" ? 0 : event.key === "End" ? OPTIONS.length - 1 : (index + offset + OPTIONS.length) % OPTIONS.length;
                onSelect(OPTIONS[next].value);
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
      <span className="mt-1.5 block text-[13px] text-[var(--text-faint)]">
        亮/暗仅作用于内置主题；自定义与 Mod 主题自带配色方案
      </span>
    </div>
  );
}
