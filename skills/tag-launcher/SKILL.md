---
name: tag-launcher
description: 管理并启动 TagLauncher（Windows 标签式启动器）中的对象——搜索、启动、添加、打标签、收藏、文件柜与库统计。当用户要求查找/打开/整理本机已纳入 TagLauncher 管理的文件、应用或文件夹时使用。
---

# TagLauncher 集成

TagLauncher 把文件、文件夹、应用组织为「对象」并以标签管理。已接入 MCP（`tl mcp`）时直接用其工具，工具说明与使用准则由服务端提供；否则用下面的 `tl` 命令行。

## 命令行

`tl.exe` 与主程序同目录，命令以 `tl --help` 为准。加全局开关 `--json` 输出 JSON，优先使用；对象多时用 `--limit` 控制条数。

```bash
tl --json search "视频" --type video --limit 20   # 全文搜索
tl --json get 42                                 # 对象详情（含标签）
tl launch 42                                     # 数字按 id，否则按搜索首个结果
tl --json add "D:\Tools\app.exe" "D:\Projects"
tl remove 42 43                                  # 只移出库，不删磁盘文件
tl tag add "设计" --color "#e11d48"
tl tag set 42 "设计" "参考"                       # 整体替换，标签名须已存在
tl fav 42 --off                                  # 不带 --off 为收藏
tl --json cabinet items 3
tl --json stats
```

数据库不存在时命令会报错，引导用户先运行一次主程序。命令行与主程序共用同一个库，主程序开着时写入的结果需要按 F5 刷新才能看到。

## 行为准则

- **启动前确认**：`launch` 会真实打开程序或文件，意图不明时先 `search` 列出候选让用户挑。
- **id 优先**：先 `search` 拿 id，后续命令都用 id。
- **标签整体替换**：追加标签前先 `get` 读出现有标签，合并后再 `tag set`。
- **只读优先**：用户只是查找时不执行写命令（add、remove、tag set、fav）。
- **失败重试节制**：数据库被占用时隔几秒重试一次即可。
