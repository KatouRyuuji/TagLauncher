// ============================================================================
// lib/modUiKit.ts — Mod UI 组件库
// ============================================================================
// 为 Mod Panel 提供标准化的宿主风格 UI 组件。
//
// 设计原则：
//   - 所有组件基于原生 HTMLElement，不依赖 React/Vue
//   - 默认使用宿主 CSS 变量保持视觉一致性
//   - 支持通过 className / style 完全自定义外观
//   - 组件自动注入 data-mod-ui 属性，便于宿主调试和样式隔离
//
// 使用方式（在 mod JS 中）：
//   const api = window.__tagLauncherModApi.createScope(__MOD_ID__);
//   const panel = await api.createPanel("my-panel", { position: "floating" });
//   const ui = api.ui;
//
//   const card = ui.createCard({ title: "设置" });
//   const input = ui.createInput({ placeholder: "输入名称", onChange: v => console.log(v) });
//   const btn = ui.createButton({ text: "保存", variant: "primary", onClick: () => {} });
//   card.appendChild(input);
//   card.appendChild(btn);
//   panel.container.appendChild(card);
// ============================================================================

export type UiVariant = "primary" | "secondary" | "danger" | "ghost";

export interface UiBaseOptions {
  /** 附加 CSS 类名 */
  className?: string;
  /** 内联样式（会覆盖组件默认值） */
  style?: Partial<CSSStyleDeclaration>;
}

export interface UiContainerOptions extends UiBaseOptions {
  children?: HTMLElement[];
}

export interface UiButtonOptions extends UiBaseOptions {
  text: string;
  onClick?: (e: MouseEvent) => void;
  /** 按钮风格变体 */
  variant?: UiVariant;
  /** 是否禁用 */
  disabled?: boolean;
}

export interface UiTextOptions extends UiBaseOptions {
  text: string;
  /** HTML 标签名 */
  tag?: "span" | "p" | "h1" | "h2" | "h3" | "h4" | "label" | "div";
}

export interface UiCardOptions extends UiBaseOptions {
  children?: HTMLElement[];
  /** 卡片标题（可选） */
  title?: string;
}

export interface UiListOptions<T> extends UiBaseOptions {
  items: T[];
  renderItem: (item: T, index: number) => HTMLElement;
  /** 空列表时显示的文本 */
  emptyText?: string;
}

export interface UiInputOptions extends UiBaseOptions {
  value?: string;
  onChange?: (value: string) => void;
  onEnter?: (value: string) => void;
  placeholder?: string;
  type?: "text" | "number" | "password";
  /** 是否禁用 */
  disabled?: boolean;
}

// ── 内部工具 ──────────────────────────────────────────────────────────────

const UI_ATTR = "data-mod-ui";

function applyBase(el: HTMLElement, opts: UiBaseOptions, component: string) {
  el.setAttribute(UI_ATTR, component);
  if (opts.className) {
    opts.className.split(/\s+/).forEach((c) => {
      if (c) el.classList.add(c);
    });
  }
  if (opts.style) {
    Object.assign(el.style, opts.style);
  }
}

function getCssVar(name: string, fallback = ""): string {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || fallback
  );
}

// ── 组件工厂 ──────────────────────────────────────────────────────────────

export function createContainer(opts: UiContainerOptions = {}): HTMLDivElement {
  const el = document.createElement("div");
  applyBase(el, opts, "container");
  el.style.display = "flex";
  el.style.flexDirection = "column";
  el.style.gap = getCssVar("spacing-sm", "8px");
  el.style.padding = getCssVar("spacing-md", "12px");
  el.style.backgroundColor = getCssVar("bg-surface", "rgba(10,21,38,0.84)");
  el.style.borderRadius = getCssVar("radius-md", "8px");
  el.style.border = `1px solid ${getCssVar("border-subtle", "rgba(148,163,184,0.08)")}`;
  el.style.color = getCssVar("text-primary", "#eff6ff");
  el.style.fontFamily = getCssVar("font-family", "system-ui, sans-serif");
  el.style.fontSize = getCssVar("font-size-base", "14px");

  if (opts.children) {
    for (const child of opts.children) {
      el.appendChild(child);
    }
  }
  return el;
}

