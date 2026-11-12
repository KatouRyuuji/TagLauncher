# PR #66 UI 打磨走查录屏（临时分支）

此目录与 `.github/workflows/ux-walkthrough.yml`、`e2e/tools/ux_walkthrough.py` **只存在于** `cursor/ux-walkthrough-8f3b`。

- 不合入 `main`，不改 polish PR，不发版，不开走查 PR。
- 分支是否删除由用户决定。
- 工作流在 GitHub Actions **Windows runner** 上下载 `cursor/ui-polish-8f3b` 上 Release 工作流（`workflow_dispatch`，只出 artifact、不创建 GitHub Release）的 x64 便携版，用 e2e harness + 系统鼠标驱动界面，ffmpeg gdigrab 录 1920×1080 桌面。
- 相对 1.10.0-beta 那次走查的补丁：SendInput 逐字输入（不用剪贴板）、等资源管理器文件出现后再真实右键、SW_HIDE 藏黑色 runner 日志窗（不关进程）、尽量改系统 150% DPI 并以实测披露。
- 产物：`after.mp4`、`chapters.txt`、`screenshots/`、`contact-sheet.png`，上传为 artifact `ux-review-ui-polish`。左右对比图在盒子上用 t51u 的 `/workspace/ux-review-1.10.0/screenshots` 与本次截图合成。
