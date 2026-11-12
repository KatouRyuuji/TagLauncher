import { splitHighlight } from "./data";

export function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitHighlight(text, query).map((p, i) =>
        p.hit ? (
          <mark key={i} className="v-mark">
            {p.t}
          </mark>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </>
  );
}
