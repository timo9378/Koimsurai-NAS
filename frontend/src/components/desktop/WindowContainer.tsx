'use client';

import React, { useRef, useEffect } from 'react';
import { useWindowStore, WindowState } from '@/store/window-store';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { X, Minus, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Finder } from '@/components/apps/Finder';
import { Dashboard } from '@/components/apps/Dashboard';

const WindowContent = ({ appType }: { appType: string }) => {
  switch (appType) {
    case 'finder':
      return <Finder />;
    case 'dashboard':
      return <Dashboard />;
    default:
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          {appType} content goes here
        </div>
      );
  }
};

const Window = ({ window }: { window: WindowState }) => {
  const {
    closeWindow,
    minimizeWindow,
    maximizeWindow,
    restoreWindow,
    focusWindow,
    updateWindowPosition,
    updateWindowSize
  } = useWindowStore();

  // Use MotionValues for performant updates without re-renders
  const x = useMotionValue(window.position.x);
  const y = useMotionValue(window.position.y);
  const width = useMotionValue(window.size.width);
  const height = useMotionValue(window.size.height);
  
  // Sync MotionValues with store state when it changes (e.g. from other sources or initial load)
  useEffect(() => {
    if (!window.isMaximized) {
      x.set(window.position.x);
      y.set(window.position.y);
      width.set(window.size.width);
      height.set(window.size.height);
    }
  }, [window.position, window.size, window.isMaximized, x, y, width, height]);

  const [isDragging, setIsDragging] = React.useState(false);

  if (window.isMinimized) return null;

  const handleDrag = (e: React.PointerEvent) => {
    if (window.isMaximized) return;
    if ((e.target as HTMLElement).closest('button')) return;

    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);

    const startX = e.clientX;
    const startY = e.clientY;
    const startPosX = x.get();
    const startPosY = y.get();

    const onPointerMove = (e: PointerEvent) => {
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      
      const newX = startPosX + deltaX;
      const newY = startPosY + deltaY;
      
      x.set(newX);
      y.set(newY);
    };

    const onPointerUp = () => {
      setIsDragging(false);
      // Sync back to store on drag end
      updateWindowPosition(window.id, { x: x.get(), y: y.get() });
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  };

  const handleResize = (e: React.PointerEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = width.get();
    const startHeight = height.get();
    const startPosX = x.get();
    const startPosY = y.get();

    const onPointerMove = (e: PointerEvent) => {
      let newWidth = startWidth;
      let newHeight = startHeight;
      let newX = startPosX;
      let newY = startPosY;

      if (direction.includes('e')) {
        newWidth = Math.max(400, startWidth + (e.clientX - startX));
      }
      if (direction.includes('s')) {
        newHeight = Math.max(300, startHeight + (e.clientY - startY));
      }
      if (direction.includes('w')) {
        const deltaX = e.clientX - startX;
        newWidth = Math.max(400, startWidth - deltaX);
        newX = startPosX + deltaX;
      }
      if (direction.includes('n')) {
        const deltaY = e.clientY - startY;
        newHeight = Math.max(300, startHeight - deltaY);
        newY = startPosY + deltaY;
      }

      width.set(newWidth);
      height.set(newHeight);
      
      if (direction.includes('w') || direction.includes('n')) {
        x.set(newX);
        y.set(newY);
      }
    };

    const onPointerUp = () => {
      setIsDragging(false);
      // Sync back to store on resize end
      updateWindowSize(window.id, { width: width.get(), height: height.get() });
      updateWindowPosition(window.id, { x: x.get(), y: y.get() });
      
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  };

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{
        scale: 1,
        opacity: 1,
        // When maximized, we use fixed values. When not, we use MotionValues for performance
        width: window.isMaximized ? '100%' : undefined,
        height: window.isMaximized ? '100%' : undefined,
        x: window.isMaximized ? 0 : undefined,
        y: window.isMaximized ? 0 : undefined,
      }}
      style={{
        zIndex: window.zIndex,
        // Bind MotionValues directly to style for hardware accelerated updates
        x: window.isMaximized ? undefined : x,
        y: window.isMaximized ? undefined : y,
        width: window.isMaximized ? undefined : width,
        height: window.isMaximized ? undefined : height,
      }}
      transition={{ duration: 0.2 }}
      className={cn(
        "absolute flex flex-col bg-white/80 dark:bg-black/80 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl overflow-hidden",
        window.isMaximized && "rounded-none border-0"
      )}
      onMouseDown={() => focusWindow(window.id)}
    >
      {/* Resize Handles */}
      {!window.isMaximized && (
        <>
          <div className="absolute top-0 left-0 w-2 h-full cursor-w-resize z-20" onPointerDown={(e) => handleResize(e, 'w')} />
          <div className="absolute top-0 right-0 w-2 h-full cursor-e-resize z-20" onPointerDown={(e) => handleResize(e, 'e')} />
          <div className="absolute top-0 left-0 w-full h-2 cursor-n-resize z-20" onPointerDown={(e) => handleResize(e, 'n')} />
          <div className="absolute bottom-0 left-0 w-full h-2 cursor-s-resize z-20" onPointerDown={(e) => handleResize(e, 's')} />
          <div className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize z-30" onPointerDown={(e) => handleResize(e, 'nw')} />
          <div className="absolute top-0 right-0 w-4 h-4 cursor-ne-resize z-30" onPointerDown={(e) => handleResize(e, 'ne')} />
          <div className="absolute bottom-0 left-0 w-4 h-4 cursor-sw-resize z-30" onPointerDown={(e) => handleResize(e, 'sw')} />
          <div className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-30" onPointerDown={(e) => handleResize(e, 'se')} />
        </>
      )}

      {/* Window Header */}
      <div
        className="h-10 bg-white/50 dark:bg-black/50 border-b border-white/10 flex items-center justify-between px-4 select-none cursor-default relative z-10"
        onDoubleClick={() => window.isMaximized ? restoreWindow(window.id) : maximizeWindow(window.id)}
        onPointerDown={handleDrag}
      >
        <div className="flex items-center gap-2 group">
          <button
            onClick={(e) => { e.stopPropagation(); closeWindow(window.id); }}
            className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center text-black/0 hover:text-black/50 transition-colors"
          >
            <X className="w-2 h-2" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); minimizeWindow(window.id); }}
            className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 flex items-center justify-center text-black/0 hover:text-black/50 transition-colors"
          >
            <Minus className="w-2 h-2" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.isMaximized ? restoreWindow(window.id) : maximizeWindow(window.id);
            }}
            className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center text-black/0 hover:text-black/50 transition-colors"
          >
            {window.isMaximized ? <Minimize2 className="w-2 h-2" /> : <Maximize2 className="w-2 h-2" />}
          </button>
        </div>
        
        <div className="text-sm font-medium text-black/80 dark:text-white/80">
          {window.title}
        </div>
        
        <div className="w-14" /> {/* Spacer for centering title */}
      </div>

      {/* Window Content */}
      <div className="flex-1 overflow-hidden relative z-0">
        <WindowContent appType={window.appType} />
      </div>
    </motion.div>
  );
};

export const WindowContainer = () => {
  const windows = useWindowStore((state) => state.windows);

  return (
    <div className="fixed inset-0 pointer-events-none z-0">
      <div className="relative w-full h-full pointer-events-auto">
        {windows.map((window) => (
          <Window key={window.id} window={window} />
        ))}
      </div>
    </div>
  );
};