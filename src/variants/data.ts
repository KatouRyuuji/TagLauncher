/** 真实感中文演示数据：工作室日常文件，覆盖文档/图片/表格/脚本。 */

export type FileType = "document" | "image" | "text" | "spreadsheet" | "script" | "link" | "folder";

export interface DemoItem {
  id: string;
  name: string;
  type: FileType;
  ext: string;
  tags: { name: string; color: string }[];
  path: string;
  hint?: string;
  /** 预览：色块 + 标题，避免版权图 */
  swatch: string;
}

export const TAG = {
  work: { name: "工作", color: "#3b82f6" },
  design: { name: "设计", color: "#a855f7" },
  doing: { name: "进行中", color: "#22c55e" },
  report: { name: "报告与总结", color: "#10b981" },
  finance: { name: "财务", color: "#14b8a6" },
};

export const ITEMS: DemoItem[] = [
  {
    id: "1",
    name: "季度报告-Q3-市场与产品.docx",
    type: "document",
    ext: "docx",
    tags: [TAG.work, TAG.report],
    path: "D:\\工作室\\文档\\季度报告-Q3-市场与产品.docx",
    hint: "上周刚改过结论页",
    swatch: "#3b6fd8",
  },
  {
    id: "2",
    name: "会议纪要-2026年11月产品评审.md",
    type: "text",
    ext: "md",
    tags: [TAG.work, TAG.report],
    path: "D:\\工作室\\文档\\会议纪要-2026年11月产品评审.md",
    hint: "含春季活动进度",
    swatch: "#64748b",
  },
  {
    id: "3",
    name: "品牌VI手册-第三版.pdf",
    type: "document",
    ext: "pdf",
    tags: [TAG.work, TAG.design, TAG.doing],
    path: "D:\\工作室\\设计\\品牌VI手册-第三版.pdf",
    swatch: "#c24141",
  },
  {
    id: "4",
    name: "海报-春季活动-最终确认-请勿再改.png",
    type: "image",
    ext: "png",
    tags: [TAG.work, TAG.design, TAG.doing],
    path: "D:\\工作室\\设计\\海报-春季活动-最终确认-请勿再改.png",
    swatch: "#c84a52",
  },
  {
    id: "5",
    name: "发票-某某科技-已付款.pdf",
    type: "document",
    ext: "pdf",
    tags: [TAG.finance, TAG.work],
    path: "D:\\工作室\\财务\\发票-某某科技-已付款.pdf",
    swatch: "#c24141",
  },
  {
    id: "6",
    name: "预算表-2026年度.xlsx",
    type: "spreadsheet",
    ext: "xlsx",
    tags: [TAG.finance, TAG.work],
    path: "D:\\工作室\\财务\\预算表-2026年度.xlsx",
    swatch: "#1f7a4c",
  },
  {
    id: "7",
    name: "图标-应用启动器-1024.png",
    type: "image",
    ext: "png",
    tags: [TAG.design],
    path: "D:\\工作室\\设计\\图标-应用启动器-1024.png",
    swatch: "#3d6fd8",
  },
  {
    id: "8",
    name: "服务合同-某某科技有限公司-已盖章.pdf",
    type: "document",
    ext: "pdf",
    tags: [TAG.work],
    path: "D:\\工作室\\合同\\服务合同-某某科技有限公司-已盖章.pdf",
    swatch: "#c24141",
  },
  {
    id: "9",
    name: "年度工作报告-2025终稿.docx",
    type: "document",
    ext: "docx",
    tags: [TAG.work, TAG.report],
    path: "D:\\工作室\\文档\\年度工作报告-2025终稿.docx",
    hint: "董事会已通过",
    swatch: "#3b6fd8",
  },
  {
    id: "10",
    name: "周报-第44周-渠道报告.md",
    type: "text",
    ext: "md",
    tags: [TAG.work, TAG.report],
    path: "D:\\工作室\\文档\\周报-第44周-渠道报告.md",
    hint: "周一例会用",
    swatch: "#64748b",
  },
  {
    id: "11",
    name: "春季活动效果报告-初稿.pptx",
    type: "document",
    ext: "pptx",
    tags: [TAG.work, TAG.report, TAG.doing],
    path: "D:\\工作室\\文档\\春季活动效果报告-初稿.pptx",
    hint: "还差转化数据",
    swatch: "#c45a2a",
  },
];

export const COLLECT_FILES: DemoItem[] = [
  {
    id: "c1",
    name: "合同扫描件-客户确认版.pdf",
    type: "document",
    ext: "pdf",
    tags: [],
    path: "D:\\待收纳\\合同扫描件-客户确认版.pdf",
    hint: "2 页 · PDF",
    swatch: "#c24141",
  },
  {
    id: "c2",
    name: "封面设计-终稿.png",
    type: "image",
    ext: "png",
    tags: [],
    path: "D:\\待收纳\\封面设计-终稿.png",
    hint: "2400 × 1600",
    swatch: "#5b7fd4",
  },
  {
    id: "c3",
    name: "报价单-2026.xlsx",
    type: "spreadsheet",
    ext: "xlsx",
    tags: [],
    path: "D:\\待收纳\\报价单-2026.xlsx",
    hint: "表格 · 12 行",
    swatch: "#1f7a4c",
  },
];

export const CABINETS = [
  { id: "cab1", name: "春季活动", color: "#f59e0b", count: 5 },
  { id: "cab2", name: "工作台", color: "#3b82f6", count: 3 },
  { id: "cab3", name: "素材库", color: "#a855f7", count: 8 },
];

export const ALL_TAGS = [TAG.work, TAG.design, TAG.doing, TAG.report, TAG.finance];

export const QUERY = "报告";

export function typeLabel(t: FileType): string {
  return {
    document: "文档",
    image: "图片",
    text: "文本",
    spreadsheet: "文档",
    script: "脚本",
    link: "程序",
    folder: "文件夹",
  }[t];
}

export function matchItems(q: string): DemoItem[] {
  if (!q) return ITEMS;
  return ITEMS.filter((i) => i.name.includes(q) || i.tags.some((t) => t.name.includes(q)) || i.path.includes(q));
}

/** 把查询词在文本中标出，用于高亮匹配字 */
export function splitHighlight(text: string, q: string): { t: string; hit: boolean }[] {
  if (!q) return [{ t: text, hit: false }];
  const out: { t: string; hit: boolean }[] = [];
  let rest = text;
  while (rest.length) {
    const i = rest.indexOf(q);
    if (i < 0) {
      out.push({ t: rest, hit: false });
      break;
    }
    if (i > 0) out.push({ t: rest.slice(0, i), hit: false });
    out.push({ t: q, hit: true });
    rest = rest.slice(i + q.length);
  }
  return out;
}

export function truncatePathMiddle(path: string, keep = 18): string {
  if (path.length <= keep * 2 + 3) return path;
  return path.slice(0, keep) + "…" + path.slice(-keep);
}
