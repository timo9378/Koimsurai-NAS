'use client';

import React, { useEffect, useState } from 'react';
import { useFiles, useCreateFolder, useRename, useBatchDelete, useDelete } from '@/features/files/api/useFiles';
import { useWindowStore } from '@/store/window-store';
import { useQueryClient } from '@tanstack/react-query';
import { FileInfo } from '@/types/api';
import { DraggableDesktopIcon } from './DraggableDesktopIcon';

// Type for storing icon positions
interface IconPosition {
  row: number;
  col: number;
}

// Default positions will be calculated based on order
const GRID_SIZE = 100;
const GRID_GAP = 8;

export const DesktopIcons = () => {
  const { data: files, error, refetch } = useFiles({ path: '/Desktop' });
  const createFolder = useCreateFolder();
  const renameFile = useRename();
  const { openWindow, windows, updateWindowAppState, focusWindow } = useWindowStore();
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newFolderName] = useState('新資料夾');

  // State for icon positions
  const [iconPositions, setIconPositions] = useState<Map<string, IconPosition>>(new Map());

  const batchDelete = useBatchDelete();
  const deleteFile = useDelete();

  // Load positions from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('desktop-icon-positions');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setIconPositions(new Map(Object.entries(parsed)));
      } catch (e) {
        console.error('Failed to load icon positions', e);
      }
    }
  }, []);

  // Save positions to localStorage when they change
  useEffect(() => {
    if (iconPositions.size > 0) {
      const obj = Object.fromEntries(iconPositions);
      localStorage.setItem('desktop-icon-positions', JSON.stringify(obj));
    }
  }, [iconPositions]);

  // Calculate default position for a file
  const getFilePosition = (file: FileInfo, index: number): IconPosition => {
    // Check if we have a saved position
    if (iconPositions.has(file.path)) {
      return iconPositions.get(file.path)!;
    }

    // Calculate default position based on index
    // Icons flow top to bottom, then left to right
    const iconsPerColumn = 8; // Adjust based on screen height
    const col = Math.floor(index / iconsPerColumn);
    const row = index % iconsPerColumn;

    return { row, col };
  };

  const handlePositionChange = (filePath: string, newPosition: IconPosition) => {
    setIconPositions((prev) => {
      const newMap = new Map(prev);
      newMap.set(filePath, newPosition);
      return newMap;
    });
  };

  // State to track pending folder rename after creation
  const [pendingRenameFolder, setPendingRenameFolder] = useState<string | null>(null);

  // Watch for new folder to appear in files list, then enter rename mode
  useEffect(() => {
    if (pendingRenameFolder && files) {
      const newFolder = files.find(f => f.name === pendingRenameFolder);
      if (newFolder) {
        setRenamingFile(newFolder.path);
        setRenameValue(newFolder.name);
        setPendingRenameFolder(null);
      }
    }
  }, [files, pendingRenameFolder]);

  // Listen for desktop-create-folder event from GlobalContextMenu
  useEffect(() => {
    const handleCreateFolder = async () => {
      try {
        // Refetch to get fresh data for accurate duplicate detection
        const { data: latestFiles } = await refetch();
        const currentFiles = latestFiles || [];

        // Generate a unique name if "新資料夾" exists
        let name = newFolderName;
        let counter = 1;

        while (currentFiles.some(f => f.name === name)) {
          name = `${newFolderName}${counter}`;
          counter++;
        }

        // Try to create folder, with retry logic for 409 conflicts
        let created = false;
        let attempts = 0;
        const maxAttempts = 10;

        while (!created && attempts < maxAttempts) {
          try {
            await createFolder.mutateAsync({ path: 'Desktop', name });
            created = true;
          } catch (error: any) {
            if (error?.response?.status === 409) {
              // Folder already exists, try next name
              name = `${newFolderName}${counter}`;
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

        // Trigger refetch to get the new folder
        await refetch();
      } catch (error) {
        console.error('Failed to create folder:', error);
        alert('建立資料夾失敗');
      }
    };

    window.addEventListener('desktop-create-folder', handleCreateFolder);
    return () => window.removeEventListener('desktop-create-folder', handleCreateFolder);
  }, [createFolder, refetch, newFolderName]);

  // Listen for delete event (e.g. from context menu or keyboard)
  useEffect(() => {
    const handleDelete = async () => {
      if (selectedFiles.size === 0) return;

      if (confirm(`確定要刪除選取的 ${selectedFiles.size} 個項目嗎？`)) {
        try {
          if (selectedFiles.size === 1) {
            const path = Array.from(selectedFiles)[0];
            await deleteFile.mutateAsync(path);
          } else {
            await batchDelete.mutateAsync(Array.from(selectedFiles));
          }
          setSelectedFiles(new Set());
        } catch (error) {
          console.error('Delete failed:', error);
          alert('刪除失敗');
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFiles.size > 0 && !renamingFile) {
        handleDelete();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    // We can also listen to a custom event if needed for context menu delete
    window.addEventListener('desktop-delete-selected', handleDelete);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('desktop-delete-selected', handleDelete);
    };
  }, [selectedFiles, batchDelete, deleteFile, renamingFile]);

  // Check if Desktop folder exists, if not create it
  useEffect(() => {
    // This is a bit of a heuristic. Ideally the backend ensures this.
    // If we get an error or if we could check specific error code, we would know.
    // For now, let's assume if 'files' is undefined and we mount, we might need to create it.
    // BUT 'useFiles' might just return empty array if empty.
    // Better strategy: Check root first? Or just try to create on mount if we catch an error?
    // Let's rely on the fact that if useFiles returns error (404), we try to create.

    // Actually, useFiles logic:
    // queryFn: ... apiClient.get ...
    // If it fails, error will be populated.

    // Note: React Query doesn't automatically trigger creation.
    // We can use a side effect here.
  }, [files]);

  // Actually, we can just try to create it once on mount if we want to be sure.
  // But that might spam 409 Conflict.
  // Let's check root files list?
  const { data: rootFiles } = useFiles({ path: '/' });
  const [hasCheckedDesktop, setHasCheckedDesktop] = useState(false);

  useEffect(() => {
    if (rootFiles && !hasCheckedDesktop) {
      const hasDesktop = rootFiles.some(f => f.name === 'Desktop' && f.is_dir);
      if (!hasDesktop) {
        createFolder.mutate({ path: '/', name: 'Desktop' });
      }
      setHasCheckedDesktop(true);
    }
  }, [rootFiles, createFolder, hasCheckedDesktop]);

  const handleIconClick = (e: React.MouseEvent, file: FileInfo) => {
    e.stopPropagation();

    // If ctrl/cmd is pressed, toggle selection
    if (e.ctrlKey || e.metaKey) {
      const newSet = new Set(selectedFiles);
      if (newSet.has(file.path)) newSet.delete(file.path);
      else newSet.add(file.path);
      setSelectedFiles(newSet);
    } else {
      // Otherwise select only this
      setSelectedFiles(new Set([file.path]));
    }
  };

  const handleDoubleClick = (file: FileInfo) => {
    if (renamingFile) return; // Don't open if renaming

    if (file.is_dir) {
      // Windows-style: Reuse existing Finder window if available
      const existingFinder = windows.find(w => w.appType === 'finder' && !w.isMinimized);
      if (existingFinder) {
        // Navigate in existing window
        updateWindowAppState(existingFinder.id, { navigateTo: file.path });
        focusWindow(existingFinder.id);
      } else {
        // Open new Finder window
        openWindow('finder', file.name, { initialPath: file.path });
      }
    } else {
      openWindow('preview', file.name, { file });
    }
  };

  const handleRenameSubmit = async () => {
    if (!renamingFile || !renameValue) {
      setRenamingFile(null);
      return;
    }

    const file = files?.find(f => f.path === renamingFile);

    if (!file || renameValue === file.name) {
      setRenamingFile(null);
      return;
    }

    try {
      await renameFile.mutateAsync({
        path: renamingFile,
        newName: renameValue
      });
      await queryClient.invalidateQueries({ queryKey: ['files', '/Desktop'] });
      setRenamingFile(null);
    } catch (error) {
      console.error('Rename failed:', error);
      alert('重新命名失敗');
      setRenamingFile(null);
    }
  };

  // Handle selection box
  useEffect(() => {
    const handleSelectionChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ rect: { left: number; top: number; width: number; height: number } }>;
      const { rect } = customEvent.detail;
      // Calculate right and bottom from rect dimensions
      const rectRight = rect.left + rect.width;
      const rectBottom = rect.top + rect.height;

      const newSelected = new Set<string>();

      // Check intersection with each icon
      const icons = document.querySelectorAll('[data-context-type="desktop-icon"]');
      icons.forEach((icon) => {
        const iconRect = icon.getBoundingClientRect();
        const path = icon.getAttribute('data-context-id');

        if (path && !(rect.left > iconRect.right ||
          rectRight < iconRect.left ||
          rect.top > iconRect.bottom ||
          rectBottom < iconRect.top)) {
          newSelected.add(path);
        }
      });

      setSelectedFiles(newSelected);
    };

    const handleSelectionEnd = () => {
      // Optional: Finalize selection logic if needed
    };

    window.addEventListener('desktop-selection-change', handleSelectionChange);
    window.addEventListener('desktop-selection-end', handleSelectionEnd);

    return () => {
      window.removeEventListener('desktop-selection-change', handleSelectionChange);
      window.removeEventListener('desktop-selection-end', handleSelectionEnd);
    };
  }, [files]);

  // Clear selection when clicking empty space is handled by DesktopLayout via event bubbling?
  // No, we need to listen to clicks on the container, but DesktopLayout handles the background click.
  // We can expose a clearSelection method or use a global store for selection.
  // For now, simpler: DesktopLayout clicks reset selection if we lift state up.
  // Let's keep it local for now. If user clicks background, 'handleMouseDown' in DesktopLayout fires.
  // But that's for rubber band.

  // We can add a listener to window for 'click' to clear selection if target is not an icon?
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // If the click target is NOT inside a desktop-icon, clear selection
      const target = e.target as HTMLElement;
      if (!target.closest('[data-context-type="desktop-icon"]')) {
        setSelectedFiles(new Set());
      }
    };

    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, []);

  if (!files) return null;

  return (
    <>
      <div className="absolute top-12 left-0 right-0 bottom-0 p-4 z-0 pointer-events-none">
        {files.map((file, index) => {
          const position = getFilePosition(file, index);
          return (
            <div key={file.path} className="pointer-events-auto">
              <DraggableDesktopIcon
                file={file}
                isSelected={selectedFiles.has(file.path)}
                isRenaming={renamingFile === file.path}
                renameValue={renameValue}
                position={position}
                onClick={(e) => handleIconClick(e, file)}
                onDoubleClick={() => handleDoubleClick(file)}
                onRenameChange={setRenameValue}
                onRenameSubmit={handleRenameSubmit}
                onRenameCancel={() => setRenamingFile(null)}
                onPositionChange={(newPos) => handlePositionChange(file.path, newPos)}
              />
            </div>
          );
        })}
      </div>
    </>
  );
};