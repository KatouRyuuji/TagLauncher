// ============================================================================
// demo/backend.ts — 演示模式内存后端（仅 demo 模式使用）
// ============================================================================
// 在浏览器内完整模拟 Rust 后端的全部 Tauri 命令：数据读写、标签 DAG、
// 文件柜、设置、AI 打标、云同步、更新检查、Mod 管理等。UI 的全部交互路径
// （增删改查、筛选、排序、打标、预览）都能像在真实应用中一样运转，
// 只是不触碰真实文件系统与网络。
//
// 数据在页面刷新后重置为初始演示数据集（demo 不追求持久化）。
// ============================================================================

import type { Cabinet, Item, ItemWithTags, Tag, TagRelation } from "../types";
import type { ModInfo } from "../types/mod";
import type { ThemeDefinition } from "../types/theme";
import pkg from "../../package.json";
import { demoAlbumCover } from "./assets";
import {
  DEMO_AUDIO_META,
  DEMO_CABINET_ITEMS,
  DEMO_CABINETS,
  DEMO_DIR_LISTINGS,
  DEMO_ITEMS,
  DEMO_TAG_RELATIONS,
  DEMO_TAGS,
  type DemoItemSeed,
} from "./data";

const VERSION: string = pkg.version;
const DATA_DIR = "C:\\DemoData\\TagLauncher";

// ---- 内存状态 ----

interface DemoState {
  items: DemoItemSeed[];
  tags: Tag[];
  relations: TagRelation[];
  cabinets: Cabinet[];
  cabinetItems: Map<number, Set<number>>;
  settings: Map<string, string>;
  ai: {
    baseUrl: string;
    apiKey: string;
    model: string;
    autoTagOnAdd: boolean;
    maxTags: number;
    allowNewTags: boolean;
    extraPrompt: string;
  };
  sync: {
    url: string;
    username: string;
    password: string;
    remoteDir: string;
    autoSync: boolean;
    lastSyncTs: number;
  };
  mods: ModInfo[];
  modKv: Map<string, string>;
  modRecords: Map<string, Map<string, string>>;
  modFiles: Map<string, string>;
  nextItemId: number;
  nextTagId: number;
  nextCabinetId: number;
}

function seedState(): DemoState {
  return {
    items: DEMO_ITEMS.map((item) => ({ ...item, tagIds: [...item.tagIds] })),
    tags: DEMO_TAGS.map((tag) => ({ ...tag })),
    relations: DEMO_TAG_RELATIONS.map((rel) => ({ ...rel })),
    cabinets: DEMO_CABINETS.map((cabinet) => ({ ...cabinet })),
    cabinetItems: new Map(
      Object.entries(DEMO_CABINET_ITEMS).map(([id, ids]) => [Number(id), new Set(ids)]),
    ),
    settings: new Map([
      // 演示主用主题：樱花粉（功能巡演与截图全覆盖）
      ["theme", "7f47aab2-74bb-4c77-b99b-550f0acf3c9c"],
      ["last_known_version", VERSION],
    ]),
    ai: {
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-demo-************************",
      model: "claude-sonnet-4-6",
      autoTagOnAdd: true,
      maxTags: 3,
      allowNewTags: false,
      extraPrompt: "",
    },
    sync: {
      url: "https://dav.example.com/dav",
      username: "demo-user",
      password: "demo-password",
      remoteDir: "/tag-launcher",
      autoSync: false,
      lastSyncTs: 0,
    },
    mods: [
      {
        id: "focus-dock",
        name: "Focus Dock",
        version: "1.2.0",
        author: "Community",
        description: "在侧栏显示一个专注面板：汇总今日待办与最近启动的对象。",
        type: "css+js",
        entrypoints: { css: "style.css", js: "main.js" },
        api_version: "3.2.0",
        permissions: ["items:read", "tags:read", "dom", "storage"],
        enabled: false,
        path: "C:\\DemoData\\Mods\\focus-dock",
        is_compatible: true,
      },
      {
        id: "midnight-glass",
        name: "Midnight Glass",
        version: "0.9.1",
        author: "ThemeLab",
        description: "玻璃拟态深色主题包，附带模糊背景与霓虹强调色。",
        type: "theme",
        entrypoints: { theme: "theme.json" },
        enabled: false,
        path: "C:\\DemoData\\Mods\\midnight-glass",
        is_compatible: true,
      },
    ],
    modKv: new Map(),
    modRecords: new Map(),
    modFiles: new Map(),
    nextItemId: 1000,
    nextTagId: 1000,
    nextCabinetId: 100,
  };
}

