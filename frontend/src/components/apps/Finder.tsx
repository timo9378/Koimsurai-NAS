'use client';

import React, { useState, useEffect } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List as ListIcon,
  Upload,
  Search,
  HardDrive,
  Home,
  Server,
  Clock,
  Cloud,
  Download,
  File,
  Folder,
  MoreHorizontal,
  Trash2,
  Copy,
  Move,
  Info,
  Edit2,
  Star,
  StarOff,
  Share2,
  History,
  Tags,
  X,
  RefreshCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import { useQueryClient } from '@tanstack/react-query';
import {
  useFiles,
  useDelete,
  useRename,
  useAddTag,
  useRemoveTag,
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
  useFileVersions,
  useThumbnail,
  useUploadSession
} from '@/features/files/api/useFiles';
import { FileInfo, UploadSession } from '@/types/api';
import { FilePreview } from './FilePreview';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type ViewMode = 'grid' | 'list';

const SidebarItem = ({ icon: Icon, label, active = false, onClick }: { icon: React.ElementType, label: string, active?: boolean, onClick?: () => void }) => (
  <div 
    onClick={onClick}
    className={cn(
      "flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer text-sm transition-all duration-200",
      active 
        ? "bg-blue-500 text-white shadow-sm" 
        : "text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10"
    )}
  >
    <Icon className={cn("w-4 h-4", active ? "text-white" : "text-current")} />
    <span>{label}</span>
  </div>
);

