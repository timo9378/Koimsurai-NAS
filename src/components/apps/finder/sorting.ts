/**
 * Finder 檔案清單的用戶端排序與過濾。
 *
 * ⚠️ **這裡有兩套排序，而且它們不完全一致。**
 *
 * 一般檢視的排序是**後端**做的（`ORDER BY is_dir DESC, name COLLATE NOCASE`），
 * 因為分頁也是伺服器端的 —— 前端只拿得到一頁，對一頁排序等於排錯。
 * 這支模組只在**標籤檢視**用得到：那條路徑的資料來自 tag API，不分頁，
 * 所以排序落在前端。
 *
 * 兩者對齊的部分：資料夾優先、大小寫不敏感。
 * 兩者仍然不同的部分：CJK。`localeCompare` 用的是語言感知的定序
 * （中文按拼音），SQLite 的 `NOCASE` 只折疊 ASCII、CJK 仍是碼位順序。
 * 要完全一致得在後端引入 ICU，那是獨立的一件事。
 *
 * 修正之前差異更大 —— 後端是 BINARY 定序，`ABC` 跟 `abc` 中間隔著整個字母表。
 */

import type { FileInfo } from "@/types/api";

export type SortField = "name" | "size" | "modified";
export type SortDirection = "asc" | "desc";

/** 名稱包含（不分大小寫）。空查詢回原本的清單。 */
export function filterByQuery<T extends { name: string }>(files: readonly T[], query: string): T[] {
  // ⚠️ 這裡原本有一行 `if (needle === "") return [...files];`。變異測試指出它是
  // **冗餘**的：`includes("")` 對任何字串都是 true，空查詢本來就會全部通過。
  // （這是本輪第四個「加了正確的正規化之後，原本的特判就變成死碼」。）
  const needle = query.trim().toLowerCase();
  return files.filter((f) => f.name.toLowerCase().includes(needle));
}

/**
 * 排序。**資料夾永遠在前面**，而且不受升冪／降冪影響 ——
 * 那是檔案管理器的慣例，降冪時把資料夾丟到最後會很難用。
 */
export function sortFiles<T extends Pick<FileInfo, "name" | "size" | "modified" | "is_dir">>(
  files: readonly T[],
  field: SortField,
  direction: SortDirection,
): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...files].sort((a, b) => {
    // ⚠️ 資料夾優先要在方向翻轉**之外** —— 放進 comparison 裡的話降冪會
    // 把資料夾排到最後。
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
    return sign * compareBy(a, b, field);
  });
}

function compareBy(
  a: Pick<FileInfo, "name" | "size" | "modified">,
  b: Pick<FileInfo, "name" | "size" | "modified">,
  field: SortField,
): number {
  switch (field) {
    case "name":
      // ⚠️ sensitivity: "base" 讓它對大小寫與腔調不敏感，跟後端的
      // COLLATE NOCASE 對齊。沒有這個選項的話 "abc" 與 "ABC" 會被分開，
      // 而那正是後端先前的 bug。
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
    case "size":
      return a.size - b.size;
    case "modified":
      return timestamp(a.modified) - timestamp(b.modified);
  }
}

/**
 * ⚠️ 無效的日期要當成最舊，不能讓 `NaN` 流進比較函式。
 *
 * `new Date("爛字串").getTime()` 是 `NaN`，而回傳 `NaN` 的比較函式會讓
 * `Array.sort` 的結果變成實作定義的順序 —— 不會報錯，只是順序莫名其妙，
 * 而且在不同瀏覽器可能不一樣。
 */
function timestamp(value: string): number {
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}
