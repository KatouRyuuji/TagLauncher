// ============================================================================
// components/WorkspaceScopeHeader.tsx — 主区顶部「当前范围」标题
// ============================================================================
// 空库由 App 用 allItems.length > 0 守卫（等同 libraryEmpty）；筛选后 0 项仍渲染，
// 空态面板在下方。状态从 store 派生，不写回。
// 「最近使用」视图标题行带「清除记录」。
// 选中关联文件夹的文件柜时多一行：面包屑、目录 / 平铺切换、「清理失效」「已忽略」与文件夹状态提示。
// ============================================================================

import { Fragment, useMemo } from "react";
import { ChevronRight, Eraser, FolderTree, History, Layers, Rows3, Square } from "lucide-react";
import { browseCrumbs, parentDir } from "../lib/cabinetBrowse";
import { IgnoredPathsButton } from "./IgnoredPathsButton";
import { resolveWorkspaceScope } from "../lib/workspaceScope";
import { hasChildCabinets } from "../lib/cabinetTree";
import { useAppStore } from "../stores/appStore";
import type { Cabinet } from "../types";

interface WorkspaceScopeHeaderProps {
  visibleCount: number;
  pending?: boolean;
  /** 关联柜当前浏览的目录；平铺、搜索或标签筛选时为 null */
  browseDir?: string | null;
  /** 关联柜内的失效对象 */
  missingIds?: number[];
  onCleanMissing?: (ids: number[]) => void;
  onClearRecent?: () => void;
}

