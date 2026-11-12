import { ALL_TAGS, CABINETS, COLLECT_FILES, truncatePathMiddle } from "./data";
import { Swatch, TypeIcon } from "./icons";

export type CollectVariant = "current" | "actions" | "inbox" | "steps";
export type CollectState = "home" | "empty";

export function Collect({ variant, state = "home" }: { variant: CollectVariant; state?: CollectState }) {
  const files = state === "empty" ? [] : COLLECT_FILES;
  const selected = files[0];
  const cls = `v-collect is-${variant}`;

  if (variant === "current") {
    return (
      <div className={cls} data-testid="collect">
        <h2>
          收纳 {files.length} 项<span>从资源管理器</span>
        </h2>
        <ul className="v-c-files">
          {files.map((f) => (
            <li className="v-c-file" key={f.id}>
              <div className="n">{f.name}</div>
              <div className="p">{truncatePathMiddle(f.path, 22)}</div>
            </li>
          ))}
        </ul>
        <div className="v-c-acts">
          <button className="v-btn" type="button">
            打标签…（T）
          </button>
          <button className="v-btn" type="button">
            放入文件柜…（C）
          </button>
          <button className="v-btn" type="button">
            仅导入（I）
          </button>
        </div>
        <label className="v-c-rem">
          <input type="checkbox" readOnly />
          记住本次选择（之后后备箱会直接执行，可在设置里改回）
        </label>
        <div className="v-q-foot">
          <span>
            <kbd>T</kbd> 打标签　<kbd>C</kbd> 放入文件柜　<kbd>I</kbd> 仅导入　<kbd>Esc</kbd> 取消
          </span>
        </div>
      </div>
    );
  }

  if (variant === "actions") {
    return (
      <div className={cls} data-testid="collect">
        <h2>
          收纳 {files.length} 项<span>先选一个动作，文件已经在下面列好了</span>
        </h2>
        <div className="v-c-strip">
          {files.map((f) => (
            <div className="v-c-chip" key={f.id}>
              <Swatch color={f.swatch} />
              <span>{f.name}</span>
            </div>
          ))}
        </div>
        <div className="v-cards">
          <button className="v-card is-rec" type="button">
            <span className="ico">
              <TypeIcon type="text" />
            </span>
            <span>
              <h3>
                打标签 <kbd>T</kbd>
              </h3>
              <p>用已有标签归类，文件先入库，之后还能改。适合「先收进来再说」。</p>
            </span>
            <span className="v-badge">推荐</span>
          </button>
          <button className="v-card" type="button">
            <span className="ico">
              <TypeIcon type="folder" />
            </span>
            <span>
              <h3>
                放入文件柜 <kbd>C</kbd>
              </h3>
              <p>放到「春季活动」「工作台」这样的柜里，和手上的项目放在一起。</p>
            </span>
          </button>
          <button className="v-card" type="button">
            <span className="ico">
              <TypeIcon type="document" />
            </span>
            <span>
              <h3>
                仅导入 <kbd>I</kbd>
              </h3>
              <p>只入库，不打标签也不入柜。你之后在主窗里再整理。</p>
            </span>
          </button>
        </div>
        <label className="v-c-rem">
          <input type="checkbox" readOnly />
          记住这个选择，下次同类收纳直接执行
        </label>
      </div>
    );
  }

  if (variant === "inbox") {
    return (
      <div className={cls} data-testid="collect">
        <div className="v-in-head">
          <h2>
            待收纳<span>{files.length} 个文件</span>
          </h2>
          <span style={{ fontSize: "0.8em", color: "var(--text-muted)" }}>点左侧看预览，再选怎么收</span>
        </div>
        <div className="v-in-split">
          <div className="v-in-list">
            {files.map((f) => (
              <div key={f.id} className={`v-in-item${f.id === selected?.id ? " is-active" : ""}`}>
                <Swatch color={f.swatch} />
                <div>
                  <div className="n">{f.name}</div>
                  <div className="h">{f.hint}</div>
                </div>
              </div>
            ))}
          </div>
          {selected && (
            <div className="v-in-prev">
              {selected.type === "image" ? (
                <div className="v-in-art">
                  <Swatch color={selected.swatch} label="封面设计" large />
                </div>
              ) : (
                <div className="v-in-art is-doc">
                  <div className="doc-title">{selected.name.replace(/\.[^.]+$/, "")}</div>
                  <div>某某科技有限公司　·　已确认版本</div>
                  <div style={{ height: 6 }} />
                  <div>第一条　双方确认附件所示设计方案为最终交付。</div>
                  <div>第二条　付款节点与发票信息见同批「报价单」。</div>
                  <div>第三条　签字盖章页见第 2 页。</div>
                </div>
              )}
              <div style={{ fontSize: "0.8em", color: "var(--text-muted)", fontFamily: "var(--font-family-mono)" }}>
                {selected.path}
              </div>
            </div>
          )}
        </div>
        <div className="v-in-bar">
          <label className="v-c-rem">
            <input type="checkbox" readOnly />
            记住选择
          </label>
          <div className="v-c-acts">
            <button className="v-btn" type="button">
              仅导入
            </button>
            <button className="v-btn" type="button">
              放入文件柜
            </button>
            <button className="v-btn is-primary" type="button">
              打标签并收纳
            </button>
          </div>
        </div>
      </div>
    );
  }

  // steps — show step 2 (choose destination), the distinctive moment
  return (
    <div className={cls} data-testid="collect">
      <div className="v-steps">
        <span className="s">
          <span className="num">1</span>确认文件
        </span>
        <span className="line" />
        <span className="s is-on">
          <span className="num">2</span>选择归处
        </span>
        <span className="line" />
        <span className="s">
          <span className="num">3</span>完成
        </span>
      </div>
      <div className="v-step-body">
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.88em" }}>
          已确认 {files.length} 项。可以打标签、放入文件柜，或都跳过只入库。
        </p>
        <div className="v-dest">
          <div className="v-dest-card is-on">
            <h3>标签</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {ALL_TAGS.map((t) => (
                <span className="v-pill" key={t.name} style={t.name === "工作" ? { outline: "2px solid var(--accent-primary)" } : undefined}>
                  <i className="v-dot" style={{ background: t.color }} />
                  {t.name}
                  {t.name === "工作" ? " ✓" : ""}
                </span>
              ))}
            </div>
          </div>
          <div className="v-dest-card">
            <h3>文件柜（可选）</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {CABINETS.map((c) => (
                <span className="v-pill" key={c.id}>
                  <i className="v-dot" style={{ background: c.color }} />
                  {c.name}
                  <span style={{ color: "var(--text-faint)" }}>· {c.count}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="v-nav">
          <button className="v-btn" type="button">
            上一步
          </button>
          <div className="v-c-acts">
            <button className="v-btn" type="button">
              跳过，仅导入
            </button>
            <button className="v-btn is-primary" type="button">
              收纳到「工作」
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
