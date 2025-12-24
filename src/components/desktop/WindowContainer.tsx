'use client';

import React, { useRef, useEffect } from 'react';
import { useWindowStore, WindowState } from '@/store/window-store';
import { motion, useMotionValue, useSpring, useDragControls, animate } from 'framer-motion';
import { X, Minus, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AppType } from '@/store/window-store';
import { Finder } from '@/components/apps/Finder';
import { Dashboard } from '@/components/apps/Dashboard';
import { DockerManager } from '@/components/apps/DockerManager';
import { Photos } from '@/components/apps/Photos';
import { FilePreview } from '@/components/apps/FilePreview';

const WindowContent = ({ appType, props, windowId }: { appType: string, props?: any, windowId: string }) => {
  switch (appType) {
    case 'finder':
      return <Finder />;
    case 'dashboard':
      return <Dashboard />;
    case 'docker':
      return <DockerManager />;
    case 'photos':
      return <Photos />;
    case 'preview':
      return <FilePreview {...props} windowId={windowId} />;
    default:
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground">
          {appType} content goes here
        </div>
      );
  }
};

// Helper to calculate dock position
const getDockPosition = (appType: AppType) => {
  if (typeof globalThis.window === 'undefined') return { x: 0, y: 0 };

  const apps: AppType[] = [
    'finder',
    'launchpad',
    'dashboard',
    'photos',
    'docker',
    'terminal',
    'calculator',
    'settings',
    'trash'
  ];

  const index = apps.indexOf(appType);
  if (index === -1) return { x: globalThis.window.innerWidth / 2, y: globalThis.window.innerHeight };

  const iconSize = 40; // Base size
  const gap = 16;
  const paddingX = 16;
  
  const totalWidth = (apps.length * iconSize) + ((apps.length - 1) * gap) + (2 * paddingX);
  const startX = (globalThis.window.innerWidth - totalWidth) / 2;
  
  // Calculate center of the icon
  const targetX = startX + paddingX + (index * (iconSize + gap)) + (iconSize / 2);
  const targetY = globalThis.window.innerHeight - 48; // Center of dock (bottom-4 + h-16/2)

  return { x: targetX, y: targetY };
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

  const dragControls = useDragControls();

  // Use MotionValues for performant updates without re-renders
  const x = useMotionValue(window.position.x);
  const y = useMotionValue(window.position.y);
  const width = useMotionValue(window.size.width);
  const height = useMotionValue(window.size.height);
  
  const [isDragging, setIsDragging] = React.useState(false);

  // Handle maximize/restore/minimize animations manually
  useEffect(() => {
    if (isDragging) return;

    if (window.isMinimized) {
      const dockPos = getDockPosition(window.appType);
      // Animate to dock position
      // We use a custom bezier to simulate the "suck" effect (start slow, accelerate in)
      const transition: any = { duration: 0.5, ease: [0.2, 0, 0, 1] };
      
      // Move the center of the window to the dock position
      // Since we scale from center, we just need to align the center of the window with the dock icon center
      animate(x, dockPos.x - window.size.width / 2, transition);
      animate(y, dockPos.y - window.size.height / 2, transition);
      
    } else if (window.isMaximized) {
      animate(x, 24, { type: "spring", stiffness: 300, damping: 30 });
      animate(y, 48, { type: "spring", stiffness: 300, damping: 30 });
    } else {
      // Restore to position
      animate(x, window.position.x, { type: "spring", stiffness: 300, damping: 30 });
      animate(y, window.position.y, { type: "spring", stiffness: 300, damping: 30 });
    }
  }, [window.isMaximized, window.isMinimized, window.position.x, window.position.y, window.appType, window.size, x, y, isDragging]);

  // Sync size only
  useEffect(() => {
    if (!window.isMaximized) {
      width.set(window.size.width);
      height.set(window.size.height);
    }
  }, [window.size, window.isMaximized, width, height]);


  const handleFocus = () => {
    if (!window.isMinimized && useWindowStore.getState().activeWindowId !== window.id) {
      focusWindow(window.id);
    }
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
      drag={!window.isMaximized}
      dragControls={dragControls}
      dragMomentum={false}
      dragElastic={0}
      dragListener={false} // Only drag via controls
      onDragStart={() => {
        setIsDragging(true);
        handleFocus();
      }}
      onDrag={(e, info) => {
        // Dispatch custom event for preview
        const event = new CustomEvent('window-drag-move', {
            detail: { y: info.point.y }
        });
        globalThis.window.dispatchEvent(event);
      }}
      onDragEnd={(e, info) => {
        setIsDragging(false);
        
        // Dispatch end event
        const event = new CustomEvent('window-drag-end', {
            detail: { y: info.point.y, windowId: window.id }
        });
        globalThis.window.dispatchEvent(event);
        
        if (info.point.y >= 50) {
          updateWindowPosition(window.id, { x: x.get(), y: y.get() });
        }
      }}
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{
        scale: window.isMinimized ? 0 : 1,
        opacity: window.isMinimized ? 0 : 1,
        width: window.isMaximized ? 'calc(100% - 48px)' : width.get(),
        height: window.isMaximized ? 'calc(100% - 96px)' : height.get(),
        // x and y are handled manually via useEffect
      }}
      style={{
        zIndex: window.zIndex,
        x,
        y,
        width: window.isMaximized ? undefined : width,
        height: window.isMaximized ? undefined : height,
        transformOrigin: "center", // Ensure scaling happens from center
      }}
      transition={
        window.isMinimized
          ? { duration: 0.5, ease: [0.2, 0, 0, 1] }
          : { type: "spring", stiffness: 300, damping: 30, duration: 0.4 }
      }
      className={cn(
        "absolute flex flex-col bg-white/80 dark:bg-black/80 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl overflow-hidden",
        useWindowStore.getState().activeWindowId === window.id ? "shadow-[0_20px_50px_rgba(0,0,0,0.3)]" : "shadow-xl",
        window.isMaximized && "shadow-2xl border border-white/10", // Keep border and shadow when maximized
        window.isMinimized && "pointer-events-none" // Disable events when minimized
      )}
      onMouseDown={handleFocus}
      onClick={handleFocus}
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

      {/* Preview is now handled by WindowContainer */}

      {/* Window Header */}
      <div
        className="h-10 bg-white/50 dark:bg-black/50 border-b border-white/10 flex items-center justify-between px-4 select-none cursor-default relative z-10"
        onDoubleClick={() => window.isMaximized ? restoreWindow(window.id) : maximizeWindow(window.id)}
        onPointerDown={(e) => {
          if (window.isMaximized) {
             // Handle drag from maximized state manually to initiate restore
             e.preventDefault();
             e.stopPropagation();
             
             const startX = e.clientX;
             const startY = e.clientY;
             const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
             const ratioX = (e.clientX - rect.left) / rect.width;

             const onPointerMove = (moveEvent: PointerEvent) => {
                if (moveEvent.clientY - startY > 10) {
                   restoreWindow(window.id);
                   
                   const restoredWidth = window.size.width;
                   const newX = moveEvent.clientX - (restoredWidth * ratioX);
                   const newY = moveEvent.clientY - 10;
                   
                   // Stop any ongoing animations on x/y
                   x.stop();
                   y.stop();
                   
                   x.set(newX);
                   y.set(newY);
                   updateWindowPosition(window.id, { x: newX, y: newY });
                   
                   setIsDragging(true);
                   
                   const startDragX = moveEvent.clientX;
                   const startDragY = moveEvent.clientY;
                   const startPosX = newX;
                   const startPosY = newY;
                   
                   const onContinueDragMove = (e: PointerEvent) => {
                      const deltaX = e.clientX - startDragX;
                      const deltaY = e.clientY - startDragY;
                      
                      // Manually update MotionValues
                      x.set(startPosX + deltaX);
                      y.set(startPosY + deltaY);
                      
                      const event = new CustomEvent('window-drag-move', { detail: { y: e.clientY } });
                      globalThis.window.dispatchEvent(event);
                   };
                   
                   const onContinueDragUp = (e: PointerEvent) => {
                      setIsDragging(false);
                      const event = new CustomEvent('window-drag-end', { detail: { y: e.clientY, windowId: window.id } });
                      globalThis.window.dispatchEvent(event);
                      
                      if (e.clientY >= 50) {
                        updateWindowPosition(window.id, { x: x.get(), y: y.get() });
                      }
                      
                      document.removeEventListener('pointermove', onContinueDragMove);
                      document.removeEventListener('pointerup', onContinueDragUp);
                   };
                   
                   document.removeEventListener('pointermove', onPointerMove);
                   document.removeEventListener('pointerup', onPointerUp);
                   document.addEventListener('pointermove', onContinueDragMove);
                   document.addEventListener('pointerup', onContinueDragUp);
                }
             };
             
             const onPointerUp = () => {
                document.removeEventListener('pointermove', onPointerMove);
                document.removeEventListener('pointerup', onPointerUp);
             };
             
             document.addEventListener('pointermove', onPointerMove);
             document.addEventListener('pointerup', onPointerUp);
          } else {
             dragControls.start(e);
          }
        }}
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
        <WindowContent appType={window.appType} props={window.props} windowId={window.id} />
      </div>
    </motion.div>
  );
};

