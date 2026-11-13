# 有意设计变更导致的断言更新（ui-redesign）

本文件记录因选定方案落地而必须更新的测试断言。未 skip / xfail。除下方第 6 条经用户确认的 5k 查询上限外，未放宽其它性能阈值。

## 1. 边缘把手：8px 细条 → 探头（68×148）

- **原因**：用户选定「探头」方案。休息态 68×148 逻辑像素，悬停卡片加宽到 168（仍不打开抽屉），顶与展开抽屉对齐。TME_HOVER 120ms 或点击才滑出。
- **单元测试** `src-tauri/src/pin.rs` `sizes_follow_dpi`：
  - `handle_width(1.0)` 8 → 68；`(1.5)` 12 → 102；`(0.5)` 4 → 34
  - 新增 `handle_height(1.0) == 148`、`handle_hover_width(1.0) == 168`
  - 新增 `peek_rect` 与同 offset 展开抽屉顶对齐、右缘贴边
- **E2E** `e2e/tests/desktop/test_desktop_pin.py` `collapsed()`：
  - 原：`6 <= width <= round(8 * scale) + 2`
  - 现：`round(68 * scale) ± 4`（取整容差，非放宽）
  - 只在鼠标已离开（`park_mouse`）后断言休息宽度；悬停加宽 168 不计入 collapsed
- **E2E** `e2e/tests/ui/test_pin.py` E-PIN-04：
  - 宽度同上 `round(68 * scale) ± 4`
  - 新增高度 `round(148 * scale) ± 4`
  - 展开仍为面板宽 320（不变）

## 2. 抽屉滑出动画 84ms → 240ms

- **原因**：与前端 `--transition-normal`（240ms）统一。
- **代码**：`ANIM_STEP` 14ms → 40ms（仍 6 步）。E2E 等待上限 3s，不改阈值。

## 3. 视觉基线

- 视觉基线不入库（`e2e/visual/baselines/` 见 `.gitignore`）。CI 首次运行会 `baseline-created`。
- 有意变化的表面：快速窗（镜面毛玻璃、分组标题、匹配高亮、选中强调条）、收纳页（动作卡片、「打标签」推荐）、钉住浮动窗 / 抽屉（清单预览条、同一玻璃令牌）、边缘探头（原生绘制）。
- 测试文案「没有匹配的对象」、收纳 `data-testid`、钉住 `pin-*` testid 均保留。

## 4. 主题变量契约 132 → 139

- 新增 `--glass-bg` `--glass-bg-strong` `--glass-blur` `--glass-border` `--glass-highlight` `--glass-shadow` `--glass-accent-bar`（亮暗两套，见 `shapeLang.ts`）。
- 同步：`REQUIRED_VARIABLES`、`ExampleTheme/SkyCloudTheme/theme.json`、`THEME_GUIDE.md`。
- 旧自定义主题缺少这些键只产生「缺少推荐变量」告警，运行时由 `DEFAULT_THEME_VARIABLES` 补齐（不阻断加载）。

## 5. 未改动的性能阈值

- 快速窗 50k 唤出 / 搜索既有上限（80ms / 100ms）
- 主窗滚动 p95 < 50ms
- 钉住常驻内存 < 60MB、空闲 CPU < 1%

## 6. 快速窗 5k 搜索 p95：30ms → 35ms

- **原因**：镜面毛玻璃（Windows 亚克力 + 顶栏 CSS `backdrop-filter`）在查询热路径上约增加 4ms。同 runner 对照中 PR #66（4d27d45）正式构建 5k p95 为 29.6ms，距 30ms 仅约 0.4ms 余量。本 PR 多轮绘制优化后，正式约 29.9–31.3ms、debug 约 32.9–34.9ms，稳定落在这条窄带上。2026-11-13 用户明确选择保持镜面，只把 5k 上限调到 35ms。不实施输入期间停模糊、列表改不透明、或去掉玻璃。
- **E2E** `e2e/tests/ui/test_quick.py`：`QUERY_P95_MS[5000]` 30 → 35；模块说明同步。
- **用例表** `e2e/cases.json` E-PERF-QUICK：`输入到出结果 p95 5k≤35ms`。
- 50k 查询 100ms、唤出 80/150ms、隐藏内存、空闲 CPU、主窗滚动等其它上限均不改。
