import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 0, // Disable timeout for large file uploads
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // 429 Too Many Requests：指數退避重試（尊重 Retry-After），讓偶發撞限流的請求自動放慢補送，
    // 而不是直接紅字失敗。搭配「整批只刷一次」後，正常上傳根本不該再走到這裡。
    if (error.response?.status === 429 && originalRequest) {
      originalRequest._retry429 = (originalRequest._retry429 ?? 0) + 1;
      const MAX_429_RETRIES = 5;
      if (originalRequest._retry429 <= MAX_429_RETRIES) {
        const retryAfterMs = Number(error.response.headers?.['retry-after']) * 1000 || 0;
        const backoff = Math.min(300 * 2 ** (originalRequest._retry429 - 1), 5000);
        const wait = Math.max(retryAfterMs, backoff) + Math.random() * 200;
        await new Promise((resolve) => setTimeout(resolve, wait));
        return apiClient(originalRequest);
      }
    }

    // If error is 401 and we haven't tried to refresh yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      // Avoid infinite loops if the refresh endpoint itself returns 401
      if (originalRequest.url === '/auth/refresh') {
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }

      originalRequest._retry = true;

      try {
        // Attempt to refresh the token
        // We use a new axios instance or the base axios to avoid interceptor loops if we used apiClient
        // But since we check for /auth/refresh url above, using apiClient is fine if we are careful.
        // However, to be cleaner, let's just use the same instance but we already handled the loop check.
        await apiClient.post('/auth/refresh');

        // If refresh successful, retry the original request
        return apiClient(originalRequest);
      } catch (refreshError) {
        // If refresh fails, redirect to login
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);