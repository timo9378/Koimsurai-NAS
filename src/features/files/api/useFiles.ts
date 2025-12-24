import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { FileInfo, FileVersion, TagRequest, BatchOperationRequest, InitUploadRequest, InitUploadResponse, UploadSession } from '@/types/api';

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
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      const endpoint = cleanPath === ''
        ? '/files'
        : `/files/${encodeURIComponent(cleanPath)}`;
      
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
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      const response = await apiClient.get<FileVersion[]>(`/versions/file/${encodeURIComponent(cleanPath)}`);
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
      
      // Remove leading slash if present to ensure correct path handling
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      const endpoint = cleanPath === ''
        ? '/upload'
        : `/upload/${encodeURIComponent(cleanPath)}`;

      // Use postForm to automatically handle multipart/form-data headers and boundaries
      const response = await apiClient.postForm(endpoint, formData);
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
      try {
        const response = await apiClient.post<InitUploadResponse>('/upload/init', data);
        return response.data;
      } catch (error: any) {
        // If 409 Conflict, check if we can resume an existing session
        // The backend should return upload_id AND uploaded_size in the 409 response body for resumption
        if (error.response?.status === 409 && error.response?.data?.upload_id) {
          console.warn('Upload session exists, resuming...', error.response.data);
          return error.response.data as InitUploadResponse;
        }
        // If 409 but no upload_id, it means file exists (Priority 2) -> Throw to let UI handle conflict
        throw error;
      }
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

export const useUploadSession = (id: string) => {
  return useQuery({
    queryKey: ['upload', 'session', id],
    queryFn: async () => {
      if (!id) return null;
      const response = await apiClient.get<UploadSession>(`/upload/session/${id}`);
      return response.data;
    },
    enabled: !!id,
    retry: false,
  });
};

export const useRename = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path, newName }: { path: string; newName: string }) => {
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      // Build new_path as the same directory + newName so the backend receives the full target path
      const dir = cleanPath.includes('/') ? cleanPath.substring(0, cleanPath.lastIndexOf('/')) : '';
      const newPath = dir ? `${dir}/${newName}` : newName;
      await apiClient.put(`/files/${encodeURIComponent(cleanPath)}`, { new_path: newPath });
    },
    onSuccess: (_, variables) => {
      // Recompute parent directory from the original path and invalidate both
      // the general files queries and the specific parent directory so the
      // UI showing the directory listing will be refetched.
      try {
        const originalPath = variables.path as string;
        const cleanPath = originalPath.startsWith('/') ? originalPath.slice(1) : originalPath;
        const dir = cleanPath.includes('/') ? cleanPath.substring(0, cleanPath.lastIndexOf('/')) : '';
        const parentPath = dir ? `/${dir}` : '/';

        queryClient.invalidateQueries({ queryKey: ['files'] });
        queryClient.invalidateQueries({ queryKey: ['files', parentPath] });
      } catch (e) {
        // Fallback: invalidate all files queries
        queryClient.invalidateQueries({ queryKey: ['files'] });
      }
    },
  });
};

export const useCreateFolder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path, name }: { path: string; name: string }) => {
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      const endpoint = cleanPath === ''
        ? '/files/mkdir'
        : `/files/mkdir/${encodeURIComponent(cleanPath)}`;
      
      await apiClient.post(endpoint, { name });
    },
    onSuccess: (_, variables) => {
      // Invalidate the directory where the folder was created
      const cleanPath = variables.path.startsWith('/') ? variables.path : `/${variables.path}`;
      queryClient.invalidateQueries({ queryKey: ['files'] });
      queryClient.invalidateQueries({ queryKey: ['files', cleanPath] });
    },
  });
};

