# TagLauncher Mod 开发指南

> 适用版本：v1.7.1-beta · Mod API v3.2.0
> 相关文档：[PROJECT_MANUAL.md](./PROJECT_MANUAL.md)（架构总览）· [THEME_GUIDE.md](./THEME_GUIDE.md)（主题开发）
> 可运行示例：仓库根目录 `ExampleMod/preview/`

## 1. 可信模型（先读这个）

Mod 是**可信扩展**：Mod 的 JS 以内联 `<script>` 在应用主 realm 内执行，拥有与宿主完全相同的能力（window / DOM / fetch / Tauri 后端命令全量）。`permissions` 权限声明**不是安全沙箱**，它的作用是：

1. 面向用户的能力标注——启用 Mod 前在界面上展示它声明要使用的能力；
2. 对「守规矩」Mod 的误用防呆——经 `createScope` 的调用按声明校验，未注册的 Mod / 冒用他人 id 的 scope 请求会被拒绝。

任何 Mod 都能绕过这一层直接调后端命令，所以：**只安装来源可信的 Mod**；作为 Mod 作者，请如实声明 permissions。

## 2. 目录结构与安装

```text
<安装目录>/Plugins_Mods/
└── my-mod/                 # 目录名建议与 manifest.id 一致
    ├── manifest.json       # 必需
    ├── main.js             # css+js 类型：JS 入口
    ├── style.css           # css / css+js 类型：CSS 入口
    └── theme.json          # theme 类型：主题包入口
```

安装方式：把目录放进 `Plugins_Mods/`，或在「设置 → 扩展」里导入。启用/禁用/卸载即时生效，无需重启（JS Mod 依赖你正确注册清理回调，见 §7）。

## 3. manifest.json 字段

| 字段 | 类型 | 必需 | 说明 |
|---|---|---|---|
| `id` | string | ✓ | 全局唯一标识；建议与目录名一致 |
| `name` | string | ✓ | 显示名 |
| `version` | string | ✓ | 语义版本，用于 update 生命周期判定 |
| `author` | string | ✓ | 作者 |
| `description` | string | ✓ | 一句话描述 |
| `type` | string | ✓ | `"css"` / `"css+js"` / `"theme"` |
| `entrypoints` | object | ✓ | 入口文件：`{ "css": "...", "js": "...", "theme": "..." }`，按 type 取用 |
| `permissions` | string[] | | 见 §4。不声明 = 不受限（向后兼容）；`[]` = 显式声明无任何权限 |
| `api_version` | string | | 目标 API 版本（当前 `3.2.0`）。主版本不符或次版本更新时仅弹告警，不阻断加载 |
| `min_app_version` / `max_app_version` | string | | 兼容的 App 版本区间：低于 min 或高于 max 时标记不兼容（边界值本身兼容） |
| `events` | object | | Mod 间通信约定：`{ "exports": [...], "imports": [...] }` |
| `dependencies` | object | | 依赖：`{ "modId": "^1.0.0" }`，支持 `^` / `>=` / 精确匹配。未满足的 Mod 跳过加载并告警 |
| `load_after` | string[] | | 无版本约束的加载顺序声明 |
| `contributes` | object | | 宿主 UI 贡献点声明（routes / menuItems / commands / statusItems / settingsPages / shortcuts / backgroundTasks / notifications） |

启动时所有已启用 Mod 按 `dependencies` + `load_after` 拓扑排序后串行加载；检测到循环依赖时按原始顺序追加并弹告警。

## 4. permissions 权限表