export function createButton(opts: UiButtonOptions): HTMLButtonElement {
  const el = document.createElement("button");
  applyBase(el, opts, "button");
  el.textContent = opts.text;
  el.disabled = opts.disabled ?? false;

  const variant = opts.variant ?? "secondary";
  const applyVariant = () => {
    const isDisabled = el.disabled;
    const opacity = isDisabled ? "0.5" : "1";
    const cursor = isDisabled ? "not-allowed" : "pointer";
    el.style.opacity = opacity;
    el.style.cursor = cursor;

    switch (variant) {
      case "primary":
        el.style.backgroundColor = getCssVar("accent-primary", "#7dd3fc");
        el.style.color = getCssVar("bg-base", "#07111f");
        el.style.border = "none";
        break;
      case "danger":
        el.style.backgroundColor = getCssVar("color-danger", "#ef4444");
        el.style.color = "#fff";
        el.style.border = "none";
        break;
      case "ghost":
        el.style.backgroundColor = "transparent";
        el.style.color = getCssVar("text-secondary", "#94a3b8");
        el.style.border = `1px solid ${getCssVar("border-subtle", "rgba(148,163,184,0.08)")}`;
        break;
      case "secondary":
      default:
        el.style.backgroundColor = getCssVar("bg-hover", "rgba(148,163,184,0.12)");
        el.style.color = getCssVar("text-primary", "#eff6ff");
        el.style.border = `1px solid ${getCssVar("border-default", "rgba(148,163,184,0.12)")}`;
        break;
    }
  };

  el.style.padding = `${getCssVar("spacing-sm", "8px")} ${getCssVar("spacing-md", "12px")}`;
  el.style.borderRadius = getCssVar("radius-md", "8px");
  el.style.fontSize = getCssVar("font-size-sm", "13px");
  el.style.fontWeight = getCssVar("font-weight-medium", "500");
  el.style.transition = `opacity ${getCssVar("transition-fast", "0.15s")}`;
  el.style.minWidth = "64px";

  applyVariant();

  el.addEventListener("mouseenter", () => {
    if (!el.disabled) el.style.opacity = "0.85";
  });
  el.addEventListener("mouseleave", () => {
    if (!el.disabled) el.style.opacity = "1";
  });

  if (opts.onClick) {
    el.addEventListener("click", opts.onClick);
  }

  // 当 disabled 属性被外部修改时重刷样式
  const origDescriptor = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, "disabled");
  if (origDescriptor?.set) {
    Object.defineProperty(el, "disabled", {
      get() {
        return origDescriptor.get?.call(this) ?? false;
      },
      set(v) {
        origDescriptor.set!.call(this, v);
        applyVariant();
      },
      configurable: true,
    });
  }

  return el;
}

export function createText(opts: UiTextOptions): HTMLElement {
  const tag = opts.tag ?? "span";
  const el = document.createElement(tag);
  applyBase(el, opts, "text");
  el.textContent = opts.text;

  const fontSizeMap: Record<string, string> = {
    h1: getCssVar("font-size-xl", "20px"),
    h2: getCssVar("font-size-lg", "18px"),
    h3: getCssVar("font-size-lg", "18px"),
    h4: getCssVar("font-size-base", "14px"),
    p: getCssVar("font-size-base", "14px"),
    span: getCssVar("font-size-sm", "13px"),
    label: getCssVar("font-size-sm", "13px"),
    div: getCssVar("font-size-base", "14px"),
  };

  el.style.fontSize = fontSizeMap[tag] ?? fontSizeMap.span;
  el.style.color = getCssVar("text-primary", "#eff6ff");
  el.style.lineHeight = getCssVar("line-height-normal", "1.5");

  if (tag.startsWith("h")) {
    el.style.fontWeight = getCssVar("font-weight-bold", "700");
    el.style.margin = "0";
  }
  if (tag === "label") {
    el.style.color = getCssVar("text-secondary", "#94a3b8");
    el.style.fontWeight = getCssVar("font-weight-medium", "500");
  }

  return el;
}

export function createCard(opts: UiCardOptions = {}): HTMLDivElement {
  const el = document.createElement("div");
  applyBase(el, opts, "card");
  el.style.display = "flex";
  el.style.flexDirection = "column";
  el.style.gap = getCssVar("spacing-sm", "8px");
  el.style.padding = getCssVar("spacing-md", "12px");
  el.style.backgroundColor = getCssVar("bg-card", "rgba(10,21,38,0.6)");
  el.style.borderRadius = getCssVar("radius-lg", "10px");
  el.style.border = `1px solid ${getCssVar("border-default", "rgba(148,163,184,0.12)")}`;
  el.style.boxShadow = getCssVar("shadow-card", "0 2px 8px rgba(0,0,0,0.2)");

  if (opts.title) {
    const titleEl = createText({ text: opts.title, tag: "h4", className: "mod-ui-card-title" });
    titleEl.style.marginBottom = getCssVar("spacing-xs", "4px");
    el.appendChild(titleEl);
  }

  if (opts.children) {
    for (const child of opts.children) {
      el.appendChild(child);
    }
  }

  return el;
}

