export function FavoriteStar({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-full)] bg-[color-mix(in_srgb,var(--color-favorite)_14%,transparent)] text-[var(--color-favorite)]">
      <svg className="h-3.5 w-3.5 shrink-0" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
      </svg>
    </span>
  );
}
