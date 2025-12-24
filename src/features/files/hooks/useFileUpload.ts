import { useQueryClient } from '@tanstack/react-query';
import { useUpload, useInitUpload, useUploadChunk } from '../api/useFiles';
import { useUploadStore } from '@/store/upload-store';
import { apiClient } from '@/lib/api-client';
import { FileInfo, UploadSession } from '@/types/api';

export const useFileUpload = () => {
  const queryClient = useQueryClient();
  const uploadFile = useUpload();
  const initUpload = useInitUpload();
  const uploadChunk = useUploadChunk();
  const { addTask, updateTask, removeTask, tasks: uploadTasks } = useUploadStore();

  const handleUploadFiles = async (files: File[], currentPath: string) => {
    for (const file of files) {
      const taskId = `${file.name}-${Date.now()}`;
      addTask({ id: taskId, file, path: currentPath, progress: 0, status: 'uploading' });

      try {
        if (file.size > 10 * 1024 * 1024) {
          await processChunkedUpload(taskId, file, currentPath);
        } else {
          await uploadFile.mutateAsync({
            file,
            path: currentPath
          });
          updateTask(taskId, { progress: 100, status: 'completed' });
          await queryClient.invalidateQueries({ queryKey: ['files'] });
        }
      } catch (error: any) {
        if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
           console.warn(`Network Error for ${file.name}, verifying if upload succeeded...`);
           
           await new Promise(resolve => setTimeout(resolve, 1500));
           await queryClient.invalidateQueries({ queryKey: ['files'] });
           
           try {
              const cleanPath = currentPath.startsWith('/') ? currentPath.slice(1) : currentPath;
              const endpoint = cleanPath === '' ? '/files' : `/files/${cleanPath}`;
              const params = new URLSearchParams();
              params.append('sort_by', 'name');
              params.append('_t', Date.now().toString());

              const res = await apiClient.get<FileInfo[]>(`${endpoint}?${params.toString()}`);
              const freshFiles = res.data;
              
              if (freshFiles.some(f => f.name === file.name)) {
                 console.log(`File ${file.name} found despite Network Error. Marking as complete.`);
                 updateTask(taskId, { progress: 100, status: 'completed' });
                 continue; // Skip error logging and continue to next file
              }
           } catch (verifyError) {
              console.error('Verification failed', verifyError);
           }
        }

        console.error(`Failed to upload ${file.name}:`, error);
        updateTask(taskId, { status: 'error', error: error.message || 'Upload failed' });
      }
    }
  };

  const processChunkedUpload = async (taskId: string, file: File, currentPath: string, resumeUploadId?: string, startOffset: number = 0) => {
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
    let upload_id = resumeUploadId;

    try {
      if (!upload_id) {
        try {
          const initResult = await initUpload.mutateAsync({
            file_path: currentPath === '/' ? '' : currentPath.startsWith('/') ? currentPath.slice(1) : currentPath,
            file_name: file.name,
            total_size: file.size
          });
          
          if (initResult.uploaded_size !== undefined) {
             console.log(`Resuming upload for ${file.name} from ${initResult.uploaded_size}`);
             upload_id = initResult.upload_id;
             startOffset = initResult.uploaded_size;
          } else {
             upload_id = initResult.upload_id;
          }

          updateTask(taskId, { uploadId: upload_id });

        } catch (error: any) {
           // We might want to handle conflict here or let UI handle it. 
           // For now throwing to be caught by caller if we want UI dialog.
           // But since we abstracted it, we need a way to bubble conflict up?
           // For simplicity, let's treat conflict as error string 'File exists' so UI can react if it observes task state.
          if (error.response?.status === 409 && !error.response?.data?.upload_id) {
             updateTask(taskId, { status: 'error', error: 'File exists' }); // UI can check this error string
             return;
          }
          throw error;
        }
      }

      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const startChunkIndex = Math.floor(startOffset / CHUNK_SIZE);

      for (let i = startChunkIndex; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        
        await uploadChunk.mutateAsync({
          sessionId: upload_id!,
          chunk
        });

        const progress = Math.round((end / file.size) * 100);
        updateTask(taskId, { progress });
      }

      await queryClient.invalidateQueries({ queryKey: ['files'] });
      updateTask(taskId, { status: 'completed' });

    } catch (error: any) {
      console.error(`Chunk upload failed for ${file.name}:`, error);
      updateTask(taskId, {
        status: 'error',
        error: error.message || 'Upload interrupted',
        uploadId: upload_id
      });
    }
  };

  const resumeUpload = async (taskId: string) => {
      const task = uploadTasks[taskId];
      if (!task || !task.uploadId) return;

      updateTask(taskId, { status: 'uploading', error: undefined });

      try {
        const response = await apiClient.get<UploadSession>(`/upload/session/${task.uploadId}`);
        const uploadedSize = response.data.uploaded_size;
        
        await processChunkedUpload(taskId, task.file, task.path, task.uploadId, uploadedSize);
      } catch (error: any) {
        console.error('Failed to resume upload:', error);
        updateTask(taskId, { status: 'error', error: 'Failed to resume upload' });
      }
  };

  return {
    handleUploadFiles,
    resumeUpload
  };
};
