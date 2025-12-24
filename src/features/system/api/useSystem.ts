import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { SystemStatus, DockerContainer } from '@/types/api';

export const useSystemStatus = () => {
  return useQuery({
    queryKey: ['system', 'status'],
    queryFn: async () => {
      const response = await apiClient.get<SystemStatus>('/system/status');
      return response.data;
    },
    refetchInterval: 5000,
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
      const response = await apiClient.get<DockerContainer[]>('/docker/containers');
      return response.data;
    },
    refetchInterval: 10000,
  });
};