export function createList<T>(opts: UiListOptions<T>): HTMLDivElement {
  const el = document.createElement("div");
  applyBase(el, opts, "list");
  el.style.display = "flex";
  el.style.flexDirection = "column";
  el.style.gap = getCssVar("spacing-xs", "4px");

  if (opts.items.length === 0) {
    const empty = createText({
      text: opts.emptyText ?? "暂无数据",
      tag: "p",
      className: "mod-ui-list-empty",
      style: { color: getCssVar("text-muted", "#64748b"), textAlign: "center", padding: getCssVar("spacing-md", "12px") },
    });
    el.appendChild(empty);
    return el;
  }

  for (let i = 0; i < opts.items.length; i++) {
    const item = opts.items[i];
    const row = document.createElement("div");
    row.setAttribute(UI_ATTR, "list-item");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.padding = `${getCssVar("spacing-sm", "8px")} ${getCssVar("spacing-md", "12px")}`;
    row.style.borderRadius = getCssVar("radius-sm", "6px");
    row.style.transition = `background-color ${getCssVar("transition-fast", "0.15s")}`;
    row.style.minHeight = "36px";

    row.addEventListener("mouseenter", () => {
      row.style.backgroundColor = getCssVar("bg-hover", "rgba(148,163,184,0.12)");
    });
    row.addEventListener("mouseleave", () => {
      row.style.backgroundColor = "transparent";
    });

    const content = opts.renderItem(item, i);
    row.appendChild(content);
    el.appendChild(row);
  }

  return el;
}

export function createInput(opts: UiInputOptions): HTMLInputElement {
  const el = document.createElement("input");
  applyBase(el, opts, "input");
  el.type = opts.type ?? "text";
  el.value = opts.value ?? "";
  el.placeholder = opts.placeholder ?? "";
  el.disabled = opts.disabled ?? false;

  el.style.padding = `${getCssVar("spacing-sm", "8px")} ${getCssVar("spacing-md", "12px")}`;
  el.style.backgroundColor = getCssVar("bg-input", "rgba(10,21,38,0.6)");
  el.style.color = getCssVar("text-primary", "#eff6ff");
  el.style.border = `1px solid ${getCssVar("border-default", "rgba(148,163,184,0.12)")}`;
  el.style.borderRadius = getCssVar("radius-md", "8px");
  el.style.fontSize = getCssVar("font-size-base", "14px");
  el.style.fontFamily = "inherit";
  el.style.outline = "none";
  el.style.transition = `border-color ${getCssVar("transition-fast", "0.15s")}, box-shadow ${getCssVar("transition-fast", "0.15s")}`;
  el.style.width = "100%";
  el.style.boxSizing = "border-box";

  el.addEventListener("focus", () => {
    el.style.borderColor = getCssVar("accent-primary", "#7dd3fc");
    el.style.boxShadow = `0 0 0 2px ${getCssVar("accent-primary-bg", "rgba(125,211,252,0.16)")}`;
  });
  el.addEventListener("blur", () => {
    el.style.borderColor = getCssVar("border-default", "rgba(148,163,184,0.12)");
    el.style.boxShadow = "none";
  });

  el.addEventListener("input", () => {
    opts.onChange?.(el.value);
  });

  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      opts.onEnter?.(el.value);
    }
  });

  return el;
}

// ── 组合接口 ──────────────────────────────────────────────────────────────

export interface ModUiKit {
  createContainer(opts?: UiContainerOptions): HTMLDivElement;
  createButton(opts: UiButtonOptions): HTMLButtonElement;
  createText(opts: UiTextOptions): HTMLElement;
  createCard(opts?: UiCardOptions): HTMLDivElement;
  createList<T>(opts: UiListOptions<T>): HTMLDivElement;
  createInput(opts: UiInputOptions): HTMLInputElement;
}

export function createModUiKit(): ModUiKit {
  return {
    createContainer,
    createButton,
    createText,
    createCard,
    createList,
    createInput,
  };
}