const Breadcrumbs = ({ path, onNavigate }: { path: string, onNavigate: (path: string) => void }) => {
  const parts = path.split('/').filter(Boolean);
  
  return (
    <div className="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-300">
      <button 
        onClick={() => onNavigate('/')}
        className="hover:bg-black/5 dark:hover:bg-white/10 px-1.5 py-0.5 rounded transition-colors"
      >
        Home
      </button>
      {parts.map((part, index) => {
        const currentPath = '/' + parts.slice(0, index + 1).join('/');
        return (
          <React.Fragment key={currentPath}>
            <span className="text-gray-400">/</span>
            <button 
              onClick={() => onNavigate(currentPath)}
              className="hover:bg-black/5 dark:hover:bg-white/10 px-1.5 py-0.5 rounded transition-colors"
            >
              {part}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};

const FileIcon = ({ file, currentPath }: { file: FileInfo; currentPath?: string }) => {
  const isImage = file.mime_type?.startsWith('image/');

  // Determine thumbnail path: prefer the file.path provided by backend; if missing,
  // construct relative path from the current directory + filename (no leading '/').
  const thumbnailPath = file.path
    ? file.path
    : (currentPath && currentPath !== '/')
      ? `${currentPath.replace(/^\//, '')}/${file.name}`
      : file.name;

  const { data: thumbnail } = useThumbnail(thumbnailPath, 'medium');

  if (file.is_dir) {
    return <Folder className="w-12 h-12 text-blue-500 fill-blue-500/20" />;
  }
  
  if (isImage && thumbnail) {
    return <img src={thumbnail} alt={file.name} className="w-12 h-12 object-cover rounded shadow-sm" />;
  }

  return <File className="w-12 h-12 text-gray-500" />;
};

const SmallFileIcon = ({ file }: { file: FileInfo }) => {
  if (file.is_dir) {
    return <Folder className="w-4 h-4 text-blue-500 fill-blue-500/20" />;
  }
  return <File className="w-4 h-4 text-gray-500" />;
};

interface UploadTask {
  file: File;
  progress: number;
  status: 'uploading' | 'completed' | 'error';
  uploadId?: string;
  error?: string;
}

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
  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null);
  const [uploadTasks, setUploadTasks] = useState<Record<string, UploadTask>>({});
  const [conflictFile, setConflictFile] = useState<{ file: File, taskId: string } | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const renameInputRef = React.useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

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
        // 如果有選中檔案，且沒有正在預覽
        if (selectedFiles.size === 1 && !previewFile && !renamingFile) {
          e.preventDefault();
          e.stopPropagation();
          // 找出被選中的那個檔案物件
          const fileName = Array.from(selectedFiles)[0];
          const file = currentFiles?.find(f => f.name === fileName);
          if (file) setPreviewFile(file);
        } else if (previewFile) {
          e.preventDefault();
          e.stopPropagation();
          setPreviewFile(null); // 再次按空白鍵關閉
        }
      }
      if (e.code === 'Escape' && previewFile) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setPreviewFile(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [selectedFiles, previewFile, currentFiles, renamingFile]);

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
    }
  };

  const handleDelete = (file: FileInfo) => {
    if (confirm(`Are you sure you want to delete ${file.name}?`)) {
      deleteFile.mutate(file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`));
    }
  };

  const handleRename = (file: FileInfo) => {
    setRenamingFile(file.name);
    setRenameValue(file.name);
    // Focus will be handled by useEffect or autoFocus
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

  useEffect(() => {
    if (renamingFile && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingFile]);

  const handleShare = async (file: FileInfo) => {
    // Simple prompt for now, could be a modal
    if (confirm(`Create share link for ${file.name}?`)) {
      try {
        const result = await createShare.mutateAsync({
          file_path: file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`)
        });
        // Show result (in a real app, copy to clipboard)
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
      // Navigate to parent directory
      const parentPath = fullPath.substring(0, fullPath.lastIndexOf('/')) || '/';
      handleNavigate(parentPath);
      // Select the file
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
      setUploadTasks(prev => ({
        ...prev,
        [taskId]: { file, progress: 0, status: 'uploading' }
      }));

      try {
        // Use chunked upload for files larger than 10MB
        if (file.size > 10 * 1024 * 1024) {
          await processChunkedUpload(taskId, file);
        } else {
          await uploadFile.mutateAsync({
            file,
            path: currentPath
          });
          setUploadTasks(prev => ({
            ...prev,
            [taskId]: { ...prev[taskId], progress: 100, status: 'completed' }
          }));
          // Remove completed task after 3 seconds
          setTimeout(() => {
            setUploadTasks(prev => {
              const newState = { ...prev };
              delete newState[taskId];
              return newState;
            });
          }, 3000);
        }
      } catch (error: any) {
        console.error(`Failed to upload ${file.name}:`, error);
        setUploadTasks(prev => ({
          ...prev,
          [taskId]: { ...prev[taskId], status: 'error', error: error.message || 'Upload failed' }
        }));
      }
    }
  };

  const processChunkedUpload = async (taskId: string, file: File, resumeUploadId?: string, startOffset: number = 0) => {
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
    let upload_id = resumeUploadId;

    try {
      if (!upload_id) {
        try {
          // Initialize upload
          const initResult = await initUpload.mutateAsync({
            file_path: currentPath === '/' ? '' : currentPath.startsWith('/') ? currentPath.slice(1) : currentPath,
            file_name: file.name,
            total_size: file.size
          });
          
          // Check if we got a resumed session (Priority 1)
          if (initResult.uploaded_size !== undefined) {
             console.log(`Resuming upload for ${file.name} from ${initResult.uploaded_size}`);
             upload_id = initResult.upload_id;
             startOffset = initResult.uploaded_size;
          } else {
             // New session (Priority 3)
             upload_id = initResult.upload_id;
          }

          // Update task with upload_id for potential resume
          setUploadTasks(prev => ({
            ...prev,
            [taskId]: { ...prev[taskId], uploadId: upload_id }
          }));

        } catch (error: any) {
          // Check for 409 Conflict (Priority 2 - File Exists)
          if (error.response?.status === 409 && !error.response?.data?.upload_id) {
             setConflictFile({ file, taskId });
             // Pause the task UI
             setUploadTasks(prev => ({
               ...prev,
               [taskId]: { ...prev[taskId], status: 'error', error: 'File exists' }
             }));
             return;
          }
          throw error;
        }
      }

      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const startChunkIndex = Math.floor(startOffset / CHUNK_SIZE);

      // Upload chunks
      for (let i = startChunkIndex; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        
        await uploadChunk.mutateAsync({
          sessionId: upload_id!,
          chunk
        });

        // Update progress
        const progress = Math.round((end / file.size) * 100);
        setUploadTasks(prev => ({
          ...prev,
          [taskId]: { ...prev[taskId], progress }
        }));
      }

      // Invalidate files query to refresh the list
      await queryClient.invalidateQueries({ queryKey: ['files'] });

      setUploadTasks(prev => ({
        ...prev,
        [taskId]: { ...prev[taskId], status: 'completed' }
      }));

      // Remove completed task after 3 seconds
      setTimeout(() => {
        setUploadTasks(prev => {
          const newState = { ...prev };
          delete newState[taskId];
          return newState;
        });
      }, 3000);

    } catch (error: any) {
      console.error(`Chunk upload failed for ${file.name}:`, error);
      setUploadTasks(prev => ({
        ...prev,
        [taskId]: {
          ...prev[taskId],
          status: 'error',
          error: error.message || 'Upload interrupted',
          uploadId: upload_id // Ensure uploadId is saved for resume
        }
      }));
    }
  };

  const handleResumeUpload = async (taskId: string) => {
    const task = uploadTasks[taskId];
    if (!task || !task.uploadId) return;

    setUploadTasks(prev => ({
      ...prev,
      [taskId]: { ...prev[taskId], status: 'uploading', error: undefined }
    }));

    try {
      // Get current session status to find offset
      const response = await apiClient.get<UploadSession>(`/upload/session/${task.uploadId}`);
      const uploadedSize = response.data.uploaded_size;
      
      await processChunkedUpload(taskId, task.file, task.uploadId, uploadedSize);
    } catch (error: any) {
      console.error('Failed to resume upload:', error);
      setUploadTasks(prev => ({
        ...prev,
        [taskId]: { ...prev[taskId], status: 'error', error: 'Failed to resume upload' }
      }));
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

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="flex h-full bg-white/50 dark:bg-black/50 backdrop-blur-xl rounded-lg overflow-hidden border border-white/20 shadow-2xl">
      {/* Sidebar */}
      <div className="w-48 flex flex-col gap-6 p-4 border-r border-white/10 bg-zinc-50/80 dark:bg-zinc-900/80 backdrop-blur-xl">
        <div className="space-y-1">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-2 mb-2">Favorites</div>
          <SidebarItem icon={Clock} label="Recents" />
          <SidebarItem icon={File} label="Applications" />
          {favorites?.map((fav) => (
            <SidebarItem
              key={fav.path}
              icon={fav.is_dir ? Folder : File}
              label={fav.name}
              active={currentPath === (fav.path.startsWith('/') ? fav.path : `/${fav.path}`) && !isTrashMode}
              onClick={() => handleFavoriteClick(fav)}
            />
          ))}
        </div>

        <div className="space-y-1">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-2 mb-2">Locations</div>
          <SidebarItem
            icon={Home}
            label="Home"
            active={currentPath === '/home' && !isTrashMode}
            onClick={() => handleNavigate('/home')}
          />
          <SidebarItem
            icon={Server}
            label="Koimsurai NAS"
            active={currentPath === '/DataVol1' && !isTrashMode}
            onClick={() => handleNavigate('/DataVol1')}
          />
          <SidebarItem icon={Trash2} label="Trash" active={isTrashMode} onClick={handleTrashMode} />
        </div>
        
        <div className="space-y-1">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-2 mb-2">Tags</div>
          <div className="flex items-center gap-2 px-2 py-1 text-sm text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 rounded-md cursor-pointer">
            <div className="w-2 h-2 rounded-full bg-red-500" /> Red
          </div>
          <div className="flex items-center gap-2 px-2 py-1 text-sm text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 rounded-md cursor-pointer">
            <div className="w-2 h-2 rounded-full bg-orange-500" /> Orange
          </div>
        </div>
      </div>

      {/* Main Content */}
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
                  // Cancel upload
                  setUploadTasks(prev => {
                    const newState = { ...prev };
                    delete newState[conflictFile.taskId];
                    return newState;
                  });
                  setConflictFile(null);
                }
              }}>
                Cancel
              </Button>
              <Button onClick={() => {
                // TODO: Implement Rename logic if needed, for now we just overwrite (which requires backend support or delete+upload)
                // Since the backend returns 409 for existing file, we might need to delete it first or use a force flag if supported.
                // For this implementation, we will alert user that overwrite is not yet supported or implement delete-then-upload.
                
                // Assuming we want to overwrite:
                if (conflictFile) {
                   const path = currentPath === '/' ? `/${conflictFile.file.name}` : `${currentPath}/${conflictFile.file.name}`;
                   deleteFile.mutateAsync(path).then(() => {
                      // Retry upload after deletion
                      setUploadTasks(prev => ({
                        ...prev,
                        [conflictFile.taskId]: { ...prev[conflictFile.taskId], status: 'uploading', error: undefined }
                      }));
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

        {/* Quick Look Overlay */}
        {previewFile && (
          <FilePreview file={previewFile} onClose={() => setPreviewFile(null)} />
        )}

        {/* Toolbar */}
        <div className="h-12 flex items-center justify-between px-4 border-b border-white/10 bg-white/40 dark:bg-black/40 backdrop-blur-md">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <button 
                onClick={handleBack}
                disabled={historyIndex === 0}
                className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </button>
              <button 
                onClick={handleForward}
                disabled={historyIndex === history.length - 1}
                className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </button>
            </div>
            {isTrashMode ? (
              <div className="text-sm font-medium text-gray-700 dark:text-gray-200">Trash</div>
            ) : (
              <Breadcrumbs path={currentPath} onNavigate={handleNavigate} />
            )}
          </div>

          <div className="flex items-center gap-3">
            {isTrashMode && (
              <button
                onClick={() => emptyTrash.mutate()}
                className="px-3 py-1 text-xs font-medium text-white bg-red-500 rounded hover:bg-red-600 transition-colors"
              >
                Empty Trash
              </button>
            )}
            {!isTrashMode && (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                  title="Upload"
                >
                  <Upload className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  multiple
                  onChange={handleFileInputChange}
                />
              </>
            )}
            <div className="flex bg-black/5 dark:bg-white/10 rounded-md p-0.5">
              <button 
                onClick={() => setViewMode('grid')}
                className={cn(
                  "p-1 rounded transition-all duration-200",
                  viewMode === 'grid' ? "bg-white dark:bg-gray-700 shadow-sm" : "hover:bg-black/5 dark:hover:bg-white/5"
                )}
              >
                <LayoutGrid className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={cn(
                  "p-1 rounded transition-all duration-200",
                  viewMode === 'list' ? "bg-white dark:bg-gray-700 shadow-sm" : "hover:bg-black/5 dark:hover:bg-white/5"
                )}
              >
                <ListIcon className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              </button>
            </div>
            
            <div className="relative group">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 group-focus-within:text-blue-500 transition-colors" />
              <input 
                type="text" 
                placeholder="Search" 
                className="w-40 h-7 pl-7 pr-2 text-xs bg-black/5 dark:bg-white/10 rounded border border-transparent focus:border-blue-500 focus:outline-none text-gray-700 dark:text-gray-200 placeholder:text-gray-500 transition-all focus:w-60 focus:bg-white dark:focus:bg-black"
              />
            </div>
          </div>
        </div>

        {/* File View */}
        <div
          className="flex-1 overflow-auto p-4 relative"
          onClick={() => setSelectedFiles(new Set())}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-blue-500/10 dark:bg-blue-500/20 backdrop-blur-sm border-2 border-blue-500 border-dashed m-2 rounded-lg pointer-events-none">
              <div className="flex flex-col items-center gap-2 text-blue-600 dark:text-blue-400">
                <Upload className="w-12 h-12" />
                <span className="text-lg font-medium">Drop files to upload</span>
              </div>
            </div>
          )}
          {isCurrentLoading ? (
            <div className="flex items-center justify-center h-full text-gray-500">Loading...</div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-4">
              {currentFiles?.map((file) => (
                <ContextMenu key={file.name}>
                  <ContextMenuTrigger>
                    <div
                      onClick={(e) => { e.stopPropagation(); handleFileClick(file, e); }}
                      onDoubleClick={(e) => { e.stopPropagation(); handleFileDoubleClick(file); }}
                      className={cn(
                        "flex flex-col items-center gap-1 p-2 rounded cursor-pointer group transition-colors duration-200",
                        selectedFiles.has(file.name)
                          ? "bg-blue-500/20 ring-1 ring-blue-500/50"
                          : "hover:bg-black/5 dark:hover:bg-white/5"
                      )}
                    >
                      <FileIcon file={file} currentPath={currentPath} />
                      {renamingFile === file.name ? (
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={submitRename}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') submitRename();
                            if (e.key === 'Escape') setRenamingFile(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-center px-1 rounded w-full bg-white dark:bg-black border border-blue-500 focus:outline-none text-black dark:text-white"
                        />
                      ) : (
                        <span className={cn(
                          "text-xs text-center px-1 rounded truncate w-full transition-colors",
                          selectedFiles.has(file.name)
                            ? "text-blue-700 dark:text-blue-300 font-medium bg-blue-500/10"
                            : "text-gray-700 dark:text-gray-200 group-hover:text-gray-900 dark:group-hover:text-white"
                        )}>
                          {file.name}
                        </span>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-64">
                    {isTrashMode ? (
                      <>
                        <ContextMenuItem onClick={() => restoreFromTrash.mutate(file.name)}>
                          <Move className="mr-2 h-4 w-4" /> Put Back
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem className="text-red-600">
                          <Trash2 className="mr-2 h-4 w-4" /> Delete Immediately
                        </ContextMenuItem>
                      </>
                    ) : (
                      <>
                        <ContextMenuItem onClick={() => handleFileDoubleClick(file)}>
                          <Folder className="mr-2 h-4 w-4" /> Open
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => downloadFile.mutate(file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`))}>
                          <Download className="mr-2 h-4 w-4" /> Download
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => handleShare(file)}>
                          <Share2 className="mr-2 h-4 w-4" /> Share
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => toggleStar.mutate(file.path || file.name)}>
                          {file.is_starred ? <StarOff className="mr-2 h-4 w-4" /> : <Star className="mr-2 h-4 w-4" />}
                          {file.is_starred ? "Remove from Favorites" : "Add to Favorites"}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem>
                          <Tags className="mr-2 h-4 w-4" /> Tags...
                        </ContextMenuItem>
                        <ContextMenuItem>
                          <History className="mr-2 h-4 w-4" /> Versions
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => handleRename(file)}>
                          <Edit2 className="mr-2 h-4 w-4" /> Rename
                        </ContextMenuItem>
                        <ContextMenuItem>
                          <Copy className="mr-2 h-4 w-4" /> Copy
                        </ContextMenuItem>
                        <ContextMenuItem>
                          <Move className="mr-2 h-4 w-4" /> Move to...
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem>
                          <Info className="mr-2 h-4 w-4" /> Get Info
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem className="text-red-600" onClick={() => handleDelete(file)}>
                          <Trash2 className="mr-2 h-4 w-4" /> Move to Trash
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          ) : (
            <div className="w-full text-sm text-gray-700 dark:text-gray-200">
              <div className="grid grid-cols-[1fr_100px_150px] gap-4 px-4 py-2 border-b border-white/10 font-medium text-gray-500 sticky top-0 bg-white/80 dark:bg-black/80 backdrop-blur-sm z-10">
                <div>Name</div>
                <div>Size</div>
                <div>Date Modified</div>
              </div>
              {currentFiles?.map((file) => (
                <ContextMenu key={file.name}>
                  <ContextMenuTrigger>
                    <div
                      onClick={(e) => { e.stopPropagation(); handleFileClick(file, e); }}
                      onDoubleClick={(e) => { e.stopPropagation(); handleFileDoubleClick(file); }}
                      className={cn(
                        "grid grid-cols-[1fr_100px_150px] gap-4 px-4 py-1.5 cursor-pointer transition-colors duration-150",
                        selectedFiles.has(file.name)
                          ? "bg-blue-500 text-white"
                          : "hover:bg-blue-500/10 even:bg-black/5 dark:even:bg-white/5"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <SmallFileIcon file={file} />
                        {renamingFile === file.name ? (
                          <input
                            ref={renameInputRef}
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={submitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') submitRename();
                              if (e.key === 'Escape') setRenamingFile(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="text-sm px-1 rounded bg-white dark:bg-black border border-blue-500 focus:outline-none text-black dark:text-white flex-1"
                          />
                        ) : (
                          <span className="truncate">{file.name}</span>
                        )}
                      </div>
                      <div className={cn("text-xs", selectedFiles.has(file.name) ? "text-blue-100" : "text-gray-500")}>
                        {file.is_dir ? '--' : `${(file.size / 1024).toFixed(1)} KB`}
                      </div>
                      <div className={cn("text-xs", selectedFiles.has(file.name) ? "text-blue-100" : "text-gray-500")}>
                        {new Date(file.modified).toLocaleDateString()}
                      </div>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-64">
                    {isTrashMode ? (
                      <>
                        <ContextMenuItem onClick={() => restoreFromTrash.mutate(file.name)}>
                          <Move className="mr-2 h-4 w-4" /> Put Back
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem className="text-red-600">
                          <Trash2 className="mr-2 h-4 w-4" /> Delete Immediately
                        </ContextMenuItem>
                      </>
                    ) : (
                      <>
                        <ContextMenuItem onClick={() => handleFileDoubleClick(file)}>
                          <Folder className="mr-2 h-4 w-4" /> Open
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => downloadFile.mutate(file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`))}>
                          <Download className="mr-2 h-4 w-4" /> Download
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => handleShare(file)}>
                          <Share2 className="mr-2 h-4 w-4" /> Share
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => toggleStar.mutate(file.path || file.name)}>
                          {file.is_starred ? <StarOff className="mr-2 h-4 w-4" /> : <Star className="mr-2 h-4 w-4" />}
                          {file.is_starred ? "Remove from Favorites" : "Add to Favorites"}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => handleRename(file)}>
                          <Edit2 className="mr-2 h-4 w-4" /> Rename
                        </ContextMenuItem>
                        <ContextMenuItem>
                          <Copy className="mr-2 h-4 w-4" /> Copy
                        </ContextMenuItem>
                        <ContextMenuItem>
                          <Move className="mr-2 h-4 w-4" /> Move to...
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem>
                          <Info className="mr-2 h-4 w-4" /> Get Info
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem className="text-red-600" onClick={() => handleDelete(file)}>
                          <Trash2 className="mr-2 h-4 w-4" /> Move to Trash
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          )}
        </div>
        
        {/* Status Bar */}
        <div className="h-auto min-h-[24px] flex flex-col justify-center px-4 py-1 border-t border-white/10 bg-white/40 dark:bg-black/40 text-xs text-gray-500 backdrop-blur-md">
          {Object.entries(uploadTasks).length > 0 ? (
            <div className="flex flex-col gap-2 w-full py-1">
              {Object.entries(uploadTasks).map(([taskId, task]) => (
                <div key={taskId} className="flex items-center gap-2 w-full">
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
                      onClick={() => handleResumeUpload(taskId)}
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