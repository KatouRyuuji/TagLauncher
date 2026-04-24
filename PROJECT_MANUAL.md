# TagLauncher 项目手册

## 一、项目简介

TagLauncher 是一个基于 Tauri 2.x 的 Windows 桌面应用，用于通过「标签」管理和快速启动本地文件夹及可执行文件（exe/bat/ps1）。

核心理念：用标签代替传统的树形目录分类，支持一个项目挂多个标签，通过组合筛选快速定位。

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
│  │  search.ts (Fuse.js + pinyin-pro)       │  │
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
│  │  commands.rs  ← 14 个 Tauri 命令        │  │
│  │  db.rs        ← SQLite 初始化/连接管理  │  │
│  │  lib.rs       ← 应用启动/插件注册       │  │
│  │  main.rs      ← 入口                   │  │
│  │                                         │  │
│  │  ┌───────────────────────────────────┐  │  │
│  │  │  SQLite (taglauncher.db)          │  │  │
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
│   │   ├── search.ts             # Fuse.js 模糊搜索引擎
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
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── main.rs               # 程序入口
│   │   ├── lib.rs                # Tauri 初始化、插件注册、命令注册
│   │   ├── db.rs                 # Database 结构体、建表、迁移
│   │   └── commands.rs           # 所有 Tauri 命令实现
│   ├── Cargo.toml                # Rust 依赖
│   └── tauri.conf.json           # Tauri 配置（窗口、权限等）
│
├── package.json                  # 前端依赖和脚本
├── vite.config.ts                # Vite 构建配置
├── tailwind.config.js            # Tailwind CSS 配置
└── tsconfig.json                 # TypeScript 编译配置
```

---

## 四、数据模型

### 4.1 ER 关系图

```
items ──< item_tags >── tags
  │
  └──< cabinet_items >── cabinets

items_fts (FTS5 虚拟表，自动同步 items 的 name/path)
```

### 4.2 表结构

#### items（项目表）
| 列名 | 类型 | 说明 |
|------|------|------|
| id | INTEGER PK | 自增主键 |
| name | TEXT NOT NULL | 文件/文件夹名 |
| path | TEXT UNIQUE NOT NULL | 完整路径（唯一） |
| type | TEXT | 类型：folder/exe/bat/ps1 |
| icon_path | TEXT | 自定义图标路径（预留） |
| created_at | DATETIME | 添加时间 |
| last_used_at | DATETIME | 最后启动时间 |
| is_favorite | INTEGER | 是否收藏（0/1） |

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

所有前后端通信通过 `invoke()` 调用以下 Rust 命令：

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
| `search_items` | query, tag_ids | Vec\<ItemWithTags\> | 后端搜索（FTS5 + LIKE 回退，前端主搜索仍使用 Fuse） |
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

```
用户输入 → 150ms 防抖 → useSearch → appStore.searchQuery 更新
                                          ↓
                                    useItems.filtered (useMemo)
                                          ↓
                                    fuzzySearch()
                                          ↓
                              ┌─── 1. 按 selectedTagIds 筛选（AND 逻辑）
                              ├─── 2. pinyin-pro 生成拼音字段
                              ├─── 3. expandQuery() 同义词扩展
                              ├─── 4. Fuse.js 对每个扩展词搜索
                              ├─── 5. 按最佳 score 去重
                              └─── 6. 收藏项置顶
```

### 6.2 搜索模式

| 模式 | 搜索字段 | 权重 |
|------|----------|------|
| all | name(3), pinyinName(2), pinyinInitials(1.5), path(0.5), tagNames(3), tagPinyin(2), tagInitials(1.5) | 全部 |
| name | name(3), pinyinName(2), pinyinInitials(1.5), path(0.5) | 仅名称/路径 |
| tag | tagNames(3), tagPinyin(2), tagInitials(1.5) | 仅标签 |

### 6.3 同义词系统

- 同义词字典存储在 exe 同级目录的 `synonyms.json`
- 首次运行时自动从内置默认数据生成
- 用户可直接编辑该文件，重启应用生效
- 格式：`[["游戏","game","娱乐"], ["工具","tool","utility"], ...]`

---

## 七、拖拽交互系统

应用中有 4 种拖拽交互：

| 拖拽源 | 放置目标 | 实现方式 | 效果 |
|--------|----------|----------|------|
| 侧边栏标签 | 项目卡片/行 | `internalDragStore` + `beginInternalPointerDrag()` | 给项目添加标签 |
| 项目卡片/行的拖拽手柄 | 侧边栏文件柜 | `internalDragStore` + `beginInternalPointerDrag()` | 添加项目到文件柜 |
| 项目内标签 | 同项目其他标签位置 | `internalDragStore` + `beginInternalPointerDrag()` | 标签排序 |
| 项目内标签 | "拖拽到此移除"区域 | `internalDragStore` + `beginInternalPointerDrag()` | 移除标签 |
| 外部文件 | 应用窗口 | DOM `DragEvent` + Tauri `onDragDropEvent()` | 添加新项目 |

说明：

- 内部拖拽不再依赖 HTML5 `dataTransfer`，避免在 WebView2 / Tauri 下与外部文件拖拽互相干扰。
- `src/stores/internalDragStore.ts` 负责保存当前拖拽态与 hover 目标。
- `src/lib/internalPointerDrag.ts` 负责统一处理拖拽阈值、全局指针监听、落点判定与清理逻辑。

---

## 八、状态管理

使用 Zustand 管理全局状态，核心设计：

```typescript
// 三种筛选模式互斥
toggleTagSelection(id)    → 清空 selectedCabinetId 和 showFavorites
setSelectedCabinetId(id)  → 清空 selectedTagIds 和 showFavorites
setShowFavorites(v)       → 清空 selectedCabinetId 和 selectedTagIds
```

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
npm run tauri build  # 编译 + 打包
```

产物位置：`src-tauri/target/release/tag-launcher.exe`

### 部署
- 单文件部署：复制 `tag-launcher.exe` 到任意目录即可运行
- 运行时依赖：Windows 10 1803+ 或 Windows 11（需要 WebView2）
- 数据存储：`%APPDATA%/com.taglauncher.app/taglauncher.db`
- 同义词字典：exe 同级目录的 `synonyms.json`（首次运行自动生成）

---

## 十、关键依赖

### 前端
| 包名 | 版本 | 用途 |
|------|------|------|
| react | 19.x | UI 框架 |
| zustand | 5.x | 状态管理 |
| fuse.js | 7.x | 客户端模糊搜索 |
| pinyin-pro | 3.x | 中文拼音转换 |
| tailwindcss | 4.x | CSS 工具类 |
| @tauri-apps/api | 2.x | Tauri 前端 API |

### 后端
| crate | 版本 | 用途 |
|-------|------|------|
| tauri | 2.x | 应用框架 |
| rusqlite | 0.31 | SQLite 驱动（bundled 模式） |
| serde / serde_json | 1.x | 序列化/反序列化 |
