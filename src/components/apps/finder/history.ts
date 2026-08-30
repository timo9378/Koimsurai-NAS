/**
 * Finder 的上一頁／下一頁。
 *
 * 抽成純函式的理由不只是好測：原本同一份邏輯在 Finder.tsx 裡有**三份拷貝**
 * （工具列的按鈕、滑鼠側鍵、以及外部導航請求），每一份都自己判斷邊界、
 * 自己截斷 forward 那一段。三份要同時改對才不會出事。
 *
 * 邊界的規則跟瀏覽器一致：
 *   - 已經在最舊／最新的一筆時，上一頁／下一頁是 no-op
 *   - 從歷史中間導覽到新路徑，會截掉後面「可以前進」的那一段
 */

export interface NavHistory {
  /** 造訪過的路徑，舊 → 新。 */
  readonly entries: readonly string[];
  /** 目前停在第幾筆。 */
  readonly index: number;
}

export const initialHistory = (path = "/"): NavHistory => ({ entries: [path], index: 0 });

/** 目前所在的路徑；`entries` 空的或 index 越界時回 undefined。 */
export function currentPath(h: NavHistory): string | undefined {
  return h.entries[h.index];
}

export function canGoBack(h: NavHistory): boolean {
  return h.index > 0;
}

export function canGoForward(h: NavHistory): boolean {
  return h.index < h.entries.length - 1;
}

/**
 * 導覽到新路徑。
 *
 * ⚠️ 會截掉目前位置之後的紀錄——這就是瀏覽器的行為：上一頁幾次之後再點別的
 *    連結，原本能「前進」到的那些就沒了。
 */
export function pushPath(h: NavHistory, path: string): NavHistory {
  return { entries: [...h.entries.slice(0, h.index + 1), path], index: h.index + 1 };
}

/**
 * 上一頁。已經在最舊的一筆就**原封不動回傳同一個物件**——呼叫端可以用
 * `next === h` 判斷有沒有真的動，不必自己再檢查一次邊界。
 */
export function goBack(h: NavHistory): NavHistory {
  return canGoBack(h) ? { entries: h.entries, index: h.index - 1 } : h;
}

/** 下一頁。已經在最新的一筆就原封不動回傳同一個物件。 */
export function goForward(h: NavHistory): NavHistory {
  return canGoForward(h) ? { entries: h.entries, index: h.index + 1 } : h;
}
