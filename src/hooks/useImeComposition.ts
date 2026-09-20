import { useCallback, useRef } from "react";

/**
 * 过滤/搜索类输入的 IME 组合期守卫（与 SearchBar 同款口径）：
 * 组合中只更新显示文本、不触发过滤；compositionend 时才以最终文本过滤，
 * 列表不再随中间拼音串无意义抖动。
 *
 * 用法：
 *   const ime = useImeComposition<string>(applyFilter);
 *   <input value={text} onChange={(e) => { setText(e.target.value); ime.onChange(e.target.value); }}
 *          onCompositionStart={ime.onCompositionStart} onCompositionEnd={ime.onCompositionEnd} />
 */
export function useImeComposition<T>(apply: (value: T) => void) {
  const composingRef = useRef(false);
  const pendingRef = useRef<T | null>(null);

  const onCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const onCompositionEnd = useCallback(
    (event: React.CompositionEvent<HTMLInputElement>) => {
      composingRef.current = false;
      const value = (pendingRef.current ?? (event.currentTarget.value as unknown as T));
      pendingRef.current = null;
      apply(value);
    },
    [apply],
  );

  const onChange = useCallback(
    (value: T) => {
      if (composingRef.current) {
        pendingRef.current = value;
        return;
      }
      apply(value);
    },
    [apply],
  );

  return { onCompositionStart, onCompositionEnd, onChange, composingRef };
}
