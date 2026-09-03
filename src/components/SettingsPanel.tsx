import { useLayoutEffect, useState, type UIEvent } from "react";
import { open as dialogOpen, save } from "@tauri-apps/plugin-dialog";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  Check,
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
import { THEME_FAMILIES, findFamilyByThemeId, resolveFamilyThemeId } from "../themes";
import type { ColorMode } from "../lib/colorMode";
import type { ThemeDefinition, ThemeVariant } from "../types/theme";
import { AiSettingsSection } from "./AiSettingsSection";
import { DataSettingsSection } from "./DataSettingsSection";
import { ModManagerPanel } from "./ModManagerPanel";
import { SelectMenu } from "./SelectMenu";
import { SyncSettingsSection } from "./SyncSettingsSection";
import { useThemeContext } from "./ThemeProvider";
import { UpdateSettingsSection } from "./UpdateSettingsSection";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
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
  const [activeSection, setActiveSection] = useState(SETTINGS_SECTIONS[0]?.id ?? "theme");
  const trapRef = useFocusTrap<HTMLElement>({ active: open });

  useEscapeKey(onClose, open);

  useLayoutEffect(() => {
    if (open) setActiveSection(SETTINGS_SECTIONS[0]?.id ?? "theme");
  }, [open]);

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
    document
      .getElementById(settingsSectionDomId(sectionId))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleContentScroll = (event: UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    if (scrollTop + clientHeight >= scrollHeight - 4) {
      const lastSection = SETTINGS_SECTIONS.at(-1)?.id ?? "theme";
      setActiveSection((current) => (current === lastSection ? current : lastSection));
      return;
    }

    const containerTop = event.currentTarget.getBoundingClientRect().top;
    let nextSection = SETTINGS_SECTIONS[0]?.id ?? "theme";

    for (const section of SETTINGS_SECTIONS) {
      const element = document.getElementById(settingsSectionDomId(section.id));
      if (element && element.getBoundingClientRect().top <= containerTop + 48) {
        nextSection = section.id;
      }
    }

    setActiveSection((current) => (current === nextSection ? current : nextSection));
  };

  return (
    <>
      <div
        data-settings-overlay=""
        data-workspace-overlay=""
        className="fixed inset-0"
        style={{ backgroundColor: "var(--overlay-bg)", zIndex: "var(--z-settings-overlay)" }}
        onClick={onClose}
      />
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 top-[var(--titlebar-height)] flex justify-end"
        style={{ zIndex: "var(--z-settings-panel)" }}
      >
        <aside
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-panel-title"
          className="pointer-events-auto flex h-full w-[980px] max-w-[calc(100vw-12px)] flex-col overflow-hidden border-l border-[var(--border-default)] bg-[var(--surface-raised)] shadow-[var(--shadow-overlay)]"
        >
          <header className="flex h-[68px] shrink-0 items-center justify-between gap-4 border-b border-[var(--line-hairline)] px-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
                <Settings2 aria-hidden="true" size={19} strokeWidth={1.8} />
              </div>
              <div className="min-w-0">
                <div className="instrument-label">Preferences / Workbench</div>
                <h2 id="settings-panel-title" className="mt-1 truncate text-lg font-semibold text-[var(--text-primary)]">
                  设置工作台
                </h2>
              </div>
            </div>
            <button type="button" onClick={onClose} className="icon-button shrink-0" title="关闭设置" aria-label="关闭设置">
              <X aria-hidden="true" size={17} strokeWidth={1.8} />
            </button>
          </header>

          <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[184px_minmax(0,1fr)] sm:grid-rows-1">
            <nav
              aria-label="设置区块导航"
              className="flex min-w-0 gap-1 overflow-x-auto border-b border-[var(--line-hairline)] bg-[var(--surface-recessed)] p-2 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-3"
            >
              <div className="hidden px-2 pb-2 pt-1 sm:block">
                <div className="instrument-label">Sections</div>
                <p className="mt-1 text-xs text-[var(--text-faint)]">06 个设置模块</p>
              </div>
              {SETTINGS_SECTIONS.map((section, index) => {
                const Icon = SECTION_ICONS[section.id] ?? PanelRight;
                const selected = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => navigateToSection(section.id)}
                    aria-controls={settingsSectionDomId(section.id)}
                    aria-current={selected ? "location" : undefined}
                    className={`flex min-h-9 shrink-0 items-center gap-2.5 rounded-[var(--radius-md)] px-3 text-left text-sm transition-colors sm:w-full ${
                      selected
                        ? "bg-[var(--accent-primary-bg)] font-semibold text-[var(--accent-primary)] shadow-[inset_2px_0_0_var(--accent-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
                    <span>{section.label}</span>
                    <span className="data-readout ml-auto hidden text-[10px] text-[var(--text-faint)] sm:inline">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </button>
                );
              })}
              <div className="mt-auto hidden border-t border-[var(--line-hairline)] px-2 pt-3 text-xs leading-5 text-[var(--text-faint)] sm:block">
                所有改动即时生效
              </div>
            </nav>

            <div
              className="min-h-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-6"
              onScroll={handleContentScroll}
            >
              <section id={settingsSectionDomId("theme")} className="scroll-mt-5 border-b border-[var(--line-hairline)] pb-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-[var(--accent-primary)]">
                      <Palette aria-hidden="true" size={17} strokeWidth={1.8} />
                      <span className="instrument-label">Appearance / Theme</span>
                    </div>
                    <h3 className="mt-2 text-lg font-semibold text-[var(--text-primary)]">主题外观</h3>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      当前使用 <span className="font-semibold text-[var(--text-primary)]">{currentTheme.name}</span>
                    </p>
                    {themeDirectoryInfo?.themes_dir && (
                      <p className="data-readout mt-1 truncate text-[11px] text-[var(--text-faint)]" title={themeDirectoryInfo.themes_dir}>
                        {themeDirectoryInfo.themes_dir}
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

                <div className={`mt-5 grid gap-4 ${currentTheme.variants && Object.keys(currentTheme.variants).length > 0 ? "md:grid-cols-2" : ""}`}>
                  <ThemeSelect
                    themes={availableThemes}
                    currentThemeId={currentTheme.id}
                    effectiveMode={effectiveMode}
                    onSelect={setTheme}
                  />
                  {currentTheme.variants && Object.keys(currentTheme.variants).length > 0 && (
                    <VariantSelect
                      variants={currentTheme.variants}
                      activeVariant={activeVariant}
                      onSelect={setActiveVariant}
                    />
                  )}
                </div>

                <div className="mt-4">
                  <ColorModeSelect colorMode={colorMode} onSelect={changeColorMode} />
                </div>
              </section>

              <div id={settingsSectionDomId("ai")} className="scroll-mt-5 pt-6 [&>section]:mt-0">
                <AiSettingsSection />
              </div>

              <div id={settingsSectionDomId("data")} className="scroll-mt-5 pt-6 [&>section]:mt-0">
                <DataSettingsSection />
              </div>

              <div id={settingsSectionDomId("sync")} className="scroll-mt-5 pt-6 [&>section]:mt-0">
                <SyncSettingsSection />
              </div>

              <div id={settingsSectionDomId("update")} className="scroll-mt-5 pt-6 [&>section]:mt-0">
                <UpdateSettingsSection />
              </div>

              <section id={settingsSectionDomId("mods")} className="scroll-mt-5 pt-6">
                <div className="mb-4 flex items-center gap-3 border-b border-[var(--line-hairline)] pb-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--accent-primary-bg)] text-[var(--accent-primary)]">
                    <Puzzle aria-hidden="true" size={17} strokeWidth={1.8} />
                  </div>
                  <div>
                    <div className="instrument-label">Extensions</div>
                    <h3 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">扩展</h3>
                  </div>
                </div>
                <ModManagerPanel />
              </section>
            </div>
          </div>

          <footer className="flex min-h-[56px] shrink-0 items-center justify-between gap-3 border-t border-[var(--line-hairline)] bg-[var(--bg-surface)] px-4 sm:px-5">
            <span className="hidden items-center gap-2 text-xs text-[var(--text-faint)] sm:flex">
              <span className="status-led" aria-hidden="true" />
              设置已连接到当前工作区
            </span>
            <button type="button" onClick={onClose} className="action-button action-button-primary ml-auto">
              <Check aria-hidden="true" size={16} strokeWidth={1.9} />
              完成
            </button>
          </footer>
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

function ThemeSelect({
  themes,
  currentThemeId,
  effectiveMode,
  onSelect,
}: {
  themes: ThemeDefinition[];
  currentThemeId: string;
  /** 当前生效的亮/暗模式：选择内置家族时据此解析到具体主题 */
  effectiveMode: "light" | "dark";
  onSelect: (id: string) => Promise<void>;
}) {
  // 内置主题以配色家族为粒度（亮/暗由独立开关决定）；自定义/Mod 主题按具体主题列出
  const currentFamily = findFamilyByThemeId(currentThemeId);
  const customThemes = themes.filter((theme) => theme.source === "custom");
  const modThemes = themes.filter((theme) => theme.source === "mod");
  const value = currentFamily ? `family:${currentFamily.id}` : currentThemeId;

  const handleChange = (raw: string) => {
    if (raw.startsWith("family:")) {
      const family = THEME_FAMILIES.find((item) => item.id === raw.slice("family:".length));
      if (family) void onSelect(resolveFamilyThemeId(family, effectiveMode));
      return;
    }
    void onSelect(raw);
  };

  return (
    <div className="block min-w-0">
      <span className="instrument-label mb-2 block">当前主题</span>
      <SelectMenu
        value={value}
        onChange={handleChange}
        ariaLabel="当前主题"
        groups={[
          {
            label: "内置主题",
            options: THEME_FAMILIES.map((family) => ({
              value: `family:${family.id}`,
              label: `${family.name}${family.lang === "b" ? " · 仪表" : ""}`,
            })),
          },
          ...(customThemes.length > 0
            ? [{
                label: "自定义主题",
                options: customThemes.map((theme) => ({
                  value: theme.id,
                  label: `${theme.name}${theme.version ? ` · v${theme.version}` : ""}${theme.author ? ` · ${theme.author}` : ""}`,
                })),
              }]
            : []),
          ...(modThemes.length > 0
            ? [{
                label: "Mod 主题",
                options: modThemes.map((theme) => ({
                  value: theme.id,
                  label: `${theme.name}${theme.version ? ` · v${theme.version}` : ""}${theme.author ? ` · ${theme.author}` : ""}`,
                })),
              }]
            : []),
        ]}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
      />
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
        className="flex h-10 w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
      />
    </div>
  );
}

/** 亮色/暗色模式（独立于主题的开关）：跟随系统 / 亮色 / 暗色 三段切换。
 *  仅内置配色家族随模式换肤；自定义/Mod 主题自带配色方案，不受模式影响。 */
function ColorModeSelect({
  colorMode,
  onSelect,
}: {
  colorMode: ColorMode;
  onSelect: (mode: ColorMode) => void;
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
              onClick={() => onSelect(option.value)}
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
      <span className="mt-1.5 block text-[11px] text-[var(--text-faint)]">
        亮/暗仅作用于内置主题；自定义与 Mod 主题自带配色方案
      </span>
    </div>
  );
}
