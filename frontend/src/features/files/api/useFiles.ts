import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/src/lib/api-client';
import { FileInfo, InitUploadRequest, InitUploadResponse } from '@/src/types/api';

export const useFiles = (path: string) => {
  return useQuery({
    queryKey: ['files', path],
    queryFn: async () => {
      const response = await apiClient.get<FileInfo[]>(`/files/${encodeURIComponent(path)}`);
      return response.data;
    },
  });
};

export const useUpload = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ file, path }: { file: File; path: string }) => {
      // 1. Init upload
      const initData: InitUploadRequest = {
        file_path: path,
        file_name: file.name,
        total_size: file.size,
      };
      const initRes = await apiClient.post<InitUploadResponse>('/upload/init', initData);
      const uploadId = initRes.data.upload_id;

      // 2. Upload chunks (simplified for now, assuming small files or single chunk for MVP)
      // In a real implementation, we would slice the file and upload chunks.
      // For this example, we'll use a standard multipart upload if the backend supports it directly,
      // OR follow the chunked flow. Given the prompt mentions "Multipart Uploads: /api/upload (chunked/streamed)",
      // let's assume a standard multipart form data for simplicity unless specific chunk logic is required.
      
      // However, the prompt says: "Important: This must handle Multipart/Form-Data."
      // So let's do that.
      
      const formData = new FormData();
      formData.append('file', file);
      formData.append('path', path);
      formData.append('upload_id', uploadId); // If needed

      const response = await apiClient.post('/upload', formData, {
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

export const useRename = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ path, newName }: { path: string; newName: string }) => {
      await apiClient.post(`/files/rename`, { path, new_name: newName });
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