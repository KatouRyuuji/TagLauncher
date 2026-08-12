# TagLauncher 项目手册

## 一、项目简介

TagLauncher 是一个基于 Tauri 2.x 的 Windows 桌面应用，用于通过「标签」管理和快速启动本地文件夹、程序、脚本、图片与音频等对象（folder/image/audio/exe/bat/ps1）。

核心理念：用标签代替传统的树形目录分类，支持一个项目挂多个标签，通过组合筛选快速定位。

### 现有能力概览

- 对象类型：`folder` / `image` / `audio` / `exe` / `bat` / `ps1`，未知文件按可启动对象归入 `exe`。
- 对象身份：以「NTFS 卷序列号 + 文件ID」为唯一标识，跨重命名/同盘移动稳定；`path` 降级为可更新的「最近已知位置」。跨盘符移动（卷序列号变化）时，以内容签名（文件大小 + 首/尾 16KB 的 FNV-1a 哈希）兜底重定位自动找回，详见 `file_identity.rs`。
- 标签系统（图状层级，DAG）：标签是集合、可多父继承构成有向无环图；选中父标签筛选时并入其所有后代标签的对象。三类筛选（标签/文件柜/收藏夹）互斥；标签多选取交集；提供关系编辑器与独立图谱视图。
- 批量操作：主视图框选复选对象后，可批量加入/移除标签、加入文件柜、移出当前文件柜、批量删除。
- 视图虚拟化：网格与列表视图均经 `@tanstack/react-virtual` 虚拟化（measureElement 动态测高），仅渲染可见项，大库滚动流畅、内存可控。
- 缩略图：支持手动设置/更换/清除；图片对象直接用图片，非图片对象提取系统图标缓存为 PNG，其余回退到类型 Emoji 图标。
- 音频：提供 `get_audio_preview` 等对象预览命令。
- 主题系统：内置主题 + 自定义 JSON 主题 + Mod 主题，支持变量/分层 token/组件 token/资源/字体/变体/自定义 CSS，以及导入、导出、刷新；启动时等待主题就绪再显示主窗口，避免闪烁。
- Mod 扩展系统：支持 `css` / `css+js` / `theme` 三类 Mod，提供权限声明（能力/意图标注 + API 误用防呆，**非安全沙箱**——Mod 属可信扩展，JS 以完全权限运行于主 realm，启用前须确认来源可信）、生命周期回调、工具栏按钮、侧栏/浮动面板、卡片与列表行对等插槽、Mod 数据存储、文件读写、受约束的网络请求原语（`net.fetch` 经 Rust 后端代理）、只读标签关系等接口（API 版本 3.2.0）。
- AI 自动打标：兼容 Anthropic Messages API（官方或第三方兼容地址），在设置中填写 base URL / API key / 模型后，可为全部或未打标对象批量打标，支持「新对象自动打标」「允许创建新标签」「每对象最多标签数」等选项；后端仅提供无状态「建议标签」原语，批量遍历/并发/进度/取消由前端编排。
- 数据管理：数据目录可自定义（exe 旁 `datapath.json` 记录重定向，仅重定向 `Save/`）；支持一键备份、导出、导入，统一走 SQLite Online Backup API（页级一致快照），导入前自动安全备份、可回退；切换目录或导入后自动重启生效。
- 云同步（WebDAV，v1.4.0）：备份/恢复到任意 WebDAV 服务（NAS/Nextcloud/坚果云），云端副本剔除敏感配置（`ai.*`/`sync.*`），恢复保留本机凭据；远端保留最近 10 份；可选启动时自动备份（24h 节流）。详见 §十一。
- 在线更新（GitHub Releases，v1.4.0）：`update_check` 拉取 latest release，语义版本比较 + 按架构匹配安装包资产；设置页手动检查 + 启动后台自动检查（24h 节流、同版本只提示一次）。详见 §十一。
- NAS/UNC/软链接场景：对象身份重定位支持 UNC 共享根与扩展前缀路径形态（`\\server\share\`、`\\?\C:\`、`\\?\UNC\`）作为卷句柄候选；网络文件系统无文件 ID 时优雅回退按路径管理。

---

## 二、技术架构

```
┌─────────────────────────────────────────────┐
│                  用户界面                      │
│         React 19 + TypeScript + Tailwind CSS  │
│                                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Sidebar  │ │SearchBar │ │ ItemGrid/List│  │
│  │ (标签/   │ │ (搜索/   │ │ (项目卡片/  │  │
│  │  文件柜) │ │  模式)   │ │  列表行)    │  │
│  └────┬─────┘ └────┬─────┘ └──────┬───────┘  │
│       │            │               │          │
│  ┌────┴────────────┴───────────────┴───────┐  │
│  │           Zustand Store (appStore)      │  │
│  │  items / tags / cabinets / searchQuery  │  │
│  └────────────────┬────────────────────────┘  │
│                   │                           │
│  ┌────────────────┴────────────────────────┐  │
│  │         Custom Hooks 层                  │  │
│  │  useItems / useTags / useCabinets       │  │
│  │  useSearch                              │  │
│  └────────────────┬────────────────────────┘  │
│                   │                           │
│  ┌────────────────┴────────────────────────┐  │
│  │         lib 工具层                       │  │
│  │  db.ts (Tauri invoke 封装)              │  │
│  │  search.ts (自研搜索引擎 + pinyin-pro)  │  │
│  │  synonyms.ts (同义词扩展)               │  │
│  └────────────────┬────────────────────────┘  │
│                   │ invoke()                  │
├───────────────────┼───────────────────────────┤
│                   │ IPC 边界                  │
├───────────────────┼───────────────────────────┤
│                   ▼                           │
│  ┌─────────────────────────────────────────┐  │
│  │          Rust 后端 (Tauri)              │  │
│  │                                         │  │
│  │  commands/  ← 约 81 个 Tauri 命令       │  │
│  │             (按 item/cabinet/tag/mod/   │  │
│  │              net/ai/data/settings/      │  │
│  │              synonym/launch/            │  │
│  │              object_preview/search 分模块)│  │
│  │  db/        ← SQLite 连接/schema/迁移   │  │
│  │  services/  ← 业务服务层                │  │
│  │  extensions/← Mod 与主题加载            │  │
│  │  models/    ← Rust 数据模型             │  │
│  │  lib.rs     ← 应用启动/插件/命令注册    │  │
│  │  main.rs    ← 入口                      │  │
│  │                                         │  │
│  │  ┌───────────────────────────────────┐  │  │
│  │  │  SQLite (Save/taglauncher.db)     │  │  │
│  │  │  items / tags / item_tags         │  │  │
│  │  │  cabinets / cabinet_items         │  │  │
│  │  │  items_fts (FTS5 全文搜索)        │  │  │
│  │  └───────────────────────────────────┘  │  │
│  └─────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

