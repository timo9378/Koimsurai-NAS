'use client';

import React, { useState } from 'react';
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
  Folder
} from 'lucide-react';
import { cn } from '@/lib/utils';

type ViewMode = 'grid' | 'list';

const SidebarItem = ({ icon: Icon, label, active = false }: { icon: React.ElementType, label: string, active?: boolean }) => (
  <div className={cn(
    "flex items-center gap-2 px-2 py-1 rounded-md cursor-pointer text-sm transition-colors",
    active ? "bg-blue-500 text-white" : "text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10"
  )}>
    <Icon className="w-4 h-4" />
    <span>{label}</span>
  </div>
);

export const Finder = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  return (
    <div className="flex h-full bg-white/50 dark:bg-black/50 backdrop-blur-xl">
      {/* Sidebar */}
      <div className="w-48 flex flex-col gap-6 p-4 border-r border-white/10 bg-white/30 dark:bg-black/30 backdrop-blur-md">
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
        </div>
        
        <div className="space-y-1">
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-2 mb-2">Tags</div>
          <div className="flex items-center gap-2 px-2 py-1 text-sm text-gray-600 dark:text-gray-300">
            <div className="w-2 h-2 rounded-full bg-red-500" /> Red
          </div>
          <div className="flex items-center gap-2 px-2 py-1 text-sm text-gray-600 dark:text-gray-300">
            <div className="w-2 h-2 rounded-full bg-orange-500" /> Orange
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="h-12 flex items-center justify-between px-4 border-b border-white/10 bg-white/40 dark:bg-black/40">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <button className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50">
                <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </button>
              <button className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50">
                <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </button>
            </div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
              Documents
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex bg-black/5 dark:bg-white/10 rounded-md p-0.5">
              <button 
                onClick={() => setViewMode('grid')}
                className={cn(
                  "p-1 rounded transition-colors",
                  viewMode === 'grid' ? "bg-white dark:bg-gray-700 shadow-sm" : "hover:bg-black/5 dark:hover:bg-white/5"
                )}
              >
                <LayoutGrid className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={cn(
                  "p-1 rounded transition-colors",
                  viewMode === 'list' ? "bg-white dark:bg-gray-700 shadow-sm" : "hover:bg-black/5 dark:hover:bg-white/5"
                )}
              >
                <ListIcon className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              </button>
            </div>
            
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
              <input 
                type="text" 
                placeholder="Search" 
                className="w-40 h-7 pl-7 pr-2 text-xs bg-black/5 dark:bg-white/10 rounded border border-transparent focus:border-blue-500 focus:outline-none text-gray-700 dark:text-gray-200 placeholder:text-gray-500"
              />
            </div>
          </div>
        </div>

        {/* File View */}
        <div className="flex-1 overflow-auto p-4">
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-4">
              {Array.from({ length: 15 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-1 p-2 rounded hover:bg-blue-500/20 cursor-pointer group">
                  <Folder className="w-12 h-12 text-blue-500 fill-blue-500/20" />
                  <span className="text-xs text-center text-gray-700 dark:text-gray-200 px-1 rounded group-hover:text-blue-600 dark:group-hover:text-blue-400 truncate w-full">
                    Folder {i + 1}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="w-full text-sm text-gray-700 dark:text-gray-200">
              <div className="grid grid-cols-[1fr_100px_150px] gap-4 px-4 py-2 border-b border-white/10 font-medium text-gray-500">
                <div>Name</div>
                <div>Size</div>
                <div>Date Modified</div>
              </div>
              {Array.from({ length: 15 }).map((_, i) => (
                <div key={i} className="grid grid-cols-[1fr_100px_150px] gap-4 px-4 py-1.5 hover:bg-blue-500/20 cursor-pointer even:bg-black/5 dark:even:bg-white/5">
                  <div className="flex items-center gap-2">
                    <Folder className="w-4 h-4 text-blue-500 fill-blue-500/20" />
                    <span>Folder {i + 1}</span>
                  </div>
                  <div className="text-gray-500">--</div>
                  <div className="text-gray-500">Today, 10:00 AM</div>
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Status Bar */}
        <div className="h-6 flex items-center px-4 border-t border-white/10 bg-white/40 dark:bg-black/40 text-xs text-gray-500">
          15 items, 100 GB available
        </div>
      </div>
    </div>
  );
};