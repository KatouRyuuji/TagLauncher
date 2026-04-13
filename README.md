# TagLauncher

TagLauncher 是一个基于 **Tauri 2 + React + TypeScript** 的 Windows 桌面标签式启动器与文件管理工具，用来把本地文件、文件夹、脚本和程序按“标签 + 文件柜”方式组织起来，并提供快速搜索、收藏和一键启动能力。

## 环境说明

建议开发与打包环境：

- Windows 10 / 11 x64
- Node.js 20+
- Rust stable
- Visual Studio C++ Build Tools
- WebView2 Runtime

首次拉取项目后，建议先确认以下工具可用：

```bash
node -v
npm -v
rustc -V
cargo -V
```

## 功能特性

- 标签式管理：支持标签 CRUD、多标签筛选、拖拽打标
- 文件柜归类：支持文件柜 CRUD、拖拽归档
- 对象管理：支持添加文件、文件夹、脚本、可执行文件并直接启动
- 搜索增强：支持名称、路径、标签、拼音、同义词搜索，输入为 `150ms` 防抖
- 视图切换：支持网格视图和列表视图
- 收藏与最近使用：常用对象可置顶管理
- 缩略图策略：支持手动设置缩略图，并可自动回退到图片本体或系统图标
- 欢迎弹窗：支持首次展示与“下次不再显示”

## 技术栈

- 前端：React 19、TypeScript、Zustand、Fuse.js、pinyin-pro、Tailwind CSS
- 桌面容器：Tauri 2
- 后端：Rust、rusqlite（bundled SQLite）

## 快速运行

在项目根目录执行：

```bash
npm install
npm run tauri dev
```

常用命令：

```bash
npm run dev
npm run build
npm run tauri dev
npm run tauri build
cd src-tauri && cargo test
```

命令说明：

- `npm run dev`：启动前端开发服务器，端口为 `3456`
- `npm run tauri dev`：启动桌面开发模式
- `npm run build`：执行 TypeScript 检查并构建前端
- `npm run tauri build`：构建桌面 Release
- `cargo test`：运行 Rust 测试

## 打包说明

本项目当前版本为 `1.0.0`。

Release 打包命令：

```bash
npm run tauri build
```

执行后会先跑前端构建，再由 Tauri 完成 Rust 编译和桌面打包。

当前构建已验证的产物位置：

- `src-tauri/target/release/tag-launcher.exe`

如果只是本地使用，通常直接运行 `tag-launcher.exe` 即可。

## 项目结构

```text
tag-launcher/
├─ src/                    # React + TypeScript 前端
│  ├─ components/          # UI 组件
│  ├─ hooks/               # 业务 hooks
│  ├─ stores/              # Zustand 状态管理
│  ├─ lib/                 # 搜索、同义词、Tauri 命令封装
│  ├─ data/                # 默认同义词数据
│  └─ assets/              # 前端静态资源
├─ src-tauri/
│  ├─ src/                 # Rust 后端
│  ├─ icons/               # 应用图标
│  ├─ capabilities/        # Tauri capability 配置
│  └─ tauri.conf.json      # Tauri 配置
├─ package.json
├─ package-lock.json
├─ README.md
└─ LICENSE
```

## 数据与配置

- SQLite 数据库：`%APPDATA%/com.taglauncher.app/taglauncher.db`
- 同义词词库：
  - 优先读取可执行文件同级目录的 `synonyms.json`
  - 如果不可写，则回退到 `%APPDATA%/com.taglauncher.app/synonyms.json`
- 欢迎弹窗隐藏标记：浏览器存储键 `taglauncher.hide_welcome_modal`

## License

Copyright (c) 2026 RyuuJi Soft

本项目使用 [MIT License](./LICENSE)。
