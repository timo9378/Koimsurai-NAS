import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface ContainerInfo {
  id: string;
  names: string[];
  image: string;
  image_id: string;
  state: string;
  status: string;
  created: number;
  ports: {
    private_port: number;
    public_port?: number;
    type: string;
  }[];
}

export interface ContainerStats {
  cpu_percent: number;
  memory_usage: number;
  memory_limit: number;
  memory_percent: number;
  network_rx: number;
  network_tx: number;
  block_read: number;
  block_write: number;
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
      const response = await apiClient.get('/docker/status');
      return response.data;
    },
    refetchInterval: 10000,
  });
};

export const useContainers = () => {
  return useQuery<ContainerInfo[]>({
    queryKey: ['docker', 'containers'],
    queryFn: async () => {
      const response = await apiClient.get('/docker/containers?all=true');
      return response.data.data;
    },
    refetchInterval: 3000,
  });
};

export const useContainerStats = (id: string, enabled: boolean = false) => {
  return useQuery<ContainerStats>({
    queryKey: ['docker', 'container', id, 'stats'],
    queryFn: async () => {
      const response = await apiClient.get(`/docker/containers/${id}/stats`);
      return response.data.data;
    },
    enabled,
    refetchInterval: 2000,
  });
};

export interface LogEntry {
  stream: string;
  message: string;
}

export const useContainerLogs = (id: string, enabled: boolean = false) => {
  return useQuery<string>({
    queryKey: ['docker', 'container', id, 'logs'],
    queryFn: async () => {
      const response = await apiClient.get(`/docker/containers/${id}/logs?tail=100`);
      const logEntries: LogEntry[] = response.data.data || [];
      // Convert LogEntry array to single string for TerminalView
      return logEntries.map(entry => entry.message).join('');
    },
    enabled,
    refetchInterval: 5000,
  });
};

export const useContainerActions = () => {
  const queryClient = useQueryClient();

  const start = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/docker/containers/${id}/start`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker', 'containers'] });
    },
  });

  const stop = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/docker/containers/${id}/stop`, { timeout: 10 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker', 'containers'] });
    },
  });

  const restart = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/docker/containers/${id}/restart`, { timeout: 10 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker', 'containers'] });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/docker/containers/${id}`);
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
      const response = await apiClient.get('/docker/images');
      return response.data.data;
    },
  });
};

export const usePullImage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ image, tag }: { image: string; tag: string }) => {
      await apiClient.post('/docker/images/pull', { image, tag });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker', 'images'] });
    },
  });
};

export const useRemoveImage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/docker/images/${encodeURIComponent(id)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker', 'images'] });
    },
  });
};

export interface NetworkInfo {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  attachable: boolean;
  ingress: boolean;
  ipam_driver: string | null;
  containers: number;
}

export const useNetworks = () => {
  return useQuery<NetworkInfo[]>({
    queryKey: ['docker', 'networks'],
    queryFn: async () => {
      const response = await apiClient.get('/docker/networks');
      return response.data.data;
    },
    refetchInterval: 5000,
  });
};