export function WorkspaceScopeHeader({ visibleCount, pending = false, browseDir = null, missingIds = [], onCleanMissing, onClearRecent }: WorkspaceScopeHeaderProps) {
  const showFavorites = useAppStore((state) => state.showFavorites);
  const showRecent = useAppStore((state) => state.showRecent);
  const selectedCabinetId = useAppStore((state) => state.selectedCabinetId);
  const cabinets = useAppStore((state) => state.cabinets);
  const selectedTagIds = useAppStore((state) => state.selectedTagIds);
  const excludedTagIds = useAppStore((state) => state.excludedTagIds);
  const tags = useAppStore((state) => state.tags);
  const tagRelations = useAppStore((state) => state.tagRelations);
  const tagFilterMode = useAppStore((state) => state.tagFilterMode);
  const typeFilter = useAppStore((state) => state.typeFilter);
  // 直订阅 searchQuery：经 useSearch 会连坐 searchInputValue，每击键白跑一次 resolve
  const searchQuery = useAppStore((state) => state.searchQuery);
  const linkedCabinet = cabinets.find((cabinet) => cabinet.id === selectedCabinetId && cabinet.folder_path) ?? null;
  const showNestedContents = useAppStore((state) => state.showNestedContents);
  const setShowNestedContents = useAppStore((state) => state.setShowNestedContents);
  const libraryBrowseRoot = useAppStore((state) => state.libraryBrowseRoot);
  const cabinetOnlySelf = useAppStore((state) => state.cabinetOnlySelf);
  const setCabinetOnlySelf = useAppStore((state) => state.setCabinetOnlySelf);
  // 父柜（有子柜）视图：默认含全部子柜内容，可切「仅本柜」（F16）
  const parentCabinet = selectedCabinetId !== null && !showFavorites && !showRecent && hasChildCabinets(cabinets, selectedCabinetId);
  const inAll =
    !showFavorites && !showRecent && selectedCabinetId === null;

  const scope = useMemo(
    () =>
      resolveWorkspaceScope({
        showFavorites,
        showRecent,
        selectedCabinetId,
        cabinets,
        selectedTagIds,
        excludedTagIds,
        tags,
        tagRelations,
        tagFilterMode,
        typeFilter,
        searchQuery,
        visibleCount,
      }),
    [
      showFavorites,
      showRecent,
      selectedCabinetId,
      cabinets,
      selectedTagIds,
      excludedTagIds,
      tags,
      tagRelations,
      tagFilterMode,
      typeFilter,
      searchQuery,
      visibleCount,
    ],
  );

  return (
    <div data-region="scope-header" className="shrink-0 px-6 pt-5 pb-2">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[length:calc(22px*var(--ui-font-scale,1))] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">{scope.title}</h2>
        <span className="text-[length:calc(12px*var(--ui-font-scale,1))] tabular-nums text-[var(--text-muted)]">{pending ? "正在打开文件柜" : `${scope.count} 项`}</span>
        {scope.qualifiers.length > 0 && (
          <span className="text-[length:calc(13px*var(--ui-font-scale,1))] text-[var(--text-muted)]">{scope.qualifiers.join(" · ")}</span>
        )}
        {showRecent && onClearRecent && visibleCount > 0 && (
          <button
            type="button"
            onClick={onClearRecent}
            className="control-chip ml-auto h-7 min-h-7 shrink-0 gap-1.5 self-center px-2.5 text-[length:calc(13px*var(--ui-font-scale,1))]"
          >
            <History aria-hidden="true" size={14} strokeWidth={1.8} />
            清除记录
          </button>
        )}
        {parentCabinet && (
          <button
            type="button"
            data-testid="cabinet-only-self"
            aria-pressed={cabinetOnlySelf}
            title={cabinetOnlySelf ? "当前只显示本柜自己的对象；点此改为包含全部子柜" : "当前包含全部子柜的对象；点此改为只看本柜"}
            onClick={() => setCabinetOnlySelf(!cabinetOnlySelf)}
            className="control-chip ml-auto h-7 min-h-7 shrink-0 gap-1.5 self-center px-2.5 text-[length:calc(13px*var(--ui-font-scale,1))]"
          >
            {cabinetOnlySelf ? <Square aria-hidden="true" size={14} strokeWidth={1.8} /> : <Layers aria-hidden="true" size={14} strokeWidth={1.8} />}
            {cabinetOnlySelf ? "仅本柜" : "含子柜"}
          </button>
        )}
        {inAll && !libraryBrowseRoot && (
          <button
            type="button"
            aria-pressed={showNestedContents}
            onClick={() => setShowNestedContents(!showNestedContents)}
            className="control-chip ml-auto h-7 min-h-7 shrink-0 gap-1.5 self-center px-2.5 text-[length:calc(13px*var(--ui-font-scale,1))]"
          >
            {showNestedContents ? <FolderTree aria-hidden="true" size={14} strokeWidth={1.8} /> : <Rows3 aria-hidden="true" size={14} strokeWidth={1.8} />}
            {showNestedContents ? "隐藏目录内文件" : "显示目录内文件"}
          </button>
        )}
      </div>
      {linkedCabinet && (
        <LinkedCabinetBar
          cabinet={linkedCabinet}
          browseDir={browseDir}
          missingIds={missingIds}
          onCleanMissing={onCleanMissing}
        />
      )}
      {inAll && libraryBrowseRoot && <LibraryBrowseBar root={libraryBrowseRoot} />}
    </div>
  );
}

function folderNotice(cabinet: Cabinet): string | null {
  if (cabinet.folder_state === "offline") return "所在磁盘未接入，同步已暂停";
  if (cabinet.folder_state === "missing") return "关联文件夹不存在";
  if (cabinet.folder_truncated) return "文件夹内容超过 50000 项，只同步了一部分";
  return null;
}

