'use client';

import React, { useRef, useEffect } from 'react';
import { useWindowStore, WindowState } from '@/store/window-store';
import { motion, useMotionValue, useSpring, useDragControls, animate, AnimatePresence } from 'framer-motion';
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

// ... getDockPosition helper ...
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
      const transition: any = { duration: 0.5, ease: [0.2, 0, 0, 1] };
      animate(x, dockPos.x - window.size.width / 2, transition);
      animate(y, dockPos.y - window.size.height / 2, transition);
      
    } else if (window.isMaximized || window.snapState) {
       // If maximized OR snapped, we should be at specific coordinates.
       // However, we set these via store updates (position/size).
       // So we just need to animate to them.
      animate(x, window.position.x, { type: "spring", stiffness: 300, damping: 30 });
      animate(y, window.position.y, { type: "spring", stiffness: 300, damping: 30 });
    } else {
      animate(x, window.position.x, { type: "spring", stiffness: 300, damping: 30 });
      animate(y, window.position.y, { type: "spring", stiffness: 300, damping: 30 });
    }
  }, [window.isMaximized, window.isMinimized, window.snapState, window.position.x, window.position.y, window.appType, window.size, x, y, isDragging]);

  // Sync size only
  useEffect(() => {
    // We want to sync size even if maximized/snapped, as the store holds the correct size for that state
    width.set(window.size.width);
    height.set(window.size.height);
  }, [window.size, width, height]);


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
      drag={!window.isMaximized && !window.snapState}
      dragControls={dragControls}
      dragMomentum={false}
      dragElastic={0}
      dragListener={false} 
      onDragStart={() => {
        setIsDragging(true);
        handleFocus();
      }}
      onDrag={(e, info) => {
        const event = new CustomEvent('window-drag-move', {
            detail: { x: info.point.x, y: info.point.y }
        });
        globalThis.window.dispatchEvent(event);
      }}
      onDragEnd={(e, info) => {
        setIsDragging(false);
        
        const event = new CustomEvent('window-drag-end', {
            detail: { x: info.point.x, y: info.point.y, windowId: window.id }
        });
        globalThis.window.dispatchEvent(event);
        
        const screenWidth = globalThis.window.innerWidth;
        // Updated threshold to 50
        const isSnapping = info.point.y < 50 || info.point.x < 50 || info.point.x > screenWidth - 50;
        
        if (!isSnapping) {
          updateWindowPosition(window.id, { x: x.get(), y: y.get() });
        } else {
          // If snapping, stop motion values to allow store update to take precedence smoothly
          x.stop();
          y.stop();
        }
      }}
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{
        scale: window.isMinimized ? 0 : 1,
        opacity: window.isMinimized ? 0 : 1,
        // We handle width/height/x/y manually via useEffect/MotionValues for performance and snapping logic
      }}
      style={{
        zIndex: window.zIndex,
        x,
        y,
        width,
        height,
        transformOrigin: "center",
      }}
      transition={
        window.isMinimized
          ? { duration: 0.5, ease: [0.2, 0, 0, 1] }
          : { type: "spring", stiffness: 300, damping: 30, duration: 0.4 }
      }
      className={cn(
        "absolute flex flex-col bg-white/80 dark:bg-black/80 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl overflow-hidden",
        useWindowStore.getState().activeWindowId === window.id ? "shadow-[0_20px_50px_rgba(0,0,0,0.3)]" : "shadow-xl",
        (window.isMaximized || window.snapState) && "shadow-2xl border border-white/10",
        window.isMinimized ? "pointer-events-none" : "pointer-events-auto"
      )}
      onMouseDown={handleFocus}
      onClick={handleFocus}
    >
      {!window.isMaximized && !window.snapState && (
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

      <div
        className="h-10 bg-white/50 dark:bg-black/50 border-b border-white/10 flex items-center justify-between px-4 select-none cursor-default relative z-10"
        data-context-type="window-title"
        data-context-id={window.id}
        onDoubleClick={() => {
          // Double click to toggle maximize with animation
          if (window.isMaximized) {
            restoreWindow(window.id);
          } else {
            maximizeWindow(window.id);
          }
        }}
        onPointerDown={(e) => {
          if (window.isMaximized || window.snapState) {
             e.preventDefault();
             e.stopPropagation();
             
             const startX = e.clientX;
             const startY = e.clientY;
             const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
             const ratioX = (e.clientX - rect.left) / rect.width;

             const onPointerMove = (moveEvent: PointerEvent) => {
                if (moveEvent.clientY - startY > 10) {
                   restoreWindow(window.id);
                   
                   // After restore, window has original size.
                   // We need to calculate where to place it so the mouse is still relative to the title bar correctly.
                   // Since state updates are async/zustand might take a tick, we might read 'window.size' here which is still the snapped size?
                   // No, restoreWindow updates the store. But 'window' prop here is from previous render until re-render.
                   // We need the 'restored' size. 
                   // Accessing restoreBounds directly from store or assuming we know it is tricky without a re-render.
                   
                   // However, usually we can use the 'restoreBounds' we just cleared? 
                   // Or simpler: We just let it jump to mouse pointer centered? No that's ugly.
                   
                   // Best bet: use the restoreBounds that were present on the window object BEFORE we called restoreWindow.
                   // window.restoreBounds is available here!
                   
                   const restoredWidth = window.restoreBounds?.size.width || 800; // Fallback
                   const newX = moveEvent.clientX - (restoredWidth * ratioX);
                   const newY = moveEvent.clientY - 10;
                   
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
                      
                      x.set(startPosX + deltaX);
                      y.set(startPosY + deltaY);
                      
                      const event = new CustomEvent('window-drag-move', { detail: { x: e.clientX, y: e.clientY } });
                      globalThis.window.dispatchEvent(event);
                   };
                   
                   const onContinueDragUp = (e: PointerEvent) => {
                      setIsDragging(false);
                      const event = new CustomEvent('window-drag-end', { detail: { x: e.clientX, y: e.clientY, windowId: window.id } });
                      globalThis.window.dispatchEvent(event);
                      
                      const screenWidth = globalThis.window.innerWidth;
                      // Updated threshold to 50
                      const isSnapping = e.clientY < 50 || e.clientX < 50 || e.clientX > screenWidth - 50;

                      if (!isSnapping) {
                        updateWindowPosition(window.id, { x: x.get(), y: y.get() });
                      } else {
                        x.stop();
                        y.stop();
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
              if (window.isMaximized) {
                restoreWindow(window.id);
              } else {
                // 使用與拖曳放大相同的邊距
                const screenWidth = globalThis.window.innerWidth;
                const screenHeight = globalThis.window.innerHeight;
                const bounds = {
                  position: { x: 24, y: 48 },
                  size: { width: screenWidth - 48, height: screenHeight - 96 }
                };
                maximizeWindow(window.id, bounds);
              }
            }}
            className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center text-black/0 hover:text-black/50 transition-colors"
          >
            {window.isMaximized ? <Minimize2 className="w-2 h-2" /> : <Maximize2 className="w-2 h-2" />}
          </button>
        </div>
        
        <div className="text-sm font-medium text-black/80 dark:text-white/80">
          {window.title}
        </div>
        
        <div className="w-14" />
      </div>

      <div className="flex-1 overflow-hidden relative z-0">
        <WindowContent appType={window.appType} props={window.props} windowId={window.id} />
      </div>
    </motion.div>
  );
};

export const WindowContainer = () => {
  const windows = useWindowStore((state) => state.windows);
  const { maximizeWindow, snapWindow, restoreWindow } = useWindowStore();
  const isAnyMaximized = windows.some(w => w.isMaximized && !w.isMinimized);
  const [previewState, setPreviewState] = React.useState<'none' | 'maximize' | 'left' | 'right'>('none');

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
      const { x, y } = customEvent.detail;
      const screenWidth = window.innerWidth;

      // Relaxed thresholds to 50px
      if (y < 50) {
        setPreviewState('maximize');
      } else if (x < 50) {
        setPreviewState('left');
      } else if (x > screenWidth - 50) {
        setPreviewState('right');
      } else {
        setPreviewState('none');
      }
    };

    const handleDragEnd = (e: Event) => {
      const customEvent = e as CustomEvent;
      const { windowId } = customEvent.detail;
      
      if (windowId && previewState !== 'none') {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        
        // 統一使用與預覽一致的邊距
        if (previewState === 'maximize') {
          const bounds = {
            position: { x: 24, y: 48 },
            size: { width: screenWidth - 48, height: screenHeight - 96 }
          };
          maximizeWindow(windowId, bounds);
        } else if (previewState === 'left') {
           const bounds = {
             position: { x: 12, y: 48 },
             size: { width: screenWidth / 2 - 24, height: screenHeight - 96 }
           };
           snapWindow(windowId, 'left', bounds);
        } else if (previewState === 'right') {
           const bounds = {
             position: { x: screenWidth / 2 + 12, y: 48 },
             size: { width: screenWidth / 2 - 24, height: screenHeight - 96 }
           };
           snapWindow(windowId, 'right', bounds);
        }
      }
      setPreviewState('none');
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('window-drag-move', handleDragMove);
    window.addEventListener('window-drag-end', handleDragEnd);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('window-drag-move', handleDragMove);
      window.removeEventListener('window-drag-end', handleDragEnd);
    };
  }, [maximizeWindow, snapWindow, restoreWindow, previewState, windows]);

  const getPreviewStyle = () => {
    const commonStyle = {
      opacity: 1,
      scale: 1,
      borderRadius: '12px',
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      backdropFilter: 'blur(12px)',
      border: '2px solid rgba(255, 255, 255, 0.3)',
      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    };

    switch (previewState) {
      case 'maximize':
        return {
          ...commonStyle,
          width: 'calc(100% - 48px)',
          height: 'calc(100% - 96px)',
          top: '48px',
          left: '24px',
        };
      case 'left':
        return {
          ...commonStyle,
          width: 'calc(50% - 24px)',
          height: 'calc(100% - 96px)',
          top: '48px',
          left: '12px',
        };
      case 'right':
        return {
          ...commonStyle,
          width: 'calc(50% - 24px)',
          height: 'calc(100% - 96px)',
          top: '48px',
          left: 'calc(50% + 12px)',
        };
      default:
        return {
          opacity: 0,
          scale: 0.9,
          top: '50%',
          left: '50%',
          x: '-50%',
          y: '-50%',
          width: '200px',
          height: '150px'
        };
    }
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-0">
      <motion.div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm transition-all duration-500"
        initial={{ opacity: 0 }}
        animate={{ opacity: isAnyMaximized ? 1 : 0 }}
        style={{ pointerEvents: isAnyMaximized ? 'auto' : 'none' }}
      />

      <AnimatePresence>
        {previewState !== 'none' && (
            <motion.div 
                className="absolute"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={getPreviewStyle()}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
        )}
      </AnimatePresence>
      
      <div className="relative w-full h-full pointer-events-none">
        {windows.map((window) => (
          <Window key={window.id} window={window} />
        ))}
      </div>
    </div>
  );
};