# TagLauncher

TagLauncher 是一个基于 **Tauri 2 + React + TypeScript + Rust + SQLite** 的 Windows 桌面标签式启动器与本地对象管理工具。它用于把本地文件、文件夹、脚本、程序和图片资源按「标签 + 文件柜 + 收藏」组织起来，并提供快速搜索、拖拽归类、缩略图和一键启动能力。

当前项目处于特性迭代阶段，功能和扩展 API 仍可能调整。更完整的产品规格见 [应用设计.md](../应用设计.md)。

## 功能特性

- 对象管理：添加文件、文件夹、脚本、程序和图片，支持批量导入、删除管理记录、启动对象、打开所在文件夹。
- 标签管理：支持标签 CRUD、多标签交集筛选、拖拽打标、对象内标签重排和移除。
- 文件柜归类：支持文件柜 CRUD，一个对象可加入多个文件柜，拖拽归档操作幂等。
- 收藏夹：收藏对象可置顶展示，并可作为内置快捷集合筛选。
- 搜索增强：支持全部/名称/标签三种模式，覆盖名称、路径、标签、拼音、拼音首字母和同义词，输入带 150ms 防抖。
- 视图切换：支持网格卡片视图和列表视图。
- 缩略图：支持手动设置、更换、清除缩略图，图片对象和系统类型图标作为默认视觉回退。
- 主题系统：支持内置主题、自定义 JSON 主题、Mod 主题，以及主题导入、导出和刷新。
- 扩展系统：支持 CSS、CSS+JS、Theme Mod，提供权限、生命周期、工具栏按钮、侧栏/浮动面板、卡片插槽、Mod 数据存储和文件读写接口。
- 欢迎与反馈：支持首次欢迎弹窗、关于弹窗、Toast 和版本迁移提示。

## 交互概览

- 单击对象主体不启动对象；双击对象启动。
- 网格卡片中的「启动」按钮可单击启动对象。
- 右键对象可打开、打开所在文件夹、设置缩略图、收藏、管理标签、加入文件柜、移出当前文件柜或删除。
- 拖拽外部文件或文件夹到主区域可导入对象。
- 拖拽侧栏标签到对象可追加标签。
- 拖拽对象拖拽柄到收藏夹或文件柜可完成归档。
- 拖拽对象内部标签可重排，拖到移除区可从对象移除标签。
- 标签筛选、文件柜筛选和收藏夹筛选互斥。

## 技术栈

- 前端：React 19、TypeScript、Zustand、Fuse.js、pinyin-pro、Tailwind CSS
- 桌面容器：Tauri 2
- 后端：Rust、rusqlite bundled SQLite
- 构建工具：Vite、TypeScript、Tauri CLI

## 环境要求

建议开发与打包环境：

- Windows 10 / 11 x64
- Node.js 20+
- Rust stable
- Visual Studio C++ Build Tools
- WebView2 Runtime

首次拉取后建议确认工具可用：

```bash
node -v
npm -v
rustc -V
cargo -V
```

## 快速运行

在 `tag-launcher/` 目录执行：

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

- `npm run dev`：启动 Vite 前端开发服务器，开发端口由 Tauri 配置使用 `3456`。
- `npm run build`：执行 TypeScript 检查并构建前端。
- `npm run tauri dev`：启动 Tauri 桌面开发模式。
- `npm run tauri build`：构建桌面 Release。
- `cargo test`：运行 Rust 测试。

## 打包

当前应用版本为 `1.0.0`，Release 打包命令：

```bash
npm run tauri build
```

构建完成后，桌面可执行文件通常位于：

```text
src-tauri/target/release/tag-launcher.exe
```

## 数据目录

运行时会在可执行文件同级目录创建以下目录：

```text
Builtin/          内置资源目录
Plugins_Theme/    自定义主题目录
Plugins_Mods/     Mod 目录
Save/             应用原生数据目录
Save/taglauncher.db
```

同义词词库：

- 优先读取可执行文件同级目录的 `synonyms.json`。
- 如果该位置不可写或不可用，则回退到应用数据目录中的 `synonyms.json`。

欢迎弹窗隐藏标记保存在浏览器存储键：

```text
taglauncher.hide_welcome_modal
```

## 项目结构

```text
tag-launcher/
├─ src/
│  ├─ components/          React UI 组件
│  ├─ hooks/               数据加载、搜索、主题、Mod hooks
│  ├─ stores/              Zustand 状态管理
│  ├─ lib/                 搜索、同义词、Tauri 命令封装、Mod 运行时
│  ├─ themes/              内置主题定义
│  ├─ types/               TypeScript 类型
│  ├─ data/                默认同义词数据
│  └─ assets/              前端静态资源
├─ src-tauri/
│  ├─ src/
│  │  ├─ commands/         Tauri 命令
│  │  ├─ db/               SQLite 连接、schema、迁移
│  │  ├─ extensions/       Mod 和主题加载
│  │  ├─ models/           Rust 数据模型
│  │  └─ services/         业务服务
│  ├─ capabilities/        Tauri capability 配置
│  ├─ icons/               应用图标
│  └─ tauri.conf.json      Tauri 配置
├─ package.json
├─ vite.config.ts
├─ tailwind.config.js
└─ README.md
```

## 核心架构

```text
React UI
  ↓
Zustand Store
  ↓
Hooks 和 lib/db.ts
  ↓ Tauri invoke
Rust commands
  ↓
Service 层
  ↓
SQLite
```

前端主搜索使用 Fuse.js 内存索引。后端保留 SQLite FTS5 搜索能力，当前主要作为辅助接口和后续扩展基础。

## License

Copyright (c) 2026 RyuuJi Soft

本项目使用 [MIT License](./LICENSE)。
