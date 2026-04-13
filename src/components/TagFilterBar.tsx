// ============================================================================
// components/TagFilterBar.tsx — 标签快速筛选条
// ============================================================================
// 显示在搜索栏下方，横向排列所有标签。
// 点击标签切换选中状态（支持多选），选中的标签用于 AND 筛选。
// 点击"全部"清空所有标签选择。
// 无标签时不渲染。
// ============================================================================

import { useAppStore } from "../stores/appStore";

export function TagFilterBar() {
  const { tags, selectedTagIds, toggleTagSelection, setSelectedTagIds } = useAppStore();

  // 没有标签时不显示筛选条
  if (tags.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 border-b border-white/[0.06] overflow-x-auto shrink-0">
      {/* "全部"按钮：清空标签选择 */}
      <button
        onClick={() => setSelectedTagIds([])}
        className={`shrink-0 px-2.5 py-1 rounded-full text-xs transition-all ${
          selectedTagIds.length === 0
            ? "bg-white/[0.12] text-white"
            : "bg-white/[0.04] text-white/40 hover:bg-white/[0.08] hover:text-white/60"
        }`}
      >
        全部
      </button>
      {/* 标签按钮列表 */}
      {tags.map((tag) => {
        const active = selectedTagIds.includes(tag.id);
        return (
          <button
            key={tag.id}
            onClick={() => toggleTagSelection(tag.id)}
            className={`shrink-0 px-2.5 py-1 rounded-full text-xs transition-all flex items-center gap-1.5 ${
              active
                ? "ring-1 ring-white/20"
                : "hover:brightness-125"
            }`}
            style={{
              // 选中时颜色更深（40% 不透明度），未选中时较浅（1a ≈ 10%）
              backgroundColor: active ? tag.color + "40" : tag.color + "1a",
              color: active ? tag.color : tag.color + "aa",
            }}
          >
            {/* 标签颜色圆点 */}
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
            {tag.name}
          </button>
        );
      })}
    </div>
  );
}
