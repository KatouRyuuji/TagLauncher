import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Item } from "../types";
import type { ItemVisual } from "./db";

const getVisual = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({ getItemVisual: getVisual }));
let cache: typeof import("./itemVisualCache");
let requests: { id: number; resolve: (value: ItemVisual) => void; reject: (error: Error) => void }[];
const item = (id: number): Item => ({ id, name: `Item ${id}`, path: `D:/item-${id}.exe`, type: "exe", created_at: "2026-01-01", is_favorite: false });
const finish = async (index: number, path = `D:/icon-${requests[index].id}.png`) => {
  const request = requests[index];
  request.resolve({ path: item(request.id).path, icon_path: path });
  await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(async () => {
  vi.resetModules();
  getVisual.mockReset();
  requests = [];
  getVisual.mockImplementation((id: number) => new Promise<ItemVisual>((resolve, reject) => requests.push({ id, resolve, reject })));
  cache = await import("./itemVisualCache");
});

describe("可见图标请求", () => {
  it("自定义图标、图片与失效对象直接返回，无需 IPC", () => {
    const listener = vi.fn();
    cache.subscribeItemVisual({ ...item(1), icon_path: "D:/custom.png" }, listener);
    cache.subscribeItemVisual({ ...item(2), type: "image" }, listener);
    cache.subscribeItemVisual({ ...item(3), is_missing: true }, listener);
    expect(listener.mock.calls).toEqual([["D:/custom.png"], [item(2).path], [null]]);
    expect(getVisual).not.toHaveBeenCalled();
  });

  it("同一对象的多个组件共享请求和完成后的缓存", async () => {
    const first = vi.fn(), second = vi.fn(), cached = vi.fn();
    const unsubscribe = cache.subscribeItemVisual(item(1), first);
    cache.subscribeItemVisual(item(1), second);
    expect(getVisual).toHaveBeenCalledTimes(1);
    unsubscribe();
    await finish(0);
    cache.subscribeItemVisual(item(1), cached);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("D:/icon-1.png");
    expect(cached).toHaveBeenCalledWith("D:/icon-1.png");
    expect(getVisual).toHaveBeenCalledTimes(1);
  });

  it("并发最多四个，离屏且尚未开始的任务撤销", async () => {
    const unsubscribers = Array.from({ length: 7 }, (_, i) => cache.subscribeItemVisual(item(i + 1), vi.fn()));
    expect(getVisual.mock.calls.map(([id]) => id)).toEqual([1, 2, 3, 4]);
    unsubscribers[4]();
    await finish(0);
    expect(getVisual.mock.calls.map(([id]) => id)).toEqual([1, 2, 3, 4, 6]);
    await finish(1);
    expect(getVisual.mock.calls.map(([id]) => id)).toEqual([1, 2, 3, 4, 6, 7]);
  });

  it("库刷新后旧请求不会覆盖新订阅", async () => {
    const old = vi.fn(), current = vi.fn();
    cache.subscribeItemVisual(item(1), old);
    cache.invalidateItemVisuals();
    cache.subscribeItemVisual(item(1), current);
    await finish(0, "D:/old.png");
    expect(old).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    await finish(1, "D:/new.png");
    expect(current).toHaveBeenCalledWith("D:/new.png");
    expect(old).toHaveBeenCalledWith("D:/new.png");
  });

  it("刷新图标时已挂载组件持续订阅，刷新后离屏仍能撤销排队请求", async () => {
    const listener = vi.fn();
    const unsubscribe = cache.subscribeItemVisual(item(1), listener);
    await finish(0);
    for (let id = 2; id <= 5; id++) cache.subscribeItemVisual(item(id), vi.fn());
    cache.invalidateItemVisuals();
    unsubscribe();
    await finish(1);
    expect(getVisual.mock.calls.filter(([id]) => id === 1)).toHaveLength(1);
  });

  it("对象路径改变时丢弃不匹配的响应", async () => {
    const listener = vi.fn();
    cache.subscribeItemVisual(item(1), listener);
    requests[0].resolve({ path: "D:/moved.exe", icon_path: "D:/moved.png" });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(null));
  });

  it("TTL 过期时仍有订阅，第二个组件与第一个接到同一新结果", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const first = vi.fn();
    const second = vi.fn();
    try {
      cache.subscribeItemVisual(item(1), first);
      await finish(0, "D:/icon-old.png");
      expect(first).toHaveBeenCalledWith("D:/icon-old.png");
      clock.mockReturnValue(1_000 + 5 * 60_000 + 1);
      cache.subscribeItemVisual(item(1), second);
      expect(getVisual).toHaveBeenCalledTimes(2);
      await finish(1, "D:/icon-new.png");
      expect(first).toHaveBeenCalledWith("D:/icon-new.png");
      expect(second).toHaveBeenCalledWith("D:/icon-new.png");
    } finally {
      clock.mockRestore();
    }
  });

  it("失败反馈类型图标，冷却结束后允许重试", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      const listener = vi.fn();
      cache.subscribeItemVisual(item(1), listener);
      requests[0].reject(new Error("file unavailable"));
      await vi.waitFor(() => expect(listener).toHaveBeenCalledWith(null));
      cache.subscribeItemVisual(item(1), vi.fn());
      expect(getVisual).toHaveBeenCalledTimes(1);
      clock.mockReturnValue(12000);
      cache.subscribeItemVisual(item(1), vi.fn());
      expect(getVisual).toHaveBeenCalledTimes(2);
    } finally { warning.mockRestore(); clock.mockRestore(); }
  });
});
