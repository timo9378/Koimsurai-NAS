"use client";

import React, { useRef } from "react";
import { Virtuoso, VirtuosoGrid } from "react-virtuoso";
import {
  Upload,
  Trash2,
  Download,
  Share2,
  Star,
  StarOff,
  Tags,
  History,
  Edit2,
  Copy,
  Info,
  Plus,
  RefreshCw,
  LayoutGrid,
  List as ListIcon,
  Move,
  Folder,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FileInfo } from "@/types/api";
import { useThumbnail } from "@/features/files/api/useFiles";
import { FileTypeIcon } from "@/lib/file-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MOVE_MIME } from "@/lib/dnd";
import { itemsInMarquee, type MarqueeBox, type MarqueeLayout } from "./marquee";
import { joinPath } from "@/lib/paths";

const FileIcon = ({ file, currentPath }: { file: FileInfo; currentPath?: string }) => {
  const isImage = file.mime_type?.startsWith("image/");

  const thumbnailPath = isImage
    ? file.path
      ? file.path
      : currentPath && currentPath !== "/"
        ? `${currentPath.replace(/^\//, "")}/${file.name}`
        : file.name
    : ""; // Empty string disables the query due to enabled: !!path

  const { data: thumbnail } = useThumbnail(thumbnailPath, "medium");

  // 圖片檔案：優先顯示縮圖
  if (isImage && thumbnail) {
    return (
      <img src={thumbnail} alt={file.name} className="w-12 h-12 object-cover rounded shadow-sm" />
    );
  }

  // 其他檔案類型：使用 FileTypeIcon
  return (
    <FileTypeIcon
      filename={file.name}
      isDir={file.is_dir}
      mimeType={file.mime_type ?? undefined}
      size="xl"
    />
  );
};

const SmallFileIcon = ({ file }: { file: FileInfo }) => {
  return (
    <FileTypeIcon
      filename={file.name}
      isDir={file.is_dir}
      mimeType={file.mime_type ?? undefined}
      size="sm"
    />
  );
};

interface FileListProps {
  files?: FileInfo[];
  isLoading: boolean;
  viewMode: "grid" | "list";
  currentPath: string;
  selectedFiles: Set<string>;
  renamingFile: string | null;
  renameValue: string;
  isTrashMode: boolean;
  isDragging: boolean;
  sortBy?: "name" | "size" | "modified";
  sortDirection?: "asc" | "desc";
  onFileClick: (file: FileInfo, e: React.MouseEvent) => void;
  onFileDoubleClick: (file: FileInfo) => void;
  onSelectionClear: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  // Context Menu Actions
  onRestore?: (name: string) => void;
  onDelete?: (file: FileInfo) => void;
  onDownload?: (path: string) => void;
  onShare?: (file: FileInfo) => void;
  onToggleStar?: (path: string) => void;
  onRenameStart?: (file: FileInfo) => void;
  onTag?: (file: FileInfo) => void;
  onCreateFolder?: () => void;
  onUpload?: () => void;
  onRefresh?: () => void;
  onViewModeChange?: (mode: "grid" | "list") => void;
  onSortChange?: (field: "name" | "size" | "modified") => void;
  onMoveFiles?: (sourceNames: string[], targetFolderName: string) => void;
}

// VirtuosoGrid custom components — defined outside the component to avoid re-renders
const gridComponents = {
  // React 19 起 ref 就是一般的 prop，不需要 forwardRef 包一層
  List: ({
    style,
    children,
    ref,
    ...props
  }: React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }) => (
    <div
      ref={ref}
      {...props}
      style={style}
      className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-4 p-4 content-start"
    >
      {children}
    </div>
  ),
  Item: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
};

