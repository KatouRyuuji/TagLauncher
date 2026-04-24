export interface ThemeDefinition {
  id: string;
  name: string;
  author?: string;
  version?: string;
  /** CSS 变量键值对，键名不含 `--` 前缀 */
  variables: Record<string, string>;
  /** 分层 token：用于商业级主题包的稳定设计契约 */
  tokens?: ThemeTokenLayers;
  /** 资源替换表，值为相对主题包根目录的路径或 data/url */
  assets?: Record<string, string>;
  /** 字体资源声明，key 为 font-family，value 为相对主题包根目录的路径 */
  fonts?: Record<string, string>;
  /** 组件级稳定契约：组件名 -> slot/token 键值 */
  components?: Record<string, Record<string, string>>;
  /** 主题变体，如 compact / high-contrast / acrylic */
  variants?: Record<string, ThemeVariant>;
  /**
   * 原始 CSS 字符串，注入到 `<style id="__theme-css">` 中。
   * 可用于：覆盖布局、替换图标、自定义组件样式等变量系统无法覆盖的场景。
   * 示例：
   * ```css
   * aside { width: 260px !important; }
   * [data-item-drag] svg { display: none; }
   * ```
   */
  css?: string;
  isPreset?: boolean;
  source?: ThemeSource;
  fileName?: string;
}

export interface ThemeTokenLayers {
  primitive?: Record<string, string>;
  semantic?: Record<string, string>;
  component?: Record<string, Record<string, string>>;
  motion?: Record<string, string>;
  layout?: Record<string, string>;
}

export interface ThemeVariant {
  name?: string;
  variables?: Record<string, string>;
  tokens?: ThemeTokenLayers;
  css?: string;
}

export interface ThemeLoadError {
  file_name: string;
  error: string;
}

export type ThemeSource = "preset" | "custom" | "mod";

export interface ThemeValidationIssue {
  level: "warning" | "error";
  message: string;
}

export interface ThemeInstallResult {
  theme: ThemeDefinition;
  replaced: boolean;
  file_path: string;
  validation_issues: ThemeValidationIssue[];
}

export interface ThemeExportPayload {
  theme: ThemeDefinition;
  file_name: string;
  json: string;
}

export interface ThemeDirectoryInfo {
  themes_dir: string;
  root_dir?: string;
  builtin_dir?: string;
  mods_dir?: string;
  save_dir?: string;
}

export interface CustomThemesResult {
  themes: ThemeDefinition[];
  errors: ThemeLoadError[];
}
