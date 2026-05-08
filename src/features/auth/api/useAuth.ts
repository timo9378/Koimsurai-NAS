import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import {
  AuthResponse, LoginRequest, RegisterRequest,
  LoginResult,
  TwoFactorLoginRequest,
  TwoFactorSetupResponse,
  TwoFactorVerifySetupResponse,
  TwoFactorDisableRequest,
  TwoFactorStatusResponse,
} from '@/types/api';

export const useLogin = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: LoginRequest): Promise<LoginResult> => {
      const response = await apiClient.post<LoginResult>('/auth/login', data);
      return response.data;
    },
    onSuccess: (data) => {
      // 只有完成登入（無 2FA）時才 invalidate；要 2FA 時 cookie 還沒發
      if (!('requires_2fa' in data)) {
        queryClient.invalidateQueries({ queryKey: ['auth'] });
      }
    },
  });
};

/** 2FA 第二階段：用 temp_token + code 換 cookie */
export const useTwoFactorLogin = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: TwoFactorLoginRequest) => {
      await apiClient.post('/auth/2fa/login', data);
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
      const response = await apiClient.get('/system/status');
      return response.data;
    },
    retry: false,
  });
};

// ─────────── 2FA 設定相關 hooks（需登入）───────────

export const useTwoFactorStatus = () => {
  return useQuery({
    queryKey: ['2fa', 'status'],
    queryFn: async () => {
      const response = await apiClient.get<TwoFactorStatusResponse>('/auth/2fa/status');
      return response.data;
    },
  });
};

export const useTwoFactorSetup = () => {
  return useMutation({
    mutationFn: async () => {
      const response = await apiClient.post<TwoFactorSetupResponse>('/auth/2fa/setup');
      return response.data;
    },
  });
};

export const useTwoFactorVerifySetup = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const response = await apiClient.post<TwoFactorVerifySetupResponse>(
        '/auth/2fa/verify-setup',
        { code }
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['2fa', 'status'] });
    },
  });
};

export const useTwoFactorDisable = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: TwoFactorDisableRequest) => {
      await apiClient.post('/auth/2fa/disable', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['2fa', 'status'] });
    },
  });
};

// Simple API helpers
export const authApi = {
  login: async (data: LoginRequest) => {
    const response = await apiClient.post<LoginResult>('/auth/login', data);
    return response.data;
  },

  twoFactorLogin: async (data: TwoFactorLoginRequest) => {
    await apiClient.post('/auth/2fa/login', data);
  },

  logout: async () => {
    await apiClient.post('/auth/logout');
  },

  fetchWithAuth: apiClient,

  isLoggedIn: async () => {
    try {
      await apiClient.get('/system/status');
      return true;
    } catch {
      return false;
    }
  }
};
