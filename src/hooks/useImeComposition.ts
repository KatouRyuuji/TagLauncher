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

  const onCompositionStart = useCallback(() => {
    composingRef.current = true;
  }, []);

  const onCompositionEnd = useCallback(
    (event: React.CompositionEvent<HTMLInputElement>) => {
      composingRef.current = false;
      // 恒取已提交文本（currentTarget.value 此时已是上屏结果）；
      // 组合期 onChange 存下的中间拼音串不能用来过滤
      apply(event.currentTarget.value as unknown as T);
    },
    [apply],
  );

  const onChange = useCallback(
    (value: T) => {
      // 组合期只更新显示文本、不触发过滤；compositionend 时以最终文本过滤
      if (composingRef.current) return;
      apply(value);
    },
    [apply],
  );

  return { onCompositionStart, onCompositionEnd, onChange, composingRef };
}
