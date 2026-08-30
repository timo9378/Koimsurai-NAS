import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

/**
 * 攔截器往 request config 上掛的重試狀態。
 *
 * ⚠️ 這兩個欄位是我們自己加的，不在 axios 的型別裡 —— 原本靠 `error` 是 `any`
 * 才能隨手讀寫，代價是打錯欄位名不會有人擋（`_retry429` vs `_retry_429`
 * 這種錯會讓退避完全失效，而且沒有任何症狀，只是重試不會發生）。
 */
interface RetryableConfig extends InternalAxiosRequestConfig {
  /** 429 已重試次數 */
  _retry429?: number;
  /** 401 是否已嘗試過 refresh（避免無窮迴圈） */
  _retry?: boolean;
}

export const apiClient = axios.create({
  baseURL: "/api",
  withCredentials: true,
  timeout: 0, // Disable timeout for large file uploads
  headers: {
    "Content-Type": "application/json",
  },
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableConfig | undefined;

    // 429 Too Many Requests：指數退避重試（尊重 Retry-After），讓偶發撞限流的請求自動放慢補送，
    // 而不是直接紅字失敗。搭配「整批只刷一次」後，正常上傳根本不該再走到這裡。
    if (error.response?.status === 429 && originalRequest) {
      const attempt = (originalRequest._retry429 ?? 0) + 1;
      originalRequest._retry429 = attempt;
      const MAX_429_RETRIES = 5;
      if (attempt <= MAX_429_RETRIES) {
        const retryAfterMs = Number(error.response.headers["retry-after"]) * 1000 || 0;
        const backoff = Math.min(300 * 2 ** (attempt - 1), 5000);
        const wait = Math.max(retryAfterMs, backoff) + Math.random() * 200;
        await new Promise((resolve) => setTimeout(resolve, wait));
        return apiClient(originalRequest);
      }
    }

    // If error is 401 and we haven't tried to refresh yet
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      // Avoid infinite loops if the refresh endpoint itself returns 401
      if (originalRequest.url === "/auth/refresh") {
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
          window.location.href = "/login";
        }
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      try {
        // Attempt to refresh the token
        // We use a new axios instance or the base axios to avoid interceptor loops if we used apiClient
        // But since we check for /auth/refresh url above, using apiClient is fine if we are careful.
        // However, to be cleaner, let's just use the same instance but we already handled the loop check.
        await apiClient.post("/auth/refresh");

        // If refresh successful, retry the original request
        return apiClient(originalRequest);
      } catch (refreshError) {
        // If refresh fails, redirect to login
        if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
          window.location.href = "/login";
        }
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  },
);