---

## 三、目录结构

```
tag-launcher/
├── src/                          # 前端源码
│   ├── main.tsx                  # React 入口，挂载 <App />
│   ├── App.tsx                   # 应用主容器，协调所有子组件
│   ├── index.css                 # 全局样式 (Tailwind)
│   ├── types/
│   │   └── index.ts              # TypeScript 类型定义
│   ├── stores/
│   │   └── appStore.ts           # Zustand 全局状态
│   ├── hooks/
│   │   ├── useItems.ts           # 项目数据管理 + 客户端搜索
│   │   ├── useTags.ts            # 标签 CRUD
│   │   ├── useCabinets.ts        # 文件柜 CRUD
│   │   └── useSearch.ts          # 搜索防抖
│   ├── lib/
│   │   ├── db.ts                 # Tauri invoke 封装层
│   │   ├── search.ts             # 自研搜索引擎（前缀/拼音/低容错/同义词/表达式）
│   │   └── synonyms.ts           # 同义词字典加载
│   ├── components/
│   │   ├── Sidebar.tsx           # 左侧导航（标签/文件柜）
│   │   ├── SearchBar.tsx         # 顶部搜索栏
│   │   ├── TagFilterBar.tsx      # 标签快速筛选条
│   │   ├── ItemGrid.tsx          # 网格视图容器
│   │   ├── ItemListView.tsx      # 列表视图容器
│   │   ├── ItemCard.tsx          # 项目卡片/行 + 右键菜单 + 拖拽标签
│   │   ├── TagEditor.tsx         # 标签/文件柜编辑弹窗
│   │   └── ItemTagsEditor.tsx    # 项目标签批量编辑弹窗
│   └── data/
│       └── synonyms.json         # 同义词默认数据（编译时嵌入 Rust）
│
├── src-tauri/                    # Rust 后端（模块化目录，非单文件）
│   ├── src/
│   │   ├── main.rs               # 程序入口
│   │   ├── lib.rs                # Tauri 初始化、插件注册、命令注册
│   │   ├── commands/             # Tauri 命令（按业务域分模块，约 89 个）
│   │   │   ├── item_commands.rs
│   │   │   ├── cabinet_commands.rs
│   │   │   ├── tag_commands.rs
│   │   │   ├── mod_commands.rs
│   │   │   ├── net_commands.rs
│   │   │   ├── ai_commands.rs           # AI 自动打标（Anthropic 协议）
│   │   │   ├── data_commands.rs         # 数据目录/导入/导出/备份
│   │   │   ├── sync_commands.rs         # WebDAV 云同步（v1.4.0）
│   │   │   ├── update_commands.rs       # 在线更新检查（v1.4.0）
│   │   │   ├── settings_commands.rs
│   │   │   ├── synonym_commands.rs
│   │   │   ├── launch_commands.rs
│   │   │   ├── object_preview_commands.rs
│   │   │   └── search_commands.rs
│   │   ├── db/                   # SQLite 连接、schema、建表与迁移
│   │   ├── services/             # 业务服务层
│   │   ├── extensions/           # Mod 与主题加载
│   │   └── models/               # Rust 数据模型
│   ├── Cargo.toml                # Rust 依赖
│   └── tauri.conf.json           # Tauri 配置（窗口、权限等）
│
├── package.json                  # 前端依赖和脚本
├── vite.config.ts                # Vite 构建配置
├── postcss.config.js             # PostCSS（Tailwind v4 CSS-first，配置在 src/index.css）
└── tsconfig.json                 # TypeScript 编译配置
```

