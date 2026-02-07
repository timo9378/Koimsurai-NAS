'use client';

import React, { useRef, useCallback, forwardRef } from 'react';
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileInfo } from '@/types/api';
import { useThumbnail } from '@/features/files/api/useFiles';
import { FileTypeIcon } from '@/lib/file-icons';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const FileIcon = ({ file, currentPath }: { file: FileInfo; currentPath?: string }) => {
  const isImage = file.mime_type?.startsWith('image/');

  const thumbnailPath = isImage
    ? (file.path
      ? file.path
      : (currentPath && currentPath !== '/')
        ? `${currentPath.replace(/^\//, '')}/${file.name}`
        : file.name)
    : ''; // Empty string disables the query due to enabled: !!path

  const { data: thumbnail } = useThumbnail(thumbnailPath, 'medium');

  // 圖片檔案：優先顯示縮圖
  if (isImage && thumbnail) {
    return <img src={thumbnail} alt={file.name} className="w-12 h-12 object-cover rounded shadow-sm" />;
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
  viewMode: 'grid' | 'list';
  currentPath: string;
  selectedFiles: Set<string>;
  renamingFile: string | null;
  renameValue: string;
  isTrashMode: boolean;
  isDragging: boolean;
  sortBy?: 'name' | 'size' | 'modified';
  sortDirection?: 'asc' | 'desc';
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
  onViewModeChange?: (mode: 'grid' | 'list') => void;
  onSortChange?: (field: 'name' | 'size' | 'modified') => void;
}

// VirtuosoGrid custom components — defined outside the component to avoid re-renders
const gridComponents = {
  List: forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ style, children, ...props }, ref) => (
    <div
      ref={ref}
      {...props}
      style={style}
      className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-4 content-start"
    >
      {children}
    </div>
  )),
  Item: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...props} style={{ display: 'contents' }}>
      {children}
    </div>
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
  sortBy = 'name',
  sortDirection = 'asc',
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
  onSelectionChange,
}: FileListProps & { onSelectionChange?: (selected: Set<string>) => void }) => {
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [contextMenuKey, setContextMenuKey] = React.useState(0);

  React.useEffect(() => {
    if (renamingFile && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingFile]);

  const [selectionBox, setSelectionBox] = React.useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isSelectingRef = useRef(false);
  
  // We need to track file element positions for selection
  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const calculateAndApplySelection = React.useCallback((box: { startX: number; startY: number; currentX: number; currentY: number }) => {
    if (!containerRef.current || !files || !onSelectionChange) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const scroll = containerRef.current.scrollTop;

    const boxLeft = Math.min(box.startX, box.currentX);
    const boxTop = Math.min(box.startY, box.currentY);
    const boxRight = Math.max(box.startX, box.currentX);
    const boxBottom = Math.max(box.startY, box.currentY);

    const newSelected = new Set<string>();

    files.forEach(file => {
      const el = fileRefs.current.get(file.name);
      if (el) {
        const elRect = el.getBoundingClientRect();
        const elLeft = elRect.left - rect.left;
        const elTop = elRect.top - rect.top + scroll;
        const elRight = elLeft + elRect.width;
        const elBottom = elTop + elRect.height;

        const isIntersecting = !(boxLeft > elRight ||
          boxRight < elLeft ||
          boxTop > elBottom ||
          boxBottom < elTop);

        if (isIntersecting) {
          newSelected.add(file.name);
        }
      }
    });
    
    onSelectionChange(newSelected);
  }, [files, onSelectionChange]);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only start selection if clicking on empty space (not on a file)
    if (e.button === 0 && e.target === e.currentTarget) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const startX = e.clientX - rect.left;
        const startY = e.clientY - rect.top + (containerRef.current?.scrollTop || 0);
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
    const currentY = e.clientY - rect.top + containerRef.current.scrollTop;

    setSelectionBox(prev => {
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

  const handleContainerClick = React.useCallback((e: React.MouseEvent) => {
    // Don't clear selection if we just finished a box selection
    if (justFinishedSelectingRef.current) {
      return;
    }
    // Only clear if clicking on the container itself, not on a file
    if (e.target === e.currentTarget) {
      onSelectionClear();
    }
  }, [onSelectionClear]);

  // Add/remove document event listeners
  React.useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <ContextMenu key={contextMenuKey}>
      <ContextMenuTrigger className="flex-1 flex flex-col min-h-0 h-full w-full">
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden p-4 relative h-full w-full select-none"
          onClick={handleContainerClick}
          onMouseDown={handleMouseDown}
          onPointerDown={(e) => {
            if (e.button === 2) {
              document.dispatchEvent(new PointerEvent('pointerdown', {
                bubbles: true,
                cancelable: true,
                view: window,
                button: 0,
                buttons: 1
              }));
              setContextMenuKey(prev => prev + 1);
            }
          }}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {selectionBox && (
            <div
              className="absolute border border-blue-500/50 bg-blue-500/20 z-50 pointer-events-none"
              style={{
                left: Math.min(selectionBox.startX, selectionBox.currentX),
                top: Math.min(selectionBox.startY, selectionBox.currentY),
                width: Math.abs(selectionBox.currentX - selectionBox.startX),
                height: Math.abs(selectionBox.currentY - selectionBox.startY),
              }}
            />
          )}
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
          ) : viewMode === 'grid' ? (
            <VirtuosoGrid
              style={{ height: '100%', width: '100%' }}
              data={files ?? []}
              overscan={200}
              components={gridComponents}
              itemContent={(index, file) => (
                <ContextMenu key={file.name}>
                  <ContextMenuTrigger>
                    <div
                      ref={(el) => {
                        if (el) fileRefs.current.set(file.name, el);
                        else fileRefs.current.delete(file.name);
                      }}
                      onClick={(e) => { e.stopPropagation(); onFileClick(file, e); }}
                      onDoubleClick={(e) => { e.stopPropagation(); onFileDoubleClick(file); }}
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
                          onChange={(e) => onRenameChange(e.target.value)}
                          onBlur={onRenameSubmit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') onRenameSubmit();
                            if (e.key === 'Escape') onRenameCancel();
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
                        <ContextMenuItem onClick={() => onDownload?.(file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`))}>
                          <Download className="mr-2 h-4 w-4" /> Download
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => onShare?.(file)}>
                          <Share2 className="mr-2 h-4 w-4" /> Share
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => onToggleStar?.(file.path || file.name)}>
                          {file.is_starred ? <StarOff className="mr-2 h-4 w-4" /> : <Star className="mr-2 h-4 w-4" />}
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
            <div className="w-full text-sm text-gray-700 dark:text-gray-200">
              <div className="grid grid-cols-[minmax(200px,1fr)_80px_120px] gap-2 px-4 py-2 border-b border-white/10 font-medium text-gray-500 sticky top-0 bg-white/80 dark:bg-black/80 backdrop-blur-sm z-10">
                <button
                  onClick={() => onSortChange?.('name')}
                  className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300 text-left"
                >
                  Name
                  {sortBy === 'name' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
                <button
                  onClick={() => onSortChange?.('size')}
                  className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300 text-left"
                >
                  Size
                  {sortBy === 'size' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
                <button
                  onClick={() => onSortChange?.('modified')}
                  className="flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-300 text-left"
                >
                  Date Modified
                  {sortBy === 'modified' && (
                    <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                  )}
                </button>
              </div>
              <TooltipProvider delayDuration={300}>
              <Virtuoso
                style={{ height: '100%' }}
                data={files ?? []}
                overscan={200}
                itemContent={(index, file) => (
                <ContextMenu key={file.name}>
                  <ContextMenuTrigger>
                    <div
                      ref={(el) => {
                        if (el) fileRefs.current.set(file.name, el);
                        else fileRefs.current.delete(file.name);
                      }}
                      onClick={(e) => { e.stopPropagation(); onFileClick(file, e); }}
                      onDoubleClick={(e) => { e.stopPropagation(); onFileDoubleClick(file); }}
                      className={cn(
                        "grid grid-cols-[minmax(200px,1fr)_80px_120px] gap-2 px-4 py-1.5 cursor-pointer transition-colors duration-150",
                        selectedFiles.has(file.name)
                          ? "bg-blue-500 text-white"
                          : "hover:bg-blue-500/10 even:bg-black/5 dark:even:bg-white/5"
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
                              if (e.key === 'Enter') onRenameSubmit();
                              if (e.key === 'Escape') onRenameCancel();
                            }}
                            onClick={(e) => e.stopPropagation()}
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
                                  Size: {file.is_dir ? 'Folder' : `${(file.size / 1024).toFixed(1)} KB`}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  Modified: {new Date(file.modified).toLocaleString()}
                                </div>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <div className={cn("text-xs shrink-0 flex items-center", selectedFiles.has(file.name) ? "text-blue-100" : "text-gray-500")}>
                        {file.is_dir ? '--' : `${(file.size / 1024).toFixed(1)} KB`}
                      </div>
                      <div className={cn("text-xs shrink-0 flex items-center", selectedFiles.has(file.name) ? "text-blue-100" : "text-gray-500")}>
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
                        <ContextMenuItem onClick={() => onDownload?.(file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`))}>
                          <Download className="mr-2 h-4 w-4" /> Download
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => onShare?.(file)}>
                          <Share2 className="mr-2 h-4 w-4" /> Share
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => onToggleStar?.(file.path || file.name)}>
                          {file.is_starred ? <StarOff className="mr-2 h-4 w-4" /> : <Star className="mr-2 h-4 w-4" />}
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
                        <ContextMenuItem className="text-red-600" onClick={() => onDelete?.(file)}>
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
        <ContextMenuItem onClick={(e) => {
          e.stopPropagation();
          onCreateFolder?.();
        }}>
          <Plus className="mr-2 h-4 w-4" /> New Folder
        </ContextMenuItem>
        <ContextMenuItem onClick={(e) => {
          e.stopPropagation();
          onUpload?.();
        }}>
          <Upload className="mr-2 h-4 w-4" /> Upload Files
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={(e) => {
          e.stopPropagation();
          onViewModeChange?.(viewMode === 'grid' ? 'list' : 'grid');
        }}>
          {viewMode === 'grid' ? <ListIcon className="mr-2 h-4 w-4" /> : <LayoutGrid className="mr-2 h-4 w-4" />}
          {viewMode === 'grid' ? 'Switch to List View' : 'Switch to Grid View'}
        </ContextMenuItem>
        <ContextMenuItem onClick={(e) => {
          e.stopPropagation();
          onRefresh?.();
        }}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};