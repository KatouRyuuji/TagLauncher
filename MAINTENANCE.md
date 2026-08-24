# TagLauncher 维护手册

> 适用版本：v1.6.1-beta · 面向仓库维护者 · 覆盖 CI、发版、更新分发、数据运维与故障排查

---

## 1. 自动化流水线总览

| 工作流 | 触发 | 产出 |
|---|---|---|
| `.github/workflows/ci.yml` | push 到 main / 任意 PR | 完整测试（tsc + 前端逻辑/交互测试 + cargo 单元/集成测试）+ 前端生产构建校验 |
| `.github/workflows/release.yml` | 推送版本 tag（`*.*.*`，兼容 `v` 前缀） | Windows x64 + ARM64 NSIS 安装包，上传到**草稿 Release** |
| `.github/workflows/release.yml`（手动） | Actions 页 workflow_dispatch | 仅构建，安装包作为 workflow artifact 供测试下载 |

CI 与本地 `npm run test:all` 是同一套脚本（`scripts/run-tests.mjs`），本地绿 = CI 绿。

## 2. 发版流程（Release Checklist）

1. **对齐版本号（三处必须一致）**：
   - `package.json` → `version`
   - `src-tauri/Cargo.toml` → `version`
   - `src-tauri/tauri.conf.json` → `version`
2. **本地全量验证**：

```bash
npm run test:all    # 五步全绿
npm run build       # 前端生产构建
```

3. **更新文档**：README 版本号、USER_GUIDE、迭代计划/功能清单/PROJECT_STATUS（本地文档）。
4. **提交并打 tag**：

```bash
git add -A
git commit -m "chore(release): vX.Y.Z"
git tag X.Y.Z
git push origin main --tags
```

5. **等待 Release 工作流完成**（约 15–25 分钟，双架构并行）；到 GitHub Releases 页检查草稿：
   - 确认两个安装包都已上传：`TagLauncher_X.Y.Z_x64-setup.exe`、`TagLauncher_X.Y.Z_arm64-setup.exe`；
   - 补写 Release 说明（用户可见，会显示在应用内「检查更新」的更新说明里）；
   - 实机安装冒烟：安装 → 启动 → 导入对象 → 打标 → 搜索 → 检查更新。
6. **点击 Publish** 发布。已装用户会在启动后 24h 内收到应用内更新提示。

### 版本号语义

`主.次.修`（SemVer 风格）：破坏性数据结构变更升主版本；新功能升次版本；纯修复升修订号。应用内更新检查用同一比较规则（`semver_gte`），tag 带不带 `v` 前缀均可识别。

## 3. 应用内更新分发机制

- 客户端命令 `update_check`（`src-tauri/src/commands/update_commands.rs`）请求
  `https://api.github.com/repos/KatouRyuuji/TagLauncher/releases/latest`：
  - `/releases/latest` 语义上**不含**草稿与预发布——草稿阶段用户不会收到提示；
  - 按编译期架构（x64/aarch64）匹配 `_x64-setup.exe` / `_arm64-setup.exe` 资产；
  - 未匹配到资产时回退到 Release 页面链接。
- **仓库迁移时**须同步修改 `update_commands.rs` 里的 `GITHUB_REPO` 常量。
- 前端启动检查节流 24h（localStorage `taglauncher.update_last_check_ts`），同版本只提醒一次（`taglauncher.update_notified_version`）。
- 未做静默自更新（下载后需用户手动运行安装包）：规避更新签名密钥管理与后台替换二进制的攻击面。如未来引入 tauri-plugin-updater，需要：生成签名密钥对 → 公钥进 `tauri.conf.json` → 私钥进 GitHub Secrets → release.yml 开启 updater 产物。

## 4. 数据库运维

### 4.1 结构与迁移

- 单文件 SQLite（WAL 模式）：`Save/taglauncher.db`；schema 版本存 `app_meta.schema_version`（当前 v007）。
- 新增迁移：在 `src-tauri/src/db/migrations/` 加 `v00N_xxx.rs` 并在 `migrations/mod.rs` 注册；启动时自动逐版本执行，破坏性迁移前会自动落 `*.pre-vN.bak` 备份。
- 迁移必须**非破坏 + 幂等**（`IF NOT EXISTS` / `ADD COLUMN` 风格）；破坏性重建须走「备份 → 重建 → 原子换版本号」模式（参考 v005）。
- 导入/恢复对 schema 版本有保护：来源库版本高于当前应用支持版本时拒绝（提示用户先升级应用）。

### 4.2 备份体系

