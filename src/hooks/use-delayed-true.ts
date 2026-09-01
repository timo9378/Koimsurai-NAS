import { useEffect, useState } from "react";

/**
 * `value` 變成 true 並**維持** `delayMs` 之後才回 true；變回 false 時立刻回 false。
 *
 * ⚠️ 用途是「不要為了一瞬間的狀態閃一下」。WebSocket 斷線後 3 秒會自動重連，
 * 沒有這個延遲的話每次瞬斷都會閃出一個「離線」，比不顯示還吵。
 * 反方向要立即 —— 恢復連線是好消息，沒有理由讓使用者多等。
 */
export function useDelayedTrue(value: boolean, delayMs: number): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    // ⚠️ `!value` 這條直接 return，不在 effect 裡同步 setState —— 回傳值靠底下的
    // `value && elapsed` 就夠了。重設放在 cleanup，這樣下一次變 true 才會重新計時。
    if (!value) return;

    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [value, delayMs]);

  return value && elapsed;
}
