import { ITEMS, TAG, truncatePathMiddle } from "./data";
import { SearchGlyph, Swatch, TypeIcon } from "./icons";

export type PinVariant = "current" | "dock" | "cards" | "strip";

const PIN_ITEMS = ITEMS.slice(0, 7);
const CARDS_ITEMS = ITEMS.slice(0, 6);
const COLOR = TAG.work.color;

export function Pin({ variant }: { variant: PinVariant }) {
  const active = PIN_ITEMS[0];
  const cls = `v-pin is-${variant}`;
  const style = { ["--pin-color" as string]: COLOR };

  if (variant === "current") {
    return (
      <div className={cls} style={style} data-testid="pin">
        <div className="v-p-head">
          <span>
            工作<span className="v-p-count">{PIN_ITEMS.length}</span>
          </span>
        </div>
        <input className="v-p-filter" placeholder="筛选" readOnly />
        <ul className="v-p-list">
          {PIN_ITEMS.map((it, i) => (
            <li key={it.id} className={`v-p-row${i === 0 ? " is-active" : ""}`}>
              <TypeIcon type={it.type} size={16} />
              <span>{it.name}</span>
            </li>
          ))}
        </ul>
        <div className="v-p-foot">
          共 {PIN_ITEMS.length} 项 · 双击或 Enter 打开
        </div>
      </div>
    );
  }

  if (variant === "dock") {
    return (
      <div className={cls} style={style} data-testid="pin">
        <div className="v-p-head">
          <span style={{ display: "flex", alignItems: "center" }}>
            <i className="dot" />
            工作
            <span className="v-p-count">{PIN_ITEMS.length}</span>
          </span>
        </div>
        <div className="v-p-search">
          <button type="button" aria-label="筛选">
            <SearchGlyph size={15} />
          </button>
        </div>
        <ul className="v-p-list">
          {PIN_ITEMS.map((it, i) => (
            <li key={it.id} className={`v-p-row${i === 0 ? " is-active" : ""}`}>
              <Swatch color={it.swatch} />
              <span className="nm">{it.name.replace(/\.[^.]+$/, "")}</span>
            </li>
          ))}
        </ul>
        <div className="v-p-foot">Enter 打开 · Esc 不管它</div>
      </div>
    );
  }

  if (variant === "cards") {
    return (
      <div className={cls} style={style} data-testid="pin">
        <div className="v-p-head">
          <span>
            工作<span className="v-p-count">{CARDS_ITEMS.length} 项</span>
          </span>
        </div>
        <div className="v-p-grid">
          {CARDS_ITEMS.map((it, i) => (
            <div key={it.id} className={`v-cardx${i === 0 ? " is-active" : ""}`}>
              <div className="art">
                <Swatch color={it.swatch} label={it.ext.toUpperCase()} large />
              </div>
              <div className="meta">
                <div className="nm">{it.name}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={cls} style={style} data-testid="pin">
      <div className="v-p-head">
        <span>
          工作<span className="v-p-count">{PIN_ITEMS.length}</span>
        </span>
      </div>
      <input className="v-p-filter" placeholder="筛选这一层" readOnly />
      <ul className="v-p-list">
        {PIN_ITEMS.map((it, i) => (
          <li key={it.id} className={`v-p-row${i === 0 ? " is-active" : ""}`}>
            <TypeIcon type={it.type} size={16} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
          </li>
        ))}
      </ul>
      {active && (
        <div className="v-strip">
          <Swatch color={active.swatch} />
          <div>
            <div className="nm">{active.name}</div>
            <div className="p">{truncatePathMiddle(active.path, 14)}</div>
          </div>
          <button className="go" type="button">
            打开
          </button>
        </div>
      )}
    </div>
  );
}

