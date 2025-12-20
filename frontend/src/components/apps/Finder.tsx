'use client';

import React, { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useFiles,
  useDelete,
  useRename,
  useToggleStar,
  useTrash,
  useRestoreFromTrash,
  useEmptyTrash,
  useFavorites,
  useUpload,
  useInitUpload,
  useUploadChunk,
  useDownload,
  useCreateShare,
  useThumbnail,
  useUploadSession,
  useCreateFolder
} from '@/features/files/api/useFiles';
import { FileInfo, UploadSession } from '@/types/api';
import { useUploadStore } from '@/store/upload-store';
import { useWindowStore } from '@/store/window-store';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { RefreshCw } from 'lucide-react';

import { Sidebar } from './finder/Sidebar';
import { Toolbar } from './finder/Toolbar';
import { FileList } from './finder/FileList';
import { UploadStatus } from '@/components/desktop/UploadStatus'; // Re-using existing component logic if needed, but Finder has its own status bar

type ViewMode = 'grid' | 'list';

export const Finder = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [currentPath, setCurrentPath] = useState('/');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<string[]>(['/']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isTrashMode, setIsTrashMode] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [conflictFile, setConflictFile] = useState<{ file: File, taskId: string } | null>(null);
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  
  const { tasks: uploadTasks, addTask, updateTask, removeTask } = useUploadStore();
  const { openWindow } = useWindowStore();

  const { data: files, isLoading } = useFiles({ path: currentPath });
  const { data: trashFiles, isLoading: isTrashLoading } = useTrash();
  const { data: favorites } = useFavorites();
  
  const deleteFile = useDelete();
  const renameFile = useRename();
  const toggleStar = useToggleStar();
  const restoreFromTrash = useRestoreFromTrash();
  const emptyTrash = useEmptyTrash();
  const uploadFile = useUpload();
  const initUpload = useInitUpload();
  const uploadChunk = useUploadChunk();
  const downloadFile = useDownload();
  const createShare = useCreateShare();
  const createFolder = useCreateFolder();

  const currentFiles = isTrashMode ? trashFiles : files;
  const isCurrentLoading = isTrashMode ? isTrashLoading : isLoading;

  const handleNavigate = (path: string) => {
    if (path === currentPath && !isTrashMode) return;
    setIsTrashMode(false);
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(path);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setCurrentPath(path);
    setSelectedFiles(new Set());
  };

  // Quick Look (Spacebar)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        // 如果有選中檔案，且沒有正在重命名
        if (selectedFiles.size === 1 && !renamingFile) {
          e.preventDefault();
          e.stopPropagation();
          // 找出被選中的那個檔案物件
          const fileName = Array.from(selectedFiles)[0];
          const file = currentFiles?.find(f => f.name === fileName);
          if (file) {
            const fullPath = file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`);
            openWindow('preview', file.name, { file: { ...file, path: fullPath } });
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [selectedFiles, currentFiles, renamingFile, openWindow]);

  const handleTrashMode = () => {
    setIsTrashMode(true);
    setSelectedFiles(new Set());
  };

  const handleBack = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setCurrentPath(history[historyIndex - 1]);
    }
  };

  const handleForward = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setCurrentPath(history[historyIndex + 1]);
    }
  };

  const handleFileClick = (file: FileInfo, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      const newSelected = new Set(selectedFiles);
      if (newSelected.has(file.name)) {
        newSelected.delete(file.name);
      } else {
        newSelected.add(file.name);
      }
      setSelectedFiles(newSelected);
    } else {
      setSelectedFiles(new Set([file.name]));
    }
  };

  const handleFileDoubleClick = (file: FileInfo) => {
    if (file.is_dir) {
      handleNavigate(currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`);
    } else {
      const fullPath = file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`);
      openWindow('preview', file.name, { file: { ...file, path: fullPath } });
    }
  };

  const handleDelete = (file: FileInfo) => {
    if (confirm(`Are you sure you want to delete ${file.name}?`)) {
      deleteFile.mutate(file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`));
    }
  };

  const handleRenameStart = (file: FileInfo) => {
    setRenamingFile(file.name);
    setRenameValue(file.name);
  };

  const submitRename = async () => {
    if (!renamingFile || !renameValue || renameValue === renamingFile) {
      setRenamingFile(null);
      return;
    }

    try {
      await renameFile.mutateAsync({
        path: currentPath === '/' ? `/${renamingFile}` : `${currentPath}/${renamingFile}`,
        newName: renameValue
      });
      setRenamingFile(null);
    } catch (error) {
      console.error('Rename failed:', error);
      alert('Failed to rename file');
    }
  };

  const handleShare = async (file: FileInfo) => {
    if (confirm(`Create share link for ${file.name}?`)) {
      try {
        const result = await createShare.mutateAsync({
          file_path: file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`)
        });
        prompt('Share Link Created:', `${window.location.origin}/s/${result.id}`);
      } catch (error) {
        alert('Failed to create share link');
      }
    }
  };

  const handleFavoriteClick = (fav: FileInfo) => {
    const fullPath = fav.path.startsWith('/') ? fav.path : `/${fav.path}`;
    
    if (fav.is_dir) {
      handleNavigate(fullPath);
    } else {
      const parentPath = fullPath.substring(0, fullPath.lastIndexOf('/')) || '/';
      handleNavigate(parentPath);
      setTimeout(() => {
        setSelectedFiles(new Set([fav.name]));
      }, 100);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging && !isTrashMode) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (isTrashMode) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await handleUploadFiles(files);
    }
  };

  const handleUploadFiles = async (files: File[]) => {
    for (const file of files) {
      const taskId = `${file.name}-${Date.now()}`;
      addTask({ id: taskId, file, path: currentPath, progress: 0, status: 'uploading' });

      try {
        if (file.size > 10 * 1024 * 1024) {
          await processChunkedUpload(taskId, file);
        } else {
          await uploadFile.mutateAsync({
            file,
            path: currentPath
          });
          updateTask(taskId, { progress: 100, status: 'completed' });
        }
      } catch (error: any) {
        console.error(`Failed to upload ${file.name}:`, error);
        updateTask(taskId, { status: 'error', error: error.message || 'Upload failed' });
      }
    }
  };

  const processChunkedUpload = async (taskId: string, file: File, resumeUploadId?: string, startOffset: number = 0) => {
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
          if (error.response?.status === 409 && !error.response?.data?.upload_id) {
             setConflictFile({ file, taskId });
             updateTask(taskId, { status: 'error', error: 'File exists' });
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

  const handleResumeUpload = async (taskId: string) => {
    const task = uploadTasks[taskId];
    if (!task || !task.uploadId) return;

    updateTask(taskId, { status: 'uploading', error: undefined });

    try {
      const response = await apiClient.get<UploadSession>(`/upload/session/${task.uploadId}`);
      const uploadedSize = response.data.uploaded_size;
      
      await processChunkedUpload(taskId, task.file, task.uploadId, uploadedSize);
    } catch (error: any) {
      console.error('Failed to resume upload:', error);
      updateTask(taskId, { status: 'error', error: 'Failed to resume upload' });
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName) return;
    try {
      await createFolder.mutateAsync({
        path: currentPath,
        name: newFolderName
      });
      setIsCreateFolderOpen(false);
      setNewFolderName('');
    } catch (error) {
      console.error('Failed to create folder:', error);
      alert('Failed to create folder');
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUploadFiles(Array.from(e.target.files));
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="flex h-full bg-white/50 dark:bg-black/50 backdrop-blur-xl rounded-lg overflow-hidden border border-white/20 shadow-2xl">
      <Sidebar
        currentPath={currentPath}
        isTrashMode={isTrashMode}
        favorites={favorites}
        onNavigate={handleNavigate}
        onTrashMode={handleTrashMode}
        onFavoriteClick={handleFavoriteClick}
      />

      <div className="flex-1 flex flex-col min-w-0 bg-white/40 dark:bg-black/40 relative">
        {/* Conflict Dialog */}
        <Dialog open={!!conflictFile} onOpenChange={(open) => !open && setConflictFile(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>File Conflict</DialogTitle>
              <DialogDescription>
                A file named "{conflictFile?.file.name}" already exists in this location.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => {
                if (conflictFile) {
                  removeTask(conflictFile.taskId);
                  setConflictFile(null);
                }
              }}>
                Cancel
              </Button>
              <Button onClick={() => {
                if (conflictFile) {
                   const path = currentPath === '/' ? `/${conflictFile.file.name}` : `${currentPath}/${conflictFile.file.name}`;
                   deleteFile.mutateAsync(path).then(() => {
                      updateTask(conflictFile.taskId, { status: 'uploading', error: undefined });
                      processChunkedUpload(conflictFile.taskId, conflictFile.file);
                      setConflictFile(null);
                   });
                }
              }}>
                Overwrite
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Folder Dialog */}
        <Dialog open={isCreateFolderOpen} onOpenChange={setIsCreateFolderOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Folder</DialogTitle>
              <DialogDescription>
                Enter a name for the new folder.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="Folder Name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateFolder();
                }}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateFolderOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateFolder}>
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Toolbar
          currentPath={currentPath}
          isTrashMode={isTrashMode}
          viewMode={viewMode}
          historyIndex={historyIndex}
          historyLength={history.length}
          onNavigate={handleNavigate}
          onBack={handleBack}
          onForward={handleForward}
          onEmptyTrash={() => emptyTrash.mutate()}
          onUploadClick={() => fileInputRef.current?.click()}
          onViewModeChange={setViewMode}
        />

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          multiple
          onChange={handleFileInputChange}
        />

        <FileList
          files={currentFiles}
          isLoading={isCurrentLoading}
          viewMode={viewMode}
          currentPath={currentPath}
          selectedFiles={selectedFiles}
          renamingFile={renamingFile}
          renameValue={renameValue}
          isTrashMode={isTrashMode}
          isDragging={isDragging}
          onFileClick={handleFileClick}
          onFileDoubleClick={handleFileDoubleClick}
          onSelectionClear={() => setSelectedFiles(new Set())}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onRenameChange={setRenameValue}
          onRenameSubmit={submitRename}
          onRenameCancel={() => setRenamingFile(null)}
          onRestore={(name) => restoreFromTrash.mutate(name)}
          onDelete={handleDelete}
          onDownload={(path) => downloadFile.mutate(path)}
          onShare={handleShare}
          onToggleStar={(path) => toggleStar.mutate(path)}
          onRenameStart={handleRenameStart}
          onCreateFolder={() => setIsCreateFolderOpen(true)}
          onUpload={() => fileInputRef.current?.click()}
          onRefresh={() => queryClient.invalidateQueries({ queryKey: ['files'] })}
          onViewModeChange={setViewMode}
        />
        
        {/* Status Bar */}
        <div className="h-auto min-h-[32px] flex flex-col justify-center px-4 py-1 border-t border-white/10 bg-white/40 dark:bg-black/40 text-xs text-gray-500 backdrop-blur-md">
          {Object.values(uploadTasks).filter(t => t.path === currentPath && t.status === 'uploading').length > 0 ? (
            <div className="flex flex-col gap-2 w-full py-1">
              {Object.values(uploadTasks)
                .filter(t => t.path === currentPath)
                .map((task) => (
                <div key={task.id} className="flex items-center gap-2 w-full">
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  <span className="truncate max-w-[150px]">{task.file.name}</span>
                  <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full transition-all duration-300",
                        task.status === 'error' ? "bg-red-500" : "bg-blue-500"
                      )}
                      style={{ width: `${task.progress}%` }}
                    />
                  </div>
                  <span className="w-10 text-right">{task.progress}%</span>
                  {task.status === 'error' && task.uploadId && (
                    <button
                      onClick={() => handleResumeUpload(task.id)}
                      className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded text-blue-600 dark:text-blue-400"
                      title="Resume Upload"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </button>
                  )}
                  {task.status === 'error' && (
                    <span className="text-red-500 text-[10px]">{task.error}</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <span>{currentFiles ? `${currentFiles.length} items` : 'Loading...'}</span>
          )}
        </div>
      </div>
    </div>
  );
};