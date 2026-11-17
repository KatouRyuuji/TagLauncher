// ============================================================================
// quick/QuickCollect.tsx — 快速窗的收纳模式（右键菜单 / 发送到，阶段③）
// ============================================================================
// 后端合并好的一批路径（CollectSession）→ 选动作：打标签… / 放入文件柜… / 仅导入；
// 含文件夹时选导入方式（与主窗导入对话框同义，夹内内容默认不铺满总览）；可勾选「记住本次选择」，
// 下次直接按它执行（顶部显示执行结果，可改回每次询问）。写入走 add_items + 导入上下文，
// 写后广播 window-data-written，主窗按 ID 增量刷新；data_sync 照常广播 data-changed。
// 键位：T 打标签 · C 文件柜 · I 仅导入 · Esc 取消；标签列表 ↑↓ 选择、Enter 勾选、Ctrl+Enter 收纳。
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import * as db from "../lib/db";
import { announceWindowWrite } from "../lib/dataSync";
import {
  collectableCabinets,
  collectContext,
  describeChoice,
  FOLDER_MODE_LABELS,
  pathName,
  planCollect,
  readFolderMode,
  toPreference,
  usablePreference,
  type CollectChoice,
  type CollectSession,
  type FolderMode,
} from "../lib/collect";
import type { Cabinet, Tag } from "../types";
import { stepIndex } from "./quickModel";
import { cabinetPathLabel } from "../lib/cabinetTree";
import { truncatePathMiddle } from "../lib/itemUtils";

type Step = "choose" | "tag" | "cabinet" | "running" | "done";

