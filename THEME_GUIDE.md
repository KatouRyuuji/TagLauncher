# TagLauncher 主题开发指南

> 适用版本：v1.7.1-beta
> 相关文档：[PROJECT_MANUAL.md](./PROJECT_MANUAL.md)（架构总览）· [MOD_GUIDE.md](./MOD_GUIDE.md)（Mod 开发）
> 可参照的完整示例：仓库根目录 `ExampleTheme/SkyCloudTheme/theme.json`（112 个变量键与内置主题完全一致）

## 1. 主题模型

- **主题 = 一套完整配色方案**。每套主题自带亮或暗配色，用户级「亮色/暗色」开关只作用于内置配色家族，自定义主题与 Mod 主题不受其影响。
- **id 是唯一标识**，与显示名解耦：`name` 随意命名（可与其它主题重名），`id` 必须全局唯一，推荐直接使用 uuid。
- **造型语言 `lang`**：`"a"`（纸面，默认）或 `"b"`（仪表），决定圆角/动效/装饰签名那一层风格，与配色无关。
- 主题变量是注入到 `:root` 的 CSS 自定义属性；应用内全部组件只引用变量，不写死颜色。

## 2. 交付方式

| 方式 | 位置 | 说明 |
|---|---|---|
| 自定义主题 | `<安装目录>/Plugins_Theme/` | 每个子目录放一份 `theme.json`，或直接放扁平 `.json` 文件 |
| Mod 主题包 | Mod 的 `entrypoints.theme` | 随 Mod 启用/禁用动态增删，见 MOD_GUIDE §8 |
| 导入 | 「设置 → 主题外观 → 导入」 | 选择 `.json` 或含 `theme.json` 的目录，复制进 Plugins_Theme |

最快的起步方式：在「设置 → 主题外观」对一套内置主题点「导出」，在导出的 JSON 上改色后导入。

## 3. theme.json 字段

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `id` | string | ✓ | 全局唯一标识（推荐 uuid）。内置主题与迁移保留 id 不可用（完整清单见 `src-tauri/src/extensions/theme_loader.rs` 的 `RESERVED_THEME_IDS`） |
| `name` | string | ✓ | 显示名 |
| `author` / `version` | string | | 作者 / 版本号（显示在主题列表） |
| `variables` | object | ✓ | 主题变量表，键为不带 `--` 前缀的变量名。缺失的键由内置默认值补齐，但会在导入时收到「缺少推荐变量」告警 |
| `lang` | string | | `"a"` / `"b"`，缺省按 a |
| `variants` | object | | 命名变体：`{ "compact": { "name": "紧凑", "variables": {...}, "tokens": {...}, "css": "..." } }`，变体在基础之上叠加覆盖 |
| `tokens` | object | | 分层令牌：`primitive` / `semantic` / `component` / `motion` / `layout`，展开后与 `variables` 合并（`variables` 优先级最高） |
| `components` | object | | 组件级令牌表，同上展开合并 |
| `assets` | object | | 资源替换表：逻辑名 → 路径，注入为 `--asset-<逻辑名>` 的 `url()`，供 `css` 引用 |
| `fonts` | object | | 字体资源：`font-family 名 → 字体文件路径`，自动生成 `@font-face` |
| `css` | string | | 变量无法表达的深度定制 CSS，注入到 `<style id="__theme-css">` |
| `isPreset` | bool | | 内置标记；自定义主题请勿设置 |

运行时补充字段（无需书写）：`source`（preset/custom/mod）、`fileName`、`themeRoot`（主题包根目录，供 assets/fonts 相对路径解析）。

## 4. 校验规则

**加载时拒绝（错误）**：
- 缺 `id` / `name` / `variables`，或 `variables` 为空；
- 变量名为空或带 `--` 前缀；
- `id` 命中保留清单，或与其它自定义主题重复。

**导入时告警（不阻断）**：缺失推荐变量——推荐集合即下方 §5 的完整 112 键（实现：`REQUIRED_VARIABLES`）。

## 5. 变量契约（112 键）

与内置主题保持键集一致是质量基线（`src/lib/themeVariables.test.ts` 会把示例主题与此集合做自动比对）：

