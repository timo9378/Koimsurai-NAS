/**
 * 後端的 `modified` 是 **Unix 秒的字串**，不是日期字串。
 *
 * ⚠️ `list_files` 與 `list_trash` 送的都是 `timestamp().to_string()`，
 * 也就是 `"1782355562"` 這種東西。而 `new Date("1782355562")` 在 JS 裡是
 * **Invalid Date**（不是 1970 年，是直接無效）—— 於是畫面上每一個「Modified」
 * 都印著「Invalid Date」，而「依修改時間排序」因為每一項都拿到 NaN 而完全
 * 沒有作用。四個渲染點與排序模組各自呼叫 `new Date()`，沒有人發現。
 *
 * 型別上它只是 `string`，所以 TypeScript 幫不上忙。這個模組就是那個唯一的入口。
 */

/** 全是數字的字串（Unix 秒）。負號也允許，1970 之前的檔案是有可能的。 */
const NUMERIC = /^-?\d+$/;

/**
 * 解析後端給的時間值。認得三種：Unix 秒的字串、數字、以及 ISO/RFC 3339 字串
 * （後端哪天改成送正常的日期字串時不會再壞一次）。無法解析時回 `null`。
 */
export function parseApiTimestamp(value: string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? new Date(value * 1000) : null;
  }

  const trimmed = value.trim();
  if (NUMERIC.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 給排序用的毫秒數。解不出來的排最後面（`-Infinity`）。 */
export function timestampOf(value: string | number | null | undefined): number {
  return parseApiTimestamp(value)?.getTime() ?? -Infinity;
}

/** 日期＋時間。解不出來時回 `—`，不要讓「Invalid Date」出現在畫面上。 */
export function formatDateTime(value: string | number | null | undefined): string {
  return parseApiTimestamp(value)?.toLocaleString() ?? "—";
}

/** 只有日期。 */
export function formatDate(value: string | number | null | undefined): string {
  return parseApiTimestamp(value)?.toLocaleDateString() ?? "—";
}
