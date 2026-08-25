# TagLauncher

TagLauncher 是一个基于 **Tauri 2 + React + TypeScript + Rust + SQLite** 的 Windows 桌面标签式启动器与本地对象管理工具。它用于把本地文件、文件夹、脚本、程序和图片资源按「标签 + 文件柜 + 收藏」组织起来，并提供快速搜索、拖拽归类、缩略图和一键启动能力。

文档导航：[使用手册](./USER_GUIDE.md) · [开发手册](./PROJECT_MANUAL.md) · [源码开发指南](./TUTORIAL.md) · [维护手册](./MAINTENANCE.md) · [版本对比](./版本对比.md)

[![GitHub Stars](https://img.shields.io/github/stars/KatouRyuuji/TagLauncher?style=social)](https://github.com/KatouRyuuji/TagLauncher/stargazers) · [Star 趋势](https://star-history.com/#KatouRyuuji/TagLauncher&Date)

## 功能特性

- 对象管理：添加文件、文件夹、脚本、程序和图片，支持批量导入、删除管理记录、启动对象、打开所在文件夹。
- 对象身份（NTFS 文件ID）：以「卷序列号 + 文件ID」识别对象，文件被重命名/同盘移动后自动追踪；删除/离线/跨盘移动标记为失效但保留归类；**跨盘符移动时以内容签名兜底重定位自动找回**。
- 标签系统（图状层级）：标签 CRUD、多标签交集筛选、拖拽打标、对象内标签重排和移除；**标签可多父继承构成有向无环图（DAG），选中父标签自动并入其所有后代对象**；提供关系编辑器与独立图谱视图。
- 文件柜归类：支持文件柜 CRUD，一个对象可加入多个文件柜，可清空当前文件柜筛选，拖拽归档和移出操作幂等。
- 收藏夹：收藏对象可置顶展示，并可作为内置快捷集合筛选。
- **最近使用**：侧栏集合，只显示启动过的对象；可与智能/名称/最近/添加时间/类型五种排序叠加。
- 搜索增强：支持全部/名称/标签三种模式，覆盖名称、路径、标签、拼音、拼音首字母和同义词，支持表达式语法，输入带 150ms 防抖。
- **类型筛选与排序**：顶栏按文件夹/图片/音频/程序/脚本筛选；排序偏好与网格/列表视图会记住。
- 视图切换：支持网格卡片视图和列表视图，**两者均虚拟化渲染（@tanstack/react-virtual），大库滚动流畅、内存可控**。
- **界面打磨**：自定义主题化窗口栏（拖拽移动、双击最大化、最小化/最大化/关闭随主题联动）；搜索关键词在结果中高亮；首屏骨架屏加载；空态引导文案区分「空库 / 搜索无结果 / 筛选无结果」；批量工具条支持批量收藏；设置页顶部区块快速导航；命令面板同名对象以路径第二行区分。
- **键盘优先**：`/` 聚焦搜索，Ctrl+K 命令面板，空格快速预览，方向键（网格按列）/ Home / End / 翻页选择，Enter 启动，Ctrl+C 复制路径，Ctrl+D 收藏。
- 缩略图：支持手动设置、更换、清除缩略图，图片对象和系统类型图标作为默认视觉回退。
- 主题系统：支持内置主题、自定义 JSON 主题、Mod 主题，以及主题导入、导出和刷新；应用会等待主题准备完成后再显示主窗口，避免启动闪烁。
- 扩展系统：支持 CSS、CSS+JS、Theme Mod，提供权限、生命周期、工具栏按钮、侧栏/浮动面板、**卡片与列表行对等插槽**、Mod 数据存储、文件读写、**受约束的网络请求原语（net.fetch，经 Rust 后端代理绕 CORS）**、只读标签关系等接口。
- **AI 自动打标**：在设置中填写兼容 Anthropic 协议的 API 地址、密钥与模型（三项均需自行填写，无内置默认模型），即可一键为全部（或仅未打标）对象智能打标；可开启「新对象自动打标」，导入新对象时后台自动调用 AI；支持限制标签数量、是否允许创建新标签、自定义打标偏好。密钥仅存本机、不下发前端。
- **数据管理**：支持自定义数据存放目录（exe 旁 `datapath.json` 重定向），以及一键备份、导出、导入应用数据；导出/备份走 SQLite 在线备份 API 生成页级一致快照，导入前自动备份当前库可回退。
- **云同步（WebDAV）**：把数据备份到 NAS（群晖/威联通）、Nextcloud、坚果云等任意 WebDAV 服务，支持测试连接、立即备份、云端备份列表与一键恢复；可开启「自动云备份」（启动时距上次超 24 小时自动备份）。云端副本自动剔除 AI 密钥与同步凭据，远端保留最近 10 份。数据仍全部本地化，云端只是你自己的存储。
- **在线更新（GitHub Releases）**：设置页一键检查更新，展示最新版本与发布说明，按当前架构（x64/ARM64）直达安装包下载；启动时后台自动检查（24 小时节流、同版本只提醒一次）。
- **NAS / 网络路径 / 软链接**：支持 UNC 路径（`\\server\share\...`）与映射网络盘上的对象；NTFS 文件 ID 追踪在网络盘不可用时自动回退按路径管理；符号链接对象按目标语义处理。
- 欢迎与反馈：支持首次欢迎弹窗（简介 + 特性 + 扫码赞助）、关于弹窗、Toast 和版本迁移提示。

## 交互概览

- 单击对象主体不启动对象；双击对象启动。单击替换选中，Ctrl 加选，Shift 范围选择；框选后单击空白取消。
- 网格卡片中的「启动」按钮可单击启动对象。
- 右键对象可打开、快速预览、打开所在文件夹、复制路径、设置缩略图、收藏、管理标签、加入文件柜、移出当前文件柜或删除。已在多选中的项上右键会保持多选。菜单可用方向键 / Home / End 操作，Shift+F10 或菜单键打开选中项菜单。
- 拖拽外部文件或文件夹到主区域可导入对象。
- 拖拽侧栏标签到对象可追加标签。
- 拖拽对象拖拽柄到收藏夹或文件柜可完成归档。
- 拖拽对象拖拽柄到底部左侧区域，可从对象移除当前 active 标签，或将对象移出当前文件柜。
- 拖拽对象拖拽柄到底部右侧区域，可从应用管理中移除对象；该操作只删除管理记录，不删除本地文件，并支持确认弹窗。
- 拖拽对象内部标签可重排，拖到移除区可从对象移除标签。
- 标签筛选、文件柜筛选、收藏夹筛选和最近使用筛选互斥。
- 按 `/` 或 `Ctrl+F` 聚焦搜索，`Ctrl+K` 打开命令面板，空格预览，`Ctrl+C` 复制选中路径（多项换行），`Ctrl+D` 收藏，`?` 查看快捷键。中文输入法组字时不会误触发快捷键或过滤。
- 设置、欢迎、Mod 模态、命令面板等全屏弹层打开时，工作台快捷键让路；内置空格预览不会盖住示例 Mod 弹层。
- 侧栏标题下方显示标签数和文件夹数，标签集合/文件柜标题处提供带文字的清空当前筛选入口。
- 标签和文件柜编辑弹窗中的颜色预设显示颜色名；网格视图切换按钮使用卡片样式图标。

## 技术栈

- 前端：React 19、TypeScript、Zustand、pinyin-pro、Tailwind CSS
- 桌面容器：Tauri 2
- 后端：Rust、rusqlite bundled SQLite
- 构建工具：Vite、TypeScript、Tauri CLI

## 环境要求

建议开发与打包环境：

- Windows 10 / 11（x64 或 ARM64）
- Node.js 20+
- Rust stable
- Visual Studio C++ Build Tools
- WebView2 Runtime

### 一键配置环境（推荐）

新设备拉取后，双击运行仓库根目录的 `setup.bat` 即可自动检测并安装缺失的 Node.js、Rust(rustup)、VS C++ Build Tools、WebView2 Runtime，并完成 `npm install`。脚本为全英文 + UTF-8 编码，可安全重复运行；装完新工具后请重开一个终端再继续。

首次拉取后也可手动确认工具可用：

```bash
node -v
npm -v
rustc -V
cargo -V
```

## 快速运行

配置好环境后，双击 `dev.bat` 启动开发模式（会自动预检 Node/Rust 与依赖）；或在 `tag-launcher/` 目录执行：

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
npm test
npm run test:all
cd src-tauri && cargo test
```

命令说明：

- `npm run dev`：启动 Vite 前端开发服务器，开发端口由 Tauri 配置使用 `3456`。
- `npm run build`：执行 TypeScript 检查并构建前端。
- `npm run tauri dev`：启动 Tauri 桌面开发模式。
- `npm run tauri build`：构建桌面 Release。
- `npm test`：前端快速测试（前端逻辑 + vitest 交互测试，不含 tsc/后端）。
- `npm run test:all`：全量测试（tsc 类型检查 + 前端逻辑 + vitest + Rust 单元 + 集成测试）。
- `npm run icon`：从 `src/assets/icon.png` 重新生成应用图标（备用脚本；推荐优先 `npm run tauri icon`）。
- `cargo test`：运行 Rust 测试。

## 打包

当前应用版本为 `1.6.1-beta`。双击 `build.bat` 一键打包（会自动 `npm install` 并预检工具链），或执行：

```bash
npm run tauri build
```

Windows Release 默认生成 NSIS 安装包：

```text
src-tauri/target/release/bundle/nsis/TagLauncher_<version>_x64-setup.exe
```

安装包安装时会创建开始菜单快捷方式，并在功能选择页提供桌面快捷方式可选项；安装语言可在 English / SimpChinese 之间选择。项目 MIT 许可证会显示在安装程序许可页面中。

### Windows ARM64（原生构建）

在 Windows on ARM 设备上可构建原生 ARM64 安装包，避免 x64 模拟带来的性能与能耗损失：

```bash
build-arm64.bat
```

该脚本等价于 `build.bat aarch64-pc-windows-msvc`，会自动执行 `rustup target add aarch64-pc-windows-msvc` 并按目标架构打包，输出位于 `src-tauri/target/aarch64-pc-windows-msvc/release/bundle/`。如链接器提示缺少 ARM64 工具集，请在 Visual Studio Installer 中补装「MSVC v143 - ARM64 build tools」组件。

## 持续集成与发版

- **CI（`.github/workflows/ci.yml`）**：push / PR 自动运行完整测试（前端类型检查 + 逻辑/交互测试 + 后端单元/集成测试 + 前端生产构建校验），与本地 `npm run test:all` 同一套脚本。
- **发版（`.github/workflows/release.yml`）**：推送版本 tag（如 `1.4.0`）自动构建 Windows x64 + ARM64 双架构安装包并生成**草稿 Release**，人工检查后发布；Actions 页也可手动触发构建产出测试用 artifact。
- **应用内更新**：客户端「设置 → 软件更新」从 GitHub Releases 检查新版本并引导下载安装。
- 完整发版流程见 [MAINTENANCE.md](./MAINTENANCE.md)（维护手册）。

## 数据目录

运行时会在可执行文件同级目录创建以下目录：

```text
Builtin/          内置资源目录
Plugins_Theme/    自定义主题目录
Plugins_Mods/     Mod 目录
Save/             应用原生数据目录
Save/taglauncher.db
Save/Backups/     备份与导入前自动快照
```

### 自定义数据目录

可在「设置 → 数据管理」中把应用原生数据（`Save/`）重定向到任意目录。重定向指针写在 exe 旁的 `datapath.json`（仅影响 `Save/`，`Builtin/` 与 `Plugins_*` 仍固定在 exe 同级）：

```json
{ "save_dir": "D:\\MyData\\TagLauncher\\Save" }
```

切换目录会把当前数据库以 SQLite 在线备份快照复制到新位置；导入数据会覆盖当前库并在导入前自动备份到 `Save/Backups/`。两类操作完成后应用会自动重启以生效。

同义词词库：

- 优先读取可执行文件同级目录的 `synonyms.json`。
- 如果该位置不可写或不可用，则回退到应用数据目录中的 `synonyms.json`。

欢迎弹窗隐藏标记保存在浏览器存储键：

```text
taglauncher.hide_welcome_modal
```

拖拽移除对象时，“下次不再确认”标记保存在浏览器存储键：

```text
taglauncher.skip_remove_item_confirm
```

启动准备态：

- Tauri 主窗口默认不可见。
- 前端完成主题加载和 CSS 变量应用后调用窗口 `show()`。
- `index.html` 初始带有 `data-app-preparing="true"`，主题准备完成后由 `ThemeProvider` 移除。

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
├─ ExampleMod/             示例 Mod(开发手册 §15 的参照实现)
├─ ExampleTheme/           示例主题
├─ scripts/                测试与构建辅助脚本
├─ design-system/          设计系统资源
├─ .github/workflows/      CI 与发版流水线
├─ package.json
├─ vite.config.ts
├─ postcss.config.js
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

前端主搜索使用内存索引，支持前缀匹配、低容错英文匹配、拼音匹配、同义词扩展和表达式求值。后端保留 SQLite FTS5 搜索能力，当前主要作为辅助接口和后续扩展基础。

## License

Copyright (c) 2026 RyuuJi Soft

本项目使用 [MIT License](./LICENSE)。
