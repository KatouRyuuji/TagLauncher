# TagLauncher E2E（面向用户的端到端测试）

pytest + Playwright（Python）通过 WebView2 CDP 驱动**真实** `tag-launcher.exe`；窗口层用 Win32 `SendInput` 操作真实鼠标键盘。

## 准备

```powershell
python -m pip install -r e2e/requirements-e2e.txt
npx tauri build --debug --no-bundle          # 内嵌前端的调试包（不要直接 cargo build 主程序）
cargo build --manifest-path src-tauri/Cargo.toml --bin tl   # CLI 层需要
```

可用 `TL_E2E_EXE` / `TL_E2E_CLI` 指定被测二进制（默认 release 优先，其次 debug）。

## 运行

| 命令 | 内容 |
|---|---|
| `npm run test:e2e` | 全部，顺序 CLI → UI → 视觉 → 窗口 |
| `npm run test:e2e:cli` / `:ui` / `:visual` / `:window` | 单层 |
| `npm run test:e2e:ci` | CI 模式（CLI+UI+视觉；视觉只截图不比对） |

额外参数透传给 pytest：`npm run test:e2e:ui -- -k sync`。

报告：`.tmp-test/e2e/run-<sha>-<时间>/report.html`、`results.json`（按用例矩阵 `cases.json` 汇总覆盖），失败用例保留沙箱、截图、ARIA 快照与 IPC 记录。

## 安全设计

- 每个用例一个沙箱：重定向 LOCALAPPDATA/APPDATA/TEMP/WebView2 数据目录，exe 拷进沙箱 `bin/` 运行。
- Tauri 走 KnownFolder 的目录（窗口状态、日志）不认环境变量：会话前快照 `%APPDATA%\com.taglauncher.app`、`%LOCALAPPDATA%\com.taglauncher.app`、`%LOCALAPPDATA%\TagLauncher`，会话后还原并比对（报告 `real_dir_diff`）。
- 检测到正在运行的真实 TagLauncher 时拒绝开跑（单实例插件会把命令转给它）。
- 外部服务全部本机 mock（Anthropic 兼容接口、WebDAV）；系统对话框 / 更新检查 / shell open 在前端 IPC 层打桩。不读写真实剪贴板。

## 窗口层

会接管真实鼠标键盘约 1 分钟，开始前 5 秒倒计时（`--window-countdown N`），结束后还原光标与前台窗口。CI 默认跳过（无交互桌面）。

## 视觉基线

基线只在本机：`e2e/visual/baselines/`（已 gitignore）。无基线时首次运行生成；之后差异像素 > 0.5%（`TL_E2E_VIS_THRESHOLD`）判失败并输出 `.diff.png`。设置 `CI` 时只截图上传。刷新基线：删除对应 png 后重跑。

## CI

`.github/workflows/e2e.yml`：独立、非必需（`continue-on-error`），windows-latest，上传 `report.html`/截图。不改动 `ci.yml`。
