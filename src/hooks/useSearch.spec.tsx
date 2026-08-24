// ============================================================================
// src/hooks/useSearch.spec.tsx — 搜索防抖与"待生效"指示状态测试
// ============================================================================
// 验证：即时输入值（inputValue）每次按键立即更新；searchQuery 经 150ms 防抖收敛；
// inputValue !== searchQuery 即"防抖待生效"，是 StatusBar 搜索指示的判定依据。
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSearch } from "./useSearch";
import { useAppStore } from "../stores/appStore";

describe("useSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState({ searchQuery: "", searchInputValue: "" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("输入立即更新 inputValue，searchQuery 在 150ms 防抖后才生效", () => {
    const { result } = renderHook(() => useSearch());

    act(() => { result.current.handleSearch("忍者"); });

    expect(result.current.inputValue).toBe("忍者");
    expect(result.current.searchQuery).toBe("");
    expect(result.current.inputValue).not.toBe(result.current.searchQuery);

    act(() => { vi.advanceTimersByTime(150); });

    expect(result.current.searchQuery).toBe("忍者");
    expect(result.current.inputValue).toBe("忍者");
  });

  it("连续输入只以最后一次为准，期间始终处于待生效状态", () => {
    const { result } = renderHook(() => useSearch());

    act(() => { result.current.handleSearch("a"); });
    act(() => { vi.advanceTimersByTime(100); });
    act(() => { result.current.handleSearch("ab"); });
    act(() => { vi.advanceTimersByTime(100); });

    // 第一次的定时器已被清除，searchQuery 尚未生效
    expect(result.current.searchQuery).toBe("");
    expect(result.current.inputValue).toBe("ab");

    act(() => { vi.advanceTimersByTime(50); });

    expect(result.current.searchQuery).toBe("ab");
  });

  it("清空输入立即生效，不留待生效状态（Escape 后防抖不得把旧词写回）", () => {
    const { result } = renderHook(() => useSearch());

    act(() => { result.current.handleSearch("游戏"); });
    act(() => { result.current.handleSearch(""); });

    expect(result.current.searchQuery).toBe("");
    expect(result.current.inputValue).toBe("");

    // 之前的防抖定时器已清除，时间推进后旧词不会复活
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current.searchQuery).toBe("");
  });

  it("直接 setSearchQuery（快捷键清空等路径）同步 inputValue，指示不误亮", () => {
    const { result } = renderHook(() => useSearch());

    act(() => { result.current.handleSearch("旧词"); });
    act(() => { vi.advanceTimersByTime(150); });
    act(() => { useAppStore.getState().setSearchQuery(""); });

    expect(useAppStore.getState().searchQuery).toBe("");
    expect(useAppStore.getState().searchInputValue).toBe("");
    expect(result.current.inputValue).toBe(result.current.searchQuery);
  });
});
