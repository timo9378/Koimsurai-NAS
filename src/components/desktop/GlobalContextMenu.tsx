'use client';

import React, { useEffect, useState, useRef } from 'react';
import { 
  RefreshCw, 
  FolderPlus, 
  Clipboard, 
  Image as ImageIcon, 
  Maximize2, 
  Minimize2, 
  X, 
  AppWindow, 
  Trash2,
  Power
} from 'lucide-react';
import { useWindowStore } from '@/store/window-store';
import { cn } from '@/lib/utils';
import { useDelete } from '@/features/files/api/useFiles';
import { useRescan } from '@/features/system/api/useSystem';
import { useQueryClient } from '@tanstack/react-query';

type ContextType = 'desktop' | 'dock-icon' | 'window-title' | 'desktop-icon' | null;

interface ContextMenuState {
  isOpen: boolean;
  x: number;
  y: number;
  type: ContextType;
  targetId?: string; // For dock icons (appType) or windows (windowId)
}

interface GlobalContextMenuProps {
  onWallpaperChange?: (url: string) => void;
}

export const GlobalContextMenu = ({ onWallpaperChange }: GlobalContextMenuProps) => {
  const [menu, setMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    type: null,
  });
  
  const menuRef = useRef<HTMLDivElement>(null);
  const deleteFile = useDelete();
  const rescan = useRescan();
  const queryClient = useQueryClient();
  
  const { 
    closeWindow, 
    minimizeWindow, 
    maximizeWindow, 
    restoreWindow,
    windows,
    openWindow
  } = useWindowStore();

  const handleCreateFolder = () => {
    // Dispatch event to let DesktopIcons handle the UI interaction
    const event = new Event('desktop-create-folder');
    window.dispatchEvent(event);
    setMenu(prev => ({ ...prev, isOpen: false }));
  };

  const handleRefresh = () => {
     queryClient.invalidateQueries({ queryKey: ['files'] });
     setMenu(prev => ({ ...prev, isOpen: false }));
  };

  const handleRescan = async () => {
     try {
       await rescan.mutateAsync();
       await queryClient.invalidateQueries({ queryKey: ['files'] });
       alert('Rescan completed');
     } catch (e) {
       console.error(e);
       alert('Rescan failed');
     }
     setMenu(prev => ({ ...prev, isOpen: false }));
  };

  const handleChangeWallpaper = () => {
    if (onWallpaperChange) {
      const wallpapers = [
        'https://images.unsplash.com/photo-1477346611705-65d1883cee1e?q=80&w=2070&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?q=80&w=2070&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?q=80&w=2070&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1506744038136-46273834b3fb?q=80&w=2070&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?q=80&w=2070&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=80&w=2070&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1506765515384-028b60a970df?q=80&w=2070&auto=format&fit=crop',
        'https://images.unsplash.com/photo-1465146344425-f00d5f5c8f07?q=80&w=2070&auto=format&fit=crop',
      ];
      const random = wallpapers[Math.floor(Math.random() * wallpapers.length)];
      onWallpaperChange(random);
    }
    setMenu(prev => ({ ...prev, isOpen: false }));
  };

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;

      e.preventDefault();
      
      const target = e.target as HTMLElement;
      const contextElement = target.closest('[data-context-type]');
      
      if (!contextElement) {
        setMenu({ isOpen: false, x: 0, y: 0, type: null });
        return;
      }

      const type = contextElement.getAttribute('data-context-type') as ContextType;
      const targetId = contextElement.getAttribute('data-context-id') || undefined;

      // Calculate position to prevent overflow
      let newX = e.clientX;
      let newY = e.clientY;
      
      // Estimate menu dimensions (can be dynamic, but fixed for safety)
      const menuWidth = 160;
      const menuHeight = 200; // Approximate max height
      
      if (newX + menuWidth > window.innerWidth) {
        newX = window.innerWidth - menuWidth - 10;
      }
      
      if (newY + menuHeight > window.innerHeight) {
        newY = newY - menuHeight; // Show above cursor
      }

      setMenu({ isOpen: false, x: 0, y: 0, type: null });
      
      setTimeout(() => {
        setMenu({
          isOpen: true,
          x: newX,
          y: newY,
          type,
          targetId
        });
      }, 50);
    };

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(prev => ({ ...prev, isOpen: false }));
      }
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('click', handleClick);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('click', handleClick);
    };
  }, []);

  if (!menu.isOpen) return null;

  const renderMenuItems = () => {
    switch (menu.type) {
      case 'desktop':
        return (
          <>
            <MenuItem 
              icon={RefreshCw} 
              label="重新整理" 
              onClick={handleRefresh} 
            />
            <MenuItem 
              icon={RefreshCw} 
              label="重新掃描檔案" 
              onClick={handleRescan} 
            />
            <MenuItem 
              icon={FolderPlus} 
              label="新增資料夾" 
              onClick={handleCreateFolder} 
            />
            <MenuItem 
              icon={Clipboard} 
              label="貼上" 
              onClick={() => console.log('Paste')} 
              disabled 
            />
            <div className="h-px bg-border my-1" />
            <MenuItem 
              icon={ImageIcon} 
              label="更換桌布" 
              onClick={handleChangeWallpaper} 
            />
          </>
        );
      case 'desktop-icon':
        return (
          <>
            <MenuItem 
               icon={AppWindow}
               label="開啟"
               onClick={() => {
                 // Ideally openWindow needs file type.
                 // For now, let's just allow 'Delete'.
                 setMenu(prev => ({ ...prev, isOpen: false }));
               }}
               disabled
            />
             <div className="h-px bg-border my-1" />
            <MenuItem 
              icon={Trash2} 
              label="丟到垃圾桶" 
              className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
              onClick={() => {
                // Dispatch event to let DesktopIcons handle the deletion of selected items
                const event = new Event('desktop-delete-selected');
                window.dispatchEvent(event);
                setMenu(prev => ({ ...prev, isOpen: false }));
              }} 
            />
          </>
        );
      case 'dock-icon':
        return (
          <>
            <MenuItem 
              icon={AppWindow} 
              label="開啟" 
              onClick={() => {
                if (menu.targetId) openWindow(menu.targetId as any);
                setMenu(prev => ({ ...prev, isOpen: false }));
              }} 
            />
            <div className="h-px bg-border my-1" />
            <MenuItem 
              icon={Power} 
              label="強制結束" 
              className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
              onClick={() => {
                // Find all windows of this app type and close them
                const appWindows = windows.filter(w => w.appType === menu.targetId);
                appWindows.forEach(w => closeWindow(w.id));
                setMenu(prev => ({ ...prev, isOpen: false }));
              }} 
            />
          </>
        );
      case 'window-title':
        const windowId = menu.targetId;
        const targetWindow = windows.find(w => w.id === windowId);
        if (!targetWindow) return null;

        return (
          <>
            <MenuItem 
              icon={Minimize2} 
              label="最小化" 
              onClick={() => {
                if (windowId) minimizeWindow(windowId);
                setMenu(prev => ({ ...prev, isOpen: false }));
              }} 
            />
            <MenuItem 
              icon={targetWindow.isMaximized ? Minimize2 : Maximize2} 
              label={targetWindow.isMaximized ? "還原" : "最大化"} 
              onClick={() => {
                if (windowId) {
                    if (targetWindow.isMaximized) restoreWindow(windowId);
                    else maximizeWindow(windowId);
                }
                setMenu(prev => ({ ...prev, isOpen: false }));
              }} 
            />
            <div className="h-px bg-border my-1" />
            <MenuItem 
              icon={X} 
              label="關閉" 
              className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
              onClick={() => {
                if (windowId) closeWindow(windowId);
                setMenu(prev => ({ ...prev, isOpen: false }));
              }} 
            />
          </>
        );
      default:
        return null;
    }
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[160px] bg-white/80 dark:bg-black/80 backdrop-blur-xl border border-white/20 rounded-lg shadow-xl p-1 animate-in fade-in zoom-in-95 duration-100"
      style={{
        top: menu.y,
        left: menu.x,
      }}
    >
      {renderMenuItems()}
    </div>
  );
};

interface MenuItemProps {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}

const MenuItem = ({ icon: Icon, label, onClick, disabled, className }: MenuItemProps) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={cn(
      "w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-colors",
      "hover:bg-black/5 dark:hover:bg-white/10",
      disabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
      className
    )}
  >
    <Icon className="w-4 h-4" />
    <span>{label}</span>
  </button>
);
