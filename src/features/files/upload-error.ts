import { DetailedError } from "tus-js-client";

/**
 * 上傳失敗 → 使用者看得懂的一句話。
 *
 * 為什麼需要這支：原本走的是 `getApiErrorMessage(err, "Upload interrupted")`，
 * 而 tus 的錯誤**不是** axios 錯誤，所以那支會直接回傳 `err.message` ——
 * 也就是 tus-js-client 的內部字串：
 *
 * ```
 * tus: unexpected response while creating upload, originated from request
 * (method: POST, url: /api/tus, response code: 502, ...)
 * ```
 *
 * 這句話對使用者沒有任何意義，而且 UI 一截斷，唯一有用的那個 `502` 就消失了
 * —— 使用者分不出「伺服器掛了」和「這個檔案有問題」，也不知道該不該重試。
 *
 * ⚠️ 這支只負責**給人看**。原始訊息不能丟掉，它要照原樣送去 GlitchTip
 * （見 `lib/errorReporting.ts` 的 `reportError`）。
 */
export function uploadErrorMessage(err: unknown): string {
  const status = uploadErrorStatus(err);

  if (status === undefined) {
    // 連 HTTP 回應都沒有 —— 斷網、伺服器直接關掉連線、或使用者切走頁面。
    return "連線中斷，稍後可以按重試繼續傳（已傳的部分不會重來）。";
  }

  switch (status) {
    case 401:
    case 403:
      return "登入已過期，請重新登入後再試。";
    case 413:
      return "這個檔案超過伺服器允許的大小。";
    case 429:
      return "請求太頻繁，等一下再試。";
    case 502:
    case 503:
    case 504:
      // 這正是這次遇到的情況：後端被 OOM 殺掉，nginx 回 502。
      return "伺服器暫時無法回應（HTTP 502/503），稍後按重試即可續傳。";
    default:
      if (status >= 500) return `伺服器發生錯誤（HTTP ${status}），稍後再試。`;
      return `上傳被拒絕（HTTP ${status}）。`;
  }
}

/**
 * tus 錯誤裡的 HTTP 狀態碼；沒有回應（斷線）時是 `undefined`。
 *
 * ⚠️ 用 `instanceof DetailedError` 而不是自己檢查有沒有 `originalResponse` 欄位
 * —— 後者只看欄位在不在，形狀完全沒驗。
 */
export function uploadErrorStatus(err: unknown): number | undefined {
  if (!(err instanceof DetailedError)) return undefined;
  return err.originalResponse?.getStatus();
}
