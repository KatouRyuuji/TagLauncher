# TagLauncher 源码开发指南

本文档面向希望二次开发 TagLauncher 的开发者。
内容基于当前代码实现（Tauri 2 + React + TypeScript + Rust）。

## 1. 架构总览

TagLauncher 采用前后端分层：

- 前端（`src/`）：负责界面、交互、状态管理、客户端搜索。
- 后端（`src-tauri/src/`）：负责数据库、系统调用、类型识别、图标提取。
- 通过 Tauri `invoke` 在前后端通信。

### 1.1 数据流主线

1. 前端 Hook 调用 `src/lib/db.ts`。
2. `db.ts` 调用 Tauri command。
3. Rust 侧处理数据库/系统行为并返回 JSON。
4. Hook 更新 Zustand Store。
5. 组件订阅 Store 后重渲染。

## 2. 目录与职责

```text
src/
├─ components/      # 视图与交互组件
├─ hooks/           # 数据组织与业务流程
├─ stores/          # 全局状态（Zustand）
├─ lib/             # db 调用、搜索、同义词、工作台查询
├─ data/            # 默认同义词库
└─ assets/          # 前端静态资源

src-tauri/src/
├─ commands/        # Tauri 命令（按域分模块：item/tag/cabinet/mod/net/ai/data/sync/update/settings/synonym/launch/object_preview/search）
├─ db/              # SQLite 连接、schema 与迁移（migrations/v00x）
├─ services/        # 业务服务（item/tag/search/icon/object_preview/launch/file_identity/path/settings + net）
├─ extensions/      # Mod 与主题加载（mod_loader/mod_registry/theme_loader）
├─ models/          # Rust 数据模型
├─ lib.rs           # Tauri 构建与命令注册
└─ main.rs          # 入口
```

## 3. 前端关键模块

## 3.1 `App.tsx`

职责：

- 组合 Sidebar / SearchBar / ItemView / WelcomeModal。
- 初始化同义词加载。
- 监听系统拖拽事件并转为对象添加。
- 承接对象拖拽到底部操作区后的移除标签、移出文件柜和移除管理记录流程。

关键点：

- 启动时通过 `void loadSynonyms()` 异步加载同义词。
- 欢迎弹窗“下次不再显示”用 `localStorage` 键 `taglauncher.hide_welcome_modal`。
- 拖拽移除对象确认框的“下次不再确认”用 `localStorage` 键 `taglauncher.skip_remove_item_confirm`。

## 3.2 状态层 `stores/appStore.ts`

核心状态：

- 数据：`items`、`tags`、`cabinets`
- 筛选：`selectedTagIds`、`selectedCabinetId`、`showFavorites`
- UI：`searchQuery`、`searchMode`、`viewMode`

筛选互斥策略：

- 选择标签时会清空文件柜和收藏筛选。
- 选择文件柜时会清空标签和收藏筛选。
- 打开收藏时会清空标签和文件柜筛选。
- 侧栏分类标题右侧的清空按钮只清空当前模式筛选：标签页清空 active 标签，文件柜页取消 active 文件柜。

## 3.3 内部拖拽层 `stores/internalDragStore.ts` + `lib/internalPointerDrag.ts`

内部拖拽使用 Pointer 事件和应用内状态，不使用 HTML5 `dataTransfer`。当前主要目标：

- 侧栏标签拖到对象：追加标签。
- 对象拖到收藏夹或文件柜：收藏或归档。
- 对象拖到底部左侧操作区：移除当前 active 标签，或移出当前文件柜。
- 对象拖到底部右侧操作区：从应用管理中移除对象，不删除本地文件。
- 对象内标签拖拽：重排或移除标签。

## 3.4 搜索层 `lib/search.ts` + `hooks/useItems.ts`

搜索引擎为自研实现（不依赖 Fuse.js）。当前搜索流程是三段式：

1. `filterItemsByTags`：先做标签 AND 过滤。
2. `buildSearchIndex`：对过滤结果构建拼音全拼/首字母增强字段（仅拼音字段，不构建 Fuse 索引）。
3. `searchWithIndex`：先 `parseQuery` 解析表达式（`&&` `||` 空格 `()` `@` `!!`），对每个非严格子项做同义词扩展，再以前缀匹配 / 拼音 / 英文低容错 / 严格匹配逐项求值。
## 3.5 同义词层 `lib/synonyms.ts`

- `loadSynonyms` 调后端 `read_synonyms`。
- 加载失败时不会中断主流程，降级为空映射并输出日志。
- `expandQuery` 在查询词上做同义词扩展。

