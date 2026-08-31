"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  useFiles,
  useCreateFolder,
  useRename,
  useBatchDelete,
  useDelete,
} from "@/features/files/api/useFiles";
import { getApiErrorStatus } from "@/lib/errors";
import { useWindowStore } from "@/store/window-store";
import { useQueryClient } from "@tanstack/react-query";
import type { FileInfo } from "@/types/api";
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  type KeyboardCoordinateGetter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { DraggableDesktopIcon } from "./DraggableDesktopIcon";
import { defaultIconPosition, GRID_STEP, type IconPosition, movePositionBy } from "./icon-grid";

/**
 * 鍵盤拖曳時，方向鍵一次走**一整格**而不是 dnd-kit 預設的 25px。
 *
 * 預設值對自由定位的介面才合理；這裡是網格，走 25px 的話要按四次才移動一格，
 * 而中間三次的視覺回饋是「圖示卡在格線之間」。
 */
const moveByOneCell: KeyboardCoordinateGetter = (event, { currentCoordinates }) => {
  const step = {
    ArrowRight: { x: GRID_STEP, y: 0 },
    ArrowLeft: { x: -GRID_STEP, y: 0 },
    ArrowDown: { x: 0, y: GRID_STEP },
    ArrowUp: { x: 0, y: -GRID_STEP },
  }[event.code];
  if (!step) return undefined;
  event.preventDefault();
  return { x: currentCoordinates.x + step.x, y: currentCoordinates.y + step.y };
};

// Type for storing icon positions
// Default positions will be calculated based on order

