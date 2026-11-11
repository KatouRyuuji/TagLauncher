import { afterEach, describe, expect, it, vi } from "vitest";

const copied = vi.hoisted(() => ({ text: "", message: "" }));
vi.mock("./clipboard", () => ({
  copyText: vi.fn(async (text: string, message: string) => {
    copied.text = text;
    copied.message = message;
    return true;
  }),
}));

import { collectListDiagnostics, installListDiagHotkey } from "./listDiagnostics";

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as unknown as { __tlMainPerf?: unknown }).__tlMainPerf;
});

describe("列表诊断（F19 取证）", () => {
  it("没有列表时也返回视口信息", () => {
    const d = collectListDiagnostics();
    expect(d.list).toBeNull();
    expect(d.viewport.w).toBeGreaterThan(0);
  });

  it("Ctrl+Alt+Shift+L 复制 JSON，含虚拟器快照", () => {
    document.body.innerHTML = '<div style="overflow-y:auto"><div role="list" aria-label="项目列表"><div data-index="0"><span data-selectable-item-id="1">a</span></div></div></div>';
    (window as unknown as { __tlMainPerf: unknown }).__tlMainPerf = { stats: { listVirtual: () => ({ count: 1, items: [] }) } };
    const off = installListDiagHotkey();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "L", code: "KeyL", ctrlKey: true, altKey: true, shiftKey: true }));
    off();
    const data = JSON.parse(copied.text);
    expect(data.list.mode).toBe("list");
    expect(data.list.virtual).toEqual({ count: 1, items: [] });
    expect(copied.message).toContain("列表诊断");
  });

  it("其他组合键不触发", () => {
    copied.text = "";
    const off = installListDiagHotkey();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "l", code: "KeyL", ctrlKey: true, shiftKey: true }));
    off();
    expect(copied.text).toBe("");
  });
});