**字体排印**
`font-family` `font-family-mono` `font-family-body` `font-size-xs` `font-size-sm` `font-size-base` `font-size-lg` `font-size-xl` `font-weight-normal` `font-weight-medium` `font-weight-bold` `line-height-tight` `line-height-normal` `letter-spacing`

**圆角 / 阴影 / 间距 / 动效**
`radius-sm` `radius-md` `radius-lg` `radius-xl` `radius-full` `shadow-sm` `shadow-md` `shadow-lg` `shadow-overlay` `shadow-dropdown` `shadow-card` `shadow-glow` `spacing-unit` `spacing-xs` `spacing-sm` `spacing-md` `spacing-lg` `spacing-xl` `transition-fast` `transition-normal` `transition-slow`

**背景层**
`bg-base` `bg-surface` `bg-card` `bg-hover` `bg-active` `bg-overlay` `bg-elevated` `bg-card-hover` `bg-input` `bg-gradient` `overlay-bg`

**文本层**
`text-primary` `text-secondary` `text-tertiary` `text-muted` `text-faint` `text-ghost` `text-placeholder` `text-invert`

**边框 / 强调 / 状态色**
`border-subtle` `border-default` `border-medium` `border-strong` `border-width` `border-style` `accent-primary` `accent-primary-hover` `accent-primary-bg` `accent-primary-bg-light` `color-danger` `color-danger-hover` `color-danger-bg` `color-warning` `color-success` `color-favorite` `color-focus-ring`

**特效与装饰**
`card-backdrop-filter` `sidebar-backdrop-filter` `welcome-accent-gradient` `media-caption-gradient` `status-warning-bg` `status-success-bg` `scrollbar-thumb` `scrollbar-thumb-hover`

**标签体系**
`tag-preset-colors`（新建标签的候选色板，逗号分隔色值列表）`tag-color-alpha` `tag-selected-alpha` `tag-muted-alpha` `tag-selected-border-alpha`

**布局尺寸**
`sidebar-width` `grid-col-min`（网格卡片最小列宽）

**z-index 层级**（浮层堆叠顺序，改动需保持相对关系）
`z-bg-decoration` `z-context-overlay` `z-context-menu` `z-context-submenu` `z-drag-ghost` `z-welcome-modal` `z-floating-panel` `z-quick-preview` `z-settings-overlay` `z-settings-panel` `z-command-palette` `z-shortcuts-help` `z-mod-confirm-overlay` `z-mod-confirm-panel` `z-migration-overlay` `z-migration-panel` `z-toast`

**拖拽与 Mod 面板**
`drag-ghost-offset-x` `drag-ghost-offset-y` `panel-floating-min-width` `panel-floating-min-height` `panel-floating-border-radius` `panel-titlebar-height` `panel-titlebar-bg` `panel-body-bg` `panel-border-color`

契约之外的自定义键也会注入 `:root`（你的 `css` 可以引用），切换主题时会被完整清理。

## 6. 变体（variants）

变体用于在同一主题内提供派生方案（如紧凑密度、高对比），显示在「设置 → 主题外观 → 主题变体」：

```json
"variants": {
  "compact": {
    "name": "紧凑",
    "variables": { "grid-col-min": "192px", "sidebar-width": "220px" },
    "css": ""
  }
}
```

合并顺序：内置默认值 → `tokens` 各层 → `components` → `variables` → 变体的 `tokens`/`variables`；变体 `css` 追加在主题 `css` 之后。

## 7. 安全消毒（自定义与 Mod 主题适用）

非内置主题的变量值、asset 值与 `css` 在注入前经过消毒：

- 指向远程主机的 URL（`http(s)://`、协议相对 `//`）整体中和为 `about:blank`——主题无法夹带远程信标或外联资源，字体/图片等资源必须随主题包携带；
- `css` 括号不平衡时弹告警（仍尽力注入有效部分）。

## 8. 工作流建议

1. 导出最接近目标的内置主题作为骨架；
2. 改 `id` 为新 uuid、改 `name`，先调背景/文本/强调三组色，再微调特效键；
3. 放入 `Plugins_Theme/`（或「导入」），在设置中选中即时预览；
4. 对照 §5 消除全部「缺少推荐变量」告警；
5. 亮/暗两套配色 = 两个独立主题文件（各自的 id）；
6. 发布前对照 `ExampleTheme/SkyCloudTheme/theme.json` 检查字段形态。
