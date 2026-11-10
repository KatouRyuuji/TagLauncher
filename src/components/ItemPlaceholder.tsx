// 分页视图中尚未取到数据的位置：按行高估计占住版面，取到后替换为真实卡片/行。
// data-item-placeholder 供 E2E 判断可视区是否已填满。
export function ItemPlaceholder({ height }: { height: number }) {
  return (
    <div
      data-item-placeholder=""
      aria-hidden="true"
      style={{ height }}
      className="animate-pulse rounded-[var(--radius-lg)] bg-[var(--bg-hover,rgba(127,127,127,0.08))]"
    />
  );
}
