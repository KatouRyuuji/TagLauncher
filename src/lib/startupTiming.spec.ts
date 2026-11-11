import { afterEach, describe, expect, it, vi } from "vitest";
import { FIRST_ITEMS_MARK, observeFirstItemPaint } from "./startupTiming";

const marks = () => performance.getEntriesByName(FIRST_ITEMS_MARK, "mark");

describe("observeFirstItemPaint", () => {
  afterEach(() => {
    performance.clearMarks(FIRST_ITEMS_MARK);
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("首个对象节点出现后的下一帧打一次 mark，之后不再重复", async () => {
    const stop = observeFirstItemPaint();
    expect(marks()).toHaveLength(0);
    const el = document.createElement("div");
    el.setAttribute("data-selectable-item-id", "1");
    document.body.appendChild(el);
    await vi.waitFor(() => expect(marks()).toHaveLength(1));
    const again = el.cloneNode() as HTMLElement;
    document.body.appendChild(again);
    await new Promise((r) => setTimeout(r, 50));
    expect(marks()).toHaveLength(1);
    stop();
  });

  it("没有对象时不打 mark；停止后再出现也不打", async () => {
    const stop = observeFirstItemPaint();
    document.body.appendChild(document.createElement("span"));
    await new Promise((r) => setTimeout(r, 30));
    expect(marks()).toHaveLength(0);
    stop();
    const el = document.createElement("div");
    el.setAttribute("data-selectable-item-id", "2");
    document.body.appendChild(el);
    await new Promise((r) => setTimeout(r, 50));
    expect(marks()).toHaveLength(0);
  });
});
