'use client';

import React, { useState, useEffect } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  LayoutGrid, 
  List as ListIcon, 
  Search,
  HardDrive,
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
  StarOff
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFiles, useDelete, useRename, useAddTag, useRemoveTag, useToggleStar, useTrash, useRestoreFromTrash, useEmptyTrash } from '@/features/files/api/useFiles';
import { FileInfo } from '@/types/api';
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

const FileIcon = ({ file }: { file: FileInfo }) => {
  if (file.is_dir) {
    return <Folder className="w-12 h-12 text-blue-500 fill-blue-500/20" />;
  }
  // Add more specific icons based on mime_type or extension here
  return <File className="w-12 h-12 text-gray-500" />;
};

const SmallFileIcon = ({ file }: { file: FileInfo }) => {
  if (file.is_dir) {
    return <Folder className="w-4 h-4 text-blue-500 fill-blue-500/20" />;
  }
  return <File className="w-4 h-4 text-gray-500" />;
};

export const Finder = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [currentPath, setCurrentPath] = useState('/');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<string[]>(['/']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isTrashMode, setIsTrashMode] = useState(false);

  const { data: files, isLoading } = useFiles({ path: currentPath });
  const { data: trashFiles, isLoading: isTrashLoading } = useTrash();
  
  const deleteFile = useDelete();
  const renameFile = useRename();
  const toggleStar = useToggleStar();
  const restoreFromTrash = useRestoreFromTrash();
  const emptyTrash = useEmptyTrash();

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
    const newName = prompt('Enter new name:', file.name);
    if (newName && newName !== file.name) {
      renameFile.mutate({ 
        path: file.path || (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`), 
        newName 
      });
    }
  };

  return (
    <div className="flex h-full bg-white/50 dark:bg-black/50 backdrop-blur-xl rounded-lg overflow-hidden border border-white/20 shadow-2xl">
      {/* Sidebar */}
      <div className="w-48 flex flex-col gap-6 p-4 border-r border-white/10 bg-zinc-50/80 dark:bg-zinc-900/80 backdrop-blur-xl">
        <div className="space-y-1">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-2 mb-2">Favorites</div>
          <SidebarItem icon={Clock} label="Recents" />
          <SidebarItem icon={File} label="Applications" />
          <SidebarItem icon={Download} label="Downloads" />
          <SidebarItem icon={Folder} label="Documents" active />
          <SidebarItem icon={Cloud} label="iCloud Drive" />
        </div>

        <div className="space-y-1">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-2 mb-2">Locations</div>
          <SidebarItem icon={HardDrive} label="Macintosh HD" />
          <SidebarItem icon={HardDrive} label="Koimsurai NAS" />
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
      <div className="flex-1 flex flex-col min-w-0 bg-white/40 dark:bg-black/40">
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
        <div className="flex-1 overflow-auto p-4" onClick={() => setSelectedFiles(new Set())}>
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
                      <FileIcon file={file} />
                      <span className={cn(
                        "text-xs text-center px-1 rounded truncate w-full transition-colors",
                        selectedFiles.has(file.name)
                          ? "text-blue-700 dark:text-blue-300 font-medium bg-blue-500/10"
                          : "text-gray-700 dark:text-gray-200 group-hover:text-gray-900 dark:group-hover:text-white"
                      )}>
                        {file.name}
                      </span>
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
                        <ContextMenuItem>
                          <Download className="mr-2 h-4 w-4" /> Download
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
                        <span className="truncate">{file.name}</span>
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
                        <ContextMenuItem>
                          <Download className="mr-2 h-4 w-4" /> Download
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
        <div className="h-6 flex items-center px-4 border-t border-white/10 bg-white/40 dark:bg-black/40 text-xs text-gray-500 backdrop-blur-md">
          {currentFiles ? `${currentFiles.length} items` : 'Loading...'}
        </div>
      </div>
    </div>
  );
};