| 权限 | 放行的 API |
|---|---|
| `items:read` | `getItems` `onItemsChanged` `onSearchInput` `onItemLaunched` `getSelectedItemIds` `onSelectionChanged` |
| `items:write` | `addItem` `removeItem(s)` `setItemTags` `setManyItemTags` `toggleFavorite` |
| `tags:read` | `getTags` `getTagRelations` `onTagsChanged` |
| `tags:write` | `addTag` `updateTag` `removeTag` |
| `cabinets:read` | `getCabinets` `onCabinetsChanged` `onCabinetItemsChanged` |
| `cabinets:write` | `addCabinet` `updateCabinet` `removeCabinet` `add/removeItem(s)ToCabinet` `add/removeItemFromCabinet` |
| `launch` | `launchItem` `launchItems` |
| `storage` | `storage.*`（localStorage 隔离空间） |
| `data` | `data.*`（数据库存储） |
| `dom` | `createPanel` `createToolbarButton` `removeToolbarButton` `registerItemSlot` `unregisterItemSlot` |
| `theme` | `setThemeVariable` |
| `fs:read` | `fs.readText` `fs.readBytes` `fs.list` |
| `fs:write` | `fs.writeText` `fs.writeBytes` `fs.remove` |
| `net` | `net.fetch` |
| `objects:preview` | `preview.*` |
| `events:emit` / `events:receive` | `events.emit` / `events.on` |

`notify`、`ui`、`onLifecycle`、`getThemeVariable`、`getThemeId`、`onThemeChange` 不需要权限。

## 5. JS API（createScope）

Mod JS 的第一行固定为：

```js
const api = window.__tagLauncherModApi.createScope(__MOD_ID__);
```

`__MOD_ID__` 由运行时注入。同步执行段内 `createScope` 校验调用者身份；未注册的 id 一律拒绝。

### 5.1 数据读取

```js
const items = await api.getItems();        // ItemWithTags[]（含 tags、is_favorite、is_missing、icon_path 等）
const tags = await api.getTags();          // Tag[]
const relations = await api.getTagRelations(); // TagRelation[]（标签 DAG）
const cabinets = await api.getCabinets();  // Cabinet[]
const selected = api.getSelectedItemIds(); // 主视图当前复选集合
```

### 5.2 数据写入（成功后宿主界面自动刷新）

```js
await api.addItem("D:\\Tools\\app.exe");
await api.removeItem(id);            // removeItems(ids) 批量
await api.addTag("游戏", "#e5484d"); // updateTag / removeTag
await api.setItemTags(itemId, [tagId1, tagId2]); // setManyItemTags([{itemId, tagIds}])
await api.launchItem(id);            // launchItems(ids) 批量，单项失败不中断、统一报错
await api.toggleFavorite(id);        // 返回切换后的收藏状态
await api.addCabinet("工作", "#3d63dd"); // updateCabinet / removeCabinet
await api.addItemToCabinet(cabinetId, itemId);   // addItemsToCabinet / removeItem(s)FromCabinet
```

### 5.3 事件订阅（返回解绑函数；禁用时自动清理）

```js
api.onItemsChanged((items) => {});         // 数据变更广播
api.onTagsChanged((tags) => {});
api.onCabinetsChanged((cabinets) => {});
api.onCabinetItemsChanged((cabinetId, itemIds) => {});
api.onSelectionChanged((itemIds) => {});
api.onSearchInput((query) => {});
api.onItemLaunched((itemId, itemName) => {});
api.onThemeChange((themeId) => {});
```

### 5.4 存储

```js
api.storage.set("key", "value");           // localStorage，按 mod 隔离
const cfg = await api.data.get("config");  // 数据库 KV，JSON 自动序列化/反序列化
await api.data.set("config", { a: 1 });
await api.data.put("collection", "id-1", { x: 2 }); // 记录集合：list / put / delete
```

### 5.5 主题

```js
const accent = api.getThemeVariable("accent-primary"); // 读任意 CSS 变量（不带 -- 前缀）
api.setThemeVariable("accent-primary", "#e5484d");     // 需要 theme 权限
const themeId = api.getThemeId();
```

### 5.6 文件系统与网络

```js
const text = await api.fs.readText("data/config.json"); // 仅限 Mod 自身目录内
await api.fs.writeText("data/out.txt", "...");
const entries = await api.fs.list("data");              // [{ name, isFile, isDir }]

const resp = await api.net.fetch("https://api.example.com/x", { method: "POST", body: "..." });
// 由 Rust 后端代理（绕开 WebView CORS）；返回标准 Response；body 仅支持 string / URLSearchParams
```

### 5.7 对象预览