export const WindowContainer = () => {
  const windows = useWindowStore((state) => state.windows);
  const { maximizeWindow } = useWindowStore();
  const isAnyMaximized = windows.some(w => w.isMaximized && !w.isMinimized);
  const [isPreviewMaximized, setIsPreviewMaximized] = React.useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const { activeWindowId, closeWindow } = useWindowStore.getState();
        if (activeWindowId) {
          closeWindow(activeWindowId);
        }
      }
    };

    const handleDragMove = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail.y < 50) {
        setIsPreviewMaximized(true);
      } else {
        setIsPreviewMaximized(false);
      }
    };

    const handleDragEnd = (e: Event) => {
      const customEvent = e as CustomEvent;
      setIsPreviewMaximized(false);
      if (customEvent.detail.y < 50 && customEvent.detail.windowId) {
        maximizeWindow(customEvent.detail.windowId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('window-drag-move', handleDragMove);
    window.addEventListener('window-drag-end', handleDragEnd);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('window-drag-move', handleDragMove);
      window.removeEventListener('window-drag-end', handleDragEnd);
    };
  }, [maximizeWindow]);

  return (
    <div className="fixed inset-0 pointer-events-none z-0">
      {/* Backdrop for maximized windows */}
      <motion.div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm transition-all duration-500"
        initial={{ opacity: 0 }}
        animate={{ opacity: isAnyMaximized ? 1 : 0 }}
        style={{ pointerEvents: isAnyMaximized ? 'auto' : 'none' }}
      />

      {/* Phantom Window Preview */}
      <motion.div
        className="fixed inset-0 z-50 pointer-events-none p-4 flex items-center justify-center"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{
          opacity: isPreviewMaximized ? 1 : 0,
          scale: isPreviewMaximized ? 1 : 0.95
        }}
        transition={{ duration: 0.2 }}
      >
         <div className="w-full h-full bg-white/10 backdrop-blur-md rounded-xl border-2 border-white/30 shadow-2xl"
              style={{
                width: 'calc(100% - 48px)',
                height: 'calc(100% - 96px)',
                marginTop: '48px',
                marginLeft: '24px'
              }}
         />
      </motion.div>
      
      <div className="relative w-full h-full pointer-events-auto">
        {windows.map((window) => (
          <Window key={window.id} window={window} />
        ))}
      </div>
    </div>
  );
};