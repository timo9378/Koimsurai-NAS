import { joinPath, toApiPath } from "@/lib/paths";

/**
 * Finder 的剪貼簿（複製／剪下 → 貼上）。
 *
 * ⚠️ 判定跟 `finder/move.ts` 同一個定義域：一律用**絕對路徑**運算，只在最後
 * 轉成 API 要的相對形式。這裡刻意不重用 `planMove` —— 它的輸入是「目前目錄
 * 下的檔名」，而剪貼簿裡放的是複製當下的**完整路徑**，貼上時使用者可能早就
 * 換到別的目錄了。輸入不同，硬共用只會讓兩邊都變難懂。
 */

export type ClipboardMode = "copy" | "cut";

export interface ClipboardEntry {
  readonly mode: ClipboardMode;
  /** 複製／剪下當下的絕對路徑 */
  readonly paths: readonly string[];
}

export type PastePlan =
  /** 沒有東西可以貼，或貼了等於沒貼 */
  | { readonly kind: "noop"; readonly reason: "empty" | "same-dir" | "into-self" }
  /** 送給 `/api/files/batch/{copy,move}` 的東西（皆為 API 相對路徑） */
  | {
      readonly kind: "paste";
      readonly mode: ClipboardMode;
      readonly paths: string[];
      readonly destination: string;
    };

/**
 * @param entry 剪貼簿內容
 * @param destDir 要貼進去的目錄（絕對路徑）
 */
export function planPaste(entry: ClipboardEntry | null, destDir: string): PastePlan {
  if (!entry || entry.paths.length === 0) return { kind: "noop", reason: "empty" };

  const dest = toApiPath(destDir);
  const paths: string[] = [];

  for (const path of new Set(entry.paths)) {
    const source = toApiPath(path);

    // 不能貼進自己
    if (source === dest) return { kind: "noop", reason: "into-self" };

    // ⚠️ 也不能貼進**自己底下**。複製的話 `copy_recursive` 會一邊讀一邊往裡面
    // 寫（後端已經擋了，但不該送出這種請求）；剪下的話 `mv a a/b` 會 EINVAL。
    if (dest.startsWith(`${source}/`)) return { kind: "noop", reason: "into-self" };

    paths.push(source);
  }

  // 剪下到原本的目錄等於沒動作。複製到同一個目錄是有意義的
  // （會產生「名字 (1)」），所以只擋剪下。
  if (entry.mode === "cut" && paths.every((p) => toApiPath(parentOf(p)) === dest)) {
    return { kind: "noop", reason: "same-dir" };
  }

  return { kind: "paste", mode: entry.mode, paths, destination: dest };
}

/** API 相對路徑的父目錄。`"a.txt"` → `""`（根）。 */
function parentOf(apiPath: string): string {
  const i = apiPath.lastIndexOf("/");
  return i === -1 ? "" : apiPath.slice(0, i);
}

/** 目前目錄下選取的檔名 → 剪貼簿要記的絕對路徑。 */
export function clipboardPaths(names: readonly string[], currentDir: string): string[] {
  return [...new Set(names)].map((name) => joinPath(currentDir, name));
}
