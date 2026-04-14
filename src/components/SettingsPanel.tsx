import { useThemeContext } from "./ThemeProvider";
import { ModManagerPanel } from "./ModManagerPanel";

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { currentTheme, availableThemes, setTheme, refreshCustomThemes } = useThemeContext();

  if (!open) return null;

  // 区分来源
  const presetThemes = availableThemes.filter((t) => t.isPreset);
  const extraThemes = availableThemes.filter((t) => !t.isPreset);

  return (
    <>
      <div className="fixed inset-0 z-[200]" style={{ backgroundColor: "var(--overlay-bg)" }} onClick={onClose} />
      <div className="fixed inset-0 z-[201] flex items-center justify-center pointer-events-none">
        <div
          className="pointer-events-auto w-[480px] max-w-[90vw] max-h-[80vh] rounded-[var(--radius-xl)] border overflow-y-auto"
          style={{
            backgroundColor: "var(--bg-overlay)",
            borderColor: "var(--border-default)",
            boxShadow: "var(--shadow-overlay)",
          }}
        >
          {/* 标题栏 */}
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--border-subtle)" }}>
            <h2 className="text-lg font-medium" style={{ color: "var(--text-primary)" }}>设置</h2>
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

          <div className="p-5">
            {/* 预设主题 */}
            <div className="mb-6">
              <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-secondary)" }}>预设主题</h3>
              <ThemeGrid themes={presetThemes} currentThemeId={currentTheme.id} onSelect={setTheme} />
            </div>

            {/* 自定义/Mod 主题（仅在有时显示） */}
            {extraThemes.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>自定义主题</h3>
                  <button
                    onClick={() => void refreshCustomThemes()}
                    className="text-xs px-2 py-1 rounded-[var(--radius-sm)] transition-colors"
                    style={{ color: "var(--text-muted)", backgroundColor: "var(--bg-hover)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
                  >
                    刷新
                  </button>
                </div>
                <ThemeGrid themes={extraThemes} currentThemeId={currentTheme.id} onSelect={setTheme} />
              </div>
            )}

            {/* 自定义主题入口提示（无自定义主题时显示） */}
            {extraThemes.length === 0 && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>自定义主题</h3>
                  <button
                    onClick={() => void refreshCustomThemes()}
                    className="text-xs px-2 py-1 rounded-[var(--radius-sm)] transition-colors"
                    style={{ color: "var(--text-muted)", backgroundColor: "var(--bg-hover)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
                  >
                    刷新
                  </button>
                </div>
                <p className="text-xs" style={{ color: "var(--text-faint)" }}>
                  将 <code className="px-1 rounded" style={{ backgroundColor: "var(--bg-hover)", color: "var(--text-muted)" }}>.json</code> 主题文件放入应用数据目录的{" "}
                  <code className="px-1 rounded" style={{ backgroundColor: "var(--bg-hover)", color: "var(--text-muted)" }}>themes/</code>{" "}
                  文件夹，点击刷新即可加载。
                </p>
              </div>
            )}

            {/* Mod 管理 */}
            <div>
              <h3 className="text-sm font-medium mb-3" style={{ color: "var(--text-secondary)" }}>扩展</h3>
              <ModManagerPanel />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ── 主题网格子组件 ─────────────────────────────────────────────────────────

interface ThemeGridProps {
  themes: { id: string; name: string; variables: Record<string, string> }[];
  currentThemeId: string;
  onSelect: (id: string) => Promise<void>;
}

function ThemeGrid({ themes, currentThemeId, onSelect }: ThemeGridProps) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {themes.map((theme) => {
        const isActive = theme.id === currentThemeId;
        const bgBase = theme.variables["bg-base"];
        const bgSurface = theme.variables["bg-surface"];
        const accent = theme.variables["accent-primary"];
        const textPrimary = theme.variables["text-primary"];

        return (
          <button
            key={theme.id}
            onClick={() => void onSelect(theme.id)}
            className="flex flex-col items-center gap-2 p-3 rounded-[var(--radius-md)] border transition-all"
            style={{
              borderColor: isActive ? accent : "var(--border-subtle)",
              backgroundColor: isActive ? `${accent}15` : "var(--bg-card)",
            }}
          >
            {/* 预览色块 */}
            <div
              className="w-full h-10 rounded-[var(--radius-md)] border flex items-center justify-center gap-1 overflow-hidden"
              style={{ backgroundColor: bgBase, borderColor: "var(--border-subtle)" }}
            >
              <div className="w-3 h-6 rounded-sm" style={{ backgroundColor: bgSurface }} />
              <div className="flex-1 h-6 rounded-sm flex items-center justify-center" style={{ backgroundColor: bgSurface }}>
                <div className="w-4 h-1.5 rounded-full" style={{ backgroundColor: accent }} />
              </div>
            </div>
            <span className="text-xs font-medium" style={{ color: isActive ? accent : textPrimary }}>
              {theme.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
