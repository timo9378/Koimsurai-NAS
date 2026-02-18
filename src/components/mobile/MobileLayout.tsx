'use client';

import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Folder,
  Star,
  Settings,
  ChevronRight,
  Home,
  ArrowLeft,
  Upload,
  MoreVertical,
  Search,
  X,
  FolderPlus,
  Download,
  Share2,
  Edit2,
  Trash2,
  StarOff,
  Plus,
  LogOut,
  Loader2,
  RefreshCw,
  Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileInfo } from '@/types/api';
import {
  useFiles,
  useDelete,
  useRename,
  useCreateFolder,
  useDownload,
  useToggleStar,
  useRestoreFromTrash,
  useTrash,
  useEmptyTrash,
  useFavorites,
  useSearch,
  useCreateShare,
} from '@/features/files/api/useFiles';
import { useFileUpload } from '@/features/files/hooks/useFileUpload';
import { useUploadStore } from '@/store/upload-store';
import { useLogout } from '@/features/auth/api/useAuth';
import { FileTypeIcon } from '@/lib/file-icons';
import { useThumbnail } from '@/features/files/api/useFiles';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

// ─── Thumbnail component ────────────────────────────────
const MobileFileThumb = ({ file, currentPath }: { file: FileInfo; currentPath: string }) => {
  const isImage = file.mime_type?.startsWith('image/');
  const thumbnailPath = isImage
    ? (file.path
      ? file.path
      : (currentPath && currentPath !== '/')
        ? `${currentPath.replace(/^\//, '')}/${file.name}`
        : file.name)
    : '';
  const { data: thumbnail } = useThumbnail(thumbnailPath, 'small');

  if (isImage && thumbnail) {
    return <img src={thumbnail} alt="" className="w-10 h-10 rounded-lg object-cover" />;
  }
  return (
    <div className="w-10 h-10 flex items-center justify-center">
      <FileTypeIcon filename={file.name} isDir={file.is_dir} mimeType={file.mime_type ?? undefined} size="lg" />
    </div>
  );
};

// ─── Action Sheet ────────────────────────────────────────
interface ActionSheetProps {
  file: FileInfo | null;
  onClose: () => void;
  onAction: (action: string, file: FileInfo) => void;
  isTrash?: boolean;
}
const ActionSheet = ({ file, onClose, onAction, isTrash }: ActionSheetProps) => {
  if (!file) return null;
  const actions = isTrash
    ? [
        { id: 'restore', label: 'Restore', icon: RefreshCw },
        { id: 'delete-permanent', label: 'Delete Permanently', icon: Trash2, danger: true },
      ]
    : [
        { id: 'download', label: 'Download', icon: Download },
        { id: 'share', label: 'Share', icon: Share2 },
        { id: 'rename', label: 'Rename', icon: Edit2 },
        ...(file.is_starred
          ? [{ id: 'unstar', label: 'Remove from Favorites', icon: StarOff }]
          : [{ id: 'star', label: 'Add to Favorites', icon: Star }]),
        { id: 'info', label: 'File Info', icon: Info },
        { id: 'delete', label: 'Move to Trash', icon: Trash2, danger: true },
      ];

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-[200]"
        onClick={onClose}
      />
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed bottom-0 left-0 right-0 bg-white dark:bg-zinc-900 rounded-t-2xl z-[201] pb-safe max-h-[70vh] overflow-y-auto"
      >
        <div className="w-10 h-1 bg-gray-300 dark:bg-zinc-600 rounded-full mx-auto mt-3 mb-2" />
        {/* File info header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 dark:border-zinc-800">
          <div className="w-10 h-10 flex items-center justify-center">
            <FileTypeIcon filename={file.name} isDir={file.is_dir} mimeType={file.mime_type ?? undefined} size="lg" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate text-gray-900 dark:text-gray-100">{file.name}</p>
            <p className="text-xs text-gray-500">
              {file.is_dir ? 'Folder' : `${(file.size / 1024).toFixed(1)} KB`}
              {' · '}
              {new Date(file.modified).toLocaleDateString()}
            </p>
          </div>
        </div>
        {/* Actions */}
        <div className="py-2">
          {actions.map((action) => (
            <button
              key={action.id}
              onClick={() => { onAction(action.id, file); onClose(); }}
              className={cn(
                "w-full flex items-center gap-4 px-5 py-3.5 text-left active:bg-gray-100 dark:active:bg-zinc-800 transition-colors",
                (action as any).danger && "text-red-500"
              )}
            >
              <action.icon className="w-5 h-5" />
              <span className="text-[15px]">{action.label}</span>
            </button>
          ))}
        </div>
      </motion.div>
    </>
  );
};

