import type { FileType } from "./data";

export function TypeIcon({ type, color, size = 22 }: { type: FileType; color?: string; size?: number }) {
  const c = color ?? "currentColor";
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": true as const };
  if (type === "image") {
    return (
      <svg {...common}>
        <rect x="3" y="5" width="18" height="14" rx="2.5" stroke={c} strokeWidth="1.6" />
        <circle cx="9" cy="10" r="1.6" fill={c} />
        <path d="M7 16.5 11 12l3 3 2-2 4 3.5" stroke={c} strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "spreadsheet") {
    return (
      <svg {...common}>
        <rect x="4" y="3" width="16" height="18" rx="2" stroke={c} strokeWidth="1.6" />
        <path d="M4 9h16M4 14h16M10 9v12" stroke={c} strokeWidth="1.5" />
      </svg>
    );
  }
  if (type === "text") {
    return (
      <svg {...common}>
        <path d="M7 3.5h7l6 6V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z" stroke={c} strokeWidth="1.6" />
        <path d="M14 3.5V9h6M8.5 13h7M8.5 16.5h5" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "folder") {
    return (
      <svg {...common}>
        <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z" stroke={c} strokeWidth="1.6" />
      </svg>
    );
  }
  if (type === "script") {
    return (
      <svg {...common}>
        <rect x="5" y="3.5" width="14" height="17" rx="2" stroke={c} strokeWidth="1.6" />
        <path d="M9 9.5h6M9 13h4" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "link") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" stroke={c} strokeWidth="1.6" />
        <path d="M9 12h6M12 9v6" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  // document / pdf
  return (
    <svg {...common}>
      <path d="M7 3.5h7l6 6V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z" stroke={c} strokeWidth="1.6" />
      <path d="M14 3.5V9h6" stroke={c} strokeWidth="1.6" />
    </svg>
  );
}

export function Swatch({ color, label, large = false }: { color: string; label?: string; large?: boolean }) {
  return (
    <div
      className={`v-swatch${large ? " is-large" : ""}`}
      style={{ background: `linear-gradient(145deg, ${color}, color-mix(in srgb, ${color} 65%, #111))` }}
      aria-hidden
    >
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export function SearchGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16 16.5 20 20.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
