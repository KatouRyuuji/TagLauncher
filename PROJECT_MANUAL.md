# TagLauncher 项目手册

## 一、项目简介

TagLauncher 是一个基于 Tauri 2.x 的 Windows 桌面应用，用于通过「标签」管理和快速启动本地文件夹及可执行文件（exe/bat/ps1）。

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
- Mod 扩展系统：支持 `css` / `css+js` / `theme` 三类 Mod，提供权限模型、生命周期回调、工具栏按钮、侧栏/浮动面板、卡片与列表行对等插槽、Mod 数据存储、文件读写、受约束的网络请求原语（`net.fetch` 经 Rust 后端代理）、只读标签关系等接口（API 版本 3.2.0）。

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
│  │  commands/  ← 约 69 个 Tauri 命令       │  │
│  │             (按 item/cabinet/tag/mod/   │  │
│  │              settings/synonym/launch/   │  │
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
│   │   ├── commands/             # Tauri 命令（按业务域分模块，约 69 个）
│   │   │   ├── item_commands.rs
│   │   │   ├── cabinet_commands.rs
│   │   │   ├── tag_commands.rs
│   │   │   ├── mod_commands.rs
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

后端命令已模块化拆分到 `src-tauri/src/commands/` 下的多个文件中，合计 69 个 `#[tauri::command]`，按业务域分布在 `item_commands` / `cabinet_commands` / `tag_commands` / `mod_commands` / `net_commands` / `settings_commands` / `synonym_commands` / `launch_commands` / `object_preview_commands` / `search_commands` 等模块。下表列出对象/标签/文件柜/搜索/同义词等核心命令（Mod、设置、缩略图预览等命令未全部展开）：

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

## 九、构建与部署

### 开发模式
```bash
npm run dev          # 启动 Vite dev server (端口 3456)
npm run tauri dev    # 启动 Tauri 开发窗口
```

### 生产构建
```bash
npm run tauri build  # 编译 + 打包 NSIS 安装包
```

产物位置：`src-tauri/target/release/bundle/nsis/TagLauncher_1.2.0_x64-setup.exe`

### 部署
- 安装包部署：运行 NSIS `-setup.exe` 完成安装（安装语言可选 English / SimpChinese）。
- 运行时依赖：Windows 10 1803+ 或 Windows 11（需要 WebView2）
- 数据存储：exe 同级目录的 `Save/taglauncher.db`（不是 `%APPDATA%`）
- 同义词字典：优先 exe 同级目录的 `synonyms.json`，不可用时回退到应用数据目录（`%APPDATA%/com.taglauncher.app/synonyms.json`），首次运行自动生成。
- 开始菜单快捷方式默认创建，桌面快捷方式可在安装功能选择页中选择。

---

## 十、关键依赖

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
| rusqlite | 0.31 | SQLite 驱动（bundled 模式） |
| serde / serde_json | 1.x | 序列化/反序列化 |
