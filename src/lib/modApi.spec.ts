// ============================================================================
// lib/modApi.spec.ts — Mod 写入事件（onModWrite）与面向 Mod 广播的分离回归
// ============================================================================
// 回归背景（S2）：宿主 App 桥接曾直接订阅 notifyItemsChanged 等广播，而宿主
// 自身刷新后也会触发同一广播，形成「刷新→广播→再刷新」的自维持无限回路。
// 修复后：Mod 写操作经 onModWrite 通知宿主刷新；notify*Changed 只面向 Mod。
// ============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  modApi,
  notifyItemsChanged,
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
      if (cmd === "get_tags") return [];
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
});
