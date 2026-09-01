import { useQuery, useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { SystemStatus } from "@/types/api";

export const useSystemStatus = () => {
  return useQuery({
    queryKey: ["system", "status"],
    queryFn: async () => {
      const response = await apiClient.get<SystemStatus>("/system/status");
      return response.data;
    },
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 2000,
    refetchInterval: 3000,
  });
};

export const useRescan = () => {
  return useMutation({
    mutationFn: async () => {
      await apiClient.post("/system/rescan");
    },
  });
};

export const useDockerContainers = () => {
  return useQuery({
    queryKey: ["docker", "containers"],
    queryFn: async () => {
      try {
        const response = await apiClient.get<{
          success: boolean;
          data?: {
            id: string;
            names: string[];
            image: string;
            state: string;
            status: string;
          }[];
        }>("/docker/containers?all=true");

        // Transform backend format to frontend format
        const containers = response.data.data ?? [];
        return containers.map((c) => ({
          id: c.id,
          name: c.names[0]?.replace(/^\//, "") || "unknown",
          image: c.image,
          status: c.state as "running" | "stopped" | "paused" | "exited",
          cpu_usage: "0%",
          memory_usage: "0 MB",
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