## 4. 后端关键模块

## 4.1 `db/`（连接、schema 与迁移）

- 采用 SQLite（`rusqlite` bundled）。
- `connection.rs` 负责连接与 `PRAGMA`，`schema.rs` 建表并幂等回填 FTS，`migrations/` 下按版本（v001..v007）做表结构迁移。
- 表结构包括：`items`、`tags`、`item_tags`、`tag_relations`、`items_fts`、`cabinets`、`cabinet_items`、`mod_kv`、`mod_records` 等。
- 迁移逻辑：`items.type` 扩展支持 `image`/`audio`（v004）→ 对象身份去 path 唯一+加文件ID（v005）→ 内容签名列（v006）→ 标签父子关系表（v007）。

## 4.2 `commands/`（命令实现，按域分模块）

实际 90 个 `#[tauri::command]` 分布在 `commands/` 下的多个模块（item/tag/cabinet/mod/net/ai/data/sync/update/settings/synonym/launch/object_preview/search），命令体一般转调 `services/` 下的业务服务。主要命令组：

- 对象：`add_item` / `add_items` / `remove_item` / `get_items` / `launch_item` / `update_item_icon`
- 标签：`get_tags` / `add_tag` / `update_tag` / `remove_tag` / `set_item_tags` / `get_tag_relations` / `add_tag_relation` / `remove_tag_relation`
- 文件柜：`get_cabinets` / `add_cabinet` / `update_cabinet` / `remove_cabinet` / 关联命令
- 搜索：`search_items`（备用后端搜索）
- 同义词：`read_synonyms`
- Mod/主题：`get_mods` / `get_mod_content` / `get_mod_dir` / `enable_mod` / `disable_mod` / `import_mod` / `delete_mod` / `get_theme_directory_info` / `install_theme_file` 等
- 网络原语：`net_fetch`（Mod 用，经后端 ureq 代理）
- AI 打标：`ai_get_config` / `ai_set_config` / `ai_is_configured` / `ai_test_connection` / `ai_suggest_tags`
- 数据管理：`get_data_directory_info` / `set_data_directory` / `reset_data_directory` / `backup_data` / `export_data` / `import_data` / `restart_app`
- 云同步：`sync_get_config` / `sync_set_config` / `sync_clear_password` / `sync_test_connection` / `sync_list_backups` / `sync_backup_now` / `sync_restore`
- 在线更新：`update_check`
- 对象预览：`get_object_file_info` / `list_object_directory` / `get_audio_preview`

### 4.2.1 关键修复说明

1. `add_item` 重复路径修复
- 使用 `INSERT OR IGNORE` 后，不能依赖 `last_insert_rowid()`。
- 现改为按 `path` 回查，保证重复添加返回正确对象。

2. 锁粒度优化
- `get_items` / `get_item` / `get_items_by_ids` / `search_items` / `get_cabinet_items` 统一改为：
  - 先短锁查询数据；
  - 释放锁后执行图标提取（`item_service::fill_visuals`）；
  - 再短锁补齐标签。
- 目的是避免 DB 锁在外部 IO（如 PowerShell 图标提取）期间被长时间占用。v1.3.0 把 `get_item` / `get_items_by_ids` / `search_items` 也纳入此模式（此前它们在持锁期间跑图标提取会串行阻塞所有 DB 命令），并删除了不再使用的 `icon_service::fill_auto_visual_paths`。

3. 移除潜在 panic
- `get_item_tags` 和 `items_with_tags` 改为 `Result` 链路，移除 `unwrap`。

4. 同义词路径回退
- 优先 `exe` 同级 `synonyms.json`。
- 若不可写，回退到 `%APPDATA%/com.taglauncher.app/synonyms.json`。

## 4.3 `lib.rs`（Tauri 组装）

- 注册插件：`shell`、`dialog`。
- 初始化数据库并 `app.manage(database)`。
- 注册所有 command 供前端 `invoke` 调用。

## 4.4 `ai_commands.rs`（AI 自动打标，Anthropic 协议）

