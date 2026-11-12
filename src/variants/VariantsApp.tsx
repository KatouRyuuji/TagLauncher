import { useEffect, useMemo, type ReactNode } from "react";
import { Collect, type CollectState, type CollectVariant } from "./Collect";
import { Handle, type HandleState, type HandleVariant } from "./Handle";
import { Pin, type PinVariant } from "./Pin";
import { Quick, type QuickState, type QuickVariant } from "./Quick";
import { applyVariantTheme, type ColorMode } from "./theme";

export type Surface = "quick" | "collect" | "pin" | "handle";

export interface VariantQuery {
  surface: Surface;
  variant: string;
  mode: ColorMode;
  font: 1 | 1.25;
  state: string;
  enter: boolean;
  desktop: boolean;
}

export function parseQuery(search = window.location.search): VariantQuery {
  const p = new URLSearchParams(search);
  const font = p.get("font") === "1.25" ? 1.25 : 1;
  const surface = (p.get("surface") || "quick") as Surface;
  return {
    surface,
    variant: p.get("variant") || "current",
    mode: p.get("mode") === "dark" ? "dark" : "light",
    font,
    state: p.get("state") || (surface === "quick" ? "results" : surface === "handle" ? "rest" : "home"),
    enter: p.get("enter") === "1",
    desktop: p.get("desktop") === "1" || surface === "handle",
  };
}

export function VariantsApp({ query }: { query?: VariantQuery }) {
  const q = useMemo(() => query ?? parseQuery(), [query]);

  useEffect(() => {
    applyVariantTheme(q.mode, q.font);
  }, [q.mode, q.font]);

  let panel: ReactNode = null;
  if (q.surface === "quick") {
    panel = <Quick variant={q.variant as QuickVariant} state={q.state as QuickState} enter={q.enter} />;
  } else if (q.surface === "collect") {
    panel = <Collect variant={q.variant as CollectVariant} state={q.state as CollectState} />;
  } else if (q.surface === "pin") {
    panel = <Pin variant={q.variant as PinVariant} />;
  }

  const bg = "/variants/desktop-light.png"; // Win11 壁纸不随应用深浅色切换

  return (
    <div
      className={`v-stage${q.desktop || q.surface === "handle" ? " is-desktop" : ""}`}
      data-mode={q.mode}
      data-surface={q.surface}
      data-variant={q.variant}
      data-font={q.font}
      data-state={q.state}
    >
      {(q.desktop || q.surface === "handle") && (
        <img className="v-desktop-bg" src={bg} alt="" />
      )}
      <div className="v-shot-target" data-testid="shot-target">
        {panel}
      </div>
      {q.surface === "handle" && <Handle variant={q.variant as HandleVariant} state={q.state as HandleState} />}
    </div>
  );
}