| 类型 | 位置 | 触发 | 是否含密钥 |
|---|---|---|---|
| 本机一键备份 | `Save/Backups/taglauncher_backup_*.db` | 用户手动 | 含（本机灾备，支持完整恢复） |
| 导入前安全备份 | `Save/Backups/taglauncher_pre_import_*.db` | 导入数据时自动 | 含 |
| 恢复前安全备份 | `Save/Backups/taglauncher_pre_restore_*.db` | 云端恢复时自动 | 含 |
| 破坏性迁移备份 | `Save/*.pre-vN.bak` | 迁移时自动 | 含 |
| 导出副本 | 用户指定路径 | 用户手动 | **不含**（剔除 `ai.*` 并 VACUUM） |
| 云端备份 | WebDAV `远端目录/taglauncher_*.db` | 手动或自动（24h） | **不含**（剔除 `ai.*` 与 `sync.*`） |

> 破坏性迁移备份保留策略：历史（非本轮）备份**仅保留最新一份、按 mtime 判定**，本轮新建的一律保留（多破坏性迁移连跳会产生多份，最早一份是「升级前原始态」）。因此 `*.pre-vN.bak` 不适合作为长期存档——想长期保留某份迁移前备份的用户，请在升级后尽快把它复制到 `Save/` 以外的位置。

所有快照统一走 SQLite Online Backup API（页级一致，不受 WAL 未 checkpoint 影响），带 15s 忙等超时防死锁。

### 4.3 手工恢复（应用起不来时）

1. 关闭应用进程；
2. 把 `Save/Backups/` 中最近的备份复制为 `Save/taglauncher.db`（同时删除旁边的 `-wal`/`-shm` 残留）；
3. 重启应用。若数据目录被重定向过，实际位置见 exe 旁 `datapath.json`。

## 5. 云同步（WebDAV）运维要点

- 实现在 `src-tauri/src/commands/sync_commands.rs`：纯 `ureq` 阻塞 HTTP + 手写 PROPFIND multistatus 解析（无第三方 XML 依赖）。
- 配置存 `app_meta`（键前缀 `sync.`）；密码不下发前端；恢复流程会保留本机 `ai.*`/`sync.*` 键（本机凭据优先于云端副本内嵌值）。
- 兼容性按 WebDAV 规范实现（PROPFIND/MKCOL/PUT/GET/DELETE），已覆盖 Apache/Nextcloud/坚果云三种 multistatus 形态的解析测试；新服务器不兼容时优先检查其 PROPFIND 响应格式。
- 远端保留份数常量 `REMOTE_KEEP_COUNT = 10`、下载上限 1 GiB、传输超时 600s，均在该文件顶部集中定义。
- 允许 `http://`（局域网 NAS 场景）；这是与 AI 配置（强制 https）不同的刻意决策，UI 已作明文风险提示。

## 6. 测试体系

```bash
npm run test:all     # 全量：tsc + 前端逻辑 + vitest + cargo --lib + cargo 集成
npm run test         # 仅前端（逻辑 + vitest）
npm run test:unit    # 仅 vitest
cd src-tauri; cargo test            # 仅后端
cd src-tauri; cargo test --test sync_update   # 仅云同步/更新集成测试
```

- 后端测试用**真实磁盘临时库**（非内存库），覆盖迁移链、WAL、Online Backup 行为；
- 测试用例总账见 `测试计划.md`；发版通过标准：全部自动测试绿灯 + P0/P1 手动项确认。

## 7. 故障排查速查

| 症状 | 排查路径 |
|---|---|
| CI 红灯 | 本地跑 `npm run test:all` 复现；Windows runner 与本地同为 MSVC 工具链 |
| Release 工作流失败 | 检查三处版本号是否一致；rust-cache 偶发损坏可在 Actions 里清缓存重跑 |
| 用户报「检查更新失败」 | GitHub API 限流（未认证 60 次/小时/IP）；确认 Release 已 Publish（草稿不可见） |
| 用户报云同步 401/403 | 让用户确认账号密码/应用密码；坚果云等第三方需专用授权码 |
| 用户数据损坏 | 引导用 `Save/Backups/` 最近备份手工恢复（见 §4.3）；应用启动时对损坏库有 legacy 扫描自愈 |
| 更新后启动异常 | 检查迁移日志（stderr）；`*.pre-vN.bak` 可手工回滚到升级前 |

## 8. 依赖升级策略

- Rust 侧锁定 `rusqlite 0.31` / `ureq 2`（升 ureq 3 需重写请求构造与错误映射）；`windows-sys` 升级需回归 FFI（文件 ID/启动/图标）。
- 前端 React 19 / Vite 7 / Tailwind 4 / vitest 4；升级后必跑 `npm run test:all` + 实机 `npm run tauri dev` 冒烟。
- Tauri 2.x 小版本升级低风险；升 3.x 前先在分支验证 capabilities 与插件 API 变化。
