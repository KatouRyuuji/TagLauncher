import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCardPointerHighlight } from "./useCardPointerHighlight";

describe("卡片指针描边", () => {
  let frames: Map<number, FrameRequestCallback>;
  let motion: MediaQueryList;
  let hover: MediaQueryList;
  let card: HTMLElement;

  beforeEach(() => {
    frames = new Map();
    let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    const media = (matches: boolean) => Object.assign(new EventTarget(), { matches }) as MediaQueryList;
    motion = media(false);
    hover = media(true);
    vi.stubGlobal("matchMedia", (query: string) => query.includes("reduced-motion") ? motion : hover);
    card = document.createElement("article");
    card.className = "item-card-render-scope";
    document.body.append(card);
  });

  afterEach(() => {
    card.remove();
    delete document.documentElement.dataset.shape;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function move(x: number) {
    card.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: 20 }));
  }

  function flushFrame() {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  }

  it("同一帧的高频输入只测量一次并使用最后一个坐标", () => {
    document.documentElement.dataset.shape = "b";
    const measure = vi.spyOn(card, "getBoundingClientRect");
    const { unmount } = renderHook(useCardPointerHighlight);
    for (let x = 0; x < 100; x++) move(x);
    expect(frames.size).toBe(1);
    expect(measure).not.toHaveBeenCalled();
    flushFrame();
    expect(measure).toHaveBeenCalledTimes(1);
    expect(card.style.getPropertyValue("--reveal-x")).toBe("99px");
    unmount();
  });

  it("纸面主题没有帧任务，切换主题和减少动态效果立即更新订阅", async () => {
    document.documentElement.dataset.shape = "a";
    const { unmount } = renderHook(useCardPointerHighlight);
    move(10);
    expect(frames.size).toBe(0);
    await act(async () => { document.documentElement.dataset.shape = "b"; });
    move(20);
    expect(frames.size).toBe(1);
    Object.defineProperty(motion, "matches", { value: true, configurable: true });
    motion.dispatchEvent(new Event("change"));
    expect(frames.size).toBe(0);
    move(30);
    expect(frames.size).toBe(0);
    unmount();
  });

  it("触摸环境和卸载后的指针移动不产生布局任务", () => {
    document.documentElement.dataset.shape = "b";
    Object.defineProperty(hover, "matches", { value: false, configurable: true });
    const { unmount } = renderHook(useCardPointerHighlight);
    move(10);
    expect(frames.size).toBe(0);
    Object.defineProperty(hover, "matches", { value: true });
    hover.dispatchEvent(new Event("change"));
    move(20);
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
    move(30);
    expect(frames.size).toBe(0);
  });
});
