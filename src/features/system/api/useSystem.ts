import { useQuery, useMutation, useQueries } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { SystemStatus, DockerContainer } from '@/types/api';

export interface ContainerWithStats extends DockerContainer {
  cpu_percent?: number;
  memory_usage_bytes?: number;
  memory_limit_bytes?: number;
}

export const useSystemStatus = () => {
  return useQuery({
    queryKey: ['system', 'status'],
    queryFn: async () => {
      const response = await apiClient.get<SystemStatus>('/system/status');
      return response.data;
    },
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 10000,
  });
};

export const useRescan = () => {
  return useMutation({
    mutationFn: async () => {
      await apiClient.post('/system/rescan');
    },
  });
};

export const useDockerContainers = () => {
  return useQuery({
    queryKey: ['docker', 'containers'],
    queryFn: async () => {
      try {
        const response = await apiClient.get<{ success: boolean; data?: Array<{
          id: string;
          names: string[];
          image: string;
          state: string;
          status: string;
        }> }>('/docker/containers?all=true');
        
        // Transform backend format to frontend format
        const containers = response.data?.data || [];
        return containers.map(c => ({
          id: c.id,
          name: c.names?.[0]?.replace(/^\//, '') || 'unknown',
          image: c.image,
          status: c.state as 'running' | 'stopped' | 'paused' | 'exited',
          cpu_usage: '0%',
          memory_usage: '0 MB',
        }));
      } catch {
        return [];
      }
    },
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 30000,
  });
};

// Get stats for a single container
export const useContainerStats = (containerId: string, enabled: boolean = true) => {
  return useQuery({
    queryKey: ['docker', 'container', containerId, 'stats'],
    queryFn: async () => {
      try {
        const response = await apiClient.get<{ success: boolean; data?: {
          cpu_percentage: number;
          memory_usage: number;
          memory_limit: number;
          network_rx: number;
          network_tx: number;
        } }>(`/docker/containers/${containerId}/stats`);
        return response.data?.data || null;
      } catch {
        return null;
      }
    },
    enabled: enabled && !!containerId,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5000,
  });
};

// Get stats for all running containers
export const useAllContainerStats = (containers: DockerContainer[]) => {
  const runningContainers = containers.filter(c => c.status === 'running');
  
  const queries = useQueries({
    queries: runningContainers.map(container => ({
      queryKey: ['docker', 'container', container.id, 'stats'],
      queryFn: async () => {
        try {
          const response = await apiClient.get<{ success: boolean; data?: {
            cpu_percentage: number;
            memory_usage: number;
            memory_limit: number;
            network_rx: number;
            network_tx: number;
          } }>(`/docker/containers/${container.id}/stats`);
          return { containerId: container.id, stats: response.data?.data || null };
        } catch {
          return { containerId: container.id, stats: null };
        }
      },
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 10000,
    })),
  });
  
  const statsMap = new Map<string, { cpu_percentage: number; memory_usage: number; memory_limit: number }>();
  queries.forEach(q => {
    if (q.data?.stats) {
      statsMap.set(q.data.containerId, q.data.stats);
    }
  });
  
  return {
    statsMap,
    isLoading: queries.some(q => q.isLoading),
  };
};