---

## 四、数据模型

### 4.1 ER 关系图

```
items ──< item_tags >── tags ──< tag_relations >── tags（父子自关联，DAG）
  │
  └──< cabinet_items >── cabinets

items_fts (FTS5 虚拟表，自动同步 items 的 name/path)
```

### 4.2 表结构

#### items（项目表）
| 列名 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| name | TEXT NOT NULL | 文件/文件夹名（重定位后自动同步） |
| path | TEXT NOT NULL | 最近已知位置（不再唯一，随重命名/移动自动更新） |
| type | TEXT | 类型：folder/image/audio/exe/bat/ps1 |
| icon_path | TEXT | 自定义图标路径 |
| created_at | DATETIME | 添加时间 |
| last_used_at | DATETIME | 最后启动时间 |
| is_favorite | INTEGER | 是否收藏（0/1） |
| volume_serial | INTEGER | NTFS 卷序列号（对象特征，可空） |
| file_id | TEXT | NTFS 文件ID 十六进制（对象特征，可空）；`(volume_serial, file_id)` 为身份唯一索引 |
| is_missing | INTEGER | 文件是否丢失（0/1，删除/离线/跨盘移动且无法重定位） |
| sig_size | INTEGER | 内容签名：文件字节大小（v006，仅文件，可空） |
| sig_head | INTEGER | 内容签名：首 16KB 的 FNV-1a 哈希（v006，可空） |
| sig_tail | INTEGER | 内容签名：尾 16KB 的 FNV-1a 哈希（v006，可空） |

> 对象身份以 `(volume_serial, file_id)` 为准（NTFS 文件ID，跨重命名/同盘移动稳定）；`path` 为可更新的最近已知位置。取不到文件ID的对象回退按 `path` 去重。**跨盘符移动时文件ID失效，由内容签名 `(sig_size, sig_head, sig_tail)` 在候选盘兜底重定位**。详见 `src-tauri/src/services/file_identity.rs` 与迁移 `v005_object_identity` / `v006_object_signature`。

#### tags（标签表）
| 列名 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| name | TEXT UNIQUE NOT NULL | 标签名（唯一） |
| color | TEXT | 颜色 hex 值，默认 #3b82f6 |

#### item_tags（项目-标签关联表）
| 列名 | 类型 | 说明 |
|------|------|------|
| item_id | INTEGER FK | 关联 items.id，级联删除 |
| tag_id | INTEGER FK | 关联 tags.id，级联删除 |
| position | INTEGER | 标签在对象内的展示顺序 |

#### tag_relations（标签父子关系表，v007 · 图状 DAG）
| 列名 | 类型 | 说明 |
|------|------|------|
| parent_id | INTEGER FK | 父标签，关联 tags.id，级联删除 |
| child_id | INTEGER FK | 子标签，关联 tags.id，级联删除；`(parent_id, child_id)` 为主键 |

> 标签构成有向无环图（DAG，可多父继承）：父标签是子标签的超集。新增关系时服务层做环检测（`add_tag_relation`），筛选时用 `WITH RECURSIVE` 展开后代（`expand_with_descendants`）。

#### cabinets（文件柜表）
| 列名 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| name | TEXT UNIQUE NOT NULL | 文件柜名 |
| color | TEXT | 颜色 hex 值 |
| created_at | DATETIME | 创建时间 |

#### cabinet_items（文件柜-项目关联表）
| 列名 | 类型 | 说明 |
|------|------|------|
| cabinet_id | INTEGER FK | 关联 cabinets.id |
| item_id | INTEGER FK | 关联 items.id |

#### items_fts（FTS5 全文搜索虚拟表）
- 索引字段：name, path
- 通过 3 个触发器（items_ai/items_ad/items_au）自动与 items 表同步

---

## 五、Tauri 命令清单

后端命令已模块化拆分到 `src-tauri/src/commands/` 下的多个文件中，合计 89 个 `#[tauri::command]`，按业务域分布在 `item_commands` / `cabinet_commands` / `tag_commands` / `mod_commands` / `net_commands` / `ai_commands` / `data_commands` / `sync_commands` / `update_commands` / `settings_commands` / `synonym_commands` / `launch_commands` / `object_preview_commands` / `search_commands` 等模块。下表列出对象/标签/文件柜/搜索/同义词等核心命令（Mod、设置、AI、数据管理、缩略图预览等命令未全部展开）：

