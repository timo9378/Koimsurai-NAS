// API 錯誤的統一取值。
//
// 為什麼需要這支：`catch` 綁定的型別是 `unknown`（TS 的正確預設），而各處原本
// 寫成 `catch (e: any)` 繞過它 —— 代價是 `e.response.data.message` 這條鏈上
// 每一步都沒有型別，打錯字不會有人告訴你。
//
// ⚠️ 用 axios 自己的 `isAxiosError` 而不是手刻 `typeof e === 'object' && 'response' in e`：
//    後者只檢查欄位存在，`response` 是什麼形狀完全沒驗；前者是 axios 維護的
//    type guard，而且會正確排除「長得像但不是 axios 錯誤」的東西。

import { AxiosError, isAxiosError } from "axios";

/** 後端 `AppError` 的 JSON 形狀（`{"error": "..."}`）。部分端點回 `message`。 */
interface ApiErrorBody {
  error?: string;
  message?: string;
}

/** 取 HTTP 狀態碼；不是 HTTP 錯誤（例如斷網）時回 `undefined`。 */
export function getApiErrorStatus(err: unknown): number | undefined {
  return isAxiosError(err) ? err.response?.status : undefined;
}

/** 取後端回的錯誤訊息，取不到就退回一段可讀的說明。 */
export function getApiErrorMessage(err: unknown, fallback = "操作失敗"): string {
  if (isAxiosError<ApiErrorBody>(err)) {
    const body = err.response?.data;
    // `err.message` 是 axios 一定會給的字串（"Request failed with status code 500"
    // 這種），只有空字串才需要退回 fallback。
    return body?.error ?? body?.message ?? (err.message === "" ? fallback : err.message);
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

/**
 * 是不是「連不上」而不是「伺服器回了錯」。
 *
 * 這兩者要分開處理：前者值得重試（見 `useFileUpload` 的斷點續傳），
 * 後者重試通常只會再錯一次。
 */
export function isNetworkError(err: unknown): boolean {
  return isAxiosError(err) && (err.code === AxiosError.ERR_NETWORK || !err.response);
}

/** 取回應 body 並轉成指定型別；不是 axios 錯誤或沒有 body 時回 `undefined`。 */
export function getApiErrorBody<T>(err: unknown): T | undefined {
  return isAxiosError<T>(err) ? err.response?.data : undefined;
}
