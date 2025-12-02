'use client';

import React, { useRef } from 'react';
import { useWindowStore, WindowState } from '@/store/window-store';
import { motion, useDragControls } from 'framer-motion';
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

  const constraintsRef = useRef(null);

  if (window.isMinimized) return null;

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ 
        scale: 1, 
        opacity: 1,
        width: window.isMaximized ? '100%' : window.size.width,
        height: window.isMaximized ? '100%' : window.size.height,
        x: window.isMaximized ? 0 : window.position.x,
        y: window.isMaximized ? 0 : window.position.y,
      }}
      style={{ zIndex: window.zIndex }}
      className={cn(
        "absolute flex flex-col bg-white/80 dark:bg-black/80 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl overflow-hidden transition-shadow duration-200",
        window.isMaximized && "rounded-none border-0"
      )}
      onMouseDown={() => focusWindow(window.id)}
      drag={!window.isMaximized}
      dragMomentum={false}
      onDragEnd={(_, info) => {
        if (!window.isMaximized) {
          updateWindowPosition(window.id, {
            x: window.position.x + info.offset.x,
            y: window.position.y + info.offset.y
          });
        }
      }}
    >
      {/* Window Header */}
      <div 
        className="h-10 bg-white/50 dark:bg-black/50 border-b border-white/10 flex items-center justify-between px-4 select-none cursor-default"
        onDoubleClick={() => window.isMaximized ? restoreWindow(window.id) : maximizeWindow(window.id)}
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
      <div className="flex-1 overflow-hidden">
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