> v1.4.0 新增命令：云同步 `sync_get_config` / `sync_set_config` / `sync_clear_password` / `sync_test_connection` / `sync_list_backups` / `sync_backup_now` / `sync_restore`（7 个）；在线更新 `update_check`（1 个）。
>
> v1.3.0 新增命令：AI 自动打标 `ai_get_config` / `ai_set_config` / `ai_is_configured` / `ai_test_connection` / `ai_suggest_tags`（5 个）；数据管理 `get_data_directory_info` / `set_data_directory` / `reset_data_directory` / `backup_data` / `export_data` / `import_data` / `restart_app`（7 个）。
>
> v1.2.0 新增命令：`relocate_missing`（跨盘签名找回）、`get_tag_relations` / `add_tag_relation` / `remove_tag_relation`（标签 DAG）、`net_fetch`（Mod 网络原语）。

| 命令名 | 参数 | 返回值 | 说明 |
|--------|------|--------|------|
| `add_item` | path: String | Item | 添加项目，自动检测类型 |
| `remove_item` | id: i64 | () | 删除项目 |
| `get_items` | - | Vec\<ItemWithTags\> | 获取所有项目（含标签） |
| `toggle_favorite` | id: i64 | bool | 切换收藏状态 |
| `get_tags` | - | Vec\<Tag\> | 获取所有标签 |
| `add_tag` | name, color | Tag | 新建标签 |
| `update_tag` | id, name, color | () | 更新标签 |
| `remove_tag` | id: i64 | () | 删除标签 |
| `set_item_tags` | item_id, tag_ids | () | 设置项目的标签列表 |
| `search_items` | query, tag_ids | Vec\<ItemWithTags\> | 后端辅助搜索（FTS5 + LIKE 回退）；前端主搜索使用自研 search.ts，不经过此命令 |
| `launch_item` | id: i64 | () | 启动项目（cmd /C start） |
| `open_in_explorer` | path: String | () | 在资源管理器中打开 |
| `read_synonyms` | - | Vec\<Vec\<String\>\> | 读取同义词字典 |
| `get_cabinets` | - | Vec\<Cabinet\> | 获取所有文件柜 |
| `add_cabinet` | name, color | Cabinet | 新建文件柜 |
| `update_cabinet` | id, name, color | () | 更新文件柜 |
| `remove_cabinet` | id: i64 | () | 删除文件柜 |
| `add_item_to_cabinet` | cabinet_id, item_id | () | 添加项目到文件柜 |
| `remove_item_from_cabinet` | cabinet_id, item_id | () | 从文件柜移除项目 |
| `get_cabinet_items` | cabinet_id: i64 | Vec\<ItemWithTags\> | 获取文件柜内的项目 |

---

## 六、搜索系统

### 6.1 搜索流程

主搜索在前端执行，使用自研 `src/lib/search.ts`（非 Fuse.js）：

```
用户输入 → 150ms 防抖 → useSearch → appStore.searchQuery 更新
                                          ↓
                                    useItems.filtered (useMemo)
                                          ↓
                          filterItemsByTags → buildSearchIndex → searchWithIndex
                                          ↓
                              ┌─── 1. filterItemsByTags：按 selectedTagIds 筛选（AND 逻辑）
                              ├─── 2. buildSearchIndex：pinyin-pro 生成拼音全拼/首字母字段
                              ├─── 3. parseQuery：解析表达式（&& || 空格OR () @ !!）
                              ├─── 4. 对每个非严格子项 expandQuery() 做同义词扩展
                              ├─── 5. 逐项匹配：前缀匹配 / 拼音 / 英文低容错 / 严格匹配
                              └─── 6. 收藏项置顶
```

### 6.2 搜索引擎能力（自研 search.ts）

不依赖第三方模糊搜索库，匹配策略：

- 前缀匹配：从词首开始的包含匹配（`prefixMatches`），大小写不敏感。
- 中文拼音：拼音全拼与拼音首字母匹配（pinyin-pro 生成）。
- 英文低容错：基于编辑距离的弱容错（`isEnglishTypoMatch`），仅对 3 字符以上英文生效。
- 同义词整词扩展：每个非严格子项命中同义词组时一并搜索同组词。
- 表达式语法：`&&`（与）、`||`（或）、空格（OR 别名）、`()`（结合顺序）、`@`（严格匹配，关闭拼音/模糊/同义词）、`!!`（排除）。

### 6.3 搜索模式

| 模式 | 匹配范围 |
|------|----------|
| all | 名称 + 路径（弱）+ 标签（任一命中） |
| name | 名称 + 路径（弱） |
| tag | 对象的每个标签（任一命中） |

