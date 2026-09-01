/**
 * 位元組大小的顯示格式。
 *
 * ⚠️ 這支模組存在的理由：同樣的邏輯先前被**實作了七次**
 * （`u.$id`、`s.$id`、`Dashboard`、`DockerManager`、`FilePreview`、
 * `Settings`、`MobileLayout`），而且七份**互相不一致** ——
 * 同一個檔案在不同畫面會顯示 `1.5 MB`、`1.50 MB` 或 `1024 Bytes`。
 *
 * 除了 `DockerManager` 之外，其餘六份還共用同樣的三個 bug：
 *
 * ```text
 * 1 PiB   → "1 undefined"      單位表只到 TB，index 越界
 * -1      → "NaN undefined"    Math.log(負數) 是 NaN
 * NaN     → "NaN undefined"
 * ```
 *
 * 1 PiB 不是幻想：Dashboard 會把所有磁碟的 total_space 加總。
 */

/** 到 EB 為止。超過的話再往上是 ZB/YB，但那超出 `Number.MAX_SAFE_INTEGER` 的意義了。 */
const UNITS = ["B", "KB", "MB", "GB", "TB", "PB", "EB"] as const;

/** 資料無效時顯示的東西。⚠️ 不要顯示 `0 B` —— 那是在說謊，不是在說「不知道」。 */
const UNKNOWN = "—";

/**
 * 把位元組數格式化成人看得懂的字串。
 *
 * @param bytes 位元組數。非有限值或負數會回 `"—"`。
 * @param decimals 小數位數，預設 1。尾端的 `.0` 會被去掉（`1 KB` 而不是 `1.0 KB`）。
 */
export function formatBytes(bytes: number, decimals = 1): string {
  // ⚠️ 負數與 NaN 一定要先擋。`Math.log` 對它們回 NaN，接著 index 變 NaN、
  // `UNITS[NaN]` 是 undefined，畫面上就是字面的 "NaN undefined"。
  if (!Number.isFinite(bytes) || bytes < 0) return UNKNOWN;

  // ⚠️ 這裡原本還有一行 `if (bytes === 0) return "0 B";`。變異測試指出它是
  // **冗餘**的：`Math.log(0)` 是 -Infinity，被下面的 `Math.max(..., 0)`
  // 夾成 0，於是 exponent 是 0、值也是 0 —— 結果本來就是 "0 B"。
  // 原本那六份實作需要那道特判，是因為它們沒有夾取。

  // ⚠️ 一定要夾在單位表的範圍內。原本的六份實作沒夾，1 PiB 以上就變成
  // "1 undefined"。
  const exponent = Math.min(
    Math.max(Math.floor(Math.log(bytes) / Math.log(1024)), 0),
    UNITS.length - 1,
  );
  const value = bytes / 1024 ** exponent;

  // parseFloat 去掉尾端的零：1.0 → 1，1.50 → 1.5
  return `${parseFloat(value.toFixed(decimals))} ${UNITS[exponent]}`;
}
