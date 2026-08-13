const api = window.__tagLauncherModApi.createScope(__MOD_ID__);

const AUDIO_SVG = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
  <rect width="320" height="320" rx="48" fill="#101827"/>
  <circle cx="116" cy="222" r="34" fill="#60a5fa"/>
  <circle cx="224" cy="190" r="34" fill="#34d399"/>
  <path d="M250 76v114h-26V111l-82 18v93h-26V108c0-11 7-20 18-23l91-20c13-3 25 7 25 21Z" fill="#e5e7eb"/>
  <path d="M142 129l82-18" stroke="#93c5fd" stroke-width="12" stroke-linecap="round"/>
</svg>`);

const TYPE_LABELS = {
  folder: "文件夹",
  image: "图片",
  audio: "音频",
  exe: "应用程序",
  bat: "批处理",
  ps1: "PowerShell",
};

const TYPE_ICONS = {
  folder: "📁",
  image: "🖼",
  audio: "♪",
  exe: "⚙",
  bat: "▣",
  ps1: ">",
};

let itemsById = new Map();
let hoveredItemId = null;
let lastPointerX = -1;
let lastPointerY = -1;
let panel = null;
let closingPanel = false;
let renderSerial = 0;

function refreshItems(items) {
  itemsById = new Map(items.map((item) => [item.id, item]));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function asElement(target) {
  if (target instanceof Element) return target;
  return target?.parentElement ?? null;
}

function itemIdFromElement(element) {
  const node = element?.closest?.("[data-selectable-item-id]");
  const raw = node?.getAttribute("data-selectable-item-id");
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

function onPointerMove(event) {
  // 记录光标坐标 + 即时命中。坐标用于按 P 时重新命中（虚拟化列表行间存在间隙，
  // 仅靠上次 pointermove 目标可能落在无 data-selectable-item-id 的包裹层而丢失悬停项）。
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  hoveredItemId = itemIdFromElement(asElement(event.target));
}

// 按 P 时以光标实际坐标重新命中卡片，规避虚拟化间隙/包裹层导致的悬停丢失。
function hoveredIdAtPointer() {
  if (lastPointerX < 0 || lastPointerY < 0) return null;
  const el = document.elementFromPoint(lastPointerX, lastPointerY);
  return itemIdFromElement(el instanceof Element ? el : null);
}

function isEditableTarget(target) {
  const element = asElement(target);
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable;
}

async function onKeyDown(event) {
  if (event.isComposing || event.key === "Process") return;
  if (event.key.toLowerCase() !== "p" || event.ctrlKey || event.metaKey || event.altKey) return;
  if (isEditableTarget(event.target)) return;
  // 与 src/lib/workspaceChrome.ts 的 WORKSPACE_KEY_BLOCKING_OVERLAYS 保持一致。
  if (document.querySelector("[data-workspace-overlay]")) return;

  // 优先按光标实际位置重新命中，回退到上次悬停项，再回退到焦点项。
  const focusedId = itemIdFromElement(document.activeElement);
  const itemId = hoveredIdAtPointer() ?? hoveredItemId ?? focusedId;
  if (itemId === null) return;

  event.preventDefault();
  event.stopPropagation();

  const item = await resolveItem(itemId);
  if (item) {
    await openPreview(item);
  }
}

async function resolveItem(itemId) {
  if (itemsById.has(itemId)) return itemsById.get(itemId);
  try {
    refreshItems(await api.getItems());
  } catch {
    return null;
  }
  return itemsById.get(itemId) ?? null;
}

async function ensurePanel() {
  if (panel) {
    panel.show();
    return panel;
  }

  panel = await api.createPanel("object-preview", {
    position: "modal",
    title: "对象预览",
    width: 760,
  });
  panel.on("close", closePreviewPanel);
  return panel;
}

function closePreviewPanel() {
  const current = panel;
  panel = null;
  if (!current || closingPanel) return;

  closingPanel = true;
  try {
    current.close();
  } finally {
    closingPanel = false;
  }
}

async function openPreview(item) {
  const serial = ++renderSerial;
  const handle = await ensurePanel();
  if (serial !== renderSerial) return;

  handle.setTitle(`预览 · ${item.name}`);

  // 适配当前版本的对象身份模型：失效对象（文件被删除/跨盘移动且无法重定位）
  // 的 path 为最近已知位置，直接读文件会报错，这里给出明确提示而非生硬的 IO 错误。
  if (item.is_missing) {
    renderMissing(handle.container, item);
    return;
  }

  renderLoading(handle.container);

  try {
    if (item.type === "folder") {
      await renderFolder(handle.container, item, serial);
    } else if (item.type === "audio") {
      await renderAudio(handle.container, item, serial);
    } else if (item.type === "image") {
      await renderImage(handle.container, item, serial);
    } else {
      await renderGeneric(handle.container, item, serial);
    }
  } catch (error) {
    if (serial === renderSerial) {
      renderError(handle.container, error);
    }
  }
}

function renderLoading(container) {
  container.innerHTML = `<div class="object-preview-root"><div class="object-preview-loading">正在读取预览...</div></div>`;
}

function renderError(container, error) {
  const message = error instanceof Error ? error.message : String(error);
  container.innerHTML = `<div class="object-preview-root"><div class="object-preview-error">${escapeHtml(message)}</div></div>`;
}

function renderMissing(container, item) {
  container.innerHTML = `
    <div class="object-preview-root">
      <div class="object-preview-error">⚠ 对象已失效：文件可能已被删除，或移动到其他磁盘而无法自动定位。</div>
      ${metaHtml([
        ["名称", item.name],
        ["类型", typeLabel(item.type)],
        ["最近已知位置", item.path],
      ])}
    </div>
  `;
}

async function renderFolder(container, item, serial) {
  const entries = await api.preview.listDirectory(item.path);
  if (serial !== renderSerial) return;

  const MAX_ROWS = 48;
  const shown = entries.slice(0, MAX_ROWS);
  const rows = shown.map((entry) => `
    <div class="object-preview-row" title="${escapeHtml(entry.path)}">
      <span class="object-preview-icon">${escapeHtml(TYPE_ICONS[entry.item_type] || "□")}</span>
      <span class="object-preview-name">${escapeHtml(entry.name)}</span>
      <span class="object-preview-type">${escapeHtml(typeLabel(entry.item_type))}</span>
      <span class="object-preview-size">${entry.is_dir ? "文件夹" : escapeHtml(formatSize(entry.size))}</span>
    </div>
  `).join("");

  const countLabel = entries.length > MAX_ROWS
    ? `显示 ${shown.length} / ${entries.length}`
    : `${entries.length}`;

  container.innerHTML = `
    <div class="object-preview-root">
      ${metaHtml([
        ["路径", item.path],
        ["项目数", countLabel],
      ])}
      ${shown.length > 0
        ? `<div class="object-preview-list">${rows}</div>`
        : `<div class="object-preview-empty">文件夹为空</div>`}
    </div>
  `;
}

async function renderAudio(container, item, serial) {
  const [fileInfo, audioResult] = await Promise.all([
    api.preview.getFileInfo(item.path),
    api.preview.getAudio(item.path).then((data) => ({ data })).catch((error) => ({ error })),
  ]);
  if (serial !== renderSerial) return;

  const audio = audioResult.data ?? {};
  const coverUrl = audio.album_cover_data_url || thumbnailUrl(item) || AUDIO_SVG;
  const audioError = audioResult.error
    ? `<div class="object-preview-error">音频元数据读取失败：${escapeHtml(audioResult.error.message || audioResult.error)}</div>`
    : "";

  container.innerHTML = `
    <div class="object-preview-root">
      <div class="object-preview-hero">
        <div class="object-preview-cover-frame">
          <img class="object-preview-cover" src="${escapeHtml(coverUrl)}" alt="专辑封面" draggable="false" />
        </div>
        <div class="object-preview-meta">
          ${metaItem("标题", audio.title || item.name)}
          ${metaItem("艺术家", audio.artist || "未知")}
          ${metaItem("专辑", audio.album || "未知")}
          ${metaItem("长度", formatDuration(audio.duration_ms))}
          ${metaItem("采样率", formatSampleRate(audio.sample_rate))}
          ${metaItem("编码", audio.encoding || "未知")}
          ${metaItem("码率", audio.bitrate_kbps ? `${audio.bitrate_kbps} kbps` : "未知")}
          ${metaItem("大小", formatSize(fileInfo.size))}
          ${metaItem("路径", item.path)}
        </div>
      </div>
      ${audioError}
    </div>
  `;
}

async function renderImage(container, item, serial) {
  const info = await api.preview.getFileInfo(item.path);
  if (serial !== renderSerial) return;

  container.innerHTML = `
    <div class="object-preview-root">
      <div class="object-preview-image-frame">
        <img class="object-preview-image" src="${escapeHtml(assetUrl(item.path))}" alt="${escapeHtml(item.name)}" draggable="false" />
      </div>
      ${metaHtml([
        ["路径", item.path],
        ["大小", formatSize(info.size)],
      ])}
    </div>
  `;
}

async function renderGeneric(container, item, serial) {
  const info = await api.preview.getFileInfo(item.path);
  if (serial !== renderSerial) return;

  container.innerHTML = `
    <div class="object-preview-root">
      <div class="object-preview-hero">
        <div class="object-preview-thumb-frame">
          ${thumbnailUrl(item)
            ? `<img class="object-preview-thumb" src="${escapeHtml(thumbnailUrl(item))}" alt="${escapeHtml(item.name)} 缩略图" draggable="false" />`
            : `<span class="object-preview-icon">${escapeHtml(TYPE_ICONS[item.type] || "□")}</span>`}
        </div>
        <div class="object-preview-meta">
          ${metaItem("名称", item.name)}
          ${metaItem("类型", typeLabel(item.type))}
          ${metaItem("大小", formatSize(info.size))}
          ${metaItem("路径", item.path)}
        </div>
      </div>
    </div>
  `;
}

function metaHtml(items) {
  return `<div class="object-preview-meta">${items.map(([label, value]) => metaItem(label, value)).join("")}</div>`;
}

function metaItem(label, value) {
  return `
    <div class="object-preview-meta-item">
      <div class="object-preview-label">${escapeHtml(label)}</div>
      <div class="object-preview-value">${escapeHtml(value ?? "未知")}</div>
    </div>
  `;
}

function thumbnailUrl(item) {
  return item.icon_path ? assetUrl(item.icon_path) : null;
}

function assetUrl(path) {
  return api.preview.toAssetUrl(String(path));
}

function typeLabel(type) {
  return TYPE_LABELS[type] || type || "未知";
}

function formatSize(size) {
  if (size === null || size === undefined) return "未知";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(size);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "未知";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatSampleRate(rate) {
  if (!rate) return "未知";
  return rate >= 1000 ? `${(rate / 1000).toFixed(1)} kHz` : `${rate} Hz`;
}

api.getItems().then(refreshItems).catch(() => {});
const unsubscribeItems = api.onItemsChanged(refreshItems);

document.addEventListener("pointermove", onPointerMove, true);
document.addEventListener("keydown", onKeyDown, true);

api.onLifecycle("disable", () => {
  document.removeEventListener("pointermove", onPointerMove, true);
  document.removeEventListener("keydown", onKeyDown, true);
  unsubscribeItems();
  closePreviewPanel();
});