export const FileList = ({
  files,
  isLoading,
  viewMode,
  currentPath,
  selectedFiles,
  renamingFile,
  renameValue,
  isTrashMode,
  isDragging,
  sortBy = "name",
  sortDirection = "asc",
  onFileClick,
  onFileDoubleClick,
  onSelectionClear,
  onDragOver,
  onDragLeave,
  onDrop,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onRestore,
  onDelete,
  onDownload,
  onShare,
  onToggleStar,
  onRenameStart,
  onTag,
  onCreateFolder,
  onUpload,
  onRefresh,
  onViewModeChange,
  onSortChange,
  onMoveFiles,
  onSelectionChange,
}: FileListProps & { onSelectionChange?: (selected: Set<string>) => void }) => {
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [contextMenuKey, setContextMenuKey] = React.useState(0);
  // #2 拖拉移動:目前被拖到的目標資料夾(用來高亮)
  const [dropTargetFolder, setDropTargetFolder] = React.useState<string | null>(null);

  const handleItemDragStart = (e: React.DragEvent, file: FileInfo) => {
    // 拖的是已選取的檔案 → 搬整批;否則只搬這一個
    const names =
      selectedFiles.has(file.name) && selectedFiles.size > 0
        ? Array.from(selectedFiles)
        : [file.name];
    e.dataTransfer.setData(MOVE_MIME, JSON.stringify(names));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleFolderDragOver = (e: React.DragEvent, folder: FileInfo) => {
    if (!folder.is_dir || !e.dataTransfer.types.includes(MOVE_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (dropTargetFolder !== folder.name) setDropTargetFolder(folder.name);
  };

  const handleFolderDrop = (e: React.DragEvent, folder: FileInfo) => {
    if (!folder.is_dir || !e.dataTransfer.types.includes(MOVE_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTargetFolder(null);
    try {
      const names = JSON.parse(e.dataTransfer.getData(MOVE_MIME)) as string[];
      if (names.length > 0 && !names.includes(folder.name)) {
        onMoveFiles?.(names, folder.name);
      }
    } catch {
      // ignore malformed payload
    }
  };

  React.useEffect(() => {
    if (renamingFile && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingFile]);

  const [selectionBox, setSelectionBox] = React.useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isSelectingRef = useRef(false);
  // Virtuoso 內部捲軸偏移量 — 由 onScroll 回呼更新
  const scrollOffsetRef = useRef(0);
  // 穩定化 onSelectionChange ref — 避免 calculateAndApplySelection 依賴不穩定的 callback 造成無限 re-render
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;

  // ── 座標計算式框選 ──
  // 幾何運算全在 finder/marquee.ts（純函式、有測試）。這裡只負責把
  // 結果轉回檔名並丟給呼叫端。
  const calculateAndApplySelection = React.useCallback(
    (box: MarqueeBox) => {
      const container = containerRef.current;
      const apply = onSelectionChangeRef.current;
      if (!container || !files?.length || !apply) return;

      const layout: MarqueeLayout =
        viewMode === "grid"
          ? { mode: "grid", containerWidth: container.clientWidth }
          : { mode: "list" };

      const names = itemsInMarquee(box, files.length, layout)
        .map((i) => files[i]?.name)
        .filter((n): n is string => n !== undefined);

      apply(new Set(names));
    },
    [files, viewMode],
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only start selection if clicking on empty space (not on a file item)
    if (e.button === 0 && !(e.target as HTMLElement).closest("[data-file-item]")) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const startX = e.clientX - rect.left;
        const startY = e.clientY - rect.top + scrollOffsetRef.current;
        isSelectingRef.current = true;
        setSelectionBox({ startX, startY, currentX: startX, currentY: startY });
        onSelectionClear();
      }
    }
  };

  const handleMouseMove = React.useCallback((e: MouseEvent) => {
    if (!isSelectingRef.current || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top + scrollOffsetRef.current;

    setSelectionBox((prev) => {
      if (!prev) return null;
      return { ...prev, currentX, currentY };
    });
  }, []);

  // Apply selection when selectionBox changes (real-time feedback)
  const lastSelectionBoxRef = React.useRef(selectionBox);
  React.useEffect(() => {
    if (selectionBox) {
      lastSelectionBoxRef.current = selectionBox;
      calculateAndApplySelection(selectionBox);
    }
  }, [selectionBox, calculateAndApplySelection]);

  // Track if we just finished a selection (to prevent click from clearing it)
  const justFinishedSelectingRef = React.useRef(false);

  const handleMouseUp = React.useCallback(() => {
    if (isSelectingRef.current) {
      // Apply final selection before clearing
      if (lastSelectionBoxRef.current) {
        calculateAndApplySelection(lastSelectionBoxRef.current);
      }
      isSelectingRef.current = false;
      justFinishedSelectingRef.current = true;
      // Reset after a short delay to allow click event to be ignored
      setTimeout(() => {
        justFinishedSelectingRef.current = false;
      }, 50);
      setSelectionBox(null);
    }
  }, [calculateAndApplySelection]);

  const handleContainerClick = React.useCallback(
    (e: React.MouseEvent) => {
      // Don't clear selection if we just finished a box selection
      if (justFinishedSelectingRef.current) {
        return;
      }
      // Only clear if clicking on empty space, not on a file item
      if (!(e.target as HTMLElement).closest("[data-file-item]")) {
        onSelectionClear();
      }
    },
    [onSelectionClear],
  );

  // Add/remove document event listeners
  React.useEffect(() => {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <ContextMenu key={contextMenuKey}>
      <ContextMenuTrigger className="flex-1 flex flex-col min-h-0 h-full w-full">
        {/* 框選用的畫布，不是控制項（拖曳出矩形來選檔案）。鍵盤沒有等價動作。 */}
        {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden relative h-full w-full select-none"
          onClick={handleContainerClick}
          onMouseDown={handleMouseDown}
          onPointerDown={(e) => {
            if (e.button === 2) {
              document.dispatchEvent(
                new PointerEvent("pointerdown", {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                  button: 0,
                  buttons: 1,
                }),
              );
              setContextMenuKey((prev) => prev + 1);
            }
          }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {selectionBox &&
            (() => {
              // 框選座標含 scroll offset，但顯示時需轉換回視窗座標
              const scrollOff = scrollOffsetRef.current;
              const dispStartY = selectionBox.startY - scrollOff;
              const dispCurrentY = selectionBox.currentY - scrollOff;
              return (
                <div
                  className="absolute border border-blue-500/50 bg-blue-500/20 z-50 pointer-events-none"
                  style={{
                    left: Math.min(selectionBox.startX, selectionBox.currentX),
                    top: Math.min(dispStartY, dispCurrentY),
                    width: Math.abs(selectionBox.currentX - selectionBox.startX),
                    height: Math.abs(dispCurrentY - dispStartY),
                  }}
                />
              );
            })()}
          {isDragging && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-blue-500/10 dark:bg-blue-500/20 backdrop-blur-sm border-2 border-blue-500 border-dashed m-2 rounded-lg pointer-events-none">
              <div className="flex flex-col items-center gap-2 text-blue-600 dark:text-blue-400">
                <Upload className="w-12 h-12" />
                <span className="text-lg font-medium">Drop files to upload</span>
              </div>
            </div>
          )}
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-gray-500">Loading...</div>
          ) : viewMode === "grid" ? (
            <VirtuosoGrid
              style={{ height: "100%", width: "100%" }}
              data={files ?? []}
              overscan={200}
              components={gridComponents}
              onScroll={(e) => {
                scrollOffsetRef.current = (e.target as HTMLElement).scrollTop;
              }}
              itemContent={(_index, file) => (
                <ContextMenu key={file.name}>
                  <ContextMenuTrigger>
                    {/* ⚠️ 這裡刻意**不**加 tabIndex / role="option"。
                        看起來只要補上就好，但這是 react-virtuoso 的虛擬清單：
                        給每一列 tabIndex={0} 等於在 1000 個檔案的資料夾裡製造
                        1000 個 Tab 停留點，比現在更難用。正確做法是 roving
                        tabindex（只有目前那一列可聚焦，方向鍵移動）加上外層的
                        role="listbox"——那是一個功能，不是一行修正，而且要處理
                        虛擬清單捲動時焦點跟著跑的問題。
                        現況：檔案操作（刪除、重新命名、全選…）已經由 Finder 的
                        全域 keydown 處理，缺的是「用鍵盤把游標移到某一列」。 */}
                    {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                    <div
                      data-file-item
                      draggable={!isTrashMode && renamingFile !== file.name}
                      onDragStart={(e) => handleItemDragStart(e, file)}
                      onDragOver={(e) => handleFolderDragOver(e, file)}
                      onDragLeave={() => {
                        if (dropTargetFolder === file.name) setDropTargetFolder(null);
                      }}
                      onDrop={(e) => handleFolderDrop(e, file)}
                      onClick={(e) => {
                        e.stopPropagation();
                        onFileClick(file, e);
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (renamingFile === file.name) return;
                        onFileDoubleClick(file);
                      }}
                      className={cn(
                        "flex flex-col items-center gap-1 p-2 rounded cursor-pointer group transition-colors duration-200",
                        selectedFiles.has(file.name)
                          ? "bg-blue-500/20 ring-1 ring-blue-500/50"
                          : "hover:bg-black/5 dark:hover:bg-white/5",
                        dropTargetFolder === file.name && "ring-2 ring-blue-500 bg-blue-500/30",
                      )}
                    >
                      <FileIcon file={file} currentPath={currentPath} />
                      {renamingFile === file.name ? (
                        <input
                          ref={renameInputRef}
                          type="text"
                          value={renameValue}
                          onChange={(e) => onRenameChange(e.target.value)}
                          onBlur={onRenameSubmit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") onRenameSubmit();
                            if (e.key === "Escape") onRenameCancel();
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            e.currentTarget.select();
                          }}
                          className="text-xs text-center px-1 rounded w-full bg-white dark:bg-black border border-blue-500 focus:outline-none text-black dark:text-white"
                        />
                      ) : (
                        <span
                          className={cn(
                            "text-xs text-center px-1 rounded truncate w-full transition-colors",
                            selectedFiles.has(file.name)
                              ? "text-blue-700 dark:text-blue-300 font-medium bg-blue-500/10"
                              : "text-gray-700 dark:text-gray-200 group-hover:text-gray-900 dark:group-hover:text-white",
                          )}
                        >
                          {file.name}
                        </span>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-64">
                    {isTrashMode ? (
                      <>
                        <ContextMenuItem onClick={() => onRestore?.(file.name)}>
                          <Move className="mr-2 h-4 w-4" /> Put Back
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem className="text-red-600">
                          <Trash2 className="mr-2 h-4 w-4" /> Delete Immediately
                        </ContextMenuItem>
                      </>
                    ) : (
                      <>
                        <ContextMenuItem onClick={() => onFileDoubleClick(file)}>
                          <Folder className="mr-2 h-4 w-4" /> Open
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() =>
                            onDownload?.(file.path || joinPath(currentPath, file.name))
                          }
                        >
                          <Download className="mr-2 h-4 w-4" /> Download
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => onShare?.(file)}>
                          <Share2 className="mr-2 h-4 w-4" /> Share
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => onToggleStar?.(file.path || file.name)}>
                          {file.is_starred ? (
                            <StarOff className="mr-2 h-4 w-4" />
                          ) : (
                            <Star className="mr-2 h-4 w-4" />
                          )}
                          {file.is_starred ? "Remove from Favorites" : "Add to Favorites"}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => onTag?.(file)}>
                          <Tags className="mr-2 h-4 w-4" /> Tags...
                        </ContextMenuItem>
                        <ContextMenuItem>
                          <History className="mr-2 h-4 w-4" /> Versions
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem onClick={() => onRenameStart?.(file)}>
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
                        <ContextMenuItem className="text-red-600" onClick={() => onDelete?.(file)}>
                          <Trash2 className="mr-2 h-4 w-4" /> Move to Trash
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              )}
            />
          ) : (
            <div className="w-full h-full flex flex-col text-sm text-gray-700 dark:text-gray-200">
              <div className="grid grid-cols-[minmax(200px,1fr)_80px_120px] gap-2 px-4 py-2 border-b border-white/10 font-medium text-gray-500 bg-white/80 dark:bg-black/80 backdrop-blur-sm z-10 shrink-0">
                <button
                  onClick={() => onSortChange?.("name")}
                  className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300 text-left"
                >
                  Name
                  {sortBy === "name" && (
                    <span className="text-xs">{sortDirection === "asc" ? "↑" : "↓"}</span>
                  )}
                </button>
                <button
                  onClick={() => onSortChange?.("size")}
                  className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300 text-left"
                >
                  Size
                  {sortBy === "size" && (
                    <span className="text-xs">{sortDirection === "asc" ? "↑" : "↓"}</span>
                  )}
                </button>
                <button
                  onClick={() => onSortChange?.("modified")}
                  className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300 text-left"
                >
                  Date Modified
                  {sortBy === "modified" && (
                    <span className="text-xs">{sortDirection === "asc" ? "↑" : "↓"}</span>
                  )}
                </button>
              </div>
              <TooltipProvider delayDuration={300}>
                <Virtuoso
                  style={{ flex: 1 }}
                  data={files ?? []}
                  overscan={200}
                  onScroll={(e) => {
                    scrollOffsetRef.current = (e.target as HTMLElement).scrollTop;
                  }}
                  itemContent={(_index, file) => (
                    <ContextMenu key={file.name}>
                      <ContextMenuTrigger>
                        {/* 同上：虛擬清單需要 roving tabindex，不是補一個 tabIndex */}
                        {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                        <div
                          data-file-item
                          draggable={!isTrashMode && renamingFile !== file.name}
                          onDragStart={(e) => handleItemDragStart(e, file)}
                          onDragOver={(e) => handleFolderDragOver(e, file)}
                          onDragLeave={() => {
                            if (dropTargetFolder === file.name) setDropTargetFolder(null);
                          }}
                          onDrop={(e) => handleFolderDrop(e, file)}
                          onClick={(e) => {
                            e.stopPropagation();
                            onFileClick(file, e);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (renamingFile === file.name) return;
                            onFileDoubleClick(file);
                          }}
                          className={cn(
                            "grid grid-cols-[minmax(200px,1fr)_80px_120px] gap-2 px-4 py-1.5 cursor-pointer transition-colors duration-150",
                            selectedFiles.has(file.name)
                              ? "bg-blue-500 text-white"
                              : "hover:bg-blue-500/10 even:bg-black/5 dark:even:bg-white/5",
                            dropTargetFolder === file.name &&
                              "ring-2 ring-blue-500 ring-inset bg-blue-500/30",
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                            <div className="shrink-0">
                              <SmallFileIcon file={file} />
                            </div>
                            {renamingFile === file.name ? (
                              <input
                                ref={renameInputRef}
                                type="text"
                                value={renameValue}
                                onChange={(e) => onRenameChange(e.target.value)}
                                onBlur={onRenameSubmit}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") onRenameSubmit();
                                  if (e.key === "Escape") onRenameCancel();
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  e.currentTarget.select();
                                }}
                                className="text-sm px-1 rounded bg-white dark:bg-black border border-blue-500 focus:outline-none text-black dark:text-white flex-1 min-w-0"
                              />
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="truncate cursor-default">{file.name}</span>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" align="start">
                                  <div className="space-y-1">
                                    <div className="font-medium">{file.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                      Size:{" "}
                                      {file.is_dir
                                        ? "Folder"
                                        : `${(file.size / 1024).toFixed(1)} KB`}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      Modified: {new Date(file.modified).toLocaleString()}
                                    </div>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                          <div
                            className={cn(
                              "text-xs shrink-0 flex items-center",
                              selectedFiles.has(file.name) ? "text-blue-100" : "text-gray-500",
                            )}
                          >
                            {file.is_dir ? "--" : `${(file.size / 1024).toFixed(1)} KB`}
                          </div>
                          <div
                            className={cn(
                              "text-xs shrink-0 flex items-center",
                              selectedFiles.has(file.name) ? "text-blue-100" : "text-gray-500",
                            )}
                          >
                            {new Date(file.modified).toLocaleDateString()}
                          </div>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-64">
                        {isTrashMode ? (
                          <>
                            <ContextMenuItem onClick={() => onRestore?.(file.name)}>
                              <Move className="mr-2 h-4 w-4" /> Put Back
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem className="text-red-600">
                              <Trash2 className="mr-2 h-4 w-4" /> Delete Immediately
                            </ContextMenuItem>
                          </>
                        ) : (
                          <>
                            <ContextMenuItem onClick={() => onFileDoubleClick(file)}>
                              <Folder className="mr-2 h-4 w-4" /> Open
                            </ContextMenuItem>
                            <ContextMenuItem
                              onClick={() =>
                                onDownload?.(file.path || joinPath(currentPath, file.name))
                              }
                            >
                              <Download className="mr-2 h-4 w-4" /> Download
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => onShare?.(file)}>
                              <Share2 className="mr-2 h-4 w-4" /> Share
                            </ContextMenuItem>
                            <ContextMenuItem onClick={() => onToggleStar?.(file.path || file.name)}>
                              {file.is_starred ? (
                                <StarOff className="mr-2 h-4 w-4" />
                              ) : (
                                <Star className="mr-2 h-4 w-4" />
                              )}
                              {file.is_starred ? "Remove from Favorites" : "Add to Favorites"}
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem onClick={() => onRenameStart?.(file)}>
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
                            <ContextMenuItem
                              className="text-red-600"
                              onClick={() => onDelete?.(file)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> Move to Trash
                            </ContextMenuItem>
                          </>
                        )}
                      </ContextMenuContent>
                    </ContextMenu>
                  )}
                />
              </TooltipProvider>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onCreateFolder?.();
          }}
        >
          <Plus className="mr-2 h-4 w-4" /> New Folder
        </ContextMenuItem>
        <ContextMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onUpload?.();
          }}
        >
          <Upload className="mr-2 h-4 w-4" /> Upload Files
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onViewModeChange?.(viewMode === "grid" ? "list" : "grid");
          }}
        >
          {viewMode === "grid" ? (
            <ListIcon className="mr-2 h-4 w-4" />
          ) : (
            <LayoutGrid className="mr-2 h-4 w-4" />
          )}
          {viewMode === "grid" ? "Switch to List View" : "Switch to Grid View"}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={(e) => {
            e.stopPropagation();
            onRefresh?.();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
