// ============================================================================
// lib/modApi.spec.ts — Mod 写入事件（onModWrite）与面向 Mod 广播的分离回归
// ============================================================================
// 回归背景（S2）：宿主 App 桥接曾直接订阅 notifyItemsChanged 等广播，而宿主
// 自身刷新后也会触发同一广播，形成「刷新→广播→再刷新」的自维持无限回路。
// 修复后：Mod 写操作经 onModWrite 通知宿主刷新；notify*Changed 只面向 Mod。
// 另覆盖：写操作不直接广播（宿主刷新后统一广播一次，防双重通知）、
// 单条 launchItem 的启动事件契约（与批量/宿主一致）。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  modApi,
  notifyItemsChanged,
  onItemLaunched,
  onItemsChanged,
  onModWrite,
  registerModPermissions,
} from "./modApi";

const mockedInvoke = vi.mocked(invoke);

describe("Mod 写入事件与广播分离（S2 回归）", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  it("宿主广播 notifyItemsChanged 不触发 onModWrite（切断回路）", () => {
    const spy = vi.fn();
    const unsub = onModWrite(spy);
    try {
      notifyItemsChanged([]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      unsub();
    }
  });

  it("Mod 写操作（addTag）触发 onModWrite(\"tags\")", async () => {
    registerModPermissions("s2-test-mod", ["tags:write"]);
    const scope = modApi.createScope("s2-test-mod");
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "add_tag") return { id: 1, name: "t", color: "#ffffff" };
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const spy = vi.fn();
    const unsub = onModWrite(spy);
    try {
      await scope.addTag("t", "#ffffff");
      expect(spy).toHaveBeenCalledWith("tags");
    } finally {
      unsub();
    }
  });

  it("Mod 写操作不再直接向 Mod 广播（统一由宿主刷新后广播，防双重通知）", async () => {
    registerModPermissions("s2-test-mod-bcast", ["items:write"]);
    const scope = modApi.createScope("s2-test-mod-bcast");
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "add_item") return { id: 1 };
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const itemsSpy = vi.fn();
    const writeSpy = vi.fn();
    const unsubItems = onItemsChanged(itemsSpy);
    const unsubWrite = onModWrite(writeSpy);
    try {
      await scope.addItem("C:\\x.exe");
      expect(writeSpy).toHaveBeenCalledWith("items");
      // 未经宿主刷新桥接时不得直接广播（生产环境由宿主刷新后统一广播一次）
      expect(itemsSpy).not.toHaveBeenCalled();
    } finally {
      unsubItems();
      unsubWrite();
    }
  });

  it("单条 launchItem 成功后派发 notifyItemLaunched（与批量/宿主一致）", async () => {
    registerModPermissions("s2-test-mod-launch", ["launch"]);
    const scope = modApi.createScope("s2-test-mod-launch");
    mockedInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === "launch_item") return undefined;
      if (cmd === "get_item") return { id: 7, name: "微信" };
      throw new Error(`unexpected invoke: ${cmd}`);
    });

    const spy = vi.fn();
    const unsub = onItemLaunched(spy);
    try {
      await scope.launchItem(7);
      expect(spy).toHaveBeenCalledWith(7, "微信");
    } finally {
      unsub();
    }
  });
});
