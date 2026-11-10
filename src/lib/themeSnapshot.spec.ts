import { describe, expect, it } from "vitest";
import { applyThemeSnapshot, captureThemeSnapshot, parseThemeSnapshot } from "./themeSnapshot";

describe("themeSnapshot", () => {
  it("捕获根元素变量与造型属性，套用到另一个根元素后一致，旧变量被清掉", () => {
    const main = document.createElement("div");
    main.style.setProperty("--bg-app", "#fff");
    main.style.setProperty("--text-primary", "#111");
    main.style.setProperty("color", "red");
    main.setAttribute("data-scheme", "light");
    main.setAttribute("data-theme-id", "sakura");
    const snap = captureThemeSnapshot(main);
    expect(snap).toEqual({
      vars: { "--bg-app": "#fff", "--text-primary": "#111" },
      attrs: { "data-scheme": "light", "data-theme-id": "sakura" },
    });

    const quick = document.createElement("div");
    quick.style.setProperty("--stale", "1");
    quick.setAttribute("data-shape", "b");
    applyThemeSnapshot(parseThemeSnapshot(JSON.stringify(snap))!, quick);
    expect(quick.style.getPropertyValue("--bg-app")).toBe("#fff");
    expect(quick.style.getPropertyValue("--stale")).toBe("");
    expect(quick.getAttribute("data-scheme")).toBe("light");
    expect(quick.hasAttribute("data-shape")).toBe(false);
  });

  it("损坏或夹带非法键的快照被过滤", () => {
    expect(parseThemeSnapshot("{bad")).toBeNull();
    expect(parseThemeSnapshot(null)).toBeNull();
    expect(parseThemeSnapshot(JSON.stringify({ vars: { color: "red", "--a": 1, "--b": "x" }, attrs: { onclick: "x" } })))
      .toEqual({ vars: { "--b": "x" }, attrs: {} });
  });
});
