// ============================================================================
// demo/data.ts — 演示数据集（仅 demo 模式使用，不进正式构建功能路径）
// ============================================================================
// 模拟日常生活中常见的知名软件 / 游戏 / 音乐 / 图片 / 脚本，6 种对象类型
// （folder / image / audio / exe / bat / ps1）各 4 个，全部挂有匹配标签。
// 标签构成 DAG（多父继承），用于演示标签图谱与「选中父标签并入后代对象」。
//
// 注意：所有路径均为虚构，不指向真实文件；缩略图、专辑封面等视觉资源由
// assets.ts 按路径确定性程序化生成，仓库内不含任何第三方版权素材。
// ============================================================================

import type { Cabinet, Item, Tag, TagRelation } from "../types";

// ---- 标签（DAG：父标签是子标签的超集） ----

export const DEMO_TAGS: Tag[] = [
  { id: 1, name: "开发", color: "#3b82f6" },
  { id: 2, name: "娱乐", color: "#ec4899" },
  { id: 3, name: "工作", color: "#eab308" },
  { id: 4, name: "生活", color: "#22c55e" },
  { id: 5, name: "系统工具", color: "#8b5cf6" },
  { id: 6, name: "网络", color: "#14b8a6" },
  { id: 7, name: "游戏", color: "#f97316" },
  { id: 8, name: "音乐", color: "#e11d48" },
  { id: 9, name: "电影", color: "#db2777" },
  { id: 10, name: "编辑器", color: "#2563eb" },
  { id: 11, name: "开源", color: "#16a34a" },
  { id: 12, name: "浏览器", color: "#0d9488" },
  { id: 13, name: "自动化", color: "#7c3aed" },
  { id: 14, name: "备份", color: "#6d28d9" },
  { id: 15, name: "清理", color: "#a21caf" },
  { id: 16, name: "诊断", color: "#c026d3" },
  { id: 17, name: "文档", color: "#ca8a04" },
  { id: 18, name: "照片", color: "#4ade80" },
  { id: 19, name: "摄影", color: "#059669" },
  { id: 20, name: "壁纸", color: "#65a30d" },
  { id: 21, name: "艺术", color: "#dc2626" },
  { id: 22, name: "名画", color: "#b91c1c" },
  { id: 23, name: "表情包", color: "#f59e0b" },
  { id: 24, name: "搞笑", color: "#fb923c" },
  { id: 25, name: "风景", color: "#10b981" },
  { id: 26, name: "华语流行", color: "#f43f5e" },
  { id: 27, name: "古典", color: "#9333ea" },
  { id: 28, name: "J-Pop", color: "#e879f9" },
  { id: 29, name: "电影原声", color: "#9f1239" },
  { id: 30, name: "开放世界", color: "#ea580c" },
  { id: 31, name: "游戏平台", color: "#c2410c" },
];

export const DEMO_TAG_RELATIONS: TagRelation[] = [
  { parentId: 2, childId: 7 }, // 娱乐 ⊃ 游戏
  { parentId: 2, childId: 8 }, // 娱乐 ⊃ 音乐
  { parentId: 2, childId: 9 }, // 娱乐 ⊃ 电影
  { parentId: 2, childId: 23 }, // 娱乐 ⊃ 表情包
  { parentId: 2, childId: 24 }, // 娱乐 ⊃ 搞笑
  { parentId: 1, childId: 10 }, // 开发 ⊃ 编辑器
  { parentId: 1, childId: 11 }, // 开发 ⊃ 开源
  { parentId: 6, childId: 12 }, // 网络 ⊃ 浏览器
  { parentId: 5, childId: 13 }, // 系统工具 ⊃ 自动化
  { parentId: 5, childId: 14 }, // 系统工具 ⊃ 备份
  { parentId: 5, childId: 15 }, // 系统工具 ⊃ 清理
  { parentId: 5, childId: 16 }, // 系统工具 ⊃ 诊断
  { parentId: 3, childId: 17 }, // 工作 ⊃ 文档
  { parentId: 4, childId: 18 }, // 生活 ⊃ 照片
  { parentId: 4, childId: 19 }, // 生活 ⊃ 摄影
  { parentId: 4, childId: 20 }, // 生活 ⊃ 壁纸
  { parentId: 4, childId: 21 }, // 生活 ⊃ 艺术
  { parentId: 21, childId: 22 }, // 艺术 ⊃ 名画
  { parentId: 19, childId: 25 }, // 摄影 ⊃ 风景
  { parentId: 8, childId: 26 }, // 音乐 ⊃ 华语流行
  { parentId: 8, childId: 27 }, // 音乐 ⊃ 古典
  { parentId: 8, childId: 28 }, // 音乐 ⊃ J-Pop
  { parentId: 8, childId: 29 }, // 音乐 ⊃ 电影原声
  { parentId: 7, childId: 30 }, // 游戏 ⊃ 开放世界
  { parentId: 7, childId: 31 }, // 游戏 ⊃ 游戏平台
];

