import { QUERY, matchItems, truncatePathMiddle, typeLabel, type DemoItem } from "./data";
import { Highlight } from "./Highlight";
import { SearchGlyph, Swatch, TypeIcon } from "./icons";

export type QuickVariant = "current" | "glass" | "rail" | "peek";
export type QuickState = "results" | "empty";

function FootKbs({ items }: { items: [string, string][] }) {
  return (
    <span className="v-kbs">
      {items.map(([k, l]) => (
        <span className="v-kb" key={k}>
          <kbd>{k}</kbd>
          {l}
        </span>
      ))}
    </span>
  );
}

function groupByType(items: DemoItem[]) {
  const order = ["document", "text", "spreadsheet", "image", "script", "link", "folder"] as const;
  const map = new Map<string, DemoItem[]>();
  for (const it of items) {
    const lab = typeLabel(it.type);
    if (!map.has(lab)) map.set(lab, []);
    map.get(lab)!.push(it);
  }
  // keep a stable visual order
  const labels = [...new Set(order.map(typeLabel))].filter((l) => map.has(l));
  for (const l of map.keys()) if (!labels.includes(l)) labels.push(l);
  return labels.map((l) => ({ label: l, items: map.get(l)! }));
}

export function Quick({ variant, state = "results", enter = false }: { variant: QuickVariant; state?: QuickState; enter?: boolean }) {
  const q = state === "empty" ? "星际飞船" : QUERY;
  const items = state === "empty" ? [] : matchItems(QUERY);
  const active = items[0]?.id;
  const activeItem = items[0];
  const cls = `v-quick is-${variant}${enter ? " is-enter" : ""}`;

  if (variant === "current") {
    return (
      <div className={cls} data-testid="quick">
        <input className="v-q-input" defaultValue={state === "empty" ? q : QUERY} placeholder="搜索项目、标签或路径…" readOnly />
        <ul className="v-q-list">
          {items.length === 0 && <li className="v-empty">没有匹配的对象</li>}
          {items.map((it) => (
            <li key={it.id} className={`v-q-row${it.id === active ? " is-active" : ""}`}>
              <span className="v-q-icon">
                <TypeIcon type={it.type} />
              </span>
              <span className="v-q-name">{it.name}</span>
              <span className="v-sub">{it.tags.map((t) => t.name).join(" · ")}</span>
              <span className="v-q-path">{truncatePathMiddle(it.path)}</span>
            </li>
          ))}
        </ul>
        <div className="v-q-foot">
          <span />
          <FootKbs
            items={[
              ["Enter", "打开"],
              ["Ctrl+Enter", "位置"],
              ["Ctrl+Shift+C", "复制"],
              ["Alt+Enter", "主窗"],
              ["Ctrl+T", "标签"],
              ["Esc", "收起"],
            ]}
          />
        </div>
      </div>
    );
  }

  if (variant === "glass") {
    const groups = groupByType(items);
    return (
      <div className={cls} data-testid="quick">
        <div className="v-q-search">
          <SearchGlyph size={20} />
          <input className="v-q-input" defaultValue={state === "empty" ? q : QUERY} placeholder="搜索项目、标签或路径" readOnly />
        </div>
        {items.length === 0 ? (
          <div className="v-empty">
            <SearchGlyph size={36} />
            <strong>没有和「{q}」匹配的项目</strong>
            <p>试试文件名里的字，或一个标签名。最近常用：</p>
            <div className="v-chip-row">
              {["春季活动", "报告", "发票"].map((c) => (
                <span className="v-chip" key={c}>
                  {c}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <ul className="v-q-list">
            {groups.map((g) => (
              <li key={g.label}>
                <div className="v-q-group">{g.label}</div>
                {g.items.map((it) => (
                  <div key={it.id} className={`v-q-row${it.id === active ? " is-active" : ""}`}>
                    <span className="v-q-icon">
                      <Swatch color={it.swatch} />
                    </span>
                    <span className="v-q-name">
                      <Highlight text={it.name} query={QUERY} />
                    </span>
                    <span className="v-sub">{it.tags.map((t) => t.name).slice(0, 2).join(" · ")}</span>
                    <span className="v-q-path">{truncatePathMiddle(it.path)}</span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
        <div className="v-q-foot">
          <span className="v-hint">{activeItem ? activeItem.hint ?? typeLabel(activeItem.type) : "输入以搜索"}</span>
          <FootKbs
            items={[
              ["Enter", "打开"],
              ["Ctrl+Enter", "在文件夹中显示"],
              ["Esc", "收起"],
            ]}
          />
        </div>
      </div>
    );
  }

  if (variant === "rail") {
    const best = items.slice(0, 1);
    const rest = items.slice(1);
    const row = (it: DemoItem) => (
      <li key={it.id} className={`v-q-row${it.id === active ? " is-active" : ""}`}>
        <span className="v-rail" />
        <span className="v-q-icon">
          <TypeIcon type={it.type} size={18} />
        </span>
        <span className="v-q-name">
          <Highlight text={it.name} query={QUERY} />
        </span>
        <span className="v-type">{typeLabel(it.type)}</span>
        <span className="v-act">
          <kbd>Enter</kbd> 打开
        </span>
        <span className="v-q-path">{truncatePathMiddle(it.path, 16)}</span>
      </li>
    );
    return (
      <div className={cls} data-testid="quick">
        <div className="v-q-search">
          <SearchGlyph size={16} />
          <input className="v-q-input" defaultValue={state === "empty" ? q : QUERY} placeholder="搜索" readOnly />
        </div>
        {items.length === 0 ? (
          <div className="v-empty">
            <strong>0 条结果</strong>
            <p>「{q}」没有命中名称、路径或标签。</p>
          </div>
        ) : (
          <ul className="v-q-list">
            {best.length > 0 && <div className="v-q-group">最佳匹配</div>}
            {best.map(row)}
            {rest.length > 0 && <div className="v-q-group">其他</div>}
            {rest.map(row)}
          </ul>
        )}
        <div className="v-q-foot">
          <span>{items.length} 项</span>
          <span>↑↓ 移动 · Enter 打开 · Esc 收起</span>
        </div>
      </div>
    );
  }

  // peek
  return (
    <div className={cls} data-testid="quick">
      <div className="v-q-search">
        <SearchGlyph />
        <input className="v-q-input" defaultValue={state === "empty" ? q : QUERY} placeholder="搜索项目" readOnly />
      </div>
      <div className="v-q-split">
        <ul className="v-q-list">
          {items.length === 0 && <li className="v-empty">没有匹配的对象</li>}
          {items.map((it) => (
            <li key={it.id} className={`v-q-row${it.id === active ? " is-active" : ""}`}>
              <span className="v-q-icon">
                <TypeIcon type={it.type} size={18} />
              </span>
              <span className="v-q-name">
                <Highlight text={it.name} query={QUERY} />
              </span>
              <span className="v-type">{typeLabel(it.type)}</span>
            </li>
          ))}
        </ul>
        {activeItem && (
          <aside className="v-preview">
            <div className="v-preview-art">
              <Swatch color={activeItem.swatch} label={activeItem.ext.toUpperCase()} large />
            </div>
            <h3>
              <Highlight text={activeItem.name} query={QUERY} />
            </h3>
            <div className="v-tags">
              {activeItem.tags.map((t) => (
                <span className="v-pill" key={t.name}>
                  <i className="v-dot" style={{ background: t.color }} />
                  {t.name}
                </span>
              ))}
            </div>
            <div className="v-meta">{activeItem.path}</div>
            {activeItem.hint && <div className="v-meta">{activeItem.hint}</div>}
            <button type="button" className="v-open">
              打开
            </button>
          </aside>
        )}
      </div>
      <div className="v-q-foot">
        <span>{items.length ? `${items.length} 项` : ""}</span>
        <FootKbs
          items={[
            ["Enter", "打开"],
            ["Esc", "收起"],
          ]}
        />
      </div>
    </div>
  );
}

