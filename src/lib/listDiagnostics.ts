// lib/listDiagnostics.ts — 主列表/网格显示取证（F19「列表空白跑到顶部」之类问题，一键复制给开发者）
//
// Ctrl+Alt+Shift+L：把当下的视口/滚动/虚拟器缓存与 DOM 实测、空带检测结果复制成 JSON。
// 与 E2E F19-MATRIX 的探针同一判据（可视区内从列表内容起点到最后一行之间不得有 >4px 空带），
// 只在按下时读取，常驻开销为零。
import { copyText } from "./clipboard";

export const LIST_DIAG_HOTKEY = "Ctrl+Alt+Shift+L";
const GAP_PX = 4;

function visibleList(): HTMLElement | null {
  const lists = [...document.querySelectorAll<HTMLElement>('[role="list"][aria-label="项目列表"]')];
  return lists.find((l) => l.offsetParent !== null) ?? lists[0] ?? null;
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  let sc = el.parentElement;
  while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
  return sc;
}

export function collectListDiagnostics() {
  const list = visibleList();
  const base = {
    at: new Date().toISOString(),
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    uiFontScale: document.documentElement.style.getPropertyValue("--ui-font-scale") || "1",
  };
  if (!list) return { ...base, list: null };
  const sc = scrollParent(list);
  const scr = (sc ?? list).getBoundingClientRect();
  const sticky = sc ? [...sc.querySelectorAll<HTMLElement>(".sticky")].find((e) => e.getBoundingClientRect().height > 0) : undefined;
  const headerH = sticky ? sticky.getBoundingClientRect().height : 0;
  const L = list.getBoundingClientRect();
  let kids = [...list.children].filter((c) => c.hasAttribute("data-index")) as HTMLElement[];
  const few = kids.length === 0;
  if (few) kids = [...list.querySelectorAll<HTMLElement>(".item-grid-few-card")];
  const rows = kids
    .map((c, k) => ({ i: few ? k : Number(c.dataset.index), r: c.getBoundingClientRect(), ph: !c.querySelector("[data-selectable-item-id]") }))
    .filter((x) => x.r.height > 0)
    .sort((a, b) => a.r.top - b.r.top);
  const contentEnd = rows.length ? Math.max(...rows.map((x) => x.r.bottom)) : L.top;
  const viewTop = Math.max(scr.top + headerH, L.top + (parseFloat(getComputedStyle(list).paddingTop) || 0));
  const want: [number, number] = [viewTop, Math.min(Math.min(scr.bottom, L.bottom), contentEnd)];
  let cursor = want[0];
  let maxGap = 0;
  let gapAt: number | null = null;
  for (const x of rows) {
    if (x.r.bottom <= cursor) continue;
    if (x.r.top > cursor) {
      const g = Math.min(x.r.top, want[1]) - cursor;
      if (g > maxGap) {
        maxGap = g;
        gapAt = Math.round(cursor - scr.top);
      }
    }
    cursor = Math.max(cursor, x.r.bottom);
    if (cursor >= want[1]) break;
  }
  if (cursor < want[1] && want[1] - cursor > maxGap) {
    maxGap = want[1] - cursor;
    gapAt = Math.round(cursor - scr.top);
  }
  const perf = (window as unknown as { __tlMainPerf?: { stats: Record<string, () => unknown> } }).__tlMainPerf;
  const grid = list.dataset.region === "item-grid-inner";
  const virt = few ? null : perf?.stats[grid ? "gridVirtual" : "listVirtual"]?.() ?? null;
  return {
    ...base,
    list: {
      mode: grid ? (few ? "grid-few" : "grid") : "list",
      blankBand: maxGap > GAP_PX,
      maxGap: Math.round(maxGap),
      gapAtFromViewportTop: gapAt,
      scrollTop: sc ? Math.round(sc.scrollTop) : null,
      scrollHeight: sc?.scrollHeight ?? null,
      clientHeight: sc?.clientHeight ?? null,
      listHeight: Math.round(L.height),
      headerH: Math.round(headerH),
      placeholders: rows.filter((x) => x.ph).length,
      rendered: rows.map((x) => [x.i, Math.round(x.r.top - scr.top), Math.round(x.r.height)]),
      virtual: virt,
    },
  };
}

export function isListDiagHotkey(e: KeyboardEvent): boolean {
  return e.ctrlKey && e.altKey && e.shiftKey && e.code === "KeyL";
}

/** 主窗挂一次：按下热键即复制诊断 JSON */
export function installListDiagHotkey(): () => void {
  const handler = (e: KeyboardEvent) => {
    if (!isListDiagHotkey(e)) return;
    e.preventDefault();
    const data = collectListDiagnostics();
    const blank = data.list && "blankBand" in data.list && data.list.blankBand;
    void copyText(JSON.stringify(data, null, 1), blank ? "已复制列表诊断（检测到空白带）" : "已复制列表诊断");
  };
  window.addEventListener("keydown", handler, true);
  return () => window.removeEventListener("keydown", handler, true);
}