interface Outcome {
  text: string;
  created: number;
  existing: number;
  failed: number;
  auto: boolean;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 结果停留多久再收起（让用户看到结果；记住的选择多停一会儿，便于点「改为每次询问」） */
const DONE_MS = 900;
const AUTO_DONE_MS = 2500;

export function QuickCollect({ session, onClose }: { session: CollectSession; onClose: () => void }) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [cabinets, setCabinets] = useState<Cabinet[]>([]);
  const [folders, setFolders] = useState<string[] | null>(null);
  const [step, setStep] = useState<Step>("choose");
  const [folderMode, setFolderMode] = useState<FolderMode>(() => readFolderMode());
  const [remember, setRemember] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [filter, setFilter] = useState("");
  const [index, setIndex] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forgotten, setForgotten] = useState(false);
  const autoTried = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // 结果文字用的名称：记住的选择在读到标签/文件柜的同一回调里就执行，不能等状态提交
  const namesRef = useRef<{ tags: Tag[]; cabinets: Cabinet[] }>({ tags: [], cabinets: [] });

  const finish = useCallback((handled: number) => {
    void db.collectFinish(sessionRef.current.id, handled).catch(() => {}).finally(onClose);
  }, [onClose]);

  const execute = useCallback(async (choice: CollectChoice, auto: boolean, rememberIt: boolean) => {
    const paths = [...sessionRef.current.paths];
    setStep("running");
    setError(null);
    try {
      const classified = await db.classifyImportPaths(paths);
      let expanded: string[] = [];
      let truncated = false;
      if (classified.folders.length > 0 && choice.folderMode !== "folder") {
        const r = await db.expandFolderImport(paths);
        expanded = r.paths;
        truncated = r.truncated;
      }
      const plan = planCollect(classified, choice.folderMode, expanded);
      const res = await db.addItems(plan.paths, collectContext(choice, plan));
      if (rememberIt) await db.setCollectPreference(toPreference(choice, classified.folders.length > 0));
      const ids = res.items.map((item) => item.id);
      if (ids.length > 0) announceWindowWrite({ source: "quick", itemIds: ids, tagsChanged: false });
      const existing = res.items.length - res.createdCount;
      const parts = [`已${describeChoice(choice, namesRef.current.tags, namesRef.current.cabinets)}：新建 ${res.createdCount} 项`];
      if (existing > 0) parts.push(`已存在 ${existing} 项`);
      if (res.failed.length > 0) parts.push(`失败 ${res.failed.length} 项（${pathName(res.failed[0].path)}：${res.failed[0].error}）`);
      if (truncated) parts.push("文件夹很大，只导入了前 2000 个文件");
      setOutcome({ text: parts.join("，"), created: res.createdCount, existing, failed: res.failed.length, auto });
      setStep("done");
      window.setTimeout(() => finish(paths.length), auto ? AUTO_DONE_MS : DONE_MS);
    } catch (e) {
      setError(`收纳失败：${errorText(e)}`);
      setStep("choose");
    }
  }, [finish]);

  // 收纳时延埋点（E2E 读取）：会话每次到达/更新都记一次，startedMs 是后端收到首个调用的时刻
  useEffect(() => {
    const w = window as unknown as { __tlCollectPerf?: unknown[] };
    (w.__tlCollectPerf ??= []).push({
      id: session.id,
      count: session.paths.length,
      invocations: session.invocations,
      startedMs: session.startedMs,
      renderedMs: Date.now(),
    });
  }, [session.id, session.paths.length, session.invocations, session.startedMs]);

  // 会话到达 / 更新：读标签、文件柜、分类；有可用的记住选择时直接执行（每个会话只试一次）
  useEffect(() => {
    let disposed = false;
    void Promise.all([db.getTags(), db.getCabinets(), db.classifyImportPaths(session.paths), db.getCollectPreference()])
      .then(([t, c, cls, pref]) => {
        if (disposed) return;
        namesRef.current = { tags: t, cabinets: c };
        setTags(t);
        setCabinets(c);
        setFolders(cls.folders);
        if (autoTried.current === session.id) return;
        autoTried.current = session.id;
        const choice = usablePreference(pref, t, c);
        if (choice && session.paths.length > 0) void execute(choice, true, false);
      })
      .catch((e: unknown) => { if (!disposed) setError(`读取失败：${errorText(e)}`); });
    return () => { disposed = true; };
    // 只在会话换了或路径数变了时重读；session.paths 本身每次事件都是新数组
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, session.paths.length, execute]);

  useEffect(() => {
    if (step === "tag") filterRef.current?.focus();
    else if (step === "choose" || step === "cabinet") rootRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [step]);

  const choiceBase = { folderMode, tagIds: [] as number[], cabinetId: null as number | null };
  const cancel = () => finish(sessionRef.current.paths.length);
  const runImport = () => void execute({ ...choiceBase, action: "import" }, false, remember);
  const runTag = () => {
    if (picked.length > 0) void execute({ ...choiceBase, action: "tag", tagIds: picked }, false, remember);
  };
  const runCabinet = (id: number) => void execute({ ...choiceBase, action: "cabinet", cabinetId: id }, false, remember);

  const visibleTags = (() => {
    const q = filter.trim().toLowerCase();
    return q ? tags.filter((t) => t.name.toLowerCase().includes(q)) : tags;
  })();
  const targets = collectableCabinets(cabinets);
  const togglePick = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (step === "tag" || step === "cabinet") setStep("choose");
      else if (step === "choose") cancel();
      return;
    }
    if (step === "choose" && !event.ctrlKey && !event.altKey && !event.metaKey) {
      const k = event.key.toLowerCase();
      if (k === "t") { event.preventDefault(); setIndex(0); setStep("tag"); }
      else if (k === "c") { event.preventDefault(); setIndex(0); setStep("cabinet"); }
      else if (k === "i") { event.preventDefault(); runImport(); }
    }
  };

  const onTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((i) => stepIndex(visibleTags.length, Math.min(i, visibleTags.length - 1), event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) runTag();
      else {
        const tag = visibleTags[Math.min(index, visibleTags.length - 1)];
        if (tag) togglePick(tag.id);
      }
    }
  };

  const count = session.paths.length;
  const hasFolders = (folders?.length ?? 0) > 0;
  const busy = step === "running" || step === "done";

  return (
    <div className="quick-shell quick-collect" data-testid="quick-collect" data-session-id={session.id} ref={rootRef} onKeyDown={onKeyDown}>
      <div className="quick-collect-title" data-testid="collect-summary" data-count={count} data-invocations={session.invocations}>
        收纳 {count} 项{hasFolders ? `（含 ${folders!.length} 个文件夹）` : ""}
        {session.invocations > 1 && <span className="quick-collect-note">合并了 {session.invocations} 次右键调用</span>}
      </div>
      {(session.truncated || session.invalid > 0) && (
        <div className="quick-collect-note" data-testid="collect-warning">
          {session.truncated && "一次最多收纳 1000 项，其余已忽略。"}
          {session.invalid > 0 && `${session.invalid} 个路径不存在或无效，已忽略。`}
        </div>
      )}
      {count === 0 ? (
        <div className="quick-empty">没有可收纳的有效路径。</div>
      ) : step === "tag" ? (
        <div className="quick-picker" data-testid="collect-tag-picker">
          <div className="quick-picker-title">选标签（Enter 勾选，Ctrl+Enter 收纳，Esc 返回）</div>
          <input
            ref={filterRef}
            className="quick-input quick-input-small"
            aria-label="筛选标签"
            placeholder="筛选标签…"
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setIndex(0); }}
            onKeyDown={onTagKeyDown}
          />
          <ul role="listbox" aria-label="标签" aria-multiselectable="true" className="quick-list">
            {visibleTags.length === 0 && <li className="quick-empty">没有匹配的标签（新建标签请在主窗口操作）</li>}
            {visibleTags.slice(0, 80).map((tag, i) => (
              <li
                key={tag.id}
                role="option"
                aria-selected={i === index}
                aria-checked={picked.includes(tag.id)}
                data-testid="collect-tag-option"
                data-tag-id={tag.id}
                className="quick-row"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setIndex(i); togglePick(tag.id); }}
              >
                <span className="quick-check">{picked.includes(tag.id) ? "✓" : ""}</span>
                <span className="quick-tag-dot" style={{ background: tag.color }} />
                <span className="quick-name">{tag.name}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="quick-button quick-button-primary" data-testid="collect-confirm" disabled={picked.length === 0} onClick={runTag}>
            收纳并打上 {picked.length} 个标签
          </button>
        </div>
      ) : step === "cabinet" ? (
        <div className="quick-picker" data-testid="collect-cabinet-picker">
          <div className="quick-picker-title">放入哪个文件柜（关联目录柜由磁盘文件夹决定成员，不在此列）</div>
          <div className="quick-list">
            {targets.length === 0 && <div className="quick-empty">没有可放入的普通文件柜（请先在主窗口新建）</div>}
            {targets.map((c) => (
              <button key={c.id} type="button" className="quick-button quick-row-button" data-testid="collect-cabinet-option" data-cabinet-id={c.id} onClick={() => runCabinet(c.id)}>
                <span className="quick-tag-dot" style={{ background: c.color }} /> {cabinetPathLabel(cabinets, c.id)}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <ul className="quick-list quick-collect-paths" aria-label="待收纳">
            {session.paths.slice(0, 8).map((p) => (
              <li key={p} className="quick-row" data-testid="collect-path">
                <span className="quick-name" title={pathName(p)}>{pathName(p)}</span>
                <span className="quick-path" title={p}>{truncatePathMiddle(p)}</span>
              </li>
            ))}
            {count > 8 && <li className="quick-empty">…还有 {count - 8} 项</li>}
          </ul>
          {hasFolders && (
            <div role="radiogroup" aria-label="文件夹导入方式" className="quick-collect-modes">
              {(Object.keys(FOLDER_MODE_LABELS) as FolderMode[]).map((mode) => (
                <label key={mode}>
                  <input type="radio" name="collect-folder-mode" data-testid={`collect-folder-mode-${mode}`} checked={folderMode === mode} disabled={busy} onChange={() => setFolderMode(mode)} />
                  {FOLDER_MODE_LABELS[mode]}
                </label>
              ))}
            </div>
          )}
          <div className="quick-collect-actions">
            <button type="button" className="quick-button" data-testid="collect-action-tag" disabled={busy} onClick={() => { setIndex(0); setStep("tag"); }}>打标签…（T）</button>
            <button type="button" className="quick-button" data-testid="collect-action-cabinet" disabled={busy} onClick={() => { setIndex(0); setStep("cabinet"); }}>放入文件柜…（C）</button>
            <button type="button" className="quick-button" data-testid="collect-action-import" disabled={busy} onClick={runImport}>仅导入（I）</button>
          </div>
          <label className="quick-collect-remember">
            <input type="checkbox" data-testid="collect-remember" checked={remember} disabled={busy} onChange={(e) => setRemember(e.target.checked)} />
            记住本次选择（之后右键收纳直接执行，可在设置里改回）
          </label>
        </>
      )}
      <div className="quick-footer">
        {error ? (
          <span role="alert" className="quick-error" data-testid="collect-error">{error}</span>
        ) : outcome ? (
          <span role="status" data-testid="collect-result" data-created={outcome.created} data-existing={outcome.existing} data-failed={outcome.failed} data-auto={outcome.auto}>
            {outcome.auto && !forgotten ? "按记住的选择" : ""}{outcome.text}
            {outcome.auto && (forgotten ? "（已改为每次询问）" : (
              <button type="button" className="quick-button quick-link" data-testid="collect-forget" onClick={() => {
                void db.setCollectPreference(null).then(() => setForgotten(true)).catch(() => {});
              }}>改为每次询问</button>
            ))}
          </span>
        ) : step === "running" ? (
          <span>正在收纳…</span>
        ) : (
          <span className="quick-shortcuts" title="T 打标签 · C 放入文件柜 · I 仅导入 · Esc 取消">
            <span className="quick-kbd"><kbd>T</kbd>打标签</span>
            <span className="quick-kbd"><kbd>C</kbd>放入文件柜</span>
            <span className="quick-kbd"><kbd>I</kbd>仅导入</span>
            <span className="quick-kbd"><kbd>Esc</kbd>取消</span>
          </span>
        )}
      </div>
    </div>
  );
}
