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
}
