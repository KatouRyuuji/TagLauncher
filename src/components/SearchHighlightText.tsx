import { useMemo } from "react";
import { splitHighlightSegments } from "../lib/searchHighlight";

interface SearchHighlightTextProps {
  text: string;
  query: string;
  className?: string;
}

export function SearchHighlightText({ text, query, className }: SearchHighlightTextProps) {
  const segments = useMemo(() => splitHighlightSegments(text, query), [text, query]);
  return (
    <span className={className}>
      {segments.map((segment, index) =>
        segment.highlighted ? (
          <mark key={index} className="search-highlight">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
}