export const useDelete = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (path: string) => {
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      await apiClient.delete(`/files/${encodeURIComponent(cleanPath)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
      // After deleting a file (moved to trash), refresh the trash list so
      // components using `useTrash` get updated data.
      queryClient.invalidateQueries({ queryKey: ['trash'] });
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
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      await apiClient.post(`/tags/add/${encodeURIComponent(cleanPath)}`, tag);
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
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      await apiClient.delete(`/tags/remove/${encodeURIComponent(tagName)}/${encodeURIComponent(cleanPath)}`);
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
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      await apiClient.post(`/star/file/${encodeURIComponent(cleanPath)}`);
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
      // const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      // Note: The backend route seems to only require versionId: /versions/restore/{id}
      // If path is needed for invalidation, we keep it in args but not in URL if not required.
      // Based on instructions: /api/versions/restore/${id}
      await apiClient.post(`/versions/restore/${versionId}`);
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

export const useDownload = () => {
  return useMutation({
    mutationFn: async (path: string) => {
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      const response = await apiClient.get(`/download/${encodeURIComponent(cleanPath)}`, {
        responseType: 'blob',
      });
      
      // Create a download link and trigger it
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const fileName = path.split('/').pop() || 'download';
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    },
  });
};

export const useThumbnail = (path: string, size: 'small' | 'medium' | 'large' = 'small') => {
  return useQuery({
    queryKey: ['thumbnail', path, size],
    queryFn: async () => {
      if (!path) return null;
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      // Use encodeURI to preserve '/' characters so backend wildcard routes match
      const encodedPath = encodeURI(cleanPath);
      const response = await apiClient.get(`/thumbnail/${size}/${encodedPath}`, {
        responseType: 'blob',
      });
      return URL.createObjectURL(response.data);
    },
    enabled: !!path,
    staleTime: Infinity, // Thumbnails rarely change
  });
};

export const useSearch = (query: string) => {
  return useQuery({
    queryKey: ['search', query],
    queryFn: async () => {
      if (!query) return [];
      const response = await apiClient.get<FileInfo[]>(`/search?q=${encodeURIComponent(query)}`);
      return response.data;
    },
    enabled: !!query,
  });
};

export const useCreateShare = () => {
  return useMutation({
    mutationFn: async (data: { file_path: string; password?: string; expires?: number }) => {
      const cleanPath = data.file_path.startsWith('/') ? data.file_path.slice(1) : data.file_path;
      const response = await apiClient.post('/share', { ...data, file_path: cleanPath });
      return response.data;
    },
  });
};

// Media Hooks
export const useMediaTimeline = (groupBy: 'day' | 'month' | 'year' = 'day') => {
  return useQuery({
    queryKey: ['media', 'timeline', groupBy],
    queryFn: async () => {
      const response = await apiClient.get(`/media/timeline?group_by=${groupBy}`);
      return response.data;
    },
  });
};

// AI Hooks
export const useSearchAiTags = (query: string, minConfidence?: number, limit?: number) => {
  return useQuery({
    queryKey: ['search', 'ai-tags', query, minConfidence, limit],
    queryFn: async () => {
      if (!query) return [];
      const params = new URLSearchParams();
      params.append('q', query);
      if (minConfidence) params.append('min_confidence', minConfidence.toString());
      if (limit) params.append('limit', limit.toString());
      
      const response = await apiClient.get(`/search/ai-tags?${params.toString()}`);
      return response.data;
    },
    enabled: !!query,
  });
};

export const useAiTagsList = () => {
  return useQuery({
    queryKey: ['ai-tags', 'list'],
    queryFn: async () => {
      const response = await apiClient.get('/search/ai-tags/list');
      return response.data;
    },
  });
};

export const useAiAnalyze = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) => {
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      const response = await apiClient.post('/ai/analyze', { path: cleanPath });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};

// System Hooks
export const useSystemStatus = () => {
  return useQuery({
    queryKey: ['system', 'status'],
    queryFn: async () => {
      const response = await apiClient.get('/system/status');
      return response.data;
    },
    refetchInterval: 5000, // Refresh every 5 seconds
  });
};

export const useTasks = () => {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      const response = await apiClient.get('/tasks');
      return response.data;
    },
    refetchInterval: 3000,
  });
};

// Docker Hooks
export const useDockerStatus = () => {
  return useQuery({
    queryKey: ['docker', 'status'],
    queryFn: async () => {
      const response = await apiClient.get('/docker/status');
      return response.data;
    },
  });
};

export const useDockerContainers = (all: boolean = false) => {
  return useQuery({
    queryKey: ['docker', 'containers', all],
    queryFn: async () => {
      const response = await apiClient.get(`/docker/containers?all=${all}`);
      return response.data;
    },
  });
};

export const useDockerContainerStats = (id: string) => {
  return useQuery({
    queryKey: ['docker', 'containers', id, 'stats'],
    queryFn: async () => {
      if (!id) return null;
      const response = await apiClient.get(`/docker/containers/${id}/stats`);
      return response.data;
    },
    enabled: !!id,
    refetchInterval: 2000,
  });
};

export const useDockerAction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'start' | 'stop' | 'restart' }) => {
      await apiClient.post(`/docker/containers/${id}/${action}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker', 'containers'] });
    },
  });
};