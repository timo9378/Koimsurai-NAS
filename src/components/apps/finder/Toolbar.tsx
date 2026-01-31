'use client';

import React, { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  LayoutGrid,
  List as ListIcon,
  Upload,
  Search,
  Trash2,
  FolderUp,
  Folder,
  Home,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFiles } from '@/features/files/api/useFiles';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { Button } from "@/components/ui/button";

interface BreadcrumbItemProps {
  name: string;
  path: string;
  parentPath: string;
  isLast: boolean;
  onNavigate: (path: string) => void;
}

const BreadcrumbItem = ({ name, path, parentPath, isLast, onNavigate }: BreadcrumbItemProps) => {
  const [isOpen, setIsOpen] = useState(false);
  
  // Fetch sibling folders (folders in the parent directory)
  // Only fetch when not the last item, or when dropdown is open
  const { data: parentFiles = [] } = useFiles({ path: parentPath });
  const siblingFolders = parentFiles.filter(f => f.is_dir && f.name !== name);

  // For the last breadcrumb, don't show dropdown arrow (no siblings to show)
  // This also prevents the scroll issue
  const showDropdown = !isLast && siblingFolders.length > 0;

  return (
    <div className="flex items-center shrink-0">
      <button
        onClick={() => onNavigate(path)}
        className={cn(
          "hover:bg-black/5 dark:hover:bg-white/10 px-1.5 py-0.5 rounded transition-colors text-sm truncate max-w-[150px]",
          isLast ? "font-medium" : ""
        )}
      >
        {name}
      </button>
      {showDropdown && (
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
          <DropdownMenuTrigger asChild>
            <button 
              className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <ChevronDown className={cn(
                "w-3 h-3 text-gray-400 transition-transform",
                isOpen && "rotate-180"
              )} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto min-w-[160px]" sideOffset={4}>
            {siblingFolders.map(folder => (
              <DropdownMenuItem
                key={folder.name}
                onClick={() => {
                  const siblingPath = parentPath === '/' 
                    ? `/${folder.name}` 
                    : `${parentPath}/${folder.name}`;
                  onNavigate(siblingPath);
                  setIsOpen(false);
                }}
                className="gap-2"
              >
                <Folder className="w-4 h-4 text-blue-500" />
                <span className="truncate">{folder.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
};

interface BreadcrumbsProps {
  path: string;
  onNavigate: (path: string) => void;
}

const Breadcrumbs = ({ path, onNavigate }: BreadcrumbsProps) => {
  const parts = path.split('/').filter(Boolean);
  const [isRootOpen, setIsRootOpen] = useState(false);
  
  // Fetch root folders for the dropdown
  const { data: rootFiles = [] } = useFiles({ path: '/' });
  const rootFolders = rootFiles.filter(f => f.is_dir);

  return (
    <div className="flex items-center gap-0.5 text-sm text-gray-600 dark:text-gray-300 overflow-hidden min-w-0">
      {/* Home/Root */}
      <div className="flex items-center shrink-0">
        <button
          onClick={() => onNavigate('/')}
          className="flex items-center gap-1 hover:bg-black/5 dark:hover:bg-white/10 px-1.5 py-0.5 rounded transition-colors"
        >
          <Home className="w-4 h-4" />
          <span>Home</span>
        </button>
        {rootFolders.length > 0 && (
          <DropdownMenu open={isRootOpen} onOpenChange={setIsRootOpen}>
            <DropdownMenuTrigger asChild>
              <button 
                className="p-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <ChevronDown className={cn(
                  "w-3 h-3 text-gray-400 transition-transform",
                  isRootOpen && "rotate-180"
                )} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto min-w-[160px]">
              {rootFolders.map(folder => (
                <DropdownMenuItem
                  key={folder.name}
                  onClick={() => {
                    onNavigate(`/${folder.name}`);
                    setIsRootOpen(false);
                  }}
                  className="gap-2"
                >
                  <Folder className="w-4 h-4 text-blue-500" />
                  <span className="truncate">{folder.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      
      {/* Path segments */}
      {parts.map((part, index) => {
        const currentPath = '/' + parts.slice(0, index + 1).join('/');
        const parentPath = index === 0 ? '/' : '/' + parts.slice(0, index).join('/');
        const isLast = index === parts.length - 1;
        
        return (
          <React.Fragment key={currentPath}>
            <span className="text-gray-400 shrink-0">/</span>
            <BreadcrumbItem 
              name={part} 
              path={currentPath} 
              parentPath={parentPath}
              isLast={isLast}
              onNavigate={onNavigate} 
            />
          </React.Fragment>
        );
      })}
    </div>
  );
};

interface ToolbarProps {
  currentPath: string;
  isTrashMode: boolean;
  viewMode: 'grid' | 'list';
  historyIndex: number;
  historyLength: number;
  searchQuery: string;
  onNavigate: (path: string) => void;
  onBack: () => void;
  onForward: () => void;
  onEmptyTrash: () => void;
  onUploadClick: () => void;
  onCreateUploadLink?: () => void;
  onViewModeChange: (mode: 'grid' | 'list') => void;
  onSearchChange: (query: string) => void;
}

export const Toolbar = ({
  currentPath,
  isTrashMode,
  viewMode,
  historyIndex,
  historyLength,
  searchQuery,
  onNavigate,
  onBack,
  onForward,
  onEmptyTrash,
  onUploadClick,
  onCreateUploadLink,
  onViewModeChange,
  onSearchChange,
}: ToolbarProps) => {
  return (
    <div className="h-14 flex items-center justify-between px-4 border-b border-white/10 bg-white/40 dark:bg-black/40 backdrop-blur-md shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          <button
            onClick={onBack}
            disabled={historyIndex === 0}
            className="p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>
          <button
            onClick={onForward}
            disabled={historyIndex === historyLength - 1}
            className="p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>
        </div>
        {isTrashMode ? (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1 bg-white/50 dark:bg-black/50 rounded-lg border border-white/20">
              <Trash2 className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Trash</span>
            </div>
            <button
              onClick={onEmptyTrash}
              className="group flex items-center gap-2 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/50 rounded-lg transition-all duration-200"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-600 dark:text-red-400 group-hover:scale-110 transition-transform" />
              <span className="text-xs font-medium text-red-600 dark:text-red-400">Empty Trash</span>
            </button>
          </div>
        ) : (
          <Breadcrumbs path={currentPath} onNavigate={onNavigate} />
        )}
      </div>

      <div className="flex items-center gap-3">
        {!isTrashMode && (
          <>
            <button
              onClick={onUploadClick}
              className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
              title="Upload"
            >
              <Upload className="w-4 h-4 text-gray-600 dark:text-gray-300" />
            </button>
            {onCreateUploadLink && (
              <button
                onClick={onCreateUploadLink}
                className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                title="Create Upload Link"
              >
                <FolderUp className="w-4 h-4 text-purple-500 dark:text-purple-400" />
              </button>
            )}
          </>
        )}
        <div className="flex bg-black/5 dark:bg-white/10 rounded-md p-0.5">
          <button
            onClick={() => onViewModeChange('grid')}
            className={cn(
              "p-1 rounded transition-all duration-200",
              viewMode === 'grid' ? "bg-white dark:bg-gray-700 shadow-sm" : "hover:bg-black/5 dark:hover:bg-white/5"
            )}
          >
            <LayoutGrid className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          </button>
          <button
            onClick={() => onViewModeChange('list')}
            className={cn(
              "p-1 rounded transition-all duration-200",
              viewMode === 'list' ? "bg-white dark:bg-gray-700 shadow-sm" : "hover:bg-black/5 dark:hover:bg-white/5"
            )}
          >
            <ListIcon className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          </button>
        </div>

        <div className="relative group">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 group-focus-within:text-blue-500 transition-colors" />
          <input
            type="search"
            name={`finder-search-${Date.now()}`}
            placeholder="Search"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            autoComplete="new-password"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
            aria-autocomplete="none"
            className="w-48 h-8 pl-9 pr-3 text-sm bg-black/5 dark:bg-white/10 rounded-md border border-transparent focus:border-blue-500 focus:outline-none text-gray-700 dark:text-gray-200 placeholder:text-gray-500 transition-all focus:w-64 focus:bg-white dark:focus:bg-black focus:shadow-sm"
          />
        </div>
      </div>
    </div>
  );
};