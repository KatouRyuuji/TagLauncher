export interface ThemeDefinition {
  id: string;
  name: string;
  author?: string;
  version?: string;
  /** CSS 变量键值对，键名不含 `--` 前缀 */
  variables: Record<string, string>;
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
}

export interface CustomThemesResult {
  themes: ThemeDefinition[];
  errors: ThemeLoadError[];
}