### 6.4 同义词系统

- 同义词字典优先读取 exe 同级目录的 `synonyms.json`。
- 若该位置不可写/不可用，回退到应用数据目录（Windows 为 `%APPDATA%/com.taglauncher.app/synonyms.json`）。
- 首次运行时自动从内置默认数据生成。
- 用户可直接编辑该文件，重启应用生效。
- 格式：`[["游戏","game","娱乐"], ["工具","tool","utility"], ...]`

---

## 七、拖拽交互系统

应用中有以下拖拽交互：

| 拖拽源 | 放置目标 | 实现方式 | 效果 |
|--------|----------|----------|------|
| 侧边栏标签 | 项目卡片/行 | `internalDragStore` + `beginInternalPointerDrag()` | 给项目添加标签 |
| 项目卡片/行的拖拽手柄 | 侧边栏收藏夹 | `internalDragStore` + `beginInternalPointerDrag()` | 将项目加入收藏 |
| 项目卡片/行的拖拽手柄 | 侧边栏文件柜 | `internalDragStore` + `beginInternalPointerDrag()` | 添加项目到文件柜 |
| 项目卡片/行的拖拽手柄 | 主视图底部左侧操作区 | `internalDragStore` + `beginInternalPointerDrag()` | 移除当前 active 标签，或移出当前文件柜 |
| 项目卡片/行的拖拽手柄 | 主视图底部右侧操作区 | `internalDragStore` + `beginInternalPointerDrag()` | 从应用管理中移除项目，不删除本地文件 |
| 项目内标签 | 同项目其他标签位置 | `internalDragStore` + `beginInternalPointerDrag()` | 标签排序 |
| 项目内标签 | "拖拽到此移除"区域 | `internalDragStore` + `beginInternalPointerDrag()` | 移除标签 |
| 外部文件 | 应用窗口 | DOM `DragEvent` + Tauri `onDragDropEvent()` | 添加新项目 |

说明：

- 内部拖拽不再依赖 HTML5 `dataTransfer`，避免在 WebView2 / Tauri 下与外部文件拖拽互相干扰。
- `src/stores/internalDragStore.ts` 负责保存当前拖拽态与 hover 目标。
- `src/lib/internalPointerDrag.ts` 负责统一处理拖拽阈值、全局指针监听、落点判定与清理逻辑。
- 主视图底部右侧移除项会弹出确认框，文案为“这会使得对象在应用内被移除（不删除本地文件），是否确认？”，按钮为 `yes/no`。
- 确认框中的“下次不再确认”使用 `localStorage` 键 `taglauncher.skip_remove_item_confirm`。

---

## 八、状态管理

使用 Zustand 管理全局状态，核心设计：

```typescript
// 三种筛选模式互斥
toggleTagSelection(id)    → 清空 selectedCabinetId 和 showFavorites
setSelectedCabinetId(id)  → 清空 selectedTagIds 和 showFavorites
setShowFavorites(v)       → 清空 selectedCabinetId 和 selectedTagIds
```

侧栏分类标题处提供清空当前筛选入口：

- 标签页：清空当前 active 标签。
- 文件柜页：取消当前 active 文件柜。

数据流向：
1. Hooks 从 Rust 后端加载数据 → 写入 Store
2. 组件从 Store 读取数据
3. 用户操作 → Hooks 调用 db.ts → invoke Rust 命令 → 刷新数据

---

## 九、AI 自动打标（Anthropic 协议）

后端模块 `commands/ai_commands.rs` 提供无状态的「为一个对象建议标签」原语，批量遍历、并发、进度与取消由前端编排（KISS：进度/取消在 UI 侧最自然）。HTTP 采用 `ureq`（阻塞，与 `net_fetch` 一致，不引入 async 运行时）。

### 9.1 配置

- 配置项存于 `app_meta` KV 表，键名前缀 `ai.`：`ai.base_url` / `ai.api_key` / `ai.model` / `ai.auto_tag_on_add` / `ai.max_tags` / `ai.allow_new_tags` / `ai.extra_prompt`。
- 模型由用户填写（Anthropic 兼容模型名，必填、无内置默认）；每对象最多标签数默认 5（限制 1–20）。
- 前端入口：设置页 `AiSettingsSection`，填写 base URL / API key / 模型并可「测试连接」。

### 9.2 命令

| 命令名 | 参数 | 返回值 | 说明 |
|--------|------|--------|------|
| `ai_get_config` | - | AiConfig | 读取 AI 配置（**不含明文密钥**，仅回传 `hasApiKey` 是否已配置；明文密钥只在后端内部使用） |
| `ai_set_config` | config: AiConfig | () | 写入 AI 配置 |
| `ai_is_configured` | - | bool | 是否已配置（不泄露 key，供前端判断是否自动打标） |
| `ai_test_connection` | - | String | 发一条极简消息测试连通性，返回模型回显 |
| `ai_suggest_tags` | name, path, item_type, existing_tags | Vec\<String\> | 为单个对象建议标签（去重并按配置裁剪数量） |

