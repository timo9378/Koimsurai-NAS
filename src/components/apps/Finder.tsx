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
import { useUserTags, useFilesByTag } from '@/hooks/use-tags';
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
import { toast } from 'sonner';

import { Sidebar } from './finder/Sidebar';
import { Toolbar } from './finder/Toolbar';
import { FileList } from './finder/FileList';
import { UploadStatus } from '@/components/desktop/UploadStatus';
import { ShareDialog, UploadLinkDialog, TagDialog } from '@/components/dialogs';
import { X, Plus } from 'lucide-react';

type ViewMode = 'grid' | 'list';

// Tab state interface
interface TabState {
  id: string;
  path: string;
  history: string[];
  historyIndex: number;
  isTrashMode: boolean;
  selectedTag: string | null;
  selectedFiles: Set<string>;
  searchQuery: string;
}

const createTab = (path: string = '/'): TabState => ({
  id: crypto.randomUUID(),
  path,
  history: [path],
  historyIndex: 0,
  isTrashMode: false,
  selectedTag: null,
  selectedFiles: new Set(),
  searchQuery: '',
});

interface FinderProps {
  windowId?: string;
}

// Serializable tab state for localStorage persistence
interface SerializedTabState {
  id: string;
  path: string;
  history: string[];
  historyIndex: number;
  isTrashMode: boolean;
  selectedTag: string | null;
  searchQuery: string;
}

const TABS_STORAGE_KEY = 'finder-tabs';

const loadPersistedTabs = (windowId?: string): { tabs: TabState[]; activeTabId: string } | null => {
  if (!windowId || typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(`${TABS_STORAGE_KEY}-${windowId}`);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as { tabs: SerializedTabState[]; activeTabId: string };
    if (!parsed.tabs?.length) return null;
    // Restore tabs with empty selectedFiles (Set is not serializable)
    const tabs: TabState[] = parsed.tabs.map(t => ({
      ...t,
      selectedFiles: new Set<string>(),
    }));
    return { tabs, activeTabId: parsed.activeTabId };
  } catch {
    return null;
  }
};

const persistTabs = (windowId: string | undefined, tabs: TabState[], activeTabId: string) => {
  if (!windowId || typeof window === 'undefined') return;
  try {
    const serialized: { tabs: SerializedTabState[]; activeTabId: string } = {
      tabs: tabs.map(({ selectedFiles, ...rest }) => rest),
      activeTabId,
    };
    localStorage.setItem(`${TABS_STORAGE_KEY}-${windowId}`, JSON.stringify(serialized));
  } catch {
    // Silently ignore storage errors
  }
};