// ---- 对象（6 类型 × 4） ----

export interface DemoItemSeed extends Item {
  /** 标签 id 列表（对应 DEMO_TAGS） */
  tagIds: number[];
}

/** 缩略图缓存路径（虚构），经 convertFileSrc mock 映射为程序化生成的 SVG */
function thumb(id: number): string {
  return `C:\\DemoData\\Thumbnails\\item-${id}.png`;
}

export const DEMO_ITEMS: DemoItemSeed[] = [
  // ---- folder ----
  { id: 1, name: "工作文档", path: "C:\\Users\\Ryu\\Documents\\工作文档", type: "folder", icon_path: thumb(1), created_at: "2025-03-02T09:12:00Z", last_used_at: "2026-08-25T14:32:00Z", is_favorite: true, tagIds: [3, 17] },
  { id: 2, name: "旅行照片", path: "D:\\Photos\\旅行照片", type: "folder", icon_path: thumb(2), created_at: "2025-05-18T11:20:00Z", last_used_at: "2026-08-24T19:05:00Z", is_favorite: true, tagIds: [4, 18, 19] },
  { id: 3, name: "TagLauncher 源码", path: "C:\\Projects\\tag-launcher", type: "folder", icon_path: thumb(3), created_at: "2025-06-01T08:00:00Z", last_used_at: "2026-08-26T01:10:00Z", is_favorite: false, tagIds: [1, 11] },
  // 移动硬盘未连接 → 演示失效对象徽标与跨盘找回
  { id: 4, name: "影视收藏", path: "E:\\Media\\影视收藏", type: "folder", icon_path: thumb(4), created_at: "2025-04-11T15:40:00Z", is_favorite: false, is_missing: true, tagIds: [2, 9] },

  // ---- image ----
  { id: 5, name: "蒙娜丽莎", path: "D:\\Pictures\\艺术收藏\\蒙娜丽莎.jpg", type: "image", icon_path: "D:\\Pictures\\艺术收藏\\蒙娜丽莎.jpg", created_at: "2025-02-14T10:00:00Z", last_used_at: "2026-08-20T09:45:00Z", is_favorite: false, tagIds: [21, 22] },
  { id: 6, name: "星空壁纸", path: "D:\\Pictures\\壁纸\\星空壁纸.png", type: "image", icon_path: "D:\\Pictures\\壁纸\\星空壁纸.png", created_at: "2025-07-07T22:30:00Z", last_used_at: "2026-08-22T21:12:00Z", is_favorite: false, tagIds: [20, 25] },
  { id: 7, name: "青海湖日落", path: "D:\\Photos\\2024-青海\\青海湖日落.jpg", type: "image", icon_path: "D:\\Photos\\2024-青海\\青海湖日落.jpg", created_at: "2025-08-19T18:02:00Z", last_used_at: "2026-08-23T16:40:00Z", is_favorite: false, tagIds: [18, 19, 25] },
  { id: 8, name: "猫咪表情包", path: "C:\\Users\\Ryu\\Pictures\\表情包\\猫咪表情包.gif", type: "image", icon_path: "C:\\Users\\Ryu\\Pictures\\表情包\\猫咪表情包.gif", created_at: "2025-09-30T12:15:00Z", last_used_at: "2026-08-25T10:08:00Z", is_favorite: false, tagIds: [23, 24] },

  // ---- audio ----
  { id: 9, name: "周杰伦 - 晴天", path: "D:\\Music\\华语流行\\周杰伦 - 晴天.mp3", type: "audio", icon_path: thumb(9), created_at: "2025-01-20T13:00:00Z", last_used_at: "2026-08-25T22:18:00Z", is_favorite: true, tagIds: [8, 26] },
  { id: 10, name: "贝多芬 - 月光奏鸣曲", path: "D:\\Music\\古典\\贝多芬 - 月光奏鸣曲.mp3", type: "audio", icon_path: thumb(10), created_at: "2025-03-15T20:00:00Z", last_used_at: "2026-08-18T07:55:00Z", is_favorite: false, tagIds: [8, 27] },
  { id: 11, name: "米津玄师 - Lemon", path: "D:\\Music\\J-Pop\\米津玄师 - Lemon.mp3", type: "audio", icon_path: thumb(11), created_at: "2025-05-05T09:30:00Z", last_used_at: "2026-08-21T12:26:00Z", is_favorite: false, tagIds: [8, 28] },
  { id: 12, name: "Interstellar Main Theme", path: "D:\\Music\\电影原声\\Interstellar Main Theme.flac", type: "audio", icon_path: thumb(12), created_at: "2025-06-22T17:45:00Z", last_used_at: "2026-08-19T23:02:00Z", is_favorite: false, tagIds: [8, 29] },

  // ---- exe ----
  { id: 13, name: "Visual Studio Code", path: "C:\\Program Files\\Microsoft VS Code\\Code.exe", type: "exe", icon_path: thumb(13), created_at: "2025-01-05T08:00:00Z", last_used_at: "2026-08-26T01:30:00Z", is_favorite: true, tagIds: [1, 10, 11] },
  { id: 14, name: "Google Chrome", path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", type: "exe", icon_path: thumb(14), created_at: "2025-01-05T08:05:00Z", last_used_at: "2026-08-25T18:44:00Z", is_favorite: true, tagIds: [6, 12] },
  { id: 15, name: "原神", path: "G:\\Games\\Genshin Impact\\YuanShen.exe", type: "exe", icon_path: thumb(15), created_at: "2025-02-28T14:20:00Z", last_used_at: "2026-08-24T23:37:00Z", is_favorite: false, tagIds: [2, 7, 30] },
  { id: 16, name: "Steam", path: "D:\\Steam\\Steam.exe", type: "exe", icon_path: thumb(16), created_at: "2025-02-28T14:25:00Z", last_used_at: "2026-08-24T23:30:00Z", is_favorite: false, tagIds: [2, 7, 31] },

  // ---- bat ----
  { id: 17, name: "清理系统垃圾", path: "C:\\Scripts\\清理系统垃圾.bat", type: "bat", icon_path: thumb(17), created_at: "2025-04-02T10:10:00Z", last_used_at: "2026-08-15T09:00:00Z", is_favorite: false, tagIds: [5, 15] },
  { id: 18, name: "一键备份", path: "C:\\Scripts\\一键备份.bat", type: "bat", icon_path: thumb(18), created_at: "2025-04-02T10:12:00Z", last_used_at: "2026-08-10T20:30:00Z", is_favorite: false, tagIds: [5, 13, 14] },
  { id: 19, name: "启动开发环境", path: "C:\\Scripts\\启动开发环境.bat", type: "bat", icon_path: thumb(19), created_at: "2025-04-02T10:15:00Z", last_used_at: "2026-08-25T09:12:00Z", is_favorite: false, tagIds: [1, 13] },
  { id: 20, name: "定时关机", path: "C:\\Scripts\\定时关机.bat", type: "bat", icon_path: thumb(20), created_at: "2025-04-02T10:18:00Z", is_favorite: false, tagIds: [5, 13] },

  // ---- ps1 ----
  { id: 21, name: "批量重命名", path: "C:\\Scripts\\批量重命名.ps1", type: "ps1", icon_path: thumb(21), created_at: "2025-05-11T16:00:00Z", last_used_at: "2026-08-12T11:20:00Z", is_favorite: false, tagIds: [5, 13] },
  { id: 22, name: "系统信息收集", path: "C:\\Scripts\\系统信息收集.ps1", type: "ps1", icon_path: thumb(22), created_at: "2025-05-11T16:05:00Z", is_favorite: false, tagIds: [5, 16] },
  { id: 23, name: "Git 批量更新", path: "C:\\Scripts\\Git批量更新.ps1", type: "ps1", icon_path: thumb(23), created_at: "2025-05-11T16:10:00Z", last_used_at: "2026-08-25T08:50:00Z", is_favorite: false, tagIds: [1, 13] },
  { id: 24, name: "网络诊断", path: "C:\\Scripts\\网络诊断.ps1", type: "ps1", icon_path: thumb(24), created_at: "2025-05-11T16:15:00Z", last_used_at: "2026-08-14T15:36:00Z", is_favorite: false, tagIds: [6, 16] },
];

// ---- 文件柜 ----

export const DEMO_CABINETS: Cabinet[] = [
  { id: 1, name: "工作必备", color: "#3b82f6", created_at: "2025-03-01T09:00:00Z" },
  { id: 2, name: "娱乐休闲", color: "#ec4899", created_at: "2025-03-01T09:01:00Z" },
  { id: 3, name: "常用工具", color: "#22c55e", created_at: "2025-03-01T09:02:00Z" },
];

/** 文件柜成员：cabinetId → itemIds */
export const DEMO_CABINET_ITEMS: Record<number, number[]> = {
  1: [13, 1, 3, 23, 19],
  2: [15, 16, 9, 11, 12, 8],
  3: [14, 17, 18, 20, 21],
};

// ---- 文件夹预览目录列表（虚构条目） ----

export interface DemoDirEntry {
  name: string;
  item_type: string;
  is_file: boolean;
  is_dir: boolean;
  size: number | null;
}

export const DEMO_DIR_LISTINGS: Record<string, DemoDirEntry[]> = {
  "C:\\Users\\Ryu\\Documents\\工作文档": [
    { name: "2026 年度计划.docx", item_type: "exe", is_file: true, is_dir: false, size: 82_432 },
    { name: "季度汇报.pptx", item_type: "exe", is_file: true, is_dir: false, size: 4_718_592 },
    { name: "预算表.xlsx", item_type: "exe", is_file: true, is_dir: false, size: 35_840 },
    { name: "会议纪要", item_type: "folder", is_file: false, is_dir: true, size: null },
    { name: "合同扫描件", item_type: "folder", is_file: false, is_dir: true, size: null },
  ],
  "D:\\Photos\\旅行照片": [
    { name: "青海湖", item_type: "folder", is_file: false, is_dir: true, size: null },
    { name: "京都红叶", item_type: "folder", is_file: false, is_dir: true, size: null },
    { name: "海边日出.jpg", item_type: "image", is_file: true, is_dir: false, size: 5_767_424 },
    { name: "山顶星空.jpg", item_type: "image", is_file: true, is_dir: false, size: 6_340_608 },
  ],
  "C:\\Projects\\tag-launcher": [
    { name: "src", item_type: "folder", is_file: false, is_dir: true, size: null },
    { name: "src-tauri", item_type: "folder", is_file: false, is_dir: true, size: null },
    { name: "package.json", item_type: "exe", is_file: true, is_dir: false, size: 2_048 },
    { name: "README.md", item_type: "exe", is_file: true, is_dir: false, size: 18_432 },
    { name: "Cargo.toml", item_type: "exe", is_file: true, is_dir: false, size: 1_536 },
  ],
  "E:\\Media\\影视收藏": [],
};

// ---- 音频预览元数据（虚构） ----

export interface DemoAudioMeta {
  duration_ms: number;
  bitrate_kbps: number;
  sample_rate: number;
  channels: number;
  encoding: string;
  title: string;
  artist: string;
  album: string;
}

export const DEMO_AUDIO_META: Record<string, DemoAudioMeta> = {
  "D:\\Music\\华语流行\\周杰伦 - 晴天.mp3": { duration_ms: 269_000, bitrate_kbps: 320, sample_rate: 44_100, channels: 2, encoding: "MP3", title: "晴天", artist: "周杰伦", album: "叶惠美" },
  "D:\\Music\\古典\\贝多芬 - 月光奏鸣曲.mp3": { duration_ms: 900_000, bitrate_kbps: 320, sample_rate: 48_000, channels: 2, encoding: "MP3", title: "Piano Sonata No. 14 \"Moonlight\"", artist: "Ludwig van Beethoven", album: "Beethoven: Complete Piano Sonatas" },
  "D:\\Music\\J-Pop\\米津玄师 - Lemon.mp3": { duration_ms: 255_000, bitrate_kbps: 320, sample_rate: 44_100, channels: 2, encoding: "MP3", title: "Lemon", artist: "米津玄師", album: "STRAY SHEEP" },
  "D:\\Music\\电影原声\\Interstellar Main Theme.flac": { duration_ms: 286_000, bitrate_kbps: 1_411, sample_rate: 96_000, channels: 2, encoding: "FLAC", title: "Cornfield Chase", artist: "Hans Zimmer", album: "Interstellar (Original Motion Picture Soundtrack)" },
};