// ─── Rename Dialog ───────────────────────────────────────
const RenameDialog = ({
  isOpen, name, onClose, onConfirm,
}: { isOpen: boolean; name: string; onClose: () => void; onConfirm: (newName: string) => void }) => {
  const [value, setValue] = useState(name);
  React.useEffect(() => { if (isOpen) setValue(name); }, [isOpen, name]);

  if (!isOpen) return null;
  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[300]" onClick={onClose} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[85vw] max-w-sm bg-white dark:bg-zinc-900 rounded-2xl p-5 z-[301] shadow-2xl">
        <h3 className="font-semibold text-base mb-4 text-gray-900 dark:text-white">Rename</h3>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { onConfirm(value); onClose(); } }}
          className="w-full px-3 py-2.5 border border-gray-300 dark:border-zinc-600 rounded-xl bg-gray-50 dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"
        />
        <div className="flex gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-300 dark:border-zinc-600 text-sm font-medium text-gray-700 dark:text-gray-300">Cancel</button>
          <button onClick={() => { onConfirm(value); onClose(); }} className="flex-1 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-medium">Confirm</button>
        </div>
      </div>
    </>
  );
};

// ─── File Info Sheet ─────────────────────────────────────
const FileInfoSheet = ({ file, onClose }: { file: FileInfo | null; onClose: () => void }) => {
  if (!file) return null;
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[200]" onClick={onClose} />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed bottom-0 left-0 right-0 bg-white dark:bg-zinc-900 rounded-t-2xl z-[201] pb-safe max-h-[60vh] overflow-y-auto"
      >
        <div className="w-10 h-1 bg-gray-300 dark:bg-zinc-600 rounded-full mx-auto mt-3 mb-4" />
        <div className="px-5 pb-6 space-y-4">
          <h3 className="font-semibold text-base text-gray-900 dark:text-white">File Information</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Name</span><span className="text-gray-900 dark:text-white font-medium truncate ml-4 text-right">{file.name}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Type</span><span className="text-gray-900 dark:text-white">{file.is_dir ? 'Folder' : (file.mime_type || 'Unknown')}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Size</span><span className="text-gray-900 dark:text-white">{file.is_dir ? '--' : formatSize(file.size)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Modified</span><span className="text-gray-900 dark:text-white">{new Date(file.modified).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Path</span><span className="text-gray-900 dark:text-white truncate ml-4 text-right">{file.path}</span></div>
            {file.tags?.length > 0 && (
              <div className="flex justify-between items-start"><span className="text-gray-500">Tags</span>
                <div className="flex gap-1 flex-wrap justify-end">
                  {file.tags.map(t => (
                    <span key={t.name} className="px-2 py-0.5 rounded-full text-xs text-white" style={{ backgroundColor: t.color || '#8E8E93' }}>{t.name}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
};

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// ─── Main MobileLayout ──────────────────────────────────
type Tab = 'files' | 'starred' | 'settings';

export const MobileLayout = () => {
  const [activeTab, setActiveTab] = useState<Tab>('files');
  const [currentPath, setCurrentPath] = useState('/');
  const [isTrashMode, setIsTrashMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [actionFile, setActionFile] = useState<FileInfo | null>(null);
  const [infoFile, setInfoFile] = useState<FileInfo | null>(null);
  const [renameFile, setRenameFile] = useState<FileInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // ─── API hooks ────────────────
  const { data: files, isLoading, refetch } = useFiles({
    path: isTrashMode ? '/.trash' : currentPath,
    sortBy: 'name',
    order: 'asc',
  });
  const { data: trashFiles, refetch: refetchTrash } = useTrash();
  const { data: favorites } = useFavorites();
  const { data: searchResults } = useSearch(searchQuery);
  const deleteFile = useDelete();
  const renameFileMut = useRename();
  const createFolder = useCreateFolder();
  const downloadFile = useDownload();
  const toggleStar = useToggleStar();
  const restoreFromTrash = useRestoreFromTrash();
  const emptyTrash = useEmptyTrash();
  const createShare = useCreateShare();
  const { handleUploadFiles } = useFileUpload();
  const { tasks: uploadTasks } = useUploadStore();
  const logoutMutation = useLogout();

  const currentFiles = isTrashMode ? trashFiles : (isSearchOpen && searchQuery ? searchResults : files);

  // ─── Navigation ───────────────
  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path);
    setIsTrashMode(false);
    setSearchQuery('');
    setIsSearchOpen(false);
  }, []);

  const goBack = useCallback(() => {
    if (currentPath === '/') return;
    const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
    setCurrentPath(parent);
  }, [currentPath]);

  const pathParts = currentPath === '/' ? [] : currentPath.split('/').filter(Boolean);

  // ─── File tap handler ─────────
  const handleFileTap = (file: FileInfo) => {
    if (file.is_dir) {
      if (isTrashMode) return; // Don't navigate in trash
      navigateTo(currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`);
    } else {
      // For non-directory files, open action sheet (mobile-appropriate)
      setActionFile(file);
    }
  };

  // ─── Action handlers ──────────
  const handleAction = async (action: string, file: FileInfo) => {
    const fullPath = file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`);
    switch (action) {
      case 'download':
        downloadFile.mutate(fullPath);
        break;
      case 'share':
        try {
          const result = await createShare.mutateAsync({ file_path: fullPath });
          const url = `${window.location.origin}/s/${result.id}`;
          if (navigator.share) {
            await navigator.share({ title: file.name, url });
          } else {
            await navigator.clipboard.writeText(url);
            toast.success('Share link copied!');
          }
        } catch (e) {
          toast.error('Failed to create share link');
        }
        break;
      case 'rename':
        setRenameFile(file);
        break;
      case 'star':
      case 'unstar':
        toggleStar.mutate(fullPath);
        break;
      case 'info':
        setInfoFile(file);
        break;
      case 'delete':
        deleteFile.mutate(fullPath);
        toast(`"${file.name}" moved to Trash`, {
          action: { label: 'Undo', onClick: () => restoreFromTrash.mutate(file.name) },
          duration: 5000,
        });
        break;
      case 'restore':
        restoreFromTrash.mutate(file.name);
        refetchTrash();
        break;
      case 'delete-permanent':
        deleteFile.mutate(fullPath);
        break;
    }
  };

  const handleRename = async (newName: string) => {
    if (!renameFile || !newName || newName === renameFile.name) return;
    try {
      await renameFileMut.mutateAsync({
        path: currentPath === '/' ? `/${renameFile.name}` : `${currentPath}/${renameFile.name}`,
        newName,
      });
    } catch {
      toast.error('Rename failed');
    }
  };

  const handleNewFolder = async () => {
    let name = '新資料夾';
    let counter = 1;
    while (currentFiles?.some(f => f.name === name)) {
      name = `新資料夾${counter++}`;
    }
    try {
      await createFolder.mutateAsync({ path: currentPath, name });
      refetch();
    } catch {
      toast.error('Failed to create folder');
    }
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      handleUploadFiles(Array.from(e.target.files), currentPath);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleLogout = async () => {
    try {
      await logoutMutation.mutateAsync();
      window.location.href = '/';
    } catch {
      toast.error('Logout failed');
    }
  };

  // ─── Upload progress ──────────
  const activeTasks = Object.values(uploadTasks).filter(t => t.status === 'uploading');
  const totalProgress = activeTasks.length > 0
    ? Math.round(activeTasks.reduce((s, t) => s + t.progress, 0) / activeTasks.length)
    : 0;

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-50 dark:bg-zinc-950 text-gray-900 dark:text-gray-100">
      {/* ─── Header ────────────────────────── */}
      <header className="shrink-0 bg-white dark:bg-zinc-900 border-b border-gray-200 dark:border-zinc-800 safe-area-inset-top">
        <div className="h-12 flex items-center px-4 gap-3">
          {activeTab === 'files' && currentPath !== '/' && !isTrashMode ? (
            <button onClick={goBack} className="p-1 -ml-1">
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : activeTab === 'files' && isTrashMode ? (
            <button onClick={() => { setIsTrashMode(false); setCurrentPath('/'); }} className="p-1 -ml-1">
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : null}

          {isSearchOpen ? (
            <div className="flex-1 flex items-center gap-2">
              <Search className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search files..."
                className="flex-1 bg-transparent text-sm focus:outline-none"
              />
              <button onClick={() => { setIsSearchOpen(false); setSearchQuery(''); }} className="p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <>
              <h1 className="flex-1 font-semibold text-lg truncate">
                {activeTab === 'files'
                  ? (isTrashMode ? 'Trash' : (currentPath === '/' ? 'My Files' : pathParts[pathParts.length - 1]))
                  : activeTab === 'starred' ? 'Starred'
                  : 'Settings'}
              </h1>
              {activeTab === 'files' && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setIsSearchOpen(true)} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-zinc-800">
                    <Search className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => refetch()}
                    className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-zinc-800"
                  >
                    <RefreshCw className={cn("w-5 h-5", isLoading && "animate-spin")} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Breadcrumbs (Files tab only) */}
        {activeTab === 'files' && !isTrashMode && !isSearchOpen && pathParts.length > 0 && (
          <div className="flex items-center gap-1 px-4 pb-2 overflow-x-auto scrollbar-none text-xs text-gray-500">
            <button onClick={() => navigateTo('/')} className="shrink-0 hover:text-blue-500">
              <Home className="w-3.5 h-3.5" />
            </button>
            {pathParts.map((part, i) => (
              <React.Fragment key={i}>
                <ChevronRight className="w-3 h-3 shrink-0 text-gray-300" />
                <button
                  onClick={() => navigateTo('/' + pathParts.slice(0, i + 1).join('/'))}
                  className={cn("shrink-0 truncate max-w-[120px]", i === pathParts.length - 1 ? "text-gray-900 dark:text-white font-medium" : "hover:text-blue-500")}
                >
                  {part}
                </button>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Upload progress bar */}
        {activeTasks.length > 0 && (
          <div className="h-1 bg-gray-200 dark:bg-zinc-800">
            <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${totalProgress}%` }} />
          </div>
        )}
      </header>

      {/* ─── Content ───────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === 'files' && (
          <>
            {/* Quick access for root */}
            {currentPath === '/' && !isTrashMode && !isSearchOpen && (
              <div className="flex gap-3 px-4 py-3 overflow-x-auto scrollbar-none">
                <button
                  onClick={() => setIsTrashMode(true)}
                  className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm"
                >
                  <Trash2 className="w-4 h-4 text-gray-500" /> Trash
                </button>
                <button
                  onClick={handleNewFolder}
                  className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-sm"
                >
                  <FolderPlus className="w-4 h-4 text-gray-500" /> New Folder
                </button>
              </div>
            )}

            {/* Trash actions */}
            {isTrashMode && (
              <div className="px-4 py-2 flex items-center justify-between bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-900/30">
                <span className="text-sm text-red-600 dark:text-red-400">{trashFiles?.length || 0} items in trash</span>
                {(trashFiles?.length || 0) > 0 && (
                  <button
                    onClick={() => { emptyTrash.mutate(); refetchTrash(); }}
                    className="text-sm text-red-600 dark:text-red-400 font-medium"
                  >
                    Empty Trash
                  </button>
                )}
              </div>
            )}

            {/* File list */}
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : !currentFiles?.length ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <Folder className="w-16 h-16 mb-3 opacity-30" />
                <p className="text-sm">{isTrashMode ? 'Trash is empty' : (isSearchOpen ? 'No results' : 'This folder is empty')}</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-zinc-800">
                {currentFiles.map((file) => (
                  <div
                    key={file.name}
                    className="flex items-center gap-3 px-4 py-3 active:bg-gray-100 dark:active:bg-zinc-800 transition-colors"
                    onClick={() => handleFileTap(file)}
                  >
                    <MobileFileThumb file={file} currentPath={currentPath} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {file.is_dir ? 'Folder' : formatSize(file.size)}
                        {' · '}
                        {new Date(file.modified).toLocaleDateString()}
                        {file.is_starred && ' ⭐'}
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setActionFile(file); }}
                      className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-zinc-800"
                    >
                      <MoreVertical className="w-5 h-5 text-gray-400" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'starred' && (
          <>
            {!favorites?.length ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <Star className="w-16 h-16 mb-3 opacity-30" />
                <p className="text-sm">No starred files</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-zinc-800">
                {favorites.map((file) => (
                  <div
                    key={file.path}
                    className="flex items-center gap-3 px-4 py-3 active:bg-gray-100 dark:active:bg-zinc-800 transition-colors"
                    onClick={() => {
                      if (file.is_dir) {
                        setActiveTab('files');
                        navigateTo(file.path.startsWith('/') ? file.path : `/${file.path}`);
                      } else {
                        setActionFile(file);
                      }
                    }}
                  >
                    <div className="w-10 h-10 flex items-center justify-center">
                      <FileTypeIcon filename={file.name} isDir={file.is_dir} mimeType={file.mime_type ?? undefined} size="lg" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{file.path}</p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setActionFile(file); }}
                      className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-zinc-800"
                    >
                      <MoreVertical className="w-5 h-5 text-gray-400" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'settings' && (
          <div className="py-4">
            <div className="px-4 pb-2 text-xs text-gray-500 uppercase tracking-wider">Account</div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-4 px-4 py-3.5 active:bg-gray-100 dark:active:bg-zinc-800"
            >
              <LogOut className="w-5 h-5 text-red-500" />
              <span className="text-[15px] text-red-500">Log Out</span>
            </button>
            <div className="mt-6 px-4 text-center">
              <p className="text-xs text-gray-400">Koimsurai NAS v1.0.0</p>
            </div>
          </div>
        )}
      </main>

      {/* ─── FAB (Upload) ──────────────────── */}
      {activeTab === 'files' && !isTrashMode && (
        <>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleUpload} />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="fixed right-4 bottom-20 w-14 h-14 rounded-full bg-blue-500 text-white shadow-lg flex items-center justify-center z-50 active:scale-95 transition-transform"
          >
            <Plus className="w-6 h-6" />
          </button>
        </>
      )}

      {/* ─── Bottom Tab Bar ────────────────── */}
      <nav className="shrink-0 bg-white dark:bg-zinc-900 border-t border-gray-200 dark:border-zinc-800 pb-safe">
        <div className="h-14 flex items-center justify-around">
          {([
            { id: 'files' as Tab, icon: Folder, label: 'Files' },
            { id: 'starred' as Tab, icon: Star, label: 'Starred' },
            { id: 'settings' as Tab, icon: Settings, label: 'Settings' },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                if (tab.id === 'files') {
                  setIsTrashMode(false);
                  setIsSearchOpen(false);
                  setSearchQuery('');
                }
              }}
              className={cn(
                "flex flex-col items-center gap-0.5 px-4 py-1 transition-colors",
                activeTab === tab.id ? "text-blue-500" : "text-gray-400"
              )}
            >
              <tab.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* ─── Overlays ──────────────────────── */}
      <AnimatePresence>
        {actionFile && <ActionSheet file={actionFile} onClose={() => setActionFile(null)} onAction={handleAction} isTrash={isTrashMode} />}
      </AnimatePresence>
      <AnimatePresence>
        {infoFile && <FileInfoSheet file={infoFile} onClose={() => setInfoFile(null)} />}
      </AnimatePresence>
      <RenameDialog
        isOpen={!!renameFile}
        name={renameFile?.name || ''}
        onClose={() => setRenameFile(null)}
        onConfirm={handleRename}
      />
    </div>
  );
};
