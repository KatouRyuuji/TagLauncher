/** F04c：过滤范围说明 + 切换（当前层 ⇄ 全部标签） */
export function TagScopeNotice({ scope, scopeLabel, subtreeCount, globalCount, onGlobal, onSubtree }: {
  scope: "subtree" | "global";
  scopeLabel: string;
  subtreeCount: number;
  globalCount: number;
  onGlobal: () => void;
  onSubtree: () => void;
}) {
  const link = "font-medium text-[var(--accent-primary-ink)] underline-offset-2 hover:underline";
  return (
    <p data-testid="tag-scope-notice" data-scope={scope}
      className="mb-1 px-1.5 text-[length:calc(12px*var(--ui-font-scale,1))] leading-5 text-[var(--text-muted)]">
      {scope === "global" ? (
        <>在全部标签中：{globalCount} 个。<button type="button" className={link} onClick={onSubtree}>只看「{scopeLabel}」及下级</button></>
      ) : subtreeCount === 0 ? (
        globalCount > 0
          ? <>「{scopeLabel}」及下级中没有匹配；全部标签中有 {globalCount} 个。<button type="button" className={link} onClick={onGlobal}>在全部标签中查看（Enter）</button></>
          : <>没有匹配的标签。</>
      ) : (
        <>在「{scopeLabel}」及下级中：{subtreeCount} 个{globalCount > subtreeCount ? <>（全部 {globalCount} 个，<button type="button" className={link} onClick={onGlobal}>查看全部</button>）</> : null}。</>
      )}
    </p>
  );
}