- 后端只暴露无状态原语 `ai_suggest_tags`（给一个对象建议标签）；批量遍历、并发、进度、取消由前端 `hooks/useAiTagging.ts` 编排（并发池 `CONCURRENCY = 3`，建标/应用标签串行化避免重复建标）。
- HTTP 用 `ureq`（阻塞，与 `net_fetch` 一致，不引入 async 运行时）。
- 配置存于 `app_meta` KV（复用 `settings_service` 的 `get_setting`/`set_setting`），键前缀 `ai.`：`base_url`/`api_key`/`model`/`auto_tag_on_add`/`max_tags`/`allow_new_tags`/`extra_prompt`；模型由用户填写（Anthropic 兼容模型名，必填、无内置默认）。
- 关键函数：`build_endpoint`（端点归一化，补 `/v1/messages`）、`extract_text`（Anthropic `content[].text` 优先、OpenAI `choices` 兜底）、`parse_tag_list`（JSON 数组优先，逗号/换行回退）。均带单测。
- 新对象自动打标：`useItems` 派发 `taglauncher-items-added` 事件 → `App` 监听 → silent 后台调用。

## 4.5 `data_commands.rs`（数据目录 / 导入 / 导出 / 备份）

- 导出/备份/迁移统一走 **SQLite Online Backup API**（`rusqlite` 的 `backup` feature，页级一致快照），核心内部函数 `snapshot_live_db`。
- 数据目录「指针」不能存于数据库自身，放在 exe 旁 `datapath.json`：`path_service` 的 `read_data_dir_redirect` / `write_data_dir_redirect` / `default_save_dir`；**仅重定向 `Save/`**，Builtin/Plugins 仍固定 exe 同级。
- `import_data`：`validate_importable_db` 校验来源库（`app_meta.schema_version > 0`）→ 自动把当前库备份到 `Save/Backups/`（可回退）→ 用 Backup API 灌入当前连接。
- 切换目录 / 导入后需 `restart_app`（`app.restart()`）生效。

## 4.6 `sync_commands.rs`（WebDAV 云同步，v1.4.0）

- 复用 `data_commands` 的快照/校验/覆盖原语（`snapshot_live_db` / `validate_importable_db` / `overwrite_live_from`）+ `ureq` 阻塞 HTTP。
- 上传前 `strip_cloud_secrets`（删 `ai.*`/`sync.*` + VACUUM）；恢复时 `read_local_secrets` → 覆盖 → `reapply_local_secrets`（本机凭据优先）。
- PROPFIND multistatus 解析为手写扫描（`split_xml_blocks` / `extract_first_tag_text`，命名空间前缀与大小写不敏感），带 Apache/Nextcloud/无前缀三种形态的单测。
- 远端文件名 `taglauncher_<UTC时间戳>.db`（字典序即时间序），上传后按 `REMOTE_KEEP_COUNT=10` 清理旧份。
- 前端编排：`SyncSettingsSection`（设置区）+ `useStartupMaintenance`（启动自动备份，24h 节流）。

## 4.7 `update_commands.rs`（在线更新检查，v1.4.0）

- `update_check` → GitHub `/releases/latest` → `parse_release_response`（纯函数，可单测）→ `semver_gte` 版本比较（复用 `mod_loader`）→ `pick_installer_asset` 按编译期架构匹配 `_x64-setup.exe`/`_arm64-setup.exe`。
- 只检查 + 引导浏览器下载，不做静默自更新；仓库迁移须改 `GITHUB_REPO` 常量。
- 前端编排：`UpdateSettingsSection`（设置区手动检查）+ `useStartupMaintenance`（启动自动检查，localStorage 节流 24h、同版本只提示一次）。

## 5. 数据模型速览

### 5.1 items

- `id`、`name`、`path`（最近已知位置，不再唯一）
- `type`：`folder/image/audio/exe/bat/ps1`
- `icon_path`
- `created_at`、`last_used_at`
- `is_favorite`

### 5.2 tags / item_tags

- `tags` 存标签定义。
- `item_tags` 是多对多关联表。

### 5.3 cabinets / cabinet_items

- `cabinets` 存文件柜。
- `cabinet_items` 存归档关系。

### 5.4 items_fts

- FTS5 索引 `name/path`。
- 由触发器与 `items` 同步。

## 6. 缩略图与图标策略

优先级：

1. 用户手动设置的 `icon_path`
2. 自动可视资源：
   - 图片对象：直接用对象路径
   - 非图片对象：Windows 提取系统关联图标缓存为 PNG
3. 默认类型图标（前端 Emoji）

可替换缩略图格式：

- `png` `jpg` `jpeg` `webp` `bmp` `gif` `ico` `svg` `tif` `tiff` `avif` `heic` `heif`

## 7. 打包与发布

## 7.1 当前策略

当前策略是生成 Windows NSIS 安装包：

```bash
npm run tauri build
```

产物：

- `src-tauri/target/release/bundle/nsis/TagLauncher_1.5.0_x64-setup.exe`

