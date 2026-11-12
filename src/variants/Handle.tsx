import { ITEMS, TAG } from "./data";
import { Pin } from "./Pin";

export type HandleVariant = "current" | "tab" | "jewel" | "peek";
export type HandleState = "rest" | "hover" | "drawer";

const COLOR = TAG.work.color;
const Y = 420; // 位置记忆：大约在屏幕中上部，模拟用户上次停的位置

export function Handle({ variant, state = "rest" }: { variant: HandleVariant; state?: HandleState }) {
  const hover = state === "hover";
  const open = state === "drawer";
  const style = { ["--pin-color" as string]: COLOR };

  return (
    <div className="v-handle-layer" style={style} data-testid="handle">
      {variant === "current" && (
        <div className="v-h-current" title="TagLauncher 钉住把手">
          <div className="pill" />
        </div>
      )}
      {variant === "tab" && (
        <div className={`v-h-tab${hover || open ? " is-hover" : ""}`} style={{ top: Y }}>
          <span className="v-h-bar" />
          <span className="v-h-label">工作</span>
          <span className="v-h-count">7</span>
          <span className="v-h-extra">
            <span>钉住 · 右缘</span>
            <span>移入展开</span>
          </span>
        </div>
      )}
      {variant === "jewel" && (
        <div className={`v-h-jewel-track${hover || open ? " is-hover" : ""}`}>
          <div className="v-h-jewel" style={{ top: Y + 40 }} />
          <div className="v-h-tip" style={{ top: Y + 40 }}>
            工作 · 7 项 · 钉住
          </div>
        </div>
      )}
      {variant === "peek" && (
        <div className={`v-h-peek${hover || open ? " is-hover" : ""}`} style={{ top: Y - 20 }}>
          <div className="v-h-stripe" />
          <div className="v-h-body">
            <div className="v-h-title">工作</div>
            <div className="v-h-sub">7 项</div>
            <div className="v-h-stack">
              {ITEMS.slice(0, 3).map((it) => (
                <div className="mini" key={it.id}>
                  {it.name.replace(/\.[^.]+$/, "")}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className={`v-drawer${open ? " is-open" : ""}`}>
        <Pin variant="dock" />
      </div>
    </div>
  );
}