export const Finder = ({ windowId }: FinderProps) => {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  
  // Multi-tab state (restored from localStorage if available)
  const [tabs, setTabs] = useState<TabState[]>(() => {
    const persisted = loadPersistedTabs(windowId);
    return persisted?.tabs || [createTab('/')];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    const persisted = loadPersistedTabs(windowId);
    return persisted?.activeTabId || tabs[0]?.id || '';
  });
  
  // Get current tab
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  
  // Derived state from active tab
  const currentPath = activeTab?.path || '/';
  const history = activeTab?.history || ['/'];
  const historyIndex = activeTab?.historyIndex || 0;
  const isTrashMode = activeTab?.isTrashMode || false;
  const selectedTag = activeTab?.selectedTag || null;
  const selectedFiles = activeTab?.selectedFiles || new Set<string>();
  const searchQuery = activeTab?.searchQuery || '';
  
  // Update current tab helper
  const updateActiveTab = (updates: Partial<TabState>) => {
    setTabs(prev => prev.map(tab => 
      tab.id === activeTabId ? { ...tab, ...updates } : tab
    ));
  };
  
  // Setter wrappers for backward compatibility
  const setCurrentPath = (path: string) => updateActiveTab({ path });
  const setHistory = (h: string[] | ((prev: string[]) => string[])) => {
    setTabs(prev => prev.map(tab => 
      tab.id === activeTabId 
        ? { ...tab, history: typeof h === 'function' ? h(tab.history) : h }
        : tab
    ));
  };
  const setHistoryIndex = (idx: number | ((prev: number) => number)) => {
    setTabs(prev => prev.map(tab => 
      tab.id === activeTabId 
        ? { ...tab, historyIndex: typeof idx === 'function' ? idx(tab.historyIndex) : idx }
        : tab
    ));
  };
  const setIsTrashMode = (mode: boolean) => updateActiveTab({ isTrashMode: mode });
  const setSelectedTag = (tag: string | null) => updateActiveTab({ selectedTag: tag });
  const setSelectedFiles = (files: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setTabs(prev => prev.map(tab => 
      tab.id === activeTabId 
        ? { ...tab, selectedFiles: typeof files === 'function' ? files(tab.selectedFiles) : files }
        : tab
    ));
  };
  const setSearchQuery = (query: string) => updateActiveTab({ searchQuery: query });
  
  // Tab management functions
  const addTab = (path: string = '/') => {
    const newTab = createTab(path);
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };
  
  const closeTab = (tabId: string) => {
    if (tabs.length <= 1) return; // Don't close last tab
    
    const tabIndex = tabs.findIndex(t => t.id === tabId);
    const newTabs = tabs.filter(t => t.id !== tabId);
    setTabs(newTabs);
    
    // If we're closing the active tab, switch to adjacent tab
    if (tabId === activeTabId) {
      const newIndex = Math.min(tabIndex, newTabs.length - 1);
      setActiveTabId(newTabs[newIndex].id);
    }
  };

  // Persist tabs to localStorage whenever they change
  useEffect(() => {
    persistTabs(windowId, tabs, activeTabId);
  }, [tabs, activeTabId, windowId]);
  
  const [isDragging, setIsDragging] = useState(false);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [pendingRenameFolder, setPendingRenameFolder] = useState<string | null>(null);

  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isEmptyTrashConfirmOpen, setIsEmptyTrashConfirmOpen] = useState(false);
  const [isPermanentDeleteConfirmOpen, setIsPermanentDeleteConfirmOpen] = useState(false);
  const [filesToPermanentlyDelete, setFilesToPermanentlyDelete] = useState<string[]>([]);

  // Share dialog state
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [shareFile, setShareFile] = useState<FileInfo | null>(null);
  
  // Upload link dialog state
  const [isUploadLinkDialogOpen, setIsUploadLinkDialogOpen] = useState(false);

  // Tag dialog state (moved selectedTag to tab state)
  const [isTagDialogOpen, setIsTagDialogOpen] = useState(false);
  const [tagTargetFile, setTagTargetFile] = useState<FileInfo | null>(null);

  // Sort state (global across tabs)
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified'>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { tasks: uploadTasks, removeTask } = useUploadStore();
  const { openWindow, updateWindowAppState, windows } = useWindowStore();

  const { handleUploadFiles, resumeUpload } = useFileUpload(); // Use hook

  // Tag hooks
  const { data: userTags = [] } = useUserTags();
  const { data: taggedFiles = [], isLoading: isTagLoading } = useFilesByTag(selectedTag);


  useEffect(() => {
    if (!windowId) return;
    
    const state = useWindowStore.getState();
    const finderWindow = state.windows.find(w => w.id === windowId);

    if (finderWindow) {
      if (JSON.stringify(finderWindow.appState?.currentPath) !== JSON.stringify(history)) {
        updateWindowAppState(windowId, { currentPath: history });
      }
    }
  }, [history, updateWindowAppState, windowId]);

  // Listen for external navigation requests (e.g., from desktop folder double-click)
  useEffect(() => {
    if (!windowId) return;
    
    const finderWindow = windows.find(w => w.id === windowId);
    if (finderWindow?.appState?.navigateTo) {
      const targetPath = finderWindow.appState.navigateTo;
      // Clear the navigateTo state to prevent re-triggering
      updateWindowAppState(windowId, { navigateTo: undefined });
      // Navigate to the target path
      setIsTrashMode(false);
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(targetPath);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      setCurrentPath(targetPath);
      setSelectedFiles(new Set());
    }
  }, [windows, updateWindowAppState, history, historyIndex, windowId]);

  const { data: files, isLoading, refetch } = useFiles({
    path: currentPath,
    sortBy: sortBy,
    order: sortDirection,
    search: searchQuery,
  });
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

  const currentFilesRaw = isTrashMode ? trashFiles : files;
  const isCurrentLoading = selectedTag ? isTagLoading : (isTrashMode ? isTrashLoading : isLoading);

  // Convert tagged files to FileInfo format when in tag filter mode
  const tagFilteredFiles = React.useMemo((): FileInfo[] | undefined => {
    if (!selectedTag) return undefined;
    
    // Convert TaggedFile to FileInfo (return empty array if no files, not undefined)
    return taggedFiles.map(tf => {
      // Find the tag color from userTags
      const tagInfo = userTags.find(t => t.name === selectedTag);
      return {
        name: tf.name,
        path: tf.path,
        is_dir: tf.is_dir,
        size: tf.size,
        modified: tf.modified,
        mime_type: null,
        metadata: null,
        tags: [{ name: selectedTag, color: tagInfo?.color || null }],
        is_starred: false,
      };
    });
  }, [selectedTag, taggedFiles, userTags]);

  // Filter and sort files
  const currentFiles = React.useMemo(() => {
    // When filtering by tag, use the tagged files (need client-side sort since tag API may not support sorting)
    if (selectedTag) {
      const sourceFiles = tagFilteredFiles;
      if (!sourceFiles) return undefined;

      let filtered = sourceFiles;

      // Apply search filter for tag mode (backend search doesn't apply here)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(f => f.name.toLowerCase().includes(query));
      }

      // Apply sorting for tag-filtered files (client-side since these come from tag API)
      const sorted = [...filtered].sort((a, b) => {
        // Folders first
        if (a.is_dir && !b.is_dir) return -1;
        if (!a.is_dir && b.is_dir) return 1;

        let comparison = 0;
        switch (sortBy) {
          case 'name':
            comparison = a.name.localeCompare(b.name);
            break;
          case 'size':
            comparison = a.size - b.size;
            break;
          case 'modified':
            comparison = new Date(a.modified).getTime() - new Date(b.modified).getTime();
            break;
        }

        return sortDirection === 'asc' ? comparison : -comparison;
      });

      return sorted;
    }

    // For normal file listing and trash mode: backend already handles sorting & search
    // Just return data as-is
    if (!currentFilesRaw) return undefined;
    return currentFilesRaw;
  }, [selectedTag, tagFilteredFiles, currentFilesRaw, searchQuery, sortBy, sortDirection]);

  const handleNavigate = (path: string) => {
    if (path === currentPath && !isTrashMode && !selectedTag) return;
    setIsTrashMode(false);
    setSelectedTag(null); // Clear tag filter when navigating
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(path);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setCurrentPath(path);
    setSelectedFiles(new Set());
  };

  // Watch for new folder to appear in files list, then enter rename mode
  useEffect(() => {
    if (pendingRenameFolder && files) {
      const newFolder = files.find(f => f.name === pendingRenameFolder);
      if (newFolder) {
        setRenamingFile(newFolder.name);
        setRenameValue(newFolder.name);
        setPendingRenameFolder(null);
      }
    }
  }, [files, pendingRenameFolder]);

  // Quick Look (Spacebar), Delete keys, and Select All (Cmd+A)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip keyboard handling when dialogs are open
      if (isShareDialogOpen || isUploadLinkDialogOpen || isCreateFolderOpen || isEmptyTrashConfirmOpen || isPermanentDeleteConfirmOpen || isTagDialogOpen) {
        return;
      }

      // Select All - Cmd+A / Ctrl+A
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !renamingFile) {
        e.preventDefault();
        e.stopPropagation();
        if (currentFiles) {
          setSelectedFiles(new Set(currentFiles.map(f => f.name)));
        }
        return;
      }

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
        // Ignore Backspace when an input/textarea is focused (avoid accidental deletion while typing)
        if (e.key === 'Backspace') {
          const activeEl = document.activeElement;
          if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || (activeEl as HTMLElement).isContentEditable)) {
            return;
          }
        }

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
          // Delete: Move to trash with Toast notification + Undo
          const filesToDelete = Array.from(selectedFiles).map(fileName => {
            const file = currentFiles?.find(f => f.name === fileName);
            return {
              name: fileName,
              path: file?.path || (currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`),
            };
          });

          filesToDelete.forEach(({ path }) => deleteFile.mutate(path));
          setSelectedFiles(new Set());

          const fileNames = filesToDelete.map(f => f.name);
          const label = fileNames.length === 1
            ? `「${fileNames[0]}」已移至垃圾桶`
            : `${fileNames.length} 個項目已移至垃圾桶`;

          toast(label, {
            action: {
              label: '復原',
              onClick: () => {
                fileNames.forEach(name => restoreFromTrash.mutate(name));
              },
            },
            duration: 6000,
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [selectedFiles, currentFiles, renamingFile, openWindow, currentPath, deleteFile, restoreFromTrash, isShareDialogOpen, isUploadLinkDialogOpen, isCreateFolderOpen, isEmptyTrashConfirmOpen, isPermanentDeleteConfirmOpen, isTagDialogOpen]);

  // Mouse back/forward button navigation
  const finderContainerRef = React.useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleMouseButton = (e: MouseEvent) => {
      // Button 3 = Back button (mouse button 4)
      // Button 4 = Forward button (mouse button 5)
      if (e.button !== 3 && e.button !== 4) {
        return;
      }
      
      // Always prevent browser navigation for side buttons when in Finder
      if (!finderContainerRef.current?.contains(e.target as Node)) {
        return;
      }
      
      e.preventDefault();
      e.stopPropagation();
      
      // Skip navigation when dialogs are open
      if (isShareDialogOpen || isUploadLinkDialogOpen || isCreateFolderOpen || isEmptyTrashConfirmOpen || isPermanentDeleteConfirmOpen || isTagDialogOpen) {
        return;
      }
      
      // Only handle on mousedown for actual navigation
      if (e.type === 'mousedown') {
        if (e.button === 3 && historyIndex > 0) {
          setHistoryIndex(historyIndex - 1);
          setCurrentPath(history[historyIndex - 1]);
        } else if (e.button === 4 && historyIndex < history.length - 1) {
          setHistoryIndex(historyIndex + 1);
          setCurrentPath(history[historyIndex + 1]);
        }
      }
    };
    
    // We need to intercept all these events to fully prevent browser back/forward
    const events = ['mousedown', 'mouseup', 'auxclick'] as const;
    events.forEach(event => {
      window.addEventListener(event, handleMouseButton, { capture: true });
    });
    
    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleMouseButton, { capture: true });
      });
    };
  }, [historyIndex, history, isShareDialogOpen, isUploadLinkDialogOpen, isCreateFolderOpen, isEmptyTrashConfirmOpen, isPermanentDeleteConfirmOpen, isTagDialogOpen]);

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

  // 記錄最後一次點擊的檔案索引（用於 Shift+Click 範圍選取）
  const lastClickedIndexRef = React.useRef<number>(-1);

  const handleFileClick = (file: FileInfo, e: React.MouseEvent) => {
    const fileIndex = currentFiles?.findIndex(f => f.name === file.name) ?? -1;

    if (e.shiftKey && lastClickedIndexRef.current >= 0 && currentFiles) {
      // Shift+Click → 範圍選取（從 lastClickedIndex 到當前 index 的所有檔案）
      const start = Math.min(lastClickedIndexRef.current, fileIndex);
      const end = Math.max(lastClickedIndexRef.current, fileIndex);
      const newSelected = new Set(selectedFiles); // 保留既有選取（配合 Ctrl+Shift 使用）
      for (let i = start; i <= end; i++) {
        newSelected.add(currentFiles[i].name);
      }
      setSelectedFiles(newSelected);
      // 不更新 lastClickedIndex，允許連續 Shift+Click 延伸範圍
    } else if (e.metaKey || e.ctrlKey) {
      // Ctrl/Cmd+Click → 切換單一檔案
      const newSelected = new Set(selectedFiles);
      if (newSelected.has(file.name)) {
        newSelected.delete(file.name);
      } else {
        newSelected.add(file.name);
      }
      setSelectedFiles(newSelected);
      lastClickedIndexRef.current = fileIndex;
    } else {
      // 普通點擊 → 只選取該檔案
      setSelectedFiles(new Set([file.name]));
      lastClickedIndexRef.current = fileIndex;
    }
  };

  const handleFileDoubleClick = (file: FileInfo) => {
    // In trash mode, don't navigate to folders (paths are invalid)
    // Only allow preview for files
    if (isTrashMode) {
      if (!file.is_dir) {
        // Preview the file from trash
        openWindow('preview', file.name, { file: { ...file, path: file.path } });
      }
      // Do nothing for folders in trash - they can't be navigated
      return;
    }

    if (file.is_dir) {
      handleNavigate(currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`);
    } else {
      const fullPath = file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`);
      openWindow('preview', file.name, { file: { ...file, path: fullPath } });
    }
  };

  const handleDelete = (file: FileInfo) => {
    const fullPath = file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`);
    deleteFile.mutate(fullPath);

    toast(`「${file.name}」已移至垃圾桶`, {
      action: {
        label: '復原',
        onClick: () => {
          restoreFromTrash.mutate(file.name);
        },
      },
      duration: 6000,
    });
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
    setShareFile(file);
    setIsShareDialogOpen(true);
  };

  const handleCreateShareLink = async (options: {
    file_path: string;
    password?: string;
    expires_in_seconds?: number;
  }) => {
    const result = await createShare.mutateAsync({
      file_path: options.file_path,
      password: options.password,
      expires: options.expires_in_seconds
    });
    return result;
  };

  const handleCreateUploadLink = async (options: {
    target_path: string;
    password?: string;
    expires_in_seconds?: number;
    max_files?: number;
    max_file_size?: number;
  }) => {
    // TODO: Implement upload link API
    const response = await fetch('/api/upload-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        target_path: options.target_path,
        password: options.password,
        expires_in_seconds: options.expires_in_seconds,
        max_files: options.max_files,
        max_file_size: options.max_file_size,
      }),
    });
    if (!response.ok) throw new Error('Failed to create upload link');
    return response.json();
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

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) return;

    // Helper to read all files from a directory entry recursively
    const readEntriesRecursively = async (entry: FileSystemEntry, basePath: string): Promise<{ file: File; relativePath: string }[]> => {
      if (entry.isFile) {
        const fileEntry = entry as FileSystemFileEntry;
        return new Promise((resolve, reject) => {
          fileEntry.file(
            (file) => resolve([{ file, relativePath: basePath }]),
            reject
          );
        });
      } else if (entry.isDirectory) {
        const dirEntry = entry as FileSystemDirectoryEntry;
        const reader = dirEntry.createReader();
        const entries: FileSystemEntry[] = [];

        // Read all entries (may require multiple calls for large directories)
        const readEntries = (): Promise<FileSystemEntry[]> => new Promise((resolve, reject) => {
          reader.readEntries(resolve, reject);
        });

        let batch = await readEntries();
        while (batch.length > 0) {
          entries.push(...batch);
          batch = await readEntries();
        }

        const allFiles: { file: File; relativePath: string }[] = [];
        for (const childEntry of entries) {
          const childPath = basePath ? `${basePath}/${childEntry.name}` : childEntry.name;
          const childFiles = await readEntriesRecursively(childEntry, childPath);
          allFiles.push(...childFiles);
        }
        return allFiles;
      }
      return [];
    };

    try {
      const allFilesWithPaths: { file: File; relativePath: string }[] = [];
      const dirsToCreate = new Set<string>();

      // Process all dropped items
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          if (entry.isDirectory) {
            // Collect directory path to create
            dirsToCreate.add(entry.name);
          }
          const filesFromEntry = await readEntriesRecursively(entry, entry.isDirectory ? entry.name : '');

          // Collect all subdirectories that need to be created
          filesFromEntry.forEach(({ relativePath }) => {
            const parts = relativePath.split('/');
            if (parts.length > 1) {
              // Add all parent directories
              let dirPath = '';
              for (let j = 0; j < parts.length - 1; j++) {
                dirPath = dirPath ? `${dirPath}/${parts[j]}` : parts[j];
                dirsToCreate.add(dirPath);
              }
            }
          });

          allFilesWithPaths.push(...filesFromEntry);
        }
      }

      // Create directories first (sorted by depth to create parents first)
      const sortedDirs = Array.from(dirsToCreate).sort((a, b) => a.split('/').length - b.split('/').length);
      for (const dir of sortedDirs) {
        // Split into parent path and folder name
        const dirParts = dir.split('/');
        const folderName = dirParts.pop() || dir;
        const parentDir = dirParts.join('/');
        const fullParentPath = currentPath
          ? (parentDir ? `${currentPath}/${parentDir}` : currentPath)
          : parentDir;
        try {
          await createFolder.mutateAsync({ path: fullParentPath, name: folderName });
        } catch (err: any) {
          // Ignore if directory already exists (409 Conflict)
          if (err?.response?.status !== 409) {
            console.warn(`Failed to create directory ${dir}:`, err);
          }
        }
      }

      // Now upload files with their correct relative paths
      // Group files by target directory for batch upload
      const filesByDir = new Map<string, File[]>();
      for (const { file, relativePath } of allFilesWithPaths) {
        const targetDir = relativePath.includes('/')
          ? relativePath.substring(0, relativePath.lastIndexOf('/'))
          : '';
        const uploadPath = currentPath
          ? (targetDir ? `${currentPath}/${targetDir}` : currentPath)
          : targetDir;
        
        if (!filesByDir.has(uploadPath)) {
          filesByDir.set(uploadPath, []);
        }
        filesByDir.get(uploadPath)!.push(file);
      }

      // Upload all groups concurrently (each group uses the upload queue internally)
      const uploadPromises = Array.from(filesByDir.entries()).map(
        ([uploadPath, groupFiles]) => handleUploadFiles(groupFiles, uploadPath)
      );
      await Promise.allSettled(uploadPromises);

      // Refresh file list
      await queryClient.invalidateQueries({ queryKey: ['files'] });
    } catch (error) {
      console.error('Folder upload failed:', error);
      // Fallback to simple file upload
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        await handleUploadFiles(files, currentPath);
      }
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

      // Set pending rename - useEffect will handle entering rename mode when folder appears
      setPendingRenameFolder(name);

      // Refetch to get the new folder
      await refetch();
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
    <div 
      ref={finderContainerRef}
      className="flex h-full bg-white/50 dark:bg-black/50 backdrop-blur-xl rounded-lg overflow-hidden border border-white/20 shadow-2xl"
    >
      <Sidebar
        currentPath={currentPath}
        isTrashMode={isTrashMode}
        favorites={favorites}
        tags={userTags}
        selectedTag={selectedTag}
        onNavigate={handleNavigate}
        onTrashMode={handleTrashMode}
        onFavoriteClick={handleFavoriteClick}
        onTagClick={(tagName) => {
          setSelectedTag(tagName);
          setIsTrashMode(false);
          setSelectedFiles(new Set());
        }}
        onManageTags={() => setIsTagDialogOpen(true)}
      />

      <div className="flex-1 flex flex-col min-w-0 bg-white/40 dark:bg-black/40 relative">
        {/* Tab Bar */}
        <div className="h-9 flex items-center bg-white/30 dark:bg-black/30 shrink-0">
          <div className="flex-1 flex items-center gap-0.5 px-1 overflow-x-auto scrollbar-none">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              const tabName = tab.isTrashMode 
                ? 'Trash' 
                : tab.selectedTag 
                  ? tab.selectedTag 
                  : tab.path === '/' 
                    ? 'Home' 
                    : tab.path.split('/').filter(Boolean).pop() || 'Home';
              
              return (
                <div
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={cn(
                    "group flex items-center gap-1.5 h-7 px-3 rounded-md cursor-pointer transition-all duration-150 min-w-0 max-w-[180px]",
                    isActive
                      ? "bg-white/60 dark:bg-white/10 shadow-sm"
                      : "hover:bg-white/40 dark:hover:bg-white/5"
                  )}
                >
                  <span className={cn(
                    "text-xs truncate",
                    isActive 
                      ? "text-gray-800 dark:text-gray-200 font-medium" 
                      : "text-gray-600 dark:text-gray-400"
                  )}>
                    {tabName}
                  </span>
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      className={cn(
                        "shrink-0 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors",
                        isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      )}
                    >
                      <X className="w-3 h-3 text-gray-500" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button
            onClick={() => addTab('/')}
            className="shrink-0 p-1.5 mr-1 rounded hover:bg-white/40 dark:hover:bg-white/10 transition-colors"
            title="New Tab"
          >
            <Plus className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        
        <Toolbar
          currentPath={currentPath}
          isTrashMode={isTrashMode}
          viewMode={viewMode}
          historyIndex={historyIndex}
          historyLength={history.length}
          searchQuery={searchQuery}
          onNavigate={handleNavigate}
          onBack={handleBack}
          onForward={handleForward}
          onEmptyTrash={() => setIsEmptyTrashConfirmOpen(true)}
          onUploadClick={() => fileInputRef.current?.click()}
          onCreateUploadLink={() => setIsUploadLinkDialogOpen(true)}
          onViewModeChange={setViewMode}
          onSearchChange={setSearchQuery}
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
          sortBy={sortBy}
          sortDirection={sortDirection}
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
          onTag={(file) => {
            setTagTargetFile(file);
            setIsTagDialogOpen(true);
          }}
          onCreateFolder={() => handleCreateFolder()}
          onUpload={() => fileInputRef.current?.click()}
          onRefresh={() => isTrashMode ? refetchTrash() : refetch()}
          onViewModeChange={setViewMode}
          onSortChange={(field) => {
            if (field === sortBy) {
              setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
            } else {
              setSortBy(field);
              setSortDirection('asc');
            }
          }}
          onSelectionChange={setSelectedFiles}
        />

        {/* Status Bar */}
        <div className="min-h-[32px] max-h-[120px] flex flex-col justify-center px-4 py-1 border-t border-white/10 bg-white/40 dark:bg-black/40 text-xs text-gray-500 backdrop-blur-md shrink-0">
          {(() => {
            const activeTasks = Object.values(uploadTasks).filter(t => t.path === currentPath && (t.status === 'uploading' || t.status === 'error'));
            if (activeTasks.length > 0) {
              const totalTasks = activeTasks.length;
              const completedCount = activeTasks.filter(t => t.progress === 100).length;
              const avgProgress = Math.round(activeTasks.reduce((s, t) => s + t.progress, 0) / totalTasks);
              return (
                <div className="flex flex-col gap-1 w-full py-1 overflow-y-auto scrollbar-thin">
                  {/* Summary line */}
                  <div className="flex items-center gap-2 w-full shrink-0">
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shrink-0" />
                    <span className="shrink-0">Uploading {totalTasks} files ({completedCount} done)</span>
                    <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${avgProgress}%` }} />
                    </div>
                    <span className="w-10 text-right shrink-0">{avgProgress}%</span>
                  </div>
                  {/* Individual tasks (only show a few) */}
                  {activeTasks.filter(t => t.status === 'error').map((task) => (
                    <div key={task.id} className="flex items-center gap-2 w-full shrink-0">
                      <span className="truncate max-w-[150px] text-red-500">{task.file.name}</span>
                      <span className="text-red-500 text-[10px] truncate">{task.error}</span>
                      {task.uploadId && (
                        <button
                          onClick={() => resumeUpload(task.id)}
                          className="p-1 hover:bg-black/5 dark:hover:bg-white/10 rounded text-blue-600 dark:text-blue-400"
                          title="Resume Upload"
                        >
                          <RefreshCw className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              );
            }
            return <span>{currentFiles ? `${currentFiles.length} items` : 'Loading...'}</span>;
          })()}
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

      {/* Share Dialog */}
      <ShareDialog
        isOpen={isShareDialogOpen}
        onClose={() => {
          setIsShareDialogOpen(false);
          setShareFile(null);
        }}
        fileName={shareFile?.name || ''}
        filePath={shareFile?.path || (shareFile ? (currentPath === '/' ? `/${shareFile.name}` : `${currentPath}/${shareFile.name}`) : '')}
        isDirectory={shareFile?.is_dir}
        onCreateShare={handleCreateShareLink}
      />

      {/* Upload Link Dialog */}
      <UploadLinkDialog
        isOpen={isUploadLinkDialogOpen}
        onClose={() => setIsUploadLinkDialogOpen(false)}
        targetPath={currentPath}
        onCreateUploadLink={handleCreateUploadLink}
      />

      {/* Tag Dialog */}
      <TagDialog
        open={isTagDialogOpen}
        onOpenChange={setIsTagDialogOpen}
        file={tagTargetFile}
      />
    </div>
  );
};