```js
const info = await api.preview.getFileInfo(item.path);     // 大小等文件信息
const entries = await api.preview.listDirectory(item.path); // 文件夹内容
const audio = await api.preview.getAudio(item.path);        // 音频元数据/封面 data URL
const url = api.preview.toAssetUrl(item.path);              // 转 WebView 可访问的 asset URL（展示图片用）
```

### 5.8 UI 能力

```js
api.notify("完成", "success"); // toast：info / success / warning / error

// 面板：position 为 "sidebar"（侧栏区块）/ "floating"（浮动窗）/ "modal"（模态）
const panel = await api.createPanel("my-panel", { position: "modal", title: "标题", width: 760 });
panel.container.innerHTML = "...";  // 内容容器
panel.setTitle("新标题"); panel.show(); panel.hide(); panel.close();
panel.on("close", () => {});        // show / hide / modal-confirm / modal-cancel / modal-button

// 工具栏按钮（顶部搜索行右侧）
api.createToolbarButton("my-btn", { text: "运行", onClick: () => {} });

// 对象卡片/列表行插槽：position 为 "header" / "actions" / "footer"
api.registerItemSlot("my-slot", "footer", (item) => {
  const el = document.createElement("div");
  el.textContent = `自定义内容：${item.name}`;
  return el;
});

// 标准化组件库（createContainer / createButton / createText / createCard / createList / createInput）
const btn = api.ui.createButton({ text: "确定", onClick: () => {} });
panel.container.appendChild(btn);
```

### 5.9 Mod 间通信

```js
api.events.emit("my-event", { payload: 1 });
api.events.on("my-event", (data, sourceModId) => {});
```

## 6. CSS Mod

`type: "css"`（或 `css+js` 的 CSS 部分）的样式被自动包裹进 `@layer mod-<id>`，优先级低于应用核心样式，正常书写即可覆盖变量级外观：

```css
:root {
  --accent-primary: #e5484d; /* 主题变量都可覆盖 */
}
[data-region="sidebar"] { /* 区域结构选择器见 PROJECT_MANUAL 附录 */ }
```

## 7. 生命周期与清理（必做）

```js
api.onLifecycle("disable", () => {
  // 撤销全部副作用：移除 DOM 监听、定时器、注入的节点
});
```

- 类型：`enable` / `disable` / `uninstall` / `install` / `update`，同类可注册多个；
- 单个回调超过 500ms 会被强制跳过（打警告日志）；
- 即使不注册 `disable`，运行时也会兜底强制清理：取消 scope 注册的监听、销毁 Panel、注销工具栏按钮与卡片插槽、移除 `<style>`/`<script>` 注入。**但 `document.addEventListener` 等绕过 scope 的副作用只有你自己能清理**——不注册 `disable` 时禁用 Mod 会收到「可能残留副作用」的提示。

## 8. Theme Mod（主题包）

`type: "theme"`、`entrypoints.theme` 指向一个主题 JSON 时，启用后该主题出现在「设置 → 主题外观」列表（来源标注为 Mod）。主题 JSON 的完整格式见 [THEME_GUIDE.md](./THEME_GUIDE.md)。注意：

- 主题 `id` 不得与内置主题或迁移保留 id 冲突（完整清单见 `src/lib/modRuntime.ts` 的 `RESERVED_THEME_IDS`）；
- 未声明 `id` 时自动取 `mod-theme-<modId>`；
- 禁用 Mod 时主题随之移除。

## 9. 调试

- Mod 的 console 输出与异常打印在 WebView 开发者工具中可见（调试构建下窗口内右键 → 检查）；
- 注入的 DOM 元素带标识：`#__mod-css-<id>`、`#__mod-js-<id>`、面板/按钮带 `data-mod-*` 属性；
- 加载失败、依赖缺失、API 版本不兼容都会以 toast 告知最终用户——开发期请保持控制台可见。

## 10. 发布 Checklist

1. `permissions` 按实际用量最小声明；
2. `api_version` 填 `3.2.0`；
3. 注册 `disable` 清理回调并验证禁用后无残留；
4. 验证卸载后 `storage` 之外不留副作用（`data.*` 记录会保留在数据库中）；
5. 目录内相对路径引用资源，不写绝对路径。
