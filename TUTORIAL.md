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
├─ lib/             # db 调用、搜索、同义词
├─ data/            # 默认同义词库
└─ assets/          # 前端静态资源

src-tauri/src/
├─ commands.rs      # Tauri commands
├─ db.rs            # SQLite 初始化与迁移
├─ lib.rs           # Tauri 构建与命令注册
└─ main.rs          # 入口
```

## 3. 前端关键模块

## 3.1 `App.tsx`

职责：

- 组合 Sidebar / SearchBar / ItemView / WelcomeModal。
- 初始化同义词加载。
- 监听系统拖拽事件并转为对象添加。

关键点：

- 启动时通过 `void loadSynonyms()` 异步加载同义词。
- 欢迎弹窗“下次不再显示”用 `localStorage` 键 `taglauncher.hide_welcome_modal`。

## 3.2 状态层 `stores/appStore.ts`

核心状态：

- 数据：`items`、`tags`、`cabinets`
- 筛选：`selectedTagIds`、`selectedCabinetId`、`showFavorites`
- UI：`searchQuery`、`searchMode`、`viewMode`

筛选互斥策略：

- 选择标签时会清空文件柜和收藏筛选。
- 选择文件柜时会清空标签和收藏筛选。
- 打开收藏时会清空标签和文件柜筛选。

## 3.3 搜索层 `lib/search.ts` + `hooks/useItems.ts`

当前搜索流程是三段式：

1. `filterItemsByTags`：先做标签 AND 过滤。
2. `buildSearchIndex`：对过滤结果构建拼音增强字段与 Fuse 索引。
3. `searchWithIndex`：对 query（含同义词扩展）执行检索。
4. 
## 3.4 同义词层 `lib/synonyms.ts`

- `loadSynonyms` 调后端 `read_synonyms`。
- 加载失败时不会中断主流程，降级为空映射并输出日志。
- `expandQuery` 在查询词上做同义词扩展。

## 4. 后端关键模块

## 4.1 `db.rs`（数据库初始化与迁移）

- 采用 SQLite（`rusqlite` bundled）。
- 表结构包括：`items`、`tags`、`item_tags`、`items_fts`、`cabinets`、`cabinet_items`。
- 包含迁移逻辑：例如 `items.type` 扩展支持 `image`。

## 4.2 `commands.rs`（命令实现）

主要命令组：

- 对象：`add_item` / `remove_item` / `get_items` / `launch_item` / `update_item_icon`
- 标签：`get_tags` / `add_tag` / `update_tag` / `remove_tag` / `set_item_tags`
- 文件柜：`get_cabinets` / `add_cabinet` / `update_cabinet` / `remove_cabinet` / 关联命令
- 搜索：`search_items`（备用后端搜索）
- 同义词：`read_synonyms`

### 4.2.1 关键修复说明

1. `add_item` 重复路径修复
- 使用 `INSERT OR IGNORE` 后，不能依赖 `last_insert_rowid()`。
- 现改为按 `path` 回查，保证重复添加返回正确对象。

2. 锁粒度优化
- `get_items` / `search_items` / `get_cabinet_items` 改为：
  - 先短锁查询数据；
  - 释放锁后执行图标提取；
  - 再短锁补齐标签。
- 目的是避免 DB 锁在外部 IO（如 PowerShell 图标提取）期间被长时间占用。

3. 移除潜在 panic
- `get_item_tags` 和 `items_with_tags` 改为 `Result` 链路，移除 `unwrap`。

4. 同义词路径回退
- 优先 `exe` 同级 `synonyms.json`。
- 若不可写，回退到 `%APPDATA%/com.taglauncher.app/synonyms.json`。

## 4.3 `lib.rs`（Tauri 组装）

- 注册插件：`shell`、`dialog`。
- 初始化数据库并 `app.manage(database)`。
- 注册所有 command 供前端 `invoke` 调用。

## 5. 数据模型速览

### 5.1 items

- `id`、`name`、`path`（唯一）
- `type`：`folder/image/exe/bat/ps1`
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

当前是便携式单 exe 为主：

```bash
npm run tauri build
```

产物：

- `src-tauri/target/release/tag-launcher.exe`

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

## 8.3 欢迎弹窗图片替换

- 默认资源：`src/assets/welcome.png`
- 引用位置：`src/components/WelcomeModal.tsx`

## 9. 构建与回归建议

常用命令：

```bash
npm run build
cd src-tauri && cargo test
npm run tauri build
```

建议至少覆盖：

- 对象新增/删除/启动
- 标签与文件柜 CRUD
- 拖拽流程（打标、归档）
- 搜索（中文/拼音/同义词）
- 缩略图设置与回退
- 欢迎弹窗“下次不再显示”与“关于我”复弹