const state = seedState();

// ---- 工具 ----

function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function detectType(path: string): Item["type"] {
  const name = basename(path).toLowerCase();
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/.test(name)) return "image";
  if (/\.(mp3|flac|wav|ogg|m4a|aac)$/.test(name)) return "audio";
  if (/\.bat$/.test(name)) return "bat";
  if (/\.ps1$/.test(name)) return "ps1";
  if (/\.[a-z0-9]+$/.test(name)) return "exe";
  return "folder";
}

function withTags(item: DemoItemSeed): ItemWithTags {
  const { tagIds, ...rest } = item;
  return { ...rest, tags: state.tags.filter((tag) => tagIds.includes(tag.id)) };
}

function sortItems(items: DemoItemSeed[]): DemoItemSeed[] {
  return [...items].sort((a, b) => {
    if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
    const aUsed = a.last_used_at ?? "";
    const bUsed = b.last_used_at ?? "";
    if (aUsed !== bUsed) return bUsed.localeCompare(aUsed);
    return a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}

function requireItem(id: number): DemoItemSeed {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) throw new Error(`对象不存在（id=${id}）`);
  return item;
}

function requireTag(id: number): Tag {
  const tag = state.tags.find((entry) => entry.id === id);
  if (!tag) throw new Error(`标签不存在（id=${id}）`);
  return tag;
}

function requireCabinet(id: number): Cabinet {
  const cabinet = state.cabinets.find((entry) => entry.id === id);
  if (!cabinet) throw new Error(`文件柜不存在（id=${id}）`);
  return cabinet;
}

/** 标签 DAG 成环检测：从 startId 沿父子边能否回到 targetId */
function createsCycle(parentId: number, childId: number): boolean {
  if (parentId === childId) return true;
  const childrenOf = new Map<number, number[]>();
  for (const rel of state.relations) {
    const list = childrenOf.get(rel.parentId) ?? [];
    list.push(rel.childId);
    childrenOf.set(rel.parentId, list);
  }
  const stack = [childId];
  const visited = new Set<number>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === parentId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of childrenOf.get(current) ?? []) stack.push(next);
  }
  return false;
}

/** AI 打标：按名称关键词给出确定性建议（限制在既有标签内） */
function aiSuggest(name: string, itemType: string, maxTags: number): string[] {
  const lower = name.toLowerCase();
  const pick = (names: string[]) =>
    names.filter((n) => state.tags.some((t) => t.name === n)).slice(0, maxTags);
  if (/code|vscode|studio/.test(lower)) return pick(["开发", "编辑器", "开源"]);
  if (/chrome|edge|firefox|浏览器/.test(lower)) return pick(["网络", "浏览器"]);
  if (/原神|genshin|游戏|game/.test(lower)) return pick(["游戏", "娱乐"]);
  if (/steam/.test(lower)) return pick(["游戏", "游戏平台"]);
  if (/周杰伦|晴天|华语/.test(lower)) return pick(["音乐", "华语流行"]);
  if (/贝多芬|古典|奏鸣曲/.test(lower)) return pick(["音乐", "古典"]);
  if (/lemon|米津/.test(lower)) return pick(["音乐", "J-Pop"]);
  if (/interstellar|原声|soundtrack/.test(lower)) return pick(["音乐", "电影原声"]);
  if (/备份|backup/.test(lower)) return pick(["系统工具", "备份", "自动化"]);
  if (/清理|垃圾/.test(lower)) return pick(["系统工具", "清理"]);
  if (/诊断|信息收集/.test(lower)) return pick(["系统工具", "诊断"]);
  if (/照片|旅行|日落|风景/.test(lower)) return pick(["生活", "照片", "摄影"]);
  if (/壁纸|星空/.test(lower)) return pick(["壁纸", "风景"]);
  if (/表情包|猫咪|搞笑/.test(lower)) return pick(["表情包", "搞笑"]);
  if (/文档|工作|汇报/.test(lower)) return pick(["工作", "文档"]);
  if (/源码|git|脚本|开发/.test(lower)) return pick(["开发", "自动化"]);
  if (/影视|电影|收藏/.test(lower)) return pick(["娱乐", "电影"]);
  if (itemType === "audio") return pick(["音乐"]);
  if (itemType === "image") return pick(["生活", "照片"]);
  if (itemType === "bat" || itemType === "ps1") return pick(["系统工具", "自动化"]);
  if (itemType === "folder") return pick(["工作", "文档"]);
  return pick(["娱乐"]);
}

