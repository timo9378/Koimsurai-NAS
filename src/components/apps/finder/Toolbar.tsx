'use client';

import React from 'react';
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List as ListIcon,
  Upload,
  Search,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface BreadcrumbsProps {
  path: string;
  onNavigate: (path: string) => void;
}

const Breadcrumbs = ({ path, onNavigate }: BreadcrumbsProps) => {
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

interface ToolbarProps {
  currentPath: string;
  isTrashMode: boolean;
  viewMode: 'grid' | 'list';
  historyIndex: number;
  historyLength: number;
  onNavigate: (path: string) => void;
  onBack: () => void;
  onForward: () => void;
  onEmptyTrash: () => void;
  onUploadClick: () => void;
  onViewModeChange: (mode: 'grid' | 'list') => void;
}

export const Toolbar = ({
  currentPath,
  isTrashMode,
  viewMode,
  historyIndex,
  historyLength,
  onNavigate,
  onBack,
  onForward,
  onEmptyTrash,
  onUploadClick,
  onViewModeChange,
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
          <div className="text-sm font-medium text-gray-700 dark:text-gray-200">Trash</div>
        ) : (
          <Breadcrumbs path={currentPath} onNavigate={onNavigate} />
        )}
      </div>

      <div className="flex items-center gap-3">
        {isTrashMode && (
          <button
            onClick={onEmptyTrash}
            className="px-3 py-1 text-xs font-medium text-white bg-red-500 rounded hover:bg-red-600 transition-colors"
          >
            Empty Trash
          </button>
        )}
        {!isTrashMode && (
          <button
            onClick={onUploadClick}
            className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            title="Upload"
          >
            <Upload className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          </button>
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
            type="text"
            placeholder="Search"
            className="w-48 h-8 pl-9 pr-3 text-sm bg-black/5 dark:bg-white/10 rounded-md border border-transparent focus:border-blue-500 focus:outline-none text-gray-700 dark:text-gray-200 placeholder:text-gray-500 transition-all focus:w-64 focus:bg-white dark:focus:bg-black focus:shadow-sm"
          />
        </div>
      </div>
    </div>
  );
};