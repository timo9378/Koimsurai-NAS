import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { FileInfo, FileVersion, TagRequest, BatchOperationRequest, InitUploadRequest, InitUploadResponse } from '@/types/api';

interface UseFilesParams {
  path: string;
  sortBy?: 'name' | 'size' | 'date';
  order?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export const useFiles = ({ path, sortBy = 'name', order = 'asc', page = 1, limit = 50 }: UseFilesParams) => {
  return useQuery({
    queryKey: ['files', path, sortBy, order, page, limit],
    queryFn: async () => {
      const endpoint = path === '/' || path === ''
        ? '/files'
        : `/files/${encodeURIComponent(path)}`;
      
      const params = new URLSearchParams();
      if (sortBy) params.append('sort_by', sortBy);
      if (order) params.append('order', order);
      if (page) params.append('page', page.toString());
      if (limit) params.append('limit', limit.toString());

      const response = await apiClient.get<FileInfo[]>(`${endpoint}?${params.toString()}`);
      return response.data;
    },
  });
};

export const useFileVersions = (path: string) => {
  return useQuery({
    queryKey: ['files', 'versions', path],
    queryFn: async () => {
      if (!path) return [];
      const response = await apiClient.get<FileVersion[]>(`/files/${encodeURIComponent(path)}/versions`);
      return response.data;
    },
    enabled: !!path,
  });
};

export const useUpload = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ file, path }: { file: File; path: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      
      const endpoint = path === '/' || path === ''
        ? '/upload'
        : `/upload/${encodeURIComponent(path)}`;

      const response = await apiClient.post(endpoint, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['files', variables.path] });
    },
  });
};

export const useInitUpload = () => {
  return useMutation({
    mutationFn: async (data: InitUploadRequest) => {
      const response = await apiClient.post<InitUploadResponse>('/upload/init', data);
      return response.data;
    },
  });
};

export const useUploadChunk = () => {
  return useMutation({
    mutationFn: async ({ sessionId, chunk }: { sessionId: string; chunk: Blob }) => {
      const response = await apiClient.patch(`/upload/session/${sessionId}`, chunk, {
        headers: { 'Content-Type': 'application/octet-stream' }
      });
      return response.data;
    },
  });
};

export const useRename = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path, newName }: { path: string; newName: string }) => {
      await apiClient.put(`/files/${encodeURIComponent(path)}`, { new_path: newName });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};

export const useDelete = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (path: string) => {
      await apiClient.delete(`/files/${encodeURIComponent(path)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};

export const useBatchDelete = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (paths: string[]) => {
      await apiClient.post('/files/batch/delete', { paths });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};

export const useBatchMove = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: BatchOperationRequest) => {
      await apiClient.post('/files/batch/move', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};

export const useBatchCopy = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: BatchOperationRequest) => {
      await apiClient.post('/files/batch/copy', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};

export const useAddTag = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path, tag }: { path: string; tag: TagRequest }) => {
      await apiClient.post(`/files/${encodeURIComponent(path)}/tags`, tag);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};

export const useRemoveTag = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path, tagName }: { path: string; tagName: string }) => {
      await apiClient.delete(`/files/${encodeURIComponent(path)}/tags/${encodeURIComponent(tagName)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};

export const useToggleStar = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (path: string) => {
      await apiClient.post(`/files/${encodeURIComponent(path)}/star`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['favorites'] });
    },
  });
};

export const useRestoreVersion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path, versionId }: { path: string; versionId: string }) => {
      await apiClient.post(`/files/${encodeURIComponent(path)}/restore/${versionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};
export const useTrash = () => {
  return useQuery({
    queryKey: ['trash'],
    queryFn: async () => {
      const response = await apiClient.get<FileInfo[]>('/trash');
      return response.data;
    },
  });
};

export const useRestoreFromTrash = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (filename: string) => {
      await apiClient.post(`/trash/${encodeURIComponent(filename)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};

export const useEmptyTrash = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await apiClient.delete('/trash');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
    },
  });
};

export const useFavorites = () => {
  return useQuery({
    queryKey: ['favorites'],
    queryFn: async () => {
      const response = await apiClient.get<FileInfo[]>('/favorites');
      return response.data;
    },
  });
};