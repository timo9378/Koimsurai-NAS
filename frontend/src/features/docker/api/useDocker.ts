import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface ContainerInfo {
  id: string;
  names: string[];
  image: string;
  state: string;
  status: string;
  ports: {
    ip?: string;
    private_port: number;
    public_port?: number;
    type: string;
  }[];
}

export interface ContainerStats {
  cpu_usage: number;
  memory_usage: number;
  memory_limit: number;
  network_rx: number;
  network_tx: number;
}

export interface ImageInfo {
  id: string;
  tags: string[];
  size: number;
  created: number;
}

export const useDockerStatus = () => {
  return useQuery({
    queryKey: ['docker', 'status'],
    queryFn: async () => {
      const response = await apiClient.get('/api/docker/status');
      return response.data;
    },
    refetchInterval: 10000,
  });
};

export const useContainers = () => {
  return useQuery<ContainerInfo[]>({
    queryKey: ['docker', 'containers'],
    queryFn: async () => {
      const response = await apiClient.get('/api/docker/containers?all=true');
      return response.data;
    },
    refetchInterval: 3000,
  });
};

export const useContainerStats = (id: string, enabled: boolean = false) => {
  return useQuery<ContainerStats>({
    queryKey: ['docker', 'container', id, 'stats'],
    queryFn: async () => {
      const response = await apiClient.get(`/api/docker/containers/${id}/stats`);
      return response.data;
    },
    enabled,
    refetchInterval: 2000,
  });
};

export const useContainerLogs = (id: string, enabled: boolean = false) => {
  return useQuery<string>({
    queryKey: ['docker', 'container', id, 'logs'],
    queryFn: async () => {
      const response = await apiClient.get(`/api/docker/containers/${id}/logs?tail=100`);
      return response.data;
    },
    enabled,
    refetchInterval: 5000,
  });
};

export const useContainerActions = () => {
  const queryClient = useQueryClient();

  const start = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/api/docker/containers/${id}/start`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker', 'containers'] });
    },
  });

  const stop = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/api/docker/containers/${id}/stop`, { timeout: 10 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker', 'containers'] });
    },
  });

  const restart = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/api/docker/containers/${id}/restart`, { timeout: 10 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker', 'containers'] });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/api/docker/containers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker', 'containers'] });
    },
  });

  return { start, stop, restart, remove };
};

export const useImages = () => {
  return useQuery<ImageInfo[]>({
    queryKey: ['docker', 'images'],
    queryFn: async () => {
      const response = await apiClient.get('/api/docker/images');
      return response.data;
    },
  });
};

export const usePullImage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ image, tag }: { image: string; tag: string }) => {
      await apiClient.post('/api/docker/images/pull', { image, tag });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker', 'images'] });
    },
  });
};