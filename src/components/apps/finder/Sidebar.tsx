'use client';

import React from 'react';
import {
  Clock,
  File,
  Folder,
  Home,
  Server,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileInfo } from '@/types/api';

interface SidebarItemProps {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

const SidebarItem = ({ icon: Icon, label, active = false, onClick }: SidebarItemProps) => (
  <div 
    onClick={onClick}
    className={cn(
      "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm transition-all duration-200",
      active
        ? "bg-blue-500 text-white shadow-sm font-medium"
        : "text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10"
    )}
  >
    <Icon className={cn("w-4 h-4", active ? "text-white" : "text-current")} />
    <span>{label}</span>
  </div>
);

interface SidebarProps {
  currentPath: string;
  isTrashMode: boolean;
  favorites?: FileInfo[];
  onNavigate: (path: string) => void;
  onTrashMode: () => void;
  onFavoriteClick: (fav: FileInfo) => void;
}

export const Sidebar = ({
  currentPath,
  isTrashMode,
  favorites,
  onNavigate,
  onTrashMode,
  onFavoriteClick
}: SidebarProps) => {
  return (
    <div className="w-52 flex flex-col gap-6 p-4 border-r border-white/10 bg-zinc-50/80 dark:bg-zinc-900/80 backdrop-blur-xl">
      <div className="space-y-1">
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-2 mb-2 uppercase tracking-wider">Favorites</div>
        <SidebarItem icon={Clock} label="Recents" />
        <SidebarItem icon={File} label="Applications" />
        {favorites?.map((fav) => (
          <SidebarItem
            key={fav.path}
            icon={fav.is_dir ? Folder : File}
            label={fav.name}
            active={currentPath === (fav.path.startsWith('/') ? fav.path : `/${fav.path}`) && !isTrashMode}
            onClick={() => onFavoriteClick(fav)}
          />
        ))}
      </div>

      <div className="space-y-1">
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-2 mb-2 uppercase tracking-wider">Locations</div>
        <SidebarItem
          icon={Home}
          label="Home"
          active={currentPath === '/' && !isTrashMode}
          onClick={() => onNavigate('/')}
        />
        <SidebarItem
          icon={Server}
          label="Koimsurai NAS"
          active={currentPath === '/DataVol1' && !isTrashMode}
          onClick={() => onNavigate('/DataVol1')}
        />
        <SidebarItem icon={Trash2} label="Trash" active={isTrashMode} onClick={onTrashMode} />
      </div>
      
      <div className="space-y-1">
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-2 mb-2 uppercase tracking-wider">Tags</div>
        <div className="flex items-center gap-2 px-2 py-1 text-sm text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 rounded-md cursor-pointer">
          <div className="w-2 h-2 rounded-full bg-red-500" /> Red
        </div>
        <div className="flex items-center gap-2 px-2 py-1 text-sm text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10 rounded-md cursor-pointer">
          <div className="w-2 h-2 rounded-full bg-orange-500" /> Orange
        </div>
      </div>
    </div>
  );
};