### 9.3 协议兼容与解析

- **端点归一化**：`ai.base_url` 结尾自动补全为 `/v1/messages`（`.../v1/messages` 原样；`.../v1` 补 `/messages`；其它补 `/v1/messages`）。鉴权头仅发送 `x-api-key` + `anthropic-version`（**不再额外发送 `Authorization: Bearer`**，避免密钥暴露给会记录该头的第三方网关）；`ai.base_url` 强制 https（本机 `http://localhost` 除外），防止密钥明文过网。
- **响应解析**：优先取 Anthropic `content[].text`，兜底 OpenAI 风格 `choices[].message.content`。
- **标签解析**：优先解析首个 JSON 数组；失败时按逗号/换行/顿号回退切分；统一去重、去空、超长（>40 字符）丢弃并裁剪到上限。

### 9.4 前端编排

- Hook `hooks/useAiTagging.ts`：并发池（`CONCURRENCY = 3`）加速慢速 API；标签「创建 + 应用」串行化，避免并发下重复建标；提供进度与取消。
- 「新对象自动打标」：导入新对象后，`useItems` 派发 `taglauncher-items-added` 事件，`App` 监听后以 silent 后台模式调用 AI 打标。
- 组件 `components/AiTaggingModal.tsx`：批量打标进度弹窗。

---

## 十、数据管理与数据目录

后端模块 `commands/data_commands.rs`。设计要点：导出/备份/迁移统一走 **SQLite Online Backup API**（`rusqlite` 的 `backup` feature，页级一致快照，不受 WAL 未 checkpoint、文件句柄占用影响）；数据目录「指针」不能存于数据库自身，因此放在 exe 旁的 `datapath.json`。

### 10.1 数据目录重定向

- 默认数据目录为 exe 同级 `Save/`。用户可切换到自定义目录，重定向路径记录在 exe 旁 `datapath.json`（`path_service` 的 `read_data_dir_redirect` / `write_data_dir_redirect` / `default_save_dir`）。
- **仅重定向 `Save/`**（应用原生数据：数据库、备份等）；`Builtin/`、`Plugins_Theme/`、`Plugins_Mods/` 仍固定 exe 同级。
- 切换目录或导入数据后需**重启应用**生效（命令内部调用 `app.restart()`）。

### 10.2 命令

| 命令名 | 参数 | 返回值 | 说明 |
|--------|------|--------|------|
| `get_data_directory_info` | - | DataDirectoryInfo | 当前目录 / 默认目录 / 是否自定义 / DB 大小 / 备份目录 |
| `set_data_directory` | new_dir, migrate | () | 切换数据目录（migrate=true 时快照当前库到新目录；目标已有库则拒绝覆盖）|
| `reset_data_directory` | - | () | 恢复默认目录（清除重定向）|
| `backup_data` | - | String | 一键备份当前库到 `Save/Backups/`，返回备份路径（本机灾备，**保留** AI 密钥以支持完整恢复）|
| `export_data` | target_path | () | 导出当前库到用户指定 `.db`（对外分享出口，**自动剔除 `ai.*` 密钥并 VACUUM 重写**）|
| `import_data` | source_path | String | 校验来源库 → 自动安全备份当前库 → 灌入当前库，返回安全备份路径 |
| `restart_app` | - | () | 重启应用（切目录/导入后调用）|

- 前端入口：设置页 `DataSettingsSection`，展示当前目录 / DB 大小 / 是否自定义，并提供 切换 / 恢复默认 / 一键备份 / 导出 / 导入 / 打开备份目录。切换目录时若目标已存在数据库，后端拒绝迁移覆盖，前端转为内联确认，提供「直接使用该目录数据」（`migrate=false`，不复制当前数据）与「取消」两个选择。

---

## 十一、云同步与在线更新（v1.4.0）

### 11.1 云同步（WebDAV）

后端模块 `commands/sync_commands.rs`。协议选 WebDAV：NAS（群晖/威联通）、Nextcloud、坚果云等主流个人云原生支持、无厂商锁定，契合「全部本地化 + 可自建」定位。HTTP 用 `ureq`（与 `net_fetch`/AI 一致），PROPFIND multistatus 解析为手写实现（命名空间前缀/大小写不敏感，免第三方 XML 依赖）。

