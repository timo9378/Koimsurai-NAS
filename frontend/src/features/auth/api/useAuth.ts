import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { AuthResponse, LoginRequest, RegisterRequest } from '@/types/api';

export const useLogin = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: LoginRequest) => {
      const response = await apiClient.post<AuthResponse>('/auth/login', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });
};

export const useLogout = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await apiClient.post('/auth/logout');
    },
    onSuccess: () => {
      queryClient.clear();
    },
  });
};

export const useRegister = () => {
  return useMutation({
    mutationFn: async (data: RegisterRequest) => {
      const response = await apiClient.post<AuthResponse>('/auth/register', data);
      return response.data;
    },
  });
};
export const useCheckAuth = () => {
  return useMutation({
    mutationFn: async () => {
      // Try to access a protected route to check if we are authenticated
      // Since we don't have a dedicated /me endpoint yet, we can use a lightweight protected endpoint
      // or just rely on the 401 interceptor.
      // However, for initial load, we might want to check status.
      // Let's assume we can check system status as a way to verify auth
      const response = await apiClient.get('/system/status');
      return response.data;
    },
    retry: false,
  });
};