function LinkedCabinetBar({
  cabinet,
  browseDir,
  missingIds,
  onCleanMissing,
}: {
  cabinet: Cabinet;
  browseDir: string | null;
  missingIds: number[];
  onCleanMissing?: (ids: number[]) => void;
}) {
  const cabinetFlat = useAppStore((state) => state.cabinetFlat);
  const setCabinetFlat = useAppStore((state) => state.setCabinetFlat);
  const setCabinetDir = useAppStore((state) => state.setCabinetDir);
  const root = cabinet.folder_path ?? "";
  const crumbs = browseDir !== null ? browseCrumbs(cabinet.name, root, browseDir) : null;
  const notice = folderNotice(cabinet);

  return (
    <div data-region="linked-cabinet-bar" className="mt-2 flex min-h-7 flex-wrap items-center gap-2 text-[length:calc(13px*var(--ui-font-scale,1))]">
      <nav aria-label="文件夹路径" title={root} className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-[var(--text-muted)]">
        {crumbs ? (
          crumbs.map((crumb, index) => (
            <Fragment key={crumb.dir ?? ""}>
              {index > 0 && <ChevronRight aria-hidden="true" size={13} strokeWidth={1.8} className="shrink-0 text-[var(--text-faint)]" />}
              {index === crumbs.length - 1 ? (
                <span aria-current="page" className="truncate font-medium text-[var(--text-primary)]">{crumb.label}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => setCabinetDir(crumb.dir)}
                  className="truncate rounded-[var(--radius-sm)] px-1 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                >
                  {crumb.label}
                </button>
              )}
            </Fragment>
          ))
        ) : (
          <span className="truncate">{cabinetFlat ? "平铺显示全部层级" : "在整个关联文件夹中查找"}</span>
        )}
      </nav>
      {notice && <span role="status" className="shrink-0 text-[var(--color-warning-ink)]">{notice}</span>}
      {missingIds.length > 0 && onCleanMissing && (
        <button
          type="button"
          onClick={() => onCleanMissing(missingIds)}
          className="control-chip h-7 min-h-7 shrink-0 gap-1.5 px-2.5 text-[length:calc(13px*var(--ui-font-scale,1))]"
        >
          <Eraser aria-hidden="true" size={14} strokeWidth={1.8} />
          清理失效（{missingIds.length}）
        </button>
      )}
      {root && <IgnoredPathsButton under={root} />}
      <button
        type="button"
        aria-pressed={cabinetFlat}
        onClick={() => setCabinetFlat(!cabinetFlat)}
        className="control-chip h-7 min-h-7 shrink-0 gap-1.5 px-2.5 text-[length:calc(13px*var(--ui-font-scale,1))]"
      >
        {cabinetFlat ? <FolderTree aria-hidden="true" size={14} strokeWidth={1.8} /> : <Rows3 aria-hidden="true" size={14} strokeWidth={1.8} />}
        {cabinetFlat ? "按目录浏览" : "平铺显示"}
      </button>
    </div>
  );
}

function folderLabel(path: string): string {
  const parent = parentDir(path);
  if (!parent) return path;
  return path.slice(parent.length).replace(/^\\/, "") || path;
}

function LibraryBrowseBar({ root }: { root: string }) {
  const libraryBrowseDir = useAppStore((state) => state.libraryBrowseDir);
  const setLibraryBrowseRoot = useAppStore((state) => state.setLibraryBrowseRoot);
  const setLibraryBrowseDir = useAppStore((state) => state.setLibraryBrowseDir);
  const crumbs = browseCrumbs(folderLabel(root), root, libraryBrowseDir);

  return (
    <div data-region="library-browse-bar" className="mt-2 flex min-h-7 flex-wrap items-center gap-2 text-[length:calc(13px*var(--ui-font-scale,1))]">
      <nav aria-label="文件夹路径" title={root} className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-[var(--text-muted)]">
        <button
          type="button"
          onClick={() => setLibraryBrowseRoot(null)}
          className="truncate rounded-[var(--radius-sm)] px-1 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        >
          全部项目
        </button>
        {crumbs.map((crumb) => (
          <Fragment key={crumb.dir ?? "root"}>
            <ChevronRight aria-hidden="true" size={13} strokeWidth={1.8} className="shrink-0 text-[var(--text-faint)]" />
            {crumb.dir === libraryBrowseDir || (crumb.dir === null && libraryBrowseDir === null) ? (
              <span aria-current="page" className="truncate font-medium text-[var(--text-primary)]">{crumb.label}</span>
            ) : (
              <button
                type="button"
                onClick={() => setLibraryBrowseDir(crumb.dir)}
                className="truncate rounded-[var(--radius-sm)] px-1 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                {crumb.label}
              </button>
            )}
          </Fragment>
        ))}
      </nav>
    </div>
  );
}