| 命令名 | 参数 | 返回值 | 说明 |
|--------|------|--------|------|
| `sync_get_config` | - | SyncConfig | 读取配置（**不含明文密码**，仅回传 `hasPassword`；含 `lastSyncTs`） |
| `sync_set_config` | config | () | 写入配置（事务化；密码留空=不修改） |
| `sync_clear_password` | - | () | 显式清除已存密码 |
| `sync_test_connection` | - | String | PROPFIND 根验证凭据 → 逐级 MKCOL 确保远端目录 |
| `sync_list_backups` | - | Vec\<RemoteBackup\> | PROPFIND Depth:1 列出远端 `taglauncher_*.db`（新到旧） |
| `sync_backup_now` | - | String | 快照 → 剔除敏感配置 → PUT 上传 → 清理旧份（保留 10）→ 记录时间 |
| `sync_restore` | file_name | String | GET 下载 → 校验 schema → 本地安全备份 → 覆盖（失败自动回滚）→ 回填本机凭据 |

设计要点：

- **云端副本剔除敏感配置**：`strip_cloud_secrets` 删除 `ai.*` 与 `sync.*` 后 VACUUM 重写（明文不残留空闲页）——第三方 WebDAV 服务不应拿到密钥。
- **恢复保留本机凭据**：覆盖前 `read_local_secrets` 快照本机 `ai.*`/`sync.*`，覆盖后 `reapply_local_secrets` 回填（本机值优先于副本内嵌值）——恢复操作不得让云同步配置自身失效。
- **允许 `http://`**（局域网 NAS 常无 TLS；凭据只发往用户自己填的服务器，UI 明示风险）；不启用 Mod `net_fetch` 的 SSRF 拦截——那是针对不可信 Mod 的防线，云同步目标本就常在内网。
- 配置存 `app_meta`（键前缀 `sync.`）：`webdav_url` / `username` / `password` / `remote_dir` / `auto` / `last_ts`。
- 前端：设置页 `SyncSettingsSection`（配置/测试/立即备份/云端列表内联恢复确认）；`useStartupMaintenance` 启动 15s 后检查自动备份（`sync.auto=1` 且距上次 >24h）。

### 11.2 在线更新（GitHub Releases）

后端模块 `commands/update_commands.rs`：

- `update_check`：GET `https://api.github.com/repos/KatouRyuuji/TagLauncher/releases/latest`（需 User-Agent 头；10s 超时、2MB 上限）→ `parse_release_response` 解析 tag（兼容 `v` 前缀）→ `semver_gte` 比较 → `pick_installer_asset` 按编译期架构（x86_64→`_x64-setup.exe`、aarch64→`_arm64-setup.exe`）匹配资产，未命中回退 Release 页链接。
- 只做「检查 + 引导下载」，不做静默自更新：规避更新签名密钥管理与后台替换二进制的攻击面（轻量定位）。
- 前端：设置页 `UpdateSettingsSection`（当前版本/检查/发布说明/下载）；`useStartupMaintenance` 启动 8s 后自动检查（localStorage 节流 24h，同版本只 toast 一次）。
- 仓库迁移时须同步改 `GITHUB_REPO` 常量（见 MAINTENANCE.md §3）。

---

## 十二、构建与部署

### 环境准备（v1.3.0 新增）

- `setup.bat`：一键检测并安装 Node / Rust(rustup) / VS C++ BuildTools / WebView2，并执行 `npm install`（全英文 + UTF-8 + CRLF）。
- `dev.bat` / `build.bat`：自动注入 `%USERPROFILE%\.cargo\bin` 到 PATH 并做环境前置检查；`build.bat` 支持可选 target 参数。
- `build-arm64.bat`：面向 `aarch64-pc-windows-msvc` 的 ARM64 构建，会自动 `rustup target add`（对应 GitHub issue #1）。

### 开发模式
```bash
npm run dev          # 启动 Vite dev server (端口 3456)
npm run tauri dev    # 启动 Tauri 开发窗口
```

### 生产构建
```bash
npm run tauri build  # 编译 + 打包 NSIS 安装包（x64）
```

产物位置：`src-tauri/target/release/bundle/nsis/TagLauncher_1.4.0_x64-setup.exe`

ARM64 构建：`build-arm64.bat`（`aarch64-pc-windows-msvc`），产物为 `..._arm64-setup.exe`。

### CI 与发版（v1.4.0 新增）

- `.github/workflows/ci.yml`：push/PR 自动跑 `npm run test:all` + 前端生产构建校验（windows-latest，与本地同一套测试脚本）。
- `.github/workflows/release.yml`：推送版本 tag 自动构建 x64 + ARM64 双架构安装包并生成草稿 Release；发版流程清单见 `MAINTENANCE.md`。

### 部署
- 安装包部署：运行 NSIS `-setup.exe` 完成安装（安装语言可选 English / SimpChinese）。
- 运行时依赖：Windows 10 1803+ 或 Windows 11（需要 WebView2）；支持 x64 与 ARM64。
- 数据存储：默认 exe 同级目录的 `Save/taglauncher.db`（不是 `%APPDATA%`）；数据目录可在设置中自定义，重定向记录于 exe 旁 `datapath.json`（仅重定向 `Save/`）。
- 同义词字典：优先 exe 同级目录的 `synonyms.json`，不可用时回退到应用数据目录（`%APPDATA%/com.taglauncher.app/synonyms.json`），首次运行自动生成。
- 开始菜单快捷方式默认创建，桌面快捷方式可在安装功能选择页中选择。

