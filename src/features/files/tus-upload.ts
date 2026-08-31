/**
 * tus 1.0.0 的上傳客戶端（`tus-js-client`）。
 *
 * 取代手刻的 `/api/upload/init` + `PATCH /api/upload/session/{id}`。
 * 換掉它拿到的不只是「用套件而不是手刻」：
 *
 * - **關掉瀏覽器再打開也能續傳。** 手刻版的 `upload_id` 只活在 zustand 的
 *   store 裡（記憶體），重新整理就沒了，只能整份重傳。tus-js-client 把上傳
 *   URL 存進 localStorage 並用檔案指紋比對，跨分頁、跨工作階段都找得回來。
 * - **自動重試**（`retryDelays`），而且退避是協定層定義好的。
 * - **offset 由伺服器說了算**：每次續傳前先 HEAD 問一次，不再依賴客戶端
 *   自己記到哪 —— 那正是手刻版踩過的 bug（`Math.floor(offset / chunkSize)`
 *   把位置退回分塊開頭，重送已經寫進去的位元組）。
 */

import * as tus from "tus-js-client";

import { CHUNK_SIZE } from "./chunk-plan";

/** 要跟後端 `handlers/tus.rs` 的 `BASE_PATH` 一致。 */
export const TUS_ENDPOINT = "/api/tus";

/**
 * Finder 的目前路徑 → tus metadata 要的父目錄。
 *
 * ⚠️ 後端會把 `path` 與 `filename` 接起來再走 `StorageRoot::resolve`，
 * 所以這裡只需要去掉開頭的斜線；`"/"` 代表根目錄，要變成空字串而不是 `"/"`
 * （後者接起來會變成 `"//檔名"`，雖然 resolve 擋得住，但那是靠運氣）。
 */
export function normalizeParentPath(currentPath: string): string {
  // ⚠️ 這裡原本有一行 `if (currentPath === "/" || currentPath === "") return "";`。
  // 變異測試指出它是**冗餘**的（六個突變全部存活）—— `"/"` 經過下面兩個
  // replace 本來就會變成 `""`，`""` 也是。刪掉之後行為完全一樣，
  // 少了一條永遠走不到的分支。
  return currentPath.replace(/^\/+/, "").replace(/\/+$/, "");
}

export interface TusUploadHandlers {
  /** 0–100 */
  readonly onProgress: (percent: number) => void;
  /** 伺服器給的上傳 URL —— 存起來就能續傳 */
  readonly onUrl: (url: string) => void;
  readonly onSuccess: () => void;
  readonly onError: (error: Error) => void;
}

/**
 * 建出要給 `tus.Upload` 的設定。
 *
 * 抽成純函式的理由跟 `finder/marquee.ts` 一樣：這裡的正確性全在幾個常數與
 * 一行進度換算上，而它們埋在 `new tus.Upload({...})` 的物件字面裡既看不出來
 * 也測不到。抽出來之後定樁測得到，變異測試也咬得住。
 */
export function buildTusOptions(
  file: File,
  currentPath: string,
  handlers: TusUploadHandlers,
): tus.UploadOptions {
  return {
    endpoint: TUS_ENDPOINT,
    // ⚠️ 一定要給有限的 chunkSize。tus-js-client 預設是 Infinity（整份一個請求），
    // 那樣斷線就等於從頭來過 —— 續傳的意義沒了。沿用既有的 5 MiB。
    chunkSize: CHUNK_SIZE,
    // 指數退避的重試。網路瞬斷不該讓使用者重按一次。
    retryDelays: [0, 1000, 3000, 5000, 10_000],
    metadata: {
      filename: file.name,
      path: normalizeParentPath(currentPath),
    },
    // 跨工作階段續傳靠這兩個：指紋存 localStorage，成功後清掉。
    storeFingerprintForResuming: true,
    removeFingerprintOnSuccess: true,
    onProgress: (sent, total) => handlers.onProgress(progressPercent(sent, total)),
    onAfterResponse: (_req, res) => {
      const location = res.getHeader("Location");
      if (location) handlers.onUrl(location);
    },
    onSuccess: () => handlers.onSuccess(),
    onError: (error) => handlers.onError(error),
  };
}

/**
 * 已傳位元組 → 百分比。
 *
 * ⚠️ 空檔案要回 100 而不是 NaN。`0 / 0` 是 NaN，而 NaN 會一路流進進度條的
 * `width: ${p}%`，畫面上表現成「進度條消失」而不是任何錯誤 ——
 * 這個 codebase 已經在別處踩過一次除以零。
 */
export function progressPercent(sent: number, total: number): number {
  if (total <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round((sent / total) * 100)));
}

/**
 * 開始（或接續）一份上傳，回傳可以 `abort()` 的 handle。
 *
 * 會先問 `findPreviousUploads` —— 有相同指紋的未完成上傳就接著傳，
 * 沒有才從頭開始。
 */
// Stryker disable all: 底下這段只是把 tus-js-client 的三個呼叫串起來
// （findPreviousUploads → resumeFromPreviousUpload → start），沒有自己的邏輯，
// 而且要有真的瀏覽器與伺服器才跑得起來 —— 它由 e2e/tus-upload.spec.ts 守著，
// 不是由 vitest。在這裡硬湊一個 mock 測試只會測到 mock 本身。
//
// ⚠️ 用 `disable all` 而不是 `disable next-line all` —— 後者只蓋一行，
// 蓋不到函式本體。
export async function startTusUpload(
  file: File,
  currentPath: string,
  handlers: TusUploadHandlers,
): Promise<tus.Upload> {
  const upload = new tus.Upload(file, buildTusOptions(file, currentPath, handlers));

  const previous = await upload.findPreviousUploads();
  const resumable = previous[0];
  if (resumable) {
    upload.resumeFromPreviousUpload(resumable);
  }

  upload.start();
  return upload;
}
// Stryker restore all