type Args = Record<string, unknown>;
const num = (value: unknown): number => Number(value);
const str = (value: unknown): string => String(value);
const ids = (value: unknown): number[] => (value as number[]).map(Number);

/** 模拟 IPC 往返延迟，让加载态/骨架屏在演示中可见 */
function latency(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- 命令分发 ----

async function handle(cmd: string, args: Args): Promise<unknown> {
  switch (cmd) {
    // ---- 项目 ----
    case "get_items":
      return sortItems(state.items).map(withTags);
    case "get_item":
      return withTags(requireItem(num(args.id)));
    case "get_items_by_ids": {
      const wanted = new Set(ids(args.ids));
      return sortItems(state.items.filter((item) => wanted.has(item.id))).map(withTags);
    }
    case "add_item":
    case "add_items": {
      const paths = cmd === "add_item" ? [str(args.path)] : (args.paths as string[]);
      const added: Item[] = [];
      const failed: Array<{ path: string; error: string }> = [];
      for (const path of paths) {
        if (state.items.some((item) => item.path === path)) {
          failed.push({ path, error: "该对象已在库中" });
          continue;
        }
        const item: DemoItemSeed = {
          id: state.nextItemId++,
          name: basename(path).replace(/\.[^.]+$/, ""),
          path,
          type: detectType(path),
          icon_path: null,
          created_at: new Date().toISOString(),
          is_favorite: false,
          tagIds: [],
        };
        state.items.push(item);
        added.push(withTags(item));
      }
      return cmd === "add_item" ? added[0] : { items: added, failed };
    }
    case "remove_item":
    case "remove_items": {
      const removing = new Set(cmd === "remove_item" ? [num(args.id)] : ids(args.ids));
      state.items = state.items.filter((item) => !removing.has(item.id));
      for (const members of state.cabinetItems.values()) {
        for (const id of removing) members.delete(id);
      }
      return null;
    }
    case "set_item_tags":
    case "set_many_item_tags": {
      const changes =
        cmd === "set_item_tags"
          ? [{ itemId: num(args.itemId), tagIds: ids(args.tagIds) }]
          : (args.changes as Array<{ itemId: number; tagIds: number[] }>);
      for (const change of changes) {
        for (const tagId of change.tagIds) requireTag(tagId);
        requireItem(change.itemId).tagIds = [...change.tagIds];
      }
      return null;
    }
    case "update_item_icon":
      requireItem(num(args.itemId)).icon_path = (args.iconPath as string | null) ?? null;
      return null;
    case "launch_item":
      requireItem(num(args.id)).last_used_at = new Date().toISOString();
      return null;
    case "toggle_favorite": {
      const item = requireItem(num(args.id));
      item.is_favorite = !item.is_favorite;
      return item.is_favorite;
    }
    case "relocate_missing":
      // 演示集中没有可找回的盘符，模拟「未找到」
      return 0;
    case "open_in_explorer":
    case "open_in_explorer_by_id":
      return null;

    // ---- 对象预览 ----
    case "get_object_file_info": {
      const path = str(args.path);
      const type = detectType(path);
      return {
        name: basename(path),
        path,
        item_type: type,
        is_file: type !== "folder",
        is_dir: type === "folder",
        size: type === "folder" ? null : 1_500_000 + (path.length * 97_531) % 8_000_000,
        modified_at_secs: 1_756_000_000,
      };
    }
    case "list_object_directory": {
      const path = str(args.path);
      return (DEMO_DIR_LISTINGS[path] ?? []).map((entry) => ({
        ...entry,
        path: `${path}\\${entry.name}`,
      }));
    }
    case "get_audio_preview": {
      const path = str(args.path);
      const meta = DEMO_AUDIO_META[path];
      if (!meta) throw new Error("无法读取音频信息（演示数据未覆盖该文件）");
      return {
        duration_ms: meta.duration_ms,
        sample_rate: meta.sample_rate,
        encoding: meta.encoding,
        bitrate_kbps: meta.bitrate_kbps,
        bit_depth: meta.encoding === "FLAC" ? 24 : null,
        channels: meta.channels,
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        album_cover_data_url: demoAlbumCover(path),
      };
    }

    // ---- 标签 ----
    case "get_tags":
      return [...state.tags].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
    case "add_tag": {
      const tag: Tag = { id: state.nextTagId++, name: str(args.name), color: str(args.color) };
      state.tags.push(tag);
      return tag;
    }
    case "update_tag": {
      const tag = requireTag(num(args.id));
      tag.name = str(args.name);
      tag.color = str(args.color);
      return null;
    }
    case "remove_tag": {
      const id = num(args.id);
      state.tags = state.tags.filter((tag) => tag.id !== id);
      state.relations = state.relations.filter((rel) => rel.parentId !== id && rel.childId !== id);
      for (const item of state.items) {
        item.tagIds = item.tagIds.filter((tagId) => tagId !== id);
      }
      return null;
    }
    case "get_tag_relations":
      return state.relations;
    case "add_tag_relation": {
      const parentId = num(args.parentId);
      const childId = num(args.childId);
      requireTag(parentId);
      requireTag(childId);
      if (createsCycle(parentId, childId)) throw new Error("无法添加：该关系会形成循环继承");
      if (!state.relations.some((rel) => rel.parentId === parentId && rel.childId === childId)) {
        state.relations.push({ parentId, childId });
      }
      return null;
    }
    case "remove_tag_relation": {
      const parentId = num(args.parentId);
      const childId = num(args.childId);
      state.relations = state.relations.filter(
        (rel) => !(rel.parentId === parentId && rel.childId === childId),
      );
      return null;
    }

    // ---- 搜索 ----
    case "search_items": {
      const query = str(args.query).toLowerCase();
      const tagFilter = new Set(ids(args.tagIds));
      return sortItems(
        state.items.filter((item) => {
          const tags = state.tags.filter((tag) => item.tagIds.includes(tag.id));
          const matchesQuery =
            !query ||
            item.name.toLowerCase().includes(query) ||
            item.path.toLowerCase().includes(query) ||
            tags.some((tag) => tag.name.toLowerCase().includes(query));
          const matchesTags =
            tagFilter.size === 0 || [...tagFilter].every((id) => item.tagIds.includes(id));
          return matchesQuery && matchesTags;
        }),
      ).map(withTags);
    }
    case "read_synonyms":
      return [
        ["图片", "照片", "图像", "相片"],
        ["音乐", "歌曲", "音频", "歌"],
        ["游戏", "game"],
        ["电影", "影片", "影视"],
        ["文档", "文件", "资料"],
        ["浏览器", "browser"],
        ["源码", "代码", "编程"],
        ["清理", "垃圾"],
        ["备份", "backup"],
        ["壁纸", "桌面"],
      ];

    // ---- Mod 网络原语 ----
    case "net_fetch":
      return { status: 200, headers: { "content-type": "application/json" }, body: btoa("{}") };

    // ---- 文件柜 ----
    case "get_cabinets":
      return state.cabinets;
    case "add_cabinet": {
      const cabinet: Cabinet = {
        id: state.nextCabinetId++,
        name: str(args.name),
        color: str(args.color),
        created_at: new Date().toISOString(),
      };
      state.cabinets.push(cabinet);
      state.cabinetItems.set(cabinet.id, new Set());
      return cabinet;
    }
    case "update_cabinet": {
      const cabinet = requireCabinet(num(args.id));
      cabinet.name = str(args.name);
      cabinet.color = str(args.color);
      return null;
    }
    case "remove_cabinet": {
      const id = num(args.id);
      state.cabinets = state.cabinets.filter((cabinet) => cabinet.id !== id);
      state.cabinetItems.delete(id);
      return null;
    }
    case "add_item_to_cabinet":
    case "add_items_to_cabinet": {
      const cabinetId = num(args.cabinetId);
      requireCabinet(cabinetId);
      const members = state.cabinetItems.get(cabinetId)!;
      const itemIds = cmd === "add_item_to_cabinet" ? [num(args.itemId)] : ids(args.itemIds);
      for (const id of itemIds) {
        requireItem(id);
        members.add(id);
      }
      return null;
    }
    case "remove_item_from_cabinet":
    case "remove_items_from_cabinet": {
      const cabinetId = num(args.cabinetId);
      const members = state.cabinetItems.get(cabinetId);
      const itemIds = cmd === "remove_item_from_cabinet" ? [num(args.itemId)] : ids(args.itemIds);
      for (const id of itemIds) members?.delete(id);
      return null;
    }
    case "get_cabinet_items": {
      const members = state.cabinetItems.get(num(args.cabinetId)) ?? new Set<number>();
      return sortItems(state.items.filter((item) => members.has(item.id))).map(withTags);
    }

    // ---- 设置 ----
    case "get_app_version":
      return VERSION;
    case "get_current_theme":
      return state.settings.get("theme") ?? "7f47aab2-74bb-4c77-b99b-550f0acf3c9c";
    case "set_current_theme":
      state.settings.set("theme", str(args.themeId));
      return null;
    case "get_setting":
      return state.settings.get(str(args.key)) ?? null;
    case "set_setting":
      state.settings.set(str(args.key), str(args.value));
      return null;

    // ---- 数据目录 / 备份 ----
    case "get_data_directory_info":
      return {
        saveDir: `${DATA_DIR}\\Save`,
        defaultSaveDir: `${DATA_DIR}\\Save`,
        isCustom: false,
        dbSizeBytes: 188_416,
        backupsDir: `${DATA_DIR}\\Save\\Backups`,
      };
    case "set_data_directory":
    case "reset_data_directory":
      return null;
    case "backup_data":
      return `${DATA_DIR}\\Save\\Backups\\taglauncher-backup-${Date.now()}.db`;
    case "export_data":
      return null;
    case "import_data":
      return `${DATA_DIR}\\Save\\Backups\\taglauncher-backup-safety.db`;
    case "restart_app":
      return null;

    // ---- WebDAV 云同步 ----
    case "sync_get_config":
      return {
        url: state.sync.url,
        username: state.sync.username,
        password: "",
        hasPassword: state.sync.password.length > 0,
        remoteDir: state.sync.remoteDir,
        autoSync: state.sync.autoSync,
        lastSyncTs: state.sync.lastSyncTs,
      };
    case "sync_set_config": {
      const config = args.config as { url: string; username: string; password: string; remoteDir: string; autoSync: boolean };
      state.sync.url = config.url;
      state.sync.username = config.username;
      if (config.password) state.sync.password = config.password;
      state.sync.remoteDir = config.remoteDir;
      state.sync.autoSync = config.autoSync;
      return null;
    }
    case "sync_clear_password":
      state.sync.password = "";
      return null;
    case "sync_test_connection":
      return "连接成功，远端目录已就绪（演示环境模拟）";
    case "sync_list_backups":
      return [
        { name: "taglauncher-20260825-220000.db", sizeBytes: 184_320, modified: "Tue, 25 Aug 2026 22:00:00 GMT" },
        { name: "taglauncher-20260818-220000.db", sizeBytes: 180_224, modified: "Tue, 18 Aug 2026 22:00:00 GMT" },
      ];
    case "sync_backup_now": {
      const name = `taglauncher-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-demo.db`;
      state.sync.lastSyncTs = Math.floor(Date.now() / 1000);
      return name;
    }
    case "sync_restore":
      return `${DATA_DIR}\\Save\\Backups\\taglauncher-backup-safety.db`;

    // ---- 在线更新 ----
    case "update_check":
      return {
        currentVersion: VERSION,
        latestVersion: VERSION,
        hasUpdate: false,
        releaseUrl: "https://github.com/ryuuji3/tag-launcher/releases",
        releaseNotes: "",
        installerUrl: "",
        installerSize: 0,
      };

    // ---- AI 自动打标 ----
    case "ai_get_config":
      return { ...state.ai, apiKey: "", hasApiKey: state.ai.apiKey.length > 0 };
    case "ai_set_config": {
      const config = args.config as typeof state.ai;
      if (config.apiKey) state.ai.apiKey = config.apiKey;
      state.ai.baseUrl = config.baseUrl;
      state.ai.model = config.model;
      state.ai.autoTagOnAdd = config.autoTagOnAdd;
      state.ai.maxTags = config.maxTags;
      state.ai.allowNewTags = config.allowNewTags;
      state.ai.extraPrompt = config.extraPrompt;
      return null;
    }
    case "ai_is_configured":
      return state.ai.baseUrl.length > 0 && state.ai.apiKey.length > 0;
    case "ai_clear_api_key":
      state.ai.apiKey = "";
      return null;
    case "ai_test_connection":
      return `连接成功，模型回显：${state.ai.model}（演示环境模拟）`;
    case "ai_suggest_tags": {
      const existing = (args.existingTags as string[]) ?? [];
      const suggestions = aiSuggest(str(args.name), str(args.itemType), state.ai.maxTags);
      const allowed = new Set(existing);
      const filtered = suggestions.filter((name) => allowed.has(name));
      return state.ai.allowNewTags ? suggestions : filtered;
    }

    // ---- Mod 管理 ----
    case "get_mods":
      return state.mods;
    case "get_custom_themes":
      return { themes: [] as ThemeDefinition[], errors: [] };
    case "get_theme_directory_info":
      return {
        themes_dir: `${DATA_DIR}\\Themes`,
        root_dir: DATA_DIR,
        mods_dir: `${DATA_DIR}\\Mods`,
        save_dir: `${DATA_DIR}\\Save`,
      };
    case "install_theme_file":
      throw new Error("演示模式：主题导入已禁用（文件对话框为模拟环境）");
    case "export_theme_file": {
      const theme = args.theme as ThemeDefinition;
      return { theme, file_name: `${theme.id}.json`, json: JSON.stringify(theme, null, 2) };
    }
    case "get_mod_load_errors":
      return [];
    case "get_mod_content":
      return "";
    case "get_mod_dir":
      return state.mods.find((mod) => mod.id === str(args.modId))?.path ?? `${DATA_DIR}\\Mods\\${str(args.modId)}`;
    case "enable_mod":
    case "disable_mod": {
      const mod = state.mods.find((entry) => entry.id === str(args.modId));
      if (mod) mod.enabled = cmd === "enable_mod";
      return null;
    }
    case "delete_mod":
      state.mods = state.mods.filter((mod) => mod.id !== str(args.modId));
      return null;
    case "get_mod_install_state":
      return "unchanged";
    case "mark_mod_version":
      return null;
    case "import_mod":
      throw new Error("演示模式：Mod 导入已禁用（文件对话框为模拟环境）");
    case "export_mod":
      return `${DATA_DIR}\\Exports\\${str(args.modId)}.zip`;

    // ---- Mod 数据存储 ----
    case "mod_kv_get":
      return state.modKv.get(`${str(args.modId)}:${str(args.key)}`) ?? null;
    case "mod_kv_set":
      state.modKv.set(`${str(args.modId)}:${str(args.key)}`, str(args.value));
      return null;
    case "mod_kv_remove":
      state.modKv.delete(`${str(args.modId)}:${str(args.key)}`);
      return null;
    case "mod_records_list": {
      const records = state.modRecords.get(`${str(args.modId)}:${str(args.collection)}`);
      return records ? [...records.values()] : [];
    }
    case "mod_record_put": {
      const key = `${str(args.modId)}:${str(args.collection)}`;
      const records = state.modRecords.get(key) ?? new Map<string, string>();
      records.set(str(args.id), str(args.value));
      state.modRecords.set(key, records);
      return null;
    }
    case "mod_record_remove":
      state.modRecords.get(`${str(args.modId)}:${str(args.collection)}`)?.delete(str(args.id));
      return null;

    // ---- Mod 文件系统 ----
    case "read_mod_file":
      return state.modFiles.get(`${str(args.modId)}:${str(args.relativePath)}`) ?? "";
    case "read_mod_file_bytes":
      return [];
    case "write_mod_file":
      state.modFiles.set(`${str(args.modId)}:${str(args.relativePath)}`, str(args.content));
      return null;
    case "write_mod_file_bytes":
      return null;
    case "list_mod_files":
      return [];
    case "remove_mod_file":
      state.modFiles.delete(`${str(args.modId)}:${str(args.relativePath)}`);
      return null;

    default:
      throw new Error(`演示后端未实现命令：${cmd}`);
  }
}

/** demo 版 invoke：统一加模拟延迟后分发到内存后端 */
export async function handleInvoke<T>(cmd: string, args?: Args): Promise<T> {
  await latency();
  return (await handle(cmd, args ?? {})) as T;
}
