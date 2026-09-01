import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { backoffInterval } from "@/features/shared/polling";
import { getApiErrorStatus } from "@/lib/errors";
import type {
  ContainerDetails,
  ContainerStats,
  ContainerSummary,
  DockerStatus,
  ImageSummary,
  LogEntry,
  NetworkSummary,
} from "@/types/api";

/**
 * Docker 端點的回應信封：`{ "data": … }`。
 * ⚠️ 只有 docker 那組是這個形狀，其餘端點是直接回 body。
 */
interface DockerEnvelope<T> {
  data: T;
}

// ⚠️ 這幾個別名原本是**手寫的** interface，欄位與產生版逐字相同 —— 也就是一份
// 遲早會漂掉的複本（ContainerStats 已經漂了：產生版的 cpu_percent 是
// `number | null`，因為 serde_json 把 NaN 序列化成 null）。改成 re-export，
// 呼叫端不必改，但來源只剩一個。
export type ContainerInfo = ContainerSummary;
export type ImageInfo = ImageSummary;
export type NetworkInfo = NetworkSummary;
export type { LogEntry };
export type { ContainerDetails, ContainerStats };

export const useDockerStatus = () => {
  return useQuery({
    queryKey: ["docker", "status"],
    queryFn: async () => {
      const response = await apiClient.get<DockerStatus>("/docker/status");
      return response.data;
    },
    refetchInterval: backoffInterval(10000),
  });
};

export const useContainers = () => {
  return useQuery<ContainerInfo[]>({
    queryKey: ["docker", "containers"],
    queryFn: async () => {
      const response = await apiClient.get<DockerEnvelope<ContainerSummary[]>>(
        "/docker/containers?all=true",
      );
      return response.data.data;
    },
    // ⚠️ 出錯就停止輪詢。不在 DOCKER_MANAGER_USER_IDS 裡的帳號會拿到 403，
    // 而固定 3 秒的輪詢會讓它每 3 秒再打一次，永遠。
    refetchInterval: backoffInterval(3000),
    retry: (count, error) => getApiErrorStatus(error) !== 403 && count < 2,
  });
};

export const useContainerStats = (id: string, enabled = false) => {
  return useQuery<ContainerStats>({
    queryKey: ["docker", "container", id, "stats"],
    queryFn: async () => {
      const response = await apiClient.get<DockerEnvelope<ContainerStats>>(
        `/docker/containers/${id}/stats`,
      );
      return response.data.data;
    },
    enabled,
    refetchInterval: backoffInterval(2000),
  });
};

export const useContainerLogs = (id: string, enabled = false) => {
  return useQuery<string>({
    queryKey: ["docker", "container", id, "logs"],
    queryFn: async () => {
      const response = await apiClient.get<DockerEnvelope<LogEntry[]>>(
        `/docker/containers/${id}/logs?tail=100`,
      );
      const logEntries = response.data.data;
      // Convert LogEntry array to single string for TerminalView
      return logEntries.map((entry) => entry.message).join("");
    },
    enabled,
    refetchInterval: backoffInterval(5000),
  });
};

export const useContainerActions = () => {
  const queryClient = useQueryClient();

  const start = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/docker/containers/${id}/start`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["docker", "containers"] });
    },
  });

  const stop = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/docker/containers/${id}/stop`, { timeout: 10 });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["docker", "containers"] });
    },
  });

  const restart = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.post(`/docker/containers/${id}/restart`, { timeout: 10 });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["docker", "containers"] });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/docker/containers/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["docker", "containers"] });
    },
  });

  return { start, stop, restart, remove };
};

export const useImages = () => {
  return useQuery<ImageInfo[]>({
    queryKey: ["docker", "images"],
    queryFn: async () => {
      const response = await apiClient.get<DockerEnvelope<ImageSummary[]>>("/docker/images");
      return response.data.data;
    },
  });
};

export const usePullImage = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ image, tag }: { image: string; tag: string }) => {
      await apiClient.post("/docker/images/pull", { image, tag });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["docker", "images"] });
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
      void queryClient.invalidateQueries({ queryKey: ["docker", "images"] });
    },
  });
};

export const useNetworks = () => {
  return useQuery<NetworkInfo[]>({
    queryKey: ["docker", "networks"],
    queryFn: async () => {
      const response = await apiClient.get<DockerEnvelope<NetworkSummary[]>>("/docker/networks");
      return response.data.data;
    },
    refetchInterval: backoffInterval(5000),
  });
};
