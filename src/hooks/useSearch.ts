// ============================================================================
// hooks/useSearch.ts — 搜索防抖 Hook
// ============================================================================
// 对用户的搜索输入进行 150ms 防抖处理。
// 用户快速输入时不会频繁触发搜索，只在停止输入 150ms 后才更新 searchQuery。
// searchQuery 的变化会触发 useItems 中的 useMemo 重新计算搜索结果。
// ============================================================================

import { useCallback, useEffect, useRef } from "react";
import { useAppStore } from "../stores/appStore";

export function useSearch() {
  const searchQuery = useAppStore((state) => state.searchQuery);
  const setSearchQuery = useAppStore((state) => state.setSearchQuery);
  // 使用 ref 存储定时器 ID，避免组件重渲染时丢失
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  /**
   * 处理搜索输入（带 150ms 防抖）
   * 由 SearchBar 的 onChange 调用。清空时立即生效，避免 Escape 后待处理的防抖把词写回去。
   */
  const handleSearch = useCallback((value: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = undefined;
    }
    if (value === "") {
      setSearchQuery("");
      return;
    }
    debounceRef.current = setTimeout(() => {
      setSearchQuery(value);
    }, 150);
  }, [setSearchQuery]);

  // 组件卸载时清理定时器，防止内存泄漏
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return { searchQuery, handleSearch, setSearchQuery };
}