---

## 十三、关键依赖

### 前端
| 包名 | 版本 | 用途 |
|------|------|------|
| react | 19.x | UI 框架 |
| zustand | 5.x | 状态管理 |
| pinyin-pro | 3.x | 中文拼音转换（搜索引擎为自研 search.ts，未使用 fuse.js） |
| tailwindcss | 4.x | CSS 工具类 |
| @tauri-apps/api | 2.x | Tauri 前端 API |
| @tauri-apps/plugin-dialog | 2.x | 系统文件/目录选择器 |
| @tauri-apps/plugin-shell | 2.x | 启动对象、打开所在文件夹 |

### 后端
| crate | 版本 | 用途 |
|-------|------|------|
| tauri | 2.x | 应用框架 |
| rusqlite | 0.31 | SQLite 驱动（`bundled` + `backup` feature：Online Backup 用于导入/导出/备份） |
| ureq | 2.x | 阻塞式 HTTP（Mod `net_fetch`、AI 打标、WebDAV 云同步、更新检查） |
| serde / serde_json | 1.x | 序列化/反序列化 |

---

## 十四、安全模型与性能要点（v1.3.0 硬化，v1.4.0 增补）

### 安全

- **对象启动经 `ShellExecuteW`（"open" 动词），不经 `cmd.exe`**：从根上杜绝路径中 `&` / `^` / `(` 等 shell 元字符导致的命令注入（旧实现 `cmd /C start "" <path>` 对无空格路径不加引号，会把这些字符当命令分隔符）。见 `services/launch_service.rs`。
- **AI 密钥最小暴露面**：明文密钥只存后端 `app_meta`，`ai_get_config` 不下发明文（仅回传 `hasApiKey`）；鉴权仅发 `x-api-key`（不发 `Authorization: Bearer`）；`ai.base_url` 强制 https（本机 `localhost` 除外）；**导出 `export_data` 自动剔除 `ai.*` 密钥并 VACUUM 重写**，本机备份 / 迁移则保留密钥以支持完整恢复。
- **Mod `net.fetch` SSRF 防御**：自定义 DNS 解析器（`SsrfGuardResolver`）在解析层拦截环回 / 私网 / 链路本地 / 保留地址，fail-closed，重定向每一跳重新校验；仅 http/https、默认 30s（上限 120s）超时、10MB 体积上限。见 `commands/net_commands.rs`。
- **WebView CSP**：`tauri.conf.json` 配置 `csp` / `devCsp`（`default-src 'self'`、`connect-src` 限本机 IPC/asset、`object-src 'none'`、`frame-src 'none'` 等），收敛脚本 / 网络 / 框架来源，作为纵深防御。
- **Mod / 主题为「可信扩展」**：其 `permissions` 是能力声明（运行时由 JS 宿主据此约束可调用的 API 面），**并非操作系统级安全沙箱边界**——Mod 与应用同处一个 WebView，请仅安装可信来源的扩展。
- **云同步凭据最小暴露面（v1.4.0）**：WebDAV 密码只存后端 `app_meta`，`sync_get_config` 不下发明文（仅 `hasPassword`）；云端副本剔除 `ai.*`/`sync.*` 并 VACUUM；恢复回填本机凭据。Mod 文件读写有 32MiB 上限，目录复制跳过符号链接，`import_mod` 校验 id 合法性防目录逃逸（v1.3.x 硬化随审阅并入）。

### 性能

- **列表加载 / 刷新（`get_items`）改用 `#[tauri::command(async)]` 工作线程执行**，不占用主 IPC 线程；并以「锁内取快照 → 锁外做 exists()/FFI/签名/图标抽取等重 IO → 锁内批量回写」三段式，把重 IO 移出 DB 全局锁，首屏与刷新不再冻结界面（图标抽取走 PowerShell / 文件 IO，是卡顿大头）。
- **批量拖拽导入（`add_item` / `add_items`）改用 async 工作线程**：文件ID FFI、内容签名读取、类型识别等重 IO 从 UI 主线程移到工作线程，导入期间界面不冻结。**注意**——其重 IO 仍在 DB 事务锁内串行执行（既有逻辑未改），async 化仅解决「不冻结主线程」，并不等于「移出 DB 锁」或「并发无阻塞」。
- 其余重 IO 命令同样以 async 工作线程执行：跨盘找回 `relocate_missing`、数据 `backup_data` / `export_data` / `import_data` / `set_data_directory`、AI `ai_test_connection` / `ai_suggest_tags`、Mod `net_fetch`。


