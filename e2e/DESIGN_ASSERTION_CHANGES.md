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

## 7. 质量打磨（t53u）：玻璃可见、截断、探头可读、收纳芯片与清单预览

- **原因**：走查录屏里探头是不可读白块、镜面读成实心白卡片、长标签不截断、钉住顶条与图标不统一、收纳两条就出滚动条。用户要求继续分析打磨，选定方案不变（镜面 / 先选动作 / 清单预览 / 探头）。
- **令牌**：`--glass-bg` / `--glass-bg-strong` 降低不透明度并带少量强调色；浅色 `--glass-border` 改用 `--text-primary` 低透明（不再用近白 `--text-invert`）。键数仍为 139，无新变量。
- **探头**（`pin_strip.rs`）：ClearType 改为抗锯齿、对比不足时换默认正文色、`CS_DROPSHADOW`、亚克力 alpha 0xC0→0x88、回退分层 92%→80%。尺寸仍是 68×148 / 悬停 168，E2E 宽度高度断言不改。
- **视觉基线**：快速窗（更透的玻璃、标签省略、脚注 kbd）、收纳页（文件芯片、动作卡图标与「推荐」徽章）、钉住浮动窗 / 抽屉（细顶线、标题与数量并列、统一线框图标）会与上一轮不同。基线不入库，CI 首次运行 `baseline-created`。
- **性能**：5k 查询 35ms 及其它上限均不改；查询热路径仍暂停亚克力与 CSS 滤镜；新增噪点是静态 repeating 渐变，不含滤镜。

## 8. 探头把手放弃亚克力，改用分层实底（t53u 第二轮）

- **原因**：418b968 走查（run 43387161162）里探头仍是近白 68×148 矩形。对比拉伸后能认出「工作」「7 项」和三行文件名，但原图像素亮度 253–255、标准差 0.63——GDI `DrawText` 叠在 `SetWindowCompositionAttribute` 亚克力上几乎不可见。这是合成问题，不是字体或对比函数写错。
- **改动**（`pin_strip.rs`）：不再调用亚克力；始终 `WS_EX_LAYERED` + 铺实底双缓冲 + ClearType（已知底色）+ 约 90% 整体透明 + 三边描边。休息/悬停尺寸仍是 68×148 / 168，E2E 宽高断言不改。
- **性能**：探头是独立原生窗口，不在快速窗查询热路径上；5k 35ms 及其它上限均不改。

## 9. Win11 系统瞬态背景替换旧亚克力（t53u 第三轮·镜面）

- **原因**：95323a8 走查里快速窗在白底主窗上读成浑浊灰卡片——这是旧 `SetWindowCompositionAttribute` / Tauri `Effect::Acrylic` 加上偏灰、掺了强调色的 tint 的典型样子，不是好的玻璃。深色钉住同样发闷。
- **改动**：Windows 11 build ≥ 22621 用 `DwmSetWindowAttribute(DWMWA_SYSTEMBACKDROP_TYPE = DWMSBT_TRANSIENTWINDOW)`，跟随 `DWMWA_USE_IMMERSIVE_DARK_MODE`，圆角与阴影交给合成器（`DWMWCP_ROUND`）。不再调用 `Effect::Acrylic`。内容层改为明亮 tint（浅 `#fafafc` 约 62%、深 `#1c1c20` 约 62%）加 1px 内高光；不支持时用约 92% 干净实底，绝不走浑浊灰，也不再叠 CSS `backdrop-filter`。查询期间不再拆掉系统背景（合成器侧比 CSS 模糊便宜）。键数仍为 139，无新变量。
- **视觉基线**：快速窗、钉住浮动窗 / 抽屉的镜面材质会与 95323a8 不同（更亮、有系统噪点与圆角阴影，不再是灰卡片）。基线不入库，CI 首次运行 `baseline-created`。
- **性能**：5k 查询 35ms 及其它上限均不改；不放宽、不 skip、不按测量开关。需在正式/debug 构建上重测并报告 p95。

## 10. 探头改用 UpdateLayeredWindow（t53u 第三轮·把手）

- **原因**：95323a8 探头文字已可读，但 `SetWindowRgn` 圆角呈台阶、顶边描边错位或断裂、`CS_DROPSHADOW` 在 region 上无效、约 90% 整体透明让桌面图标透过来。
- **改动**（`pin_strip.rs`）：按像素 alpha 的分层窗口，`UpdateLayeredWindow` 上传预乘 BGRA。软件抗锯齿圆角（仅内侧）、边距里的软阴影、1px 描边、DirectWrite 级别的灰度抗锯齿文字（GDI `ANTIALIASED_QUALITY`，不用 ClearType）。卡片本体约 98% 不透明；通透感靠顶部高光。卡片休息/悬停尺寸仍是 68×148 / 168；HWND 在非贴边一侧和上下含 16 逻辑像素阴影边距，贴边一侧边距为 0（仍与工作区齐平）。阴影区 `WM_NCHITTEST` 返回 `HTTRANSPARENT`（点击穿透）。渲染按设备像素（已有的物理矩形 / PerMonitorV2 缩放）。
- **E2E**：`D-PIN-*` 的休息宽度与上下对齐改看 `pin_diag.handleRect`（卡片），不再用 `GetWindowRect` 的 HWND 宽高——HWND 现在比卡片大，卡片尺寸断言本身不变（E-PIN-04 本就用 handleRect）。
- **性能**：探头是独立原生窗口，不在快速窗查询热路径上；5k 35ms 及其它上限均不改。

## 11. 探头文字对比、更淡阴影、去掉贴边发丝（t53u 第四轮·把手）

- **原因**：94d61e4 走查 4× 里圆角与阴影已对，但灰度 AA 在 12px 上发细发灰（「7 项」和三行文件名对比不足），阴影峰值 0.40、边距 16 对 68px 探头过重，贴边 1px 灰描边在屏幕边缘是发丝。
- **改动**（`pin_strip.rs`）：标题色按 WCAG ≥ 7:1、次要色（「N 项」与文件名行）≥ 4.5:1 且更深；GDI 灰度 AA 在拷入预乘缓冲前按覆盖率做对比度提升（`TEXT_AA_POWER = 1.85`）。阴影边距 16→10 逻辑像素，峰值 alpha 0.40→0.20，仍带轻微 y 偏移。贴边一侧不再画 1px 描边。卡片仍是 68×148 / 168，E2E 继续看 `handleRect`。
- **视觉基线**：探头文字更实、阴影更淡、贴边无发丝。基线不入库，CI 首次运行 `baseline-created`。
- **性能**：探头不在查询热路径；5k 35ms 及其它上限均不改。
