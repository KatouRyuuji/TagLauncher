# 1.10.0-beta UX 走查录屏（临时分支）

此目录与 `.github/workflows/ux-walkthrough.yml`、`e2e/tools/ux_walkthrough.py` **只存在于** `cursor/ux-walkthrough-8f3b`。

- 不合入 `main`，不改 release，不开 PR。
- 分支是否删除由用户决定。
- 工作流在 GitHub Actions **Windows runner** 上下载已发布的 `1.10.0-beta` x64 便携版（tag → e28484c），用 e2e harness + 系统鼠标驱动界面，ffmpeg gdigrab 录 1920×1080 桌面。
- 产物：`walkthrough.mp4`、`chapters.txt`、`screenshots/`、`contact-sheet.png`，上传为 artifact `ux-review-1.10.0`。
