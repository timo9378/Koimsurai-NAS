import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Check if we are not already on the login page to avoid infinite loops
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        // Redirect to login page
        // In a real app, you might want to use a more sophisticated way to handle this,
        // like a global event or a specific hook, but window.location is robust for 401s.
        // window.location.href = '/login';
        console.warn('Unauthorized access, redirecting to login...');
      }
    }
    return Promise.reject(error);
  }
);