// ============================================================================
// demo/data.ts — 演示数据集（仅 demo 模式使用，不进正式构建功能路径）
// ============================================================================
// 10 个模拟对象，覆盖全部形态：
//   - 6 种对象类型：folder ×3 / image ×2 / audio / exe ×2 / bat / ps1；
//   - 状态形态：收藏、失效（移动硬盘未连接）、多标签、从未启动（无 last_used_at）；
//   - 标签构成 DAG（多父继承），含零对象的结构标签（系统工具），用于演示
//     标签图谱与「选中父标签并入后代对象」。
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
  { id: 7, name: "游戏", color: "#f97316" },
  { id: 8, name: "音乐", color: "#e11d48" },
  { id: 9, name: "电影", color: "#db2777" },
  { id: 10, name: "编辑器", color: "#2563eb" },
  { id: 11, name: "开源", color: "#16a34a" },
  { id: 13, name: "自动化", color: "#7c3aed" },
  { id: 17, name: "文档", color: "#ca8a04" },
  { id: 18, name: "照片", color: "#4ade80" },
  { id: 19, name: "摄影", color: "#059669" },
  { id: 21, name: "艺术", color: "#dc2626" },
  { id: 22, name: "名画", color: "#b91c1c" },
  { id: 25, name: "风景", color: "#10b981" },
  { id: 26, name: "华语流行", color: "#f43f5e" },
  { id: 30, name: "开放世界", color: "#ea580c" },
];

export const DEMO_TAG_RELATIONS: TagRelation[] = [
  { parentId: 2, childId: 7 }, // 娱乐 ⊃ 游戏
  { parentId: 2, childId: 8 }, // 娱乐 ⊃ 音乐
  { parentId: 2, childId: 9 }, // 娱乐 ⊃ 电影
  { parentId: 1, childId: 10 }, // 开发 ⊃ 编辑器
  { parentId: 1, childId: 11 }, // 开发 ⊃ 开源
  { parentId: 5, childId: 13 }, // 系统工具 ⊃ 自动化
  { parentId: 3, childId: 17 }, // 工作 ⊃ 文档
  { parentId: 4, childId: 18 }, // 生活 ⊃ 照片
  { parentId: 4, childId: 19 }, // 生活 ⊃ 摄影
  { parentId: 21, childId: 22 }, // 艺术 ⊃ 名画
  { parentId: 19, childId: 25 }, // 摄影 ⊃ 风景
  { parentId: 8, childId: 26 }, // 音乐 ⊃ 华语流行
  { parentId: 7, childId: 30 }, // 游戏 ⊃ 开放世界
];

// ---- 对象（10 个，6 类型全覆盖） ----

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
  // 移动硬盘未连接 → 演示失效对象徽标与跨盘找回
  { id: 3, name: "影视收藏", path: "E:\\Media\\影视收藏", type: "folder", icon_path: thumb(3), created_at: "2025-04-11T15:40:00Z", is_favorite: false, is_missing: true, tagIds: [2, 9] },

  // ---- image ----
  { id: 4, name: "青海湖日落", path: "D:\\Photos\\2024-青海\\青海湖日落.jpg", type: "image", icon_path: "D:\\Photos\\2024-青海\\青海湖日落.jpg", created_at: "2025-08-19T18:02:00Z", last_used_at: "2026-08-23T16:40:00Z", is_favorite: false, tagIds: [18, 19, 25] },
  { id: 5, name: "蒙娜丽莎", path: "D:\\Pictures\\艺术收藏\\蒙娜丽莎.jpg", type: "image", icon_path: "D:\\Pictures\\艺术收藏\\蒙娜丽莎.jpg", created_at: "2025-02-14T10:00:00Z", last_used_at: "2026-08-20T09:45:00Z", is_favorite: false, tagIds: [21, 22] },

  // ---- audio ----
  { id: 6, name: "周杰伦 - 晴天", path: "D:\\Music\\华语流行\\周杰伦 - 晴天.mp3", type: "audio", icon_path: thumb(6), created_at: "2025-01-20T13:00:00Z", last_used_at: "2026-08-25T22:18:00Z", is_favorite: true, tagIds: [8, 26] },

  // ---- exe ----
  { id: 7, name: "Visual Studio Code", path: "C:\\Program Files\\Microsoft VS Code\\Code.exe", type: "exe", icon_path: thumb(7), created_at: "2025-01-05T08:00:00Z", last_used_at: "2026-08-26T01:30:00Z", is_favorite: true, tagIds: [1, 10, 11] },
  { id: 8, name: "原神", path: "G:\\Games\\Genshin Impact\\YuanShen.exe", type: "exe", icon_path: thumb(8), created_at: "2025-02-28T14:20:00Z", last_used_at: "2026-08-24T23:37:00Z", is_favorite: false, tagIds: [2, 7, 30] },

  // ---- bat ----
  { id: 9, name: "启动开发环境", path: "C:\\Scripts\\启动开发环境.bat", type: "bat", icon_path: thumb(9), created_at: "2025-04-02T10:15:00Z", last_used_at: "2026-08-25T09:12:00Z", is_favorite: false, tagIds: [1, 13] },

  // ---- ps1 ----
  { id: 10, name: "Git 批量更新", path: "C:\\Scripts\\Git批量更新.ps1", type: "ps1", icon_path: thumb(10), created_at: "2025-05-11T16:10:00Z", last_used_at: "2026-08-25T08:50:00Z", is_favorite: false, tagIds: [1, 13] },
];

// ---- 文件柜 ----

export const DEMO_CABINETS: Cabinet[] = [
  { id: 1, name: "工作必备", color: "#3b82f6", created_at: "2025-03-01T09:00:00Z" },
  { id: 2, name: "娱乐休闲", color: "#ec4899", created_at: "2025-03-01T09:01:00Z" },
];

/** 文件柜成员：cabinetId → itemIds */
export const DEMO_CABINET_ITEMS: Record<number, number[]> = {
  1: [7, 1, 10],
  2: [8, 6],
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
};
