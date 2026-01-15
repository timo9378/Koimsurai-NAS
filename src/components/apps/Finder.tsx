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
  useDownload,
  useCreateShare,
  useCreateFolder
} from '@/features/files/api/useFiles';
import { FileInfo } from '@/types/api';
import { useUploadStore } from '@/store/upload-store';
import { useWindowStore } from '@/store/window-store';
import { useFileUpload } from '@/features/files/hooks/useFileUpload'; // Updated import
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
import { cn } from '@/lib/utils';
import { RefreshCw, Trash2 } from 'lucide-react';

import { Sidebar } from './finder/Sidebar';
import { Toolbar } from './finder/Toolbar';
import { FileList } from './finder/FileList';
import { UploadStatus } from '@/components/desktop/UploadStatus';

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

  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isEmptyTrashConfirmOpen, setIsEmptyTrashConfirmOpen] = useState(false);
  const [isPermanentDeleteConfirmOpen, setIsPermanentDeleteConfirmOpen] = useState(false);
  const [filesToPermanentlyDelete, setFilesToPermanentlyDelete] = useState<string[]>([]);

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { tasks: uploadTasks, removeTask } = useUploadStore();
  const { openWindow, updateWindowAppState, windows } = useWindowStore();

  const { handleUploadFiles, resumeUpload } = useFileUpload(); // Use hook


  useEffect(() => {
    const state = useWindowStore.getState();
    const finderWindow = state.windows.find(w => w.appType === 'finder');

    if (finderWindow) {
      if (JSON.stringify(finderWindow.appState?.currentPath) !== JSON.stringify(history)) {
        updateWindowAppState(finderWindow.id, { currentPath: history });
      }
    }
  }, [history, updateWindowAppState]);

  // Listen for external navigation requests (e.g., from desktop folder double-click)
  useEffect(() => {
    const finderWindow = windows.find(w => w.appType === 'finder');
    if (finderWindow?.appState?.navigateTo) {
      const targetPath = finderWindow.appState.navigateTo;
      // Clear the navigateTo state to prevent re-triggering
      updateWindowAppState(finderWindow.id, { navigateTo: undefined });
      // Navigate to the target path
      setIsTrashMode(false);
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(targetPath);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      setCurrentPath(targetPath);
      setSelectedFiles(new Set());
    }
  }, [windows, updateWindowAppState, history, historyIndex]);

  const { data: files, isLoading, refetch } = useFiles({ path: currentPath });
  const { data: trashFiles, isLoading: isTrashLoading, refetch: refetchTrash } = useTrash();
  const { data: favorites } = useFavorites();

  const deleteFile = useDelete();
  const renameFile = useRename();
  const toggleStar = useToggleStar();
  const restoreFromTrash = useRestoreFromTrash();
  const emptyTrash = useEmptyTrash();
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

  // Quick Look (Spacebar) and Delete keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Quick Look - Spacebar
      if (e.code === 'Space') {
        if (selectedFiles.size === 1 && !renamingFile) {
          e.preventDefault();
          e.stopPropagation();
          const fileName = Array.from(selectedFiles)[0];
          const file = currentFiles?.find(f => f.name === fileName);
          if (file) {
            const fullPath = file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`);
            openWindow('preview', file.name, { file: { ...file, path: fullPath } });
          }
        }
      }

      // Delete keys
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFiles.size > 0 && !renamingFile) {
        e.preventDefault();
        e.stopPropagation();

        if (e.shiftKey) {
          // Shift+Delete: Permanent delete with confirmation
          const filePaths = Array.from(selectedFiles).map(fileName => {
            const file = currentFiles?.find(f => f.name === fileName);
            return file?.path || (currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`);
          });
          setFilesToPermanentlyDelete(filePaths);
          setIsPermanentDeleteConfirmOpen(true);
        } else {
          // Delete: Move to trash (no confirmation)
          Array.from(selectedFiles).forEach(fileName => {
            const file = currentFiles?.find(f => f.name === fileName);
            if (file) {
              const fullPath = file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`);
              deleteFile.mutate(fullPath);
            }
          });
          setSelectedFiles(new Set());
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [selectedFiles, currentFiles, renamingFile, openWindow, currentPath, deleteFile]);

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
    // No confirmation dialog, directly move to trash
    deleteFile.mutate(file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`));
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
      // Use hook
      await handleUploadFiles(files, currentPath);
    }
  };

  const handleCreateFolder = async () => {
    try {
      // Refetch to get the latest files list for accurate duplicate checking
      const { data: latestFiles } = await refetch();
      const currentFilesList = latestFiles || [];

      let name = '新資料夾';
      let counter = 1;

      while (currentFilesList.some(f => f.name === name)) {
        name = `新資料夾${counter}`;
        counter++;
      }

      // Try to create folder, with retry logic for 409 conflicts
      let created = false;
      let attempts = 0;
      const maxAttempts = 10;

      while (!created && attempts < maxAttempts) {
        try {
          await createFolder.mutateAsync({ path: currentPath, name });
          created = true;
        } catch (error: any) {
          if (error?.response?.status === 409) {
            // Folder already exists, try next name
            name = `新資料夾${counter}`;
            counter++;
            attempts++;
          } else {
            throw error;
          }
        }
      }

      if (!created) {
        throw new Error('無法創建資料夾,請稍後再試');
      }

      // Refetch to show the new folder immediately
      await refetch();

      // 等待檔案列表更新後進入重命名模式
      setTimeout(() => {
        setRenamingFile(name);
        setRenameValue(name);
      }, 100);
    } catch (error) {
      console.error('Failed to create folder:', error);
      alert('Failed to create folder');
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUploadFiles(Array.from(e.target.files), currentPath);
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
        <Toolbar
          currentPath={currentPath}
          isTrashMode={isTrashMode}
          viewMode={viewMode}
          historyIndex={historyIndex}
          historyLength={history.length}
          onNavigate={handleNavigate}
          onBack={handleBack}
          onForward={handleForward}
          onEmptyTrash={() => setIsEmptyTrashConfirmOpen(true)}
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
          onCreateFolder={() => handleCreateFolder()}
          onUpload={() => fileInputRef.current?.click()}
          onRefresh={() => isTrashMode ? refetchTrash() : refetch()}
          onViewModeChange={setViewMode}
          onSelectionChange={setSelectedFiles}
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
                        onClick={() => resumeUpload(task.id)}
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

      {/* Empty Trash Confirmation Dialog */}
      <Dialog open={isEmptyTrashConfirmOpen} onOpenChange={setIsEmptyTrashConfirmOpen}>
        <DialogContent className="sm:max-w-[425px] bg-white/95 dark:bg-black/95 backdrop-blur-xl border-white/20">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <Trash2 className="w-5 h-5" />
              Empty Trash?
            </DialogTitle>
            <DialogDescription className="text-gray-600 dark:text-gray-400">
              This will permanently delete all items in the Trash. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsEmptyTrashConfirmOpen(false)}
              className="border-white/20"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                emptyTrash.mutate();
                setIsEmptyTrashConfirmOpen(false);
              }}
              className="bg-red-500 hover:bg-red-600"
            >
              Empty Trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Permanent Delete Confirmation Dialog */}
      <Dialog open={isPermanentDeleteConfirmOpen} onOpenChange={setIsPermanentDeleteConfirmOpen}>
        <DialogContent className="sm:max-w-[425px] bg-white/95 dark:bg-black/95 backdrop-blur-xl border-white/20">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <Trash2 className="w-5 h-5" />
              Permanently Delete {filesToPermanentlyDelete.length} {filesToPermanentlyDelete.length === 1 ? 'Item' : 'Items'}?
            </DialogTitle>
            <DialogDescription className="text-gray-600 dark:text-gray-400">
              This action cannot be undone. The {filesToPermanentlyDelete.length === 1 ? 'file' : 'files'} will be permanently deleted and cannot be recovered.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setIsPermanentDeleteConfirmOpen(false);
                setFilesToPermanentlyDelete([]);
              }}
              className="border-white/20"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                // TODO: Implement permanent delete API call
                filesToPermanentlyDelete.forEach(path => {
                  // For now, use regular delete
                  deleteFile.mutate(path);
                });
                setIsPermanentDeleteConfirmOpen(false);
                setFilesToPermanentlyDelete([]);
                setSelectedFiles(new Set());
              }}
              className="bg-red-500 hover:bg-red-600"
            >
              Permanently Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};