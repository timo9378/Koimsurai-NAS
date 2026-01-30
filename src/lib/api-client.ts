import axios from 'axios';

// Determine backend URL - in browser, use port 3000 for direct backend access
// This bypasses Next.js rewrites which have body size limitations for multipart forms
const getBackendUrl = () => {
  if (typeof window !== 'undefined') {
    // In browser: use same hostname with backend port
    return `${window.location.protocol}//${window.location.hostname}:3000/api`;
  }
  // Server-side: use environment variable or default
  return process.env.BACKEND_URL ? `${process.env.BACKEND_URL}/api` : 'http://127.0.0.1:3000/api';
};

export const apiClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: 0, // Disable timeout for large file uploads
  headers: {
    'Content-Type': 'application/json',
  },
});

// Upload client that directly calls the backend, bypassing Next.js rewrites
// This is necessary because Next.js has body size limits for proxied requests
export const uploadClient = axios.create({
  baseURL: getBackendUrl(),
  withCredentials: true,
  timeout: 0, // Disable timeout for large file uploads
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

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

// Share the same interceptor for uploadClient
uploadClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        await apiClient.post('/auth/refresh');
        return uploadClient(originalRequest);
      } catch (refreshError) {
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);