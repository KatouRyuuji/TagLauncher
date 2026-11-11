import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DATA_CHANGED_EVENT,
  EXTERNAL_RELOAD_COALESCE_MS,
  onAnyDataChanged,
  onExternalDataChanged,
  onWindowDataWritten,
  WINDOW_DATA_WRITTEN_EVENT,
  type DataChangedPayload,
} from "./dataSync";

const bus = vi.hoisted(() => ({
  handlers: new Map<string, Set<(e: { payload: unknown }) => void>>(),
  unlistened: 0,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, handler: (e: { payload: unknown }) => void) => {
    if (!bus.handlers.has(name)) bus.handlers.set(name, new Set());
    bus.handlers.get(name)!.add(handler);
    return () => { bus.unlistened += 1; bus.handlers.get(name)!.delete(handler); };
  }),
}));

function emit(payload: DataChangedPayload) {
  bus.handlers.get(DATA_CHANGED_EVENT)?.forEach((h) => h({ payload }));
}
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => { bus.handlers.clear(); bus.unlistened = 0; vi.useRealTimers(); });

describe("onExternalDataChanged", () => {
  it("外部写入回调一次，本应用写入不回调", async () => {
    const handler = vi.fn();
    const stop = onExternalDataChanged(handler);
    await flush(); await flush();
    emit({ origin: "app", seq: 1, detectedAtMs: 1 });
    await new Promise((r) => setTimeout(r, EXTERNAL_RELOAD_COALESCE_MS + 10));
    expect(handler).not.toHaveBeenCalled();
    emit({ origin: "external", seq: 2, detectedAtMs: 2 });
    emit({ origin: "external", seq: 3, detectedAtMs: 3 });
    await new Promise((r) => setTimeout(r, EXTERNAL_RELOAD_COALESCE_MS + 10));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].seq).toBe(3);
    stop();
    expect(bus.unlistened).toBe(1);
  });

  it("注册完成前取消：注册后立即停掉，不泄漏监听", async () => {
    const handler = vi.fn();
    const stop = onExternalDataChanged(handler);
    stop();
    await flush(); await flush(); await flush();
    expect(bus.unlistened).toBe(1);
    emit({ origin: "external", seq: 1, detectedAtMs: 1 });
    await new Promise((r) => setTimeout(r, EXTERNAL_RELOAD_COALESCE_MS + 10));
    expect(handler).not.toHaveBeenCalled();
  });

  it("取消时丢弃尚未触发的合并回调", async () => {
    const handler = vi.fn();
    const stop = onExternalDataChanged(handler);
    await flush(); await flush();
    emit({ origin: "external", seq: 1, detectedAtMs: 1 });
    stop();
    await new Promise((r) => setTimeout(r, EXTERNAL_RELOAD_COALESCE_MS + 10));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("onAnyDataChanged（快速搜索窗）", () => {
  it("本应用与外部写入都回调，并合并同一轮", async () => {
    const handler = vi.fn();
    const stop = onAnyDataChanged(handler);
    await flush(); await flush();
    emit({ origin: "app", seq: 1, detectedAtMs: 1 });
    emit({ origin: "external", seq: 2, detectedAtMs: 2 });
    await new Promise((r) => setTimeout(r, EXTERNAL_RELOAD_COALESCE_MS + 10));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].seq).toBe(2);
    emit({ origin: "app", seq: 3, detectedAtMs: 3 });
    await new Promise((r) => setTimeout(r, EXTERNAL_RELOAD_COALESCE_MS + 10));
    expect(handler).toHaveBeenCalledTimes(2);
    stop();
  });
});

describe("onWindowDataWritten", () => {
  it("忽略本窗口自己发出的写入，清洗对象 ID", async () => {
    const handler = vi.fn();
    const stop = onWindowDataWritten("main", handler);
    await flush(); await flush();
    const send = (payload: unknown) => bus.handlers.get(WINDOW_DATA_WRITTEN_EVENT)?.forEach((h) => h({ payload }));
    send({ source: "main", itemIds: [1], tagsChanged: false });
    expect(handler).not.toHaveBeenCalled();
    send({ source: "quick", itemIds: [3, "x", 4], tagsChanged: 1 });
    expect(handler).toHaveBeenCalledWith({ source: "quick", itemIds: [3, 4], tagsChanged: true });
    stop();
    expect(bus.unlistened).toBe(1);
  });
});
