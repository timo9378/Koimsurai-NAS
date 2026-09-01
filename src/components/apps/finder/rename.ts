/**
 * 重新命名的輸入判定。
 *
 * 抽成純函式的理由：這裡是一連串「什麼算取消、什麼算錯、什麼才送得出去」的
 * 判斷，而原本全寫在 `submitRename` 開頭的一個 `if` 裡：
 *
 * ```ts
 * if (!renamingFile || !renameValue || renameValue === renamingFile) { cancel }
 * ```
 *
 * 那一行有兩個問題：
 *
 * 1. **只有空字串算取消，全是空白的名稱會被送出去。** 使用者把名字整個刪掉
 *    再打幾個空白，就會建出一個叫 `"   "` 的檔案（或拿到一個籠統的失敗）。
 * 2. **完全不驗字元。** 含 `/` 的名稱會送到伺服器，被 `StorageRoot::resolve`
 *    以 403 擋下，而 UI 只會 `alert("Failed to rename file")` ——
 *    使用者不知道是哪裡不行。
 */

/** 檔名裡不能出現的字元。跟後端 `StorageRoot::resolve` 會拒絕的東西對齊。 */
const ILLEGAL = ["/", "\\", "\0"] as const;

export type RenamePlan =
  /** 什麼都不用做（沒改、或使用者清空了） */
  | { readonly kind: "cancel" }
  /** 名稱不合法，附一句可以直接顯示給使用者的說明 */
  | { readonly kind: "invalid"; readonly reason: string }
  /** 送得出去，`name` 是去掉前後空白之後的結果 */
  | { readonly kind: "rename"; readonly name: string };

/**
 * 決定一次重新命名該怎麼處理。
 *
 * @param current 目前的檔名（`null` 表示沒有在重新命名）
 * @param next 使用者輸入的新名稱
 */
export function planRename(current: string | null, next: string): RenamePlan {
  if (current === null) return { kind: "cancel" };

  // ⚠️ 一定要 trim。前後空白在大多數檔案系統上是合法的，但幾乎都是誤觸 ——
  // 而且 `"報告.txt "` 跟 `"報告.txt"` 在畫面上看起來一模一樣。
  const name = next.trim();

  // 清空 = 取消，不是「改成空字串」
  if (name === "") return { kind: "cancel" };
  if (name === current) return { kind: "cancel" };

  for (const ch of ILLEGAL) {
    if (name.includes(ch)) {
      const shown = ch === "\0" ? "NUL" : ch;
      return { kind: "invalid", reason: `名稱不能包含 ${shown}` };
    }
  }

  // ⚠️ "." 與 ".." 不是「奇怪的名字」，是路徑語意 —— 後端的 resolve 會把它們
  // 當成 Component::CurDir / ParentDir 而拒絕整個路徑。
  if (name === "." || name === "..") {
    return { kind: "invalid", reason: "名稱不能是 . 或 .." };
  }

  return { kind: "rename", name };
}
