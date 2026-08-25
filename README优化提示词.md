# README 优化提示词(给 AI 用)

> 用途:把下面整段提示词喂给任意 AI(Claude / GPT / Gemini 等),生成精美的新版 README 与配图方案。
> 使用方法:复制「提示词正文」整段发送;如需配图,把「配图清单」一并交给绘图模型或让 AI 生成 SVG/HTML。

---

## 提示词正文

你是一名资深开源项目品牌设计师与技术文案。请为 Windows 桌面应用 **TagLauncher** 重写一份**商业级、视觉精美**的 GitHub README(简体中文,技术名词保留英文),并给出配套配图方案。

### 项目事实(严禁虚构,只能基于以下信息发挥排版与表达)

- **定位**:标签式文件管理器/启动器。把本地文件、文件夹、脚本、程序、图片按「标签 + 文件柜 + 收藏」组织,快速搜索、一键启动。
- **技术栈**:Tauri 2 + React 19 + TypeScript + Rust + SQLite(WAL + FTS5)+ Zustand + Tailwind CSS 4。
- **核心卖点**(按重要性排序):
  1. **文件认人不认路**:NTFS 文件 ID 作身份,改名/同盘移动自动追踪;跨盘移动按内容指纹自动找回;支持 NAS/网络盘。
  2. **图状标签(DAG)**:标签多父继承,选「水果」自动包含「苹果」;关系编辑器 + 可视化标签图谱。
  3. **Mod + 主题双体系**:CSS / CSS+JS / Theme 三类 Mod,17 种权限管控、网络请求原语、列表插槽;主题 tokens/变体/自定义 CSS。
  4. **AI 自动打标**:兼容 Anthropic 协议(可接第三方地址),一键/自动打标,密钥只存本机、导出自动剔除。
  5. **数据主权**:全部本地存储;WebDAV 云备份/恢复(保留最近 10 份、云端副本脱敏);自定义数据目录;一键备份/导出/导入。
  6. **商业级交互**:大列表虚拟化、命令面板(Ctrl+K)、空格快速预览、鼠标框选、搜索关键词高亮、五种排序、批量操作、主题化窗口栏、完整键盘体系、骨架屏。
  7. **在线更新**:启动自动检查 GitHub Releases(24h 节流),x64/ARM64 双架构安装包。
- **工程数据**:90 个后端命令、300+ 自动化测试全绿、CI(push/PR)+ tag 触发双架构发版流水线。
- **平台**:Windows 10/11(x64 / ARM64);安装包 NSIS 约 4.8 MB;MIT License;Copyright (c) 2026 RyuuJi Soft。
- **仓库**:https://github.com/KatouRyuuji/TagLauncher
- **版本**:1.6.1-beta(首个正式版 1.0.0 以来完成代际升级,详见仓库《版本对比.md》)。

### README 结构要求

1. **顶部 Hero 区**:居中大 Logo 占位、一句话 slogan(你创作,要求有力、不超过 20 字)、徽章行(release 版本、平台 Windows、License MIT、CI 状态,用 shields.io,仓库路径 KatouRyuuji/TagLauncher)。
2. **截图/演示占位区**:主界面截图、标签图谱、命令面板三个占位(用 HTML 注释标注 `<!-- TODO: 替换为实际截图 -->`,并注明建议尺寸 1280×800)。
3. **核心亮点**:从上面 7 个卖点中选 5 个,用「图标 + 标题 + 一句话」的卡片式排版(可用 Markdown 表格模拟),避免流水账。
4. **快速开始**:面向用户(下载安装包)与开发者(setup.bat 一键环境 → `npm run tauri dev`)两条路径,命令用代码块。
5. **功能总览**:折叠式 `<details>` 区块,完整但不占地。
6. **文档导航**:使用手册 USER_GUIDE.md、开发手册 PROJECT_MANUAL.md、源码开发指南 TUTORIAL.md、维护手册 MAINTENANCE.md、版本对比 版本对比.md。
7. **星标**:GitHub 已限制 stargazers 公开 API,star-history 内嵌图表需要仓库所有者在 star-history.com 用 token 生成加密嵌入码(令牌加密后出现在 README,安全)。在此之前,使用 shields.io 星标徽章 + 趋势链接:
   `[![GitHub Stars](https://img.shields.io/github/stars/KatouRyuuji/TagLauncher?style=social)](https://github.com/KatouRyuuji/TagLauncher/stargazers) · [Star 趋势](https://star-history.com/#KatouRyuuji/TagLauncher&Date)`
   若所有者已生成加密嵌入码,则替换为 star-history 实时图表。
8. **页脚**:License、版权、致谢占位。

### 风格要求

- 克制高级:不使用花哨 emoji 轰炸(每节标题最多 1 个)、不使用夸张营销词("最强""颠覆"禁用)。
- 中文排版规范:中英文之间加空格,中文标点;代码/命令一律反引号。
- GitHub 渲染兼容:只用 GitHub 支持的 Markdown + 内联 HTML(`<p align="center">`、`<details>`、`<img>`、`<picture>` 可用;不要 script/iframe)。
- 同时给出**暗色/亮色**两套下都好看的配色建议(用 `<picture>` 的 `prefers-color-scheme` 处理 Logo/截图变体)。

### 输出物

1. 完整的 README.md 全文(可直接落地)。
2. 修改说明:你做了哪些取舍、为什么。

---

## 配图清单(交给绘图模型 / 设计工具)

| 图 | 用途 | 规格与要求 |
|---|---|---|
| Logo | README Hero、应用图标延展 | SVG,512×512。意象:标签(tag)与火箭/启动器的结合,扁平、单色可反白,暗色/亮色两版。主色建议取自应用樱花主题(粉青撞色)或赛博青。 |
| Hero Banner | README 顶部横幅 | 1600×500 PNG/SVG。左侧产品名+slogan,右侧抽象化的「标签网络 + 文件卡片」插画,扁平 2.5D,留白充足。 |
| 主界面截图 | 功能演示 | 1280×800,网格视图 + 侧栏标签 + 顶栏搜索真实截图,深色主题一张、浅色一张。 |
| 标签图谱截图 | 卖点 2 演示 | 1280×800,展示 DAG 关系连线。 |
| 命令面板截图 | 卖点 6 演示 | 1280×800,Ctrl+K 面板打开状态。 |
| 社交预览图 | GitHub Social Preview(仓库 Settings 上传) | 1280×640,Logo + 产品名 + 一句话简介。 |

绘图提示词建议(英文,喂给图像模型):

> Flat 2.5D vector illustration for a Windows desktop app called "TagLauncher": a network of colorful paper tags connected as a directed graph, floating file cards with thumbnails, a subtle rocket motif, cherry-blossom pink and cyber-cyan accents on a deep slate background, clean minimal composition, generous negative space, no text, high contrast, suitable as an open-source project hero banner.
