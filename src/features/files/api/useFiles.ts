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
      // Clean path but preserve structure for backend wildcard matching
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      const endpoint = cleanPath === ''
        ? '/files'
        : `/files/${cleanPath}`; // Use path directly, backend handles wildcard routes

      const params = new URLSearchParams();
      if (sortBy) params.append('sort_by', sortBy);
      if (order) params.append('order', order);
      if (page) params.append('page', page.toString());
      if (limit) params.append('limit', limit.toString());
      // Add timestamp to prevent caching
      params.append('_t', Date.now().toString());

      const response = await apiClient.get<FileInfo[]>(`${endpoint}?${params.toString()}`);
      return response.data;
    },
    staleTime: 0, // Consider data stale immediately to ensure fresh data
    refetchOnMount: true, // Always refetch when component mounts
  });
};

export const useFileVersions = (path: string) => {
  return useQuery({
    queryKey: ['files', 'versions', path],
    queryFn: async () => {
      if (!path) return [];
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      // Use path directly for backend wildcard routes
      const response = await apiClient.get<FileVersion[]>(`/versions/file/${cleanPath}?_t=${Date.now()}`);
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

      // Construct the full path including the filename
      // If uploading to root (cleanPath is empty), just use filename
      // Otherwise join directory and filename
      // const fullPath = cleanPath ? `${cleanPath}/${file.name}` : file.name;

      // Use path directly for backend wildcard routes
      // const endpoint = fullPath ? `/upload/${fullPath}` : `/upload`;

      // FIX: Backend likely expects the directory path, not the file path
      // Encode path components to handle special characters (e.g. Chinese)
      const endpoint = cleanPath ? `/upload/${cleanPath.split('/').map(encodeURIComponent).join('/')}` : `/upload`;

      // Explicitly set Content-Type to undefined so the browser sets it with the boundary
      const response = await apiClient.post(endpoint, formData, {
        headers: {
          'Content-Type': undefined // This is crucial for multipart/form-data
        } as any
      });
      return response.data;
    },
    onSuccess: async (_, variables) => {
      // Invalidate all files queries to ensure deep/shallow updates are reflected
      await queryClient.invalidateQueries({ queryKey: ['files'] });
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
      const response = await apiClient.get<UploadSession>(`/upload/session/${id}?_t=${Date.now()}`);
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
      // URL encode path components to handle special characters (dashes, spaces, etc.)
      const encodedPath = cleanPath.split('/').map(encodeURIComponent).join('/');
      await apiClient.put(`/files/${encodedPath}`, { new_path: newPath });
    },
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};

export const useCreateFolder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path, name }: { path: string; name: string }) => {
      // Backend expects: POST /api/files/folder with body { "path": "parent_path", "folder_name": "name" }
      // Clean the path - remove leading slash
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;

      await apiClient.post('/files/folder', {
        path: cleanPath,
        folder_name: name
      });
    },
    onSuccess: async (_, variables) => {
      // Small delay to ensure filesystem consistency before fetching
      await new Promise(resolve => setTimeout(resolve, 100));
      await queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};

export const useDelete = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (path: string) => {
      // Handle undefined or null path
      if (!path) {
        throw new Error('Path is required for deletion');
      }
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      // URL encode path components to handle special characters (dashes, spaces, etc.)
      const encodedPath = cleanPath.split('/').map(encodeURIComponent).join('/');
      await apiClient.delete(`/files/${encodedPath}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['files'] });
      await queryClient.invalidateQueries({ queryKey: ['trash'] });
    },
  });
};

export const useBatchDelete = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (paths: string[]) => {
      await apiClient.post('/files/batch/delete', { paths });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['files'] });
      await queryClient.invalidateQueries({ queryKey: ['trash'] });
    },
  });
};

export const useBatchMove = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: BatchOperationRequest) => {
      await apiClient.post('/files/batch/move', data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};

export const useBatchCopy = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: BatchOperationRequest) => {
      await apiClient.post('/files/batch/copy', data);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};

export const useAddTag = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path, tag }: { path: string; tag: TagRequest }) => {
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      // Use path directly for backend wildcard routes
      await apiClient.post(`/tags/add/${cleanPath}`, tag);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};

export const useRemoveTag = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path, tagName }: { path: string; tagName: string }) => {
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      // Tag name may need encoding but path should be direct for wildcard routes
      await apiClient.delete(`/tags/remove/${tagName}/${cleanPath}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};

export const useToggleStar = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (path: string) => {
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      // Use path directly for backend wildcard routes
      await apiClient.post(`/star/file/${cleanPath}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['files'] });
      await queryClient.invalidateQueries({ queryKey: ['favorites'] });
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};
export const useTrash = () => {
  return useQuery({
    queryKey: ['trash'],
    queryFn: async () => {
      const response = await apiClient.get<FileInfo[]>(`/trash?_t=${Date.now()}`);
      return response.data;
    },
  });
};

export const useRestoreFromTrash = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (filename: string) => {
      // Use filename directly for backend wildcard routes
      await apiClient.post(`/trash/${filename}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['trash'] });
      await queryClient.invalidateQueries({ queryKey: ['files'] });
    },
  });
};

export const useEmptyTrash = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await apiClient.delete('/trash');
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['trash'] });
    },
  });
};

export const usePermanentDelete = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (filename: string) => {
      // URL encode the filename to handle special characters
      const encodedFilename = encodeURIComponent(filename);
      await apiClient.delete(`/trash/${encodedFilename}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['trash'] });
    },
  });
};

export const useFavorites = () => {
  return useQuery({
    queryKey: ['favorites'],
    queryFn: async () => {
      const response = await apiClient.get<FileInfo[]>(`/favorites?_t=${Date.now()}`);
      return response.data;
    },
  });
};

export const useDownload = () => {
  return useMutation({
    mutationFn: async (path: string) => {
      const cleanPath = path.startsWith('/') ? path.slice(1) : path;
      // Use path directly for backend wildcard routes
      const response = await apiClient.get(`/download/${cleanPath}`, {
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
      // Backend expects: GET /api/thumbnail/:size/*path
      const response = await apiClient.get(`/thumbnail/${size}/${cleanPath}`, {
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
      const response = await apiClient.get<FileInfo[]>(`/search?q=${encodeURIComponent(query)}&_t=${Date.now()}`);
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
      const response = await apiClient.get(`/media/timeline?group_by=${groupBy}&_t=${Date.now()}`);
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
      params.append('_t', Date.now().toString());

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
      const response = await apiClient.get(`/search/ai-tags/list?_t=${Date.now()}`);
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['files'] });
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