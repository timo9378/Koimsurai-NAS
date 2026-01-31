'use client';

import React from 'react';
import {
  Clock,
  File,
  Folder,
  Home,
  Server,
  Trash2,
  Plus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FileInfo, UserTag } from '@/types/api';
import { TAG_COLORS, TagColorName } from '@/hooks/use-tags';

interface SidebarItemProps {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  onClick?: () => void;
  badge?: number;
}

const SidebarItem = ({ icon: Icon, label, active = false, onClick, badge }: SidebarItemProps) => (
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
    <span className="flex-1">{label}</span>
    {badge !== undefined && badge > 0 && (
      <span className={cn(
        "text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center",
        active ? "bg-white/20 text-white" : "bg-black/10 dark:bg-white/10 text-gray-500 dark:text-gray-400"
      )}>
        {badge}
      </span>
    )}
  </div>
);

interface TagItemProps {
  tag: UserTag;
  active: boolean;
  onClick: () => void;
}

const TagItem = ({ tag, active, onClick }: TagItemProps) => {
  // Determine color from tag.color or use a default based on name
  const getTagColor = (): string => {
    if (tag.color) return tag.color;
    // Try to match color name
    const lowerName = tag.name.toLowerCase() as TagColorName;
    if (lowerName in TAG_COLORS) {
      return TAG_COLORS[lowerName];
    }
    return TAG_COLORS.gray;
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm transition-all duration-200",
        active
          ? "bg-blue-500 text-white shadow-sm font-medium"
          : "text-gray-600 dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/10"
      )}
    >
      <div
        className="w-3 h-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: getTagColor() }}
      />
      <span className="flex-1 truncate">{tag.name}</span>
      <span className={cn(
        "text-xs px-1.5 py-0.5 rounded-full min-w-[20px] text-center",
        active ? "bg-white/20 text-white" : "bg-black/10 dark:bg-white/10 text-gray-500 dark:text-gray-400"
      )}>
        {tag.count}
      </span>
    </div>
  );
};

interface SidebarProps {
  currentPath: string;
  isTrashMode: boolean;
  favorites?: FileInfo[];
  tags?: UserTag[];
  selectedTag?: string | null;
  onNavigate: (path: string) => void;
  onTrashMode: () => void;
  onFavoriteClick: (fav: FileInfo) => void;
  onTagClick?: (tagName: string | null) => void;
  onManageTags?: () => void;
}

export const Sidebar = ({
  currentPath,
  isTrashMode,
  favorites,
  tags = [],
  selectedTag,
  onNavigate,
  onTrashMode,
  onFavoriteClick,
  onTagClick,
  onManageTags,
}: SidebarProps) => {
  return (
    <div className="w-52 flex flex-col gap-6 p-4 border-r border-white/10 bg-zinc-50/80 dark:bg-zinc-900/80 backdrop-blur-xl overflow-y-auto">
      <div className="space-y-1">
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-2 mb-2 uppercase tracking-wider">Favorites</div>
        <SidebarItem icon={Clock} label="Recents" />
        <SidebarItem icon={File} label="Applications" />
        {favorites?.map((fav) => (
          <SidebarItem
            key={fav.path}
            icon={fav.is_dir ? Folder : File}
            label={fav.name}
            active={currentPath === (fav.path.startsWith('/') ? fav.path : `/${fav.path}`) && !isTrashMode && !selectedTag}
            onClick={() => onFavoriteClick(fav)}
          />
        ))}
      </div>

      <div className="space-y-1">
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-2 mb-2 uppercase tracking-wider">Locations</div>
        <SidebarItem
          icon={Home}
          label="Home"
          active={currentPath === '/' && !isTrashMode && !selectedTag}
          onClick={() => {
            onTagClick?.(null);
            onNavigate('/');
          }}
        />
        <SidebarItem
          icon={Server}
          label="Koimsurai NAS"
          active={currentPath === '/DataVol1' && !isTrashMode && !selectedTag}
          onClick={() => {
            onTagClick?.(null);
            onNavigate('/DataVol1');
          }}
        />
        <SidebarItem icon={Trash2} label="Trash" active={isTrashMode && !selectedTag} onClick={() => {
          onTagClick?.(null);
          onTrashMode();
        }} />
      </div>
      
      <div className="space-y-1">
        <div className="flex items-center justify-between px-2 mb-2">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tags</span>
          {onManageTags && (
            <button
              onClick={onManageTags}
              className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              title="Manage tags"
            >
              <Plus className="w-3 h-3 text-gray-500 dark:text-gray-400" />
            </button>
          )}
        </div>
        {tags.length === 0 ? (
          <div className="px-2 py-2 text-xs text-gray-500 dark:text-gray-400 italic">
            No tags yet
          </div>
        ) : (
          tags.map((tag) => (
            <TagItem
              key={tag.name}
              tag={tag}
              active={selectedTag === tag.name}
              onClick={() => onTagClick?.(tag.name)}
            />
          ))
        )}
      </div>
    </div>
  );
};