ARM64 构建用 `build-arm64.bat`（`aarch64-pc-windows-msvc`，脚本会自动 `rustup target add`），产物为 `..._arm64-setup.exe`；`build.bat` 亦支持传入可选 target 参数。

NSIS 安装包会创建开始菜单快捷方式；桌面快捷方式在安装功能选择页中作为可选项；安装语言可选 English / SimpChinese。

## 7.2 兼容性说明

在大多数正常 Win11 x64 环境可运行，前提：

- 架构匹配（x64）；
- WebView2 Runtime 可用；
- 系统策略未阻止可执行程序运行。

## 8. 常见开发任务

## 8.1 新增对象类型支持

建议步骤：

1. 修改后端类型识别（`detect_type`）。
2. 调整数据库约束（必要时迁移 `items.type` CHECK）。
3. 更新前端类型映射（类型名、图标、后缀展示）。
4. 更新 README / TUTORIAL 文档。

## 8.2 调整搜索权重

入口在 `src/lib/search.ts`：

- `NAME_KEYS` / `TAG_KEYS` 权重可调。
- 调整后需手测中文、拼音、同义词检索效果。

## 8.3 欢迎弹窗定制

v1.3.0 起欢迎弹窗改为 标题+简介 + 特性列表 + 右侧扫码赞助卡片 + B 站主页链接。

- 组件：`src/components/WelcomeModal.tsx`
- 特性列表：编辑 `FEATURES` 数组（`isNew: true` 会显示「新」徽标）。
- 赞助二维码：`src/assets/QRCode.png`；B 站链接常量 `BILIBILI_URL`。
- 版本号：通过 `getAppVersion()` 动态获取展示。
- 「下次不再显示」使用 `localStorage` 键 `taglauncher.hide_welcome_modal`。

## 8.4 工作台排序 / 筛选 / 快捷键（v1.5.0）

- 纯函数：`src/lib/itemQuery.ts`（排序、类型筛选、键盘步进、点选/右键选择、路径复制格式、IME 判断），单测 `itemQuery.test.ts`。
- 状态：`appStore` 的 `sortMode` / `typeFilter` / `showRecent`；四者互斥筛选与收藏/标签/文件柜并列。
- 视图偏好键：`localStorage` `taglauncher.workspace_prefs`。
- 快捷键入口：`src/hooks/useWorkspaceHotkeys.ts`（listener 用 ref 固定，避免搜索刷新反复解绑；IME `isComposing`/`Process` 跳过；Delete 不含 Backspace；Enter/空格需已选中）。
- 遮罩与层级：`src/lib/workspaceChrome.ts`；全屏弹层带 `data-workspace-overlay`；Mod 模态 `data-mod-modal`。内置空格预览 `--z-quick-preview: 160`，不得盖住 Mod 模态。**不要**把新 z-index 变量写入 Rust `REQUIRED_VARIABLES`（会破坏旧自定义主题）。
- 命令面板：`CommandPalette.tsx`（仅打开时建拼音索引；组字过程不参与过滤）。
- 预览：`QuickPreview.tsx`；对象删除后自动清掉残留 `previewItemId`。
- 选择：`SelectionCanvas.tsx` 单击替换 / Ctrl 加选 / Shift 范围；可见列表变化时修剪已选 id，避免对筛出项误删。

## 9. 构建与回归建议

首次准备开发环境可运行 `setup.bat`（一键检测并安装 Node / Rust / VS C++ BuildTools / WebView2 并 `npm install`）。常用命令：

```bash
npm run test:all     # 全量测试（tsc + 前端逻辑 + vitest + cargo 单元/集成）
npm run build
cd src-tauri && cargo test
npm run tauri build
```

CI（`.github/workflows/ci.yml`）会在 push/PR 时自动跑 `npm run test:all`，发版流程见 `MAINTENANCE.md`。

建议至少覆盖：

- 对象新增/删除/启动
- 标签与文件柜 CRUD
- 拖拽流程（打标、归档、移出当前筛选、从应用移除）
- 搜索（中文/拼音/同义词；输入法组字不误筛）
- 快捷键：方向键/Home/End、Ctrl+C 多选路径、Ctrl+D 收藏、Mod 模态下不穿透
- 点选 / Ctrl / Shift、右键菜单键盘、批量工具条 Esc 先关下拉
- 缩略图设置与回退
- 欢迎弹窗“下次不再显示”与“关于我”复弹
- 云同步配置/备份/恢复（需真实 WebDAV 端点实测）与设置页检查更新
