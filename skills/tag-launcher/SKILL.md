---
name: tag-launcher
description: 管理并启动 TagLauncher（Windows 标签式启动器）中的对象——搜索、启动、添加、打标签、收藏、文件柜与库统计。当用户要求查找/打开/整理本机已纳入 TagLauncher 管理的文件、应用或文件夹时使用。
---

# TagLauncher 集成

TagLauncher 把用户的文件、文件夹、应用组织为「对象」并以标签管理。本 Skill 提供两条等价通路：

1. **CLI**（`tl`）：随应用同目录安装（`tl.exe`）。所有命令支持 `--json` 全局开关输出机器可读 JSON，优先使用。
2. **MCP**：以 stdio 方式运行 `tl mcp`，提供同名工具（search_items / launch_item / add_items / remove_items / list_tags / add_tag / set_item_tags / set_favorite / list_cabinets / list_cabinet_items / stats）。

## 前提

- 数据库不存在时 CLI 会报错提示先运行一次主程序——引导用户先启动 TagLauncher GUI 完成初始化。
- CLI 与 GUI 共享同一 SQLite 库（WAL 并发安全）。GUI 已打开时执行写操作后，GUI 需手动刷新（F5）才可见最新数据。

## 常用操作

```bash
# 搜索（全文；--type 过滤 folder/image/audio/video/exe/bat/ps1）
tl --json search "视频" --type video --limit 20

# 启动对象：数字按 id，否则按搜索词首命中
tl launch 42
tl launch " blender"

# 添加 / 移除对象
tl --json add "D:\Tools\app.exe" "D:\Projects"
tl remove 42 43

# 标签：list / add / set（整体替换，标签名须已存在）/ clear
tl tag list
tl tag add "设计" --color "#e11d48"
tl tag set 42 "设计" "参考"
tl tag clear 42

# 收藏 / 取消收藏
tl fav 42 43          # 收藏
tl fav 42 --off       # 取消收藏

# 文件柜与统计
tl cabinet list
tl cabinet items 3
tl --json stats
```

## 行为准则

- **启动前确认**：`tl launch` 会在用户机器上真实打开程序/文件；用户意图不明时先用 `search` 展示候选让用户挑。
- **id 优先**：多轮操作先 `search` 拿 id，后续命令用 id，避免名称歧义。
- **标签语义**：`tag set` 是整体替换不是追加；追加需先 `get` 读出既有标签合并后再 set。
- **只读优先**：用户只问「有什么/找一下」时不要执行写命令（add/remove/tag set/fav）。
- **失败处理**：数据库被占用（GUI 大量写入中）时命令会返回 SQLite 错误，间隔几秒重试一次即可，不要反复轰炸。

## MCP 接入（Claude Desktop 示例）

`command` 用设置页「AI 集成」复制的 `tl.exe` 绝对路径（currentUser 安装一般在 `%LOCALAPPDATA%\Programs\TagLauncher\tl.exe`）。

```json
{
  "mcpServers": {
    "tag-launcher": {
      "command": "<设置页复制的 tl.exe 绝对路径>",
      "args": ["mcp"]
    }
  }
}
```

工具与 CLI 命令一一对应，参数见各工具的 inputSchema。`id` 可以是 JSON 数字或数字字符串。
