/**
 * 拖放移動的判定。
 *
 * 抽成純函式的理由：這裡決定的是「哪些檔案真的要搬、搬去哪」，而搬錯的
 * 後果是**檔案不見**（跑到使用者找不到的地方），不是畫面怪怪的。
 * 原本這段散在 `moveNamesToDir` / `handleMoveFiles` / `handleMoveToPath`
 * 三個函式裡，各自又手刻了一次相對路徑的相接。
 *
 * ⚠️ 這裡一律用**絕對路徑**（`/` 開頭）運算，只在最後轉成 API 要的相對形式。
 * 相對路徑的根是 `""`、絕對路徑的根是 `"/"`，兩種定義域混用是這個 codebase
 * 已經踩過的坑（見 `lib/paths.ts` 的 `dirName` 說明）。
 */

import { joinPath, toApiPath } from "@/lib/paths";

export type MovePlan =
  /** 沒有東西要搬 */
  | { readonly kind: "noop" }
  /** 送給 `POST /api/files/batch/move` 的東西（皆為 API 相對路徑） */
  | { readonly kind: "move"; readonly paths: string[]; readonly destination: string };

/**
 * @param names 目前目錄下被選取的檔名
 * @param currentDir 目前目錄的絕對路徑
 * @param destDir 目的地的絕對路徑
 */
export function planMove(names: readonly string[], currentDir: string, destDir: string): MovePlan {
  const dest = toApiPath(destDir);

  // 同一個目錄，不用搬
  if (dest === toApiPath(currentDir)) return { kind: "noop" };

  const paths: string[] = [];
  for (const name of new Set(names)) {
    const source = toApiPath(joinPath(currentDir, name));

    // 不能把一個資料夾搬進它自己
    if (source === dest) continue;

    // ⚠️ 也不能搬進**自己底下**的目錄。`mv a/b a/b/c` 在 Linux 上會回
    // EINVAL，所以不會真的弄壞檔案 —— 但使用者拿到的是一句籠統的
    // 「移動失敗」，而正確的處置是根本不要送出這種請求。
    if (dest.startsWith(`${source}/`)) continue;

    paths.push(source);
  }

  if (paths.length === 0) return { kind: "noop" };
  return { kind: "move", paths, destination: dest };
}