export const DesktopIcons = () => {
  const { data: files, refetch } = useFiles({ path: "/Desktop" });
  const createFolder = useCreateFolder();
  const renameFile = useRename();
  const { openWindow, windows, updateWindowAppState, focusWindow } = useWindowStore();
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(() => new Set());
  const queryClient = useQueryClient();
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newFolderName] = useState("新資料夾");

  // State for icon positions
  const [iconPositions, setIconPositions] = useState<Map<string, IconPosition>>(() => {
    const saved = localStorage.getItem("desktop-icon-positions");
    if (!saved) return new Map();
    try {
      // localStorage 的內容不受我們控制，cast 只是宣告「我們期望的形狀」
      return new Map(Object.entries(JSON.parse(saved) as Record<string, IconPosition>));
    } catch (e) {
      console.error("Failed to load icon positions", e);
      return new Map();
    }
  });

  const batchDelete = useBatchDelete();
  const deleteFile = useDelete();

  // Save positions to localStorage when they change
  useEffect(() => {
    if (iconPositions.size > 0) {
      const obj = Object.fromEntries(iconPositions);
      localStorage.setItem("desktop-icon-positions", JSON.stringify(obj));
    }
  }, [iconPositions]);

  // Calculate default position for a file
  const getFilePosition = (file: FileInfo, index: number): IconPosition => {
    // Check if we have a saved position
    const saved = iconPositions.get(file.path);
    if (saved) return saved;

    // 排列方向與邊界見 desktop/icon-grid.ts（純函式、有測試）
    return defaultIconPosition(index);
  };

  // ⚠️ PointerSensor 而不是 MouseSensor —— 手刻的版本只聽 mousedown/mousemove，
  // 觸控裝置上桌面圖示**完全不能移動**。pointer 事件把滑鼠、觸控、觸控筆
  // 一次涵蓋。
  //
  // distance: 5 沿用原本的 DRAG_THRESHOLD：沒有它的話，單純點一下也會被
  // 當成拖曳的開始，選取與開啟都會失靈。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: moveByOneCell,
      // Enter 留給「開啟」（見 DraggableDesktopIcon 的 onKeyDown），
      // 所以拿起／放下只綁空白鍵。
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

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
  //
  // ⚠️ 必須是 effect：要等列表重新抓回來、新資料夾那一格出現，才有東西可以聚焦。
  /* oxlint-disable @eslint-react/set-state-in-effect */
  useEffect(() => {
    if (pendingRenameFolder && files) {
      const newFolder = files.find((f) => f.name === pendingRenameFolder);
      if (newFolder) {
        setRenamingFile(newFolder.path);
        setRenameValue(newFolder.name);
        setPendingRenameFolder(null);
      }
    }
  }, [files, pendingRenameFolder]);
  /* oxlint-enable @eslint-react/set-state-in-effect */

  // Listen for desktop-create-folder event from GlobalContextMenu
  useEffect(() => {
    const handleCreateFolder = async () => {
      try {
        // Refetch to get fresh data for accurate duplicate detection
        const { data: latestFiles } = await refetch();
        const currentFiles = latestFiles ?? [];

        // Generate a unique name if "新資料夾" exists
        let name = newFolderName;
        let counter = 1;

        while (currentFiles.some((f) => f.name === name)) {
          name = `${newFolderName}${counter}`;
          counter++;
        }

        // Try to create folder, with retry logic for 409 conflicts
        let created = false;
        let attempts = 0;
        const maxAttempts = 10;

        while (!created && attempts < maxAttempts) {
          try {
            await createFolder.mutateAsync({ path: "Desktop", name });
            created = true;
          } catch (error: unknown) {
            if (getApiErrorStatus(error) === 409) {
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
          throw new Error("無法創建資料夾,請稍後再試");
        }

        // Wait a bit for the mutation's onSuccess to complete
        // 這是「等一下再 refetch」的睡眠，不是掛在元件上的 timer——promise 一
        // resolve 就沒了，沒有需要 cleanup 的東西。
        // oxlint-disable-next-line @eslint-react/web-api-no-leaked-timeout
        await new Promise((resolve) => setTimeout(resolve, 300));

        // Trigger refetch to get the new folder and wait for it
        const { data: updatedFiles } = await refetch();

        // Only set pending rename after we've confirmed the folder exists
        if (updatedFiles?.some((f) => f.name === name)) {
          setPendingRenameFolder(name);
        } else {
          // If folder doesn't appear yet, try one more refetch
          // oxlint-disable-next-line @eslint-react/web-api-no-leaked-timeout
          await new Promise((resolve) => setTimeout(resolve, 200));
          await refetch();
          setPendingRenameFolder(name);
        }
      } catch (error) {
        console.error("Failed to create folder:", error);
        alert("建立資料夾失敗");
      }
    };

    // ⚠️ 包裝要先綁成變數：addEventListener / removeEventListener 必須拿到
    // **同一個函式參照**，兩處各寫一個 inline 箭頭函式的話移除會失效，
    // 監聽器會隨每次 effect 重跑累積。
    const onCreateFolder = () => void handleCreateFolder();
    window.addEventListener("desktop-create-folder", onCreateFolder);
    return () => window.removeEventListener("desktop-create-folder", onCreateFolder);
  }, [createFolder, refetch, newFolderName]);

  // Listen for delete event (e.g. from context menu or keyboard)
  useEffect(() => {
    const handleDelete = async () => {
      if (selectedFiles.size === 0) return;

      if (confirm(`確定要刪除選取的 ${selectedFiles.size} 個項目嗎？`)) {
        try {
          const [only] = Array.from(selectedFiles);
          if (selectedFiles.size === 1 && only !== undefined) {
            await deleteFile.mutateAsync(only);
          } else {
            await batchDelete.mutateAsync(Array.from(selectedFiles));
          }
          setSelectedFiles(new Set());
        } catch (error) {
          console.error("Delete failed:", error);
          alert("刪除失敗");
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedFiles.size > 0 &&
        !renamingFile
      ) {
        void handleDelete();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    // 同上：包裝先綁成變數，否則 removeEventListener 拿到的是另一個函式
    const onDeleteSelected = () => void handleDelete();
    window.addEventListener("desktop-delete-selected", onDeleteSelected);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("desktop-delete-selected", onDeleteSelected);
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
  const { data: rootFiles } = useFiles({ path: "/" });
  const hasCheckedDesktopRef = useRef(false);

  useEffect(() => {
    if (rootFiles && !hasCheckedDesktopRef.current) {
      hasCheckedDesktopRef.current = true;
      const hasDesktop = rootFiles.some((f) => f.name === "Desktop" && f.is_dir);
      if (!hasDesktop) {
        createFolder.mutate({ path: "/", name: "Desktop" });
      }
    }
  }, [rootFiles, createFolder]);

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
      const existingFinder = windows.find((w) => w.appType === "finder" && !w.isMinimized);
      if (existingFinder) {
        // Navigate in existing window
        updateWindowAppState(existingFinder.id, { navigateTo: file.path });
        focusWindow(existingFinder.id);
      } else {
        // Open new Finder window
        openWindow("finder", file.name, { initialPath: file.path });
      }
    } else {
      openWindow("preview", file.name, { file });
    }
  };

  const handleRenameSubmit = async () => {
    if (!renamingFile || !renameValue) {
      setRenamingFile(null);
      return;
    }

    const file = files?.find((f) => f.path === renamingFile);

    if (!file || renameValue === file.name) {
      setRenamingFile(null);
      return;
    }

    try {
      await renameFile.mutateAsync({
        path: renamingFile,
        newName: renameValue,
      });
      await queryClient.invalidateQueries({ queryKey: ["files", "/Desktop"] });
      setRenamingFile(null);
    } catch (error) {
      console.error("Rename failed:", error);
      alert("重新命名失敗");
      setRenamingFile(null);
    }
  };

  // Handle selection box
  useEffect(() => {
    const handleSelectionChange = (e: Event) => {
      const customEvent = e as CustomEvent<{
        rect: { left: number; top: number; width: number; height: number };
      }>;
      const { rect } = customEvent.detail;
      // Calculate right and bottom from rect dimensions
      const rectRight = rect.left + rect.width;
      const rectBottom = rect.top + rect.height;

      const newSelected = new Set<string>();

      // Check intersection with each icon
      const icons = document.querySelectorAll('[data-context-type="desktop-icon"]');
      icons.forEach((icon) => {
        const iconRect = icon.getBoundingClientRect();
        const path = icon.getAttribute("data-context-id");

        if (
          path &&
          !(
            rect.left > iconRect.right ||
            rectRight < iconRect.left ||
            rect.top > iconRect.bottom ||
            rectBottom < iconRect.top
          )
        ) {
          newSelected.add(path);
        }
      });

      setSelectedFiles(newSelected);
    };

    const handleSelectionEnd = () => {
      // Optional: Finalize selection logic if needed
    };

    window.addEventListener("desktop-selection-change", handleSelectionChange);
    window.addEventListener("desktop-selection-end", handleSelectionEnd);

    return () => {
      window.removeEventListener("desktop-selection-change", handleSelectionChange);
      window.removeEventListener("desktop-selection-end", handleSelectionEnd);
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

    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, []);

  if (!files) return null;

  // 拖曳結束：用**位移**算落點，不是游標位置（理由見 icon-grid.ts 的 movePositionBy）
  const handleDragEnd = (event: DragEndEvent) => {
    const path = String(event.active.id);
    const index = files.findIndex((f) => f.path === path);
    if (index < 0) return;
    const file = files[index];
    if (!file) return;
    handlePositionChange(path, movePositionBy(getFilePosition(file, index), event.delta));
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
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
                onRenameSubmit={() => void handleRenameSubmit()}
                onRenameCancel={() => setRenamingFile(null)}
              />
            </div>
          );
        })}
      </div>
    </DndContext>
  );
};
